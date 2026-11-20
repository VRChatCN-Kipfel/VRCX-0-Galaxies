#[cfg(target_os = "windows")]
use std::sync::atomic::{AtomicBool, Ordering};

#[cfg(target_os = "windows")]
static TASKBAR_OVERLAY_NOTIFY: AtomicBool = AtomicBool::new(false);

#[cfg(target_os = "windows")]
const OVERLAY_DESCRIPTION: &[u16] = &[
    b'N' as u16,
    b'e' as u16,
    b'w' as u16,
    b' ' as u16,
    b'n' as u16,
    b'o' as u16,
    b't' as u16,
    b'i' as u16,
    b'f' as u16,
    b'i' as u16,
    b'c' as u16,
    b'a' as u16,
    b't' as u16,
    b'i' as u16,
    b'o' as u16,
    b'n' as u16,
    0,
];

#[cfg(target_os = "windows")]
pub fn set_taskbar_overlay_notification(window_handle: isize, notify: bool) {
    TASKBAR_OVERLAY_NOTIFY.store(notify, Ordering::Release);
    apply_overlay(window_handle, notify);
}

#[cfg(target_os = "windows")]
pub fn reapply_taskbar_overlay_notification(window_handle: isize) {
    apply_overlay(
        window_handle,
        TASKBAR_OVERLAY_NOTIFY.load(Ordering::Acquire),
    );
}

#[cfg(target_os = "windows")]
pub fn forget_taskbar_overlay_notification() {
    TASKBAR_OVERLAY_NOTIFY.store(false, Ordering::Release);
}

#[cfg(target_os = "windows")]
fn apply_overlay(window_handle: isize, notify: bool) {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::DestroyIcon;

    if window_handle == 0 {
        return;
    }
    let window = HWND(window_handle as *mut core::ffi::c_void);

    with_taskbar_list(|taskbar| {
        // 角标常驻：没有未读时画白 X，有未读时画红 X。
        // 图标本体不带 X，这个角标就是那个 X 本体。
        let Some(icon) = create_badge_icon(window, notify) else {
            return;
        };
        let result =
            unsafe { taskbar.SetOverlayIcon(window, icon, PCWSTR(OVERLAY_DESCRIPTION.as_ptr())) };
        if let Err(error) = result {
            tracing::warn!(%error, "Failed to set the taskbar overlay icon");
        }
        let _ = unsafe { DestroyIcon(icon) };
    });
}

#[cfg(target_os = "windows")]
fn with_taskbar_list(action: impl FnOnce(&windows::Win32::UI::Shell::ITaskbarList3)) {
    use std::cell::RefCell;

    use windows::Win32::Foundation::RPC_E_CHANGED_MODE;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::UI::Shell::{ITaskbarList3, TaskbarList};

    thread_local! {
        static COM_READY: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
        static TASKBAR: RefCell<Option<ITaskbarList3>> = const { RefCell::new(None) };
    }

    COM_READY.with(|ready| {
        if ready.get() {
            return;
        }
        let result = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
        if result.is_err() && result != RPC_E_CHANGED_MODE {
            tracing::warn!(result = %result.0, "Failed to initialize COM for the taskbar overlay");
        }
        ready.set(true);
    });

    TASKBAR.with(|cell| {
        let mut slot = cell.borrow_mut();
        if slot.is_none() {
            let created = unsafe { CoCreateInstance(&TaskbarList, None, CLSCTX_INPROC_SERVER) }
                .and_then(|taskbar: ITaskbarList3| unsafe { taskbar.HrInit() }.map(|()| taskbar));
            match created {
                Ok(taskbar) => *slot = Some(taskbar),
                Err(error) => {
                    tracing::warn!(%error, "Failed to create the taskbar list instance");
                    return;
                }
            }
        }
        if let Some(taskbar) = slot.as_ref() {
            action(taskbar);
        }
    });
}

