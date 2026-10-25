use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use midir::{Ignore, MidiInput, MidiInputConnection};
use serde_json::{json, Value};

use crate::server::audio::{audio_apps, AudioApplyLoop};
use crate::server::diagnostics::{self, LogLevel};
use crate::server::error::{BridgeError, BridgeResult};
use crate::server::input::deadzone::Deadzone;
use crate::server::input::midi::{midi_inputs, parse_control_change};
use crate::server::models::{Assignment, BridgeState, MidiControlEvent};
use crate::server::overlay::{ControlProgressEvent, OverlayNotifier};
use crate::server::state::{AppLevel, PeakMeters, VolumeCurve, VolumeState};

pub struct BridgeApi {
    state: Arc<Mutex<BridgeState>>,
    connection: Option<MidiInputConnection<()>>,
    overlay: OverlayNotifier,
    volume_state: VolumeState,
    deadzone: Deadzone,
    meters: PeakMeters,
    _audio_apply_loop: AudioApplyLoop,
}

impl BridgeApi {
    pub fn new(overlay: OverlayNotifier) -> Self {
        let volume_state = VolumeState::default();
        let meters = PeakMeters::default();
        let audio_apply_loop =
            AudioApplyLoop::start(volume_state.clone(), overlay.clone(), meters.clone());

        Self {
            state: Arc::new(Mutex::new(BridgeState::default())),
            connection: None,
            overlay,
            volume_state,
            deadzone: Deadzone::default(),
            meters,
            _audio_apply_loop: audio_apply_loop,
        }
    }

    pub fn selected_input(&self) -> Option<String> {
        self.state
            .lock()
            .expect("state poisoned")
            .selected_input
            .clone()
    }

    pub fn active_preset_id(&self) -> Option<String> {
        self.state
            .lock()
            .expect("state poisoned")
            .active_preset_id
            .clone()
    }

    pub fn assignments(&self) -> Vec<Assignment> {
        self.state
            .lock()
            .expect("state poisoned")
            .assignments
            .clone()
    }

    pub fn control_marker(&self) -> u64 {
        self.state.lock().expect("state poisoned").control_sequence
    }

    pub fn wait_for_next_control(
        &self,
        after_sequence: u64,
        timeout: Duration,
    ) -> BridgeResult<MidiControlEvent> {
        let started = Instant::now();

        loop {
            {
                let state = self.state.lock().expect("state poisoned");
                if let Some(event) = state
                    .recent_controls
                    .iter()
                    .rev()
                    .find(|event| event.sequence > after_sequence)
                {
                    return Ok(event.clone());
                }
            }

            if started.elapsed() >= timeout {
                return Err("No controller input was received before the learn timeout.".into());
            }

            thread::sleep(Duration::from_millis(50));
        }
    }

    pub fn dispatch(&mut self, command: &str, payload: Option<Value>) -> BridgeResult<Value> {
        match command {
            "list_inputs" => self.list_inputs(),
            "select_input" => {
                let port_name = payload
                    .as_ref()
                    .and_then(|value| value.get("portName"))
                    .and_then(Value::as_str)
                    .ok_or("select_input requires portName")?;
                self.select_input(port_name)
            }
            "activate_preset" => self.activate_preset(payload.unwrap_or(Value::Null)),
            "list_assignments" => self.list_assignments(),
            "begin_learn" => Ok(self.begin_learn()),
            "poll_learn" => self.poll_learn(payload.unwrap_or(Value::Null)),
            "start_learn" => self.start_learn(payload.unwrap_or(Value::Null)),
            "assign_control" => self.assign_control(payload.unwrap_or(Value::Null)),
            "remove_control" => self.remove_control(payload.unwrap_or(Value::Null)),
            "set_app_levels" => self.set_app_levels(payload.unwrap_or(Value::Null)),
            "release_apps" => self.release_apps(payload.unwrap_or(Value::Null)),
            "set_volume_curve" => self.set_volume_curve(payload.unwrap_or(Value::Null)),
            "set_deadzone" => self.set_deadzone(payload.unwrap_or(Value::Null)),
            "set_logging" => Ok(self.set_logging(payload.unwrap_or(Value::Null))),
            "preview_overlay" => Ok(self.preview_overlay()),
            "get_peaks" => Ok(self.get_peaks(payload.unwrap_or(Value::Null))),
            "stop_peaks" => {
                self.meters.stop();
                Ok(json!({ "ok": true }))
            }
            "refresh_sessions" => self.refresh_sessions(),
            "get_state" => self.get_state(),
            "ping" => Ok(json!({ "ok": true, "message": "pong" })),
            other => Err(format!("unknown command: {other}").into()),
        }
    }

