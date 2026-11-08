use anyhow::Result;
use serde_json::json;
use std::io::{Read, Write};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

pub struct DiscordPresence { pub client_id: Option<String> }

impl DiscordPresence {
    pub fn new(client_id: Option<String>) -> Self { Self { client_id } }
    fn socket_path() -> Option<PathBuf> {
        let runtime = std::env::var("XDG_RUNTIME_DIR").ok()?;
        for i in 0..10 {
            let p = PathBuf::from(&runtime).join(format!("discord-ipc-{}", i));
            if p.exists() { return Some(p); }
        }
        // snap/flatpak
        let snap = PathBuf::from(&runtime).join("app/com.discordapp.Discord/discord-ipc-0");
        if snap.exists() { return Some(snap); }
        None
    }
    pub fn set_activity(&self, details: &str, state: &str, instance: &str) -> Result<()> {
        let cid = match &self.client_id { Some(c) if !c.is_empty() => c.clone(), _ => return Ok(()) };
        let Some(sock) = Self::socket_path() else { return Ok(()); };
        let mut stream = UnixStream::connect(&sock)?;
        // handshake
        let hs = json!({"v":1,"client_id":cid});
        write_frame(&mut stream, 0, &hs.to_string())?;
        // read response (op 1)
        let _ = read_frame(&mut stream);
        let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();
        let activity = json!({
            "cmd":"SET_ACTIVITY",
            "args":{"pid": std::process::id(), "activity":{
                "details": details,
                "state": state,
                "timestamps":{"start": now},
                "assets":{"large_text": instance},
                "buttons":[{"label":"LachsLauncher","url":"https://github.com"}]
            }},
            "nonce":"1"
        });
        write_frame(&mut stream, 1, &activity.to_string())?;
        let _ = read_frame(&mut stream);
        Ok(())
    }
    pub fn clear(&self) -> Result<()> {
        if self.client_id.is_none() { return Ok(()); }
        let Some(sock) = Self::socket_path() else { return Ok(()); };
        let mut stream = UnixStream::connect(&sock)?;
        let cid = self.client_id.clone().unwrap();
        let hs = json!({"v":1,"client_id":cid});
        write_frame(&mut stream, 0, &hs.to_string())?;
        let _ = read_frame(&mut stream);
        let clear = json!({"cmd":"SET_ACTIVITY","args":{"pid":std::process::id()},"nonce":"2"});
        write_frame(&mut stream, 1, &clear.to_string())?;
        Ok(())
    }
}

fn write_frame(s: &mut UnixStream, op: u32, payload: &str) -> Result<()> {
    let bytes = payload.as_bytes();
    let mut buf = Vec::with_capacity(8+bytes.len());
    buf.extend_from_slice(&op.to_le_bytes());
    buf.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
    buf.extend_from_slice(bytes);
    s.write_all(&buf)?;
    s.flush()?;
    Ok(())
}
fn read_frame(s: &mut UnixStream) -> Result<String> {
    let mut hdr = [0u8;8];
    s.read_exact(&mut hdr)?;
    let len = u32::from_le_bytes([hdr[4],hdr[5],hdr[6],hdr[7]]) as usize;
    let mut buf = vec![0u8; len];
    s.read_exact(&mut buf)?;
    Ok(String::from_utf8_lossy(&buf).to_string())
}

/// Send a Discord webhook notification.
pub async fn webhook_notify(http: &reqwest::Client, url: &str, title: &str, desc: &str) -> Result<()> {
    let body = json!({"embeds":[{"title":title,"description":desc,"color":0x7c3aed}]});
    http.post(url).json(&body).send().await?;
    Ok(())
}