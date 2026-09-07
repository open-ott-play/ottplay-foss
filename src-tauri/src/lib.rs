mod commands;

use commands::tauri_commands::TauriState;
use std::sync::Arc;
use tauri::Manager;
use tokio::sync::RwLock;

/// Default URL for the desktop shell webview.
///
/// The bundled `frontendDist` (`../dist`) only contains `index.html` + `stbPlayer.js`.
/// Boot still expects Mode A paths (`/dist/…`, `/stb/…`, `/stbPlayer/…`, `/js/…`) plus CDN
/// scripts, so a pure asset load shows a blank/white window. Point the webview at the
/// local companion (Mode A) until a full static stage + boot-path fix lands.
///
/// Override with `OTTPLAY_WEB_URL`. Set it to empty to keep embedded `frontendDist`.
const DEFAULT_WEB_URL: &str = "http://127.0.0.1:8095/";

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
        ])
        .setup(|app| {
            let raw = std::env::var("OTTPLAY_WEB_URL").unwrap_or_else(|_| DEFAULT_WEB_URL.into());
            if raw.trim().is_empty() {
                tracing::info!("OTTPLAY_WEB_URL empty — using embedded frontendDist");
                return Ok(());
            }
            let url = tauri::Url::parse(&raw).map_err(|e| {
                Box::<dyn std::error::Error>::from(format!("invalid OTTPLAY_WEB_URL {raw:?}: {e}"))
            })?;
            if let Some(window) = app.get_webview_window("main") {
                tracing::info!("navigating main webview to {url}");
                window.navigate(url)?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
