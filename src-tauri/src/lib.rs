mod commands;

use commands::tauri_commands::TauriState;
use std::sync::Arc;
use tokio::sync::RwLock;

pub fn run() {
    tauri::Builder::default()
        .manage(TauriState {
            xmltv_cache: Arc::new(RwLock::new(None)),
            xmltv_urls: Arc::new(RwLock::new(Vec::new())),
        })
        .invoke_handler(tauri::generate_handler![
            commands::tauri_commands::ping,
            commands::tauri_commands::get_epg,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}