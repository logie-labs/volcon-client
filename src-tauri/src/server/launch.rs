//! Whether Windows starts Volcon when you sign in: the same switch as Volcon's
//! entry in Startup apps, in Windows' Settings and in Task Manager.
//!
//! Volcon is always listed there - its value under the Run key always exists,
//! pointing at this copy. On and off are the flag Windows itself keeps for each
//! startup app, under StartupApproved, so switching it in Volcon, in Settings or
//! in Task Manager is one and the same switch. The keys are watched, so each
//! sees the others' changes straight away.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter, Manager, Runtime};
use windows::core::{w, HSTRING, PCWSTR};
use windows::Win32::Foundation::{ERROR_SUCCESS, HANDLE, WAIT_OBJECT_0};
use windows::Win32::System::Registry::{
    RegCloseKey, RegCreateKeyExW, RegGetValueW, RegNotifyChangeKeyValue, RegSetValueExW, HKEY,
    HKEY_CURRENT_USER, KEY_NOTIFY, KEY_SET_VALUE, REG_BINARY, REG_NOTIFY_CHANGE_LAST_SET,
    REG_OPTION_NON_VOLATILE, REG_SAM_FLAGS, REG_SZ, REG_VALUE_TYPE, RRF_RT_REG_BINARY,
    RRF_RT_REG_SZ,
};
use windows::Win32::System::Threading::{CreateEventW, WaitForMultipleObjects, INFINITE};

const RUN_KEY: PCWSTR = w!("Software\\Microsoft\\Windows\\CurrentVersion\\Run");
const APPROVED_KEY: PCWSTR =
    w!("Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run");

/// What Windows writes for a startup app that's switched on.
const APPROVED_ON: [u8; 12] = [2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

/// What Windows writes for one that's switched off: an odd first byte, then
/// when it was switched off.
fn approved_off() -> [u8; 12] {
    // FILETIME counts 100-nanosecond steps from 1601; Unix time starts in 1970.
    const SECONDS_FROM_1601_TO_1970: u64 = 11_644_473_600;
    let since_1970 = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    let filetime = (since_1970.as_secs() + SECONDS_FROM_1601_TO_1970) * 10_000_000
        + u64::from(since_1970.subsec_nanos() / 100);

    let mut bytes = [0u8; 12];
    bytes[0] = 3;
    bytes[4..].copy_from_slice(&filetime.to_le_bytes());
    bytes
}

/// Volcon's name under both keys: its product name, as the autostart plugin
/// that came before this used, so entries it made are still Volcon's.
fn value_name<R: Runtime>(app: &AppHandle<R>) -> HSTRING {
    HSTRING::from(app.package_info().name.as_str())
}

/// How the Run key should start this copy of Volcon: quoted, so a path with a
/// space in it still runs.
fn launch_command(exe: &Path) -> String {
    format!("\"{}\"", exe.display())
}

/// The command Windows runs for Volcon at sign-in, if it's listed.
fn registered_command(name: &HSTRING) -> Option<String> {
    let mut buffer = vec![0u16; 2048];
    let mut size = (buffer.len() * 2) as u32;

    unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            RUN_KEY,
            name,
            RRF_RT_REG_SZ,
            None,
            Some(buffer.as_mut_ptr().cast()),
            Some(&mut size),
        )
    }
    .ok()
    .ok()?;

    // The size is in bytes and counts the terminating null.
    let len = (size as usize / 2).saturating_sub(1);
    Some(String::from_utf16_lossy(&buffer[..len]))
}

/// Whether the switch is on, if Windows has recorded it at all. An app it has
/// no record of counts as on.
fn approved_state(name: &HSTRING) -> Option<bool> {
    let mut bytes = [0u8; 32];
    let mut size = bytes.len() as u32;

    let result = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            APPROVED_KEY,
            name,
            RRF_RT_REG_BINARY,
            None,
            Some(bytes.as_mut_ptr().cast()),
            Some(&mut size),
        )
    };

    (result == ERROR_SUCCESS && size > 0).then(|| bytes[0] & 1 == 0)
}

