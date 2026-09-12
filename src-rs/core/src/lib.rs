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

/// Return EPG slice for `channel_id`.
///
/// - `time_shift_hours` is timezone offset only (from channel-name ±Nh / map),
///   never archive/catchup depth.
/// - `archive_hours` is configured catchup/history depth (M3U `rechours` /
///   `catchup-days` → channel.rec). Lookback uses that value when > 0;
///   otherwise the historical ±48h default. Future cushion stays 48h.
pub async fn get_epg_slice(
    cache: &xmltv::XmltvCache,
    _hash: &str,
    channel_id: &str,
    time_shift_hours: i64,
    archive_hours: i64,
) -> JsonValue {
    let now = chrono::Utc::now().timestamp();
    let lookback_h = if archive_hours > 0 { archive_hours } else { 48 };
    let window_start = now - lookback_h * 3600;
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::xmltv::{Channel, Programme, XmltvCache};
    use std::collections::HashMap;

    fn sample_cache(now: i64) -> XmltvCache {
        let mut programs = HashMap::new();
        // One programme 72h ago, one current, one tomorrow
        programs.insert(
            "ch1".to_string(),
            vec![
                Programme {
                    start: now - 72 * 3600,
                    stop: now - 71 * 3600,
                    title: "old".into(),
                    desc: String::new(),
                    icon: String::new(),
                },
                Programme {
                    start: now - 1800,
                    stop: now + 1800,
                    title: "now".into(),
                    desc: String::new(),
                    icon: String::new(),
                },
                Programme {
                    start: now + 3600,
                    stop: now + 7200,
                    title: "soon".into(),
                    desc: String::new(),
                    icon: String::new(),
                },
            ],
        );
        let mut channels = HashMap::new();
        channels.insert(
            "ch1".to_string(),
            Channel {
                id: "ch1".into(),
                name: "Test".into(),
                icon: String::new(),
            },
        );
        XmltvCache {
            channels,
            programs,
            fetched_at: now as u64,
        }
    }

    #[tokio::test]
    async fn archive_hours_extends_lookback() {
        let now = chrono::Utc::now().timestamp();
        let cache = sample_cache(now);
        let def = get_epg_slice(&cache, "", "ch1", 0, 0).await;
        let def_arr = def["epg_data"].as_array().unwrap();
        // Default 48h lookback excludes the 72h-old programme
        assert!(
            def_arr.iter().all(|p| p["name"] != "old"),
            "default window should omit 72h-old: {:?}",
            def_arr
        );

        let deep = get_epg_slice(&cache, "", "ch1", 0, 144).await;
        let deep_arr = deep["epg_data"].as_array().unwrap();
        assert!(
            deep_arr.iter().any(|p| p["name"] == "old"),
            "144h archive lookback should include 72h-old: {:?}",
            deep_arr
        );
        assert!(deep_arr.iter().any(|p| p["name"] == "now"));
    }
}
