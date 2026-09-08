//! OS media controls for Tauri Mode B (souvlaki → MPRIS / macOS Now Playing / Windows SMTC).
//!
//! Transport events eval into the main webview (`<video>` play/pause + `_doKey` next/prev),
//! mirroring Cap MobileNativeMedia lock-screen wiring. Not a stub: attach fails → `{ok:false}`.

use serde::Serialize;
use souvlaki::{MediaControlEvent, MediaControls, MediaMetadata, MediaPlayback, PlatformConfig};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

const JS_PLAY: &str = "var v=document.querySelector('video'); if(v){v.play();} true;";
const JS_PAUSE: &str = "var v=document.querySelector('video'); if(v){v.pause();} true;";
const JS_STOP: &str = "var v=document.querySelector('video'); if(v){v.pause(); v.removeAttribute('src'); try{v.load();}catch(e){}} true;";
const JS_NEXT: &str = "(function(){if(window._doKey)window._doKey(35);})();";
const JS_PREV: &str = "(function(){if(window._doKey)window._doKey(36);})();";

pub struct MediaSessionState {
    inner: Mutex<Option<MediaSessionInner>>,
}

struct MediaSessionInner {
    controls: MediaControls,
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
    controls
        .attach(move |event: MediaControlEvent| {
            match event {
                MediaControlEvent::Play => eval_main(&app_cb, JS_PLAY),
                MediaControlEvent::Pause => eval_main(&app_cb, JS_PAUSE),
                MediaControlEvent::Toggle => {
                    // Best-effort toggle via <video>.paused
                    eval_main(
                        &app_cb,
                        "var v=document.querySelector('video'); if(v){ if(v.paused){v.play();} else {v.pause();} } true;",
                    );
                }
                MediaControlEvent::Next => eval_main(&app_cb, JS_NEXT),
                MediaControlEvent::Previous => eval_main(&app_cb, JS_PREV),
                MediaControlEvent::Stop => eval_main(&app_cb, JS_STOP),
                _ => {}
            }
        })
        .map_err(|e| format!("MediaControls::attach: {e}"))?;

    *guard = Some(MediaSessionInner { controls });
    Ok(())
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

/// `invoke('start_media_session', { title, artist })`
#[tauri::command]
pub async fn start_media_session(
    app: AppHandle,
    state: State<'_, MediaSessionState>,
    title: Option<String>,
    artist: Option<String>,
) -> Result<MediaSessionResult, String> {
    let title = title.unwrap_or_else(|| "OTT-play FOSS".into());
    let artist = artist.unwrap_or_else(|| "Now playing".into());

    if let Err(e) = ensure_controls(&app, &state) {
        return Ok(err(e));
    }

    let meta_result = with_controls(&state, |c| {
        c.set_metadata(MediaMetadata {
            title: Some(title.as_str()),
            artist: Some(artist.as_str()),
            album: Some("OTT-play FOSS"),
            ..Default::default()
        })
        .map_err(|e| format!("set_metadata: {e}"))?;
        c.set_playback(MediaPlayback::Playing { progress: None })
            .map_err(|e| format!("set_playback: {e}"))?;
        Ok(())
    });

    match meta_result {
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

/// `invoke('resume_media_session', { title, artist })`
#[tauri::command]
pub async fn resume_media_session(
    app: AppHandle,
    state: State<'_, MediaSessionState>,
    title: Option<String>,
    artist: Option<String>,
) -> Result<MediaSessionResult, String> {
    if state.inner.lock().map(|g| g.is_none()).unwrap_or(true) {
        return start_media_session(app, state, title, artist).await;
    }
    let title = title.unwrap_or_else(|| "OTT-play FOSS".into());
    let artist = artist.unwrap_or_else(|| "Now playing".into());
    match with_controls(&state, |c| {
        let _ = c.set_metadata(MediaMetadata {
            title: Some(title.as_str()),
            artist: Some(artist.as_str()),
            album: Some("OTT-play FOSS"),
            ..Default::default()
        });
        c.set_playback(MediaPlayback::Playing { progress: None })
            .map_err(|e| format!("set_playback: {e}"))
    }) {
        Ok(()) => Ok(ok()),
        Err(e) => Ok(err(e)),
    }
}

/// `invoke('stop_media_session')`
#[tauri::command]
pub async fn stop_media_session(
    state: State<'_, MediaSessionState>,
) -> Result<MediaSessionResult, String> {
    let mut guard = match state.inner.lock() {
        Ok(g) => g,
        Err(_) => return Ok(err("media session lock poisoned")),
    };
    if let Some(mut inner) = guard.take() {
        let _ = inner
            .controls
            .set_playback(MediaPlayback::Stopped);
        // Drop detaches controls.
    }
    Ok(ok())
}