    fn list_inputs(&self) -> BridgeResult<Value> {
        let inputs = midi_inputs()?;
        let selected = self
            .state
            .lock()
            .expect("state poisoned")
            .selected_input
            .clone();

        Ok(json!({
            "ok": true,
            "inputs": inputs,
            "selected": selected,
        }))
    }

    fn select_input(&mut self, port_name: &str) -> BridgeResult<Value> {
        let mut midi_in = MidiInput::new("volcon").map_err(|err| BridgeError(err.to_string()))?;
        midi_in.ignore(Ignore::None);

        let ports = midi_in.ports();
        let (port, actual_name) = ports
            .iter()
            .filter_map(|port| midi_in.port_name(port).ok().map(|name| (port, name)))
            .find(|(_, name)| name == port_name)
            .ok_or_else(|| BridgeError(format!("MIDI input '{port_name}' was not found")))?;

        self.connection.take();

        let state = Arc::clone(&self.state);
        let overlay = self.overlay.clone();
        let volume_state = self.volume_state.clone();
        let mut deadzone = self.deadzone.filter();
        let connection = midi_in
            .connect(
                port,
                "volcon-input",
                move |_stamp, message, _| {
                    if let Some((control, value)) = parse_control_change(message) {
                        // A resting control's wobble never happened, as far as
                        // anything downstream is concerned: not the levels, not
                        // the overlay, and not learn either.
                        if !deadzone.admit(control, value) {
                            log::trace!("control {control} -> {value} (inside the deadzone)");
                            return;
                        }

                        log::trace!("control {control} -> {value}");

                        let assignments = {
                            let mut state = state.lock().expect("state poisoned");
                            state.control_sequence += 1;
                            state.last_control = Some(control);
                            state.last_value = Some(value);
                            let sequence = state.control_sequence;
                            state.recent_controls.push_back(MidiControlEvent {
                                sequence,
                                control,
                                value,
                            });
                            while state.recent_controls.len() > 128 {
                                state.recent_controls.pop_front();
                            }
                            state.assignments.clone()
                        };

                        let matches: Vec<_> = assignments
                            .into_iter()
                            .filter(|assignment| assignment.control == control)
                            .collect();

                        let mut seen_apps = std::collections::HashSet::new();
                        let target_apps: Vec<AppLevel> = matches
                            .iter()
                            .filter_map(|assignment| {
                                if seen_apps.insert(assignment.app.clone()) {
                                    Some(AppLevel::new(
                                        assignment.app.clone(),
                                        assignment.clamped_trim(),
                                        assignment.muted,
                                    ))
                                } else {
                                    None
                                }
                            })
                            .collect();

                        let volume = ((value as f32 / 127.0) * 100.0).round() as u8;
                        overlay.emit_control_progress(ControlProgressEvent {
                            control,
                            value,
                            volume,
                        });

                        // Nothing on this control, so leave the overlay be. Hiding
                        // it here meant a stray message from any unmapped control
                        // (a noisy fader, a pedal, the other half of a 14-bit
                        // pair) knocked the overlay away while a mapped one was
                        // being turned.
                        if target_apps.is_empty() {
                            return;
                        }

                        overlay.emit_show(control);
                        volume_state.set_targets(control, value, &target_apps, true);
                    }
                },
                (),
            )
            .map_err(|err| BridgeError(format!("failed to open MIDI input: {err}")))?;

        log::info!("listening to MIDI input '{actual_name}'");
        self.connection = Some(connection);
        self.state.lock().expect("state poisoned").selected_input = Some(actual_name.clone());

        Ok(json!({
            "ok": true,
            "selected": actual_name,
        }))
    }

