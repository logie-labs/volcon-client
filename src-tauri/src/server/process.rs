use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use image::{codecs::png::PngEncoder, ColorType, ImageEncoder};
use serde::{Deserialize, Serialize};
use windows::core::{PCWSTR, PWSTR};
use windows::Win32::Foundation::CloseHandle;
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, SelectObject, BITMAPINFO,
    BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
};
use windows::Win32::Storage::FileSystem::FILE_FLAGS_AND_ATTRIBUTES;
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::Shell::{
    SHDefExtractIconW, SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON,
};
use windows::Win32::UI::WindowsAndMessaging::{DestroyIcon, DrawIconEx, DI_NORMAL, HICON};

use crate::server::audio::audio_sessions;
use crate::server::error::{BridgeError, BridgeResult};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ProcessDetails {
    pub pid: u32,
    pub name: String,
    pub executable_path: Option<String>,
    pub icon: Option<String>,
}

fn to_wide(path: &OsStr) -> Vec<u16> {
    path.encode_wide().chain(std::iter::once(0)).collect()
}

fn from_wide_slice(value: &[u16]) -> String {
    let end = value
        .iter()
        .position(|character| *character == 0)
        .unwrap_or(value.len());
    String::from_utf16_lossy(&value[..end])
}

pub fn executable_path(pid: u32) -> Option<PathBuf> {
    let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()? };
    let mut buffer = vec![0u16; 32768];
    let mut len = buffer.len() as u32;

    let result = unsafe {
        QueryFullProcessImageNameW(
            process,
            PROCESS_NAME_FORMAT(0),
            PWSTR(buffer.as_mut_ptr()),
            &mut len,
        )
    };
    let _ = unsafe { CloseHandle(process) };

    result.ok()?;
    let path = String::from_utf16_lossy(&buffer[..len as usize]);
    Some(PathBuf::from(path))
}

pub fn process_name(pid: u32) -> Option<String> {
    executable_path(pid)
        .as_ref()
        .and_then(|path| path.file_stem())
        .and_then(|name| name.to_str())
        .map(str::to_owned)
}

fn icon_png_bytes(path: &Path) -> BridgeResult<Option<Vec<u8>>> {
    let wide = to_wide(path.as_os_str());
    let mut info = SHFILEINFOW::default();
    let result = unsafe {
        SHGetFileInfoW(
            PCWSTR(wide.as_ptr()),
            FILE_FLAGS_AND_ATTRIBUTES(0),
            Some(&mut info),
            std::mem::size_of::<SHFILEINFOW>() as u32,
            SHGFI_ICON | SHGFI_LARGEICON,
        )
    };

    if result == 0 || info.hIcon.is_invalid() {
        return Ok(None);
    }

    let png = render_icon_to_png(info.hIcon, LIST_ICON_SIZE)?;
    let _ = unsafe { DestroyIcon(info.hIcon) };
    Ok(Some(png))
}

/// The size icons are drawn at for lists and rows.
const LIST_ICON_SIZE: i32 = 64;

/// The largest an icon is drawn on request; past this the file rarely has more
/// detail to give, and the PNG only gets heavier.
const MAX_ICON_SIZE: u32 = 256;

/// An executable's icon at `size` pixels square, taken from the largest image
/// the file holds and scaled down to fit, rather than the shell's small "large"
/// icon scaled up. For showing an icon big without it going soft. Falls back to
/// the shell's icon for anything that can't be extracted this way.
fn icon_png_bytes_at(path: &Path, size: i32) -> BridgeResult<Option<Vec<u8>>> {
    let wide = to_wide(path.as_os_str());
    let mut large = HICON::default();
    // The low word asks for the large icon's size; the high word is the small
    // icon's, which isn't requested.
    let sizes = (size as u32 & 0xFFFF) | (16 << 16);
    let result = unsafe {
        SHDefExtractIconW(PCWSTR(wide.as_ptr()), 0, 0, Some(&mut large), None, sizes)
    };

    if result.is_err() || large.is_invalid() {
        return icon_png_bytes(path);
    }

    let png = render_icon_to_png(large, size);
    let _ = unsafe { DestroyIcon(large) };
    png.map(Some)
}

