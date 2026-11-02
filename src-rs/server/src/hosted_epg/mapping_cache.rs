use std::collections::HashMap;

type Key = (String, String, String);
pub(super) type Mapping = Option<(String, i64)>;

/// Entries never change or evict during one immutable guide generation. A
/// complete-cache check therefore remains valid while a queued reader starts.
#[derive(Default)]
pub(super) struct MappingCache {
    entries: HashMap<Key, Mapping>,
    bytes: usize,
}

impl MappingCache {
    const MAX_ENTRIES: usize = 16_384;
    const MAX_BYTES: usize = 16 * 1024 * 1024;

    pub(super) fn get(&self, id: &str, tvg_name: &str, name: &str) -> Option<Mapping> {
        self.entries
            .get(&(id.into(), tvg_name.into(), name.into()))
            .cloned()
    }

    pub(super) fn insert(&mut self, id: &str, tvg_name: &str, name: &str, value: Mapping) {
        let size = 192
            + id.len()
            + tvg_name.len()
            + name.len()
            + value.as_ref().map_or(0, |(id, _)| id.len());
        if self.entries.len() >= Self::MAX_ENTRIES || self.bytes + size > Self::MAX_BYTES {
            return;
        }
        let key = (id.into(), tvg_name.into(), name.into());
        if let std::collections::hash_map::Entry::Vacant(entry) = self.entries.entry(key) {
            entry.insert(value);
            self.bytes += size;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn distinguishes_negative_entries_from_misses_and_keeps_raw_keys() {
        let mut cache = MappingCache::default();
        cache.insert("", "", "News", None);
        assert_eq!(cache.get("", "", "News"), Some(None));
        assert_eq!(cache.get("", "", "news"), None);
        cache.insert("", "", "News", Some(("changed".into(), 0)));
        assert_eq!(cache.get("", "", "News"), Some(None));
    }

    #[test]
    fn caps_entries_and_bytes_without_removing_accepted_results() {
        let mut cache = MappingCache::default();
        for i in 0..MappingCache::MAX_ENTRIES + 1 {
            cache.insert(&i.to_string(), "", "", None);
        }
        assert_eq!(cache.entries.len(), MappingCache::MAX_ENTRIES);
        assert_eq!(cache.get("0", "", ""), Some(None));
        let mut cache = MappingCache::default();
        cache.insert("", "", &"x".repeat(MappingCache::MAX_BYTES), None);
        assert!(cache.entries.is_empty());
    }
}
