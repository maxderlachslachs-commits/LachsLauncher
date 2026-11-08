use anyhow::{Context, Result};
use serde_json::Value;
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use tokio::sync::broadcast;
use crate::config::Config;
use crate::mojang;
use crate::util;

#[derive(Clone, Debug)]
pub struct LaunchStatus { pub instance_id: String, pub pid: u32, pub running: bool, pub started: String }

pub struct LaunchManager {
    pub running: Arc<Mutex<HashMap<String, (Child, u32, String, PathBuf)>>>,
}

impl Default for LaunchManager {
    fn default() -> Self { Self::new() }
}
impl LaunchManager {
    pub fn new() -> Self { Self { running: Arc::new(Mutex::new(HashMap::new())) } }
    pub fn is_running(&self, id: &str) -> bool { self.running.lock().unwrap().contains_key(id) }
    pub fn stop(&self, id: &str) -> Result<()> {
        let mut map = self.running.lock().unwrap();
        if let Some((mut child, _, _, _)) = map.remove(id) { let _ = child.kill(); }
        Ok(())
    }
    pub fn log_path(&self, id: &str) -> Option<PathBuf> {
        self.running.lock().unwrap().get(id).map(|(_,_,_,p)| p.clone())
    }
}

pub async fn launch_instance(
    mgr: &LaunchManager,
    cfg: &Config,
    http: &reqwest::Client,
    inst: &crate::instance::Instance,
    root: &Path,
) -> Result<u32> {
    let profile_id = inst.loader_profile_id();
    // ensure version installed
    if profile_id != inst.mc_version {
        // loader profile file may exist (imported) or needs install; ensure parent
        let _ = profile_id.clone();
    }
    // ensure vanilla + loader profile files exist
    let profile_path = root.join("versions").join(&profile_id).join(format!("{}.json", profile_id));
    if !profile_path.exists() {
        // try install loader
        match inst.loader.kind.as_str() {
            "fabric" => { crate::loader::install_fabric(http, cfg, root, &inst.mc_version, &inst.loader.version).await?; }
            "quilt" => { crate::loader::install_quilt(http, cfg, root, &inst.mc_version, &inst.loader.version).await?; }
            "forge" => { crate::loader::install_forge(http, cfg, root, &inst.mc_version, &inst.loader.version).await?; }
            "neoforge" => { crate::loader::install_neoforge(http, cfg, root, &inst.loader.version).await?; }
            _ => { crate::mojang::ensure_version_installed(http, cfg, root, &inst.mc_version).await?; }
        }
    }
    crate::mojang::ensure_version_installed(http, cfg, root, &inst.mc_version).await?;

    let info = crate::mojang::effective(root, &profile_id)?;
    // extract natives
    let natives_dir = inst.path.join("natives");
    std::fs::create_dir_all(&natives_dir)?;
    extract_natives(&info, root, &natives_dir)?;

    // java
    let java_major = info.java_major;
    let java = inst.java.clone()
        .or_else(|| cfg.java_path.clone())
        .or_else(|| util::pick_java(cfg, java_major))
        .unwrap_or_else(|| PathBuf::from("java"));

    let mem = inst.memory_mb.unwrap_or(cfg.default_memory_mb);
    let classpath = build_classpath(&info, root, &inst.mc_version);
    let cp_sep = if cfg!(target_os="windows") { ";" } else { ":" };
    let classpath_str = classpath.iter().map(|p| p.to_string_lossy().to_string()).collect::<Vec<_>>().join(cp_sep);

    // variables
    let username = &cfg.auth.username;
    let uuid = if cfg.auth.uuid.is_empty() { offline_uuid(username) } else { cfg.auth.uuid.clone() };
    let access_token = "0";
    let user_type = "legacy";
    let version_type = "release";
    let game_dir = &inst.path;
    let assets_root = root.join("assets");
    let natives_str = natives_dir.to_string_lossy().to_string();
    let launcher_name = "LachsLauncher";
    let launcher_version = "0.1.0";
    let version_name = &inst.mc_version;
    let asset_index_name = &info.asset_index_id;

    let mut jvm_args: Vec<String> = Vec::new();
    // process raw jvm args
    for a in &info.jvm_args {
        match a {
            Value::String(s) => {
                let s = util::substitute(s, &[
                    ("natives_directory", &natives_str),
                    ("launcher_name", launcher_name),
                    ("launcher_version", launcher_version),
                    ("classpath", &classpath_str),
                    ("library_directory", &root.join("libraries").to_string_lossy()),
                    ("classpath_separator", cp_sep),
                ]);
                jvm_args.push(s);
            }
            Value::Object(o) => {
                // rules handled already? check
                if let Some(rules) = o.get("rules") {
                    if !util::rules_allow(Some(rules), false, false) { continue; }
                }
                if let Some(val) = o.get("value") {
                    let push_val = |v: &Value, out: &mut Vec<String>| {
                        if let Value::String(s) = v {
                            let s = util::substitute(s, &[
                                ("natives_directory", &natives_str),
                                ("launcher_name", launcher_name),
                                ("launcher_version", launcher_version),
                                ("classpath", &classpath_str),
                                ("library_directory", &root.join("libraries").to_string_lossy()),
                                ("classpath_separator", cp_sep),
                            ]);
                            out.push(s);
                        } else if let Value::Array(arr) = v {
                            for x in arr {
                                if let Value::String(s) = x {
                                    let s = util::substitute(s, &[
                                        ("natives_directory", &natives_str),
                                        ("launcher_name", launcher_name),
                                        ("launcher_version", launcher_version),
                                        ("classpath", &classpath_str),
                                        ("library_directory", &root.join("libraries").to_string_lossy()),
                                        ("classpath_separator", cp_sep),
                                    ]);
                                    out.push(s);
                                }
                            }
                        }
                    };
                    push_val(val, &mut jvm_args);
                }
            }
            _ => {}
        }
    }
    // memory
    jvm_args.insert(0, format!("-Xmx{}M", mem));
    jvm_args.insert(1, "-Xms512M".into());
    for a in cfg.extra_jvm_args.clone() { jvm_args.push(a); }
    for a in &inst.extra_jvm_args { jvm_args.push(a.clone()); }

    // log4j config
    if let Some(logging) = &info.logging {
        if let Some(client) = logging.get("client") {
            if let Some(arg) = client.get("argument").and_then(|x| x.as_str()) {
                let log_path = root.join("assets").join("log_configs").join(
                    client.get("file").and_then(|f| f.get("id")).and_then(|x| x.as_str()).unwrap_or("log4j2.xml"));
                let arg = arg.replace("${path}", &log_path.to_string_lossy());
                jvm_args.push(arg);
            }
        }
    }
    jvm_args.push("-Dminecraft.launcher.brand=LachsLauncher".into());

    // game args
    let mut game_args: Vec<String> = Vec::new();
    let raw_game = if !info.game_args.is_empty() { info.game_args.clone() } else { vec![] };
    // if modern arguments object missing, fallback
    if raw_game.is_empty() {
        game_args.push(format!("--username {}", username)); // not ideal but fallback
    } else {
        for a in &raw_game {
            match a {
                Value::String(s) => {
                    let s = substitute_game(s, username, version_name, game_dir, &assets_root, asset_index_name, &uuid, access_token, user_type, version_type, "854", "480");
                    game_args.push(s);
                }
                Value::Object(o) => {
                    if let Some(rules) = o.get("rules") {
                        if !util::rules_allow(Some(rules), false, false) { continue; }
                    }
                    if let Some(val) = o.get("value") {
                        let push = |v: &Value, out: &mut Vec<String>| {
                            if let Value::String(s) = v {
                                out.push(substitute_game(s, username, version_name, game_dir, &assets_root, asset_index_name, &uuid, access_token, user_type, version_type, "854", "480"));
                            } else if let Value::Array(arr) = v {
                                for x in arr {
                                    if let Value::String(s) = x {
                                        out.push(substitute_game(s, username, version_name, game_dir, &assets_root, asset_index_name, &uuid, access_token, user_type, version_type, "854", "480"));
                                    }
                                }
                            }
                        };
                        push(val, &mut game_args);
                    }
                }
                _ => {}
            }
        }
    }

    // build command
    let mut cmd = Command::new(&java);
    cmd.args(&jvm_args);
    cmd.arg(&info.main_class);
    cmd.args(&game_args);
    cmd.current_dir(game_dir);
    let log_dir = inst.path.join("logs");
    let _ = std::fs::create_dir_all(&log_dir);
    let log_file = log_dir.join("lachslauncher.log");
    let out_file = std::fs::File::create(&log_file).context("create log")?;
    let err_file = out_file.try_clone().context("clone log")?;
    cmd.stdout(Stdio::from(out_file));
    cmd.stderr(Stdio::from(err_file));
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        unsafe { cmd.pre_exec(|| { extern "C" { fn setsid() -> i32; } let _ = setsid(); Ok(()) }); }
    }
    let mut child = cmd.spawn().context("spawn minecraft")?;
    let pid = child.id();
    mgr.running.lock().unwrap().insert(inst.id.clone(), (child, pid, util::now_iso(), log_file));
    // Discord
    if cfg.discord.enabled {
        if let Some(cid) = cfg.discord.client_id.clone() {
            let details = format!("Playing {}", inst.name);
            let state = format!("{} • Minecraft {}", inst.name, inst.mc_version);
            let instname = inst.name.clone();
            std::thread::spawn(move || {
                let p = crate::discord::DiscordPresence::new(Some(cid));
                let _ = p.set_activity(&details, &state, &instname);
            });
        }
        if let Some(url) = cfg.discord.webhook_url.clone() {
            let http = reqwest::Client::new();
            let title = "LachsLauncher".to_string();
            let desc = format!("Started **{}** (Minecraft {})", inst.name, inst.mc_version);
            tokio::spawn(async move { let _ = crate::discord::webhook_notify(&http, &url, &title, &desc).await; });
        }
    }
    Ok(pid)
}