fn render_icon_to_png(icon: HICON, size: i32) -> BridgeResult<Vec<u8>> {

    let mut pixels: *mut core::ffi::c_void = core::ptr::null_mut();
    let mut bmi = BITMAPINFO::default();
    bmi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
    bmi.bmiHeader.biWidth = size;
    bmi.bmiHeader.biHeight = -size;
    bmi.bmiHeader.biPlanes = 1;
    bmi.bmiHeader.biBitCount = 32;
    bmi.bmiHeader.biCompression = BI_RGB.0 as u32;

    let hdc = unsafe { CreateCompatibleDC(None) };
    if hdc.0.is_null() {
        return Err(BridgeError("failed to create drawing context".into()));
    }

    let bitmap = unsafe { CreateDIBSection(hdc, &bmi, DIB_RGB_COLORS, &mut pixels, None, 0) }
        .map_err(|err| BridgeError(err.to_string()))?;

    let previous = unsafe { SelectObject(hdc, bitmap) };
    unsafe { DrawIconEx(hdc, 0, 0, icon, size, size, 0, None, DI_NORMAL) }
        .map_err(|err| BridgeError(err.to_string()))?;

    if pixels.is_null() {
        let _ = unsafe { SelectObject(hdc, previous) };
        let _ = unsafe { DeleteObject(bitmap) };
        let _ = unsafe { DeleteDC(hdc) };
        return Err(BridgeError("failed to allocate icon pixels".into()));
    }

    let pixel_count = (size * size * 4) as usize;
    let raw = unsafe { std::slice::from_raw_parts(pixels as *const u8, pixel_count) };
    let mut rgba = raw.to_vec();
    for pixel in rgba.chunks_exact_mut(4) {
        pixel.swap(0, 2);
    }

    let image = image::RgbaImage::from_raw(size as u32, size as u32, rgba)
        .ok_or_else(|| BridgeError("failed to create icon image buffer".into()))?;

    let mut encoded = Vec::new();
    PngEncoder::new(&mut encoded)
        .write_image(
            image.as_raw(),
            size as u32,
            size as u32,
            ColorType::Rgba8.into(),
        )
        .map_err(|err| BridgeError(err.to_string()))?;

    let _ = unsafe { SelectObject(hdc, previous) };
    let _ = unsafe { DeleteObject(bitmap) };
    let _ = unsafe { DeleteDC(hdc) };

    Ok(encoded)
}

pub fn process_details(pid: u32) -> BridgeResult<ProcessDetails> {
    let executable_path = executable_path(pid);
    let name = executable_path
        .as_ref()
        .and_then(|path| path.file_stem())
        .and_then(|stem| stem.to_str())
        .map(str::to_owned)
        .or_else(|| process_name(pid))
        .unwrap_or_else(|| format!("PID {pid}"));

    let icon = executable_path
        .as_deref()
        .and_then(|path| icon_png_bytes(path).ok().flatten())
        .map(|bytes| format!("data:image/png;base64,{}", STANDARD.encode(bytes)));

    Ok(ProcessDetails {
        pid,
        name,
        executable_path: executable_path.map(|path| path.to_string_lossy().to_string()),
        icon,
    })
}

fn running_process_pids() -> BridgeResult<Vec<(u32, String)>> {
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) }
        .map_err(|err| BridgeError(err.to_string()))?;

    let mut entry = PROCESSENTRY32W::default();
    entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;

    let mut processes = Vec::new();
    let mut has_entry = unsafe { Process32FirstW(snapshot, &mut entry) }.is_ok();

    while has_entry {
        processes.push((entry.th32ProcessID, from_wide_slice(&entry.szExeFile)));
        has_entry = unsafe { Process32NextW(snapshot, &mut entry) }.is_ok();
    }

    let _ = unsafe { CloseHandle(snapshot) };
    Ok(processes)
}

