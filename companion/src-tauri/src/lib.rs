pub mod backend_client;
pub mod commands;
pub mod hashing;
pub mod models;
pub mod process_detection;
pub mod riot_local_client;
pub mod riot_lockfile;
pub mod settings;
pub mod valorant_detector;

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};
use tauri_plugin_opener::OpenerExt;

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let settings_path = app.path().app_data_dir()?.join("settings.json");
            let runtime = commands::AppRuntimeState::new(
                settings::SettingsStore::new(settings_path),
            );
            let auto_start = commands::should_auto_start_monitoring(&runtime.settings.lock());
            app.manage(runtime);

            let show = MenuItem::with_id(app, "show", "Show Companion", true, None::<&str>)?;
            let monitoring = MenuItem::with_id(
                app,
                "monitoring",
                "Start / Stop Monitoring",
                true,
                None::<&str>,
            )?;
            let dashboard =
                MenuItem::with_id(app, "dashboard", "Open Dashboard", true, None::<&str>)?;
            let separator = PredefinedMenuItem::separator(app)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu =
                Menu::with_items(app, &[&show, &monitoring, &dashboard, &separator, &quit])?;

            let mut tray = TrayIconBuilder::new()
                .tooltip("Valorant Auto Predictions")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => show_main_window(app),
                    "monitoring" => {
                        let state = app.state::<commands::AppRuntimeState>();
                        if state
                            .monitoring
                            .load(std::sync::atomic::Ordering::SeqCst)
                        {
                            commands::end_monitoring(&state);
                        } else {
                            commands::begin_monitoring(&state);
                        }
                    }
                    "dashboard" => {
                        let state = app.state::<commands::AppRuntimeState>();
                        let url = state.settings.lock().backend_url.clone();
                        let _ = app.opener().open_url(url, None::<&str>);
                    }
                    "quit" => app.exit(0),
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
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;

            if auto_start {
                let state = app.state::<commands::AppRuntimeState>();
                commands::begin_monitoring(&state);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::load_settings,
            commands::save_settings,
            commands::test_backend_connection,
            commands::get_status,
            commands::start_monitoring,
            commands::stop_monitoring,
            commands::simulate_pregame,
            commands::simulate_competitive_current_game,
            commands::simulate_custom_current_game,
            commands::reset_cooldown,
            commands::clear_logs
        ])
        .run(tauri::generate_context!())
        .expect("error while running Valorant Auto Predictions Companion");
}