    fn activate_preset(&mut self, payload: Value) -> BridgeResult<Value> {
        let preset_id = payload
            .get("presetId")
            .and_then(Value::as_str)
            .ok_or("activate_preset requires presetId")?
            .to_owned();
        let controller_id = payload
            .get("controllerId")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .unwrap_or_default();
        let assignments = payload
            .get("assignments")
            .cloned()
            .map(|value| serde_json::from_value::<Vec<Assignment>>(value))
            .transpose()
            .map_err(|err| BridgeError(format!("invalid assignments for activate_preset: {err}")))?
            .unwrap_or_default();

        let current_selected = self.selected_input();

        {
            let mut state = self.state.lock().expect("state poisoned");
            state.active_preset_id = Some(preset_id.clone());
            state.assignments = assignments;
        }

        if controller_id.is_empty() {
            self.connection.take();
            self.state.lock().expect("state poisoned").selected_input = None;
            return Ok(json!({
                "ok": true,
                "activePresetId": preset_id,
                "selected": null,
            }));
        }

        if self.connection.is_some() && current_selected.as_deref() == Some(controller_id.as_str())
        {
            return Ok(json!({
                "ok": true,
                "activePresetId": preset_id,
                "selected": controller_id,
            }));
        }

        let selected = self.select_input(&controller_id)?;

        Ok(json!({
            "ok": true,
            "activePresetId": preset_id,
            "selected": selected.get("selected").cloned().unwrap_or(Value::Null),
        }))
    }

    fn list_assignments(&self) -> BridgeResult<Value> {
        let assignments = self
            .state
            .lock()
            .expect("state poisoned")
            .assignments
            .clone();
        Ok(json!({
            "ok": true,
            "assignments": assignments,
        }))
    }

    fn begin_learn(&self) -> Value {
        json!({
            "ok": true,
            "afterSequence": self.control_marker(),
        })
    }

    fn poll_learn(&self, payload: Value) -> BridgeResult<Value> {
        let after_sequence = payload
            .get("afterSequence")
            .and_then(Value::as_u64)
            .ok_or("poll_learn requires afterSequence")?;

        let timeout_secs = payload
            .get("timeoutSeconds")
            .and_then(Value::as_u64)
            .unwrap_or(0);

        if timeout_secs > 0 {
            let learned =
                self.wait_for_next_control(after_sequence, Duration::from_secs(timeout_secs))?;
            return Ok(json!({
                "ok": true,
                "ready": true,
                "control": learned.control,
                "value": learned.value,
                "sequence": learned.sequence,
            }));
        }

        let state = self.state.lock().expect("state poisoned");
        if let Some(event) = state
            .recent_controls
            .iter()
            .rev()
            .find(|event| event.sequence > after_sequence)
        {
            return Ok(json!({
                "ok": true,
                "ready": true,
                "control": event.control,
                "value": event.value,
                "sequence": event.sequence,
            }));
        }

        Ok(json!({
            "ok": true,
            "ready": false,
        }))
    }

    fn start_learn(&self, payload: Value) -> BridgeResult<Value> {
        if self.selected_input().is_none() {
            return Err("Select a MIDI input before learning a control.".into());
        }

        let timeout_secs = payload
            .get("timeoutSeconds")
            .and_then(Value::as_u64)
            .unwrap_or(60)
            .clamp(1, 300);
        let marker = self.control_marker();
        let learned = self.wait_for_next_control(marker, Duration::from_secs(timeout_secs))?;

        Ok(json!({
            "ok": true,
            "control": learned.control,
            "value": learned.value,
            "sequence": learned.sequence,
        }))
    }

    fn assign_control(&mut self, payload: Value) -> BridgeResult<Value> {
        let control = payload
            .get("control")
            .and_then(Value::as_u64)
            .ok_or("assign_control requires integer control")?;
        let control =
            u8::try_from(control).map_err(|_| BridgeError("control must be 0-255".into()))?;
        let app = payload
            .get("app")
            .and_then(Value::as_str)
            .ok_or("assign_control requires app")?
            .to_owned();
        let label = payload
            .get("label")
            .and_then(Value::as_str)
            .map(str::to_owned);
        let path = payload
            .get("path")
            .and_then(Value::as_str)
            .map(str::to_owned);
        let trim = payload
            .get("trim")
            .and_then(Value::as_f64)
            .map(|trim| trim as f32)
            .unwrap_or(1.0);
        let muted = payload
            .get("muted")
            .and_then(Value::as_bool)
            .unwrap_or(false);

        let mut state = self.state.lock().expect("state poisoned");
        state
            .assignments
            .retain(|assignment| !(assignment.control == control && assignment.app == app));
        state.assignments.push(Assignment {
            control,
            app,
            label,
            path,
            trim,
            muted,
        });

        Ok(json!({
            "ok": true,
            "assignments": state.assignments,
        }))
    }

