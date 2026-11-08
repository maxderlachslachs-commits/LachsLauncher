use anyhow::{Context, Result};
use reqwest::Client;
use serde_json::Value;
use std::time::Duration;

pub struct McAuth { pub username: String, pub uuid: String, pub access_token: String }

pub async fn device_code_flow(client: &Client, client_id: &str) -> Result<McAuth> {
    // 1. device code
    let resp = client.post("https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode")
        .form(&[("client_id", client_id), ("scope", "XboxLive.signin offline_access")])
        .send().await.context("device code request")?;
    let dc: Value = resp.json().await.context("parse device code")?;
    let device_code = dc.get("device_code").and_then(|x| x.as_str()).ok_or_else(|| anyhow::anyhow!("no device_code"))?.to_string();
    let user_code = dc.get("user_code").and_then(|x| x.as_str()).unwrap_or("");
    let verification_uri = dc.get("verification_uri").and_then(|x| x.as_str()).unwrap_or("https://microsoft.com/link");
    let interval = dc.get("interval").and_then(|x| x.as_u64()).unwrap_or(5);
    eprintln!("Visit {} and enter code: {}", verification_uri, user_code);

    // 2. poll for access token
    let mut ms_access_token = String::new();
    for _ in 0..60 {
        tokio::time::sleep(Duration::from_secs(interval)).await;
        let resp = client.post("https://login.microsoftonline.com/consumers/oauth2/v2.0/token")
            .form(&[("grant_type", "urn:ietf:params:oauth:grant-type:device_code"), ("device_code", &device_code), ("client_id", client_id)])
            .send().await?;
        let v: Value = resp.json().await?;
        if let Some(t) = v.get("access_token").and_then(|x| x.as_str()) {
            ms_access_token = t.to_string();
            break;
        }
        let err = v.get("error").and_then(|x| x.as_str()).unwrap_or("");
        if err == "authorization_pending" { continue; }
        if err == "slow_down" { tokio::time::sleep(Duration::from_secs(5)).await; continue; }
        anyhow::bail!("auth error: {}", err);
    }
    if ms_access_token.is_empty() { anyhow::bail!("timed out waiting for login"); }

    // 3. XBL
    let xbl_body = serde_json::json!({
        "Properties": { "AuthMethod": "RPS", "SiteName": "user.auth.xboxlive.com", "RpsTicket": format!("d={}", ms_access_token) },
        "RelyingParty": "http://auth.xboxlive.com",
        "TokenType": "JWT"
    });
    let resp = client.post("https://user.auth.xboxlive.com/user/authenticate")
        .json(&xbl_body).send().await.context("xbl auth")?;
    let xbl: Value = resp.json().await?;
    let xbl_token = xbl.get("Token").and_then(|x| x.as_str()).ok_or_else(|| anyhow::anyhow!("no xbl token"))?.to_string();
    let uhs = xbl.get("DisplayClaims").and_then(|d| d.get("xui")).and_then(|x| x.as_array()).and_then(|a| a.first()).and_then(|o| o.get("uhs")).and_then(|x| x.as_str()).unwrap_or("").to_string();

    // 4. XSTS
    let xsts_body = serde_json::json!({
        "Properties": { "SandboxId": "RETAIL", "UserTokens": [xbl_token] },
        "RelyingParty": "rp://api.minecraftservices.com/",
        "TokenType": "JWT"
    });
    let resp = client.post("https://xsts.auth.xboxlive.com/xsts/authorize")
        .json(&xsts_body).send().await.context("xsts auth")?;
    let xsts: Value = resp.json().await?;
    let xsts_token = xsts.get("Token").and_then(|x| x.as_str()).ok_or_else(|| anyhow::anyhow!("no xsts token"))?.to_string();

    // 5. Minecraft login
    let mc_body = serde_json::json!({ "identityToken": format!("XBL3.0 x={};{}", uhs, xsts_token) });
    let resp = client.post("https://api.minecraftservices.com/authentication/login_with_xbox")
        .json(&mc_body).send().await.context("mc login")?;
    let mc: Value = resp.json().await?;
    let mc_token = mc.get("access_token").and_then(|x| x.as_str()).ok_or_else(|| anyhow::anyhow!("no mc access token"))?.to_string();

    // 6. profile
    let resp = client.get("https://api.minecraftservices.com/minecraft/profile")
        .bearer_auth(&mc_token).send().await.context("mc profile")?;
    let profile: Value = resp.json().await?;
    let username = profile.get("name").and_then(|x| x.as_str()).unwrap_or("Player").to_string();
    let uuid = profile.get("id").and_then(|x| x.as_str()).unwrap_or("").to_string();

    Ok(McAuth { username, uuid, access_token: mc_token })
}