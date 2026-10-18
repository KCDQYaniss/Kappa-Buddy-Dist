//! Overlay module - Integrated from pado8/tarkov-price-overlay
//! Provides an in-game price card: screen capture + OCR + price lookup are done
//! by the bundled `tarkov-server` Python sidecar, this module drives the
//! transparent Tauri window and the Windows-specific glue.
//!
//! Design notes:
//! - The card sits at a FIXED anchor in the top-left corner. It used to follow
//!   the cursor, which made the card drift while the user was reading it.
//! - Captures are one-shot (triggered by a global hotkey), not a polling loop:
//!   the OCR pass costs ~1s of CPU and 800MB of RAM on the Python side, so
//!   running it 20x/second was wasteful and jittery.
//! - The capture geometry is the upstream `DEFAULT_REGION`, scaled by the
//!   primary monitor width, because EFT scales its hover tooltip with the
//!   display resolution.

use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use serde::{Deserialize, Serialize};
use device_query::{DeviceQuery, DeviceState};
use tauri::AppHandle;

static OVERLAY_ENABLED: AtomicBool = AtomicBool::new(false);
static OVERLAY_PID: AtomicU32 = AtomicU32::new(0);

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct OverlayConfig {
    pub enabled: bool,
    pub opacity: f64,
    pub update_interval_ms: u64,
    pub ocr_cooldown_ms: u64,
    pub game_mode: String,
    pub cursor_offset_x: i32,
    pub cursor_offset_y: i32,
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct OverlayState {
    pub active: bool,
    pub enabled: bool,
    pub opacity: f64,
    pub running: bool,
    pub pid: Option<u32>,
}

/// Does the sidecar answer on its port right now?
fn sidecar_healthy() -> bool {
    reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_millis(600))
        .build()
        .ok()
        .and_then(|c| c.get("http://127.0.0.1:8765/health").send().ok())
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

/// Start the overlay - delegates blocking work to a thread pool
pub async fn start_overlay(config: OverlayConfig) -> Result<(), String> {
    println!("[overlay] start_overlay: enabled={}, opacity={}", config.enabled, config.opacity);
    OVERLAY_ENABLED.store(config.enabled, Ordering::SeqCst);

    if !config.enabled {
        return Ok(());
    }

    let result = tauri::async_runtime::spawn_blocking(move || spawn_sidecar(config)).await;

    match result {
        Ok(inner) => inner,
        Err(join_err) => {
            let msg = format!("Spawn task panicked: {:?}", join_err);
            eprintln!("[overlay] {}", msg);
            Err(msg)
        }
    }
}

/// Make sure a usable sidecar is listening on 127.0.0.1:8765.
///
/// A stale PID (the process was killed by a previous run, a crash, or a
/// Task Manager swipe) used to leave the app convinced the sidecar was up while
/// nothing answered on the port. We now probe /health first and respawn when it
/// is silent.
fn spawn_sidecar(_config: OverlayConfig) -> Result<(), String> {
    use std::process::Command;

    if sidecar_healthy() {
        println!("[overlay] sidecar already answering on :8765");
        return Ok(());
    }

    // Dead or missing: forget any stale bookkeeping before respawning.
    OVERLAY_PID.store(0, Ordering::SeqCst);

    let exe_dir = std::env::current_exe().map_err(|e| e.to_string())?;
    let internal_dir = exe_dir.parent().map(|p| p.join("_internal")).unwrap_or_default();
    std::fs::create_dir_all(&internal_dir).map_err(|e| e.to_string())?;
    let sidecar_path = internal_dir.join("tarkov-server.exe");

    if !sidecar_path.exists() {
        println!("[overlay] Sidecar not found at {}. Attempting download...", sidecar_path.display());
        download_latest_sidecar()?;
    }

    if !sidecar_path.exists() {
        return Err("Failed to obtain sidecar after download attempt".to_string());
    }

    println!("[overlay] Starting sidecar process...");
    // Stdio::null (not piped) so the child doesn't inherit our stdout and can
    // outlive this function without a pipe-buffer deadlock. We track the PID so
    // stop_overlay() can kill it via taskkill.
    match Command::new(&sidecar_path)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
    {
        Ok(child) => {
            let pid = child.id();
            OVERLAY_PID.store(pid, Ordering::SeqCst);
            println!("[overlay] Sidecar started with ID {}", pid);
            // Detach: forget the Child handle so it isn't killed when the
            // scoped guard drops. It lives until stop_overlay() kills it or the
            // parent exits.
            std::mem::forget(child);
            Ok(())
        }
        Err(e) => {
            eprintln!("[overlay] Failed to start sidecar: {}", e);
            Err(e.to_string())
        }
    }
}

/// Anchor of the overlay window: fixed in the top-left corner of the screen.
pub const OVERLAY_ANCHOR: (i32, i32) = (16, 16);

/// Position the overlay window at the given screen coordinates.
pub fn position_overlay(app: &AppHandle, x: i32, y: i32) -> Result<(), String> {
    use tauri::Manager;
    if let Some(window) = app.get_webview_window("overlay") {
        let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
    }
    Ok(())
}

/// Show the overlay window at the fixed anchor, without stealing focus and
/// without swallowing mouse clicks.
pub fn show_overlay_window(app: &AppHandle) -> Result<(), String> {
    use tauri::Manager;
    let window = app
        .get_webview_window("overlay")
        .ok_or_else(|| "overlay window not found".to_string())?;
    let _ = position_overlay(app, OVERLAY_ANCHOR.0, OVERLAY_ANCHOR.1);
    reveal_overlay_no_activate(&window);
    Ok(())
}

/// Vraie visibilité du HWND. `WebviewWindow::is_visible()` reflète l'état
/// interne de tao, qui se désynchronise dès qu'on touche au HWND via Win32
/// (SW_HIDE / SW_SHOWNOACTIVATE) — d'où des « hidden » qui laissent la fenêtre
/// à l'écran et des cartes coupées parce qu'un resize était sauté à tort.
#[cfg(windows)]
fn hwnd_visible(window: &tauri::WebviewWindow) -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::IsWindowVisible;
    match window.hwnd() {
        Ok(h) => unsafe { IsWindowVisible(h.0 as _) != 0 },
        Err(_) => window.is_visible().unwrap_or(false),
    }
}

