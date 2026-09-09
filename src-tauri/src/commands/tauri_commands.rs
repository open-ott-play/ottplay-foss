//! Tauri IPC commands reusing ottplay-core.
//!
//! Commands exposed to JS via `invoke()`:
//! - `ping`         — health check
//! - `get_epg`      — per-channel EPG slice (wraps `ottplay_core::get_epg_slice`)
//! - `play_pip` / `stop_pip` / `set_pip_bounds` — native always-on-top PiP window
//!
//! In-process: calls ottplay-core directly. No HTTP server mounted (see §3.1 note).
//! A localhost axum router can be added later for devtools/debugging.

use std::collections::HashMap;
use std::sync::Arc;

use serde::Serialize;
use serde_json::Value as JsonValue;
use tokio::sync::RwLock;
use super::queue::SharedQueues;

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
    /// epg_hash → xmltv_id map populated by match_channels.
    pub epg_to_xmltv: Arc<RwLock<HashMap<String, String>>>,
    /// epg_hash → time_shift_hours map populated by match_channels.
    pub time_shift_by_epg: Arc<RwLock<HashMap<String, i64>>>,
    /// In-memory command queue for Mode B native webhook / polling API.
    pub command_queues: SharedQueues,
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
    /// Current fullscreen state after the command (Rust is source of truth).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fullscreen: Option<bool>,
}

/// `invoke('ping')` → liveness probe.
#[tauri::command]
pub async fn ping() -> Result<PingResult, String> {
    Ok(PingResult {
        ok: true,
        version: env!("CARGO_PKG_VERSION"),
    })
}

/// Volume get/set payload for Mode B OS mixer sync.
#[derive(Serialize)]
pub struct VolumeResult {
    pub ok: bool,
    pub volume: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unsupported: Option<bool>,
}

/// Parse the first `NN%` token from pactl (or similar) stdout.
#[cfg(target_os = "linux")]
fn parse_first_percent(text: &str) -> Option<i32> {
    let bytes = text.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i].is_ascii_digit() {
            let start = i;
            while i < bytes.len() && bytes[i].is_ascii_digit() {
                i += 1;
            }
            if i < bytes.len() && bytes[i] == b'%' {
                return text[start..i].parse().ok();
            }
        } else {
            i += 1;
        }
    }
    None
}

/// `invoke('get_volume')` → OS output volume percentage (0–100).
#[tauri::command]
pub async fn get_volume() -> Result<VolumeResult, String> {
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        let output = Command::new("osascript")
            .args(["-e", "output volume of (get volume settings)"])
            .output()
            .map_err(|e| format!("failed to read volume: {e}"))?;
        if !output.status.success() {
            return Ok(VolumeResult {
                ok: false,
                volume: 0,
                unsupported: Some(true),
            });
        }
        let text = String::from_utf8_lossy(&output.stdout);
        let vol: i32 = text.trim().parse().unwrap_or(0).clamp(0, 100);
        return Ok(VolumeResult {
            ok: true,
            volume: vol,
            unsupported: None,
        });
    }

    #[cfg(target_os = "linux")]
    {
        use std::process::Command;
        let output = Command::new("pactl")
            .args(["get-sink-volume", "@DEFAULT_SINK@"])
            .output()
            .map_err(|e| format!("failed to read volume: {e}"))?;
        if !output.status.success() {
            return Ok(VolumeResult {
                ok: false,
                volume: 0,
                unsupported: Some(true),
            });
        }
        let text = String::from_utf8_lossy(&output.stdout);
        let vol = parse_first_percent(&text).unwrap_or(0).clamp(0, 100);
        return Ok(VolumeResult {
            ok: true,
            volume: vol,
            unsupported: None,
        });
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        Ok(VolumeResult {
            ok: false,
            volume: 0,
            unsupported: Some(true),
        })
    }
}

/// `invoke('set_volume', {volume})` → set OS output volume (0–100).
#[tauri::command]
pub async fn set_volume(volume: i32) -> Result<VolumeResult, String> {
    let volume = volume.clamp(0, 100);

    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        let status = Command::new("osascript")
            .args(["-e", &format!("set volume output volume {volume}")])
            .status()
            .map_err(|e| format!("failed to set volume: {e}"))?;
        if status.success() {
            return Ok(VolumeResult {
                ok: true,
                volume,
                unsupported: None,
            });
        }
        return Ok(VolumeResult {
            ok: false,
            volume,
            unsupported: Some(true),
        });
    }

    #[cfg(target_os = "linux")]
    {
        use std::process::Command;
        let status = Command::new("pactl")
            .args([
                "set-sink-volume",
                "@DEFAULT_SINK@",
                &format!("{volume}%"),
            ])
            .status()
            .map_err(|e| format!("failed to set volume: {e}"))?;
        if status.success() {
            return Ok(VolumeResult {
                ok: true,
                volume,
                unsupported: None,
            });
        }
        return Ok(VolumeResult {
            ok: false,
            volume,
            unsupported: Some(true),
        });
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        Ok(VolumeResult {
            ok: false,
            volume,
            unsupported: Some(true),
        })
    }
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

