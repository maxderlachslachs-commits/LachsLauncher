use anyhow::{Context, Result};
use reqwest::Client;
use std::path::{Path, PathBuf};
use std::fs;
use futures::StreamExt;

pub async fn download_file(client: &Client, url: &str, dest: &Path, sha1: Option<&str>) -> Result<()> {
    if let Some(parent) = dest.parent() { fs::create_dir_all(parent)?; }
    if dest.exists() {
        if let Some(s) = sha1 {
            if let Ok(got) = crate::util::file_sha1(dest) { if got == s { return Ok(()); } }
        } else { return Ok(()); }
    }
    let resp = client.get(url).send().await.context("GET")?;
    if !resp.status().is_success() {
        anyhow::bail!("HTTP {} for {}", resp.status(), url);
    }
    let bytes = resp.bytes().await.context("read body")?;
    fs::write(dest, &bytes)?;
    if let Some(s) = sha1 {
        let got = crate::util::file_sha1(dest)?;
        if got != s { anyhow::bail!("sha1 mismatch for {}: got {} want {}", url, got, s); }
    }
    Ok(())
}

pub async fn download_json(client: &Client, url: &str) -> Result<serde_json::Value> {
    let resp = client.get(url).send().await.context("GET")?;
    if !resp.status().is_success() { anyhow::bail!("HTTP {} for {}", resp.status(), url); }
    let v: serde_json::Value = resp.json().await.context("parse json")?;
    Ok(v)
}

pub fn download_file_blocking(client: &Client, url: &str, dest: &Path, sha1: Option<&str>) -> Result<()> {
    tokio::runtime::Handle::current().block_on(download_file(client, url, dest, sha1))
}

pub async fn download_many(client: &Client, tasks: Vec<(String, PathBuf, Option<String>)>) -> Result<()> {
    let stream = futures::stream::iter(tasks.into_iter().map(|(url, dest, sha)| {
        let c = client.clone();
        async move { download_file(&c, &url, &dest, sha.as_deref()).await }
    })).buffer_unordered(8);
    let results: Vec<Result<()>> = stream.collect().await;
    for r in results { r?; }
    Ok(())
}