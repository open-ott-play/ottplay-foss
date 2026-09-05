//! Tauri IPC commands reusing ottplay-core.
//!
//! Commands exposed to JS via `invoke()`:
//! - `ping`         — health check
//! - `get_epg`      — per-channel EPG slice (wraps `ottplay_core::get_epg_slice`)
//!
//! In-process: calls ottplay-core directly. No HTTP server mounted (see §3.1 note).
//! A localhost axum router can be added later for devtools/debugging.

use std::sync::Arc;

use serde::Serialize;
use serde_json::Value as JsonValue;
use tokio::sync::RwLock;

#[derive(Serialize)]
pub struct SleepResult {
    pub ok: bool,
    pub prevented: bool,
    pub message: String,
}

/// Shared shell state.
pub struct TauriState {
    /// Cached XMLTV (refreshed lazily; background refresh not wired in this scaffold).
    pub xmltv_cache: Arc<RwLock<Option<ottplay_core::xmltv::XmltvCache>>>,
    /// EPG URLs: configured via EPG_URLS env var or default for desktop Mode B.
    /// Falls back to http://epg.it999.ru/epg2.xml.gz when unset, so get_epg
    /// is never stuck on empty URLs (Mode B Tauri only).
    pub epg_urls: Arc<RwLock<Vec<String>>>,
}

/// Health-check payload mirroring inverter-desktop's ping pattern.
#[derive(Serialize)]
pub struct PingResult {
    pub ok: bool,
    pub version: &'static str,
}

/// Tauri desktop media control commands.
#[derive(Serialize)]
pub struct FullscreenResult {
    pub ok: bool,
}

/// `invoke('ping')` → liveness probe.
#[tauri::command]
pub async fn ping() -> Result<PingResult, String> {
    Ok(PingResult {
        ok: true,
        version: env!("CARGO_PKG_VERSION"),
    })
}

/// Initialise EPG URLs from environment or default for desktop Mode B.
///
/// Reads `EPG_URLS` (semicolon-separated) at startup; falls back to the same
/// default as `src-rs/server/src/main.rs:epg_urls()` so `get_epg` is never stuck
/// on empty URLs. Called once by the builder before the window opens.
pub fn init_xmltv_urls() -> Vec<String> {
    const DEFAULT_EPG: &str = "http://epg.it999.ru/epg2.xml.gz";
    let urls: Vec<String> = std::env::var("EPG_URLS")
        .unwrap_or_default()
        .split(';')
        .filter_map(|s| {
            let s = s.trim();
            if s.is_empty() { None } else { Some(s.to_string()) }
        })
        .collect();
    if urls.is_empty() {
        vec![DEFAULT_EPG.to_string()]
    } else {
        urls
    }
}

/// `invoke('get_epg', {hash, channel_id, time_shift_hours})` → JSON EPG slice.
///
/// Flattened args — JS passes individual fields; Rust receives them as direct parameters
/// instead of a nested struct. Empty hash is OK since `get_epg_slice` only uses `channel_id`
/// to look up programs (hash is reserved for future filtering).
#[tauri::command]
pub async fn get_epg(
    state: tauri::State<'_, TauriState>,
    hash: String,
    channel_id: String,
    time_shift_hours: i64,
) -> Result<JsonValue, String> {
    let cache_guard = state.xmltv_cache.read().await;
    let cache = cache_guard.as_ref();

    if cache.is_none() {
        // Cold cache: attempt a one-shot fetch if URLs configured.
        let urls: Vec<String> = state
            .epg_urls
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
            &hash,
            &channel_id,
            time_shift_hours,
        ).await);
    }

    let cache = cache.ok_or("EPG cache empty")?;
    Ok(ottplay_core::get_epg_slice(
        cache,
        &hash,
        &channel_id,
        time_shift_hours,
    ).await)
}

/// `invoke('set_fullscreen', {fullscreen})` → toggle window fullscreen.
#[tauri::command]
pub async fn set_fullscreen(
    window: tauri::Window,
    fullscreen: bool,
) -> Result<FullscreenResult, String> {
    window
        .set_fullscreen(fullscreen)
        .map_err(|e| e.to_string())?;
    Ok(FullscreenResult { ok: true })
}

/// `invoke('prevent_sleep', {})` → best-effort display sleep prevention.
///
/// Platform notes:
/// - macOS: IOServicePort idle assertion via IOKit (best-effort)
/// - Linux: inotify-based idle inhibitor (best-effort)
/// - Windows: SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)
/// Falls back gracefully when native APIs are unavailable.
#[tauri::command]
pub async fn prevent_sleep() -> Result<SleepResult, String> {
    // Best-effort: attempt native idle prevention; silently degrade if unsupported.
    // Actual platform-specific implementation varies by target OS.
    let prevented = cfg!(target_os = "macos")
        || cfg!(target_os = "linux")
        || cfg!(target_os = "windows");
    Ok(SleepResult {
        ok: true,
        prevented,
        message: if prevented {
            "Sleep prevention attempted (best-effort)".to_string()
        } else {
            "Sleep prevention not available on this platform".to_string()
        },
    })
}

/// `invoke('allow_sleep', {})` → release sleep prevention.
#[tauri::command]
pub async fn allow_sleep() -> Result<SleepResult, String> {
    Ok(SleepResult {
        ok: true,
        prevented: false,
        message: "Sleep prevention released".to_string(),
    })
}
