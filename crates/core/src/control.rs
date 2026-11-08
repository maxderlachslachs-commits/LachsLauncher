use anyhow::Result;
use axum::{extract::{Path, State, Json}, http::StatusCode, routing::{get, post}, Router};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::net::TcpListener;
use tower_http::cors::CorsLayer;
use crate::config::Config;
use crate::instance::Instance;
use crate::launch::LaunchManager;

#[derive(Clone)]
pub struct AppState {
    pub cfg: Arc<Config>,
    pub mgr: Arc<LaunchManager>,
    pub instances: Arc<Mutex<Vec<Instance>>>,
    pub jobs: Arc<Mutex<HashMap<String, Job>>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Job { pub id: String, pub status: String, pub progress: u8, pub message: String }

pub struct ControlServer { pub port: u16 }

impl ControlServer {
    pub async fn serve(state: AppState) -> Result<()> {
        let app = Router::new()
            .route("/api/v1/status", get(status))
            .route("/api/v1/instances", get(list_instances))
            .route("/api/v1/instances/:id/launch", post(launch_instance))
            .route("/api/v1/instances/:id/stop", post(stop_instance))
            .route("/api/v1/modpack/install", post(install_modpack))
            .route("/api/v1/jobs/:id", get(get_job))
            .layer(CorsLayer::permissive())
            .with_state(state);
        let bind = "127.0.0.1";
        let port = 17321;
        let listener = TcpListener::bind((bind, port)).await?;
        axum::serve(listener, app).await?;
        Ok(())
    }
}

async fn status(State(s): State<AppState>) -> Json<serde_json::Value> {
    let running: Vec<String> = s.mgr.running.lock().unwrap().keys().cloned().collect();
    Json(serde_json::json!({"launcher":"LachsLauncher","version":"0.1.0","running":running}))
}
async fn list_instances(State(s): State<AppState>) -> Json<Vec<Instance>> {
    let v = s.instances.lock().unwrap().clone();
    Json(v)
}
#[derive(Deserialize)]
struct LaunchReq { }
async fn launch_instance(State(s): State<AppState>, Path(id): Path<String>) -> (StatusCode, Json<serde_json::Value>) {
    // find instance
    let inst = s.instances.lock().unwrap().iter().find(|i| i.id == id || i.name == id).cloned();
    let Some(inst) = inst else { return (StatusCode::NOT_FOUND, Json(serde_json::json!({"error":"not found"}))); };
    let root = s.cfg.minecraft_dir.clone();
    // need http client; create one
    let http = reqwest::Client::new();
    match crate::launch::launch_instance(&s.mgr, &s.cfg, &http, &inst, &root).await {
        Ok(pid) => (StatusCode::OK, Json(serde_json::json!({"pid":pid,"instance":inst.id}))),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error":e.to_string()}))),
    }
}
async fn stop_instance(State(s): State<AppState>, Path(id): Path<String>) -> (StatusCode, Json<serde_json::Value>) {
    let _ = s.mgr.stop(&id);
    (StatusCode::OK, Json(serde_json::json!({"stopped":id})))
}
#[derive(Deserialize)]
struct InstallReq { target: String, name: Option<String> }
async fn install_modpack(State(s): State<AppState>, Json(req): Json<InstallReq>) -> (StatusCode, Json<serde_json::Value>) {
    let job_id = uuid::Uuid::new_v4().to_string();
    s.jobs.lock().unwrap().insert(job_id.clone(), Job { id: job_id.clone(), status: "running".into(), progress: 0, message: "starting".into() });
    let state = s.clone();
    let jid = job_id.clone();
    tokio::spawn(async move {
        let instance_dir = state.cfg.instances_dir.join(&jid);
        let http = reqwest::Client::new();
        let inst = crate::curseforge::install_from_curseforge(&http, &state.cfg, &req.target, &instance_dir, req.name.as_deref()).await;
        match inst {
            Ok(i) => {
                state.instances.lock().unwrap().push(i.clone());
                let _ = crate::instance::InstanceStore::new(&state.cfg).save(&i);
                state.jobs.lock().unwrap().insert(jid.clone(), Job { id: jid, status: "done".into(), progress: 100, message: format!("installed {}", i.name) });
            }
            Err(e) => {
                state.jobs.lock().unwrap().insert(jid.clone(), Job { id: jid, status: "error".into(), progress: 0, message: e.to_string() });
            }
        }
    });
    (StatusCode::ACCEPTED, Json(serde_json::json!({"job":job_id})))
}
async fn get_job(State(s): State<AppState>, Path(id): Path<String>) -> (StatusCode, Json<serde_json::Value>) {
    if let Some(j) = s.jobs.lock().unwrap().get(&id).cloned() {
        (StatusCode::OK, Json(serde_json::to_value(j).unwrap()))
    } else {
        (StatusCode::NOT_FOUND, Json(serde_json::json!({"error":"job not found"})))
    }
}