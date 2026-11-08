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
pub struct ConfigUpdate { pub username: Option<String>, pub memory_mb: Option<u32>, pub api_key: Option<String>, pub discord_client_id: Option<String>, pub webhook_url: Option<String>, pub has_logged_in: Option<bool> }

#[tauri::command]
pub fn set_config(state: State<AppState>, update: ConfigUpdate) -> Result<(), String> {
    let mut cfg = state.ctx().cfg.as_ref().clone();
    if let Some(u) = update.username { cfg.auth.username = u; }
    if let Some(m) = update.memory_mb { cfg.default_memory_mb = m; }
    if let Some(k) = update.api_key { cfg.curseforge_api_key = Some(k); }
    if let Some(d) = update.discord_client_id { cfg.discord.client_id = Some(d); }
    if let Some(w) = update.webhook_url { cfg.discord.webhook_url = Some(w); }
    if let Some(h) = update.has_logged_in { cfg.has_logged_in = h; }
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
    match lachslauncher_core::auth::device_code_flow(&ctx.http, &client_id).await {
        Ok(auth) => {
            let mut cfg = ctx.cfg.as_ref().clone();
            cfg.auth.username = auth.username.clone();
            cfg.auth.uuid = auth.uuid.clone();
            cfg.auth.access_token = Some(auth.access_token);
            cfg.auth_client_id = Some(client_id);
            cfg.has_logged_in = true;
            cfg.save().map_err(|e| e.to_string())?;
            *state.ctx.lock().unwrap() = Some(lachslauncher_core::Context::new(cfg).unwrap());
            Ok(format!("{} ({})", auth.username, auth.uuid))
        }
        Err(e) => {
            // Fall back to offline mode
            let mut cfg = ctx.cfg.as_ref().clone();
            if cfg.auth.username.is_empty() { cfg.auth.username = "Player".to_string(); }
            cfg.has_logged_in = true;
            cfg.save().map_err(|e2| e2.to_string())?;
            *state.ctx.lock().unwrap() = Some(lachslauncher_core::Context::new(cfg).unwrap());
            Err(format!("Microsoft-Login fehlgeschlagen: {}. Offline-Modus aktiviert.", e))
        }
    }
}

#[tauri::command]
pub fn is_logged_in(state: State<AppState>) -> bool {
    let ctx = state.ctx();
    ctx.cfg.has_logged_in
}

#[derive(serde::Serialize)]
pub struct ModInfo { pub file: String, pub dir: String, pub disabled: bool, pub size: u64 }

#[tauri::command]
pub fn list_mods(state: State<AppState>, instance: String) -> Result<Vec<ModInfo>, String> {
    let ctx = state.ctx();
    let store = InstanceStore::new(&ctx.cfg);
    let inst = store.find_by_name(&instance).map_err(|e| e.to_string())?.ok_or("not found".to_string())?;
    let mut out = Vec::new();
    for dir in ["mods", "resourcepacks", "shaderpacks"] {
        let abs = inst.path.join(dir);
        if !abs.is_dir() { continue; }
        if let Ok(entries) = std::fs::read_dir(&abs) {
            for e in entries.flatten() {
                let name = e.file_name().to_string_lossy().to_string();
                if name.starts_with('.') { continue; }
                if dir == "mods" && !name.ends_with(".jar") && !name.ends_with(".jar.disabled") { continue; }
                let size = e.metadata().map(|m| m.len()).unwrap_or(0);
                out.push(ModInfo { file: name.clone(), dir: dir.to_string(), disabled: name.ends_with(".disabled"), size });
            }
        }
    }
    Ok(out)
}

