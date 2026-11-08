use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::fs;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthConfig {
    pub username: String,
    pub uuid: String,
    #[serde(default)]
    pub access_token: Option<String>,
}
impl Default for AuthConfig {
    fn default() -> Self {
        Self { username: "Player".into(), uuid: String::new(), access_token: None }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscordConfig {
    pub client_id: Option<String>,
    pub webhook_url: Option<String>,
    pub enabled: bool,
}
impl Default for DiscordConfig {
    fn default() -> Self { Self { client_id: None, webhook_url: None, enabled: true } }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ControlConfig {
    pub port: u16,
    pub token: Option<String>,
    pub bind: String,
}
impl Default for ControlConfig {
    fn default() -> Self { Self { port: 17321, token: None, bind: "127.0.0.1".into() } }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub data_dir: PathBuf,
    pub instances_dir: PathBuf,
    pub minecraft_dir: PathBuf,
    pub java_path: Option<PathBuf>,
    pub default_memory_mb: u32,
    pub extra_jvm_args: Vec<String>,
    pub curseforge_api_key: Option<String>,
    #[serde(default)]
    pub auth_client_id: Option<String>,
    pub auth: AuthConfig,
    pub discord: DiscordConfig,
    pub control: ControlConfig,
    pub reuse_curseforge_install: bool,
    pub curseforge_install: Option<PathBuf>,
    pub close_after_launch: bool,
}

impl Config {
    pub fn default() -> Self {
        let data_dir = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."))
            .join("lachslauncher");
        let mut cfg = Self {
            data_dir: data_dir.clone(),
            instances_dir: data_dir.join("instances"),
            minecraft_dir: data_dir.join("minecraft"),
            java_path: None,
            default_memory_mb: 4096,
            extra_jvm_args: vec![],
            curseforge_api_key: std::env::var("CURSEFORGE_API_KEY").ok(),
            auth_client_id: Some("00000000402b5328".to_string()),
            auth: AuthConfig { username: "Player".into(), ..Default::default() },
            discord: DiscordConfig::default(),
            control: ControlConfig::default(),
            reuse_curseforge_install: true,
            curseforge_install: None,
            close_after_launch: false,
        };
        // detect CF install
        let candidates = [
            "/mnt/games/Curseforge/Install",
            "C:\\Games\\CurseForge\\Install",
        ];
        for c in candidates {
            let p = PathBuf::from(c);
            if p.join("libraries").is_dir() {
                cfg.curseforge_install = Some(p);
                break;
            }
        }
        // also scan home common
        if cfg.curseforge_install.is_none() {
            if let Some(home) = dirs::home_dir() {
                let guess = home.join("Games/CurseForge/Install");
                if guess.join("libraries").is_dir() { cfg.curseforge_install = Some(guess); }
            }
        }
        cfg
    }

    pub fn path() -> Result<PathBuf> {
        let data = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from(".")).join("lachslauncher");
        Ok(data.join("config.json"))
    }

    pub fn load() -> Result<Self> {
        let p = Self::path()?;
        if !p.exists() {
            let cfg = Self::default();
            cfg.save()?;
            return Ok(cfg);
        }
        let raw = fs::read_to_string(&p)?;
        let cfg: Self = serde_json::from_str(&raw).context("parse config")?;
        Ok(cfg)
    }

    pub fn save(&self) -> Result<()> {
        let p = Self::path()?;
        if let Some(parent) = p.parent() { fs::create_dir_all(parent)?; }
        fs::create_dir_all(&self.data_dir)?;
        fs::create_dir_all(&self.instances_dir)?;
        fs::create_dir_all(&self.minecraft_dir)?;
        let s = serde_json::to_string_pretty(self)?;
        fs::write(&p, s)?;
        // adopt share links
        self.adopt_share_links();
        Ok(())
    }

    pub fn adopt_share_links(&self) {
        if !self.reuse_curseforge_install { return; }
        if let Some(cf) = &self.curseforge_install {
            for name in ["assets", "libraries"] {
                let src = cf.join(name);
                let dst = self.minecraft_dir.join(name);
                if src.is_dir() && !dst.exists() {
                    let _ = std::os::unix::fs::symlink(&src, &dst);
                }
            }
        }
    }

    pub fn java_candidates(&self, major: u8) -> Vec<PathBuf> {
        let mut out = Vec::new();
        if let Some(p) = &self.java_path { out.push(p.clone()); }
        if let Ok(jh) = std::env::var("JAVA_HOME") { out.push(PathBuf::from(jh).join("bin/java")); }
        // system
        for j in ["java-17-openjdk","java-21-openjdk","java-25-openjdk","default","default-runtime"] {
            out.push(PathBuf::from(format!("/usr/lib/jvm/{}/bin/java", j)));
        }
        // CF java installs
        if let Some(cf) = &self.curseforge_install {
            let jdir = cf.parent().unwrap_or(cf).join("java");
            if let Ok(rd) = fs::read_dir(&jdir) {
                for e in rd.flatten() {
                    out.push(e.path().join("bin/java"));
                }
            }
        }
        // downloaded
        out.push(self.data_dir.join(format!("java/{}", major)).join("bin/java"));
        out
    }
}

pub struct ConfigPaths;
impl ConfigPaths {
    pub fn data_dir() -> PathBuf {
        Config::load().map(|c| c.data_dir).unwrap_or_else(|_| PathBuf::from("."))
    }
}