/// Opens a key, making it first if Windows hasn't yet.
fn open(key_path: PCWSTR, access: REG_SAM_FLAGS) -> Result<HKEY, String> {
    let mut key = HKEY::default();

    unsafe {
        RegCreateKeyExW(
            HKEY_CURRENT_USER,
            key_path,
            0,
            PCWSTR::null(),
            REG_OPTION_NON_VOLATILE,
            access,
            None,
            &mut key,
            None,
        )
    }
    .ok()
    .map_err(|err| err.message())?;

    Ok(key)
}

fn set_value(key_path: PCWSTR, name: &HSTRING, kind: REG_VALUE_TYPE, data: &[u8]) -> Result<(), String> {
    let key = open(key_path, KEY_SET_VALUE)?;
    let result = unsafe { RegSetValueExW(key, name, 0, kind, Some(data)) };

    unsafe {
        let _ = RegCloseKey(key);
    }

    result.ok().map_err(|err| err.message())
}

/// A string as the registry stores one: UTF-16, ending in a null.
fn registry_text(text: &str) -> Vec<u8> {
    text.encode_utf16()
        .chain(std::iter::once(0))
        .flat_map(u16::to_le_bytes)
        .collect()
}

fn is_enabled(name: &HSTRING) -> bool {
    registered_command(name).is_some() && approved_state(name) != Some(false)
}

/// Where Volcon keeps its own note of the switch, for when the listing has to
/// be made again - after an uninstall took it away, or an upgrade that
/// uninstalled first. Windows' record can't be trusted then: older versions
/// left it saying "on" for listings they'd removed.
fn memory_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path().app_local_data_dir().ok().map(|dir| dir.join("launch-with-windows"))
}

fn remember<R: Runtime>(app: &AppHandle<R>, enabled: bool) {
    let Some(path) = memory_path(app) else {
        return;
    };

    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }

    let _ = fs::write(path, if enabled { "on" } else { "off" });
}

fn remembered<R: Runtime>(app: &AppHandle<R>) -> Option<bool> {
    match fs::read_to_string(memory_path(app)?).ok()?.trim() {
        "on" => Some(true),
        "off" => Some(false),
        _ => None,
    }
}

/// Lists Volcon in Startup apps, pointing at `exe`, if it isn't already. A
/// listing that's there keeps its switch, wherever it pointed. One made afresh
/// is switched as Volcon last knew it, `remembered` - on, the first time, as
/// Volcon ships.
fn ensure_listed(name: &HSTRING, exe: &Path, remembered: Option<bool>) -> Result<(), String> {
    let wanted = launch_command(exe);

    match registered_command(name) {
        Some(command) if command.trim() == wanted => Ok(()),
        Some(_) => set_value(RUN_KEY, name, REG_SZ, &registry_text(&wanted)),
        None => {
            let enabled = remembered.unwrap_or(true);

            // The switch first, so Windows never sees a listing it would start
            // by mistake.
            set_value(APPROVED_KEY, name, REG_BINARY, &if enabled { APPROVED_ON } else { approved_off() })?;
            set_value(RUN_KEY, name, REG_SZ, &registry_text(&wanted))
        }
    }
}

/// Whether Windows starts Volcon when you sign in.
#[tauri::command]
pub fn launch_at_sign_in<R: Runtime>(app: AppHandle<R>) -> bool {
    is_enabled(&value_name(&app))
}

