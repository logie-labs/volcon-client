//! The app's log, and what Settings → Diagnostics can find out about the app.
//!
//! Everything logged goes to `volcon.log` in the app's log folder (and to the
//! terminal in a dev build). How much gets written is Settings' call, made at
//! runtime: the logger itself lets everything through, and the global maximum
//! level - which every `log` macro checks before it formats anything - is what
//! the setting moves. A message below it costs a comparison and nothing else,
//! so the per-message trace logging behind "Verbose logging" is free while off.

use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};

use log::LevelFilter;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, Runtime};

/// The log file's name, without the `.log`.
const LOG_FILE: &str = "volcon";

/// How large the log grows before it's set aside and a fresh one started.
const MAX_LOG_BYTES: u128 = 2 * 1024 * 1024;

/// How many log files are kept, the current one included.
const KEEP_LOGS: usize = 3;

/// The least serious messages still written, as Settings names them.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum LogLevel {
    Error,
    Warn,
    Info,
    Debug,
}

impl LogLevel {
    pub fn parse(name: &str) -> Option<Self> {
        match name {
            "error" => Some(Self::Error),
            "warn" => Some(Self::Warn),
            "info" => Some(Self::Info),
            "debug" => Some(Self::Debug),
            _ => None,
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Self::Error => "error",
            Self::Warn => "warn",
            Self::Info => "info",
            Self::Debug => "debug",
        }
    }

    fn from_u8(value: u8) -> Self {
        match value {
            0 => Self::Error,
            1 => Self::Warn,
            3 => Self::Debug,
            _ => Self::Info,
        }
    }

    fn filter(self) -> LevelFilter {
        match self {
            Self::Error => LevelFilter::Error,
            Self::Warn => LevelFilter::Warn,
            Self::Info => LevelFilter::Info,
            Self::Debug => LevelFilter::Debug,
        }
    }
}

static LEVEL: AtomicU8 = AtomicU8::new(LogLevel::Info as u8);
static VERBOSE: AtomicBool = AtomicBool::new(false);

/// Sets how much is logged from now on. Verbose adds the trace messages - every
/// controller message and volume change - on top of whatever the level is.
pub fn set_logging(level: LogLevel, verbose: bool) {
    LEVEL.store(level as u8, Ordering::Relaxed);
    VERBOSE.store(verbose, Ordering::Relaxed);
    log::set_max_level(max_level(level, verbose));
}

/// The level and verbosity in force.
pub fn logging() -> (LogLevel, bool) {
    (
        LogLevel::from_u8(LEVEL.load(Ordering::Relaxed)),
        VERBOSE.load(Ordering::Relaxed),
    )
}

fn max_level(level: LogLevel, verbose: bool) -> LevelFilter {
    if verbose {
        LevelFilter::Trace
    } else {
        level.filter()
    }
}

/// The log plugin, writing to the log folder. It passes everything it's given;
/// [`set_logging`] decides what that is.
pub fn log_plugin<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    use tauri_plugin_log::{RotationStrategy, Target, TargetKind, TimezoneStrategy};

    let mut targets = vec![Target::new(TargetKind::LogDir {
        file_name: Some(LOG_FILE.into()),
    })];

    if cfg!(debug_assertions) {
        targets.push(Target::new(TargetKind::Stdout));
    }

    tauri_plugin_log::Builder::new()
        .clear_targets()
        .targets(targets)
        .timezone_strategy(TimezoneStrategy::UseLocal)
        .max_file_size(MAX_LOG_BYTES)
        .rotation_strategy(RotationStrategy::KeepSome(KEEP_LOGS))
        .level(LevelFilter::Trace)
        // The window and webview libraries trace every event loop turn, which
        // would bury the app's own messages when verbose logging is on.
        .level_for("tao", LevelFilter::Warn)
        .level_for("wry", LevelFilter::Warn)
        .level_for("tauri", LevelFilter::Info)
        .build()
}

/// Puts the default level back in force once the logger is up: attaching it
/// opens the maximum level all the way, and Settings only sends its own once
/// the window has loaded.
pub fn apply_default_logging() {
    let (level, verbose) = logging();
    set_logging(level, verbose);
}

