//! Compact, generation-bound programme candidates. Availability stays private.
use super::{
    caseless_key, current_program, unicode17, CurrentResponseLimit, MatchBudget, Snapshot, SOURCE,
};
use ottplay_core::xmltv::Programs;
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    borrow::Cow,
    collections::{HashMap, HashSet},
};
use unicode_normalization::UnicodeNormalization;

pub(super) const TEXT_PROFILE: &str = "archive-nfkc-casefold-words-u17-v1";
const MAX_BYTES: usize = 2 * 1024 * 1024;
const MAX_CANDIDATE_ROWS: usize = 10_000;

fn in_ranges(ch: char, ranges: &[(u32, u32)]) -> bool {
    let code = ch as u32;
    let at = ranges.partition_point(|(_, end)| *end < code);
    ranges.get(at).is_some_and(|(start, _)| *start <= code)
}

fn clean_title(value: &str) -> String {
    let mut result = String::new();
    let mut gap = false;
    for ch in value.chars() {
        if ch.is_whitespace() || in_ranges(ch, unicode17::CONTROL) {
            gap = !result.is_empty();
        } else {
            if gap {
                result.push(' ');
            }
            result.push(ch);
            gap = false;
        }
    }
    result
}

pub(super) fn text_key(value: &str) -> String {
    text_key_bounded(value, usize::MAX).expect("unlimited search key")
}

fn text_key_bounded(value: &str, limit: usize) -> Option<String> {
    let mut result = String::new();
    let mut gap = false;
    let mut append = |ch| {
        let ch = if ch == 'ё' { 'е' } else { ch };
        if ch == '_' || in_ranges(ch, unicode17::ALNUM) {
            let extra = ch.len_utf8() + usize::from(gap && !result.is_empty());
            if result.len().checked_add(extra)? > limit {
                return None;
            }
            if gap && !result.is_empty() {
                result.push(' ');
            }
            result.push(ch);
            gap = false;
        } else {
            gap = true;
        }
        Some(())
    };
    for ch in value.nfkc() {
        match unicode17::FOLD.binary_search_by_key(&(ch as u32), |(key, _)| *key) {
            Ok(at) => {
                for ch in unicode17::FOLD[at].1.chars() {
                    append(ch)?;
                }
            }
            Err(_) => append(ch)?,
        }
    }
    Some(result)
}

struct Title {
    clean: String,
    key: String,
}

/// Deduplicated normalization avoids repeating it for every programme instance.
/// A full table falls back to the same predicate rather than dropping titles.
pub(super) struct SearchIndex {
    titles: HashMap<String, Title>,
}

impl SearchIndex {
    pub(super) fn new(programs: &Programs) -> Self {
        let started = std::time::Instant::now();
        let mut titles = HashMap::new();
        let mut bytes = 0;
        for row in programs.values().flatten() {
            if row.title.len() > super::MAX_ROW_BYTES || titles.contains_key(&row.title) {
                continue;
            }
            let clean = clean_title(&row.title);
            let Some(key) = text_key_bounded(&clean, super::MAX_ROW_BYTES) else {
                continue;
            };
            let size = 128 + row.title.len() + clean.len() + key.len();
            if bytes + size > 32 * 1024 * 1024 {
                continue;
            }
            bytes += size;
            titles.insert(row.title.clone(), Title { clean, key });
        }
        eprintln!(
            "[Hosted EPG] phase=search-index elapsedMs={} titles={} accountedBytes={}",
            started.elapsed().as_millis(),
            titles.len(),
            bytes
        );
        Self { titles }
    }