pub fn running_processes() -> BridgeResult<Vec<ProcessDetails>> {
    let mut processes = Vec::new();

    for (pid, fallback_name) in running_process_pids()? {
        let mut details = process_details(pid)?;
        if details.name.is_empty() {
            details.name = fallback_name;
        }
        processes.push(details);
    }

    // Filter to only include GUI/windowed processes to avoid background/system noise.
    // On Windows, processes with a visible main window are typically what users care about.
    let gui_processes: Vec<ProcessDetails> = processes
        .into_iter()
        .filter(|p| {
            if p.pid == 0 {
                return false;
            }
            // crude heuristic: executable_path present and not the system idle process
            p.executable_path.is_some() && !p.name.to_lowercase().contains("svchost")
        })
        .collect();

    Ok(gui_processes)
}

#[tauri::command]
pub fn process_get_details(pid: u32) -> Result<ProcessDetails, String> {
    process_details(pid).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn process_get_icon(pid: u32) -> Result<Option<String>, String> {
    process_details(pid)
        .map(|details| details.icon)
        .map_err(|err| err.to_string())
}

/// An executable's icon drawn sharp at `size` pixels (128 if not given), for
/// showing an app's icon large. Takes a path rather than a process, so it works
/// for an app that isn't running.
#[tauri::command]
pub fn process_get_icon_hd(path: String, size: Option<u32>) -> Result<Option<String>, String> {
    let size = size.unwrap_or(128).clamp(16, MAX_ICON_SIZE) as i32;

    // Gone from where it was: no icon, rather than whatever the shell would
    // make up for a missing file, so the caller falls back to one it kept.
    if !Path::new(&path).is_file() {
        return Ok(None);
    }

    icon_png_bytes_at(Path::new(&path), size)
        .map(|bytes| bytes.map(|bytes| format!("data:image/png;base64,{}", STANDARD.encode(bytes))))
        .map_err(|err| err.to_string())
}

/// Extracts an icon directly from an executable path, without needing a
/// running process. Used as a reliable fallback when an assignment's app
/// isn't currently running (or its process can't be matched by name), since
/// the path is stable even when the name-based cache misses.
#[tauri::command]
pub fn process_get_icon_by_path(path: String) -> Result<Option<String>, String> {
    // As above: a file that's gone has no icon to give.
    if !Path::new(&path).is_file() {
        return Ok(None);
    }

    icon_png_bytes(Path::new(&path))
        .map(|bytes| bytes.map(|bytes| format!("data:image/png;base64,{}", STANDARD.encode(bytes))))
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn process_list_running() -> Result<Vec<ProcessDetails>, String> {
    running_processes().map_err(|err| err.to_string())
}

/// The executable name of every running process, without the path and icon
/// lookups `process_list_running` does for each one. Cheap enough to poll, so
/// the UI can tell an app that's open but silent from one that isn't open.
///
/// Async so it runs off the main thread, which delivers the overlay its events.
#[tauri::command]
pub async fn process_list_running_names() -> Result<Vec<String>, String> {
    running_process_pids()
        .map(|processes| processes.into_iter().map(|(_, name)| name).collect())
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn audio_list_sessions() -> Result<Vec<ProcessDetails>, String> {
    audio_sessions().map_err(|err| err.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The width of the area of an RGBA image that isn't fully transparent.
    fn opaque_width(png: &[u8]) -> u32 {
        let image = image::load_from_memory(png).expect("valid png").to_rgba8();
        let columns: Vec<u32> = image
            .enumerate_pixels()
            .filter(|(_, _, pixel)| pixel[3] > 0)
            .map(|(x, _, _)| x)
            .collect();

        match (columns.iter().min(), columns.iter().max()) {
            (Some(left), Some(right)) => right - left + 1,
            _ => 0,
        }
    }

    #[test]
    fn large_icons_fill_their_canvas() {
        // Explorer is on every Windows install and ships a full set of icon sizes.
        let path = Path::new("C:/Windows/explorer.exe");
        let png = icon_png_bytes_at(path, 128).expect("extract").expect("an icon");
        let image = image::load_from_memory(&png).expect("valid png");

        assert_eq!((image.width(), image.height()), (128, 128));
        // Drawn from a large image, not a 32px one parked in the corner.
        assert!(opaque_width(&png) > 96, "icon only {}px wide", opaque_width(&png));
    }
}