/// Switches Launch with Windows on or off - the same switch as in Startup apps
/// - and answers with what Windows is set to afterwards.
#[tauri::command]
pub fn set_launch_at_sign_in<R: Runtime>(app: AppHandle<R>, enabled: bool) -> Result<bool, String> {
    // A development build would list its own, temporary executable.
    if cfg!(debug_assertions) {
        return Err("A development build doesn't register itself with Windows.".into());
    }

    let name = value_name(&app);
    let exe = std::env::current_exe().map_err(|err| err.to_string())?;

    ensure_listed(&name, &exe, remembered(&app))?;
    set_value(
        APPROVED_KEY,
        &name,
        REG_BINARY,
        &if enabled { APPROVED_ON } else { approved_off() },
    )?;

    let now = is_enabled(&name);
    remember(&app, now);
    log::info!("launch with Windows {}", if now { "on" } else { "off" });
    Ok(now)
}

/// As Volcon starts: listed in Startup apps and pointing at this copy, whatever
/// an update, an uninstall or the executable's old name left behind - then
/// watched, so Volcon's switch follows Windows'.
pub fn start<R: Runtime>(app: &AppHandle<R>) {
    let name = value_name(app);

    match std::env::current_exe() {
        Ok(exe) => match ensure_listed(&name, &exe, remembered(app)) {
            Ok(()) => remember(app, is_enabled(&name)),
            Err(err) => log::warn!("couldn't list Volcon in Startup apps: {err}"),
        },
        Err(err) => log::warn!("couldn't find Volcon's own executable: {err}"),
    }

    let app = app.clone();

    std::thread::spawn(move || {
        let heard = watch(&name, |enabled| {
            remember(&app, enabled);
            let _ = app.emit("launch:changed", enabled);
        });

        if let Err(err) = heard {
            log::warn!("stopped watching Startup apps: {err}");
        }
    });
}

