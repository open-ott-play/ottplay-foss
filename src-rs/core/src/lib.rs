//! XMLTV fetch + parse + SQLite cache.
use std::collections::HashMap;
use std::sync::Arc;

use serde_json::Value as JsonValue;
use tokio::sync::RwLock;
use tokio::time::{interval, Duration};

pub mod db;
pub mod m3u;
pub mod tmdb;
pub mod xmltv;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Fetch XMLTV from `urls`, parse, persist to SQLite, return channels+programs.
pub async fn fetch_xmltv(urls: &[String]) -> anyhow::Result<xmltv::XmltvCache> {
    let mut all_channels: HashMap<String, xmltv::Channel> = HashMap::new();
    let mut all_programs: HashMap<String, Vec<xmltv::Programme>> = HashMap::new();

    for url in urls {
        match xmltv::fetch_single(url).await {
            Ok((ch, pr)) => {
                for (id, c) in ch {
                    all_channels.entry(id.clone()).or_insert(c);
                }
                for (id, progs) in pr {
                    all_programs
                        .entry(id.clone())
                        .or_insert_with(Vec::new)
                        .extend(progs);
                }
            }
            Err(e) => tracing::warn!("XMLTV fetch failed for {url}: {e}"),
        }
    }

    let cache = xmltv::XmltvCache {
        channels: all_channels,
        programs: all_programs,
        fetched_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs(),
    };

    // Persist to SQLite
    if let Some(pool) = db::pool().await? {
        if let Err(e) = db::persist(&pool, &cache).await {
            tracing::warn!("SQLite persist error: {e}");
        }
    }

    Ok(cache)
}

/// Return EPG slice for `epg_hash` + `channel_id` within ±48h window.
/// Returns JSON matching the shape TS client expects.
pub async fn get_epg_slice(
    cache: &xmltv::XmltvCache,
    _hash: &str,
    channel_id: &str,
    time_shift_hours: i64,
) -> JsonValue {
    let now = chrono::Utc::now().timestamp();
    let window_start = now - 48 * 3600;
    let window_end = now + 48 * 3600;
    let shift_secs = time_shift_hours * 3600;

    let programs = cache.programs.get(channel_id).cloned().unwrap_or_default();

    let epg_data: Vec<JsonValue> = programs
        .into_iter()
        .filter(|p| {
            let start = p.start + shift_secs;
            let stop = p.stop + shift_secs;
            stop > window_start && start < window_end
        })
        .map(|p| {
            serde_json::json!({
                "time": p.start + shift_secs,
                "time_to": p.stop + shift_secs,
                "name": p.title,
                "descr": p.desc,
                "icon": p.icon,
            })
        })
        .collect();

    serde_json::json!({ "epg_data": epg_data })
}

/// Fuzzy-match a playlist channel name against XMLTV channels.
/// Returns `(xmltv_channel_id, channel_name, score)`.
pub fn match_channel(name: &str, channels: &xmltv::Channels) -> Option<(String, f32)> {
    xmltv::match_channel(name, channels)
}

/// Background task: refresh XMLTV every 2h, update the shared cache.
pub async fn background_refresh(xmltv_urls: Vec<String>, cache: Arc<RwLock<xmltv::XmltvCache>>) {
    let mut ticker = interval(Duration::from_secs(2 * 3600));
    loop {
        ticker.tick().await;
        tracing::info!("XMLTV background refresh triggered");
        match fetch_xmltv(&xmltv_urls).await {
            Ok(fresh) => {
                let mut guard = cache.write().await;
                *guard = fresh;
                tracing::info!("XMLTV cache refreshed");
            }
            Err(e) => tracing::warn!("XMLTV refresh failed: {e}"),
        }
    }
}
