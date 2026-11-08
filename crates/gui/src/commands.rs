use lachslauncher_core::{config::Config, instance::InstanceStore, launch::LaunchManager, Context};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::State;

#[derive(Default)]
pub struct AppState {
    pub ctx: Mutex<Option<Context>>,
    pub mgr: Arc<LaunchManager>,
    pub instances: Mutex<Vec<lachslauncher_core::instance::Instance>>,
}

impl AppState {
    pub fn ctx(&self) -> Context { self.ctx.lock().unwrap().get_or_insert_with(|| Context::load().unwrap()).clone() }
}

#[derive(Serialize, Deserialize)]
pub struct InstanceDto {
    pub id: String,
    pub name: String,
    pub mc_version: String,
    pub loader: String,
    pub loader_version: String,
    pub path: String,
    pub memory_mb: Option<u32>,
    pub modpack: Option<String>,
    pub running: bool,
}

fn to_dto(i: &lachslauncher_core::instance::Instance, mgr: &LaunchManager) -> InstanceDto {
    InstanceDto {
        id: i.id.clone(),
        name: i.name.clone(),
        mc_version: i.mc_version.clone(),
        loader: i.loader.kind.clone(),
        loader_version: i.loader.version.clone(),
        path: i.path.to_string_lossy().to_string(),
        memory_mb: i.memory_mb,
        modpack: i.modpack.as_ref().and_then(|m| m.name.clone()),
        running: mgr.is_running(&i.id),
    }
}

#[tauri::command]
pub fn list_instances(state: State<AppState>) -> Vec<InstanceDto> {
    let ctx = state.ctx();
    let store = InstanceStore::new(&ctx.cfg);
    let insts = store.list().unwrap_or_default();
    *state.instances.lock().unwrap() = insts.clone();
    insts.iter().map(|i| to_dto(i, &state.mgr)).collect()
}

#[tauri::command]
pub async fn launch_instance(state: State<'_, AppState>, name: String) -> Result<String, String> {
    let ctx = state.ctx();
    let store = InstanceStore::new(&ctx.cfg);
    let inst = store.find_by_name(&name).map_err(|e| e.to_string())?.ok_or("not found".to_string())?;
    let root = ctx.cfg.minecraft_dir.clone();
    let pid = lachslauncher_core::launch::launch_instance(&state.mgr, &ctx.cfg, &ctx.http, &inst, &root).await.map_err(|e| e.to_string())?;
    let mut i2 = inst.clone(); i2.last_played = Some(lachslauncher_core::util::now_iso());
    let _ = store.save(&i2);
    Ok(format!("{}", pid))
}