/// `invoke('get_epg', {hash, channelId, ch, timeShiftHours})` → JSON EPG slice (Tauri 2 camelCase).
///
/// Mirrors `src-rs/server/src/main.rs::epg_handler`:
/// 1. If `ch` (playlist channel name) provided, fuzzy-match → xmltv_id.
/// 2. Else if `hash` non-empty, lookup `epg_to_xmltv` map (fallback: use hash as xmltv_id).
/// 3. Else fall back to `channel_id` (numeric playlist chId — rarely matches XMLTV id).
#[tauri::command]
pub async fn get_epg(
    state: tauri::State<'_, TauriState>,
    hash: String,
    channel_id: String,
    ch: Option<String>,
    time_shift_hours: i64,
) -> Result<JsonValue, String> {
    let epg_map = state.epg_to_xmltv.read().await;
    let shift_map = state.time_shift_by_epg.read().await;
    let mut shift = time_shift_hours;
    if shift == 0 {
        if let Some(s) = shift_map.get(&hash) {
            shift = *s;
        }
    }

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
        let xmltv_id = resolve_xmltv_id(cache, &hash, &channel_id, ch.as_deref(), &epg_map);
        return Ok(ottplay_core::get_epg_slice(
            cache,
            &hash,
            &xmltv_id,
            shift,
        ).await);
    }

    let cache = cache.ok_or("EPG cache empty")?;
    let xmltv_id = resolve_xmltv_id(cache, &hash, &channel_id, ch.as_deref(), &epg_map);
    Ok(ottplay_core::get_epg_slice(
        cache,
        &hash,
        &xmltv_id,
        shift,
    ).await)
}

/// Resolve xmltv_id like server's epg_handler:
/// - if `ch` provided → fuzzy match against XMLTV channels
/// - else if `hash` non-empty → lookup epg_to_xmltv, else use hash as xmltv_id
/// - else → fallback to `channel_id`
fn resolve_xmltv_id(
    cache: &ottplay_core::xmltv::XmltvCache,
    hash: &str,
    channel_id: &str,
    ch: Option<&str>,
    epg_to_xmltv: &std::collections::HashMap<String, String>,
) -> String {
    if let Some(name) = ch {
        if let Some((id, _score)) = ottplay_core::match_channel(name, &cache.channels) {
            return id;
        }
    }
    if !hash.is_empty() {
        if let Some(id) = epg_to_xmltv.get(hash) {
            return id.clone();
        }
        return hash.to_string();
    }
    channel_id.to_string()
}

/// Tracks macOS simple-fullscreen intent.
///
/// `Window::is_fullscreen()` is false while in `set_simple_fullscreen`, so
/// toggle/exit must consult this flag. Never use a system-wide letter shortcut.
#[cfg(target_os = "macos")]
static MACOS_SIMPLE_FS: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

/// True when the window is in Spaces fullscreen or our macOS simple fullscreen.
fn is_effectively_fullscreen(window: &tauri::Window) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        if MACOS_SIMPLE_FS.load(std::sync::atomic::Ordering::SeqCst) {
            return Ok(true);
        }
    }
    window.is_fullscreen().map_err(|e| e.to_string())
}