#[cfg(not(windows))]
fn hwnd_visible(window: &tauri::WebviewWindow) -> bool {
    window.is_visible().unwrap_or(false)
}

/// Hide the overlay window. The sidecar keeps running so the next capture is
/// instant — this only controls the *display*.
pub fn hide_overlay_window(app: &AppHandle) -> Result<(), String> {
    use tauri::Manager;
    if let Some(window) = app.get_webview_window("overlay") {
        let _ = window.hide();
        // Ceinture et bretelles : sur cette build WebView2, hide() met à jour
        // l'état interne de tao sans masquer le HWND (fenêtre vide laissée à
        // l'écran). ShowWindow Win32 est autoritaire.
        #[cfg(windows)]
        {
            use windows_sys::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_HIDE};
            if let Ok(hwnd) = window.hwnd() {
                unsafe {
                    ShowWindow(hwnd.0 as _, SW_HIDE);
                }
            }
        }
    }
    Ok(())
}

/// Toggle the overlay window display. Returns the new visibility.
pub fn toggle_overlay_window(app: &AppHandle) -> Result<bool, String> {
    use tauri::Manager;
    let window = app
        .get_webview_window("overlay")
        .ok_or_else(|| "overlay window not found".to_string())?;
    // Décision sur la visibilité RÉELLE du HWND, pas sur l'état interne de tao.
    if hwnd_visible(&window) {
        hide_overlay_window(app)?;
        println!("[overlay] hidden by hotkey");
        Ok(false)
    } else {
        show_overlay_window(app)?;
        println!("[overlay] shown by hotkey");
        Ok(true)
    }
}

/// True when the foreground window belongs to EscapeFromTarkov.exe.
///
/// OCR only runs while the game is in front: capturing the desktop would feed
/// the recogniser item names out of editors, browsers and this very tracker.
#[cfg(windows)]
pub fn is_tarkov_foreground() -> bool {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowThreadProcessId,
    };

    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_null() {
            return false;
        }
        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if pid == 0 {
            return false;
        }
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if handle.is_null() {
            return false;
        }
        let mut buf = [0u16; 512];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(handle, 0, buf.as_mut_ptr(), &mut len);
        CloseHandle(handle);
        if ok == 0 {
            return false;
        }
        let path = String::from_utf16_lossy(&buf[..len as usize]);
        path.to_ascii_lowercase().ends_with("escapefromtarkov.exe")
    }
}

