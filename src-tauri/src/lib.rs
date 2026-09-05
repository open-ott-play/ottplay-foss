mod commands;

use commands::tauri_commands::TauriState;
use std::sync::Arc;
use tokio::sync::RwLock;

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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
