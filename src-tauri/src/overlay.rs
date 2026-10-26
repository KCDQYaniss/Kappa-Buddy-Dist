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
use std::sync::Mutex;
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
#[cfg(windows)]
fn spawn_sidecar(_config: OverlayConfig) -> Result<(), String> {
    use std::process::Command;
    use std::os::windows::process::CommandExt;
    use windows_sys::Win32::System::Threading::CREATE_NO_WINDOW;

    if sidecar_healthy() {
        println!("[overlay] sidecar already answering on :8765");
        return Ok(());
    }

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
    match Command::new(&sidecar_path)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
    {
        Ok(child) => {
            let pid = child.id();
            OVERLAY_PID.store(pid, Ordering::SeqCst);
            println!("[overlay] Sidecar started with ID {}", pid);
            std::mem::forget(child);
            Ok(())
        }
        Err(e) => {
            eprintln!("[overlay] Failed to start sidecar: {}", e);
            Err(e.to_string())
        }
    }
}

#[cfg(not(windows))]
fn spawn_sidecar(_config: OverlayConfig) -> Result<(), String> {
    use std::process::Command;

    if sidecar_healthy() {
        println!("[overlay] sidecar already answering on :8765");
        return Ok(());
    }

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
    match Command::new(&sidecar_path)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
    {
        Ok(child) => {
            let pid = child.id();
            OVERLAY_PID.store(pid, Ordering::SeqCst);
            println!("[overlay] Sidecar started with ID {}", pid);
            std::mem::forget(child);
            Ok(())
        }
        Err(e) => {
            eprintln!("[overlay] Failed to start sidecar: {}", e);
            Err(e.to_string())
        }
    }
}

/// Historical anchor of the overlay window (top-left corner, 16/16 physical
/// px) — kept byte-for-byte: this is the user-validated position. The other
/// corners derive from the chosen anchor setting.
pub const OVERLAY_ANCHOR: (i32, i32) = (16, 16);
static OVERLAY_ANCHOR_MODE: Mutex<String> = Mutex::new(String::new());

/// Remember the card corner chosen in the settings ("TL"|"TR"|"BL"|"BR").
pub fn set_overlay_anchor(anchor: &str) {
    let a = anchor.trim().to_ascii_uppercase();
    *OVERLAY_ANCHOR_MODE.lock().unwrap() = if matches!(a.as_str(), "TL" | "TR" | "BL" | "BR") {
        a
    } else {
        "TL".to_string()
    };
}

/// Top-left screen position (physical px) for a window of `w_phys × h_phys` on
/// a monitor at `(mx, my, mw, mh)`. "TL" reproduces the historical constant
/// `OVERLAY_ANCHOR` exactly (16/16 physical, resolution-independent) so the
/// user-validated default cannot drift; other corners use a DPI-scaled margin.
/// Pure — unit-tested.
pub(crate) fn anchor_xy(anchor: &str, mon: (i32, i32, i32, i32), scale: f64, w_phys: i32, h_phys: i32) -> (i32, i32) {
    let (mx, my, mw, mh) = mon;
    let margin = {
        let m = if anchor == "TL" { 16.0_f64 } else { 16.0 * scale.max(0.1) };
        m.round() as i32
    };
    let left = mx + margin;
    let top = my + margin;
    match anchor {
        "TR" => ((mx + mw - w_phys - margin).max(left), top),
        "BL" => (left, (my + mh - h_phys - margin).max(top)),
        "BR" => ((mx + mw - w_phys - margin).max(left), (my + mh - h_phys - margin).max(top)),
        // "TL" and anything unexpected: historical position, relative to the
        // monitor currently carrying the cursor (primary = unchanged values).
        _ => (mx + OVERLAY_ANCHOR.0, my + OVERLAY_ANCHOR.1),
    }
}