#[cfg(not(windows))]
pub fn is_tarkov_foreground() -> bool {
    true
}

/// Width of the primary monitor in physical pixels. EFT's hover tooltip grows
/// with the display resolution, so the 1920-era capture defaults are too small
/// on 1440p/4K and the OCR ends up reading a truncated name.
#[cfg(windows)]
pub fn primary_monitor_width() -> i32 {
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CXSCREEN};
    let w = unsafe { GetSystemMetrics(SM_CXSCREEN) };
    if w > 0 {
        w
    } else {
        1920
    }
}

#[cfg(not(windows))]
pub fn primary_monitor_width() -> i32 {
    1920
}

/// Geometry of the capture box, ported from pado8's `DEFAULT_REGION` so we read
/// the same pixels the upstream overlay reads. Offsets are relative to the
/// cursor; the scale follows the primary monitor width (1.0 at 1920, 1.33 at
/// 2560, 2.0 at 4K) because the tooltip itself scales with the resolution.
#[derive(Clone, Copy, Debug)]
pub struct CaptureRegion {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    pub ground_x: i32,
    pub ground_y: i32,
    pub ground_width: i32,
    pub ground_height: i32,
    pub mirror_x: i32,
}

impl CaptureRegion {
    /// Base offsets/sizes at 1920px. Tuned for EFT's inventory tooltip:
    /// the tooltip opens ABOVE and to the RIGHT of the cursor.
    const OFFSET_X: f64 = 15.0;
    const OFFSET_Y: f64 = -85.0;
    const WIDTH: f64 = 360.0;
    const HEIGHT: f64 = 100.0;
    const GROUND_OFFSET_X: f64 = -80.0;
    const GROUND_OFFSET_Y: f64 = 30.0;
    const GROUND_WIDTH: f64 = 160.0;
    const GROUND_HEIGHT: f64 = 30.0;

    /// Build the capture boxes for a cursor position.
    pub fn at(cursor_x: i32, cursor_y: i32) -> Self {
        let scale = (primary_monitor_width() as f64 / 1920.0).max(1.0);
        let r = |v: f64| (v * scale).round() as i32;
        let offset_x = r(Self::OFFSET_X);
        let width = r(Self::WIDTH);
        CaptureRegion {
            // EFT opens the item tooltip slightly above and to the right of the
            // cursor — that is the box worth reading first.
            x: cursor_x + offset_x,
            y: cursor_y + r(Self::OFFSET_Y),
            width,
            height: r(Self::HEIGHT),
            // The tooltip can also open on the left of the cursor; the sidecar
            // falls back to this mirrored box when the primary read is junk.
            mirror_x: cursor_x - offset_x - width,
            // Dropped items in a raid draw a small label below the crosshair.
            ground_x: cursor_x + r(Self::GROUND_OFFSET_X),
            ground_y: cursor_y + r(Self::GROUND_OFFSET_Y),
            ground_width: r(Self::GROUND_WIDTH),
            ground_height: r(Self::GROUND_HEIGHT),
        }
    }
}

static LOOKUP_SEQ: AtomicU64 = AtomicU64::new(0);

/// Client HTTP partagé : en construire un à chaque capture coûtait une
/// initialisation TLS à chaque F2 alors que le sidecar est en localhost.
static LOOKUP_CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();

fn lookup_client() -> Result<&'static reqwest::Client, String> {
    if let Some(c) = LOOKUP_CLIENT.get() {
        return Ok(c);
    }
    let c = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(25))
        .build()
        .map_err(|e| format!("client HTTP : {e}"))?;
    let _ = LOOKUP_CLIENT.set(c);
    LOOKUP_CLIENT
        .get()
        .ok_or_else(|| "client HTTP indisponible".to_string())
}

