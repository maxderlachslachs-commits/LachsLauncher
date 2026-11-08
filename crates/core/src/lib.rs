pub mod config;
pub mod http;
pub mod instance;
pub mod mojang;
pub mod loader;
pub mod curseforge;
pub mod launch;
pub mod discord;
pub mod control;
pub mod skin;
pub mod util;

pub use config::{Config, ConfigPaths};
pub use instance::{Instance, LoaderSpec, InstanceStore};
pub use launch::{LaunchManager, LaunchStatus};
pub use control::ControlServer;
pub use discord::DiscordPresence;

use std::sync::Arc;
use anyhow::Result;

#[derive(Clone)]
pub struct Context {
    pub cfg: Arc<Config>,
    pub http: reqwest::Client,
}

impl Context {
    pub fn new(cfg: Config) -> Result<Self> {
        let http = reqwest::Client::builder()
            .user_agent("LachsLauncher/0.1")
            .build()?;
        Ok(Self { cfg: Arc::new(cfg), http })
    }
    pub fn load() -> Result<Self> {
        let cfg = Config::load()?;
        Self::new(cfg)
    }
}