    fn title<'a>(&'a self, raw: &str, terms: &[&str]) -> anyhow::Result<(Cow<'a, str>, bool)> {
        if let Some(title) = self.titles.get(raw) {
            return Ok((
                Cow::Borrowed(&title.clean),
                !terms.is_empty() && terms.iter().all(|term| title.key.contains(term)),
            ));
        }
        let clean = clean_title(raw);
        let key = text_key_bounded(&clean, super::MAX_ROW_BYTES).ok_or(CurrentResponseLimit)?;
        let matched = !terms.is_empty() && terms.iter().all(|term| key.contains(term));
        Ok((Cow::Owned(clean), matched))
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct SearchChannel {
    pub(super) id: String,
    pub(super) tvg_id: String,
    pub(super) tvg_name: String,
    pub(super) name: String,
    shift: i64,
    archive_hours: i64,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct SearchInput {
    version: u8,
    source: String,
    #[serde(default)]
    pub(super) generation: Option<String>,
    pub(super) channels: Vec<SearchChannel>,
    search: String,
}

impl SearchInput {
    pub(super) fn valid(&self) -> bool {
        let mut ids = HashSet::new();
        self.version == 1
            && self.source == SOURCE
            && self.search.len() <= 1024
            && !self.search.trim().is_empty()
            && self.channels.len() <= 2048
            && self
                .generation
                .as_ref()
                .is_none_or(|g| !g.is_empty() && g.len() <= 80)
            && self.channels.iter().all(|row| {
                !row.id.trim().is_empty()
                    && ids.insert(&row.id)
                    && (-86400..=86400).contains(&row.shift)
                    && (0..=144).contains(&row.archive_hours)
                    && [&row.id, &row.tvg_id, &row.tvg_name, &row.name]
                        .iter()
                        .all(|s| s.encode_utf16().count() <= 512)
            })
    }
}

struct Row<'a> {
    start: i64,
    end: i64,
    title: Cow<'a, str>,
    matched: bool,
}

impl Snapshot {
    pub(super) fn search(
        &self,
        input: SearchInput,
        now: u64,
        budget: &MatchBudget,
    ) -> anyhow::Result<Value> {
        let clock = (now / 1000) as i64;
        let literal = caseless_key(&input.search);
        let key = text_key(&input.search);
        let terms = key.split_whitespace().collect::<Vec<_>>();
        let mut current = Vec::new();
        let mut archive_current = Vec::new();
        let mut archives = Vec::new();
        let total = input.channels.len();
        let mut bytes = 512;
        let mut count = 0;
        // Conservative validity: any schedule transition requires a live recheck.
        let mut valid_until =
            (clock + 60).min(((self.fetched_at + super::REFRESH_MS) / 1000) as i64);
        for channel in input.channels {
            budget.check()?;
            let Some((id, inferred)) =
                self.resolve(&channel.tvg_id, &channel.tvg_name, &channel.name, budget)?
            else {
                continue;
            };
            let Some(programs) = self.programs.get(&id) else {
                continue;
            };
            let shift = inferred + channel.shift;
            if let Some(row) = current_program(programs, clock - shift, budget)? {
                if row.title.len() > super::MAX_ROW_BYTES / 2 {
                    return Err(CurrentResponseLimit.into());
                }
                if !row.title.is_empty() && caseless_key(&row.title).contains(&literal) {
                    let item = json!({"id":channel.id,"start":row.start+shift,"end":row.stop+shift,"title":row.title});
                    account(&item, &mut bytes, &mut count)?;
                    current.push(item);
                }
            }
            let mut rows = Vec::new();
            let cutoff = clock - channel.archive_hours * 3600;
            let mut temporary_bytes = 0usize;
            for row in programs {
                budget.check()?;
                let start = row.start + shift;
                let end = row.stop + shift;
                if start <= 0 || start >= end {
                    continue;
                }
                for boundary in [start, end] {
                    if boundary > clock {
                        valid_until = valid_until.min(boundary);
                    }
                }
                if end <= cutoff || start > clock {
                    continue;
                }
                // Cleaned text never grows beyond raw UTF-8. Charge capacity
                // headroom plus the row vector and sort scratch before any
                // cleaning, including for rows which will not match.
                temporary_bytes = temporary_bytes.saturating_add(
                    row.title.len().saturating_mul(2) + 3 * std::mem::size_of::<Row>(),
                );
                if rows.len() >= super::MAX_ROWS || temporary_bytes > super::MAX_ROW_BYTES {
                    return Err(CurrentResponseLimit.into());
                }
                let (title, matched) = self.search_index.title(&row.title, &terms)?;
                rows.push(Row {
                    start,
                    end,
                    title,
                    matched,
                });
            }
            // This is clean_rows' tuple order and dedup; nonmatches remain in
            // the sequence because they can break an otherwise adjacent chain.
            rows.sort_by(|a, b| {
                (a.start, a.end, a.title.as_ref()).cmp(&(b.start, b.end, b.title.as_ref()))
            });
            rows.dedup_by(|a, b| {
                (a.start, a.end, a.title.as_ref()) == (b.start, b.end, b.title.as_ref())
            });
            let mut previous_end = None;
            let mut chain = Vec::new();
            for row in rows {
                budget.check()?;
                if row.matched && row.start <= clock && clock < row.end {
                    let item =
                        json!({"id":channel.id,"start":row.start,"end":row.end,"title":row.title});
                    account(&item, &mut bytes, &mut count)?;
                    archive_current.push(item);
                }
                let eligible = row.matched
                    && channel.archive_hours > 0
                    && cutoff < row.start
                    && row.end <= clock;
                if !chain.is_empty() && (!eligible || previous_end != Some(row.start)) {
                    let item = json!({"id":channel.id,"rows":std::mem::take(&mut chain)});
                    bytes += 64 + channel.id.len();
                    if bytes > MAX_BYTES {
                        return Err(CurrentResponseLimit.into());
                    }
                    archives.push(item);
                }
                if eligible {
                    valid_until = valid_until.min(row.start + channel.archive_hours * 3600);
                    let item = json!({"start":row.start,"end":row.end,"title":row.title});
                    account(&item, &mut bytes, &mut count)?;
                    chain.push(item);
                }
                previous_end = Some(row.end);
            }
            if !chain.is_empty() {
                let item = json!({"id":channel.id,"rows":chain});
                bytes += 64 + channel.id.len();
                if bytes > MAX_BYTES {
                    return Err(CurrentResponseLimit.into());
                }
                archives.push(item);
            }
        }
        budget.check()?;
        let mut result = self.metadata(now);
        result["asOf"] = json!(clock);
        result["validUntil"] = json!(valid_until);
        result["checked"] = json!(total);
        result["total"] = json!(total);
        result["complete"] = json!(true);
        result["textProfile"] = json!(TEXT_PROFILE);
        result["current"] = json!(current);
        result["archiveCurrent"] = json!(archive_current);
        result["archives"] = json!(archives);
        if serde_json::to_vec(&result)?.len() > MAX_BYTES {
            return Err(CurrentResponseLimit.into());
        }
        Ok(result)
    }
}

fn account(value: &Value, bytes: &mut usize, count: &mut usize) -> anyhow::Result<()> {
    *bytes += serde_json::to_vec(value)?.len();
    *count += 1;
    if *bytes > MAX_BYTES || *count > MAX_CANDIDATE_ROWS {
        return Err(CurrentResponseLimit.into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn archive_profile_preserves_legacy_word_rules() {
        for (value, expected) in [
            ("Орёл и решка", "орел и решка"),
            ("ＡＢＣ", "abc"),
            ("Straße", "strasse"),
            ("foo-bar", "foo bar"),
            ("İı", "i ı"),
            ("a\u{301}", "á"),
            ("a_b ①", "a_b 1"),
        ] {
            assert_eq!(text_key(value), expected);
        }
        assert_eq!(clean_title(" a\u{200b}b\n c "), "a b c");
        assert_eq!(text_key("𐐀"), text_key("𐐨"));
        assert!(text_key_bounded("ﷺ", 3).is_none());
    }
}
