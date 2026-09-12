//! Native-shell XMLTV sources. Browser companion configuration is untouched.
use std::collections::HashMap;
use std::sync::{Arc, LazyLock};
use tokio::sync::Mutex;
use serde::Deserialize;
use crate::xmltv::{self, XmltvCache};

type SourceSlot = Arc<Mutex<Option<Arc<XmltvCache>>>>;
static SOURCES: LazyLock<Mutex<HashMap<Vec<String>, SourceSlot>>> = LazyLock::new(|| Mutex::new(HashMap::new()));
const TTL: u64 = 2 * 3600;

#[derive(Clone, Debug, Default, Deserialize)]
pub struct MatchChannel {
    #[serde(default)] pub tvg_id: String,
    #[serde(default)] pub tvg_name: String,
    #[serde(default)] pub name: String,
    #[serde(default)] pub xmltv_urls: Vec<String>,
}

/// New headers retain exact IDs and URL schemes; old browser bodies remain valid.
pub fn match_metadata(body: &str) -> HashMap<String, MatchChannel> {
    #[derive(Default, Deserialize)]
    struct Header { #[serde(default)] native_channels: HashMap<String, MatchChannel> }
    serde_json::from_str::<Header>(body.split("\n\t\n").next().unwrap_or("{}"))
        .unwrap_or_default().native_channels
}

pub fn match_ids(body: &str) -> Vec<String> {
    body.split("\n\t\n").nth(2).unwrap_or("").lines()
        .filter_map(|line| line.split('-').next().filter(|id| !id.is_empty()).map(String::from)).collect()
}

/// Explicit XMLTV IDs are authoritative; names are a fallback, in provider order.
pub fn resolve_id(cache: &XmltvCache, tvg_id: &str, tvg_name: &str, name: &str) -> Option<String> {
    resolve_in_index(cache, &build_index(cache), tvg_id, tvg_name, name)
}

pub fn build_index(cache: &XmltvCache) -> xmltv::MatchIndex {
    let mut index = xmltv::MatchIndex::default();
    let mut ids: Vec<_> = cache.channels.keys().collect();
    ids.sort();
    for id in ids {
        let channel = &cache.channels[id];
        let names = if channel.names.is_empty() { vec![channel.name.clone()] } else { channel.names.clone() };
        for name in names {
            let normalized = xmltv::normalize_name(&name);
            if normalized.is_empty() { continue; }
            index.by_norm.entry(normalized.clone()).or_insert_with(|| id.clone());
            index.entries.push((id.clone(), name, normalized));
        }
    }
    index
}

pub fn resolve_in_index(cache: &XmltvCache, index: &xmltv::MatchIndex, tvg_id: &str, tvg_name: &str, name: &str) -> Option<String> {
    if !tvg_id.is_empty() && cache.channels.contains_key(tvg_id) { return Some(tvg_id.to_string()); }
    for candidate in [tvg_name, name] {
        if let Some(id) = index.by_norm.get(&xmltv::normalize_name(candidate)) { return Some(id.clone()); }
    }
    let mut best: Option<(String, f32)> = None;
    for candidate in [tvg_name, name] {
        if let Some(found) = xmltv::match_in_index(candidate, index) {
            if best.as_ref().map(|entry| found.1 > entry.1).unwrap_or(true) { best = Some(found); }
        }
    }
    best.map(|entry| entry.0)
}

/// First feed defining an ID owns that channel and its programmes.
pub fn merge_source(target: &mut XmltvCache, source: XmltvCache) {
    for (id, channel) in source.channels {
        if target.channels.contains_key(&id) { continue; }
        target.channels.insert(id.clone(), channel);
        if let Some(programs) = source.programs.get(&id) { target.programs.insert(id, programs.clone()); }
    }
}

pub async fn load_sources(urls: &[String]) -> anyhow::Result<Arc<XmltvCache>> {
    anyhow::ensure!(!urls.is_empty(), "No XMLTV sources");
    anyhow::ensure!(urls.iter().all(|url| url.starts_with("http://") || url.starts_with("https://")), "Invalid XMLTV URL");
    let slot = {
        let mut sources = SOURCES.lock().await;
        // Bound resident source sets; active calls retain their Arc when evicted.
        if sources.len() >= 8 && !sources.contains_key(urls) {
            if let Some(key) = sources.keys().next().cloned() { sources.remove(&key); }
        }
        sources.entry(urls.to_vec()).or_insert_with(|| Arc::new(Mutex::new(None))).clone()
    };
    let mut guard = slot.lock().await;
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)?.as_secs();
    if let Some(cache) = guard.as_ref() {
        if now.saturating_sub(cache.fetched_at) < TTL { return Ok(cache.clone()); }
    }
    let mut merged = XmltvCache::default();
    let mut last_error = None;
    for url in urls {
        match xmltv::fetch_single_native(url).await {
            Ok((channels, programs)) => merge_source(&mut merged, XmltvCache { channels, programs, fetched_at: now }),
            Err(error) => last_error = Some(error),
        }
    }
    if last_error.is_some() {
        // A partial refresh must not replace the earlier source with a later duplicate ID.
        if let Some(stale) = guard.as_ref() { return Ok(stale.clone()); }
    }
    if merged.channels.is_empty() {
        // Offline fallback is restricted to this exact ordered source set.
        if let Some(stale) = guard.as_ref() { return Ok(stale.clone()); }
        return Err(last_error.unwrap_or_else(|| anyhow::anyhow!("Empty XMLTV sources")));
    }
    merged.fetched_at = now;
    let fresh = Arc::new(merged);
    *guard = Some(fresh.clone());
    Ok(fresh)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(id: &str, name: &str, title: &str) -> XmltvCache {
        XmltvCache { channels: HashMap::from([(id.into(), xmltv::Channel { id: id.into(), name: name.into(), icon: "https://fixture/logo.png".into(), names: vec![name.into()] })]),
            programs: HashMap::from([(id.into(), vec![xmltv::Programme { title: title.into(), ..Default::default() }])]), ..Default::default() }
    }
    #[test]
    fn exact_id_wins_and_source_priority_is_stable() {
        let mut cache = fixture("private-id", "One", "first feed");
        merge_source(&mut cache, fixture("private-id", "Wrong", "second feed"));
        merge_source(&mut cache, fixture("other", "Other", "other feed"));
        assert_eq!(resolve_id(&cache, "private-id", "Other", "Other"), Some("private-id".into()));
        assert_eq!(cache.programs["private-id"][0].title, "first feed");
        assert_eq!(resolve_id(&cache, "missing", "Other", "One"), Some("other".into()));
    }
    #[test]
    fn exact_display_name_wins_before_fuzzy_tvg_name_and_aliases_survive() {
        let mut cache = fixture("news", "News", "news");
        merge_source(&mut cache, fixture("cinema", "Cinema", "cinema"));
        cache.channels.get_mut("cinema").unwrap().names.push("Films".into());
        assert_eq!(resolve_id(&cache, "missing", "News Extra", "Cinema"), Some("cinema".into()));
        assert_eq!(resolve_id(&cache, "missing", "Films", "Renamed"), Some("cinema".into()));
    }
    #[test]
    fn custom_feed_cdata_aliases_and_programme_order() {
        let xml = r#"<tv><channel id="private"><display-name>First</display-name><display-name><![CDATA[Alias & News]]></display-name></channel>
        <programme channel="private" start="20260912110000 +0000" stop="20260912120000 +0000"><title><![CDATA[Later & News]]></title></programme>
        <programme channel="private" start="20260912100000 +0000" stop="20260912110000 +0000"><title>Earlier</title></programme></tv>"#;
        let (channels, programs) = xmltv::parse_xmltv_native(xml).unwrap();
        assert_eq!(channels["private"].names, ["First", "Alias & News"]);
        assert_eq!(programs["private"][0].title, "Earlier");
        assert_eq!(programs["private"][1].title, "Later & News");
        let (_, browser) = xmltv::parse_xmltv(xml).unwrap();
        assert_eq!(browser["private"].len(), 1, "original browser parser behavior is unchanged");
    }
    #[test]
    fn incomplete_native_feed_is_rejected_before_cache_replacement() {
        let complete = r#"<tv><channel id="a"><display-name>Feed A</display-name></channel></tv>"#;
        let truncated = complete.trim_end_matches("</tv>");
        assert!(xmltv::parse_xmltv_native(truncated).is_err());
        assert!(xmltv::parse_xmltv(truncated).unwrap().0.contains_key("a"), "browser parser behavior remains unchanged");
        assert!(xmltv::parse_xmltv_native("<html>upstream error</html>").is_err());
        assert!(xmltv::parse_xmltv_native("<tv></tv><tv></tv>").is_err());
        assert!(xmltv::parse_xmltv_native("").is_err());
        assert!(xmltv::parse_xmltv_native(complete).unwrap().0.contains_key("a"));
        assert!(xmltv::parse_xmltv_native("<?xml version=\"1.0\"?><tv/>").unwrap().0.is_empty());
    }
    #[test]
    fn native_metadata_retains_sources_and_raw_ids() {
        let body = "{\"native_channels\":{\"42\":{\"tvg_id\":\"private-id\",\"xmltv_urls\":[\"https://fixture/feed.xml?key=x\"]}}}\n\t\nlegacy-raw\n\t\n42-1-2-3~Private";
        assert_eq!(match_ids(body), ["42"]);
        assert_eq!(match_metadata(body)["42"].xmltv_urls, ["https://fixture/feed.xml?key=x"]);
        assert!(match_metadata("{}\n\t\n\n\t\n42-1-2-3~Private").is_empty());
    }
}
