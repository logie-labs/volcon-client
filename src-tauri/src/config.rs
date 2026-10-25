use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

use crate::server::models::Assignment;

const CONFIG_FILE_NAME: &str = "preset-config.json";
const CURRENT_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlledApp {
    pub id: String,
    pub name: String,
    pub percent: u32,
    pub available: bool,
    pub icon_src: String,
    pub icon_alt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MappingCardData {
    pub id: String,
    #[serde(default)]
    pub control: u32,
    pub name: String,
    pub value: u32,
    pub controlled_apps: Vec<ControlledApp>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetEntry {
    pub id: String,
    pub name: String,
    pub controller_id: String,
    pub device_aliases: std::collections::HashMap<String, String>,
    pub group_aliases: std::collections::HashMap<String, String>,
    #[serde(default)]
    pub assignments: Vec<Assignment>,
    pub mappings: Vec<MappingCardData>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetConfig {
    pub schema_version: u32,
    pub active_preset_id: String,
    pub presets: Vec<PresetEntry>,
    #[serde(default, alias = "startMinimized")]
    pub open_to_tray: bool,
    /// Closing the main window hides Volcon in the tray; off, it quits.
    #[serde(default = "on")]
    pub close_to_tray: bool,
    /// When closing quits, the window asks first.
    #[serde(default = "on")]
    pub ask_before_quitting: bool,
    pub node_graphs: Vec<serde_json::Value>,
}

fn on() -> bool {
    true
}

impl Default for PresetConfig {
    fn default() -> Self {
        Self {
            schema_version: CURRENT_SCHEMA_VERSION,
            active_preset_id: String::new(),
            presets: vec![],
            open_to_tray: false,
            close_to_tray: true,
            ask_before_quitting: true,
            node_graphs: vec![],
        }
    }
}

impl PresetConfig {
    /// Drops assignments whose control has no card on their preset, answering
    /// how many went. Nothing shows them, so nothing can change them, yet the
    /// backend would still apply them - a knob quietly moving an app, and a
    /// mapping on another preset warned about as if it were on this one. Older
    /// versions could leave them behind.
    fn drop_orphaned_assignments(&mut self) -> usize {
        let mut dropped = 0;

        for preset in &mut self.presets {
            let controls: std::collections::HashSet<u32> =
                preset.mappings.iter().map(|mapping| mapping.control).collect();
            let before = preset.assignments.len();

            preset
                .assignments
                .retain(|assignment| controls.contains(&u32::from(assignment.control)));
            dropped += before - preset.assignments.len();
        }

        dropped
    }
}

fn config_path<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;

    Ok(config_dir.join(CONFIG_FILE_NAME))
}

pub fn load_or_create<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<PresetConfig, String> {
    let path = config_path(app)?;

    if !path.exists() {
        let config = PresetConfig::default();
        save(app, &config)?;
        return Ok(config);
    }

    let contents = fs::read_to_string(&path).map_err(|error| error.to_string())?;
    let mut parsed =
        serde_json::from_str::<PresetConfig>(&contents).map_err(|error| error.to_string())?;

    let dropped = parsed.drop_orphaned_assignments();

    if dropped > 0 {
        log::info!("dropped {dropped} assignment(s) whose control had no mapping");
        save(app, &parsed)?;
    }

    Ok(parsed)
}

pub fn save<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    config: &PresetConfig,
) -> Result<(), String> {
    let path = config_path(app)?;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let serialized = serde_json::to_string_pretty(config).map_err(|error| error.to_string())?;
    fs::write(path, serialized).map_err(|error| error.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn load_preset_config<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<PresetConfig, String> {
    load_or_create(&app)
}

#[tauri::command]
pub fn save_preset_config<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    mut config: PresetConfig,
) -> Result<(), String> {
    // How the window opens and closes belongs to Settings, which sends it on
    // its own; a preset saved from an older copy mustn't put old values back.
    if let Ok(saved) = load_or_create(&app) {
        config.open_to_tray = saved.open_to_tray;
        config.close_to_tray = saved.close_to_tray;
        config.ask_before_quitting = saved.ask_before_quitting;
    }

    save(&app, &config).and_then(|_| {
        if let Err(error) = crate::tray::refresh_tray_menu(&app) {
            log::warn!("failed to refresh tray menu: {error}");
        }

        Ok(())
    })
}

/// What closing the main window does, as Settings → Behaviour has it.
#[tauri::command]
pub fn set_close_behaviour<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    close_to_tray: bool,
    ask_before_quitting: bool,
) -> Result<(), String> {
    let mut cfg = load_or_create(&app)?;
    cfg.close_to_tray = close_to_tray;
    cfg.ask_before_quitting = ask_before_quitting;
    save(&app, &cfg)
}

#[tauri::command]
pub fn set_open_to_tray<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    enabled: bool,
) -> Result<(), String> {
    let mut cfg = load_or_create(&app)?;
    cfg.open_to_tray = enabled;
    save(&app, &cfg).map_err(|e| e.to_string()).and_then(|_| {
        if let Err(error) = crate::tray::refresh_tray_menu(&app) {
            log::warn!("failed to refresh tray menu: {error}");
        }
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assignment(control: u8, app: &str) -> Assignment {
        serde_json::from_value(serde_json::json!({ "control": control, "app": app, "label": null }))
            .expect("an assignment")
    }

    fn mapping(control: u32) -> MappingCardData {
        MappingCardData {
            id: format!("mapping-{control}"),
            control,
            name: format!("Control {control}"),
            value: 0,
            controlled_apps: vec![],
        }
    }

    #[test]
    fn a_config_from_before_closing_could_quit_closes_to_the_tray() {
        let config: PresetConfig = serde_json::from_value(serde_json::json!({
            "schemaVersion": 1,
            "activePresetId": "",
            "presets": [],
            "openToTray": true,
            "nodeGraphs": [],
        }))
        .expect("an older config still reads");

        assert!(config.open_to_tray);
        assert!(config.close_to_tray);
        assert!(config.ask_before_quitting);
    }

    #[test]
    fn assignments_without_a_card_on_their_preset_are_dropped() {
        let mut config = PresetConfig {
            presets: vec![PresetEntry {
                id: "main".into(),
                name: "Main".into(),
                controller_id: String::new(),
                device_aliases: Default::default(),
                group_aliases: Default::default(),
                // Control 74's card is on another preset; 130 is a parked card.
                assignments: vec![
                    assignment(76, "RobloxPlayerBeta.exe"),
                    assignment(74, "RobloxPlayerBeta.exe"),
                    assignment(130, "Spotify.exe"),
                ],
                mappings: vec![mapping(76), mapping(130)],
            }],
            ..Default::default()
        };

        assert_eq!(config.drop_orphaned_assignments(), 1);

        let controls: Vec<u8> = config.presets[0]
            .assignments
            .iter()
            .map(|assignment| assignment.control)
            .collect();
        assert_eq!(controls, vec![76, 130]);
        assert_eq!(config.drop_orphaned_assignments(), 0);
    }
}