#[tauri::command]
pub fn toggle_mod_cmd(state: State<AppState>, instance: String, dir: String, file: String) -> Result<String, String> {
    let ctx = state.ctx();
    let store = InstanceStore::new(&ctx.cfg);
    let inst = store.find_by_name(&instance).map_err(|e| e.to_string())?.ok_or("not found".to_string())?;
    lachslauncher_core::util::toggle_mod(&inst.path, &dir, &file).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_mod(state: State<AppState>, instance: String, dir: String, file: String) -> Result<(), String> {
    let ctx = state.ctx();
    let store = InstanceStore::new(&ctx.cfg);
    let inst = store.find_by_name(&instance).map_err(|e| e.to_string())?.ok_or("not found".to_string())?;
    let path = inst.path.join(&dir).join(&file);
    if path.exists() { std::fs::remove_file(&path).map_err(|e| e.to_string())?; }
    Ok(())
}

#[derive(serde::Serialize)]
pub struct CfMod { pub id: u64, pub name: String, pub summary: String }

#[tauri::command]
pub async fn search_mods(state: State<'_, AppState>, query: String) -> Result<Vec<CfMod>, String> {
    let ctx = state.ctx();
    let key = ctx.cfg.curseforge_api_key.clone().ok_or("no api key")?;
    let cf = lachslauncher_core::curseforge::CfClient::new(ctx.http.clone(), key);
    let v = cf.search_modpacks(&query, None).await.map_err(|e| e.to_string())?; // reuse search (classId 4471 = modpacks); need mods (6)
    // Actually search mods classId=6
    let url = format!("/mods/search?gameId=432&classId=6&searchFilter={}&sortField=2&sortOrder=desc&pageSize=20", urlencoding(&query));
    let resp = cf.get(&url).await.map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for m in resp.get("data").and_then(|d| d.as_array()).cloned().unwrap_or_default() {
        out.push(CfMod {
            id: m.get("id").and_then(|x| x.as_u64()).unwrap_or(0),
            name: m.get("name").and_then(|x| x.as_str()).unwrap_or("").to_string(),
            summary: m.get("summary").and_then(|x| x.as_str()).unwrap_or("").to_string(),
        });
    }
    Ok(out)
}

fn urlencoding(s: &str) -> String { s.chars().map(|c| if c.is_alphanumeric() { c.to_string() } else { format!("%{:02X}", c as u8) }).collect() }

#[tauri::command]
pub async fn install_mod(state: State<'_, AppState>, instance: String, project_id: u64) -> Result<String, String> {
    let ctx = state.ctx();
    let store = InstanceStore::new(&ctx.cfg);
    let inst = store.find_by_name(&instance).map_err(|e| e.to_string())?.ok_or("not found".to_string())?;
    let key = ctx.cfg.curseforge_api_key.clone().ok_or("no api key")?;
    let cf = lachslauncher_core::curseforge::CfClient::new(ctx.http.clone(), key);
    // get latest file
    let files = cf.get_files(project_id).await.map_err(|e| e.to_string())?;
    let fid = files.get("data").and_then(|d| d.as_array()).and_then(|a| a.first()).and_then(|f| f.get("id").and_then(|x| x.as_u64())).ok_or("no file")?;
    let url = cf.get_download_url(project_id, fid).await.map_err(|e| e.to_string())?;
    let mods_dir = inst.path.join("mods");
    std::fs::create_dir_all(&mods_dir).map_err(|e| e.to_string())?;
    // get filename
    let fv = cf.get_file(project_id, fid).await.map_err(|e| e.to_string())?;
    let fname = fv.get("data").and_then(|d| d.get("fileName")).and_then(|x| x.as_str()).unwrap_or("mod.jar").to_string();
    let dest = mods_dir.join(&fname);
    lachslauncher_core::http::download_file(&ctx.http, &url, &dest, None).await.map_err(|e| e.to_string())?;
    Ok(fname)
}

#[tauri::command]
pub fn create_instance(state: State<AppState>, name: String, mc_version: String, loader: Option<String>, loader_version: Option<String>) -> Result<String, String> {
    let ctx = state.ctx();
    let store = InstanceStore::new(&ctx.cfg);
    let (kind, ver) = match loader.as_deref() {
        Some("fabric") => ("fabric", loader_version.unwrap_or_default()),
        Some("forge") => ("forge", loader_version.unwrap_or_default()),
        Some("neoforge") => ("neoforge", loader_version.unwrap_or_default()),
        Some("quilt") => ("quilt", loader_version.unwrap_or_default()),
        _ => ("vanilla", String::new()),
    };
    let inst = lachslauncher_core::instance::Instance::new(&name, &mc_version, kind, &ver, ctx.cfg.instances_dir.join(lachslauncher_core::util::slugify(&name)));
    store.save(&inst).map_err(|e| e.to_string())?;
    Ok(inst.id)
}

#[tauri::command]
pub fn delete_instance(state: State<AppState>, instance: String) -> Result<(), String> {
    let ctx = state.ctx();
    let store = InstanceStore::new(&ctx.cfg);
    let inst = store.find_by_name(&instance).map_err(|e| e.to_string())?.ok_or("not found".to_string())?;
    // Remove instance metadata (don't delete game files)
    store.delete(&inst.id).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn rename_instance(state: State<AppState>, instance: String, new_name: String) -> Result<String, String> {
    let ctx = state.ctx();
    let store = InstanceStore::new(&ctx.cfg);
    let mut inst = store.find_by_name(&instance).map_err(|e| e.to_string())?.ok_or("not found".to_string())?;
    inst.name = new_name;
    inst.id = lachslauncher_core::util::slugify(&inst.name);
    store.save(&inst).map_err(|e| e.to_string())?;
    // Remove old dir if id changed
    Ok(inst.id)
}

#[tauri::command]
pub async fn import_path(state: State<'_, AppState>, path: String) -> Result<String, String> {
    let ctx = state.ctx();
    let p = std::path::PathBuf::from(&path);
    if !p.exists() { return Err("file not found".to_string()); }
    let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    let name = p.file_stem().and_then(|s| s.to_str()).unwrap_or("imported").to_string();
    let instance_dir = ctx.cfg.instances_dir.join(lachslauncher_core::util::slugify(&name));
    std::fs::create_dir_all(&instance_dir).map_err(|e| e.to_string())?;
    if ext == "zip" || ext == "mrpack" {
        let cf = ctx.cfg.curseforge_api_key.clone().map(|k| lachslauncher_core::curseforge::CfClient::new(ctx.http.clone(), k));
        let inst = lachslauncher_core::curseforge::install_modpack_zip(&ctx.http, &ctx.cfg, cf.as_ref(), &p, &instance_dir, &name).await.map_err(|e| e.to_string())?;
        let store = InstanceStore::new(&ctx.cfg);
        store.save(&inst).map_err(|e| e.to_string())?;
        Ok(inst.name)
    } else {
        Err("unsupported file type".to_string())
    }
}

#[tauri::command]
pub fn duplicate_instance(state: State<AppState>, instance: String) -> Result<String, String> {
    let ctx = state.ctx();
    let store = InstanceStore::new(&ctx.cfg);
    let inst = store.find_by_name(&instance).map_err(|e| e.to_string())?.ok_or("not found".to_string())?;
    let new_name = format!("{} (Kopie)", inst.name);
    let mut new_inst = inst.clone();
    new_inst.id = lachslauncher_core::util::slugify(&new_name);
    new_inst.name = new_name;
    new_inst.path = ctx.cfg.instances_dir.join(&new_inst.id);
    // Copy instance directory
    if inst.path.exists() && !new_inst.path.exists() {
        copy_dir_recursive(&inst.path, &new_inst.path).map_err(|e| e.to_string())?;
    }
    store.save(&new_inst).map_err(|e| e.to_string())?;
    Ok(new_inst.id)
}

fn copy_dir_recursive(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            std::fs::copy(&src_path, &dst_path)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn mc_versions(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let ctx = state.ctx();
    let manifest = lachslauncher_core::mojang::fetch_manifest(&ctx.http).await.map_err(|e| e.to_string())?;
    let mut out: Vec<String> = manifest.versions.iter()
        .filter(|v| v.vtype == "release")
        .map(|v| v.id.clone())
        .filter(|id| {
            // only 1.18.2 and above (compare roughly)
            true
        })
        .take(50)
        .collect();
    if out.is_empty() { out = vec!["1.21.4".into(), "1.21.1".into(), "1.20.1".into(), "1.19.2".into(), "1.18.2".into()]; }
    Ok(out)
}

#[tauri::command]
pub fn open_folder(state: State<AppState>, path: String) -> Result<(), String> {
    let p = std::path::PathBuf::from(&path);
    #[cfg(target_os = "linux")]
    { std::process::Command::new("xdg-open").arg(&p).spawn().map_err(|e| e.to_string())?; }
    #[cfg(target_os = "windows")]
    { std::process::Command::new("explorer").arg(&p).spawn().map_err(|e| e.to_string())?; }
    #[cfg(target_os = "macos")]
    { std::process::Command::new("open").arg(&p).spawn().map_err(|e| e.to_string())?; }
    Ok(())
}

#[tauri::command]
pub fn kill_all(state: State<AppState>) -> Result<(), String> {
    // Kill all running java processes for instances
    if let Ok(rd) = std::fs::read_dir("/proc") {
        for entry in rd.flatten() {
            let pid: u32 = match entry.file_name().to_string_lossy().parse() { Ok(p) => p, _ => continue };
            let cmd = std::fs::read_to_string(format!("/proc/{}/cmdline", pid)).unwrap_or_default();
            if cmd.contains("LachsLauncher") == false && cmd.contains("java") && cmd.contains("minecraft") {
                let _ = std::process::Command::new("kill").arg("-9").arg(pid.to_string()).status();
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn list_worlds(state: State<AppState>, instance: String) -> Result<Vec<String>, String> {
    let ctx = state.ctx();
    let store = InstanceStore::new(&ctx.cfg);
    let inst = store.find_by_name(&instance).map_err(|e| e.to_string())?.ok_or("not found".to_string())?;
    let saves_dir = inst.path.join("saves");
    let mut out = Vec::new();
    if saves_dir.is_dir() {
        if let Ok(rd) = std::fs::read_dir(&saves_dir) {
            for e in rd.flatten() {
                if e.path().is_dir() { out.push(e.file_name().to_string_lossy().to_string()); }
            }
        }
    }
    Ok(out)
}

#[derive(serde::Serialize)]
pub struct SysInfo { pub total_gb: f64, pub version: String }

#[tauri::command]
pub fn sys_info() -> SysInfo {
    SysInfo { total_gb: 16.0, version: "0.1.0".to_string() }
}

#[tauri::command]
pub fn running(state: State<AppState>) -> Vec<String> {
    let ctx = state.ctx();
    let store = InstanceStore::new(&ctx.cfg);
    store.list().unwrap_or_default().iter().filter(|i| {
        // check if any java process has this instance path in cmdline
        std::fs::read_dir("/proc").ok().map(|rd| {
            rd.flatten().any(|e| {
                let pid: u32 = e.file_name().to_string_lossy().parse().unwrap_or(0);
                let cmd = std::fs::read_to_string(format!("/proc/{}/cmdline", pid)).unwrap_or_default();
                cmd.contains(&i.path.to_string_lossy().to_string()) && cmd.contains("java")
            })
        }).unwrap_or(false)
    }).map(|i| i.name.clone()).collect()
}

#[tauri::command]
pub async fn cf_search(state: State<'_, AppState>, query: String, kind: Option<String>) -> Result<Vec<serde_json::Value>, String> {
    let ctx = state.ctx();
    let key = ctx.cfg.curseforge_api_key.clone().ok_or("no api key")?;
    let cf = lachslauncher_core::curseforge::CfClient::new(ctx.http.clone(), key);
    let class_id = match kind.as_deref() { Some("modpack") => 4471, Some("mod") => 6, _ => 6 };
    let url = format!("/mods/search?gameId=432&classId={}&searchFilter={}&sortField=2&sortOrder=desc&pageSize=20", class_id, urlencoding(&query));
    let resp = cf.get(&url).await.map_err(|e| e.to_string())?;
    Ok(resp.get("data").and_then(|d| d.as_array()).cloned().unwrap_or_default())
}

#[tauri::command]
pub async fn cf_project(state: State<'_, AppState>, id: u64) -> Result<serde_json::Value, String> {
    let ctx = state.ctx();
    let key = ctx.cfg.curseforge_api_key.clone().ok_or("no api key")?;
    let cf = lachslauncher_core::curseforge::CfClient::new(ctx.http.clone(), key);
    cf.get_mod(id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn export_pack(state: State<'_, AppState>, instance: String) -> Result<String, String> {
    let ctx = state.ctx();
    let store = InstanceStore::new(&ctx.cfg);
    let inst = store.find_by_name(&instance).map_err(|e| e.to_string())?.ok_or("not found".to_string())?;
    let zip_path = ctx.cfg.data_dir.join("exports").join(format!("{}.zip", inst.id));
    std::fs::create_dir_all(zip_path.parent().unwrap()).map_err(|e| e.to_string())?;
    // Create zip of instance directory (excluding logs and cache)
    let file = std::fs::File::create(&zip_path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(file);
    let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let base = &inst.path;
    for entry in walkdir(base) {
        let rel = entry.strip_prefix(base).unwrap_or(&entry);
        let rel_str = rel.to_string_lossy().replace('\\', "/");
        if entry.is_dir() {
            let _ = zip.add_directory(format!("{}/", rel_str), opts);
        } else {
            if let Ok(data) = std::fs::read(&entry) {
                let _ = zip.start_file(rel_str, opts);
                use std::io::Write;
                let _ = zip.write_all(&data);
            }
        }
    }
    zip.finish().map_err(|e| e.to_string())?;
    Ok(zip_path.to_string_lossy().to_string())
}

fn walkdir(dir: &std::path::Path) -> Vec<std::path::PathBuf> {
    let mut out = Vec::new();
    if let Ok(rd) = std::fs::read_dir(dir) {
        for e in rd.flatten() {
            let p = e.path();
            let name = e.file_name().to_string_lossy().to_string();
            if name == "logs" || name == "crash-reports" { continue; }
            if p.is_dir() { out.push(p.clone()); out.extend(walkdir(&p)); }
            else { out.push(p); }
        }
    }
    out
}

#[tauri::command]
pub fn set_cover(state: State<AppState>, instance: String, path: String) -> Result<String, String> {
    let ctx = state.ctx();
    let store = InstanceStore::new(&ctx.cfg);
    let mut inst = store.find_by_name(&instance).map_err(|e| e.to_string())?.ok_or("not found".to_string())?;
    // Copy cover image to instance dir
    let src = std::path::PathBuf::from(&path);
    if !src.exists() { return Err("file not found".to_string()); }
    let ext = src.extension().and_then(|e| e.to_str()).unwrap_or("png");
    let dest = inst.path.join(format!("cover.{}", ext));
    std::fs::copy(&src, &dest).map_err(|e| e.to_string())?;
    inst.icon = Some(dest.to_string_lossy().to_string());
    store.save(&inst).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().to_string())
}

#[tauri::command]
pub fn clear_cover(state: State<AppState>, instance: String) -> Result<(), String> {
    let ctx = state.ctx();
    let store = InstanceStore::new(&ctx.cfg);
    let mut inst = store.find_by_name(&instance).map_err(|e| e.to_string())?.ok_or("not found".to_string())?;
    if let Some(icon) = &inst.icon {
        let _ = std::fs::remove_file(icon);
    }
    inst.icon = None;
    store.save(&inst).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn discord_status(state: State<AppState>) -> String {
    let ctx = state.ctx();
    if ctx.cfg.discord.client_id.is_some() { "configured".into() } else { "not configured".into() }
}