use anyhow::{Context, Result};
use reqwest::Client;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use crate::config::Config;
use crate::http;

const CF_API: &str = "https://api.curseforge.com/v1";
const SKIP_CLASS: &[u64] = &[17, 4471];

pub struct CfClient { pub http: Client, pub api_key: String }
impl CfClient {
    pub fn new(http: Client, key: String) -> Self { Self { http, api_key: key } }
    fn hdr(&self, req: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        req.header("x-api-key", &self.api_key).header("Accept", "application/json")
    }
    pub async fn post(&self, url: &str, body: &Value) -> Result<Value> {
        let resp = self.hdr(self.http.post(format!("{}{}", CF_API, url)).json(body)).send().await?;
        if !resp.status().is_success() { anyhow::bail!("HTTP {} for {}", resp.status(), url); }
        Ok(resp.json().await?)
    }
    pub async fn get(&self, url: &str) -> Result<Value> {
        let resp = self.hdr(self.http.get(format!("{}{}", CF_API, url))).send().await?;
        if !resp.status().is_success() { anyhow::bail!("HTTP {} for {}", resp.status(), url); }
        Ok(resp.json().await?)
    }
    pub async fn search_modpacks(&self, query: &str, mc: Option<&str>) -> Result<Value> {
        let mut url = format!("/mods/search?gameId=432&classId=4471&searchFilter={}&sortField=2&sortOrder=desc&pageSize=20", urlencoding(query));
        if let Some(v) = mc { url.push_str(&format!("&gameVersion={}", v)); }
        self.get(&url).await
    }
    pub async fn get_mod(&self, id: u64) -> Result<Value> {
        self.get(&format!("/mods/{}", id)).await
    }
    pub async fn get_files(&self, mod_id: u64) -> Result<Value> {
        self.get(&format!("/mods/{}/files", mod_id)).await
    }
    pub async fn get_file(&self, mod_id: u64, file_id: u64) -> Result<Value> {
        self.get(&format!("/mods/{}/files/{}", mod_id, file_id)).await
    }
    pub async fn get_download_url(&self, mod_id: u64, file_id: u64) -> Result<String> {
        let v = self.get_file(mod_id, file_id).await?;
        let data = v.get("data").cloned().unwrap_or(Value::Null);
        if let Some(u) = data.get("downloadUrl").and_then(|x| x.as_str()) {
            if !u.is_empty() { return Ok(u.to_string()); }
        }
        let fname = data.get("fileName").and_then(|x| x.as_str()).unwrap_or("file.jar");
        Ok(format!("https://mediafilez.forgecdn.net/files/{}/{}/{}", file_id/1000, file_id%1000, fname))
    }
}

fn urlencoding(s: &str) -> String { s.chars().map(|c| if c.is_alphanumeric() { c.to_string() } else { format!("%{:02X}", c as u8) }).collect() }

fn dir_for_class(class_id: u64) -> &'static str {
    match class_id { 6 => "mods", 12 => "resourcepacks", 6552 => "shaderpacks", _ => "mods" }
}

