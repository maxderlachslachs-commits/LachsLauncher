use anyhow::{Context, Result};
use reqwest::Client;
use serde_json::Value;
use std::fs;
use std::path::Path;
use crate::config::Config;
use crate::mojang;

pub async fn install_fabric(client: &Client, cfg: &Config, root: &Path, mc: &str, loader: &str) -> Result<String> {
    let url = format!("https://meta.fabricmc.net/v2/versions/loader/{}/{}/profile/json", mc, loader);
    let profile: Value = client.get(&url).send().await?.json().await?;
    let id = profile.get("id").and_then(|x| x.as_str()).unwrap_or("").to_string();
    if id.is_empty() { anyhow::bail!("fabric profile missing id"); }
    mojang::write_profile(root, &id, &profile)?;
    // ensure vanilla parent
    if let Some(parent) = profile.get("inheritsFrom").and_then(|x| x.as_str()) {
        mojang::ensure_version_installed(client, cfg, root, parent).await?;
    }
    Ok(id)
}

pub async fn install_quilt(client: &Client, cfg: &Config, root: &Path, mc: &str, loader: &str) -> Result<String> {
    let url = format!("https://meta.quiltmc.org/v3/versions/loader/{}/{}/profile/json", mc, loader);
    let profile: Value = client.get(&url).send().await?.json().await?;
    let id = profile.get("id").and_then(|x| x.as_str()).unwrap_or("").to_string();
    if id.is_empty() { anyhow::bail!("quilt profile missing id"); }
    mojang::write_profile(root, &id, &profile)?;
    if let Some(parent) = profile.get("inheritsFrom").and_then(|x| x.as_str()) {
        mojang::ensure_version_installed(client, cfg, root, parent).await?;
    }
    Ok(id)
}

pub async fn install_forge(client: &Client, cfg: &Config, root: &Path, mc: &str, forge_ver: &str) -> Result<String> {
    let id = format!("forge-{}", forge_ver);
    let vdir = root.join("versions").join(&id);
    if !vdir.join(format!("{}.json", id)).exists() {
        // download installer
        let installer_name = format!("forge-{}-{}-installer.jar", mc, forge_ver);
        let url = format!("https://maven.minecraftforge.net/net/minecraftforge/forge/{}-{}/{}", mc, forge_ver, installer_name);
        let cache = root.join("cache").join(&installer_name);
        crate::http::download_file(client, &url, &cache, None).await?;
        // ensure launcher_profiles.json
        let lp = root.join("launcher_profiles.json");
        if !lp.exists() { std::fs::write(&lp, r#"{"profiles":{}}"#)?; }
        // run installer
        let java = crate::util::pick_java(cfg, 17).unwrap_or_else(|| PathBuf::from("java"));
        let status = std::process::Command::new(&java)
            .arg("-jar").arg(&cache)
            .arg("--installClient").arg(root)
            .current_dir(root)
            .status().context("run forge installer")?;
        if !status.success() { anyhow::bail!("forge installer failed"); }
    }
    // ensure vanilla parent
    let _ = mc;
    Ok(id)
}

pub async fn install_neoforge(client: &Client, cfg: &Config, root: &Path, ver: &str) -> Result<String> {
    let id = format!("neoforge-{}", ver);
    let vdir = root.join("versions").join(&id);
    if !vdir.join(format!("{}.json", id)).exists() {
        let installer_name = format!("neoforge-{}-installer.jar", ver);
        let url = format!("https://maven.neoforged.net/releases/net/neoforged/neoforge/{}/{}", ver, installer_name);
        let cache = root.join("cache").join(&installer_name);
        crate::http::download_file(client, &url, &cache, None).await?;
        let lp = root.join("launcher_profiles.json");
        if !lp.exists() { std::fs::write(&lp, r#"{"profiles":{}}"#)?; }
        let java = crate::util::pick_java(cfg, 17).unwrap_or_else(|| PathBuf::from("java"));
        let status = std::process::Command::new(&java)
            .arg("-jar").arg(&cache)
            .arg("--installClient").arg(root)
            .current_dir(root)
            .status().context("run neoforge installer")?;
        if !status.success() { anyhow::bail!("neoforge installer failed"); }
    }
    Ok(id)
}

// util pick_java moved to util.rs? define here re-export
use std::path::PathBuf;