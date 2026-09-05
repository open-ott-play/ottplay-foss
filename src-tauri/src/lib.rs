mod commands;

use commands::tauri_commands::TauriState;
use std::sync::Arc;
use tokio::sync::RwLock;

/// Default EPG URL (matches server/src/main.rs default).
const DEFAULT_EPG_URL: &str = "http://epg.it999.ru/epg2.xml.gz";

/// Initialize XMLTV URLs from EPG_URLS env var, or use default.
fn init_xmltv_urls() -> Vec<String> {
    let urls: Vec<String> = std::env::var("EPG_URLS")
        .unwrap_or_default()
        .split(';')
        .filter_map(|s| {
            let s = s.trim();
            if s.is_empty() { None } else { Some(s.to_string()) }
        })
        .collect();
    if urls.is_empty() {
        vec![DEFAULT_EPG_URL.to_string()]
    } else {
        urls
    }
}

pub fn run() {
    let xmltv_urls = init_xmltv_urls();
    if !xmltv_urls.is_empty() {
        println!("[EPG] Initialized with {} source(s): {:?}", xmltv_urls.len(), xmltv_urls);
    }
    tauri::Builder::default()
        .manage(TauriState {
            xmltv_cache: Arc::new(RwLock::new(None)),
            xmltv_urls: Arc::new(RwLock::new(xmltv_urls)),
        })
        .invoke_handler(tauri::generate_handler![
            commands::tauri_commands::ping,
            commands::tauri_commands::get_epg,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
