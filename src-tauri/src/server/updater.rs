//! Downloading a new version of Volcon, and installing it.
//!
//! The installer comes from the release on GitHub - only ever from Volcon's
//! own releases - fetched in the background through Windows' own HTTP stack,
//! so the system's proxy settings apply. It's checked against the size and
//! SHA-256 GitHub lists for it before it's kept. Then it runs as a silent
//! update, which installs over the old version instead of uninstalling it
//! first and reopens Volcon when it's done: straight away if asked, or else the
//! next time Volcon starts.

use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

/// Where installers may come from.
const RELEASES: &str = "https://github.com/logie-labs/volcon-client/releases/download/";

/// The installer's switches: silent, as an update over the installed version,
/// and reopening Volcon when it's done.
const INSTALL_ARGS: [&str; 3] = ["/S", "/UPDATE", "/R"];

/// Launches that may try a downloaded update before it's left for the Updates
/// page, so one that won't install can't keep Volcon from opening.
const LAUNCH_ATTEMPTS: u32 = 2;

/// No installer comes anywhere near this; a size past it is a mistake.
const MAX_INSTALLER_BYTES: u64 = 512 * 1024 * 1024;

const PROGRESS_EVERY: Duration = Duration::from_millis(100);

/// The error a download ends with when it's called off.
const CANCELLED: &str = "cancelled";

/// Where an update stands, for the Updates page.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "phase", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum UpdateState {
    Idle,
    Downloading {
        version: String,
        received: u64,
        total: u64,
    },
    /// Downloaded and checked. It installs the next time Volcon starts, unless
    /// it's installed sooner; `failed_at_launch` says those launches tried and
    /// it didn't go in.
    Ready {
        version: String,
        failed_at_launch: bool,
    },
    Failed {
        version: String,
        reason: String,
    },
}

/// A downloaded update, noted beside its installer for the next launch.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Pending {
    version: String,
    /// The installer's file name, in the updates folder.
    file: String,
    sha256: String,
    /// Launches that have tried to install it.
    #[serde(default)]
    attempts: u32,
}

pub struct Updater {
    state: Mutex<UpdateState>,
    cancel: AtomicBool,
}

impl Updater {
    /// Picks up an update downloaded before, which is still ready to go in.
    pub fn new<R: Runtime>(app: &AppHandle<R>) -> Self {
        let state = updates_dir(&app.config().identifier)
            .and_then(|dir| read_pending(&dir).map(|pending| (dir, pending)))
            .filter(|(dir, pending)| {
                newer_than_running(app, &pending.version) && dir.join(&pending.file).is_file()
            })
            .map(|(_, pending)| UpdateState::Ready {
                failed_at_launch: pending.attempts >= LAUNCH_ATTEMPTS,
                version: pending.version,
            })
            .unwrap_or(UpdateState::Idle);

        Self {
            state: Mutex::new(state),
            cancel: AtomicBool::new(false),
        }
    }

    fn set<R: Runtime>(&self, app: &AppHandle<R>, next: UpdateState) {
        *self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = next.clone();
        let _ = app.emit("update:state", next);
    }

    fn get(&self) -> UpdateState {
        self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).clone()
    }
}

/// `%LOCALAPPDATA%\<identifier>\updates`, beside Volcon's other local data -
/// the same folder whether or not the app is up yet.
fn updates_dir(identifier: &str) -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(|base| PathBuf::from(base).join(identifier).join("updates"))
}

fn pending_path(dir: &Path) -> PathBuf {
    dir.join("pending.json")
}

fn read_pending(dir: &Path) -> Option<Pending> {
    serde_json::from_str(&fs::read_to_string(pending_path(dir)).ok()?).ok()
}

fn write_pending(dir: &Path, pending: &Pending) -> Result<(), String> {
    let json = serde_json::to_string_pretty(pending).map_err(|err| err.to_string())?;
    fs::write(pending_path(dir), json).map_err(|err| err.to_string())
}