/// One-shot capture + OCR + price lookup, handed to the Python sidecar.
///
/// `lang` must be the *game* language: the OCR matches the recognised text
/// against the tarkov.dev catalog in that language. `game_mode` uses the
/// sidecar's own vocabulary — "regular" or "pve".
pub async fn lookup_once(lang: &str, game_mode: &str) -> Result<serde_json::Value, String> {
    let (cx, cy) = get_cursor_position();
    let region = CaptureRegion::at(cx, cy);
    let seq = LOOKUP_SEQ.fetch_add(1, Ordering::SeqCst) + 1;

    let body = serde_json::json!({
        "x": region.x,
        "y": region.y,
        "width": region.width,
        "height": region.height,
        "lang": lang,
        "game_mode": game_mode,
        "mirror_x": region.mirror_x,
        "cursor_x": cx,
        "cursor_y": cy,
        "ground_x": region.ground_x,
        "ground_y": region.ground_y,
        "ground_width": region.ground_width,
        "ground_height": region.ground_height,
        "client_seq": seq,
    });

    println!(
        "[overlay] lookup #{seq} cursor=({cx},{cy}) box=({},{},{},{}) ground=({},{},{},{}) lang={lang} mode={game_mode}",
        region.x, region.y, region.width, region.height,
        region.ground_x, region.ground_y, region.ground_width, region.ground_height
    );

    let client = lookup_client()?;

    let response = client
        .post("http://127.0.0.1:8765/lookup")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("sidecar injoignable : {e}"))?;

    if !response.status().is_success() {
        return Err(format!("le sidecar a répondu {}", response.status()));
    }

    response
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("réponse illisible : {e}"))
}

/// Download the latest release of tarkov-server from GitHub
pub fn download_latest_sidecar() -> Result<(), String> {
    use std::io::Write;

    println!("[overlay] Fetching latest release info...");

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let release_json: serde_json::Value = client
        .get("https://api.github.com/repos/pado8/tarkov-price-overlay-releases/releases/latest")
        .header("User-Agent", "Tarkov-Tracker")
        .header("Accept", "application/vnd.github.v3+json")
        .send()
        .map_err(|e| format!("Failed to fetch release info: {}", e))?
        .json()
        .map_err(|e| format!("Failed to parse release info: {}", e))?;

    let release_tag = release_json["tag_name"].as_str().unwrap_or("unknown");
    println!("[overlay] Found release tag: {}", release_tag);

    let assets = if let Some(arr) = release_json["assets"].as_array() {
        arr
    } else {
        return Err("No assets found in release".to_string());
    };

    println!("[overlay] Found {} assets in release", assets.len());

    // Find the portable zip asset
    let download_url = match assets.iter().find(|a| {
        let name = a["name"].as_str().unwrap_or("");
        name.contains("portable") && name.ends_with(".zip")
    }) {
        Some(a) => {
            let name = a["name"].as_str().unwrap_or("");
            let url = a["browser_download_url"].as_str().unwrap_or("");
            let size = a["size"].as_u64().unwrap_or(0);
            println!("[overlay] Found portable asset: {} ({} bytes)", name, size);
            url.to_string()
        }
        None => {
            for a in assets.iter().take(10) {
                println!("[overlay] Asset: {}", a["name"].as_str().unwrap_or("unknown"));
            }
            return Err("No portable zip asset found in latest release".to_string());
        }
    };

    let temp_dir = std::env::temp_dir().join("tarkov-overlay-download");
    std::fs::create_dir_all(&temp_dir).map_err(|e| format!("Failed to create temp dir: {}", e))?;
    let zip_path = temp_dir.join("overlay.zip");

    println!("[overlay] Starting download from: {}", download_url);

    let response = client
        .get(&download_url)
        .header("User-Agent", "Tarkov-Tracker")
        .send()
        .map_err(|e| format!("Failed to start download: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Download failed with status: {}", response.status()));
    }

    println!("[overlay] Download started...");
    let content = response.bytes().map_err(|e| format!("Failed to read asset content: {}", e))?;
    println!("[overlay] Download complete, size: {} bytes", content.len());

    let mut file = std::fs::File::create(&zip_path).map_err(|e| format!("Failed to create temp file: {}", e))?;
    file.write_all(&content).map_err(|e| format!("Failed to write content: {}", e))?;
    file.flush().map_err(|e| format!("Failed to flush file: {}", e))?;
    drop(file);

    let exe_dir = std::env::current_exe().map_err(|e| e.to_string())?;
    let internal_dir = exe_dir.parent().unwrap().join("_internal");
    std::fs::create_dir_all(&internal_dir).map_err(|e| e.to_string())?;
    let sidecar_path = internal_dir.join("tarkov-server.exe");

    // Extract zip archive using PowerShell
    println!("[overlay] Extracting archive with PowerShell...");
    use std::process::Command;
    let extract_dir = temp_dir.join("extracted");
    std::fs::create_dir_all(&extract_dir).ok();

    let ps_result = Command::new("powershell")
        .args(&["-Command", &format!("Expand-Archive -Path '{}' -DestinationPath '{}' -Force", zip_path.display(), extract_dir.display())])
        .output()
        .map_err(|e| format!("Failed to run PowerShell extract: {}", e))?;

    if !ps_result.status.success() {
        let stderr = String::from_utf8_lossy(&ps_result.stderr);
        return Err(format!("PowerShell extraction failed: {}", stderr));
    }

    println!("[overlay] Extraction complete");

    // Find tarkov-server.exe in the extracted directory
    let found = find_sidecar_exe(&extract_dir);
    if let Some(exe_path) = found {
        println!("[overlay] Found sidecar at: {}", exe_path.display());
        std::fs::copy(&exe_path, &sidecar_path).map_err(|e| format!("Failed to copy sidecar: {}", e))?;
        
        // Copy the _internal folder if it exists alongside the exe
        let exe_parent = exe_path.parent().unwrap_or(&extract_dir);
        let source_internal = exe_parent.join("_internal");
        if source_internal.exists() {
            println!("[overlay] Found _internal folder, copying...");
            let dest_internal = internal_dir.join("_internal");
            if dest_internal.exists() {
                std::fs::remove_dir_all(&dest_internal).ok();
            }
            copy_dir_recursive(&source_internal, &dest_internal)
                .map_err(|e| format!("Failed to copy _internal folder: {}", e))?;
            println!("[overlay] Copied _internal folder to: {}", dest_internal.display());
        }
    } else {
        println!("[overlay] Could not find tarkov-server.exe in archive. Listing contents:");
        list_dir_recursive(&extract_dir, 0, 20);
        return Err("tarkov-server.exe not found in extracted archive".to_string());
    }

    std::fs::remove_dir_all(&temp_dir).ok();

    println!("[overlay] Sidecar ready at: {}", sidecar_path.display());
    Ok(())
}

