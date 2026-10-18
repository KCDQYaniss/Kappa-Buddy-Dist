//! OCR debug tools — visual feedback for capture-geometry tuning.
//!
//! Two features, both triggered by the F3 debug hotkey (see main.rs):
//!
//! 1. **Screenshot dump**: a GDI copy of the exact rectangle sent to the
//!    sidecar (primary box + mirror + ground box) is written to
//!    `%USERPROFILE%\Documents\TarkovTracker-OCR-debug\` as BMP files. This is
//!    what the OCR actually receives, so a bad name / wrong box is immediately
//!    visible.
//! 2. **On-screen frame**: a 2.5-second red outline drawn on screen around the
//!    primary capture box. Drawn on demand (F3) — never during a real capture —
//!    so the frame itself can never pollute the OCR.

#![cfg(windows)]

use std::path::PathBuf;

use windows_sys::Win32::Foundation::{COLORREF, HWND, RECT};
use windows_sys::Win32::Graphics::Gdi::{
    BeginPaint, CreateCompatibleDC, CreateDIBSection, CreatePen, CreateSolidBrush, DeleteObject,
    EndPaint, FillRect, GetDC, GetDIBits, InvalidateRect, ReleaseDC, SelectObject, BITMAPINFO,
    BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HBRUSH, HBITMAP, HDC, HGDIOBJ, NULL_BRUSH, PS_SOLID,
    SRCCOPY,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, PeekMessageW, RegisterClassW,
    SetLayeredWindowAttributes, SetWindowPos, ShowWindow, TranslateMessage, CS_HREDRAW, CS_VREDRAW,
    HWND_TOPMOST, LWA_COLORKEY, MSG, PM_REMOVE, SW_HIDE, SW_SHOWNOACTIVATE, SWP_NOACTIVATE,
    SWP_SHOWWINDOW, WM_PAINT, WNDCLASSW, WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
    WS_EX_TRANSPARENT, WS_POPUP,
};

use crate::overlay::CaptureRegion;

/// Where the BMP dumps go. Documents is easy for the user to find.
fn debug_dir() -> Option<PathBuf> {
    let home = std::env::var("USERPROFILE").ok()?;
    let mut p = PathBuf::from(home);
    p.push("Documents");
    p.push("TarkovTracker-OCR-debug");
    std::fs::create_dir_all(&p).ok()?;
    Some(p)
}

/// Wipe the BMP dump folder. Called once at app startup: each debug frame is
/// ~100 kB and a tuning session easily produces dozens of them, so letting
/// them pile up was eating disk space for no value (the user has seen the
/// frame by then). Best effort — a locked file just survives until next run.
pub fn cleanup_debug_dir() {
    let Some(dir) = debug_dir() else { return };
    let Ok(entries) = std::fs::read_dir(&dir) else { return };
    let mut removed = 0u32;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("bmp")) == Some(true)
        {
            if std::fs::remove_file(&path).is_ok() {
                removed += 1;
            }
        }
    }
    // Also drop the preview PNGs the user may have generated.
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.eq_ignore_ascii_case("png"))
                == Some(true)
            {
                let _ = std::fs::remove_file(&path);
            }
        }
    }
    if removed > 0 {
        println!("[debug] purged {removed} old debug capture(s) from {}", dir.display());
    }
}

/// Timestamped file name so successive presses never overwrite each other.
fn stamp() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs();
    let millis = now.subsec_millis();
    // UTC, compact: YYYYmmdd-HHMMSS-mmm (civil date from days-since-epoch).
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let (h, mi, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{y:04}{m:02}{d:02}-{h:02}{mi:02}{s:02}-{millis:03}")
}

