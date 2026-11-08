#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

use lachslauncher_core::{config::Config, control::ControlServer, instance::InstanceStore, launch::LaunchManager, Context};
use std::sync::{Arc, Mutex};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::Manager;

fn main() {
    // Start control server in background
    std::thread::spawn(|| {
        let rt = match tokio::runtime::Runtime::new() { Ok(r) => r, Err(_) => return };
        rt.block_on(async {
            let ctx = match Context::load() { Ok(c) => c, Err(_) => return };
            let store = InstanceStore::new(&ctx.cfg);
            let instances = store.list().unwrap_or_default();
            let st = lachslauncher_core::control::AppState {
                cfg: ctx.cfg,
                mgr: Arc::new(LaunchManager::new()),
                instances: Arc::new(Mutex::new(instances)),
                jobs: Arc::new(Mutex::new(std::collections::HashMap::new())),
            };
            let _ = ControlServer::serve(st).await;
        });
    });

    tauri::Builder::default()
        .manage(commands::AppState::default())
        .setup(|app| {
            // System tray
            let show = MenuItem::with_id(app, "show", "LachsLauncher öffnen", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Beenden", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") { let _ = w.show(); let _ = w.set_focus(); }
                    }
                    "quit" => { app.exit(0); }
                    _ => {}
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Hide to tray instead of closing
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_instances,
            commands::launch_instance,
            commands::stop_instance,
            commands::install_modpack,
            commands::scan_curseforge,
            commands::get_config,
            commands::set_config,
            commands::get_logs,
            commands::fetch_skin,
            commands::login,
            commands::list_mods,
            commands::toggle_mod_cmd,
            commands::remove_mod,
            commands::search_mods,
            commands::install_mod,
            commands::create_instance,
            commands::minimize_window,
            commands::maximize_window,
            commands::close_window,
            commands::discord_status,
            commands::is_logged_in,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}