    fn remove_control(&mut self, payload: Value) -> BridgeResult<Value> {
        let control = payload
            .get("control")
            .and_then(Value::as_u64)
            .ok_or("remove_control requires integer control")?;
        let control =
            u8::try_from(control).map_err(|_| BridgeError("control must be 0-255".into()))?;
        let app = payload.get("app").and_then(Value::as_str);

        let mut state = self.state.lock().expect("state poisoned");
        let before = state.assignments.len();
        state.assignments.retain(|assignment| {
            if assignment.control != control {
                return true;
            }

            app.is_some_and(|app| assignment.app != app)
        });

        Ok(json!({
            "ok": true,
            "removed": before - state.assignments.len(),
            "assignments": state.assignments,
        }))
    }

    /// Applies a live trim/mute edit straight to the audio thread and to the
    /// in-memory assignments, without the config write `activate_preset` does —
    /// this is the path a trim drag takes, so it has to stay cheap enough to run
    /// on every pointer move.
    fn set_app_levels(&mut self, payload: Value) -> BridgeResult<Value> {
        let control = payload
            .get("control")
            .and_then(Value::as_u64)
            .ok_or("set_app_levels requires integer control")?;
        let control =
            u8::try_from(control).map_err(|_| BridgeError("control must be 0-255".into()))?;

        let entries = payload
            .get("apps")
            .and_then(Value::as_array)
            .ok_or("set_app_levels requires an apps array")?;

        let mut levels: Vec<AppLevel> = Vec::with_capacity(entries.len());

        for entry in entries {
            let Some(app) = entry.get("app").and_then(Value::as_str) else {
                continue;
            };

            let trim = entry
                .get("trim")
                .and_then(Value::as_f64)
                .map(|trim| trim as f32)
                .unwrap_or(1.0);
            let muted = entry.get("muted").and_then(Value::as_bool).unwrap_or(false);

            levels.push(AppLevel::new(app.to_owned(), trim, muted));
        }

        if levels.is_empty() {
            return Ok(json!({ "ok": true, "applied": 0 }));
        }

        // The control's position: whatever the caller passed, else the last value
        // this control actually sent, else wherever these apps already sit. A trim
        // drag has to move the app right away, and the knob may not have been
        // touched since launch — but falling back to zero would answer "I don't
        // know where this control is" by silencing everything on it.
        let value = match payload.get("value").and_then(Value::as_u64) {
            Some(value) => u8::try_from(value.min(127)).unwrap_or(127),
            None => {
                let last = {
                    let state = self.state.lock().expect("state poisoned");
                    match state.last_control {
                        Some(last_control) if last_control == control => state.last_value,
                        _ => None,
                    }
                };

                last.or_else(|| self.volume_state.control_value(control))
                    .unwrap_or(0)
            }
        };

        {
            let mut state = self.state.lock().expect("state poisoned");
            for level in &levels {
                for assignment in state
                    .assignments
                    .iter_mut()
                    .filter(|assignment| assignment.control == control && assignment.app == level.app)
                {
                    assignment.trim = level.trim;
                    assignment.muted = level.muted;
                }
            }
        }

        self.volume_state.set_targets(control, value, &levels, false);

        Ok(json!({
            "ok": true,
            "applied": levels.len(),
            "value": value,
        }))
    }

    /// Applies the controller's response curve from settings.
    fn set_volume_curve(&mut self, payload: Value) -> BridgeResult<Value> {
        let enabled = payload
            .get("enabled")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let strength = payload
            .get("strength")
            .and_then(Value::as_f64)
            .map(|strength| strength as f32)
            .unwrap_or(20.0);

        self.volume_state.set_curve(VolumeCurve { enabled, strength });

        // Answer with the curve now in force rather than the one requested, so the
        // UI mirrors what the audio thread is really doing.
        let applied = self.volume_state.curve();

        Ok(json!({
            "ok": true,
            "enabled": applied.enabled,
            "strength": applied.strength,
        }))
    }