/// Empties the updates folder: the installer, its note, anything half-done.
fn clear(dir: &Path) {
    let _ = fs::remove_dir_all(dir);
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn sha256_of(path: &Path) -> Option<String> {
    let mut file = File::open(path).ok()?;
    let mut hasher = Sha256::new();
    std::io::copy(&mut file, &mut hasher).ok()?;
    Some(hex(&hasher.finalize()))
}

/// The installer, if it's still there and still what was downloaded.
fn checked_installer(dir: &Path, pending: &Pending) -> Option<PathBuf> {
    let path = dir.join(&pending.file);
    (sha256_of(&path)? == pending.sha256).then_some(path)
}

/// The installer's file name, if `url` downloads an installer from one of
/// Volcon's releases - and nothing else.
fn installer_name(url: &str) -> Option<&str> {
    let (tag, name) = url.strip_prefix(RELEASES)?.split_once('/')?;
    let plain = |part: &str| {
        !part.is_empty()
            && !part.contains("..")
            && part.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
    };

    (plain(tag) && plain(name) && name.ends_with("-setup.exe")).then_some(name)
}

/// A SHA-256 as GitHub gives one, "sha256:" first, as plain lowercase hex.
fn parse_digest(digest: &str) -> Option<String> {
    let hex = digest.strip_prefix("sha256:").unwrap_or(digest).to_ascii_lowercase();
    (hex.len() == 64 && hex.chars().all(|c| c.is_ascii_hexdigit())).then_some(hex)
}

fn newer_than_running<R: Runtime>(app: &AppHandle<R>, version: &str) -> bool {
    semver::Version::parse(version).is_ok_and(|version| version > app.package_info().version)
}

/// What to fetch, from the release the Updates page found.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRequest {
    version: String,
    url: String,
    size: u64,
    /// As GitHub lists it; older releases may not have one.
    sha256: Option<String>,
}

/// Fetches the installer to `dir`, checks it, and notes it for the next
/// launch. Answers with the error to show, or `CANCELLED`.
fn download<R: Runtime>(
    app: &AppHandle<R>,
    updater: &Updater,
    dir: &Path,
    name: &str,
    request: &DownloadRequest,
    expected: Option<&str>,
) -> Result<(), String> {
    // One update at a time: a newer one replaces anything older.
    clear(dir);
    fs::create_dir_all(dir).map_err(|err| format!("couldn't make the folder for updates: {err}"))?;

    let part = dir.join(format!("{name}.part"));
    let mut file = File::create(&part).map_err(|err| format!("couldn't save the download: {err}"))?;
    let mut hasher = Sha256::new();
    let mut received = 0u64;
    let mut reported = Instant::now();

    http::get(&request.url, |chunk| {
        if updater.cancel.load(Ordering::SeqCst) {
            return Err(CANCELLED.into());
        }

        file.write_all(chunk)
            .map_err(|err| format!("couldn't save the download: {err}"))?;
        hasher.update(chunk);
        received += chunk.len() as u64;

        if received > MAX_INSTALLER_BYTES {
            return Err("the download is far bigger than an installer".into());
        }

        if reported.elapsed() >= PROGRESS_EVERY {
            reported = Instant::now();
            updater.set(
                app,
                UpdateState::Downloading {
                    version: request.version.clone(),
                    received,
                    total: request.size,
                },
            );
        }

        Ok(())
    })?;

    file.flush().map_err(|err| format!("couldn't save the download: {err}"))?;
    drop(file);

    if received != request.size {
        return Err(format!(
            "the download stopped short, at {received} of {} bytes",
            request.size
        ));
    }

    let digest = hex(&hasher.finalize());

    if expected.is_some_and(|expected| expected != digest) {
        return Err("the download doesn't match the release, so it may have been damaged on the way".into());
    }

    fs::rename(&part, dir.join(name)).map_err(|err| format!("couldn't keep the download: {err}"))?;

    write_pending(
        dir,
        &Pending {
            version: request.version.clone(),
            file: name.to_owned(),
            sha256: digest,
            attempts: 0,
        },
    )
}

/// Where an update stands now.
#[tauri::command]
pub fn update_state(updater: State<'_, Updater>) -> UpdateState {
    updater.get()
}