pub async fn install_modpack_zip(
    client: &Client, cfg: &Config, cf: Option<&CfClient>,
    zip_path: &Path, instance_dir: &Path, name: &str,
) -> Result<crate::instance::Instance> {
    use zip::ZipArchive;
    use std::io::Read;
    fs::create_dir_all(instance_dir)?;
    let file = fs::File::open(zip_path)?;
    let mut archive = ZipArchive::new(file)?;
    let mut manifest_str = String::new();
    { let mut mf = archive.by_name("manifest.json").context("manifest.json not found")?; mf.read_to_string(&mut manifest_str)?; }
    let manifest: Value = serde_json::from_str(&manifest_str)?;
    let mc = manifest.get("minecraft").and_then(|m| m.get("version")).and_then(|x| x.as_str()).unwrap_or("1.20.1").to_string();
    let loaders = manifest.get("minecraft").and_then(|m| m.get("modLoaders")).and_then(|x| x.as_array()).cloned().unwrap_or_default();
    let primary_loader = loaders.iter().find(|l| l.get("primary").and_then(|x| x.as_bool()).unwrap_or(false)).or_else(|| loaders.first());
    let loader_id = primary_loader.and_then(|l| l.get("id")).and_then(|x| x.as_str()).unwrap_or("forge-47.4.10").to_string();
    let (kind, ver) = crate::instance::parse_loader_name(&loader_id);

    // extract overrides
    let overrides_prefix = manifest.get("overrides").and_then(|x| x.as_str()).unwrap_or("overrides").trim_end_matches('/').to_string() + "/";
    for i in 0..archive.len() {
        let mut f = archive.by_index(i)?;
        let ename = f.name().to_string();
        if f.is_dir() || !ename.starts_with(&overrides_prefix) { continue; }
        let rel = ename[overrides_prefix.len()..].to_string();
        if rel.is_empty() { continue; }
        let dest = instance_dir.join(&rel);
        if let Some(p) = dest.parent() { fs::create_dir_all(p)?; }
        let mut buf = Vec::new(); f.read_to_end(&mut buf)?; fs::write(&dest, buf)?;
    }

    let files = manifest.get("files").and_then(|x| x.as_array()).cloned().unwrap_or_default();
    let mods_dir = instance_dir.join("mods");
    fs::create_dir_all(&mods_dir)?;

    // batch fetch file info + class info
    let mut info_map: std::collections::HashMap<u64, Value> = std::collections::HashMap::new();
    let mut class_map: std::collections::HashMap<u64, u64> = std::collections::HashMap::new();
    if let Some(c) = cf {
        let unique_files: Vec<u64> = files.iter().filter_map(|f| f.get("fileID").and_then(|x| x.as_u64())).collect::<std::collections::HashSet<_>>().into_iter().collect();
        for chunk in unique_files.chunks(200) {
            let body = serde_json::json!({"fileIds": chunk});
            if let Ok(resp) = c.post("/mods/files", &body).await {
                for f in resp.get("data").and_then(|x| x.as_array()).cloned().unwrap_or_default() {
                    if let Some(id) = f.get("id").and_then(|x| x.as_u64()) { info_map.insert(id, f); }
                }
            }
        }
        let unique_projects: Vec<u64> = files.iter().filter_map(|f| f.get("projectID").and_then(|x| x.as_u64())).collect::<std::collections::HashSet<_>>().into_iter().collect();
        for chunk in unique_projects.chunks(200) {
            let body = serde_json::json!({"modIds": chunk});
            if let Ok(resp) = c.post("/mods", &body).await {
                for p in resp.get("data").and_then(|x| x.as_array()).cloned().unwrap_or_default() {
                    if let (Some(id), Some(cid)) = (p.get("id").and_then(|x| x.as_u64()), p.get("classId").and_then(|x| x.as_u64())) {
                        class_map.insert(id, cid);
                    }
                }
            }
        }
    }

    let mut skipped = Vec::new();
    for f in &files {
        let pid = f.get("projectID").and_then(|x| x.as_u64()).unwrap_or(0);
        let fid = f.get("fileID").and_then(|x| x.as_u64()).unwrap_or(0);
        let required = f.get("required").and_then(|x| x.as_bool()).unwrap_or(true);
        if pid == 0 || fid == 0 { continue; }
        let class_id = class_map.get(&pid).copied().unwrap_or(6);
        if SKIP_CLASS.contains(&class_id) { continue; }
        let fi = info_map.get(&fid);
        let (fname, url) = if let Some(fi) = fi {
            let fn_ = fi.get("fileName").and_then(|x| x.as_str()).unwrap_or("mod.jar").to_string();
            let u = fi.get("downloadUrl").and_then(|x| x.as_str()).unwrap_or("").to_string();
            let u = if u.is_empty() { format!("https://mediafilez.forgecdn.net/files/{}/{}/{}", fid/1000, fid%1000, fn_) } else { u };
            (fn_, u)
        } else if let Some(c) = cf {
            let fv = c.get_file(pid, fid).await.unwrap_or(Value::Null);
            let data = fv.get("data").cloned().unwrap_or(Value::Null);
            let fn_ = data.get("fileName").and_then(|x| x.as_str()).unwrap_or("mod.jar").to_string();
            let u = data.get("downloadUrl").and_then(|x| x.as_str()).unwrap_or("").to_string();
            let u = if u.is_empty() { format!("https://mediafilez.forgecdn.net/files/{}/{}/{}", fid/1000, fid%1000, fn_) } else { u };
            (fn_, u)
        } else {
            ("mod.jar".to_string(), format!("https://mediafilez.forgecdn.net/files/{}/{}/mod.jar", fid/1000, fid%1000))
        };
        // path safety
        let subdir = dir_for_class(class_id);
        let dest_dir = instance_dir.join(subdir);
        fs::create_dir_all(&dest_dir)?;
        let dest = dest_dir.join(&fname);
        // ensure within instance_dir
        if !dest.starts_with(instance_dir) { skipped.push(format!("{} (invalid path)", fname)); continue; }
        match http::download_file(client, &url, &dest, None).await {
            Ok(_) => {
                if !required {
                    let disabled = dest_dir.join(format!("{}.disabled", fname));
                    if dest.exists() && !disabled.exists() { let _ = fs::rename(&dest, &disabled); }
                }
            }
            Err(_) => skipped.push(format!("{}  https://www.curseforge.com/projects/{}", fname, pid)),
        }
    }

    if !skipped.is_empty() {
        let _ = fs::write(instance_dir.join("skipped-mods.txt"), format!("Diese Dateien konnten nicht geladen werden:\n\n{}", skipped.join("\n")));
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

    let mut inst = crate::instance::Instance::new(name, &mc, &kind, &ver, instance_dir.to_path_buf());
    inst.modpack = Some(crate::instance::ModpackRef {
        source: "curseforge".into(),
        project_id: None, file_id: None,
        name: Some(name.to_string()), version: None,
    });
    Ok(inst)
}

pub async fn install_from_curseforge(
    client: &Client, cfg: &Config, query: &str, instance_dir: &Path, name: Option<&str>,
) -> Result<crate::instance::Instance> {
    let cf = cfg.curseforge_api_key.clone().map(|k| CfClient::new(client.clone(), k));
    let cf = cf.ok_or_else(|| anyhow::anyhow!("CURSEFORGE_API_KEY not set"))?;
    let (project_id, file_id) = parse_cf_input(query);
    let project_id = if let Some(pid) = project_id {
        pid
    } else {
        let v = cf.search_modpacks(query, None).await?;
        v.get("data").and_then(|d| d.as_array()).and_then(|a| a.first()).and_then(|f| f.get("id").and_then(|x| x.as_u64())).ok_or_else(|| anyhow::anyhow!("no modpack found for {}", query))?
    };
    let modinfo = cf.get_mod(project_id).await?;
    let modname = modinfo.get("data").and_then(|d| d.get("name")).and_then(|x| x.as_str()).unwrap_or("Modpack").to_string();
    let inst_name = name.unwrap_or(&modname).to_string();
    let fid = if let Some(f) = file_id {
        f
    } else {
        let files = cf.get_files(project_id).await?;
        files.get("data").and_then(|d| d.as_array()).and_then(|a| a.first()).and_then(|f| f.get("id").and_then(|x| x.as_u64())).unwrap_or(0)
    };
    let url = cf.get_download_url(project_id, fid).await?;
    let zip_path = cfg.data_dir.join("cache").join(format!("cf-{}-{}.zip", project_id, fid));
    http::download_file(client, &url, &zip_path, None).await?;
    let mut inst = install_modpack_zip(client, cfg, Some(&cf), &zip_path, instance_dir, &inst_name).await?;
    inst.modpack = Some(crate::instance::ModpackRef {
        source: "curseforge".into(),
        project_id: Some(project_id), file_id: Some(fid),
        name: Some(modname), version: None,
    });
    Ok(inst)
}

fn parse_cf_input(q: &str) -> (Option<u64>, Option<u64>) {
    let mut pid = None; let mut fid = None;
    if let Some(i) = q.find("/files/") {
        let rest = &q[i+7..];
        if let Some(n) = rest.split(|c: char| !c.is_ascii_digit()).next() { fid = n.parse().ok(); }
    }
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
    if pid.is_none() && fid.is_none() {
        if let Ok(n) = q.trim().parse::<u64>() { pid = Some(n); }
    }
    (pid, fid)
}