    /// How far a resting control has to move before it counts, from settings.
    /// Soaks up the wobble of a worn pot or a noisy fader, which would otherwise
    /// nudge the volume (and raise the overlay) with nobody touching it.
    fn set_deadzone(&mut self, payload: Value) -> BridgeResult<Value> {
        let percent = payload
            .get("percent")
            .and_then(Value::as_f64)
            .filter(|percent| percent.is_finite())
            .map(|percent| percent.round().clamp(0.0, f64::from(u8::MAX)) as u8)
            .unwrap_or(0);

        // Answer with the width now in force, which may have been clamped.
        let applied = self.deadzone.set_percent(percent);

        Ok(json!({
            "ok": true,
            "percent": applied,
        }))
    }

    /// How much gets logged, from Settings → Diagnostics. Answers with what's now
    /// in force, so a level the backend doesn't know shows up as a mismatch.
    fn set_logging(&mut self, payload: Value) -> Value {
        let (current, _) = diagnostics::logging();
        let level = payload
            .get("level")
            .and_then(Value::as_str)
            .and_then(LogLevel::parse)
            .unwrap_or(current);
        let verbose = payload
            .get("verbose")
            .and_then(Value::as_bool)
            .unwrap_or(false);

        diagnostics::set_logging(level, verbose);
        log::info!(
            "logging at {}{}",
            level.name(),
            if verbose { ", verbose" } else { "" }
        );

        let (level, verbose) = diagnostics::logging();

        json!({
            "ok": true,
            "level": level.name(),
            "verbose": verbose,
        })
    }

    /// Raises the overlay as a control would, so its corner and timing can be
    /// seen from Settings without reaching for the controller. Shows the control
    /// last turned, or failing that the first one mapped.
    fn preview_overlay(&self) -> Value {
        let control = {
            let state = self.state.lock().expect("state poisoned");
            state
                .last_control
                .or_else(|| state.assignments.first().map(|assignment| assignment.control))
                .unwrap_or(0)
        };

        self.overlay.emit_show(control);

        json!({
            "ok": true,
            "control": control,
        })
    }

    /// The live left and right levels of the apps the UI is showing meters for.
    /// Cheap enough to poll many times a second: it reads what the audio thread
    /// last measured, and asking is what keeps the audio thread measuring.
    fn get_peaks(&self, payload: Value) -> Value {
        let apps: Vec<String> = payload
            .get("apps")
            .and_then(Value::as_array)
            .map(|entries| {
                entries
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default();

        let peaks: serde_json::Map<String, Value> = self
            .meters
            .read(&apps)
            .into_iter()
            .map(|(app, peaks)| (app, json!([peaks.left, peaks.right])))
            .collect();

        json!({
            "ok": true,
            "peaks": peaks,
        })
    }

    /// Hands apps back to Windows when their assignment goes away, so nothing is
    /// left muted by a mapping that no longer exists.
    fn release_apps(&mut self, payload: Value) -> BridgeResult<Value> {
        let apps: Vec<String> = payload
            .get("apps")
            .and_then(Value::as_array)
            .map(|entries| {
                entries
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default();

        if apps.is_empty() {
            return Ok(json!({ "ok": true, "released": 0 }));
        }

        self.volume_state.release(&apps);

        Ok(json!({
            "ok": true,
            "released": apps.len(),
        }))
    }

    fn refresh_sessions(&self) -> BridgeResult<Value> {
        let sessions = audio_apps()?;
        Ok(json!({
            "ok": true,
            "sessions": sessions,
        }))
    }

    fn get_state(&self) -> BridgeResult<Value> {
        let state = self.state.lock().expect("state poisoned").clone();
        let curve = self.volume_state.curve();
        let (level, verbose) = diagnostics::logging();

        Ok(json!({
            "ok": true,
            "activePresetId": state.active_preset_id,
            "selected": state.selected_input,
            "assignments": state.assignments,
            "lastControl": state.last_control,
            "lastValue": state.last_value,
            "curve": {
                "enabled": curve.enabled,
                "strength": curve.strength,
            },
            "deadzone": self.deadzone.percent(),
            "logging": {
                "level": level.name(),
                "verbose": verbose,
            },
        }))
    }
}
