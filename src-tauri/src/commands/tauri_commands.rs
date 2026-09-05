//! Tauri IPC commands reusing ottplay-core.
//!
//! Commands exposed to JS via `invoke()`:
//! - `ping`         — health check
//! - `get_epg`      — per-channel EPG slice (wraps `ottplay_core::get_epg_slice`)
//!
//! In-process: calls ottplay-core directly. No HTTP server mounted (see §3.1 note).
//! A localhost axum router can be added later for devtools/debugging.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use tokio::sync::RwLock;

/// Shared shell state.
pub struct TauriState {
    /// Cached XMLTV (refreshed lazily; background refresh not wired in this scaffold).
    pub xmltv_cache: Arc<RwLock<Option<ottplay_core::xmltv::XmltvCache>>>,
    pub xmltv_urls: Arc<RwLock<Vec<String>>>,
}

/// Health-check payload mirroring inverter-desktop's ping pattern.
#[derive(Serialize)]
pub struct PingResult {
    pub ok: bool,
    pub version: &'static str,
}

/// `invoke('ping')` → liveness probe.
#[tauri::command]
pub async fn ping() -> Result<PingResult, String> {
    Ok(PingResult {
        ok: true,
        version: env!("CARGO_PKG_VERSION"),
    })
}

/// Args for `get_epg`.
#[derive(Deserialize)]
pub struct EpgArgs {
    pub hash: String,
    pub channel_id: String,
    pub time_shift_hours: i64,
}

/// `invoke('get_epg', {hash, channel_id, time_shift_hours})` → JSON EPG slice.
///
/// Reads the in-process cache. If cache is cold and URLs are configured, triggers a one-shot fetch.
#[tauri::command]
pub async fn get_epg(
    state: tauri::State<'_, TauriState>,
    args: EpgArgs,
) -> Result<JsonValue, String> {
    let cache_guard = state.xmltv_cache.read().await;
    let cache = cache_guard.as_ref();

    if cache.is_none() {
        // Cold cache: attempt a one-shot fetch if URLs configured.
        let urls: Vec<String> = state
            .xmltv_urls
            .read()
            .await
            .iter()
            .cloned()
            .collect();
        if urls.is_empty() {
            return Err("EPG cache empty and no XMLTV URLs configured".to_string());
        }
        drop(cache_guard);
        let fresh = ottplay_core::fetch_xmltv(&urls)
            .await
            .map_err(|e| e.to_string())?;
        let mut w = state.xmltv_cache.write().await;
        *w = Some(fresh);
        let cache = w.as_ref().ok_or("EPG cache still empty")?;
        return Ok(ottplay_core::get_epg_slice(
            cache,
            &args.hash,
            &args.channel_id,
            args.time_shift_hours,
        ).await);
    }

    let cache = cache.ok_or("EPG cache empty")?;
    Ok(ottplay_core::get_epg_slice(
        cache,
        &args.hash,
        &args.channel_id,
        args.time_shift_hours,
    ).await)
}