#[cfg(target_os = "windows")]
fn create_badge_icon(
    window: windows::Win32::Foundation::HWND,
    notify: bool,
) -> Option<windows::Win32::UI::WindowsAndMessaging::HICON> {
    use windows::Win32::Graphics::Gdi::{
        CreateBitmap, CreateDIBSection, DeleteObject, BITMAPINFO, BITMAPV5HEADER, BI_BITFIELDS,
        DIB_RGB_COLORS,
    };
    use windows::Win32::UI::HiDpi::{GetDpiForWindow, GetSystemMetricsForDpi};
    use windows::Win32::UI::WindowsAndMessaging::{CreateIconIndirect, ICONINFO, SM_CXSMICON};

    let dpi = match unsafe { GetDpiForWindow(window) } {
        0 => 96,
        dpi => dpi,
    };
    let size = overlay_icon_size(unsafe { GetSystemMetricsForDpi(SM_CXSMICON, dpi) });

    let mut header = BITMAPV5HEADER {
        bV5Size: std::mem::size_of::<BITMAPV5HEADER>() as u32,
        bV5Width: size as i32,
        bV5Height: -(size as i32),
        bV5Planes: 1,
        bV5BitCount: 32,
        bV5Compression: BI_BITFIELDS,
        bV5RedMask: 0x00FF_0000,
        bV5GreenMask: 0x0000_FF00,
        bV5BlueMask: 0x0000_00FF,
        bV5AlphaMask: 0xFF00_0000,
        ..Default::default()
    };

    let mut bits: *mut core::ffi::c_void = std::ptr::null_mut();
    let color = unsafe {
        CreateDIBSection(
            None,
            &mut header as *mut BITMAPV5HEADER as *const BITMAPINFO,
            DIB_RGB_COLORS,
            &mut bits,
            None,
            0,
        )
    }
    .ok()?;
    if bits.is_null() {
        let _ = unsafe { DeleteObject(color.into()) };
        return None;
    }

    let pixels = render_badge_premultiplied_bgra(size, notify);
    unsafe {
        std::ptr::copy_nonoverlapping(pixels.as_ptr(), bits as *mut u32, pixels.len());
    }

    let mask = unsafe { CreateBitmap(size as i32, size as i32, 1, 1, None) };
    let info = ICONINFO {
        fIcon: true.into(),
        xHotspot: 0,
        yHotspot: 0,
        hbmMask: mask,
        hbmColor: color,
    };
    let icon = unsafe { CreateIconIndirect(&info) };

    let _ = unsafe { DeleteObject(mask.into()) };
    let _ = unsafe { DeleteObject(color.into()) };

    match icon {
        Ok(icon) => Some(icon),
        Err(error) => {
            tracing::warn!(%error, "Failed to build the taskbar overlay icon");
            None
        }
    }
}

#[cfg(target_os = "windows")]
fn overlay_icon_size(raw_small_icon_metric: i32) -> u32 {
    if raw_small_icon_metric <= 0 {
        return 16;
    }
    (raw_small_icon_metric as u32).clamp(8, 64)
}

/// 角标图来自 `images/brand/Galaxy/VRCX-0-Galaxies.svg` 里那条 X，
/// 由 `resvg` 按各档尺寸预渲染成 PNG，形状与标里的 X 完全一致（含 #2a2a6a 描边）。
#[cfg(target_os = "windows")]
const BADGE_IDLE: &[(u32, &[u8])] = &[
    (16, include_bytes!("../assets/badge/badge-x-idle-16.png")),
    (20, include_bytes!("../assets/badge/badge-x-idle-20.png")),
    (24, include_bytes!("../assets/badge/badge-x-idle-24.png")),
    (28, include_bytes!("../assets/badge/badge-x-idle-28.png")),
    (32, include_bytes!("../assets/badge/badge-x-idle-32.png")),
    (40, include_bytes!("../assets/badge/badge-x-idle-40.png")),
    (48, include_bytes!("../assets/badge/badge-x-idle-48.png")),
    (64, include_bytes!("../assets/badge/badge-x-idle-64.png")),
];

#[cfg(target_os = "windows")]
const BADGE_ACTIVE: &[(u32, &[u8])] = &[
    (16, include_bytes!("../assets/badge/badge-x-active-16.png")),
    (20, include_bytes!("../assets/badge/badge-x-active-20.png")),
    (24, include_bytes!("../assets/badge/badge-x-active-24.png")),
    (28, include_bytes!("../assets/badge/badge-x-active-28.png")),
    (32, include_bytes!("../assets/badge/badge-x-active-32.png")),
    (40, include_bytes!("../assets/badge/badge-x-active-40.png")),
    (48, include_bytes!("../assets/badge/badge-x-active-48.png")),
    (64, include_bytes!("../assets/badge/badge-x-active-64.png")),
];

/// 取不小于目标尺寸的最小一档，没有就取最大一档，避免放大导致模糊。
#[cfg(target_os = "windows")]
fn badge_bytes(notify: bool, size: u32) -> &'static [u8] {
    let table = if notify { BADGE_ACTIVE } else { BADGE_IDLE };
    let picked = table
        .iter()
        .find(|(candidate, _)| *candidate >= size)
        .or_else(|| table.last())
        .expect("badge table is never empty");
    picked.1
}

