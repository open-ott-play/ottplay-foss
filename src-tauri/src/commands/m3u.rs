//! M3U channel matching and logo lookup commands for Tauri Mode B.
//!
//! Commands exposed to JS via `invoke()`:
//! - `match_channels` — match channel names to XMLTV IDs, populate epg_to_xmltv map
//! - `match_logos` — resolve channel logo URLs from XMLTV icons
//!
//! Protocol: FOSS text format using `\n\t\n` as field separator.

use super::tauri_commands::TauriState;

/// `invoke('match_channels', {body, url})` — match M3U channels to XMLTV.
///
/// Accepts the FOSS text body format: `{json}\n\t\n{optional raw}\n\t\n{id lines}`
/// Returns: `{}\n\t\n{ch_id~local~epg_hash}\n\t\n{local~/}`
#[tauri::command]
pub async fn match_channels(
    state: tauri::State<'_, TauriState>,
    body: String,
    _url: String,
) -> Result<String, String> {
    super::tauri_commands::ensure_xmltv_cache(&state).await?;

    let cache = state.xmltv_cache.read().await;
    let cache = cache.as_ref().ok_or("EPG cache empty after ensure")?;

    // In-place write locks on the shared hash maps
    let mut epg_map = state.epg_to_xmltv.write().await;
    let mut time_map = state.time_shift_by_epg.write().await;

    let result = ottplay_core::m3u::match_channels_text(
        &body,
        &cache.channels,
        &mut epg_map,
        &mut time_map,
    );

    Ok(result)
}

/// `invoke('match_logos', {body, url})` — resolve channel logo URLs.
///
/// Accepts the FOSS text body format: `{json}\n\t\n{optional raw}\n\t\n{id lines}`
/// Returns: `{}\n\t\n{ch_id~logo_url}`
#[tauri::command]
pub async fn match_logos(
    state: tauri::State<'_, TauriState>,
    body: String,
    _url: String,
) -> Result<String, String> {
    super::tauri_commands::ensure_xmltv_cache(&state).await?;

    let cache = state.xmltv_cache.read().await;
    let cache = cache.as_ref().ok_or("EPG cache empty after ensure")?;

    let result = ottplay_core::m3u::match_logos_text(&body, &cache.channels);
    Ok(result)
}