fn substitute_game(s: &str, username: &str, version_name: &str, game_dir: &Path, assets_root: &Path, asset_index: &str, uuid: &str, access_token: &str, user_type: &str, version_type: &str, w: &str, h: &str) -> String {
    util::substitute(s, &[
        ("auth_player_name", username),
        ("version_name", version_name),
        ("game_directory", &game_dir.to_string_lossy()),
        ("assets_root", &assets_root.to_string_lossy()),
        ("assets_index_name", asset_index),
        ("auth_uuid", uuid),
        ("auth_access_token", access_token),
        ("user_type", user_type),
        ("version_type", version_type),
        ("resolution_width", w),
        ("resolution_height", h),
        ("user_properties", "{}"),
        ("clientid", ""),
        ("auth_xuid", ""),
    ])
}

fn offline_uuid(name: &str) -> String {
    use md5::Digest;
    let input = format!("OfflinePlayer:{}", name);
    let mut h = md5::Md5::new();
    h.update(input.as_bytes());
    let digest = h.finalize();
    let mut bytes = [0u8; 16];
    bytes.copy_from_slice(&digest);
    bytes[6] = (bytes[6] & 0x0f) | 0x30;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    format!("{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        bytes[0],bytes[1],bytes[2],bytes[3],bytes[4],bytes[5],bytes[6],bytes[7],bytes[8],bytes[9],bytes[10],bytes[11],bytes[12],bytes[13],bytes[14],bytes[15])
}

fn extract_natives(info: &crate::mojang::VersionInfo, root: &Path, natives_dir: &Path) -> Result<()> {
    // extract .so/.dll/.dylib from native-classifier library jars
    for lib in &info.libraries {
        let name = lib.get("name").and_then(|x| x.as_str()).unwrap_or("");
        let is_native = name.contains(":natives-") || lib.get("natives").is_some();
        if !is_native { continue; }
        // find artifact path
        let mut jar_path: Option<PathBuf> = None;
        if let Some(art) = lib.get("downloads").and_then(|d| d.get("artifact")) {
            if let Some(p) = art.get("path").and_then(|x| x.as_str()) { jar_path = Some(root.join("libraries").join(p)); }
        }
        // natives map classifier
        if jar_path.is_none() {
            if let Some(nat) = lib.get("natives") {
                let key = if cfg!(target_os="windows") { "windows" } else if cfg!(target_os="macos") { "osx" } else { "linux" };
                if let Some(cls) = nat.get(key).and_then(|x| x.as_str()) {
                    let cls = cls.replace("${arch}", "64");
                    if let Some(clsmap) = lib.get("downloads").and_then(|d| d.get("classifiers")) {
                        if let Some(c) = clsmap.get(&cls) {
                            if let Some(p) = c.get("path").and_then(|x| x.as_str()) { jar_path = Some(root.join("libraries").join(p)); }
                        }
                    }
                }
            }
        }
        let Some(jar) = jar_path else { continue; };
        if !jar.exists() { continue; }
        if let Ok(file) = std::fs::File::open(&jar) {
            if let Ok(mut zip) = zip::ZipArchive::new(file) {
                for i in 0..zip.len() {
                    if let Ok(mut f) = zip.by_index(i) {
                        let fname = f.name().to_string();
                        if f.is_dir() { continue; }
                        if !(fname.ends_with(".so") || fname.ends_with(".dll") || fname.ends_with(".dylib")) { continue; }
                        let base = std::path::Path::new(&fname).file_name().unwrap();
                        let dest = natives_dir.join(base);
                        if dest.exists() { continue; }
                        let mut buf = Vec::new();
                        use std::io::Read;
                        let _ = f.read_to_end(&mut buf);
                        let _ = std::fs::write(&dest, buf);
                    }
                }
            }
        }
    }
    Ok(())
}

fn build_classpath(info: &crate::mojang::VersionInfo, root: &Path, _mc: &str) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let sep_libs = root.join("libraries");
    for lib in &info.libraries {
        if !util::rules_allow(lib.get("rules"), false, false) { continue; }
        // skip natives-only classifier jars? include all jars present
        if let Some(art) = lib.get("downloads").and_then(|d| d.get("artifact")) {
            if let Some(p) = art.get("path").and_then(|x| x.as_str()) {
                let full = sep_libs.join(p);
                if full.exists() { out.push(full); }
            }
        } else if let Some(name) = lib.get("name").and_then(|x| x.as_str()) {
            if let Some(rel) = util::maven_path(name) {
                let full = sep_libs.join(&rel);
                if full.exists() { out.push(full); }
            }
        }
    }
    // client jar
    let client_jar = root.join("versions").join(&info.jar_id).join(format!("{}.jar", info.jar_id));
    if client_jar.exists() { out.push(client_jar); }
    out
}