/// Apply fullscreen without registering any global letter shortcut.
///
/// On macOS prefer `set_simple_fullscreen` so the webview still receives L and
/// Escape (Spaces/native fullscreen eats those keys). If the window is already
/// in Spaces fullscreen (e.g. green-button), exit via `set_fullscreen(false)`.
/// Other platforms keep `set_fullscreen`.
pub fn apply_fullscreen(
    _app: &tauri::AppHandle,
    window: &tauri::Window,
    fullscreen: bool,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use std::sync::atomic::Ordering;
        let native = window.is_fullscreen().unwrap_or(false);
        if fullscreen {
            if native {
                // Already Spaces FS — leave as-is; JS cannot get keys there.
                MACOS_SIMPLE_FS.store(false, Ordering::SeqCst);
                return Ok(());
            }
            window
                .set_simple_fullscreen(true)
                .map_err(|e| e.to_string())?;
            MACOS_SIMPLE_FS.store(true, Ordering::SeqCst);
        } else {
            if native {
                window
                    .set_fullscreen(false)
                    .map_err(|e| e.to_string())?;
            }
            // Always clear simple FS flag/mode on exit intent.
            let _ = window.set_simple_fullscreen(false);
            MACOS_SIMPLE_FS.store(false, Ordering::SeqCst);
        }
        return Ok(());
    }
    #[cfg(not(target_os = "macos"))]
    {
        window
            .set_fullscreen(fullscreen)
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

/// `invoke('set_fullscreen', {fullscreen})` → set window fullscreen.
#[tauri::command]
pub async fn set_fullscreen(
    app: tauri::AppHandle,
    window: tauri::Window,
    fullscreen: bool,
) -> Result<FullscreenResult, String> {
    apply_fullscreen(&app, &window, fullscreen)?;
    Ok(FullscreenResult {
        ok: true,
        fullscreen: Some(fullscreen),
    })
}

/// `invoke('toggle_fullscreen')` → flip effective fullscreen (simple FS on macOS).
/// Single Rust source of truth — no JS cache / API naming guesswork.
#[tauri::command]
pub async fn toggle_fullscreen(
    app: tauri::AppHandle,
    window: tauri::Window,
) -> Result<FullscreenResult, String> {
    let cur = is_effectively_fullscreen(&window)?;
    let next = !cur;
    apply_fullscreen(&app, &window, next)?;
    Ok(FullscreenResult {
        ok: true,
        fullscreen: Some(next),
    })
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
/// Result payload for native PiP commands.
#[derive(Serialize)]
pub struct PipResult {
    pub ok: bool,
}

const PIP_LABEL: &str = "pip";
const PIP_CANVAS_W: f64 = 1280.0;
const PIP_CANVAS_H: f64 = 720.0;
const PIP_MARGIN: f64 = 20.0;

/// Map size index to logical inner size (matches core pipPresets).
fn pip_size(size: i32) -> (f64, f64) {
    match size.clamp(0, 2) {
        0 => (256.0, 144.0),
        1 => (384.0, 216.0),
        _ => (512.0, 288.0),
    }
}

/// Corner positions: 0 TR, 1 BR, 2 BL, 3 TL against a logical canvas.
fn pip_logical_xy(position: i32, w: f64, h: f64, canvas_w: f64, canvas_h: f64) -> (f64, f64) {
    let pos = ((position % 4) + 4) % 4;
    match pos {
        0 => (canvas_w - w - PIP_MARGIN, PIP_MARGIN),
        1 => (canvas_w - w - PIP_MARGIN, canvas_h - h - PIP_MARGIN),
        2 => (PIP_MARGIN, canvas_h - h - PIP_MARGIN),
        _ => (PIP_MARGIN, PIP_MARGIN),
    }
}


/// Bootstrap / reload a full-bleed video inside the PiP webview.
/// HLS (.m3u8) loads hls.js@1.6.16 from jsDelivr; other URLs use video.src.
fn pip_player_script(url: &str) -> String {
    let url_json = serde_json::to_string(url).unwrap_or_else(|_| "\"\"".to_string());
    format!(
        r#" (function(){{
  var url = {url_json};
  try {{
    document.documentElement.style.cssText = 'margin:0;padding:0;width:100%;height:100%;background:#000;overflow:hidden;';
    if (document.body) {{
      document.body.style.cssText = 'margin:0;padding:0;width:100%;height:100%;background:#000;overflow:hidden;';
      document.body.innerHTML = '';
    }}
  }} catch (e) {{}}
  var video = document.createElement('video');
  video.id = 'ottplay-pip-video';
  video.autoplay = true;
  video.controls = false;
  video.playsInline = true;
  video.style.cssText = 'width:100%;height:100%;object-fit:contain;background:#000;display:block;';
  (document.body || document.documentElement).appendChild(video);
  function playDirect() {{
    video.src = url;
    var p = video.play();
    if (p && p.catch) p.catch(function(){{}});
  }}
  var isHls = /\.m3u8(\?|$)/i.test(url);
  if (isHls) {{
    function startHls() {{
      if (window.Hls && Hls.isSupported()) {{
        if (window.__ottplayPipHls) {{
          try {{ window.__ottplayPipHls.destroy(); }} catch (e) {{}}
        }}
        var hls = new Hls();
        window.__ottplayPipHls = hls;
        hls.loadSource(url);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, function () {{
          var p = video.play();
          if (p && p.catch) p.catch(function(){{}});
        }});
      }} else if (video.canPlayType('application/vnd.apple.mpegurl')) {{
        playDirect();
      }} else {{
        playDirect();
      }}
    }}
    if (window.Hls) {{
      startHls();
    }} else {{
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/hls.js@1.6.16/dist/hls.min.js';
      s.onload = startHls;
      s.onerror = playDirect;
      (document.head || document.documentElement).appendChild(s);
    }}
  }} else {{
    playDirect();
  }}
}})();
"#
    )
}