/// Starts downloading an update, in the background. How it goes arrives as
/// `update:state` events.
#[tauri::command]
pub fn update_download<R: Runtime>(
    app: AppHandle<R>,
    updater: State<'_, Updater>,
    request: DownloadRequest,
) -> Result<(), String> {
    let name = installer_name(&request.url)
        .ok_or("That isn't one of Volcon's installers.")?
        .to_owned();

    if !newer_than_running(&app, &request.version) {
        return Err(format!("{} isn't newer than the version running.", request.version));
    }

    if request.size == 0 || request.size > MAX_INSTALLER_BYTES {
        return Err("The installer's size doesn't look right.".into());
    }

    let expected = match request.sha256.as_deref() {
        Some(digest) => Some(parse_digest(digest).ok_or("The installer's checksum doesn't look right.")?),
        None => None,
    };

    if matches!(updater.get(), UpdateState::Downloading { .. }) {
        return Err("An update is already downloading.".into());
    }

    let dir = updates_dir(&app.config().identifier).ok_or("Couldn't find the folder for updates.")?;

    updater.cancel.store(false, Ordering::SeqCst);
    updater.set(
        &app,
        UpdateState::Downloading {
            version: request.version.clone(),
            received: 0,
            total: request.size,
        },
    );

    let app = app.clone();

    std::thread::spawn(move || {
        let updater = app.state::<Updater>();
        let version = request.version.clone();

        let next = match download(&app, &updater, &dir, &name, &request, expected.as_deref()) {
            Ok(()) => {
                log::info!("update {version} downloaded");
                UpdateState::Ready { version, failed_at_launch: false }
            }
            Err(reason) => {
                clear(&dir);

                if reason == CANCELLED {
                    log::info!("update {version} download cancelled");
                    UpdateState::Idle
                } else {
                    log::warn!("update {version} download failed: {reason}");
                    UpdateState::Failed { version, reason }
                }
            }
        };

        updater.set(&app, next);
    });

    Ok(())
}

/// Calls off a download under way.
#[tauri::command]
pub fn update_cancel(updater: State<'_, Updater>) {
    updater.cancel.store(true, Ordering::SeqCst);
}

/// Throws away a downloaded update, or stops one downloading.
#[tauri::command]
pub fn update_discard<R: Runtime>(app: AppHandle<R>, updater: State<'_, Updater>) {
    updater.cancel.store(true, Ordering::SeqCst);

    if let Some(dir) = updates_dir(&app.config().identifier) {
        clear(&dir);
    }

    updater.set(&app, UpdateState::Idle);
}

/// Installs the downloaded update now: the installer takes over, Volcon
/// closes, and the new version opens when it's done.
#[tauri::command]
pub fn update_install_now<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    // It would replace the installed copy, not this one.
    if cfg!(debug_assertions) {
        return Err("A development build doesn't install updates.".into());
    }

    let dir = updates_dir(&app.config().identifier).ok_or("Couldn't find the folder for updates.")?;
    let pending = read_pending(&dir).ok_or("There's no downloaded update to install.")?;
    let installer = checked_installer(&dir, &pending)
        .ok_or("The downloaded update is missing or damaged. Download it again.")?;

    Command::new(&installer)
        .args(INSTALL_ARGS)
        .spawn()
        .map_err(|err| format!("Couldn't start the installer: {err}"))?;

    log::info!("installing update {} now", pending.version);
    app.exit(0);
    Ok(())
}

/// Installs an update downloaded before, as Volcon starts and before anything
/// opens. Answers whether the installer has taken over, in which case Volcon
/// closes and the installer opens the new version when it's done.
pub fn install_pending_at_launch(identifier: &str, running: &semver::Version) -> bool {
    let Some(dir) = updates_dir(identifier) else {
        return false;
    };

    let Some(mut pending) = read_pending(&dir) else {
        return false;
    };

    if !semver::Version::parse(&pending.version).is_ok_and(|version| &version > running) {
        // It's in - or this version is newer anyway. Either way it's done with.
        clear(&dir);
        return false;
    }

    if pending.attempts >= LAUNCH_ATTEMPTS {
        return false;
    }

    let Some(installer) = checked_installer(&dir, &pending) else {
        clear(&dir);
        return false;
    };

    // Counted first: if it can't be, trying risks trying forever.
    pending.attempts += 1;

    if write_pending(&dir, &pending).is_err() {
        return false;
    }

    Command::new(installer).args(INSTALL_ARGS).spawn().is_ok()
}

/// A plain HTTPS GET through WinHTTP, which follows GitHub's redirect to where
/// the file really is.
mod http {
    use std::ffi::c_void;

    use windows::core::{w, HSTRING, PCWSTR, PWSTR};
    use windows::Win32::Networking::WinHttp::{
        WinHttpCloseHandle, WinHttpConnect, WinHttpCrackUrl, WinHttpOpen, WinHttpOpenRequest,
        WinHttpQueryHeaders, WinHttpReadData, WinHttpReceiveResponse, WinHttpSendRequest,
        WinHttpSetTimeouts, URL_COMPONENTS, WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
        WINHTTP_FLAG_SECURE, WINHTTP_QUERY_FLAG_NUMBER, WINHTTP_QUERY_STATUS_CODE,
    };

