mod commands;

use commands::tauri_commands::TauriState;
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
    tauri::Builder::default()
        .manage(TauriState {
            xmltv_cache: Arc::new(RwLock::new(None)),
            epg_urls: Arc::new(RwLock::new(epg_urls.clone())),
        })
        .invoke_handler(tauri::generate_handler![
            commands::tauri_commands::ping,
            commands::tauri_commands::get_epg,
            commands::tauri_commands::set_fullscreen,
            commands::tauri_commands::prevent_sleep,
            commands::tauri_commands::allow_sleep,
            commands::tauri_commands::get_volume,
            commands::tauri_commands::set_volume,
            commands::tauri_commands::play_pip,
            commands::tauri_commands::stop_pip,
            commands::tauri_commands::set_pip_bounds,
            commands::tauri_commands::exit_app,
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
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
