//! Stalker portal + host_ott swop transport for Tauri Mode B.
//!
//! Provider scripts (`prov/stalker/prov.js`) POST JSON-RPC to
//! `<portal>/stalker_portal/api/`. Dealer/cloud entry POSTs form bodies to
//! `host_ott/swop/a.php`. Embed Mode B has no companion HTTP server and
//! WebView CORS would block those origins — forward from Rust.

use reqwest::Client;
use serde::Serialize;
use std::time::Duration;

/// Result shape for `invoke('stalker_portal_fetch')`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StalkerPortalResult {
    pub status: u16,
    pub body: String,
    pub content_type: String,
}

fn is_allowed_url(url: &str) -> bool {
    url.contains("/stalker_portal/api/")
        || url.contains("/stalker_portal/stream/")
        || url.contains("/swop/a.php")
}

/// `invoke('stalker_portal_fetch', { url, method, body, contentType })` —
/// forward a Stalker portal or host_ott swop request from the webview
/// without CORS.
///
/// Timeout mirrors provider scripts (`15s`). When `body` is present,
/// `contentType` (default `application/json`) is set as Content-Type.
/// Swop dealer/cloud POSTs use `application/x-www-form-urlencoded`.
#[tauri::command]
pub async fn stalker_portal_fetch(
    url: String,
    method: Option<String>,
    body: Option<String>,
    content_type: Option<String>,
) -> Result<StalkerPortalResult, String> {
    let url = url.trim().to_string();
    if url.is_empty() {
        return Err("stalker_portal_fetch: missing url".into());
    }
    if !is_allowed_url(&url) {
        return Err(
            "stalker_portal_fetch: url is not a stalker_portal or swop/a.php path"
                .into(),
        );
    }

    let method_str = method.unwrap_or_else(|| "GET".to_string()).to_uppercase();
    let method = reqwest::Method::from_bytes(method_str.as_bytes())
        .map_err(|e| format!("invalid method: {e}"))?;

    let client = Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    let mut req = client.request(method, &url);
    if let Some(b) = body {
        if !b.is_empty() {
            let ct = content_type
                .as_deref()
                .filter(|s| !s.is_empty())
                .unwrap_or("application/json");
            req = req.header("Content-Type", ct).body(b);
        }
    }

    let resp = req.send().await.map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let content_type = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();

    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    let body = String::from_utf8_lossy(&bytes).into_owned();

    Ok(StalkerPortalResult {
        status,
        body,
        content_type,
    })
}