#[tauri::command]
pub fn stop_instance(state: State<AppState>, name: String) -> Result<(), String> {
    let ctx = state.ctx();
    let store = InstanceStore::new(&ctx.cfg);
    let inst = store.find_by_name(&name).map_err(|e| e.to_string())?.ok_or("not found".to_string())?;
    state.mgr.stop(&inst.id).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn install_modpack(state: State<'_, AppState>, target: String, name: Option<String>) -> Result<String, String> {
    let ctx = state.ctx();
    let id = lachslauncher_core::util::slugify(name.as_deref().unwrap_or("modpack"));
    let instance_dir = ctx.cfg.instances_dir.join(&id);
    let inst = lachslauncher_core::curseforge::install_from_curseforge(&ctx.http, &ctx.cfg, &target, &instance_dir, name.as_deref()).await.map_err(|e| e.to_string())?;
    let store = InstanceStore::new(&ctx.cfg);
    store.save(&inst).map_err(|e| e.to_string())?;
    Ok(inst.name)
}

#[tauri::command]
pub fn scan_curseforge(state: State<AppState>) -> Result<u32, String> {
    let ctx = state.ctx();
    let store = InstanceStore::new(&ctx.cfg);
    let cf_root = ctx.cfg.curseforge_install.clone().ok_or("no cf install")?;
    let inst_dir = cf_root.parent().unwrap_or(&cf_root).join("Instances");
    let mut count = 0;
    if inst_dir.is_dir() {
        for e in std::fs::read_dir(&inst_dir).map_err(|e| e.to_string())?.flatten() {
            let d = e.path();
            if d.join("minecraftinstance.json").exists() {
                if let Ok(inst) = lachslauncher_core::instance::import_curseforge_instance(&ctx.cfg, &d) {
                    let _ = store.save(&inst);
                    count += 1;
                }
            }
        }
    }
    Ok(count)
}

#[tauri::command]
pub fn get_config(state: State<AppState>) -> Config { state.ctx().cfg.as_ref().clone() }

#[derive(Deserialize)]
pub struct ConfigUpdate { pub username: Option<String>, pub memory_mb: Option<u32>, pub api_key: Option<String>, pub discord_client_id: Option<String>, pub webhook_url: Option<String> }

#[tauri::command]
pub fn set_config(state: State<AppState>, update: ConfigUpdate) -> Result<(), String> {
    let mut cfg = state.ctx().cfg.as_ref().clone();
    if let Some(u) = update.username { cfg.auth.username = u; }
    if let Some(m) = update.memory_mb { cfg.default_memory_mb = m; }
    if let Some(k) = update.api_key { cfg.curseforge_api_key = Some(k); }
    if let Some(d) = update.discord_client_id { cfg.discord.client_id = Some(d); }
    if let Some(w) = update.webhook_url { cfg.discord.webhook_url = Some(w); }
    cfg.save().map_err(|e| e.to_string())?;
    *state.ctx.lock().unwrap() = Some(Context::new(cfg).unwrap());
    Ok(())
}

#[tauri::command]
pub fn get_logs(state: State<AppState>, name: String) -> Vec<String> {
    let ctx = state.ctx();
    let store = InstanceStore::new(&ctx.cfg);
    if let Ok(Some(inst)) = store.find_by_name(&name) {
        let log = inst.path.join("logs").join("lachslauncher.log");
        if let Ok(content) = std::fs::read_to_string(&log) {
            let lines: Vec<&str> = content.lines().collect();
            let start = lines.len().saturating_sub(120);
            return lines[start..].iter().map(|s| s.to_string()).collect();
        }
    }
    vec![]
}

#[tauri::command]
pub fn minimize_window(window: tauri::Window) { let _ = window.minimize(); }
#[tauri::command]
pub fn maximize_window(window: tauri::Window) { let _ = if window.is_maximized().unwrap_or(false) { window.unmaximize() } else { window.maximize() }; }
#[tauri::command]
pub fn close_window(window: tauri::Window) { let _ = window.close(); }

#[tauri::command]
pub async fn fetch_skin(state: State<'_, AppState>, username: String) -> Result<String, String> {
    let ctx = state.ctx();
    let info = lachslauncher_core::skin::fetch_skin(&ctx.http, &ctx.cfg.data_dir, &username).await.map_err(|e| e.to_string())?;
    Ok(info.path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn login(state: State<'_, AppState>) -> Result<String, String> {
    let ctx = state.ctx();
    let client_id = ctx.cfg.auth_client_id.clone().unwrap_or_else(|| "00000000402b5328".to_string());
    let auth = lachslauncher_core::auth::device_code_flow(&ctx.http, &client_id).await.map_err(|e| e.to_string())?;
    let mut cfg = ctx.cfg.as_ref().clone();
    cfg.auth.username = auth.username.clone();
    cfg.auth.uuid = auth.uuid.clone();
    cfg.auth.access_token = Some(auth.access_token);
    cfg.auth_client_id = Some(client_id);
    cfg.save().map_err(|e| e.to_string())?;
    *state.ctx.lock().unwrap() = Some(lachslauncher_core::Context::new(cfg).unwrap());
    Ok(format!("{} ({})", auth.username, auth.uuid))
}

#[tauri::command]
pub fn discord_status(state: State<AppState>) -> String {
    let ctx = state.ctx();
    if ctx.cfg.discord.client_id.is_some() { "configured".into() } else { "not configured".into() }
}