/// Waits on both keys, and calls `on_change` whenever Volcon's switch ends up
/// different, whoever changed it.
fn watch(name: &HSTRING, mut on_change: impl FnMut(bool)) -> Result<(), String> {
    let keys = [open(RUN_KEY, KEY_NOTIFY)?, open(APPROVED_KEY, KEY_NOTIFY)?];
    let events: [HANDLE; 2] = [
        unsafe { CreateEventW(None, false, false, PCWSTR::null()) }.map_err(|err| err.message())?,
        unsafe { CreateEventW(None, false, false, PCWSTR::null()) }.map_err(|err| err.message())?,
    ];

    // Each notice comes once, so it's asked for again after each one.
    let arm = |index: usize| {
        unsafe { RegNotifyChangeKeyValue(keys[index], false, REG_NOTIFY_CHANGE_LAST_SET, events[index], true) }
            .ok()
            .map_err(|err| err.message())
    };

    arm(0)?;
    arm(1)?;

    let mut last = is_enabled(name);

    loop {
        let signalled = unsafe { WaitForMultipleObjects(&events, false, INFINITE) };
        let index = signalled.0.wrapping_sub(WAIT_OBJECT_0.0) as usize;

        if index >= events.len() {
            return Err(format!("waiting on the registry failed ({})", signalled.0));
        }

        arm(index)?;

        let now = is_enabled(name);

        if now != last {
            last = now;
            on_change(now);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_command_is_quoted_for_paths_with_spaces() {
        let exe = Path::new(r"C:\Users\Jo Bloggs\AppData\Local\Volcon\volcon.exe");
        assert_eq!(
            launch_command(exe),
            r#""C:\Users\Jo Bloggs\AppData\Local\Volcon\volcon.exe""#
        );
    }

    #[test]
    fn registry_text_is_utf16_with_a_null() {
        assert_eq!(registry_text("Vo"), vec![b'V', 0, b'o', 0, 0, 0]);
    }

    #[test]
    fn off_is_an_odd_flag_stamped_with_now() {
        let off = approved_off();
        assert_eq!(off[0] & 1, 1);
        assert_eq!(&off[1..4], &[0, 0, 0]);

        // Some time this century, in FILETIME's terms.
        let filetime = u64::from_le_bytes(off[4..].try_into().unwrap());
        assert!(filetime > 125_000_000_000_000_000, "{filetime}");
        assert_eq!(APPROVED_ON[0] & 1, 0);
    }

    #[test]
    fn an_app_windows_has_no_record_of_isnt_listed() {
        let name = HSTRING::from("Volcon test entry that does not exist");
        assert_eq!(approved_state(&name), None);
        assert!(!is_enabled(&name));
    }

    /// A listing of its own, so the real one is never touched, and gone again
    /// once the test is done.
    struct TestListing(HSTRING);

    impl TestListing {
        fn new(label: &str) -> Self {
            let listing = Self(HSTRING::from(format!("Volcon test {label} {}", std::process::id())));
            listing.remove();
            listing
        }

        fn remove(&self) {
            for key in [RUN_KEY, APPROVED_KEY] {
                unsafe {
                    let _ = windows::Win32::System::Registry::RegDeleteKeyValueW(HKEY_CURRENT_USER, key, &self.0);
                }
            }
        }

        /// As Startup apps does it, when it's switched there.
        fn switch(&self, on: bool) {
            set_value(APPROVED_KEY, &self.0, REG_BINARY, &if on { APPROVED_ON } else { approved_off() }).unwrap();
        }
    }

    impl Drop for TestListing {
        fn drop(&mut self) {
            self.remove();
        }
    }

    #[test]
    fn a_listing_starts_on_and_keeps_its_switch_through_moves_and_reinstalls() {
        let listing = TestListing::new("listing");
        let name = &listing.0;
        let installed = Path::new(r"C:\Users\Jo Bloggs\AppData\Local\Volcon\volcon.exe");
        let uninstall = || unsafe {
            let _ = windows::Win32::System::Registry::RegDeleteKeyValueW(HKEY_CURRENT_USER, RUN_KEY, name);
        };

        ensure_listed(name, installed, None).unwrap();
        assert_eq!(
            registered_command(name).as_deref(),
            Some(r#""C:\Users\Jo Bloggs\AppData\Local\Volcon\volcon.exe""#)
        );
        assert!(is_enabled(name), "a first listing starts on, as Volcon ships");

        listing.switch(false);
        assert!(!is_enabled(name));

        // Installed somewhere else: the listing follows, the switch stays.
        ensure_listed(name, Path::new(r"D:\Apps\Volcon\volcon.exe"), Some(true)).unwrap();
        assert_eq!(registered_command(name).as_deref(), Some(r#""D:\Apps\Volcon\volcon.exe""#));
        assert!(!is_enabled(name));

        // Uninstalled, with Windows' old record left behind: it comes back as
        // Volcon remembers it, whatever the record says...
        listing.switch(true);
        uninstall();
        ensure_listed(name, installed, Some(false)).unwrap();
        assert!(!is_enabled(name));

        // ...and as it ships when Volcon has no note of it.
        listing.switch(false);
        uninstall();
        ensure_listed(name, installed, None).unwrap();
        assert!(is_enabled(name));
    }

    #[test]
    fn switching_it_in_startup_apps_is_heard_straight_away() {
        use std::sync::mpsc;
        use std::time::Duration;

        let listing = TestListing::new("watch");
        ensure_listed(&listing.0, Path::new(r"C:\Volcon\volcon.exe"), None).unwrap();

        let (heard, hear) = mpsc::channel();
        let watched = listing.0.clone();
        std::thread::spawn(move || {
            let _ = watch(&watched, |enabled| {
                let _ = heard.send(enabled);
            });
        });

        // Time for the watch to start before anything changes.
        std::thread::sleep(Duration::from_millis(300));

        listing.switch(false);
        assert_eq!(hear.recv_timeout(Duration::from_secs(5)), Ok(false));

        listing.switch(true);
        assert_eq!(hear.recv_timeout(Duration::from_secs(5)), Ok(true));

        // Switched on again: nothing changed, so nothing's said.
        listing.switch(true);
        assert!(hear.recv_timeout(Duration::from_millis(500)).is_err());
    }
}
