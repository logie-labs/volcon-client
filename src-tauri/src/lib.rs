mod bridge;
mod config;
mod server;
mod tray;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let context = tauri::generate_context!();

    // An update downloaded last time goes in before anything opens; the
    // installer reopens Volcon when it's done. A development build leaves it
    // for the installed copy.
    if !cfg!(debug_assertions)
        && server::updater::install_pending_at_launch(
            &context.config().identifier,
            &context.package_info().version,
        )
    {
        return;
    }

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
            config::set_close_behaviour,
            tray::quit_app,
            tray::hide_to_tray,
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
            server::launch::launch_at_sign_in,
            server::launch::set_launch_at_sign_in,
            server::updater::update_state,
            server::updater::update_download,
            server::updater::update_cancel,
            server::updater::update_discard,
            server::updater::update_install_now,
            get_app_version,
        ])
        .plugin(prevent_default())
        .setup(|app| {
            // First, so everything after it can log. Settings sends its own
            // level once the window loads; until then the default holds.
            app.handle().plugin(server::diagnostics::log_plugin())?;
            server::diagnostics::apply_default_logging();
            log::info!("Volcon {} starting", env!("CARGO_PKG_VERSION"));

            app.manage(bridge::BridgeService::new(app.handle().clone()));
            app.manage(server::updater::Updater::new(app.handle()));

            // An installed copy is always listed in Windows' Startup apps,
            // pointing at itself wherever an update put it, and follows that
            // switch. A development build would list a temporary executable.
            if !cfg!(debug_assertions) {
                server::launch::start(app.handle());
            }

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
        .run(context)
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