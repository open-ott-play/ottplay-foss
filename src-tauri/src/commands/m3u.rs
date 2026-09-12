//! M3U channel matching and logo lookup commands for Tauri Mode B.
//!
//! Commands exposed to JS via `invoke()`:
//! - `match_channels` — match channel names to XMLTV IDs, populate epg_to_xmltv map
//! - `match_logos` — resolve channel logo URLs from XMLTV icons
//!
//! Protocol: FOSS text format using `\n\t\n` as field separator.

use super::tauri_commands::TauriState;
use std::collections::HashMap;
use ottplay_core::{native_xmltv, xmltv};

struct NativeMatch { channel: String, xmltv_id: String, hash: String, shift: i64, logo: String }

fn match_group(cache: &xmltv::XmltvCache, group: &[(String, native_xmltv::MatchChannel)]) -> Vec<NativeMatch> {
    let index = native_xmltv::build_index(cache);
    group.iter().map(|(channel, info)| {
        let id = native_xmltv::resolve_in_index(cache, &index, &info.tvg_id, &info.tvg_name, &info.name).unwrap_or_default();
        let shift = xmltv::extract_time_shift(&info.name);
        let hash = ottplay_core::m3u::compute_epg_hash(&format!("{}|{id}|{shift}", info.xmltv_urls.join("|")));
        let logo = cache.channels.get(&id).map(|ch| ch.icon.clone()).filter(|logo| !logo.is_empty())
            .unwrap_or_else(|| format!("/logo/{channel}.svg?ch={}", url::form_urlencoded::byte_serialize(info.name.as_bytes()).collect::<String>()));
        NativeMatch { channel: channel.clone(), xmltv_id: id, hash, shift, logo }
    }).collect()
}

async fn native_matches(state: &TauriState, body: &str) -> Result<Option<Vec<NativeMatch>>, String> {
    let metadata = native_xmltv::match_metadata(body);
    if metadata.is_empty() { return Ok(None); }
    let mut groups: HashMap<Vec<String>, Vec<(String, native_xmltv::MatchChannel)>> = HashMap::new();
    for id in native_xmltv::match_ids(body) {
        if let Some(info) = metadata.get(&id) { groups.entry(info.xmltv_urls.clone()).or_default().push((id, info.clone())); }
    }
    let mut matches = Vec::new();
    for (sources, group) in groups {
        if sources.is_empty() {
            super::tauri_commands::ensure_xmltv_cache(state).await?;
            let guard = state.xmltv_cache.read().await;
            matches.extend(match_group(guard.as_ref().ok_or("EPG cache empty")?, &group));
        } else {
            let cache = native_xmltv::load_sources(&sources).await.map_err(|error| error.to_string())?;
            matches.extend(match_group(&cache, &group));
        }
    }
    Ok(Some(matches))
}

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
    if let Some(matches) = native_matches(&state, &body).await? {
        let mut epg_map = state.epg_to_xmltv.write().await;
        let mut time_map = state.time_shift_by_epg.write().await;
        let rows: Vec<String> = matches.into_iter().map(|entry| {
            epg_map.insert(entry.hash.clone(), entry.xmltv_id);
            time_map.insert(entry.hash.clone(), entry.shift);
            format!("{}~local~{}", entry.channel, entry.hash)
        }).collect();
        return Ok(format!("{{}}\n\t\n{}\n\t\nlocal~/", rows.join("\n")));
    }
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
    if let Some(matches) = native_matches(&state, &body).await? {
        let rows: Vec<String> = matches.into_iter().map(|entry| format!("{}~{}", entry.channel, entry.logo)).collect();
        return Ok(format!("{{}}\n\t\n{}", rows.join("\n")));
    }
    super::tauri_commands::ensure_xmltv_cache(&state).await?;

    let cache = state.xmltv_cache.read().await;
    let cache = cache.as_ref().ok_or("EPG cache empty after ensure")?;

    let result = ottplay_core::m3u::match_logos_text(&body, &cache.channels);
    Ok(result)
}
