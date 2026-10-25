use std::collections::HashMap;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

use crate::server::process::ProcessDetails;

/// Only the overlay window cares about `overlay:*`, and those payloads carry a
/// base64 icon per app. Note that `emit_to` alone doesn't keep them out of the
/// main window: a JS `listen()` registered without a target hears events sent
/// to any window, so the main window also declines them on its side.
const OVERLAY_WINDOW: &str = "overlay";

/// How often a burst of control changes may pull the overlay window back into
/// view. Every message in a knob sweep asks for it; the window needs it once
/// per appearance, and now and then after that in case something has since
/// landed on top of it.
const PRESENT_INTERVAL: Duration = Duration::from_millis(250);

/// How often one control may tell the overlay to show it. Every message in a
/// knob sweep asks - several hundred a second with a few knobs moving - but
/// the overlay only needs to know the control is still moving, to keep its
/// card up; the level itself travels separately, in `control:update`.
const SHOW_INTERVAL: Duration = Duration::from_millis(100);

/// Lets each control's first request through at once, and further ones no
/// more often than `SHOW_INTERVAL`.
#[derive(Default)]
struct ShowThrottle {
    last_shown: HashMap<u8, Instant>,
}

impl ShowThrottle {
    fn admit(&mut self, control: u8, now: Instant) -> bool {
        match self.last_shown.get(&control) {
            Some(at) if now.duration_since(*at) < SHOW_INTERVAL => false,
            _ => {
                self.last_shown.insert(control, now);
                true
            }
        }
    }
}

#[derive(Clone)]
pub struct OverlayNotifier {
    app: AppHandle,
    last_presented: Arc<Mutex<Option<Instant>>>,
    shows: Arc<Mutex<ShowThrottle>>,
}

#[derive(Clone, Serialize)]
pub struct ControlProgressEvent {
    pub control: u8,
    pub value: u8,
    pub volume: u8,
}

#[derive(Clone, Serialize)]
pub struct VolumeOverlayEvent {
    pub control: u8,
    pub value: u8,
    pub volume: u8,
    pub apps: Vec<ProcessDetails>,
}

/// Names the control the overlay is being raised for, so the overlay can switch
/// to it at once instead of showing the last control until the app list
/// catches up. That list never comes at all when none of the control's apps
/// are playing.
#[derive(Clone, Serialize)]
struct OverlayShowEvent {
    control: u8,
}

impl OverlayNotifier {
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            last_presented: Arc::new(Mutex::new(None)),
            shows: Arc::new(Mutex::new(ShowThrottle::default())),
        }
    }

    pub fn emit_control_progress(&self, event: ControlProgressEvent) {
        let _ = self.app.emit("control:update", event);
    }

    pub fn emit_show(&self, control: u8) {
        let admitted = self
            .shows
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .admit(control, Instant::now());

        if !admitted {
            return;
        }

        self.present();
        let _ = self
            .app
            .emit_to(OVERLAY_WINDOW, "overlay:show", OverlayShowEvent { control });
    }

    pub fn emit_volume_change(&self, event: VolumeOverlayEvent) {
        let control = event.control;
        let _ = self.app.emit_to(OVERLAY_WINDOW, "overlay:update", event);
        self.emit_show(control);
    }

    /// Showing the overlay is only a fade inside a window that stays open, so
    /// that window has to still be somewhere it can be seen. Nothing guarantees
    /// it: Show Desktop or Win+M can minimise it, and any always-on-top window
    /// that opens later sits above it. This puts it back (restored, shown, top
    /// of the always-on-top band) without taking focus.
    fn present(&self) {
        {
            let mut last = self
                .last_presented
                .lock()
                .unwrap_or_else(PoisonError::into_inner);
            let now = Instant::now();

            if last.is_some_and(|at| now.duration_since(at) < PRESENT_INTERVAL) {
                return;
            }

            *last = Some(now);
        }

        // The main thread owns the window. This is called from the MIDI callback
        // and the audio thread, and neither should wait on it.
        let app = self.app.clone();
        let _ = self.app.run_on_main_thread(move || {
            if let Some(window) = app.get_webview_window(OVERLAY_WINDOW) {
                platform::bring_into_view(&window);
            }
        });
    }
}

/// Startup setup for the overlay window, for what the window config can't say.
/// Call it after anything else that changes the window's flags.
pub fn prepare_window(window: &WebviewWindow) {
    platform::make_tool_window(window);
}

#[cfg(windows)]
mod platform {
    use tauri::WebviewWindow;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongW, IsIconic, IsWindowVisible, SetWindowLongW, SetWindowPos, ShowWindow,
        GWL_EXSTYLE, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOOWNERZORDER, SWP_NOSIZE,
        SW_HIDE, SW_SHOWNOACTIVATE, WS_EX_APPWINDOW, WS_EX_TOOLWINDOW,
    };

    fn hwnd(window: &WebviewWindow) -> Option<HWND> {
        // Tauri hands back the HWND type from its own `windows` crate version;
        // the handle inside is the same.
        window.hwnd().ok().map(|hwnd| HWND(hwnd.0))
    }

    /// Makes the overlay a tool window, which keeps it out of Alt+Tab and puts
    /// it on every virtual desktop instead of only the one it was created on.
    ///
    /// tao has no option for this, and it rewrites the extended style wholesale
    /// whenever one of its own flags changes, putting `WS_EX_APPWINDOW` back as
    /// it goes. So this is checked each time the overlay is presented, not just
    /// once at startup.
    pub fn make_tool_window(window: &WebviewWindow) {
        let Some(hwnd) = hwnd(window) else {
            return;
        };

        unsafe {
            let current = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
            let wanted = (current | WS_EX_TOOLWINDOW.0) & !WS_EX_APPWINDOW.0;

            if current == wanted {
                return;
            }

            // The shell only picks the change up when a window is shown, so a
            // visible one is hidden around it.
            let visible = IsWindowVisible(hwnd).as_bool();

            if visible {
                let _ = ShowWindow(hwnd, SW_HIDE);
            }

            SetWindowLongW(hwnd, GWL_EXSTYLE, wanted as i32);

            if visible {
                let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
            }
        }
    }

    pub fn bring_into_view(window: &WebviewWindow) {
        make_tool_window(window);

        let Some(hwnd) = hwnd(window) else {
            return;
        };

        unsafe {
            if IsIconic(hwnd).as_bool() || !IsWindowVisible(hwnd).as_bool() {
                let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
            }

            // Already topmost, but re-asserting it lifts the window back above
            // any other always-on-top window that has come up since.
            let _ = SetWindowPos(
                hwnd,
                HWND_TOPMOST,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER,
            );
        }
    }
}

#[cfg(not(windows))]
mod platform {
    use tauri::WebviewWindow;

    pub fn make_tool_window(_window: &WebviewWindow) {}

    pub fn bring_into_view(_window: &WebviewWindow) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_control_is_shown_at_once_then_at_most_every_interval() {
        let mut throttle = ShowThrottle::default();
        let start = Instant::now();

        assert!(throttle.admit(1, start));
        // Another control isn't held up by the first.
        assert!(throttle.admit(2, start));
        assert!(!throttle.admit(1, start + Duration::from_millis(30)));
        assert!(!throttle.admit(1, start + SHOW_INTERVAL - Duration::from_millis(1)));
        assert!(throttle.admit(1, start + SHOW_INTERVAL));
    }
}
