use anyhow::Result;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::fs;

pub fn ensure_dir(p: &Path) -> Result<()> {
    fs::create_dir_all(p)?;
    Ok(())
}

pub fn slugify(s: &str) -> String {
    let mut out = String::new();
    for c in s.chars() {
        if c.is_alphanumeric() { out.push(c.to_ascii_lowercase()); }
        else if !out.ends_with('-') { out.push('-'); }
    }
    out.trim_matches('-').to_string()
}

pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

pub fn rules_allow(rules: Option<&Value>, is_demo: bool, has_custom_res: bool) -> bool {
    let Some(rules) = rules else { return true; };
    let arr = match rules.as_array() { Some(a) => a, None => return true };
    let mut allowed = false;
    for r in arr {
        let action = r.get("action").and_then(|x| x.as_str()).unwrap_or("allow");
        let mut matches = true;
        if let Some(os) = r.get("os") {
            let name = os.get("name").and_then(|x| x.as_str());
            let arch = os.get("arch").and_then(|x| x.as_str());
            if let Some(n) = name {
                let cur = if cfg!(target_os="windows") { "windows" } else if cfg!(target_os="macos") { "osx" } else { "linux" };
                if n != cur { matches = false; }
            }
            if let Some(a) = arch {
                let cur_arch = if cfg!(target_arch="x86_64") { "x86_64" } else { "x86" };
                if a != cur_arch { matches = false; }
            }
        }
        if let Some(feat) = r.get("features") {
            if let Some(b) = feat.get("is_demo_user").and_then(|x| x.as_bool()) {
                if b != is_demo { matches = false; }
            }
            if let Some(b) = feat.get("has_custom_resolution").and_then(|x| x.as_bool()) {
                if b != has_custom_res { matches = false; }
            }
        }
        if matches {
            allowed = action == "allow";
        }
    }
    allowed
}

pub fn substitute(s: &str, vars: &[(&str,&str)]) -> String {
    let mut out = s.to_string();
    for (k,v) in vars { out = out.replace(&format!("${{{}}}", k), v); }
    out
}

pub fn maven_path(name: &str) -> Option<String> {
    // group:artifact:version or group:artifact:version:classifier
    let parts: Vec<&str> = name.split(':').collect();
    if parts.len() < 3 { return None; }
    let group = parts[0].replace('.', "/");
    let artifact = parts[1];
    let version = parts[2];
    let classifier = parts.get(3).copied();
    let base = format!("{}/{}/{}/{}-{}", group, artifact, version, artifact, version);
    if let Some(c) = classifier { Some(format!("{}-{}.jar", base, c)) } else { Some(format!("{}.jar", base)) }
}
pub fn sha1_hex(bytes: &[u8]) -> String {
    use sha1::Digest;
    let mut h = sha1::Sha1::new();
    h.update(bytes);
    hex::encode(h.finalize())
}
pub fn file_sha1(p: &Path) -> Result<String> {
    let b = fs::read(p)?;
    Ok(sha1_hex(&b))
}

pub fn pick_java(cfg: &crate::config::Config, major: u8) -> Option<PathBuf> {
    for c in cfg.java_candidates(major) {
        if !c.exists() { continue; }
        // verify major
        let out = std::process::Command::new(&c).arg("-version").output().ok()?;
        let txt = String::from_utf8_lossy(&out.stderr);
        // parse "openjdk version \"21.0.4\""
        if let Some(line) = txt.lines().next() {
            if let Some(v) = line.split('"').nth(1) {
                let m: String = v.chars().take_while(|c| c.is_ascii_digit()).collect();
                if m.parse::<u8>().ok() == Some(major) {
                    return Some(c);
                }
            }
        }
    }
    // fallback: first existing
    for c in cfg.java_candidates(major) { if c.exists() { return Some(c); } }
    None
}