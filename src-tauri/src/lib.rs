mod commands;
mod instance;

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

pub fn run() {
    let epg_urls = commands::tauri_commands::init_xmltv_urls();
    let command_queues = commands::queue::new_shared();
    // Bind the Mode B command queue HTTP server (prefer localhost:18081,
    // fall back through 18082..=18090) on a background thread.
    // Mirror of `local_proxy.py` for the native shell.
    commands::queue::spawn_http_server(command_queues.clone());
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin({
            // Persist main window position/size across launches (Mode B frameless).
            // SIZE|POSITION|VISIBLE only — never FULLSCREEN/MAXIMIZED/DECORATIONS so
            // restore does not fight Key L native fullscreen toggle.
            // Per-instance filename when OTTPLAY_INSTANCE / OTTPLAY_DATA_DIR is set.
            let mut ws = tauri_plugin_window_state::Builder::new()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::VISIBLE,
                )
                .with_denylist(&["pip"]);
            if let Some(name) = instance::window_state_filename() {
                ws = ws.with_filename(name);
            }
            ws.build()
        })
        .manage(MediaSessionState::default())
        .manage(TauriState {
            xmltv_cache: Arc::new(RwLock::new(None)),
            epg_urls: Arc::new(RwLock::new(epg_urls.clone())),
            epg_to_xmltv: Arc::new(RwLock::new(HashMap::new())),
            time_shift_by_epg: Arc::new(RwLock::new(HashMap::new())),
            xmltv_fetch_lock: Arc::new(tokio::sync::Mutex::new(())),
            command_queues: command_queues.clone(),
        })
        .invoke_handler(tauri::generate_handler![
            commands::tauri_commands::ping,
            commands::tauri_commands::get_epg,
            commands::m3u::match_channels,
            commands::m3u::match_logos,
            commands::tmdb::tmdb_proxy,
            commands::tauri_commands::proxy_fetch,
            commands::http::proxy_http,
            commands::tauri_commands::set_fullscreen,
            commands::tauri_commands::toggle_fullscreen,
            commands::tauri_commands::prevent_sleep,
            commands::tauri_commands::allow_sleep,
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
            commands::queue::queue_port,
            commands::misc::get_version,
            commands::misc::feedback_get,
            commands::misc::feedback_post,
            commands::stalker::stalker_portal_fetch,
        ])
        .setup(|app| {
            // Always build the main window here (tauri.conf windows=[]) so
            // OTTPLAY_INSTANCE / OTTPLAY_DATA_DIR can set data_directory +
            // macOS data_store_identifier at create time. Destroy+recreate
            // races on the `main` label and panics.
            if let Some(data_dir) = instance::resolve_data_dir() {
                instance::ensure_dirs(&data_dir).map_err(|e| {
                    Box::<dyn std::error::Error>::from(format!(
                        "instance data dir {}: {e}",
                        data_dir.display()
                    ))
                })?;
                tracing::info!(
                    path = %data_dir.display(),
                    slug = instance::isolation_slug().unwrap_or_default(),
                    "OTTPLAY instance isolation enabled"
                );
            }

            let mut builder = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("OttPlay FOSS")
            .inner_size(1280.0, 720.0)
            .center()
            .resizable(true)
            .decorations(false);
            if let Some(data_dir) = instance::resolve_data_dir() {
                builder = instance::apply_isolation(builder, &data_dir);
            }
            builder.build()?;

            let raw = std::env::var("OTTPLAY_WEB_URL").unwrap_or_else(|_| DEFAULT_WEB_URL.into());
            if let Some(window) = app.get_webview_window("main") {
                if raw.trim().is_empty() {
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
            }

            // Mode A companion warms XMLTV before serving; Mode B must too or the
            // first get_epg/match_channels pays a multi-second 40MB gz parse and
            // can permanently cache a transient 0-channel miss.
            let handle = app.handle().clone();
            commands::tauri_commands::spawn_xmltv_warm(handle, &*app.state::<TauriState>());

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
