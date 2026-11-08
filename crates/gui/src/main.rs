#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

use lachslauncher_core::{config::Config, control::ControlServer, instance::InstanceStore, launch::LaunchManager, Context};
use std::sync::{Arc, Mutex};

fn main() {
    // start control server in background
    std::thread::spawn(|| {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let ctx = match Context::load() { Ok(c) => c, Err(_) => return };
            let store = InstanceStore::new(&ctx.cfg);
            let instances = store.list().unwrap_or_default();
            let st = lachslauncher_core::control::AppState {
                cfg: ctx.cfg,
                mgr: Arc::new(LaunchManager::default()),
                instances: Arc::new(Mutex::new(instances)),
                jobs: Arc::new(Mutex::new(std::collections::HashMap::new())),
            };
            let _ = ControlServer::serve(st).await;
        });
    });

    tauri::Builder::default()
        .manage(commands::AppState::default())
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
            commands::minimize_window,
            commands::maximize_window,
            commands::close_window,
            commands::discord_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}