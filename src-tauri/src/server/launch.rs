//! Whether Windows starts Volcon when you sign in.
//!
//! That's Volcon's value under the Run key, read and written here directly.
//! Task Manager's Startup apps can switch an app off without removing it,
//! which it records under StartupApproved, so both are read to say whether
//! Volcon really starts. Every change can be made twice - turning off what's
//! already off is fine - so the setting and Windows never argue over it.

use std::path::Path;

use tauri::{AppHandle, Runtime};
use windows::core::{w, HSTRING, PCWSTR};
use windows::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS};
use windows::Win32::System::Registry::{
    RegCloseKey, RegCreateKeyExW, RegDeleteKeyValueW, RegGetValueW, RegSetValueExW, HKEY,
    HKEY_CURRENT_USER, KEY_SET_VALUE, REG_BINARY, REG_OPTION_NON_VOLATILE, REG_SZ,
    REG_VALUE_TYPE, RRF_RT_REG_BINARY, RRF_RT_REG_SZ,
};

const RUN_KEY: PCWSTR = w!("Software\\Microsoft\\Windows\\CurrentVersion\\Run");
const APPROVED_KEY: PCWSTR =
    w!("Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run");

/// What Task Manager writes for an app it lets start. Switched off there, the
/// first byte turns odd and the rest say when.
const APPROVED_ON: [u8; 12] = [2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

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

/// The command Windows runs for Volcon at sign-in, if it has one.
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

/// Whether Task Manager has switched Volcon off. No entry there means it
/// hasn't been asked.
fn switched_off_in_task_manager(name: &HSTRING) -> bool {
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

    result == ERROR_SUCCESS && size > 0 && bytes[0] & 1 == 1
}

/// Writes a value, making its key first if Windows hasn't yet.
fn set_value(key_path: PCWSTR, name: &HSTRING, kind: REG_VALUE_TYPE, data: &[u8]) -> Result<(), String> {
    let mut key = HKEY::default();

    unsafe {
        RegCreateKeyExW(
            HKEY_CURRENT_USER,
            key_path,
            0,
            PCWSTR::null(),
            REG_OPTION_NON_VOLATILE,
            KEY_SET_VALUE,
            None,
            &mut key,
            None,
        )
    }
    .ok()
    .map_err(|err| err.message())?;

    let result = unsafe { RegSetValueExW(key, name, 0, kind, Some(data)) };

    unsafe {
        let _ = RegCloseKey(key);
    }

    result.ok().map_err(|err| err.message())
}

/// Removes a value; one that isn't there is already removed.
fn delete_value(key_path: PCWSTR, name: &HSTRING) -> Result<(), String> {
    match unsafe { RegDeleteKeyValueW(HKEY_CURRENT_USER, key_path, name) } {
        ERROR_SUCCESS | ERROR_FILE_NOT_FOUND => Ok(()),
        error => error.ok().map_err(|err| err.message()),
    }
}

/// A string as the registry stores one: UTF-16, ending in a null.
fn registry_text(text: &str) -> Vec<u8> {
    text.encode_utf16()
        .chain(std::iter::once(0))
        .flat_map(u16::to_le_bytes)
        .collect()
}

fn is_registered(name: &HSTRING) -> bool {
    registered_command(name).is_some() && !switched_off_in_task_manager(name)
}

fn register(name: &HSTRING, exe: &Path) -> Result<(), String> {
    set_value(RUN_KEY, name, REG_SZ, &registry_text(&launch_command(exe)))?;
    // Approved too, in case Task Manager had switched it off before.
    set_value(APPROVED_KEY, name, REG_BINARY, &APPROVED_ON)
}

fn unregister(name: &HSTRING) -> Result<(), String> {
    delete_value(RUN_KEY, name)?;
    // So Task Manager doesn't keep listing an app that's gone.
    delete_value(APPROVED_KEY, name)
}

/// Whether Windows starts Volcon when you sign in.
#[tauri::command]
pub fn launch_at_sign_in<R: Runtime>(app: AppHandle<R>) -> bool {
    is_registered(&value_name(&app))
}

/// Has Windows start Volcon when you sign in, or stop, and answers with what
/// Windows is set to afterwards.
#[tauri::command]
pub fn set_launch_at_sign_in<R: Runtime>(app: AppHandle<R>, enabled: bool) -> Result<bool, String> {
    // A development build would register its own, temporary executable.
    if cfg!(debug_assertions) {
        return Err("A development build doesn't register itself with Windows.".into());
    }

    let name = value_name(&app);

    if enabled {
        let exe = std::env::current_exe().map_err(|err| err.to_string())?;
        register(&name, &exe)?;
    } else {
        unregister(&name)?;
    }

    log::info!("launch with Windows {}", if enabled { "on" } else { "off" });
    Ok(is_registered(&name))
}

/// Points Volcon's entry at this copy if it names another - an install in a
/// different folder, the executable's old name, the old unquoted form - so an
/// update can't quietly stop Volcon starting with Windows. Nothing changes
/// when there's no entry, and one Task Manager switched off stays off.
pub fn repair<R: Runtime>(app: &AppHandle<R>) {
    let name = value_name(app);

    let (Some(command), Ok(exe)) = (registered_command(&name), std::env::current_exe()) else {
        return;
    };

    let wanted = launch_command(&exe);

    if command.trim() == wanted {
        return;
    }

    match set_value(RUN_KEY, &name, REG_SZ, &registry_text(&wanted)) {
        Ok(()) => log::info!("launch with Windows now starts {}", exe.display()),
        Err(err) => log::warn!("couldn't point launch with Windows at {}: {err}", exe.display()),
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
    fn removing_what_isnt_there_is_fine() {
        // A name nothing will ever have registered.
        let name = HSTRING::from("Volcon test entry that does not exist");
        assert!(delete_value(RUN_KEY, &name).is_ok());
        assert!(!is_registered(&name));
    }
}
