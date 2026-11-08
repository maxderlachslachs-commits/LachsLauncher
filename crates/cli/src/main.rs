use clap::{Parser, Subcommand};
use lachslauncher_core::{config::Config, instance::{Instance, InstanceStore}, launch::LaunchManager, Context};
use serde_json::json;
use std::path::{Path, PathBuf};
use std::sync::Arc;

#[derive(Parser)]
#[command(name="lachslauncher", version="0.1.0")]
struct Cli {
    #[arg(long)] json: bool,
    #[command(subcommand)] cmd: Commands,
}

#[derive(Subcommand)]
enum Commands {
    List,
    Launch { name: String, #[arg(long)] detach: bool },
    Stop { name: String },
    Status,
    ImportCf { #[arg(long)] scan: bool, path: Option<PathBuf> },
    Install { target: String, #[arg(long)] name: Option<String> },
    Serve,
    Mcp,
    Config,
    Skin { username: String },
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();
    let cli = Cli::parse();
    if let Err(e) = run(cli).await { eprintln!("error: {:#}", e); std::process::exit(1); }
}

async fn run(cli: Cli) -> anyhow::Result<()> {
    let ctx = Context::load()?;
    let store = InstanceStore::new(&ctx.cfg);
    // load instances (including imported CF not yet registered? list from store)
    let mut instances = store.list().unwrap_or_default();
    // auto-discover CF instances if store empty? no

    match cli.cmd {
        Commands::List => {
            if cli.json {
                println!("{}", serde_json::to_string_pretty(&instances)?);
            } else {
                for i in &instances { println!("{}  [{}]  {}", i.name, i.mc_version, i.loader.kind); }
            }
        }
        Commands::Launch { name, detach: _ } => {
            let inst = store.find_by_name(&name)?.ok_or_else(|| anyhow::anyhow!("instance not found: {}", name))?;
            let mgr = LaunchManager::new();
            let root = ctx.cfg.minecraft_dir.clone();
            let pid = crate::launch_instance_wrapper(&ctx, &mgr, &inst, &root).await?;
            // persist last_played
            let mut i2 = inst.clone(); i2.last_played = Some(lachslauncher_core::util::now_iso());
            let _ = store.save(&i2);
            if cli.json { println!("{}", json!({"pid":pid,"instance":inst.id})); }
            else { println!("Launched {} (pid {})", inst.name, pid); }
        }
        Commands::Stop { name } => {
            // no persistent mgr across processes; kill by pid file? We track via /proc scan by instance name impossible. Use pid from instance? not stored.
            // Simple: find process whose cmdline contains gameDir path
            let inst = store.find_by_name(&name)?.ok_or_else(|| anyhow::anyhow!("instance not found"))?;
            let needle = inst.path.to_string_lossy().to_string();
            let mut killed = 0;
            for entry in std::fs::read_dir("/proc")?.flatten() {
                let pid: u32 = match entry.file_name().to_string_lossy().parse() { Ok(p) => p, _ => continue };
                let cmd = std::fs::read_to_string(format!("/proc/{}/cmdline", pid)).unwrap_or_default();
                if cmd.contains(&needle) && cmd.contains("java") {
                    let _ = std::process::Command::new("kill").arg("-9").arg(pid.to_string()).status();
                    killed += 1;
                }
            }
            if cli.json { println!("{}", json!({"killed":killed})); } else { println!("stopped {}", killed); }
        }
        Commands::Status => {
            let running: Vec<String> = std::fs::read_dir("/proc").ok().into_iter().flat_map(|rd| rd.flatten())
                .filter_map(|e| {
                    let pid: u32 = e.file_name().to_string_lossy().parse().ok()?;
                    let cmd = std::fs::read_to_string(format!("/proc/{}/cmdline", pid)).ok()?;
                    if cmd.contains("LachsLauncher") { None } else { None }
                }).collect();
            let _ = running;
            if cli.json { println!("{}", json!({"instances": instances.len()})); }
            else { println!("{} instances registered", instances.len()); }
        }
        Commands::ImportCf { scan, path } => {
            let cf_root = path.or_else(|| ctx.cfg.curseforge_install.clone()).unwrap_or_default();
            let inst_dir = if scan {
                cf_root.parent().unwrap_or(&cf_root).join("Instances")
            } else { cf_root };
            let mut count = 0;
            if inst_dir.is_dir() {
                for e in std::fs::read_dir(&inst_dir)?.flatten() {
                    let d = e.path();
                    if d.join("minecraftinstance.json").exists() {
                        match crate::import_one(&ctx, &store, &d) {
                            Ok(i) => { store.save(&i)?; count += 1; if !cli.json { println!("imported {}", i.name); } }
                            Err(e) => eprintln!("skip {}: {}", d.display(), e),
                        }
                    }
                }
            }
            if cli.json { println!("{}", json!({"imported":count})); }
        }
        Commands::Install { target, name } => {
            let id = lachslauncher_core::util::slugify(name.as_deref().unwrap_or("modpack"));
            let instance_dir = ctx.cfg.instances_dir.join(&id);
            let inst = crate::curseforge_install_wrapper(&ctx, &target, &instance_dir, name.as_deref()).await?;
            store.save(&inst)?;
            if cli.json { println!("{}", serde_json::to_string_pretty(&inst)?); }
            else { println!("installed {}", inst.name); }
        }
        Commands::Serve => {
            let st = build_state(ctx.clone(), store, instances);
            lachslauncher_core::control::ControlServer::serve(st).await?;
        }
        Commands::Mcp => {
            run_mcp(ctx, store).await?;
        }
        Commands::Config => {
            println!("{}", serde_json::to_string_pretty(ctx.cfg.as_ref())?);
        }
        Commands::Skin { username } => {
            let info = lachslauncher_core::skin::fetch_skin(&ctx.http, &ctx.cfg.data_dir, &username).await?;
            println!("Skin saved: {}", info.path.display());
            println!("UUID: {}", info.uuid);
        }
    }
    Ok(())
}

// helper wrappers to call core fns
async fn launch_instance_wrapper(ctx: &Context, mgr: &LaunchManager, inst: &Instance, root: &Path) -> anyhow::Result<u32> {
    lachslauncher_core::launch::launch_instance(mgr, &ctx.cfg, &ctx.http, inst, root).await
}

async fn curseforge_install_wrapper(ctx: &Context, target: &str, dir: &Path, name: Option<&str>) -> anyhow::Result<Instance> {
    lachslauncher_core::curseforge::install_from_curseforge(&ctx.http, &ctx.cfg, target, dir, name).await
}

fn import_one(ctx: &Context, store: &InstanceStore, d: &Path) -> anyhow::Result<Instance> {
    let inst = lachslauncher_core::instance::import_curseforge_instance(&ctx.cfg, d)?;
    Ok(inst)
}

fn build_state(ctx: Context, _store: InstanceStore, instances: Vec<Instance>) -> lachslauncher_core::control::AppState {
    use lachslauncher_core::control::AppState;
    use std::sync::Mutex;
    AppState {
        cfg: ctx.cfg,
        mgr: Arc::new(LaunchManager::new()),
        instances: Arc::new(Mutex::new(instances)),
        jobs: Arc::new(Mutex::new(std::collections::HashMap::new())),
    }
}

async fn run_mcp(ctx: Context, store: InstanceStore) -> anyhow::Result<()> {
    // minimal MCP stdio: read lines, respond
    use std::io::{BufRead, Write};
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    for line in stdin.lock().lines() {
        let line = match line { Ok(l) => l, Err(_) => break };
        if line.trim().is_empty() { continue; }
        let req: serde_json::Value = match serde_json::from_str(&line) { Ok(v) => v, Err(_) => continue };
        let id = req.get("id").cloned();
        let method = req.get("method").and_then(|x| x.as_str()).unwrap_or("");
        let resp = match method {
            "initialize" => json!({"jsonrpc":"2.0","id":id,"result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"serverInfo":{"name":"lachslauncher","version":"0.1.0"}}}),
            "tools/list" => json!({"jsonrpc":"2.0","id":id,"result":{"tools":[
                {"name":"list_instances","description":"List registered Minecraft instances","inputSchema":{"type":"object","properties":{}}},
                {"name":"launch_instance","description":"Launch an instance by name","inputSchema":{"type":"object","properties":{"name":{"type":"string"}},"required":["name"]}},
                {"name":"stop_instance","description":"Stop an instance","inputSchema":{"type":"object","properties":{"name":{"type":"string"}},"required":["name"]}},
                {"name":"status","description":"Launcher status","inputSchema":{"type":"object","properties":{}}}
            ]}}),
            "tools/call" => {
                let params = req.get("params").cloned().unwrap_or(json!({}));
                let name = params.get("name").and_then(|x| x.as_str()).unwrap_or("");
                let args = params.get("arguments").cloned().unwrap_or(json!({}));
                let result = match name {
                    "list_instances" => {
                        let insts = store.list().unwrap_or_default();
                        json!({"content":[{"type":"text","text": serde_json::to_string_pretty(&insts).unwrap()}]})
                    }
                    "launch_instance" => {
                        let nm = args.get("name").and_then(|x| x.as_str()).unwrap_or("");
                        let inst = store.find_by_name(nm).ok().flatten();
                        if let Some(i) = inst {
                            let mgr = LaunchManager::new();
                            let root = ctx.cfg.minecraft_dir.clone();
                            match lachslauncher_core::launch::launch_instance(&mgr, &ctx.cfg, &ctx.http, &i, &root).await {
                                Ok(pid) => json!({"content":[{"type":"text","text": format!("launched {} pid {}", i.name, pid)}]}),
                                Err(e) => json!({"content":[{"type":"text","text": format!("error: {}", e)}],"isError":true}),
                            }
                        } else {
                            json!({"content":[{"type":"text","text":"instance not found"}],"isError":true})
                        }
                    }
                    "stop_instance" => {
                        // kill by path
                        json!({"content":[{"type":"text","text":"stop requested"}]})
                    }
                    "status" => json!({"content":[{"type":"text","text": format!("{} instances", store.list().map(|v|v.len()).unwrap_or(0))}]}),
                    _ => json!({"content":[{"type":"text","text":"unknown tool"}],"isError":true}),
                };
                json!({"jsonrpc":"2.0","id":id,"result":result})
            }
            _ => json!({"jsonrpc":"2.0","id":id,"result":{}}),
        };
        writeln!(stdout, "{}", resp)?;
        stdout.flush()?;
    }
    Ok(())
}

