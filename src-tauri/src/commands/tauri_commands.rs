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

/// `invoke('get_epg', {hash, channel_id, ch, time_shift_hours})` → JSON EPG slice.
///
/// Mirrors `src-rs/server/src/main.rs::epg_handler`:
/// 1. If `ch` (playlist channel name) provided, fuzzy-match → xmltv_id.
/// 2. Else if `hash` non-empty, lookup `epg_to_xmltv` map (not in Tauri state; use hash as xmltv_id).
/// 3. Else fall back to `channel_id` (numeric playlist chId — rarely matches XMLTV id).
#[tauri::command]
pub async fn get_epg(
    state: tauri::State<'_, TauriState>,
    hash: String,
    channel_id: String,
    ch: Option<String>,
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
        let xmltv_id = resolve_xmltv_id(&cache, &hash, &channel_id, ch.as_deref());
        return Ok(ottplay_core::get_epg_slice(
            cache,
            &hash,
            &xmltv_id,
            time_shift_hours,
        ).await);
    }

    let cache = cache.ok_or("EPG cache empty")?;
    let xmltv_id = resolve_xmltv_id(cache, &hash, &channel_id, ch.as_deref());
    Ok(ottplay_core::get_epg_slice(
        cache,
        &hash,
        &xmltv_id,
        time_shift_hours,
    ).await)
}

/// Resolve xmltv_id like server's epg_handler:
/// - if `ch` provided → fuzzy match against XMLTV channels
/// - else if `hash` non-empty → use as xmltv_id (epg_to_xmltv map not in Tauri state)
/// - else → fallback to `channel_id`
fn resolve_xmltv_id(
    cache: &ottplay_core::xmltv::XmltvCache,
    hash: &str,
    channel_id: &str,
    ch: Option<&str>,
) -> String {
    if let Some(name) = ch {
        if let Some((id, _score)) = ottplay_core::match_channel(name, &cache.channels) {
            return id;
        }
    }
    if !hash.is_empty() {
        return hash.to_string();
    }
    channel_id.to_string()
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
/// Platform notes (mirror server.py::prevent_sleep patterns):
/// - macOS: `caffeinate -i -s` (spawns native sleep-prevention assertion process)
/// - Linux: `systemd-inhibit` (spawns process that blocks idle/sleep via D-Bus)
/// - Windows: `SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)` via FFI
/// Falls back gracefully when native APIs are unavailable.
#[tauri::command]
pub async fn prevent_sleep() -> Result<SleepResult, String> {
    let prevented = prevent_sleep_native();
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

/// Spawned process handle for platforms that use a keepalive process (macOS/Linux).
#[cfg(any(target_os = "macos", target_os = "linux"))]
static SLEEP_PROC: std::sync::OnceLock<std::sync::Mutex<Option<u32>>> =
    std::sync::OnceLock::new();

/// Platform-specific sleep prevention.
#[cfg(target_os = "macos")]
fn prevent_sleep_native() -> bool {
    // macOS: `caffeinate -i -s` prevents idle sleep + system sleep for as long
    // as the child process runs. We spawn it and store the PID so allow_sleep
    // can terminate it.
    let child = match std::process::Command::new("caffeinate")
        .args(["-i", "-s"])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
    {
        Ok(c) => c,
        Err(_) => return false,
    };
    let pid = child.id();
    std::mem::forget(child); // keep process alive; killed in allow_sleep_native
    let mut guard = SLEEP_PROC.get_or_init(Default::default).lock().unwrap();
    *guard = Some(pid);
    true
}

#[cfg(target_os = "linux")]
fn prevent_sleep_native() -> bool {
    // Linux: `systemd-inhibit` blocks idle + sleep via D-Bus for the lifetime
    // of the child process. We spawn and store the PID so allow_sleep can kill it.
    let child = match std::process::Command::new("systemd-inhibit")
        .args(["--what=idle", "--what=sleep", "--mode=block", "--", "sleep", "infinity"])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
    {
        Ok(c) => c,
        Err(_) => return false,
    };
    let pid = child.id();
    std::mem::forget(child);
    let mut guard = SLEEP_PROC.get_or_init(Default::default).lock().unwrap();
    *guard = Some(pid);
    true
}

/// Windows: `SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)`.
/// Stateless — the assertion persists until the calling process exits or a
/// subsequent call with ES_CONTINUOUS only.
#[cfg(target_os = "windows")]
fn prevent_sleep_native() -> bool {
    const ES_CONTINUOUS: u32 = 0x80000000;
    const ES_SYSTEM_REQUIRED: u32 = 0x00000001;

    extern "system" {
        fn SetThreadExecutionState(flags: u32) -> u32;
    }

    let prev = unsafe { SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED) };
    prev != 0 // non-zero return = succeeded
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
fn prevent_sleep_native() -> bool {
    false
}

/// `invoke('allow_sleep', {})` → release sleep prevention.
#[tauri::command]
pub async fn allow_sleep() -> Result<SleepResult, String> {
    allow_sleep_native();
    Ok(SleepResult {
        ok: true,
        prevented: false,
        message: "Sleep prevention released".to_string(),
    })
}

/// Platform-specific sleep allowance (release assertion).
#[cfg(any(target_os = "macos", target_os = "linux"))]
fn allow_sleep_native() {
    // Terminate the spawned keepalive process so the machine can sleep again.
    let guard = SLEEP_PROC.get_or_init(Default::default).lock().unwrap();
    if let Some(pid) = *guard {
        // kill the process — ignore result (may have already exited)
        let _ = std::process::Command::new("kill")
            .arg(pid.to_string())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
    }
}

#[cfg(target_os = "windows")]
fn allow_sleep_native() {
    const ES_CONTINUOUS: u32 = 0x80000000;
    extern "system" {
        fn SetThreadExecutionState(flags: u32) -> u32;
    }
    unsafe {
        SetThreadExecutionState(ES_CONTINUOUS);
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
fn allow_sleep_native() {}
