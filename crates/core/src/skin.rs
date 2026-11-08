use anyhow::{Context, Result};
use reqwest::Client;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Clone)]
pub struct SkinInfo {
    pub username: String,
    pub uuid: String,
    pub path: PathBuf,
}

pub async fn fetch_skin(client: &Client, data_dir: &Path, username: &str) -> Result<SkinInfo> {
    let url = format!("https://api.mojang.com/users/profiles/minecraft/{}", username);
    let resp = client.get(&url).send().await.context("mojang api")?;
    if !resp.status().is_success() { anyhow::bail!("user not found: {}", username); }
    let v: Value = resp.json().await.context("parse profile")?;
    let uuid = v.get("id").and_then(|x| x.as_str()).unwrap_or("").to_string();
    let name = v.get("name").and_then(|x| x.as_str()).unwrap_or(username).to_string();
    let skin_url = format!("https://crafatar.com/skins/{}", uuid);
    let resp = client.get(&skin_url).send().await.context("fetch skin")?;
    if !resp.status().is_success() { anyhow::bail!("skin fetch failed"); }
    let bytes = resp.bytes().await.context("read skin")?;
    let dir = data_dir.join("skins");
    fs::create_dir_all(&dir)?;
    let path = dir.join(format!("{}.png", name));
    fs::write(&path, &bytes)?;
    Ok(SkinInfo { username: name, uuid, path })
}