/// Copy `rect` from the screen into a bottom-up 24-bit BMP on disk.
fn save_screen_bmp(rect: (i32, i32, i32, i32), path: &PathBuf) -> Option<()> {
    let (x, y, w, h) = rect;
    if w <= 0 || h <= 0 {
        return None;
    }

    unsafe {
        let screen_dc = GetDC(std::ptr::null_mut());
        if screen_dc.is_null() {
            return None;
        }
        let mem_dc = CreateCompatibleDC(screen_dc);
        if mem_dc.is_null() {
            ReleaseDC(std::ptr::null_mut(), screen_dc);
            return None;
        }

        // 24bpp, bottom-up (classic layout any viewer opens).
        let mut bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: w,
                biHeight: h,
                biPlanes: 1,
                biBitCount: 24,
                biCompression: BI_RGB,
                biSizeImage: 0,
                biXPelsPerMeter: 0,
                biYPelsPerMeter: 0,
                biClrUsed: 0,
                biClrImportant: 0,
            },
            bmiColors: [windows_sys::Win32::Graphics::Gdi::RGBQUAD {
                rgbBlue: 0,
                rgbGreen: 0,
                rgbRed: 0,
                rgbReserved: 0,
            }; 1],
        };

        let mut bits: *mut std::ffi::c_void = std::ptr::null_mut();
        let bmp: HBITMAP = CreateDIBSection(
            mem_dc,
            &bmi,
            DIB_RGB_COLORS,
            &mut bits,
            std::ptr::null_mut(),
            0,
        );
        if bmp.is_null() || bits.is_null() {
            DeleteObject(bmp as _);
            DeleteObject(mem_dc as _);
            ReleaseDC(std::ptr::null_mut(), screen_dc);
            return None;
        }
        let old = SelectObject(mem_dc, bmp as HGDIOBJ);
        let ok = windows_sys::Win32::Graphics::Gdi::BitBlt(
            mem_dc,
            0,
            0,
            w,
            h,
            screen_dc,
            x,
            y,
            SRCCOPY,
        );

        let mut saved = false;
        if ok != 0 {
            let stride = ((w * 3 + 3) / 4) * 4;
            let data_len = (stride * h) as usize;
            let mut buf = vec![0u8; data_len];
            let got = GetDIBits(
                mem_dc,
                bmp,
                0,
                h as u32,
                buf.as_mut_ptr() as *mut std::ffi::c_void,
                &mut bmi,
                DIB_RGB_COLORS,
            );
            if got == h {
                saved = std::fs::File::create(path)
                    .ok()
                    .and_then(|mut file| write_bmp(&mut file, w, h, &buf).ok())
                    .is_some();
            }
        }

        SelectObject(mem_dc, old);
        DeleteObject(bmp as _);
        DeleteObject(mem_dc as _);
        ReleaseDC(std::ptr::null_mut(), screen_dc);
        if saved { Some(()) } else { None }
    }
}

/// Serialize a 24bpp bottom-up pixel buffer as a BMP file.
fn write_bmp(file: &mut std::fs::File, w: i32, h: i32, pixels: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let data_len = pixels.len() as u32;
    let file_size = 14u32 + 40 + data_len;
    let mut out: Vec<u8> = Vec::with_capacity(file_size as usize);
    out.extend_from_slice(b"BM");
    out.extend_from_slice(&file_size.to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes()); // reserved
    out.extend_from_slice(&54u32.to_le_bytes()); // pixel data offset
    // BITMAPINFOHEADER (40 bytes)
    out.extend_from_slice(&40u32.to_le_bytes());
    out.extend_from_slice(&w.to_le_bytes());
    out.extend_from_slice(&h.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&24u16.to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes()); // BI_RGB
    out.extend_from_slice(&data_len.to_le_bytes());
    out.extend_from_slice(&0i32.to_le_bytes());
    out.extend_from_slice(&0i32.to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes());
    out.extend_from_slice(pixels);
    file.write_all(&out)?;
    file.flush()
}