/// Opens the folder holding the log in Explorer, creating it if nothing has
/// been written yet.
#[tauri::command]
pub fn open_logs_folder<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let dir = app.path().app_log_dir().map_err(|err| err.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|err| err.to_string())?;

    std::process::Command::new("explorer")
        .arg(&dir)
        .spawn()
        .map_err(|err| format!("couldn't open {}: {err}", dir.display()))?;

    Ok(())
}

/// What a bug report needs to know about this install.
#[tauri::command]
pub fn diagnostics_info<R: Runtime>(app: AppHandle<R>) -> Value {
    let (level, verbose) = logging();

    json!({
        "appVersion": app.package_info().version.to_string(),
        "tauriVersion": tauri::VERSION,
        "os": os_version(),
        "logDir": app
            .path()
            .app_log_dir()
            .ok()
            .map(|dir| dir.display().to_string()),
        "logging": {
            "level": level.name(),
            "verbose": verbose,
        },
    })
}

/// The Windows edition, release and build, such as "Windows 11 Pro 25H2 (build
/// 26200.6899)".
#[cfg(target_os = "windows")]
fn os_version() -> String {
    use windows::core::{w, PCWSTR};
    use windows::Win32::System::Registry::{
        RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_DWORD, RRF_RT_REG_SZ,
    };

    const KEY: PCWSTR = w!("SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion");

    fn text(name: PCWSTR) -> Option<String> {
        let mut buffer = [0u16; 256];
        let mut size = std::mem::size_of_val(&buffer) as u32;

        unsafe {
            RegGetValueW(
                HKEY_LOCAL_MACHINE,
                KEY,
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

    fn number(name: PCWSTR) -> Option<u32> {
        let mut value = 0u32;
        let mut size = std::mem::size_of::<u32>() as u32;

        unsafe {
            RegGetValueW(
                HKEY_LOCAL_MACHINE,
                KEY,
                name,
                RRF_RT_REG_DWORD,
                None,
                Some((&mut value as *mut u32).cast()),
                Some(&mut size),
            )
        }
        .ok()
        .ok()?;

        Some(value)
    }

    let build = text(w!("CurrentBuildNumber"));
    let mut product = text(w!("ProductName")).unwrap_or_else(|| "Windows".into());

    // Windows 11 kept Windows 10's product name in the registry; the build
    // number is what tells them apart.
    if build
        .as_deref()
        .and_then(|build| build.parse::<u32>().ok())
        .is_some_and(|build| build >= 22000)
    {
        product = product.replace("Windows 10", "Windows 11");
    }

    let mut version = product;

    if let Some(release) = text(w!("DisplayVersion")) {
        version.push(' ');
        version.push_str(&release);
    }

    if let Some(build) = build {
        match number(w!("UBR")) {
            Some(revision) => version.push_str(&format!(" (build {build}.{revision})")),
            None => version.push_str(&format!(" (build {build})")),
        }
    }

    version
}

#[cfg(not(target_os = "windows"))]
fn os_version() -> String {
    std::env::consts::OS.to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn level_names_round_trip() {
        for level in [LogLevel::Error, LogLevel::Warn, LogLevel::Info, LogLevel::Debug] {
            assert_eq!(LogLevel::parse(level.name()), Some(level));
            assert_eq!(LogLevel::from_u8(level as u8), level);
        }

        assert_eq!(LogLevel::parse("trace"), None);
    }

    #[test]
    fn verbose_logs_everything_whatever_the_level() {
        assert_eq!(max_level(LogLevel::Error, true), LevelFilter::Trace);
        assert_eq!(max_level(LogLevel::Error, false), LevelFilter::Error);
        assert_eq!(max_level(LogLevel::Debug, false), LevelFilter::Debug);
    }

    #[test]
    fn setting_the_level_moves_the_global_maximum() {
        set_logging(LogLevel::Warn, false);
        assert_eq!(logging(), (LogLevel::Warn, false));
        assert_eq!(log::max_level(), LevelFilter::Warn);

        set_logging(LogLevel::Warn, true);
        assert_eq!(log::max_level(), LevelFilter::Trace);

        set_logging(LogLevel::Info, false);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn reports_the_windows_build() {
        let version = os_version();
        assert!(version.starts_with("Windows"), "{version}");
        assert!(version.contains("(build "), "{version}");
    }
}
