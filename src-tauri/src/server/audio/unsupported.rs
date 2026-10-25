use crate::server::error::BridgeResult;
use crate::server::process::ProcessDetails;

pub fn audio_apps() -> BridgeResult<Vec<String>> {
    Ok(Vec::new())
}

pub fn audio_sessions() -> BridgeResult<Vec<ProcessDetails>> {
    Ok(Vec::new())
}

pub fn set_master_volume_percent(percent: u8) -> BridgeResult<()> {
    let _ = percent;
    Err("Master volume control is only implemented on Windows.".into())
}