/// 把预渲染的角标图转成 DIB 需要的预乘 ARGB 像素。
#[cfg(target_os = "windows")]
fn render_badge_premultiplied_bgra(size: u32, notify: bool) -> Vec<u32> {
    let decoded = image::load_from_memory(badge_bytes(notify, size))
        .expect("embedded badge png must decode")
        .to_rgba8();
    let scaled = if decoded.width() == size && decoded.height() == size {
        decoded
    } else {
        image::imageops::resize(&decoded, size, size, image::imageops::FilterType::Lanczos3)
    };

    let mut pixels = Vec::with_capacity((size * size) as usize);
    for pixel in scaled.pixels() {
        let alpha = pixel[3] as u32;
        let scale = |channel: u8| (channel as u32 * alpha) / 255;
        pixels.push(
            (alpha << 24) | (scale(pixel[0]) << 16) | (scale(pixel[1]) << 8) | scale(pixel[2]),
        );
    }
    pixels
}

#[cfg(not(target_os = "windows"))]
pub fn set_taskbar_overlay_notification(_window_handle: isize, _notify: bool) {}

#[cfg(not(target_os = "windows"))]
pub fn reapply_taskbar_overlay_notification(_window_handle: isize) {}

#[cfg(not(target_os = "windows"))]
pub fn forget_taskbar_overlay_notification() {}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::{badge_bytes, overlay_icon_size, render_badge_premultiplied_bgra};

    #[test]
    fn overlay_icon_size_keeps_usual_metrics_and_clamps_unusable_ones() {
        assert_eq!(overlay_icon_size(0), 16);
        assert_eq!(overlay_icon_size(-4), 16);
        for metric in [16, 20, 24, 32] {
            assert_eq!(overlay_icon_size(metric), metric as u32);
        }
        assert_eq!(overlay_icon_size(4), 8);
        assert_eq!(overlay_icon_size(512), 64);
    }

    #[test]
    fn the_badge_has_content_and_transparent_edges() {
        // 只断言「有内容」和「有透明区」，不锁定 X 的具体像素位置：
        // X 在角标画布里的位置是手调出来的设计参数（FILL / AX / AY），
        // 以后微调位置不该让这条测试变红。位置对不对靠生成脚本和肉眼验收。
        let size = 32u32;
        let pixels = render_badge_premultiplied_bgra(size, false);
        let opaque = pixels.iter().filter(|pixel| **pixel != 0).count();
        let total = pixels.len();

        assert!(opaque > 0, "角标不能整块透明");
        assert!(opaque < total, "角标不能整块实心，四周要留透明边");
    }

    #[test]
    fn the_active_badge_is_red_and_the_idle_badge_is_not() {
        let size = 32u32;
        let idle = render_badge_premultiplied_bgra(size, false);
        let active = render_badge_premultiplied_bgra(size, true);
        let center = ((size / 2) as usize) * (size as usize) + (size / 2) as usize;

        // 预乘后的 ARGB：低 8 位是蓝、中 8 位是绿、高 8 位（除 alpha）是红
        let idle_red = (idle[center] >> 16) & 0xFF;
        let active_red = (active[center] >> 16) & 0xFF;
        let active_green = (active[center] >> 8) & 0xFF;
        assert!(active_red > active_green, "触发态应当是偏红的");
        assert!(idle_red >= active_red, "常态应当比触发态更亮或相等");
    }

    #[test]
    fn badge_bytes_picks_a_size_that_is_not_smaller_than_requested() {
        for size in [16u32, 20, 24, 28, 32, 40, 48, 64] {
            let bytes = badge_bytes(true, size);
            let decoded = image::load_from_memory(bytes)
                .expect("badge png decodes")
                .to_rgba8();
            assert!(decoded.width() >= size, "尺寸 {size} 取到了更小的图");
        }
        // 超过最大档时取最大一档
        let bytes = badge_bytes(true, 96);
        let decoded = image::load_from_memory(bytes)
            .expect("badge png decodes")
            .to_rgba8();
        assert_eq!(decoded.width(), 64);
    }

    #[test]
    fn keeps_every_channel_premultiplied_by_alpha() {
        for size in [8u32, 16, 24, 64] {
            for pixel in render_badge_premultiplied_bgra(size, false) {
                let alpha = pixel >> 24;
                assert!((pixel >> 16) & 0xFF <= alpha);
                assert!((pixel >> 8) & 0xFF <= alpha);
                assert!(pixel & 0xFF <= alpha);
            }
        }
    }
}