/// Show a 2.5s red outline around `rect` (screen coordinates), then destroy
/// the window. Non-blocking: the countdown runs on its own thread.
pub fn flash_capture_frame(rect: (i32, i32, i32, i32)) {
    let (x, y, w, h) = rect;
    if w <= 0 || h <= 0 {
        return;
    }
    std::thread::spawn(move || unsafe {
        let class_name: Vec<u16> = "TarkovTrackerDebugFrame\0"
            .encode_utf16()
            .collect();

        let hinstance = windows_sys::Win32::System::LibraryLoader::GetModuleHandleW(
            std::ptr::null(),
        );

        let wc = WNDCLASSW {
            style: CS_HREDRAW | CS_VREDRAW,
            lpfnWndProc: Some(frame_wnd_proc),
            cbClsExtra: 0,
            cbWndExtra: 0,
            hInstance: hinstance,
            hIcon: std::ptr::null_mut(),
            hCursor: std::ptr::null_mut(),
            hbrBackground: std::ptr::null_mut(),
            lpszMenuName: std::ptr::null(),
            lpszClassName: class_name.as_ptr(),
        };
        RegisterClassW(&wc);

        // WS_EX_LAYERED + color-key: only the red border is visible, the rest
        // of the window is fully transparent and click-through.
        // The window is 6px larger on every side; the 3px red border is drawn
        // inset so it hugs the capture box exactly.
        const PAD: i32 = 3;
        let key: COLORREF = 0x00FF00; // GDI COLORREF is 0x00BBGGRR -> pure green
        let hwnd: HWND = CreateWindowExW(
            WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW,
            class_name.as_ptr(),
            std::ptr::null(),
            WS_POPUP,
            x - PAD,
            y - PAD,
            w + 2 * PAD,
            h + 2 * PAD,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            hinstance,
            std::ptr::null(),
        );
        if hwnd.is_null() {
            return;
        }

        SetLayeredWindowAttributes(hwnd, key, 0, LWA_COLORKEY);
        let _ = SetWindowPos(
            hwnd,
            HWND_TOPMOST,
            x - PAD,
            y - PAD,
            w + 2 * PAD,
            h + 2 * PAD,
            SWP_NOACTIVATE | SWP_SHOWWINDOW,
        );
        let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);

        // Pump messages for the lifetime of the frame. Without a message pump
        // WM_PAINT is never delivered and the layered window never renders —
        // the outline would silently never appear.
        let deadline = std::time::Instant::now() + std::time::Duration::from_millis(2500);
        let mut msg = MSG {
            hwnd: std::ptr::null_mut(),
            message: 0,
            wParam: 0,
            lParam: 0,
            time: 0,
            pt: windows_sys::Win32::Foundation::POINT { x: 0, y: 0 },
        };
        while std::time::Instant::now() < deadline {
            unsafe {
                while PeekMessageW(&mut msg, hwnd, 0, 0, PM_REMOVE) != 0 {
                    let _ = TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }

        let _ = ShowWindow(hwnd, SW_HIDE);
        let _ = DestroyWindow(hwnd);
    });
}

/// Paint: fill the whole window green (invisible via color-key), then stroke
/// a 3px red rectangle inset by PAD so the outline hugs the capture box.
unsafe extern "system" fn frame_wnd_proc(hwnd: HWND, msg: u32, wp: usize, lp: isize) -> isize {
    const PAD: i32 = 3;
    match msg {
        WM_PAINT => {
            let mut ps: windows_sys::Win32::Graphics::Gdi::PAINTSTRUCT = std::mem::zeroed();
            let hdc: HDC = BeginPaint(hwnd, &mut ps);
            let rc = RECT {
                left: 0,
                top: 0,
                right: ps.rcPaint.right - ps.rcPaint.left,
                bottom: ps.rcPaint.bottom - ps.rcPaint.top,
            };

            // Green fill = invisible (color key).
            let green: HBRUSH = CreateSolidBrush(0x00FF00);
            FillRect(hdc, &rc, green);
            DeleteObject(green as _);

            // Red 3px border, inset PAD so it hugs the capture box.
            let pen = CreatePen(PS_SOLID, PAD, 0x0000FF); // COLORREF pure red
            let old_pen = SelectObject(hdc, pen as HGDIOBJ);
            let hollow = windows_sys::Win32::Graphics::Gdi::GetStockObject(NULL_BRUSH);
            let old_brush = SelectObject(hdc, hollow);
            let _ = windows_sys::Win32::Graphics::Gdi::Rectangle(
                hdc,
                PAD,
                PAD,
                rc.right - PAD,
                rc.bottom - PAD,
            );
            SelectObject(hdc, old_brush);
            SelectObject(hdc, old_pen);
            DeleteObject(pen as _);
            EndPaint(hwnd, &ps);
            0
        }
        _ => DefWindowProcW(hwnd, msg, wp, lp),
    }
}

/// Debug entry point: dump BMPs of every box sent to the sidecar and flash the
/// frame around the primary box. Returns a human-readable summary for the UI.
pub fn debug_capture(region: &CaptureRegion) -> String {
    let dir = match debug_dir() {
        Some(d) => d,
        None => return "debug: impossible de créer le dossier".into(),
    };
    let ts = stamp();
    let mut lines: Vec<String> = Vec::new();

    let boxes: [(&str, (i32, i32, i32, i32)); 3] = [
        ("principal", (region.x, region.y, region.width, region.height)),
        ("miroir", (region.mirror_x, region.y, region.width, region.height)),
        (
            "sol",
            (
                region.ground_x,
                region.ground_y,
                region.ground_width,
                region.ground_height,
            ),
        ),
    ];

    for (name, rect) in boxes {
        let path = dir.join(format!("capture-{ts}-{name}.bmp"));
        match save_screen_bmp(rect, &path) {
            Some(()) => lines.push(format!(
                "{}: ({},{}) {}x{} -> {}",
                name, rect.0, rect.1, rect.2, rect.3,
                path.display()
            )),
            None => lines.push(format!(
                "{}: ({},{}) {}x{} -> ÉCHEC capture",
                name, rect.0, rect.1, rect.2, rect.3
            )),
        }
    }

    flash_capture_frame((region.x, region.y, region.width, region.height));

    format!(
        "Zone principale ({},{}) {}x{}\n{}",
        region.x, region.y, region.width, region.height,
        lines.join("\n")
    )
}
