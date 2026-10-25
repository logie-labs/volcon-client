use std::sync::Mutex;

use serde_json::Value;
use tauri::{AppHandle, State};

use crate::config;
use crate::server::bridge::BridgeApi;
use crate::server::overlay::OverlayNotifier;

pub struct BridgeService {
    app: AppHandle,
    api: Mutex<BridgeApi>,
}

impl BridgeService {
    pub fn new(app: AppHandle) -> Self {
        Self {
            app: app.clone(),
            api: Mutex::new(BridgeApi::new(OverlayNotifier::new(app))),
        }
    }

    pub fn dispatch(&self, command: &str, payload: Option<Value>) -> Result<Value, String> {
        if command == "activate_preset" {
            return self.activate_preset(payload);
        }

        let mut api = self
            .api
            .lock()
            .map_err(|_| "bridge state was poisoned".to_owned())?;
        let result = api
            .dispatch(command, payload)
            .map_err(|err| err.to_string())?;

        if command == "assign_control" || command == "remove_control" {
            self.sync_active_preset_assignments(&api)?;
        }

        Ok(result)
    }

    fn activate_preset(&self, payload: Option<Value>) -> Result<Value, String> {
        let payload = payload.unwrap_or_else(|| serde_json::json!({}));

        let preset_id = payload
            .get("presetId")
            .and_then(Value::as_str)
            .ok_or_else(|| "activate_preset requires presetId".to_owned())?
            .to_owned();

        let controller_id = payload
            .get("controllerId")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned();

        let assignments = payload
            .get("assignments")
            .cloned()
            .map(|value| serde_json::from_value::<Vec<crate::server::models::Assignment>>(value))
            .transpose()
            .map_err(|err| err.to_string())?
            .unwrap_or_default();

        let mut config = config::load_or_create(&self.app)?;
        config.active_preset_id = preset_id.clone();

        if let Some(preset) = config
            .presets
            .iter_mut()
            .find(|preset| preset.id == preset_id)
        {
            preset.assignments = assignments.clone();
        }

        config::save(&self.app, &config)?;

        let mut api = self
            .api
            .lock()
            .map_err(|_| "bridge state was poisoned".to_owned())?;
        let activated = api
            .dispatch(
                "activate_preset",
                Some(serde_json::json!({
                  "presetId": preset_id,
                  "controllerId": controller_id,
                  "assignments": assignments,
                })),
            )
            .map_err(|err| err.to_string())?;

        Ok(activated)
    }

    fn sync_active_preset_assignments(&self, api: &BridgeApi) -> Result<(), String> {
        let active_preset_id = match api.active_preset_id() {
            Some(active_preset_id) => active_preset_id,
            None => return Ok(()),
        };

        let mut config = config::load_or_create(&self.app)?;

        if let Some(preset) = config
            .presets
            .iter_mut()
            .find(|preset| preset.id == active_preset_id)
        {
            preset.assignments = api.assignments();
            config::save(&self.app, &config)?;
        }

        Ok(())
    }
}

#[tauri::command]
pub fn bridge_dispatch(
    state: State<'_, BridgeService>,
    command: String,
    payload: Option<Value>,
) -> Result<Value, String> {
    state.dispatch(&command, payload)
}