/// The monitor under the cursor (that is where the game runs); falls back to
/// the window's current monitor, then the primary one.
fn pick_monitor(window: &tauri::WebviewWindow) -> Option<tauri::Monitor> {
    let cursor = get_cursor_position();
    let all = window.available_monitors().ok()?;
    for m in &all {
        let pos = m.position();
        let size = m.size();
        let (mx, my) = (pos.x, pos.y);
        if cursor.0 >= mx && cursor.0 < mx + size.width as i32
            && cursor.1 >= my && cursor.1 < my + size.height as i32
        {
            return Some(m.clone());
        }
    }
    window.current_monitor().ok().flatten().or_else(|| all.first().cloned())
}

/// Position the overlay window at the anchor chosen in the settings, on the
/// monitor under the cursor. `w_logical/h_logical` are the card pixel size in
/// logical units (as emitted by the webview); omitted only when the window has
/// not been sized yet.
pub fn position_overlay_by_anchor(app: &AppHandle, w_logical: Option<f64>, h_logical: Option<f64>) -> Result<(), String> {
    use tauri::{Manager, PhysicalPosition};
    let window = app
        .get_webview_window("overlay")
        .ok_or_else(|| "overlay window not found".to_string())?;
    let (lw, lh) = match (w_logical, h_logical) {
        (Some(w), Some(h)) => (w, h),
        _ => {
            // Fall back to the current physical size converted with the monitor scale.
            let mon = pick_monitor(&window);
            let sf = mon.as_ref().map(|m| m.scale_factor()).unwrap_or(1.0);
            let phys = window.inner_size().unwrap_or_default();
            ((phys.width as f64 / sf), (phys.height as f64 / sf))
        }
    };
    let anchor = OVERLAY_ANCHOR_MODE.lock().unwrap().clone();
    let (x, y) = match pick_monitor(&window) {
        Some(mon) => {
            let sf = mon.scale_factor();
            let pos = mon.position();
            let size = mon.size();
            anchor_xy(
                &anchor,
                (pos.x, pos.y, size.width as i32, size.height as i32),
                sf,
                (lw * sf).round() as i32,
                (lh * sf).round() as i32,
            )
        }
        None => (OVERLAY_ANCHOR.0, OVERLAY_ANCHOR.1),
    };
    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Show the overlay window at the configured anchor, without stealing focus and
/// without swallowing mouse clicks.
pub fn show_overlay_window(app: &AppHandle) -> Result<(), String> {
    use tauri::Manager;
    let window = app
        .get_webview_window("overlay")
        .ok_or_else(|| "overlay window not found".to_string())?;
    let _ = position_overlay_by_anchor(app, None, None);
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

/// Bounds (left, top, width, height) of the monitor that carries the cursor,
/// in physical pixels. The capture conditions (mirror near the right edge,
/// ground near the centre) are evaluated on the gaming monitor — which is not
/// necessarily the primary one on multi-monitor setups.
#[cfg(windows)]
pub fn cursor_monitor_bounds() -> (i32, i32, i32, i32) {
    use windows_sys::Win32::Foundation::POINT;
    use windows_sys::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromPoint, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };
    let (cx, cy) = get_cursor_position();
    let pt = POINT { x: cx, y: cy };
    unsafe {
        let mon = MonitorFromPoint(pt, MONITOR_DEFAULTTONEAREST);
        if mon.is_null() {
            return (0, 0, primary_monitor_width(), 1080);
        }
        let mut info: MONITORINFO = std::mem::zeroed();
        info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
        if GetMonitorInfoW(mon, &mut info) != 0 {
            let rc = info.rcMonitor;
            (rc.left, rc.top, rc.right - rc.left, rc.bottom - rc.top)
        } else {
            (0, 0, primary_monitor_width(), 1080)
        }
    }
}

#[cfg(not(windows))]
pub fn cursor_monitor_bounds() -> (i32, i32, i32, i32) {
    (0, 0, primary_monitor_width(), 1080)
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
    /// Mirrored box (same size, left of the cursor), sent ONLY when the
    /// primary box would overflow the cursor monitor's right edge — the case
    /// where EFT flips the tooltip to the LEFT of the cursor. Sent mid-screen
    /// it only ever reads neighbour captions and surfaces wrong items.
    pub mirror_x: Option<i32>,
    /// Ground-item label box (small strip under the crosshair). Deterministic
    /// geometry; whether it is SENT is decided at capture time by the raid
    /// gate (cursor hidden) — see `is_cursor_hidden`.
    pub ground: GroundBox,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct GroundBox {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

impl CaptureRegion {
    /// Base offsets/sizes at 1920px. Tuned for EFT's inventory tooltip:
    /// the tooltip opens ABOVE and to the RIGHT of the cursor.
    // MODIFICATION v0.9.9: bottom-left QUARTER of the previous 250x80 box —
    // same bottom-left anchor (cursor + 13, cursor - 13), half width, half
    // height. Top-left origin is therefore (cursor + 13, cursor - 53).
    const OFFSET_X: f64 = 13.0;
    const OFFSET_Y: f64 = -53.0;
    const WIDTH: f64 = 125.0;
    const HEIGHT: f64 = 40.0;
    const GROUND_OFFSET_X: f64 = -80.0;
    const GROUND_OFFSET_Y: f64 = 30.0;
    const GROUND_WIDTH: f64 = 160.0;
    const GROUND_HEIGHT: f64 = 30.0;

    /// Pure builder for the capture boxes at a given resolution scale — the
    /// unit-testable core. `at` plugs the live cursor monitor into it.
    /// `monitor` is the cursor monitor as (left, top, width, height) physical
    /// pixels; the mirror condition is evaluated against its right edge.
    pub fn scaled(scale: f64, cursor_x: i32, cursor_y: i32, monitor: (i32, i32, i32, i32)) -> Self {
        let r = |v: f64| (v * scale).round() as i32;
        let offset_x = r(Self::OFFSET_X);
        let width = r(Self::WIDTH);
        let (mon_left, _mon_top, mon_w, _) = monitor;
        // The tooltip flips to the left of the cursor only when there is no
        // room right of it; that is the only case worth reading the mirrored
        // box (a margin beyond the primary's right edge).
        let primary_right = cursor_x + offset_x + width;
        let mirror_x = if primary_right >= mon_left + mon_w - 48 {
            Some(cursor_x - offset_x - width)
        } else {
            None
        };
        CaptureRegion {
            // EFT opens the item tooltip slightly above and to the right of the
            // cursor — that is the box worth reading first.
            x: cursor_x + offset_x,
            y: cursor_y + r(Self::OFFSET_Y),
            width,
            height: r(Self::HEIGHT),
            mirror_x,
            // Dropped items in a raid draw a small label below the crosshair.
            ground: GroundBox {
                x: cursor_x + r(Self::GROUND_OFFSET_X),
                y: cursor_y + r(Self::GROUND_OFFSET_Y),
                width: r(Self::GROUND_WIDTH),
                height: r(Self::GROUND_HEIGHT),
            },
        }
    }

    /// Build the capture boxes for a cursor position on its actual monitor.
    pub fn at(cursor_x: i32, cursor_y: i32) -> Self {
        let scale = (primary_monitor_width() as f64 / 1920.0).max(1.0);
        Self::scaled(scale, cursor_x, cursor_y, cursor_monitor_bounds())
    }
}

/// Is the OS cursor currently hidden? EFT's raw-input raid loop hides it
/// (ShowCursor(FALSE)), while stash/flea/trader menus show a normal pointer.
/// The ground box (used for floor-item labels) is therefore worth trying only
/// when the pointer is gone: in menus that box is just a strip of neighbour
/// captions around the tooltip, which surfaces wrong items. Called only when
/// Tarkov is the foreground window, so idle-hide quirks of other apps don't
/// matter here. Probe failure returns false (skip the box) — a lost raid
/// ground read is cheaper than a wrong menu read.
#[cfg(windows)]
pub fn is_cursor_hidden() -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetCursorInfo, CURSORINFO, CURSOR_SHOWING,
    };
    unsafe {
        let mut ci: CURSORINFO = std::mem::zeroed();
        ci.cbSize = std::mem::size_of::<CURSORINFO>() as u32;
        if GetCursorInfo(&mut ci) != 0 {
            ci.flags & CURSOR_SHOWING == 0
        } else {
            false
        }
    }
}

#[cfg(not(windows))]
pub fn is_cursor_hidden() -> bool {
    false
}

static LOOKUP_SEQ: AtomicU64 = AtomicU64::new(0);

/// Base client_seq de ce processus. Le sidecar garde en mémoire le plus grand
/// client_seq qu'il a vu et rejette toute capture séquentielle inférieure (la
/// nouvelle pression doit toujours gagner). Ce compteur vit dans le processus
/// sidecar, qui survit aux redémarrages et mises à jour de l'app : si la base
/// était 0 à chaque démarrage, TOUTES les captures de la session seraient
/// rejetées (« superseded », carte « Objet non reconnu », réponse 200 vide).
/// On survit en partant de l'heure epoch en ms — toujours supérieure à celle
/// de toute session précédente, sans coordination avec le sidecar (lecture
/// seule). Deux instances démarrées dans la même milliseconde sont
/// théoriquement confondues, cas impossible manuellement et transitoire.
pub fn next_client_seq() -> u64 {
    static BASE: std::sync::OnceLock<u64> = std::sync::OnceLock::new();
    let base = *BASE.get_or_init(|| {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(1_000_000_000_000)
    });
    base + LOOKUP_SEQ.fetch_add(1, Ordering::SeqCst) + 1
}

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
/// sidecar's own vocabulary — "regular" or "pve". `corrections` is the
/// user-maintained OCR fix table (raw read text → canonical item name); sent
/// on every lookup so one learned fix applies to all future reads. It must be
/// a JSON *object* (`dict[str, str]` for the sidecar) — sending it as a string
/// makes pydantic reject the whole request with 422.
pub async fn lookup_once(
    lang: &str,
    game_mode: &str,
    corrections: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let (cx, cy) = get_cursor_position();
    let region = CaptureRegion::at(cx, cy);
    let seq = next_client_seq();

    let body = serde_json::json!({
        "x": region.x,
        "y": region.y,
        "width": region.width,
        "height": region.height,
        "lang": lang,
        "game_mode": game_mode,
        "cursor_x": cx,
        "cursor_y": cy,
        "client_seq": seq,
    });
    let mut body = body;
    if let Some(mirror) = region.mirror_x {
        body.as_object_mut()
            .unwrap()
            .insert("mirror_x".to_string(), serde_json::json!(mirror));
    }
    let ground_sent = is_cursor_hidden();
    if let Some(ground) = ground_sent.then(|| region.ground) {
        let o = body.as_object_mut().unwrap();
        for (k, v) in [
            ("ground_x", ground.x),
            ("ground_y", ground.y),
            ("ground_width", ground.width),
            ("ground_height", ground.height),
        ] {
            o.insert(k.to_string(), serde_json::json!(v));
        }
    }
    let body = match corrections.as_ref().and_then(|v| v.as_object()) {
        Some(o) if !o.is_empty() => {
            body.as_object_mut()
                .unwrap()
                .insert("corrections".to_string(), corrections.unwrap_or_default());
            body
        }
        _ => body,
    };

    println!(
        "[overlay] lookup #{seq} cursor=({cx},{cy}) box=({},{},{},{}) mirror={} ground={} lang={lang} mode={game_mode}",
        region.x, region.y, region.width, region.height,
        region.mirror_x.map(|x| x.to_string()).unwrap_or_else(|| "off".into()),
        if ground_sent { format!("{}x{}+{}+{}", region.ground.width, region.ground.height, region.ground.x, region.ground.y) } else { "off".to_string() }
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
/// re-anchored (chosen corner, monitor under the cursor) after every resize.
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
    let _ = position_overlay_by_anchor(app, Some(w), Some(h));
    // Une fenêtre transparente rétrécie peut laisser à l'écran les pixels de la
    // frame précédente (les zones devenues transparentes ne sont pas
    // redessinées par WebView2) : l'utilisateur voyait l'ancienne carte ET la
    // nouvelle — la « double fenêtre ». Invalidier TOUT le HWND force un
    // repaint complet ; les enfants composés au-dessus sont rappelés.
    #[cfg(windows)]
    {
        use windows_sys::Win32::Graphics::Gdi::{
            RedrawWindow, RDW_ALLCHILDREN, RDW_INVALIDATE, RDW_UPDATENOW,
        };
        if let Ok(hwnd) = window.hwnd() {
            unsafe {
                RedrawWindow(
                    hwnd.0 as _,
                    std::ptr::null(),
                    std::ptr::null_mut(),
                    RDW_INVALIDATE | RDW_ALLCHILDREN | RDW_UPDATENOW,
                );
            }
        }
    }
    Ok(())
}

/// Get cursor position
pub fn get_cursor_position() -> (i32, i32) {
    let device_state = DeviceState::new();
    let mouse = device_state.get_mouse();
    (mouse.coords.0, mouse.coords.1)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// La base client_seq vaut l'heure epoch : après un redémarrage de l'app
    /// (le sidecar, process orphelin survivant aux mises à jour, garde le plus
    /// grand client_seq vu et rejette les captures séquentielles inférieures à
    /// lui), les captures de la nouvelle session doivent rester acceptées.
    #[test]
    fn client_seq_beats_any_previous_session() {
        let a = next_client_seq();
        let b = next_client_seq();
        assert!(b > a, "croissant dans la session");
        assert!(a > 999_999, "base epoch ms, pas un compteur de session : {a}");
    }

    /// La géométrie de capture VALIDÉE par l'utilisateur à 1920px est conservée
    /// telle quelle : la boîte est le quart bas-gauche de l'ancien 250x80, donc
    /// origine (curseur +13, curseur −53) et taille 125x40 ; la boîte ground
    /// (curseur −80/+30, 160×30) garde ses mesures d'origine — son ENVOI est
    /// conditionné ailleurs (curseur masqué = raid).
    #[test]
    fn capture_region_at_1920_matches_validated_geometry() {
        let r = CaptureRegion::scaled(1.0, 1000, 500, (0, 0, 1920, 1080));
        assert_eq!(r.x, 1013);
        assert_eq!(r.y, 447);
        assert_eq!(r.width, 125);
        assert_eq!(r.height, 40);
        assert_eq!(r.mirror_x, None, "milieu d'écran : pas de miroir");
        assert_eq!(r.ground.x, 920);
        assert_eq!(r.ground.y, 530);
        assert_eq!(r.ground.width, 160);
        assert_eq!(r.ground.height, 30);
    }

    /// EFT met le tooltip à l'échelle de l'écran : 1440p → ×1.333, 4K → ×2.0.
    /// Le coin haut-GAUCHE reste `curseur + OFFSET`, l'ancrage bas-gauche
    /// historique (~curseur +13, ~curseur −13) suit l'arrondi indépendant.
    #[test]
    fn capture_region_scales_with_resolution() {
        // 1440p (×1.333…) : OFFSET_X 17, size 167x53 ; curseur loin du bord
        // droit → pas de miroir.
        let hd = CaptureRegion::scaled(2560.0 / 1920.0, 1000, 500, (0, 0, 2560, 1440));
        assert_eq!(hd.x, 1017);              // 1000 + round(13×1.3333)
        assert_eq!(hd.y, 429);               // 500 − round(53×1.3333)
        assert_eq!(hd.width, 167);
        assert_eq!(hd.height, 53);
        assert_eq!(hd.mirror_x, None);

        // 4K (×2.0) : taille exactement double de la géométrie validée.
        let r = CaptureRegion::scaled(3840.0 / 1920.0, 1000, 500, (0, 0, 3840, 2160));
        assert_eq!(r.x, 1026);               // 1000 + 26
        assert_eq!(r.y, 394);                // 500 − 106
        assert_eq!(r.width, 250);
        assert_eq!(r.height, 80);
        assert_eq!(r.mirror_x, None);
        assert_eq!(r.ground.x, 840);         // 1000 − 160
        assert_eq!(r.ground.y, 560);         // 500 + 60
        assert_eq!(r.ground.width, 320);
        assert_eq!(r.ground.height, 60);
    }

    /// Le miroir (boîte à GAUCHE du curseur) n'est envoyé que quand la boîte
    /// principale déborderait du bord droit de l'écran — le seul cas où EFT
    /// inverse le tooltip vers la gauche. Milieu d'écran il ne fait que lire
    /// des légendes de voisins et remonter de faux objets.
    #[test]
    fn mirror_only_next_to_the_right_edge() {
        // 2560×1440 ; seuil : curseur + 184 ≥ 2560 − 48 → curseur ≥ 2328.
        assert_eq!(
            CaptureRegion::scaled(2560.0 / 1920.0, 1200, 700, (0, 0, 2560, 1440)).mirror_x,
            None
        );
        assert_eq!(
            CaptureRegion::scaled(2560.0 / 1920.0, 2300, 700, (0, 0, 2560, 1440)).mirror_x,
            None
        );
        let edge = CaptureRegion::scaled(2560.0 / 1920.0, 2400, 700, (0, 0, 2560, 1440));
        assert_eq!(edge.mirror_x, Some(2400 - 17 - 167));
        // Écran à origine négative (moniteur à gauche) : la condition est
        // relative aux bornes réelles de l'écran du curseur — le moniteur
        // (-1920..0) finit à x=0 : −100 est donc PRÈS du bord droit.
        let left_mon = (-1920, 156, 1920, 1080);
        assert_eq!(
            CaptureRegion::scaled(1.0, -400, 700, left_mon).mirror_x,
            None,
            "−400 : la boîte principale finit à −262, loin du bord (−48)"
        );
        assert_eq!(
            CaptureRegion::scaled(1.0, -100, 700, left_mon).mirror_x,
            Some(-238)
        );
    }

    /// « TL » reste la position historique exacte, quel que soit le DPI.
    #[test]
    fn anchor_tl_is_historical_constant() {
        let mon = (0, 0, 3840, 2160);
        assert_eq!(anchor_xy("TL", mon, 2.0, 500, 400), (16, 16));
        let sec = (-1920, -2000, 1920, 1080);
        assert_eq!(anchor_xy("TL", sec, 1.25, 500, 400), (-1920 + 16, -2000 + 16));
    }

    /// Les autres coins collent au bord droit/bas de l'écran CDN avec marge DPI.
    #[test]
    fn anchor_corners_hug_the_monitor() {
        let mon = (0, 0, 1920, 1080);
        let scale = 1.5f64;
        let (wx, wy) = anchor_xy("TR", mon, scale, 600, 400);
        assert_eq!(wx, 1920 - 600 - (16.0 * scale).round() as i32);
        assert_eq!(wy, (16.0 * scale).round() as i32);
        let (bx, by) = anchor_xy("BR", mon, scale, 600, 400);
        assert_eq!(bx, wx);
        assert_eq!(by, 1080 - 400 - (16.0 * scale).round() as i32);
        let (lx, ly) = anchor_xy("BL", mon, scale, 600, 400);
        assert_eq!(lx, (16.0 * scale).round() as i32);
        assert_eq!(ly, by);
    }

    /// Fenêtre plus grosse que l'écran margin compris : les coins ne passent
    /// pas du côté opposé (clamp au coin haut-gauche du moniteur).
    #[test]
    fn anchor_corners_never_flip_past_the_top_left() {
        let mon = (0, 0, 1000, 800);
        let (x, y) = anchor_xy("BR", mon, 1.0, 980, 780);
        assert_eq!(x, 16);
        assert_eq!(y, 16);
    }

    /// Clé invalide → TL (jamais d'invention de coin).
    #[test]
    fn unknown_anchor_falls_back_to_tl() {
        let mon = (0, 0, 1920, 1080);
        assert_eq!(anchor_xy("zz", mon, 1.0, 500, 400), (16, 16));
    }
}

/// Cleanup function called on app exit. Hides overlay window and stops sidecar.
pub fn cleanup(app: &AppHandle) {
    println!("[overlay] Cleanup: hiding overlay window and stopping sidecar");
    // D'abord cacher la fenêtre overlay
    let _ = hide_overlay_window(app);
    // Puis tuer le sidecar
    let _ = stop_overlay();
    println!("[overlay] Cleanup complete");
}
