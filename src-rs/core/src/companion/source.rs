//! Bounded public torrent-metadata acquisition, without ambient proxy credentials.
pub fn validate(source: &str) -> Result<(), &'static str> {
    if source.len() > 16 * 1024 || source.chars().any(char::is_control) {
        return Err("invalid_source");
    }
    if source.starts_with("magnet:") {
        let magnet = librqbit::Magnet::parse(source).map_err(|_| "invalid_source")?;
        if magnet.as_id20().is_none() || magnet.trackers.len() > 16 {
            return Err("invalid_source");
        }
        for tracker in &magnet.trackers {
            validate_tracker(tracker)?;
        }
        if magnet.get_select_only().is_some() {
            return Err("file_selection_required");
        }
        Ok(())
    } else {
        public_url(source).map(|_| ())
    }
}
fn validate_tracker(raw: &str) -> Result<(), &'static str> {
    if raw.len() > 2048 || raw.chars().any(char::is_control) {
        return Err("invalid_tracker");
    }
    let url = reqwest::Url::parse(raw).map_err(|_| "invalid_tracker")?;
    if !matches!(url.scheme(), "http" | "https" | "udp") || url.host_str().is_none() {
        return Err("invalid_tracker");
    }
    Ok(())
}
/// Bound all metainfo trackers before the engine can create announce tasks.
/// Torrent peer/tracker discovery is separate from the public metadata HTTP proxy.
pub fn validate_metainfo(bytes: &[u8]) -> Result<(), &'static str> {
    if bytes.len() > 1024 * 1024 {
        return Err("metadata_limit");
    }
    let metadata = librqbit::torrent_from_bytes(bytes).map_err(|_| "invalid_metadata")?;
    for (index, tracker) in metadata
        .iter_announce()
        .filter(|tracker| !tracker.as_ref().is_empty())
        .enumerate()
    {
        if index >= 16 {
            return Err("tracker_limit");
        }
        validate_tracker(std::str::from_utf8(tracker.as_ref()).map_err(|_| "invalid_tracker")?)?;
    }
    Ok(())
}
fn public_url(source: &str) -> Result<reqwest::Url, &'static str> {
    let url = reqwest::Url::parse(source).map_err(|_| "invalid_source")?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || !matches!(url.port_or_known_default(), Some(80 | 443))
    {
        return Err("invalid_source");
    }
    Ok(url)
}
pub async fn fetch(source: &str) -> Result<Vec<u8>, &'static str> {
    crate::proxy::fetch_companion_metadata(source).await
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn embedded_tracker_count_is_bounded_before_native_ingestion() {
        fn fixture(count: usize) -> Vec<u8> {
            let mut bytes = b"d13:announce-listl".to_vec();
            for _ in 0..count {
                bytes.extend_from_slice(b"l26:https://example.test/tracke");
            }
            bytes.extend_from_slice(
                b"e4:infod6:lengthi1e4:name1:x12:piece lengthi1e6:pieces20:00000000000000000000ee",
            );
            bytes
        }
        assert!(validate_metainfo(b"d8:announce0:4:infod6:lengthi1e4:name1:x12:piece lengthi1e6:pieces20:00000000000000000000ee").is_ok(), "trackerless torrents use an empty announce field");
        assert!(validate_metainfo(&fixture(16)).is_ok());
        assert_eq!(validate_metainfo(&fixture(17)), Err("tracker_limit"));
    }
    #[test]
    fn source_policy() {
        for value in [
            "file:///private",
            "https://user:pass@example.test/a",
            "http://example.test:9000/a",
            "https://example.test/a#hash",
        ] {
            assert!(validate(value).is_err());
        }
    }
}