    struct Handle(*mut c_void);

    impl Drop for Handle {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe {
                    let _ = WinHttpCloseHandle(self.0);
                }
            }
        }
    }

    fn opened(handle: *mut c_void, doing: &str) -> Result<Handle, String> {
        if handle.is_null() {
            Err(failure(doing, windows::core::Error::from_win32()))
        } else {
            Ok(Handle(handle))
        }
    }

    /// What went wrong, in words. WinHTTP's own errors aren't in the system's
    /// message table, so the usual ones are spelled out here.
    fn failure(doing: &str, error: windows::core::Error) -> String {
        let code = error.code().0 as u32 & 0xFFFF;
        let reason = match code {
            12002 => "the connection timed out".to_owned(),
            12007 => "GitHub couldn't be found - check the connection".to_owned(),
            12029 | 12030 => "the connection to GitHub failed".to_owned(),
            12175 => "a secure connection couldn't be made".to_owned(),
            _ => {
                let message = error.message();
                let message = message.trim();

                if message.is_empty() {
                    format!("error {code}")
                } else {
                    message.to_owned()
                }
            }
        };

        format!("{doing}: {reason}")
    }

    fn piece(pointer: PWSTR, len: u32) -> String {
        if pointer.is_null() || len == 0 {
            return String::new();
        }

        String::from_utf16_lossy(unsafe { std::slice::from_raw_parts(pointer.0, len as usize) })
    }

    fn number(request: &Handle, info: u32) -> Option<u32> {
        let mut value = 0u32;
        let mut size = std::mem::size_of::<u32>() as u32;

        unsafe {
            WinHttpQueryHeaders(
                request.0,
                info | WINHTTP_QUERY_FLAG_NUMBER,
                PCWSTR::null(),
                Some((&mut value as *mut u32).cast()),
                &mut size,
                std::ptr::null_mut(),
            )
        }
        .ok()?;

        Some(value)
    }

    /// Fetches `url`, handing over the body as it arrives. `on_chunk` can stop
    /// it by answering with an error.
    pub fn get(url: &str, mut on_chunk: impl FnMut(&[u8]) -> Result<(), String>) -> Result<(), String> {
        let wide: Vec<u16> = url.encode_utf16().collect();
        let mut parts = URL_COMPONENTS {
            dwStructSize: std::mem::size_of::<URL_COMPONENTS>() as u32,
            // Lengths that aren't zero ask for each part to be found in `wide`.
            dwHostNameLength: u32::MAX,
            dwUrlPathLength: u32::MAX,
            dwExtraInfoLength: u32::MAX,
            ..Default::default()
        };

        unsafe { WinHttpCrackUrl(&wide, 0, &mut parts) }
            .map_err(|err| failure("couldn't read the address", err))?;

        let host = HSTRING::from(piece(parts.lpszHostName, parts.dwHostNameLength));
        let path = HSTRING::from(
            piece(parts.lpszUrlPath, parts.dwUrlPathLength)
                + &piece(parts.lpszExtraInfo, parts.dwExtraInfoLength),
        );

        let session = opened(
            unsafe {
                WinHttpOpen(
                    w!("Volcon"),
                    WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
                    PCWSTR::null(),
                    PCWSTR::null(),
                    0,
                )
            },
            "couldn't start a connection",
        )?;

        // Thirty seconds to connect, and for each piece to arrive.
        unsafe {
            let _ = WinHttpSetTimeouts(session.0, 30_000, 30_000, 30_000, 30_000);
        }

        let connection = opened(
            unsafe { WinHttpConnect(session.0, &host, parts.nPort, 0) },
            "couldn't reach GitHub",
        )?;
        let request = opened(
            unsafe {
                WinHttpOpenRequest(
                    connection.0,
                    w!("GET"),
                    &path,
                    PCWSTR::null(),
                    PCWSTR::null(),
                    std::ptr::null(),
                    WINHTTP_FLAG_SECURE,
                )
            },
            "couldn't ask for the download",
        )?;

        unsafe { WinHttpSendRequest(request.0, None, None, 0, 0, 0) }
            .map_err(|err| failure("couldn't ask for the download", err))?;
        unsafe { WinHttpReceiveResponse(request.0, std::ptr::null_mut()) }
            .map_err(|err| failure("GitHub didn't answer", err))?;

        let status = number(&request, WINHTTP_QUERY_STATUS_CODE).unwrap_or(0);

        if status != 200 {
            return Err(format!("GitHub answered with {status} instead of the file"));
        }

        let mut buffer = vec![0u8; 64 * 1024];

        loop {
            let mut read = 0u32;

            unsafe {
                WinHttpReadData(
                    request.0,
                    buffer.as_mut_ptr().cast(),
                    buffer.len() as u32,
                    &mut read,
                )
            }
            .map_err(|err| failure("the download broke off", err))?;

            if read == 0 {
                return Ok(());
            }

            on_chunk(&buffer[..read as usize])?;
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        /// Goes over the internet, so it's run by hand: `cargo test -- --ignored`.
        #[test]
        #[ignore]
        fn follows_githubs_redirect_to_a_release_file() {
            let mut body = Vec::new();

            get(
                "https://github.com/BurntSushi/ripgrep/releases/download/14.1.1/ripgrep-14.1.1-x86_64-pc-windows-msvc.zip.sha256",
                |chunk| {
                    body.extend_from_slice(chunk);
                    Ok(())
                },
            )
            .expect("downloaded");

            let text = String::from_utf8_lossy(&body);
            assert!(text.contains("ripgrep-14.1.1-x86_64-pc-windows-msvc.zip"), "{text}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_installers_from_volcons_releases_are_fetched() {
        assert_eq!(
            installer_name(
                "https://github.com/logie-labs/volcon-client/releases/download/v0.1.2/Volcon_0.1.2_x64-setup.exe"
            ),
            Some("Volcon_0.1.2_x64-setup.exe")
        );

        for url in [
            "https://github.com/someone-else/volcon-client/releases/download/v0.1.2/Volcon_0.1.2_x64-setup.exe",
            "https://github.com/logie-labs/volcon-client/releases/download/v0.1.2/notes.txt",
            "https://github.com/logie-labs/volcon-client/releases/download/v0.1.2/../evil-setup.exe",
            "https://github.com/logie-labs/volcon-client/releases/download/v0.1.2/a/b-setup.exe",
            "http://github.com/logie-labs/volcon-client/releases/download/v0.1.2/Volcon_0.1.2_x64-setup.exe",
        ] {
            assert_eq!(installer_name(url), None, "{url}");
        }
    }

    #[test]
    fn digests_read_with_or_without_their_prefix() {
        let hex = "ab".repeat(32);

        assert_eq!(parse_digest(&format!("sha256:{}", hex.to_uppercase())), Some(hex.clone()));
        assert_eq!(parse_digest(&hex), Some(hex));
        assert_eq!(parse_digest("sha256:abc"), None);
        assert_eq!(parse_digest(&"zz".repeat(32)), None);
    }

    #[test]
    fn a_pending_update_is_cleared_once_its_version_is_running() {
        let identifier = format!("volcon-updater-test-{}", std::process::id());
        let dir = updates_dir(&identifier).expect("LOCALAPPDATA");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("Volcon_0.1.2_x64-setup.exe"), b"installer").unwrap();
        write_pending(
            &dir,
            &Pending {
                version: "0.1.2".into(),
                file: "Volcon_0.1.2_x64-setup.exe".into(),
                sha256: sha256_of(&dir.join("Volcon_0.1.2_x64-setup.exe")).unwrap(),
                attempts: 0,
            },
        )
        .unwrap();

        let running = semver::Version::parse("0.1.2").unwrap();
        assert!(!install_pending_at_launch(&identifier, &running));
        assert!(!dir.exists(), "the installer is cleared away once it's in");

        let _ = fs::remove_dir_all(dir.parent().unwrap());
    }

    #[test]
    fn a_damaged_download_is_never_run() {
        let identifier = format!("volcon-updater-test-damaged-{}", std::process::id());
        let dir = updates_dir(&identifier).expect("LOCALAPPDATA");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("Volcon_9.0.0_x64-setup.exe"), b"not what was downloaded").unwrap();
        write_pending(
            &dir,
            &Pending {
                version: "9.0.0".into(),
                file: "Volcon_9.0.0_x64-setup.exe".into(),
                sha256: "00".repeat(32),
                attempts: 0,
            },
        )
        .unwrap();

        let running = semver::Version::parse("0.1.2").unwrap();
        assert!(!install_pending_at_launch(&identifier, &running));
        assert!(!dir.exists(), "a damaged download is thrown away");

        let _ = fs::remove_dir_all(dir.parent().unwrap());
    }
}
