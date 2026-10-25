use std::collections::HashSet;

use windows::core::Interface;
use windows::Win32::Foundation::RPC_E_CHANGED_MODE;
use windows::Win32::Media::Audio::{
    eMultimedia, eRender, IAudioSessionControl2, IAudioSessionManager2, IMMDeviceEnumerator,
    MMDeviceEnumerator,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED,
};

use crate::server::error::BridgeResult;
use crate::server::process::{process_details, ProcessDetails};

pub(crate) struct ComGuard {
    uninitialize: bool,
}

impl Drop for ComGuard {
    fn drop(&mut self) {
        if self.uninitialize {
            unsafe { CoUninitialize() };
        }
    }
}

pub(super) fn initialize_audio_thread() -> BridgeResult<ComGuard> {
    let result = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
    if result == RPC_E_CHANGED_MODE {
        return Ok(ComGuard {
            uninitialize: false,
        });
    }

    result.ok()?;
    Ok(ComGuard { uninitialize: true })
}

pub(super) fn session_enumerator(
) -> BridgeResult<windows::Win32::Media::Audio::IAudioSessionEnumerator> {
    let enumerator: IMMDeviceEnumerator =
        unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)? };
    let device = unsafe { enumerator.GetDefaultAudioEndpoint(eRender, eMultimedia)? };
    let manager: IAudioSessionManager2 = unsafe { device.Activate(CLSCTX_ALL, None)? };
    unsafe { Ok(manager.GetSessionEnumerator()?) }
}

pub fn audio_sessions() -> BridgeResult<Vec<ProcessDetails>> {
    let _com = initialize_audio_thread()?;
    let sessions = session_enumerator()?;
    let count = unsafe { sessions.GetCount()? };
    let mut pids = HashSet::new();
    let mut details = Vec::new();

    for index in 0..count {
        let Ok(control) = (unsafe { sessions.GetSession(index) }) else {
            continue;
        };
        let Ok(control2) = control.cast::<IAudioSessionControl2>() else {
            continue;
        };
        let Ok(pid) = (unsafe { control2.GetProcessId() }) else {
            continue;
        };
        if pid == 0 {
            continue;
        }
        if !pids.insert(pid) {
            continue;
        }

        if let Ok(detail) = process_details(pid) {
            details.push(detail);
        }
    }

    details.sort_by_key(|detail| detail.name.to_lowercase());
    Ok(details)
}

pub fn audio_apps() -> BridgeResult<Vec<String>> {
    let mut apps: Vec<_> = audio_sessions()?
        .into_iter()
        .map(|details| details.name)
        .collect();
    apps.sort_by_key(|app| app.to_lowercase());
    apps.dedup();
    Ok(apps)
}