/// Find the sidecar executable in a directory tree
fn find_sidecar_exe(dir: &std::path::Path) -> Option<std::path::PathBuf> {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if let Some(found) = find_sidecar_exe(&path) {
                    return Some(found);
                }
            } else if path.file_stem().and_then(|s| s.to_str()) == Some("tarkov-server") && path.extension().and_then(|e| e.to_str()) == Some("exe") {
                return Some(path);
            }
        }
    }
    None
}

/// Copy a directory tree recursively
fn copy_dir_recursive(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let path = entry.path();
        let dest = dst.join(entry.file_name());
        if path.is_dir() {
            copy_dir_recursive(&path, &dest)?;
        } else {
            std::fs::copy(&path, &dest)?;
        }
    }
    Ok(())
}

/// List directory contents for debugging
fn list_dir_recursive(dir: &std::path::Path, depth: usize, max: usize) {
    if depth > max { return; }
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                println!("[overlay] {}", path.file_name().unwrap().to_string_lossy());
                list_dir_recursive(&path, depth + 1, max);
            } else {
                println!("[overlay] {}", path.file_name().unwrap().to_string_lossy());
            }
        }
    }
}

/// Stop the sidecar. Kills by tracked PID, and by image name as a safety net:
/// a stale PID (sidecar killed by a crash or Task Manager) used to leave the
/// app convinced the process was still alive.
pub fn stop_overlay() -> Result<(), String> {
    use std::process::Command;

    let pid = OVERLAY_PID.load(Ordering::SeqCst);
    if pid > 0 {
        let _ = Command::new("taskkill")
            .args(["/PID", pid.to_string().as_str(), "/F"])
            .output();
        OVERLAY_PID.store(0, Ordering::SeqCst);
        println!("[overlay] Sidecar stopped (PID {})", pid);
    } else {
        let _ = Command::new("taskkill")
            .args(["/IM", "tarkov-server.exe", "/F"])
            .output();
    }
    OVERLAY_ENABLED.store(false, Ordering::SeqCst);
    println!("[overlay] Stopped");
    Ok(())
}

