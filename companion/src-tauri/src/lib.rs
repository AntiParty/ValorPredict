pub mod commands;
pub mod hashing;
pub mod models;
pub mod predictions;
pub mod process_detection;
pub mod riot_local_client;
pub mod riot_lockfile;
pub mod settings;
pub mod valorant_detector;

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};

/// Event the UI listens to so it can resume polling and animations when the
/// window is (re)shown. Payload is `visible`.
const VISIBILITY_EVENT: &str = "app:visibility";

/// Build the main window. Kept in one place so the initial launch and the
/// rebuild-from-tray path stay identical; values mirror `tauri.conf.json`.
fn build_main_window(app: &tauri::AppHandle) {
    let _ = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
        .title("ValorPredict")
        .inner_size(1060.0, 800.0)
        .min_inner_size(560.0, 640.0)
        .resizable(true)
        .build();
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    } else {
        // The window is fully torn down while in the tray to release WebView2;
        // rebuild it on demand.
        build_main_window(app);
    }
    let _ = app.emit(VISIBILITY_EVENT, true);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let db = std::sync::Arc::new(
                vap_core::db::Db::open(&data_dir.join("vap.sqlite"))
                    .expect("open prediction database"),
            );
            let runtime = commands::AppRuntimeState::new(
                settings::SettingsStore::new(data_dir.join("settings.json")),
                db,
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
            let separator = PredefinedMenuItem::separator(app)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &monitoring, &separator, &quit])?;

            let mut tray = TrayIconBuilder::new()
                .tooltip("ValorPredict")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => show_main_window(app),
                    "monitoring" => {
                        let state = app.state::<commands::AppRuntimeState>();
                        if state.monitoring.load(std::sync::atomic::Ordering::SeqCst) {
                            commands::end_monitoring(&state);
                        } else {
                            commands::begin_monitoring(&state);
                        }
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
                // Closing to the tray tears the window down entirely (rather than
                // just hiding it) so its WebView2 processes exit and that memory
                // is freed. The app is kept alive by `prevent_exit` in `run`,
                // and the window is rebuilt on demand from the tray.
                api.prevent_close();
                let _ = window.destroy();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::load_settings,
            commands::save_settings,
            commands::get_status,
            commands::start_monitoring,
            commands::stop_monitoring,
            commands::simulate_pregame,
            commands::simulate_competitive_current_game,
            commands::simulate_custom_current_game,
            commands::reset_cooldown,
            commands::clear_logs,
            predictions::get_me,
            predictions::get_twitch_settings,
            predictions::get_dashboard,
            predictions::save_twitch_credentials,
            predictions::save_preset,
            predictions::resolve_prediction,
            predictions::cancel_prediction,
            predictions::simulate_match_start,
            predictions::connect_twitch
        ])
        .build(tauri::generate_context!())
        .expect("error while building ValorPredict")
        .run(|_app_handle, event| {
            // Destroying the window on close-to-tray leaves zero windows open,
            // which would normally quit the app. Keep the process (and tray)
            // alive in that case. An explicit Quit calls `app.exit(code)`, which
            // carries a code, so we still honor it and the tray menu works.
            if let tauri::RunEvent::ExitRequested { code, api, .. } = event {
                if code.is_none() {
                    api.prevent_exit();
                }
            }
        });
}
