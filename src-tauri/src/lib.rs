mod commands;

use commands::media_session::MediaSessionState;
use commands::tauri_commands::TauriState;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::Manager;
use tokio::sync::RwLock;

/// Default URL for the desktop shell webview.
///
/// Debug builds point at the local companion (`:8095`) so Mode A paths work while
/// developing. Release builds default to empty so the app uses embedded
/// `frontendDist` (`frontend/` — Mode A-like staged tree).
///
/// Override with `OTTPLAY_WEB_URL` in either mode. Set it to empty to keep
/// embedded `frontendDist`.
#[cfg(debug_assertions)]
const DEFAULT_WEB_URL: &str = "http://127.0.0.1:8095/";
#[cfg(not(debug_assertions))]
const DEFAULT_WEB_URL: &str = "";

/// Bare KeyL — registered only while main window is native-fullscreen AND focused.
/// Lets exit work when WKWebView swallows keys in macOS Spaces fullscreen.
#[cfg(desktop)]
fn keyl_shortcut() -> tauri_plugin_global_shortcut::Shortcut {
    use tauri_plugin_global_shortcut::{Code, Shortcut};
    Shortcut::new(None, Code::KeyL)
}

/// Register or unregister the KeyL exit shortcut based on fullscreen intent.
/// Caller should pass `fullscreen && focused` (or just fullscreen; Focused
/// events will refine). Never leaves bare KeyL registered while windowed so
/// typing in editors still works.
#[cfg(desktop)]
pub(crate) fn sync_fullscreen_exit_shortcut(app: &tauri::AppHandle, want_registered: bool) {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let shortcut = keyl_shortcut();
    let registered = app.global_shortcut().is_registered(shortcut);
    if want_registered && !registered {
        if let Err(e) = app.global_shortcut().register(shortcut) {
            tracing::warn!("KeyL fullscreen-exit shortcut register failed: {e}");
        } else {
            tracing::info!("KeyL fullscreen-exit shortcut registered");
        }
    } else if !want_registered && registered {
        if let Err(e) = app.global_shortcut().unregister(shortcut) {
            tracing::warn!("KeyL fullscreen-exit shortcut unregister failed: {e}");
        } else {
            tracing::info!("KeyL fullscreen-exit shortcut unregistered");
        }
    }
}

#[cfg(not(desktop))]
pub(crate) fn sync_fullscreen_exit_shortcut(_app: &tauri::AppHandle, _want_registered: bool) {}

/// Re-read live fullscreen + focus and sync KeyL registration.
#[cfg(desktop)]
fn resync_keyl_from_window(app: &tauri::AppHandle) {
    let Some(win) = app.get_webview_window("main") else {
        sync_fullscreen_exit_shortcut(app, false);
        return;
    };
    let fs = win.is_fullscreen().unwrap_or(false);
    let focused = win.is_focused().unwrap_or(false);
    sync_fullscreen_exit_shortcut(app, fs && focused);
}

pub fn run() {
    let epg_urls = commands::tauri_commands::init_xmltv_urls();
    let command_queues = commands::queue::new_shared();
    // Bind the Mode B command queue HTTP server (localhost:18081) on a
    // background thread. Mirror of `local_proxy.py` for the native shell.
    commands::queue::spawn_http_server(command_queues.clone());
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            // Persist main window position/size across launches (Mode B frameless).
            // SIZE|POSITION|VISIBLE only — never FULLSCREEN/MAXIMIZED/DECORATIONS so
            // restore does not fight Key L native fullscreen toggle.
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::VISIBLE,
                )
                .with_denylist(&["pip"])
                .build(),
        )
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    use tauri_plugin_global_shortcut::{Code, ShortcutState};
                    if event.state != ShortcutState::Pressed {
                        return;
                    }
                    if shortcut.key != Code::KeyL {
                        return;
                    }
                    // Ignore modified chords (Shift/Ctrl/Alt/Meta+L).
                    if !shortcut.mods.is_empty() {
                        return;
                    }
                    let Some(win) = app.get_webview_window("main") else {
                        return;
                    };
                    if !win.is_focused().unwrap_or(false) {
                        return;
                    }
                    // Only meaningful while native fullscreen (shortcut should
                    // only be registered then); still probe live state.
                    let cur = win.is_fullscreen().unwrap_or(false);
                    if !cur {
                        sync_fullscreen_exit_shortcut(app, false);
                        return;
                    }
                    if let Err(e) = win.set_fullscreen(false) {
                        tracing::warn!("KeyL exit set_fullscreen(false) failed: {e}");
                        return;
                    }
                    sync_fullscreen_exit_shortcut(app, false);
                    tracing::info!("KeyL shortcut exited native fullscreen");
                })
                .build(),
        )
        .manage(MediaSessionState::default())
        .manage(TauriState {
            xmltv_cache: Arc::new(RwLock::new(None)),
            epg_urls: Arc::new(RwLock::new(epg_urls.clone())),
            epg_to_xmltv: Arc::new(RwLock::new(HashMap::new())),
            time_shift_by_epg: Arc::new(RwLock::new(HashMap::new())),
            command_queues: command_queues.clone(),
        })
        .invoke_handler(tauri::generate_handler![
            commands::tauri_commands::ping,
            commands::tauri_commands::get_epg,
            commands::m3u::match_channels,
            commands::m3u::match_logos,
            commands::tmdb::tmdb_proxy,
            commands::tauri_commands::proxy_fetch,
            commands::tauri_commands::set_fullscreen,
            commands::tauri_commands::toggle_fullscreen,
            commands::tauri_commands::prevent_sleep,
            commands::tauri_commands::allow_sleep,
            commands::tauri_commands::get_volume,
            commands::tauri_commands::set_volume,
            commands::tauri_commands::play_pip,
            commands::tauri_commands::stop_pip,
            commands::tauri_commands::set_pip_bounds,
            commands::tauri_commands::exit_app,
            commands::media_session::start_media_session,
            commands::media_session::pause_media_session,
            commands::media_session::resume_media_session,
            commands::media_session::stop_media_session,
            commands::media_session::update_media_session,
            commands::queue::queue_poll,
            commands::queue::queue_enqueue,
            commands::misc::get_version,
            commands::misc::feedback_get,
            commands::misc::feedback_post,
            commands::stalker::stalker_portal_fetch,
        ])
        .setup(|app| {
            let raw = std::env::var("OTTPLAY_WEB_URL").unwrap_or_else(|_| DEFAULT_WEB_URL.into());
            if let Some(window) = app.get_webview_window("main") {
                if raw.trim().is_empty() {
                    // Leave the default frontendDist load (index.html from
                    // src-tauri/frontend). Do not eval-navigate.
                    tracing::info!("OTTPLAY_WEB_URL empty — using embedded frontendDist");
                } else {
                    let url = tauri::Url::parse(&raw).map_err(|e| {
                        Box::<dyn std::error::Error>::from(format!(
                            "invalid OTTPLAY_WEB_URL {raw:?}: {e}"
                        ))
                    })?;
                    tracing::info!("navigating main webview to {url}");
                    window.navigate(url)?;
                }

                // Keep KeyL registration aligned with focus + live fullscreen
                // (e.g. user exits FS via macOS UI / traffic lights).
                let handle = app.handle().clone();
                window.on_window_event(move |event| {
                    match event {
                        tauri::WindowEvent::Focused(_) | tauri::WindowEvent::Resized(_) => {
                            resync_keyl_from_window(&handle);
                        }
                        tauri::WindowEvent::Destroyed => {
                            sync_fullscreen_exit_shortcut(&handle, false);
                        }
                        _ => {}
                    }
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
