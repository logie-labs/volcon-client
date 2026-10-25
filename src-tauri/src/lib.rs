mod bridge;
mod config;
mod server;
mod tray;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // First, so a second launch - from the Start menu while Volcon sits in
        // the tray, say - goes no further than showing the copy already
        // running. Two would fight over the controller.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            tray::show_main_window(app);
        }))
        .invoke_handler(tauri::generate_handler![
            config::load_preset_config,
            config::save_preset_config,
            config::set_open_to_tray,
            bridge::bridge_dispatch,
            server::process::audio_list_sessions,
            server::process::process_get_details,
            server::process::process_get_icon,
            server::process::process_get_icon_by_path,
            server::process::process_get_icon_hd,
            server::process::process_list_running,
            server::process::process_list_running_names,
            server::diagnostics::open_logs_folder,
            server::diagnostics::diagnostics_info,
            server::shell::save_settings_backup,
            server::shell::reveal_in_explorer,
            server::shell::open_external,
            get_app_version,
        ])
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(prevent_default())
        .setup(|app| {
            // First, so everything after it can log. Settings sends its own
            // level once the window loads; until then the default holds.
            app.handle().plugin(server::diagnostics::log_plugin())?;
            server::diagnostics::apply_default_logging();
            log::info!("Volcon {} starting", env!("CARGO_PKG_VERSION"));

            app.manage(bridge::BridgeService::new(app.handle().clone()));

            // tray behaviour
            if let Ok(cfg) = crate::config::load_or_create(&app.handle()) {
                if cfg.open_to_tray {
                    if let Some(main_window) = app.get_webview_window("main") {
                        let _ = main_window.hide();
                    }
                }
            }

            tray::setup_tray(app.handle())?;

            if let Some(overlay_window) = app.get_webview_window("overlay") {
                let _ = overlay_window.set_ignore_cursor_events(true);
                let _ = overlay_window.set_shadow(false);

                // Last: each call above rewrites the window's extended style.
                server::overlay::prepare_window(&overlay_window);
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

fn prevent_default() -> impl tauri::plugin::Plugin<tauri::Wry> {
    use tauri_plugin_prevent_default::Flags;

    let mut builder = tauri_plugin_prevent_default::Builder::new()
        .with_flags(Flags::all().difference(Flags::CONTEXT_MENU | Flags::PRINT));

    #[cfg(target_os = "windows")]
    {
        use tauri_plugin_prevent_default::PlatformOptions;

        builder = builder.platform(
            PlatformOptions::new()
                .default_context_menus(false)
                .browser_accelerator_keys(false),
        );
    }

    builder.build()
}