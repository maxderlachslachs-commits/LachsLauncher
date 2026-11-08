use anyhow::{Context, Result};
use reqwest::Client;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use crate::config::Config;
use crate::http;

const CF_API: &str = "https://api.curseforge.com/v1";

pub struct CfClient { pub http: Client, pub api_key: String }
impl CfClient {
    pub fn new(http: Client, key: String) -> Self { Self { http, api_key: key } }
    fn hdr(&self, req: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        req.header("x-api-key", &self.api_key).header("Accept", "application/json")
    }
    pub async fn search_modpacks(&self, query: &str, mc: Option<&str>) -> Result<Value> {
        let mut url = format!("{}/mods/search?gameId=432&classId=4471&searchFilter={}&sortField=2&sortOrder=desc&pageSize=20", CF_API, urlencoding(query));
        if let Some(v) = mc { url.push_str(&format!("&gameVersion={}", v)); }
        let resp = self.hdr(self.http.get(&url)).send().await?;
        Ok(resp.json().await?)
    }
    pub async fn get_mod(&self, id: u64) -> Result<Value> {
        let url = format!("{}/mods/{}", CF_API, id);
        let resp = self.hdr(self.http.get(&url)).send().await?;
        Ok(resp.json().await?)
    }
    pub async fn get_files(&self, mod_id: u64) -> Result<Value> {
        let url = format!("{}/mods/{}/files", CF_API, mod_id);
        let resp = self.hdr(self.http.get(&url)).send().await?;
        Ok(resp.json().await?)
    }
    pub async fn get_file(&self, mod_id: u64, file_id: u64) -> Result<Value> {
        let url = format!("{}/mods/{}/files/{}", CF_API, mod_id, file_id);
        let resp = self.hdr(self.http.get(&url)).send().await?;
        Ok(resp.json().await?)
    }
    pub async fn get_download_url(&self, mod_id: u64, file_id: u64) -> Result<String> {
        let v = self.get_file(mod_id, file_id).await?;
        if let Some(u) = v.get("data").and_then(|d| d.get("downloadUrl")).and_then(|x| x.as_str()) {
            if !u.is_empty() { return Ok(u.to_string()); }
        }
        // fallback CDN construct
        let data = v.get("data").cloned().unwrap_or(Value::Null);
        let fname = data.get("fileName").and_then(|x| x.as_str()).unwrap_or("file.jar");
        Ok(format!("https://mediafilez.forgecdn.net/files/{}/{}/{}", file_id/1000, file_id%1000, fname))
    }
}

fn urlencoding(s: &str) -> String { s.chars().map(|c| if c.is_alphanumeric() { c.to_string() } else { format!("%{:02X}", c as u8) }).collect() }

/// Install a modpack from a local zip or downloaded zip into an instance dir.
pub async fn install_modpack_zip(
    client: &Client, cfg: &Config, cf: Option<&CfClient>,
    zip_path: &Path, instance_dir: &Path, name: &str,
) -> Result<crate::instance::Instance> {
    use zip::ZipArchive;
    use std::io::Read;
    fs::create_dir_all(instance_dir)?;
    let file = fs::File::open(zip_path)?;
    let mut archive = ZipArchive::new(file)?;
    // read manifest.json
    let mut manifest_str = String::new();
    {
        let mut mf = archive.by_name("manifest.json").context("manifest.json not found")?;
        mf.read_to_string(&mut manifest_str)?;
    }
    let manifest: Value = serde_json::from_str(&manifest_str)?;
    let mc = manifest.get("minecraft").and_then(|m| m.get("version")).and_then(|x| x.as_str()).unwrap_or("1.20.1").to_string();
    let loaders = manifest.get("minecraft").and_then(|m| m.get("modLoaders")).and_then(|x| x.as_array()).cloned().unwrap_or_default();
    let primary_loader = loaders.iter().find(|l| l.get("primary").and_then(|x| x.as_bool()).unwrap_or(false))
        .or_else(|| loaders.first());
    let loader_id = primary_loader.and_then(|l| l.get("id")).and_then(|x| x.as_str()).unwrap_or("forge-47.4.10").to_string();
    let (kind, ver) = crate::instance::parse_loader_name(&loader_id);

    // extract overrides
    for i in 0..archive.len() {
        let mut f = archive.by_index(i)?;
        let name = f.name().to_string();
        if name.starts_with("overrides/") || name.starts_with("overrides\\") {
            let rel = name.trim_start_matches("overrides/").trim_start_matches("overrides\\");
            if rel.is_empty() || f.is_dir() { continue; }
            let dest = instance_dir.join(rel);
            if let Some(p) = dest.parent() { fs::create_dir_all(p)?; }
            let mut buf = Vec::new();
            f.read_to_end(&mut buf)?;
            fs::write(&dest, buf)?;
        }
    }

    // download files
    let files = manifest.get("files").and_then(|x| x.as_array()).cloned().unwrap_or_default();
    let mods_dir = instance_dir.join("mods");
    fs::create_dir_all(&mods_dir)?;
    for f in files {
        let pid = f.get("projectID").and_then(|x| x.as_u64()).unwrap_or(0);
        let fid = f.get("fileID").and_then(|x| x.as_u64()).unwrap_or(0);
        let required = f.get("required").and_then(|x| x.as_bool()).unwrap_or(true);
        if pid == 0 || fid == 0 { continue; }
        // resolve filename + url
        let (fname, url) = if let Some(c) = cf {
            let fv = c.get_file(pid, fid).await.unwrap_or(Value::Null);
            let data = fv.get("data").cloned().unwrap_or(Value::Null);
            let fn_ = data.get("fileName").and_then(|x| x.as_str()).unwrap_or("mod.jar").to_string();
            let u = data.get("downloadUrl").and_then(|x| x.as_str()).unwrap_or("").to_string();
            let u = if u.is_empty() {
                format!("https://mediafilez.forgecdn.net/files/{}/{}/{}", fid/1000, fid%1000, fn_)
            } else { u };
            (fn_, u)
        } else {
            // construct with unknown filename -> try get_download_url? skip filename by using file id only not possible; best effort
            ("mod.jar".to_string(), format!("https://mediafilez.forgecdn.net/files/{}/{}/mod.jar", fid/1000, fid%1000))
        };
        let dest = mods_dir.join(&fname);
        let _ = http::download_file(client, &url, &dest, None).await;
        if !required {
            let disabled = mods_dir.join(format!("{}.disabled", fname));
            if dest.exists() && !disabled.exists() { let _ = std::fs::rename(&dest, &disabled); }
        }
    }

    // install loader
    let root = cfg.minecraft_dir.clone();
    let profile_id = match kind.as_str() {
        "fabric" => crate::loader::install_fabric(client, cfg, &root, &mc, &ver).await?,
        "quilt" => crate::loader::install_quilt(client, cfg, &root, &mc, &ver).await?,
        "forge" => crate::loader::install_forge(client, cfg, &root, &mc, &ver).await?,
        "neoforge" => crate::loader::install_neoforge(client, cfg, &root, &ver).await?,
        _ => { let _ = crate::mojang::ensure_version_installed(client, cfg, &root, &mc).await; mc.clone() }
    };
    let _ = profile_id;

    // write instance
    let mut inst = crate::instance::Instance::new(name, &mc, &kind, &ver, instance_dir.to_path_buf());
    inst.modpack = Some(crate::instance::ModpackRef {
        source: "curseforge".into(),
        project_id: None,
        file_id: None,
        name: Some(name.to_string()),
        version: None,
    });
    Ok(inst)
}