fn pip_stop_script() -> &'static str {
    r#"(function(){
  var v = document.getElementById('ottplay-pip-video');
  if (v) {
    try { v.pause(); v.removeAttribute('src'); v.load(); } catch (e) {}
  }
  if (window.__ottplayPipHls) {
    try { window.__ottplayPipHls.destroy(); } catch (e) {}
    window.__ottplayPipHls = null;
  }
})();"#
}

fn apply_pip_bounds(
    win: &tauri::WebviewWindow,
    position: i32,
    size: i32,
) -> Result<(), String> {
    let (w, h) = pip_size(size);

    // Prefer primary monitor logical size; fall back to 1280x720 MVP canvas.
    let (origin_x, origin_y, canvas_w, canvas_h) = match win.primary_monitor() {
        Ok(Some(mon)) => {
            let scale = mon.scale_factor();
            let mon_size = mon.size();
            let pos = mon.position();
            (
                pos.x as f64 / scale,
                pos.y as f64 / scale,
                mon_size.width as f64 / scale,
                mon_size.height as f64 / scale,
            )
        }
        _ => (0.0, 0.0, PIP_CANVAS_W, PIP_CANVAS_H),
    };

    let (x, y) = pip_logical_xy(position, w, h, canvas_w, canvas_h);
    win.set_size(tauri::LogicalSize::new(w, h))
        .map_err(|e| e.to_string())?;
    win.set_position(tauri::LogicalPosition::new(origin_x + x, origin_y + y))
        .map_err(|e| e.to_string())?;
    Ok(())
}


/// invoke play_pip {url} -> native always-on-top PiP webview that plays the stream.
#[tauri::command]
pub async fn play_pip(app: tauri::AppHandle, url: String) -> Result<PipResult, String> {
    use tauri::Manager;
    use tauri::webview::PageLoadEvent;

    if let Some(win) = app.get_webview_window(PIP_LABEL) {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
        win.eval(&pip_player_script(&url))
            .map_err(|e| e.to_string())?;
        return Ok(PipResult { ok: true });
    }

    // about:blank + eval avoids booting the full companion UI inside PiP.
    let web_url = tauri::WebviewUrl::External(
        "about:blank"
            .parse()
            .map_err(|e| format!("invalid pip url: {e}"))?,
    );

    let (w, h) = pip_size(2);
    let script_on_load = pip_player_script(&url);
    let script_immediate = script_on_load.clone();

    let win = tauri::WebviewWindowBuilder::new(&app, PIP_LABEL, web_url)
        .title("OttPlay PiP")
        .inner_size(w, h)
        .resizable(true)
        .visible(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .on_page_load(move |window, payload| {
            if matches!(payload.event(), PageLoadEvent::Finished) {
                let _ = window.eval(&script_on_load);
            }
        })
        .build()
        .map_err(|e| e.to_string())?;

    // Best-effort immediate eval (about:blank may already be finished).
    let _ = win.eval(&script_immediate);
    let _ = apply_pip_bounds(&win, 0, 2);

    Ok(PipResult { ok: true })
}

/// invoke stop_pip -> pause/clear video and close the PiP window.
#[tauri::command]
pub async fn stop_pip(app: tauri::AppHandle) -> Result<PipResult, String> {
    use tauri::Manager;

    if let Some(win) = app.get_webview_window(PIP_LABEL) {
        let _ = win.eval(pip_stop_script());
        let _ = win.hide();
        let _ = win.close();
    }
    Ok(PipResult { ok: true })
}

/// invoke set_pip_bounds {position, size} -> corner + preset size for the PiP window.
#[tauri::command]
pub async fn set_pip_bounds(
    app: tauri::AppHandle,
    position: i32,
    size: i32,
) -> Result<PipResult, String> {
    use tauri::Manager;

    if let Some(win) = app.get_webview_window(PIP_LABEL) {
        apply_pip_bounds(&win, position, size)?;
    }
    Ok(PipResult { ok: true })
}

/// `invoke('exit_app')` → close main window and exit the process.
///
/// Browser `window.close()` does not quit a Tauri app; Escape → confirm → Enter
/// calls `stbExit()`, which must invoke this under `__TAURI__`.
#[tauri::command]
pub fn exit_app(app: tauri::AppHandle) {
    use tauri::Manager;
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.close();
    }
    app.exit(0);
}

/// `invoke('proxy_fetch', { url })` — GET a remote URL (playlist / companion
/// `cp.php` stand-in) without CORS. Leading `@` is stripped (provider form).
/// Used only for text-sized bodies (M3U playlists), not media streams.
#[tauri::command]
pub async fn proxy_fetch(url: String) -> Result<String, String> {
    let params = ottplay_core::m3u::ProxyParams {
        url,
        ua: String::new(),
    };
    let (_headers, body) = ottplay_core::m3u::proxy_stream(params).await?;
    Ok(String::from_utf8_lossy(&body).into_owned())
}
