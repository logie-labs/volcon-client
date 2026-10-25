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
    pub node_graphs: Vec<serde_json::Value>,
}

impl Default for PresetConfig {
    fn default() -> Self {
        Self {
            schema_version: CURRENT_SCHEMA_VERSION,
            active_preset_id: String::new(),
            presets: vec![],
            open_to_tray: false,
            node_graphs: vec![],
        }
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
    let parsed =
        serde_json::from_str::<PresetConfig>(&contents).map_err(|error| error.to_string())?;

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
    config: PresetConfig,
) -> Result<(), String> {
    save(&app, &config).and_then(|_| {
        if let Err(error) = crate::tray::refresh_tray_menu(&app) {
            log::warn!("failed to refresh tray menu: {error}");
        }

        Ok(())
    })
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