/// Get the current overlay state
pub fn get_overlay_state() -> OverlayState {
    let pid = OVERLAY_PID.load(Ordering::SeqCst);
    OverlayState {
        active: OVERLAY_ENABLED.load(Ordering::SeqCst),
        enabled: OVERLAY_ENABLED.load(Ordering::SeqCst),
        opacity: 0.92,
        running: pid > 0,
        pid: if pid > 0 { Some(pid) } else { None },
    }
}

/// Set overlay configuration
pub async fn set_overlay_config(enabled: bool, opacity: f64) -> Result<(), String> {
    let config = OverlayConfig {
        enabled,
        opacity,
        ..Default::default()
    };
    start_overlay(config).await
}

/// Toggle the whole feature on/off: sidecar process + window visibility.
/// Turning it off also frees the ~800MB the Python sidecar holds.
pub async fn toggle_overlay(app: &AppHandle, enabled: bool) -> Result<(), String> {
    if enabled {
        let config = OverlayConfig {
            enabled: true,
            ..Default::default()
        };
        start_overlay(config).await?;
        show_overlay_window(app)?;
    } else {
        hide_overlay_window(app)?;
        stop_overlay()?;
    }
    Ok(())
}

/// Show a window WITHOUT activating it (ESC/Tab keep going to the game) and
/// with click-through enabled (the card never eats a click meant for the
/// inventory underneath).
///
/// Deliberately minimal on Windows. The transparency comes from
/// `transparent: true` + `shadow: false` in tauri.conf.json, a transparent page
/// background and Tauri's own webview setup. Poking extra extended styles
/// (WS_EX_LAYERED / SWP_FRAMECHANGED) from here is exactly what used to leave
/// an opaque grey rectangle behind the card.
pub fn reveal_overlay_no_activate(window: &tauri::WebviewWindow) {
    use tauri::window::Color;
    // Click-through: pointer events fall to whatever is under the card.
    let _ = window.set_ignore_cursor_events(true);
    // Stop WebView2 from painting its default opaque backing. This is the call
    // that turns the grey rectangle around the card transparent. Color = (r,g,b,a).
    let _ = window.set_background_color(Some(Color(0, 0, 0, 0)));
    let _ = window.set_decorations(false);
    let _ = window.set_skip_taskbar(true);
    let _ = window.set_always_on_top(true);

    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_SHOWNOACTIVATE};
        match window.hwnd() {
            Ok(hwnd) => unsafe {
                ShowWindow(hwnd.0 as _, SW_SHOWNOACTIVATE);
            },
            Err(_) => {
                let _ = window.show();
            }
        }
    }
    #[cfg(not(windows))]
    let _ = window.show();
}

/// Resize the overlay window so it hugs the card exactly.
///
/// Even if the platform still paints an opaque backing behind the webview, the
/// user only ever sees the card because the window *is* the card. The window is
/// re-anchored to the top-left corner after every resize.
pub fn resize_overlay_window(app: &AppHandle, width: f64, height: f64) -> Result<(), String> {
    use tauri::{LogicalSize, Manager};
    let window = app
        .get_webview_window("overlay")
        .ok_or_else(|| "overlay window not found".to_string())?;
    // Ne jamais redimensionner une fenêtre cachée : sur Windows, set_size peut
    // la réafficher, ce qui laissait un rectangle vide après l'auto-masquage.
    if !hwnd_visible(&window) {
        return Ok(());
    }
    let w = width.clamp(120.0, 1200.0);
    let h = height.clamp(60.0, 1600.0);
    window
        .set_size(LogicalSize::new(w, h))
        .map_err(|e| e.to_string())?;
    let _ = position_overlay(app, OVERLAY_ANCHOR.0, OVERLAY_ANCHOR.1);
    Ok(())
}

/// Get cursor position
pub fn get_cursor_position() -> (i32, i32) {
    let device_state = DeviceState::new();
    let mouse = device_state.get_mouse();
    (mouse.coords.0, mouse.coords.1)
}

/// Cleanup function called on app exit
pub fn cleanup() {
    stop_overlay().ok();
}
