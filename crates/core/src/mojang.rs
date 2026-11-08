use anyhow::{Context, Result};
use reqwest::Client;
use serde_json::Value;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use crate::config::Config;
use crate::http;
use crate::util;

const MANIFEST_URL: &str = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";

pub struct VersionInfo {
    pub id: String,
    pub main_class: String,
    pub asset_index_id: String,
    pub assets: String,
    pub java_major: u8,
    pub libraries: Vec<Value>,
    pub jvm_args: Vec<Value>,
    pub game_args: Vec<Value>,
    pub logging: Option<Value>,
    pub jar_id: String,
}

#[derive(serde::Deserialize)]
struct Manifest { versions: Vec<ManifestEntry> }
#[derive(serde::Deserialize, Clone)]
struct ManifestEntry { id: String, url: String, #[serde(rename="type")] vtype: String }

pub async fn fetch_manifest(client: &Client) -> Result<Manifest> {
    Ok(client.get(MANIFEST_URL).send().await?.json().await?)
}

pub async fn ensure_version_installed(client: &Client, cfg: &Config, root: &Path, id: &str) -> Result<()> {
    let vdir = root.join("versions").join(id);
    let vjson = vdir.join(format!("{}.json", id));
    if !vjson.exists() {
        // find in manifest
        let m = fetch_manifest(client).await?;
        let entry = m.versions.into_iter().find(|e| e.id == id)
            .ok_or_else(|| anyhow::anyhow!("version {} not in manifest", id))?;
        fs::create_dir_all(&vdir)?;
        http::download_file(client, &entry.url, &vjson, None).await?;
    }
    // load & install artifacts for this profile
    let raw: Value = serde_json::from_str(&fs::read_to_string(&vjson)?)?;
    // ensure parent
    if let Some(parent) = raw.get("inheritsFrom").and_then(|x| x.as_str()) {
        Box::pin(ensure_version_installed(client, cfg, root, parent)).await?;
    }
    // install vanilla artifacts if downloads present (top-level or parent already handled)
    if raw.get("downloads").is_some() || raw.get("assetIndex").is_some() {
        install_artifacts(client, cfg, root, &raw).await?;
    }
    Ok(())
}

async fn install_artifacts(client: &Client, cfg: &Config, root: &Path, v: &Value) -> Result<()> {
    let id = v.get("id").and_then(|x| x.as_str()).unwrap_or("unknown");
    let vdir = root.join("versions").join(id);
    // client jar
    if let Some(client_dl) = v.get("downloads").and_then(|d| d.get("client")) {
        let url = client_dl.get("url").and_then(|x| x.as_str()).unwrap_or("");
        let sha = client_dl.get("sha1").and_then(|x| x.as_str());
        if !url.is_empty() {
            http::download_file(client, url, &vdir.join(format!("{}.jar", id)), sha).await?;
        }
    }
    // libraries
    let mut tasks = Vec::new();
    if let Some(libs) = v.get("libraries").and_then(|x| x.as_array()) {
        for lib in libs {
            if !util::rules_allow(lib.get("rules"), false, false) { continue; }
            // artifact
            if let Some(art) = lib.get("downloads").and_then(|d| d.get("artifact")) {
                let path = art.get("path").and_then(|x| x.as_str());
                let url = art.get("url").and_then(|x| x.as_str());
                let sha = art.get("sha1").and_then(|x| x.as_str());
                if let (Some(p), Some(u)) = (path, url) {
                    tasks.push((u.to_string(), root.join("libraries").join(p), sha.map(String::from)));
                }
            } else if let Some(name) = lib.get("name").and_then(|x| x.as_str()) {
                if let Some(rel) = util::maven_path(name) {
                    // try maven central as fallback
                    let url = format!("https://repo1.maven.org/maven2/{}", rel);
                    let dest = root.join("libraries").join(&rel);
                    if !dest.exists() { tasks.push((url, dest, None)); }
                }
            }
            // classifiers (natives)
            if let Some(cls) = lib.get("downloads").and_then(|d| d.get("classifiers")) {
                // pick linux natives
                let key = if cfg!(target_os="windows") { "natives-windows" }
                          else if cfg!(target_os="macos") { "natives-macos" }
                          else { "natives-linux" };
                // also handle arch-specific keys like natives-linux (only)
                if let Some(c) = cls.get(key) {
                    let path = c.get("path").and_then(|x| x.as_str());
                    let url = c.get("url").and_then(|x| x.as_str());
                    let sha = c.get("sha1").and_then(|x| x.as_str());
                    if let (Some(p), Some(u)) = (path, url) {
                        tasks.push((u.to_string(), root.join("libraries").join(p), sha.map(String::from)));
                    }
                }
            }
            // natives map (old style)
            if let Some(nat) = lib.get("natives") {
                let key = if cfg!(target_os="windows") { "windows" } else if cfg!(target_os="macos") { "osx" } else { "linux" };
                if let Some(classifier) = nat.get(key).and_then(|x| x.as_str()) {
                    let classifier = classifier.replace("${arch}", "64");
                    if let Some(cls) = lib.get("downloads").and_then(|d| d.get("classifiers")) {
                        if let Some(c) = cls.get(&classifier) {
                            let path = c.get("path").and_then(|x| x.as_str());
                            let url = c.get("url").and_then(|x| x.as_str());
                            let sha = c.get("sha1").and_then(|x| x.as_str());
                            if let (Some(p), Some(u)) = (path, url) {
                                tasks.push((u.to_string(), root.join("libraries").join(p), sha.map(String::from)));
                            }
                        }
                    }
                }
            }
        }
    }
    http::download_many(client, tasks).await?;

    // asset index
    if let Some(ai) = v.get("assetIndex") {
        let idx_id = ai.get("id").and_then(|x| x.as_str()).unwrap_or("");
        let idx_url = ai.get("url").and_then(|x| x.as_str()).unwrap_or("");
        let idx_sha = ai.get("sha1").and_then(|x| x.as_str());
        if !idx_id.is_empty() && !idx_url.is_empty() {
            let idx_path = root.join("assets").join("indexes").join(format!("{}.json", idx_id));
            http::download_file(client, idx_url, &idx_path, idx_sha).await?;
            // download objects
            if let Ok(raw) = fs::read_to_string(&idx_path) {
                if let Ok(idx) = serde_json::from_str::<Value>(&raw) {
                    if let Some(objs) = idx.get("objects").and_then(|x| x.as_object()) {
                        let mut atasks = Vec::new();
                        for (_name, info) in objs {
                            if let Some(hash) = info.get("hash").and_then(|x| x.as_str()) {
                                let prefix = &hash[..2];
                                let url = format!("https://resources.download.minecraft.net/{}/{}", prefix, hash);
                                let dest = root.join("assets").join("objects").join(prefix).join(hash);
                                if !dest.exists() { atasks.push((url, dest, Some(hash.to_string()))); }
                            }
                        }
                        http::download_many(client, atasks).await?;
                    }
                }
            }
        }
    }

    // logging config
    if let Some(logging) = v.get("logging").and_then(|l| l.get("client")) {
        if let Some(file) = logging.get("file") {
            let id = file.get("id").and_then(|x| x.as_str()).unwrap_or("");
            let url = file.get("url").and_then(|x| x.as_str()).unwrap_or("");
            let sha = file.get("sha1").and_then(|x| x.as_str());
            if !id.is_empty() && !url.is_empty() {
                let dest = root.join("assets").join("log_configs").join(id);
                let _ = http::download_file(client, url, &dest, sha).await;
            }
        }
    }
    Ok(())
}

fn load_raw(root: &Path, id: &str) -> Result<Value> {
    let p = root.join("versions").join(id).join(format!("{}.json", id));
    let s = fs::read_to_string(&p).with_context(|| format!("read version {}", id))?;
    Ok(serde_json::from_str(&s)?)
}

fn merge_libs(parent: &[Value], child: &[Value]) -> Vec<Value> {
    let mut out: Vec<Value> = parent.to_vec();
    for cl in child {
        let name = cl.get("name").and_then(|x| x.as_str()).unwrap_or("");
        if let Some(pos) = out.iter().position(|l| l.get("name").and_then(|x| x.as_str()) == Some(name)) {
            out[pos] = cl.clone();
        } else {
            out.push(cl.clone());
        }
    }
    out
}

fn effective_json(root: &Path, id: &str) -> Result<Value> {
    let raw = load_raw(root, id)?;
    let parent_id = raw.get("inheritsFrom").and_then(|x| x.as_str()).map(String::from);
    if let Some(pid) = parent_id {
        let mut parent = effective_json(root, &pid)?;
        // override scalars
        for key in ["mainClass","assets","assetIndex","javaVersion","logging","type","id","minecraftArguments","downloads","releaseTime","time","minimumLauncherVersion","complianceLevel","jar"] {
            if let Some(val) = raw.get(key) {
                if !val.is_null() { parent[key] = val.clone(); }
            }
        }
        // arguments merge: parent (vanilla standard) + child (loader-specific)
        if let Some(child_args) = raw.get("arguments") {
            if !child_args.is_null() {
                if let Some(parent_args) = parent.get("arguments").cloned() {
                    let mut merged = parent_args.clone();
                    let mut jvm = parent_args.get("jvm").and_then(|x| x.as_array()).cloned().unwrap_or_default();
                    if let Some(cj) = child_args.get("jvm").and_then(|x| x.as_array()) {
                        for a in cj { if !jvm.contains(a) { jvm.push(a.clone()); } }
                    }
                    merged["jvm"] = Value::Array(jvm);
                    let mut game = child_args.get("game").and_then(|x| x.as_array()).cloned().unwrap_or_default();
                    if let Some(pg) = parent_args.get("game").and_then(|x| x.as_array()) {
                        for a in pg { if !game.contains(a) { game.push(a.clone()); } }
                    }
                    merged["game"] = Value::Array(game);
                    parent["arguments"] = merged;
                } else {
                    parent["arguments"] = child_args.clone();
                }
            }
        }
        if let Some(mc) = raw.get("minecraftArguments") {
            if !mc.is_null() { parent["minecraftArguments"] = mc.clone(); }
        }
        // libraries merge
        let plibs = parent.get("libraries").and_then(|x| x.as_array()).cloned().unwrap_or_default();
        let clibs = raw.get("libraries").and_then(|x| x.as_array()).cloned().unwrap_or_default();
        parent["libraries"] = Value::Array(merge_libs(&plibs, &clibs));
        Ok(parent)
    } else {
        Ok(raw)
    }
}

pub fn effective(root: &Path, id: &str) -> Result<VersionInfo> {
    let v = effective_json(root, id)?;
    let id = v.get("id").and_then(|x| x.as_str()).unwrap_or(id).to_string();
    let main_class = v.get("mainClass").and_then(|x| x.as_str()).unwrap_or("net.minecraft.client.main.Main").to_string();
    let asset_index_id = v.get("assetIndex").and_then(|a| a.get("id")).and_then(|x| x.as_str()).unwrap_or(&id).to_string();
    let assets = v.get("assets").and_then(|x| x.as_str()).unwrap_or(&asset_index_id).to_string();
    let java_major = v.get("javaVersion").and_then(|j| j.get("majorVersion")).and_then(|x| x.as_u64()).unwrap_or(17) as u8;
    let libraries = v.get("libraries").and_then(|x| x.as_array()).cloned().unwrap_or_default();
    let (jvm_args, game_args, is_modern) = if let Some(args) = v.get("arguments") {
        let jvm = args.get("jvm").and_then(|x| x.as_array()).cloned().unwrap_or_default();
        let game = args.get("game").and_then(|x| x.as_array()).cloned().unwrap_or_default();
        (jvm, game, true)
    } else if let Some(mc) = v.get("minecraftArguments").and_then(|x| x.as_str()) {
        (vec![], vec![Value::String(mc.to_string())], false)
    } else {
        (vec![], vec![], true)
    };
    let logging = v.get("logging").cloned();
    let raw_inherits = load_raw(root, &id).ok().and_then(|r| r.get("inheritsFrom").and_then(|x| x.as_str()).map(String::from));
    let jar_id = v.get("jar").and_then(|x| x.as_str()).map(String::from)
        .or(raw_inherits)
        .unwrap_or_else(|| id.clone());
    Ok(VersionInfo { id, main_class, asset_index_id, assets, java_major, libraries, jvm_args, game_args, logging, jar_id })
}
pub fn write_profile(root: &Path, id: &str, json: &Value) -> Result<()> {
    let vdir = root.join("versions").join(id);
    fs::create_dir_all(&vdir)?;
    fs::write(vdir.join(format!("{}.json", id)), serde_json::to_string_pretty(json)?)?;
    Ok(())
}
pub fn version_dir(root: &Path, id: &str) -> PathBuf { root.join("versions").join(id) }