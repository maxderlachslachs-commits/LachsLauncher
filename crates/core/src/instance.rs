use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use crate::config::Config;
use crate::util;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoaderSpec { pub kind: String, pub version: String }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModpackRef {
    pub source: String,
    pub project_id: Option<u64>,
    pub file_id: Option<u64>,
    pub name: Option<String>,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Instance {
    pub id: String,
    pub name: String,
    pub mc_version: String,
    pub loader: LoaderSpec,
    pub path: PathBuf,
    pub memory_mb: Option<u32>,
    pub java: Option<PathBuf>,
    pub icon: Option<String>,
    pub modpack: Option<ModpackRef>,
    pub created: Option<String>,
    pub last_played: Option<String>,
    pub extra_jvm_args: Vec<String>,
    #[serde(default)] pub disabled_mods: Vec<String>,
    #[serde(default)] pub runtime_pid: Option<u32>,
}

impl Instance {
    pub fn new(name: &str, mc: &str, loader_kind: &str, loader_ver: &str, path: PathBuf) -> Self {
        Self {
            id: util::slugify(name),
            name: name.to_string(),
            mc_version: mc.to_string(),
            loader: LoaderSpec { kind: loader_kind.to_string(), version: loader_ver.to_string() },
            path, memory_mb: None, java: None, icon: None, modpack: None,
            created: Some(util::now_iso()), last_played: None, extra_jvm_args: vec![], disabled_mods: vec![], runtime_pid: None,
        }
    }
    pub fn loader_profile_id(&self) -> String {
        match self.loader.kind.as_str() {
            "fabric" => format!("fabric-loader-{}-{}", self.loader.version, self.mc_version),
            "quilt" => format!("quilt-loader-{}-{}", self.loader.version, self.mc_version),
            "forge" => format!("forge-{}", self.loader.version),
            "neoforge" => format!("neoforge-{}", self.loader.version),
            _ => self.mc_version.clone(),
        }
    }
}

pub struct InstanceStore { pub base: PathBuf }
impl InstanceStore {
    pub fn new(cfg: &Config) -> Self { Self { base: cfg.instances_dir.clone() } }
    pub fn list(&self) -> Result<Vec<Instance>, anyhow::Error> {
        let mut out = Vec::new();
        if !self.base.exists() { return Ok(out); }
        for e in fs::read_dir(&self.base)?.flatten() {
            let p = e.path().join("instance.json");
            if p.exists() {
                if let Ok(raw) = fs::read_to_string(&p) {
                    if let Ok(i) = serde_json::from_str::<Instance>(&raw) { out.push(i); }
                }
            }
        }
        Ok(out)
    }
    pub fn save(&self, inst: &Instance) -> Result<()> {
        let dir = self.base.join(&inst.id);
        fs::create_dir_all(&dir)?;
        fs::write(dir.join("instance.json"), serde_json::to_string_pretty(inst)?)?;
        Ok(())
    }
    pub fn load(&self, id: &str) -> Result<Instance> {
        let raw = fs::read_to_string(self.base.join(id).join("instance.json"))?;
        Ok(serde_json::from_str(&raw)?)
    }
    pub fn delete(&self, id: &str) -> Result<()> {
        let p = self.base.join(id);
        if p.exists() { fs::remove_dir_all(&p)?; }
        Ok(())
    }
    pub fn find_by_name(&self, name: &str) -> Result<Option<Instance>> {
        for i in self.list()? { if i.name == name || i.id == util::slugify(name) { return Ok(Some(i)); } }
        Ok(None)
    }
}

/// Import an existing CurseForge instance (reads minecraftinstance.json) without copying files.
pub fn import_curseforge_instance(cfg: &Config, cf_instance_dir: &Path) -> Result<Instance> {
    let meta_path = cf_instance_dir.join("minecraftinstance.json");
    let raw = fs::read_to_string(&meta_path).context("read minecraftinstance.json")?;
    let d: Value = serde_json::from_str(&raw)?;
    let name = d.get("name").and_then(|x| x.as_str()).unwrap_or("Imported").to_string();
    let mc = d.get("gameVersion").and_then(|x| x.as_str()).unwrap_or("1.20.1").to_string();
    let bml = d.get("baseModLoader").cloned().unwrap_or(Value::Null);
    let loader_name = bml.get("name").and_then(|x| x.as_str()).unwrap_or("");
    let (kind, ver) = parse_loader_name(loader_name);
    // write embedded versionJson if present
    let root = cfg.minecraft_dir.clone();
    if let Some(vj) = bml.get("versionJson") {
        if !vj.is_null() {
            let id = vj.get("id").and_then(|x| x.as_str()).unwrap_or(loader_name);
            crate::mojang::write_profile(&root, id, vj)?;
            if let Some(parent) = vj.get("inheritsFrom").and_then(|x| x.as_str()) {
                let _ = crate::mojang::ensure_version_installed(&reqwest::Client::new(), cfg, &root, parent);
            }
        }
    }
    // collect disabled mods (isEnabled == false)
    let disabled_mods: Vec<String> = d.get("installedAddons").and_then(|a| a.as_array()).map(|arr| {
        arr.iter().filter_map(|x| {
            if x.get("isEnabled").and_then(|v| v.as_bool()) == Some(false) {
                x.get("fileNameOnDisk").and_then(|v| v.as_str()).map(String::from)
            } else { None }
        }).collect()
    }).unwrap_or_default();

    let modpack = d.get("installedModpack").and_then(|m| {
        if m.is_null() { None } else {
            Some(ModpackRef {
                source: "curseforge".into(),
                project_id: m.get("id").and_then(|x| x.as_u64()),
                file_id: d.get("fileID").and_then(|x| x.as_u64()),
                name: m.get("name").and_then(|x| x.as_str()).map(String::from),
                version: m.get("version").and_then(|x| x.as_str()).map(String::from),
            })
        }
    });
    let mut inst = Instance::new(&name, &mc, &kind, &ver, cf_instance_dir.to_path_buf());
    inst.modpack = modpack;
    inst.disabled_mods = disabled_mods;
    if let Some(mem) = d.get("allocatedMemory").and_then(|x| x.as_u64()) { inst.memory_mb = Some(mem as u32); }
    Ok(inst)
}

pub fn parse_loader_name(name: &str) -> (String, String) {
    // "forge-47.4.10" or "fabric-0.19.5-26.1.2" or "neoforge-21.1.243"
    if name.starts_with("neoforge-") { return ("neoforge".into(), name.trim_start_matches("neoforge-").into()); }
    if name.starts_with("forge-") { return ("forge".into(), name.trim_start_matches("forge-").into()); }
    if name.starts_with("fabric-") {
        // fabric-<loader>-<mc>
        let rest = name.trim_start_matches("fabric-");
        let parts: Vec<&str> = rest.splitn(2, '-').collect();
        let ver = parts.first().copied().unwrap_or(rest).to_string();
        return ("fabric".into(), ver);
    }
    if name.starts_with("quilt-") {
        let rest = name.trim_start_matches("quilt-");
        let parts: Vec<&str> = rest.splitn(2, '-').collect();
        let ver = parts.first().copied().unwrap_or(rest).to_string();
        return ("quilt".into(), ver);
    }
    ("vanilla".into(), String::new())
}

use serde_json::Value;