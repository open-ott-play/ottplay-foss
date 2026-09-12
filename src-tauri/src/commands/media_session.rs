//! OS media controls for Tauri Mode B (souvlaki → MPRIS / macOS Now Playing / Windows SMTC).
//!
//! Transport events eval into the main webview (`<video>` play/pause + `_doKey` next/prev),
//! mirroring Cap MobileNativeMedia lock-screen wiring. Artwork via `cover_url` when the
//! souvlaki backend supports it. Seek only when JS marks `seekable` (VOD/archive with
//! known duration); live IPTV leaves seek as a no-op without claiming success.

use serde::Serialize;
use souvlaki::{
    MediaControlEvent, MediaControls, MediaMetadata, MediaPlayback, MediaPosition, PlatformConfig,
    SeekDirection,
};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Manager, State};

const JS_PLAY: &str = "if(window.stbContinue&&window.stbIsPlaying&&!window.stbIsPlaying())window.stbContinue(); true;";
const JS_PAUSE: &str = "if(window.stbPause)window.stbPause(); true;";
const JS_STOP: &str = "if(window.stbStop)window.stbStop(); true;";
const JS_NEXT: &str = "(function(){if(window._doKey&&window.keys)window._doKey(window.keys.NEXT);})();";
const JS_PREV: &str = "(function(){if(window._doKey&&window.keys)window._doKey(window.keys.PREV);})();";

pub struct MediaSessionState {
    inner: Mutex<Option<MediaSessionInner>>,
}

struct MediaSessionInner {
    controls: MediaControls,
    seekable: bool,
    /// Last known duration for relative seek clamps (seconds).
    duration_secs: Option<f64>,
}

impl Default for MediaSessionState {
    fn default() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct MediaSessionResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unsupported: Option<bool>,
}

fn ok() -> MediaSessionResult {
    MediaSessionResult {
        ok: true,
        error: None,
        unsupported: None,
    }
}

fn err(msg: impl Into<String>) -> MediaSessionResult {
    MediaSessionResult {
        ok: false,
        error: Some(msg.into()),
        unsupported: None,
    }
}

fn eval_main(app: &AppHandle, js: &str) {
    if let Some(win) = app.get_webview_window("main") {
        if let Err(e) = win.eval(js) {
            tracing::warn!("media_session eval failed: {e}");
        }
    } else {
        tracing::warn!("media_session: main webview missing");
    }
}

fn js_seek_abs(secs: f64) -> String {
    format!(
        "(function(){{var t={secs}; if(!(isFinite(t)&&t>=0))return; \
         if(window.stbSetPosTime){{window.stbSetPosTime(t);}} \
         else {{var v=document.querySelector('video'); if(v&&isFinite(v.duration)){{v.currentTime=t;}}}}}})();"
    )
}

fn js_seek_rel(delta_secs: f64) -> String {
    format!(
        "(function(){{var d={delta_secs}; \
         if(window.stbGetPosTime&&window.stbSetPosTime){{\
           var t=window.stbGetPosTime()+d; var len=window.stbGetLen?window.stbGetLen():0;\
           if(isFinite(len)&&len>0){{if(t<0)t=0; if(t>len)t=len;}} \
           window.stbSetPosTime(t); return;}}\
         var v=document.querySelector('video'); if(!v||!isFinite(v.duration))return; \
         var t=v.currentTime+d; if(t<0)t=0; if(t>v.duration)t=v.duration; v.currentTime=t;}})();"
    )
}

