use anyhow::Error as AnyhowError;
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Runtime, WindowEvent,
};

use crate::{bridge::BridgeService, config, server::input::midi::midi_inputs};

const TRAY_ID: &str = "volcon-tray";
const OPEN_VOLCON_ID: &str = "open-volcon";
const EXIT_VOLCON_ID: &str = "exit-volcon";
const PRESET_PREFIX: &str = "preset::";
const CONTROLLER_PREFIX: &str = "controller::";

pub fn setup_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let menu = build_tray_menu(app)?;

    TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Volcon")
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            OPEN_VOLCON_ID => show_main_window(app),
            EXIT_VOLCON_ID => app.exit(0),
            menu_id if menu_id.starts_with(PRESET_PREFIX) => {
                let preset_id = menu_id.trim_start_matches(PRESET_PREFIX).to_owned();
                if let Err(error) = activate_preset_from_tray(app, preset_id) {
                    log::error!("failed to activate preset from tray: {error}");
                }
            }
            menu_id if menu_id.starts_with(CONTROLLER_PREFIX) => {
                let controller_id = menu_id.trim_start_matches(CONTROLLER_PREFIX).to_owned();
                if let Err(error) = activate_controller_from_tray(app, controller_id) {
                    log::error!("failed to activate controller from tray: {error}");
                }
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    if let Some(window) = app.get_webview_window("main") {
        let window_for_event = window.clone();
        window.on_window_event(move |event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window_for_event.hide();
            }
        });

        let _ = if window.is_visible().unwrap_or(false) {
            window.app_handle().emit("overlay:show", ())
        } else {
            window.app_handle().emit("overlay:hide", ())
        };
    }

    Ok(())
}

pub fn refresh_tray_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        tray.set_menu(Some(build_tray_menu(app)?))?;
    }

    Ok(())
}

fn build_tray_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let config = config::load_or_create(app).map_err(AnyhowError::msg)?;
    let active_preset = config
        .presets
        .iter()
        .find(|preset| preset.id == config.active_preset_id);

    let open_item = MenuItem::with_id(app, OPEN_VOLCON_ID, "Open Volcon", true, None::<&str>)?;
    let exit_item = MenuItem::with_id(app, EXIT_VOLCON_ID, "Exit Volcon", true, None::<&str>)?;
    let preset_separator = PredefinedMenuItem::separator(app)?;
    let controller_separator = PredefinedMenuItem::separator(app)?;

    let preset_items: Vec<CheckMenuItem<R>> = if config.presets.is_empty() {
        vec![CheckMenuItem::with_id(
            app,
            "no-presets",
            "No presets available",
            false,
            false,
            None::<&str>,
        )?]
    } else {
        config
            .presets
            .iter()
            .map(|preset| {
                let is_active = preset.id == config.active_preset_id;

                CheckMenuItem::with_id(
                    app,
                    preset_menu_id(&preset.id),
                    preset.name.clone(),
                    true,
                    is_active,
                    None::<&str>,
                )
            })
            .collect::<tauri::Result<Vec<_>>>()?
    };

    let controller_choices =
        controller_choices(active_preset.map(|preset| preset.controller_id.as_str()))?;
    let controller_items: Vec<CheckMenuItem<R>> = if controller_choices.is_empty() {
        vec![CheckMenuItem::with_id(
            app,
            "no-controllers",
            "No controllers detected",
            false,
            false,
            None::<&str>,
        )?]
    } else {
        controller_choices
            .into_iter()
            .map(|controller_id| {
                let is_active = active_preset.map(|preset| preset.controller_id.as_str())
                    == Some(controller_id.as_str());

                CheckMenuItem::with_id(
                    app,
                    controller_menu_id(&controller_id),
                    controller_id,
                    true,
                    is_active,
                    None::<&str>,
                )
            })
            .collect::<tauri::Result<Vec<_>>>()?
    };

    let preset_refs: Vec<&dyn tauri::menu::IsMenuItem<R>> = preset_items
        .iter()
        .map(|item| item as &dyn tauri::menu::IsMenuItem<R>)
        .collect();
    let controller_refs: Vec<&dyn tauri::menu::IsMenuItem<R>> = controller_items
        .iter()
        .map(|item| item as &dyn tauri::menu::IsMenuItem<R>)
        .collect();
    let preset_submenu = Submenu::with_items(app, "Change preset", true, &preset_refs)?;
    let controller_submenu = Submenu::with_items(app, "Change controller", true, &controller_refs)?;

    Menu::with_items(
        app,
        &[
            &open_item,
            &preset_separator,
            &preset_submenu,
            &controller_submenu,
            &controller_separator,
            &exit_item,
        ],
    )
}

fn controller_choices(active_controller: Option<&str>) -> tauri::Result<Vec<String>> {
    let mut controllers = midi_inputs().map_err(|error| AnyhowError::msg(error.to_string()))?;

    if let Some(active_controller) = active_controller {
        if !active_controller.is_empty()
            && !controllers
                .iter()
                .any(|controller| controller == active_controller)
        {
            controllers.insert(0, active_controller.to_owned());
        }
    }

    Ok(controllers)
}

fn preset_menu_id(preset_id: &str) -> String {
    format!("{PRESET_PREFIX}{preset_id}")
}

fn controller_menu_id(controller_id: &str) -> String {
    format!("{CONTROLLER_PREFIX}{controller_id}")
}

pub fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn activate_preset_from_tray<R: Runtime>(
    app: &AppHandle<R>,
    preset_id: String,
) -> tauri::Result<()> {
    let mut config = config::load_or_create(app).map_err(AnyhowError::msg)?;
    let preset = match config.presets.iter().find(|preset| preset.id == preset_id) {
        Some(preset) => preset.clone(),
        None => return Ok(()),
    };

    config.active_preset_id = preset.id.clone();
    config::save(app, &config).map_err(AnyhowError::msg)?;

    let bridge = app.state::<BridgeService>();
    bridge
        .dispatch(
            "activate_preset",
            Some(serde_json::json!({
              "presetId": preset.id,
              "controllerId": preset.controller_id,
              "assignments": preset.assignments,
            })),
        )
        .map_err(AnyhowError::msg)?;

    let _ = app.emit(
        "volcon:preset-selected",
        serde_json::json!({
          "presetId": preset.id,
        }),
    );

    refresh_tray_menu(app)?;

    Ok(())
}

fn activate_controller_from_tray<R: Runtime>(
    app: &AppHandle<R>,
    controller_id: String,
) -> tauri::Result<()> {
    let mut config = config::load_or_create(app).map_err(AnyhowError::msg)?;
    let active_preset_id = config.active_preset_id.clone();
    let preset = match config
        .presets
        .iter_mut()
        .find(|preset| preset.id == active_preset_id)
    {
        Some(preset) => preset,
        None => return Ok(()),
    };

    preset.controller_id = controller_id.clone();
    let preset_id = preset.id.clone();
    let assignments = preset.assignments.clone();
    config::save(app, &config).map_err(AnyhowError::msg)?;

    let bridge = app.state::<BridgeService>();
    bridge
        .dispatch(
            "activate_preset",
            Some(serde_json::json!({
              "presetId": preset_id,
              "controllerId": controller_id,
              "assignments": assignments,
            })),
        )
        .map_err(AnyhowError::msg)?;

    refresh_tray_menu(app)?;

    Ok(())
}