/// Resolve a CurseForge modpack by URL/slug/id/code and install it.
pub async fn install_from_curseforge(
    client: &Client, cfg: &Config, query: &str, instance_dir: &Path, name: Option<&str>,
) -> Result<crate::instance::Instance> {
    let cf = cfg.curseforge_api_key.clone().map(|k| CfClient::new(client.clone(), k));
    let cf = cf.ok_or_else(|| anyhow::anyhow!("CURSEFORGE_API_KEY not set"))?;
    // parse input
    let (project_id, file_id) = parse_cf_input(query);
    let project_id = if let Some(pid) = project_id {
        pid
    } else {
        // treat as search slug
        let v = cf.search_modpacks(query, None).await?;
        let first = v.get("data").and_then(|d| d.as_array()).and_then(|a| a.first()).cloned()
            .ok_or_else(|| anyhow::anyhow!("no modpack found for {}", query))?;
        first.get("id").and_then(|x| x.as_u64()).unwrap_or(0)
    };
    let modinfo = cf.get_mod(project_id).await?;
    let modname = modinfo.get("data").and_then(|d| d.get("name")).and_then(|x| x.as_str()).unwrap_or("Modpack").to_string();
    let inst_name = name.unwrap_or(&modname).to_string();
    // pick file
    let fid = if let Some(f) = file_id {
        f
    } else {
        let files = cf.get_files(project_id).await?;
        let arr = files.get("data").and_then(|d| d.as_array()).cloned().unwrap_or_default();
        // latest primary, prefer matching mc? just first
        arr.first().and_then(|f| f.get("id").and_then(|x| x.as_u64())).unwrap_or(0)
    };
    let url = cf.get_download_url(project_id, fid).await?;
    let zip_path = cfg.data_dir.join("cache").join(format!("cf-{}-{}.zip", project_id, fid));
    crate::http::download_file(client, &url, &zip_path, None).await?;
    let mut inst = install_modpack_zip(client, cfg, Some(&cf), &zip_path, instance_dir, &inst_name).await?;
    inst.modpack = Some(crate::instance::ModpackRef {
        source: "curseforge".into(),
        project_id: Some(project_id),
        file_id: Some(fid),
        name: Some(modname),
        version: None,
    });
    Ok(inst)
}

fn parse_cf_input(q: &str) -> (Option<u64>, Option<u64>) {
    // URLs
    let mut pid = None; let mut fid = None;
    // curseforge.com/minecraft/modpacks/<slug>/files/<id>
    if let Some(i) = q.find("/files/") {
        let rest = &q[i+7..];
        if let Some(n) = rest.split(|c: char| !c.is_ascii_digit()).next() {
            fid = n.parse().ok();
        }
    }
    // addonId / projectId query
    if q.contains("addonId=") {
        if let Some(i) = q.find("addonId=") {
            let rest = &q[i+8..];
            pid = rest.split(|c: char| !c.is_ascii_digit()).next().and_then(|s| s.parse().ok());
        }
    }
    if q.contains("fileId=") {
        if let Some(i) = q.find("fileId=") {
            let rest = &q[i+7..];
            fid = rest.split(|c: char| !c.is_ascii_digit()).next().and_then(|s| s.parse().ok());
        }
    }
    // numeric-only → project id
    if pid.is_none() && fid.is_none() {
        if let Ok(n) = q.trim().parse::<u64>() { pid = Some(n); }
    }
    (pid, fid)
}

// expose parse_loader_name
pub fn parse_loader_name_pub(s: &str) -> (String, String) {
    crate::instance::parse_loader_name(s)
}