fn hwnd_for(app: &AppHandle) -> Option<*mut std::ffi::c_void> {
    #[cfg(target_os = "windows")]
    {
        use raw_window_handle::{HasWindowHandle, RawWindowHandle};
        let win = app.get_webview_window("main")?;
        let handle = win.window_handle().ok()?;
        match handle.as_raw() {
            RawWindowHandle::Win32(h) => Some(h.hwnd.get() as *mut std::ffi::c_void),
            _ => None,
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        None
    }
}

fn ensure_controls(app: &AppHandle, state: &MediaSessionState) -> Result<(), String> {
    let mut guard = state
        .inner
        .lock()
        .map_err(|_| "media session lock poisoned".to_string())?;
    if guard.is_some() {
        return Ok(());
    }

    let hwnd = hwnd_for(app);
    #[cfg(target_os = "windows")]
    if hwnd.is_none() {
        return Err("windows media session requires main window hwnd".into());
    }

    let config = PlatformConfig {
        dbus_name: "play.ott.foss",
        display_name: "OTT-play FOSS",
        hwnd,
    };

    let mut controls = MediaControls::new(config).map_err(|e| format!("MediaControls::new: {e}"))?;

    let app_cb = app.clone();
    let seek_flag = Arc::new(AtomicBool::new(false));
    let seek_flag_cb = seek_flag.clone();
    controls
        .attach(move |event: MediaControlEvent| {
            match event {
                MediaControlEvent::Play => eval_main(&app_cb, JS_PLAY),
                MediaControlEvent::Pause => eval_main(&app_cb, JS_PAUSE),
                MediaControlEvent::Toggle => {
                    eval_main(
                        &app_cb,
                        "if(window.stbIsPlaying&&window.stbPause&&window.stbContinue){if(window.stbIsPlaying())window.stbPause();else window.stbContinue();} true;",
                    );
                }
                MediaControlEvent::Next => eval_main(&app_cb, JS_NEXT),
                MediaControlEvent::Previous => eval_main(&app_cb, JS_PREV),
                MediaControlEvent::Stop => eval_main(&app_cb, JS_STOP),
                MediaControlEvent::SetPosition(MediaPosition(pos)) => {
                    // Live: ignore (honest no-op). VOD/archive only.
                    if !seek_flag_cb.load(Ordering::Relaxed) {
                        return;
                    }
                    eval_main(&app_cb, &js_seek_abs(pos.as_secs_f64()));
                }
                MediaControlEvent::Seek(dir) => {
                    if !seek_flag_cb.load(Ordering::Relaxed) {
                        return;
                    }
                    let delta = match dir {
                        SeekDirection::Forward => 10.0,
                        SeekDirection::Backward => -10.0,
                    };
                    eval_main(&app_cb, &js_seek_rel(delta));
                }
                MediaControlEvent::SeekBy(dir, amount) => {
                    if !seek_flag_cb.load(Ordering::Relaxed) {
                        return;
                    }
                    let secs = amount.as_secs_f64();
                    let delta = match dir {
                        SeekDirection::Forward => secs,
                        SeekDirection::Backward => -secs,
                    };
                    eval_main(&app_cb, &js_seek_rel(delta));
                }
                _ => {}
            }
        })
        .map_err(|e| format!("MediaControls::attach: {e}"))?;

    // Stash seek flag on inner via a side channel: we keep Arc in a static map keyed by...
    // Simpler: store Arc on MediaSessionInner and update it from apply_meta.
    *guard = Some(MediaSessionInner {
        controls,
        seekable: false,
        duration_secs: None,
    });
    // Re-bind seek flag: MediaSessionInner needs the Arc. Rebuild with Arc stored.
    // The attach closure already captured seek_flag_cb; keep a copy on state via OnceLock-like approach.
    // Store Arc in a companion field on MediaSessionState instead.
    drop(guard);
    // Put Arc into state-level slot so apply_meta can flip it.
    SEEKABLE_FLAG
        .lock()
        .map(|mut g| *g = Some(seek_flag))
        .ok();
    Ok(())
}

/// Shared seekable flag flipped by metadata updates; attach closure reads it.
static SEEKABLE_FLAG: Mutex<Option<Arc<AtomicBool>>> = Mutex::new(None);

fn set_seekable_flag(seekable: bool) {
    if let Ok(guard) = SEEKABLE_FLAG.lock() {
        if let Some(flag) = guard.as_ref() {
            flag.store(seekable, Ordering::Relaxed);
        }
    }
}

fn with_controls<F>(state: &MediaSessionState, f: F) -> Result<(), String>
where
    F: FnOnce(&mut MediaControls) -> Result<(), String>,
{
    let mut guard = state
        .inner
        .lock()
        .map_err(|_| "media session lock poisoned".to_string())?;
    let inner = guard
        .as_mut()
        .ok_or_else(|| "media session not started".to_string())?;
    f(&mut inner.controls)
}

fn apply_metadata(
    state: &MediaSessionState,
    title: &str,
    artist: &str,
    cover_url: Option<&str>,
    duration_sec: Option<f64>,
    position_sec: Option<f64>,
    seekable: bool,
    playing: bool,
) -> Result<(), String> {
    set_seekable_flag(seekable);
    {
        let mut guard = state
            .inner
            .lock()
            .map_err(|_| "media session lock poisoned".to_string())?;
        if let Some(inner) = guard.as_mut() {
            inner.seekable = seekable;
            inner.duration_secs = if seekable { duration_sec } else { None };
        }
    }

    let duration = if seekable {
        duration_sec
            .filter(|d| d.is_finite() && *d > 0.0)
            .map(|d| Duration::from_secs_f64(d))
    } else {
        None
    };
    let progress = if seekable {
        position_sec
            .filter(|p| p.is_finite() && *p >= 0.0)
            .map(|p| MediaPosition(Duration::from_secs_f64(p)))
    } else {
        None
    };

    with_controls(state, |c| {
        c.set_metadata(MediaMetadata {
            title: Some(title),
            artist: Some(artist),
            album: Some("OTT-play FOSS"),
            cover_url,
            duration,
        })
        .map_err(|e| format!("set_metadata: {e}"))?;
        let playback = if playing {
            MediaPlayback::Playing { progress }
        } else {
            MediaPlayback::Paused { progress }
        };
        c.set_playback(playback)
            .map_err(|e| format!("set_playback: {e}"))?;
        Ok(())
    })
}

fn meta_args(
    title: Option<String>,
    artist: Option<String>,
) -> (String, String) {
    (
        title.unwrap_or_else(|| "OTT-play FOSS".into()),
        artist.unwrap_or_else(|| "Now playing".into()),
    )
}

/// `invoke('start_media_session', { title, artist, artworkUrl, durationSec, positionSec, seekable })`
#[tauri::command]
pub async fn start_media_session(
    app: AppHandle,
    state: State<'_, MediaSessionState>,
    title: Option<String>,
    artist: Option<String>,
    #[allow(non_snake_case)]
    artworkUrl: Option<String>,
    #[allow(non_snake_case)]
    durationSec: Option<f64>,
    #[allow(non_snake_case)]
    positionSec: Option<f64>,
    seekable: Option<bool>,
) -> Result<MediaSessionResult, String> {
    let (title, artist) = meta_args(title, artist);
    let seekable = seekable.unwrap_or(false);
    if let Err(e) = ensure_controls(&app, &state) {
        return Ok(err(e));
    }
    match apply_metadata(
        &state,
        &title,
        &artist,
        artworkUrl.as_deref(),
        durationSec,
        positionSec,
        seekable,
        true,
    ) {
        Ok(()) => Ok(ok()),
        Err(e) => Ok(err(e)),
    }
}

/// `invoke('pause_media_session')`
#[tauri::command]
pub async fn pause_media_session(
    state: State<'_, MediaSessionState>,
) -> Result<MediaSessionResult, String> {
    match with_controls(&state, |c| {
        c.set_playback(MediaPlayback::Paused { progress: None })
            .map_err(|e| format!("set_playback: {e}"))
    }) {
        Ok(()) => Ok(ok()),
        Err(e) => Ok(err(e)),
    }
}

/// `invoke('resume_media_session', { title, artist, artworkUrl, durationSec, positionSec, seekable })`
#[tauri::command]
pub async fn resume_media_session(
    app: AppHandle,
    state: State<'_, MediaSessionState>,
    title: Option<String>,
    artist: Option<String>,
    #[allow(non_snake_case)]
    artworkUrl: Option<String>,
    #[allow(non_snake_case)]
    durationSec: Option<f64>,
    #[allow(non_snake_case)]
    positionSec: Option<f64>,
    seekable: Option<bool>,
) -> Result<MediaSessionResult, String> {
    if state.inner.lock().map(|g| g.is_none()).unwrap_or(true) {
        return start_media_session(
            app,
            state,
            title,
            artist,
            artworkUrl,
            durationSec,
            positionSec,
            seekable,
        )
        .await;
    }
    let (title, artist) = meta_args(title, artist);
    let seekable = seekable.unwrap_or(false);
    match apply_metadata(
        &state,
        &title,
        &artist,
        artworkUrl.as_deref(),
        durationSec,
        positionSec,
        seekable,
        true,
    ) {
        Ok(()) => Ok(ok()),
        Err(e) => Ok(err(e)),
    }
}

/// `invoke('update_media_session', { title, artist, artworkUrl, durationSec, positionSec, seekable })`
#[tauri::command]
pub async fn update_media_session(
    app: AppHandle,
    state: State<'_, MediaSessionState>,
    title: Option<String>,
    artist: Option<String>,
    #[allow(non_snake_case)]
    artworkUrl: Option<String>,
    #[allow(non_snake_case)]
    durationSec: Option<f64>,
    #[allow(non_snake_case)]
    positionSec: Option<f64>,
    seekable: Option<bool>,
) -> Result<MediaSessionResult, String> {
    if state.inner.lock().map(|g| g.is_none()).unwrap_or(true) {
        return start_media_session(
            app,
            state,
            title,
            artist,
            artworkUrl,
            durationSec,
            positionSec,
            seekable,
        )
        .await;
    }
    let (title, artist) = meta_args(title, artist);
    let seekable = seekable.unwrap_or(false);
    match apply_metadata(
        &state,
        &title,
        &artist,
        artworkUrl.as_deref(),
        durationSec,
        positionSec,
        seekable,
        true,
    ) {
        Ok(()) => Ok(ok()),
        Err(e) => Ok(err(e)),
    }
}

/// `invoke('stop_media_session')`
#[tauri::command]
pub async fn stop_media_session(
    state: State<'_, MediaSessionState>,
) -> Result<MediaSessionResult, String> {
    set_seekable_flag(false);
    let mut guard = match state.inner.lock() {
        Ok(g) => g,
        Err(_) => return Ok(err("media session lock poisoned")),
    };
    if let Some(mut inner) = guard.take() {
        let _ = inner.controls.set_playback(MediaPlayback::Stopped);
        // Drop detaches controls.
    }
    Ok(ok())
}
