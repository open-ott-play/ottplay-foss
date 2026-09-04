//! XMLTV fetch + parse + fuzzy match.
use std::collections::HashMap;
use std::io::Read;
use std::sync::LazyLock;

use flate2::read::GzDecoder;
use quick_xml::events::Event;
use quick_xml::Reader;
use regex::Regex;
use reqwest::Client;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default)]
pub struct Channel {
    pub id: String,
    pub name: String,
    pub icon: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Programme {
    pub start: i64,
    pub stop: i64,
    pub title: String,
    pub desc: String,
    pub icon: String,
}

#[derive(Clone, Debug, Default)]
pub struct XmltvCache {
    pub channels: HashMap<String, Channel>,
    pub programs: HashMap<String, Vec<Programme>>,
    pub fetched_at: u64,
}

pub type Channels = HashMap<String, Channel>;
pub type Programs = HashMap<String, Vec<Programme>>;

/// Fetch + parse one XMLTV source. Supports http(s), .gz, plain .xml.
pub async fn fetch_single(source: &str) -> anyhow::Result<(Channels, Programs)> {
    let content: Vec<u8> = if source.starts_with("http://") || source.starts_with("https://") {
        let client = Client::builder()
            .user_agent("OTT-play-FOSS/1.0")
            .build()?;
        let resp = client.get(source).send().await?;
        let bytes = resp.bytes().await?;
        bytes.to_vec()
    } else {
        std::fs::read(source)?
    };

    let is_gz = source.ends_with(".gz") || content.starts_with(&[0x1f, 0x8b]);
    let raw: Vec<u8> = if is_gz {
        let mut d = GzDecoder::new(&content[..]);
        let mut out = Vec::new();
        d.read_to_end(&mut out)?;
        out
    } else {
        content
    };

    let text = String::from_utf8_lossy(&raw);
    parse_xmltv(&text)
}

/// Event-based XMLTV parser. Cheap; no DOM.
pub fn parse_xmltv(xml: &str) -> anyhow::Result<(Channels, Programs)> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);

    let mut channels: Channels = HashMap::new();
    let mut programs: Programs = HashMap::new();

    let mut current_channel: Option<Channel> = None;
    let mut current_programme: Option<(String, Programme)> = None;
    let mut text_target: Option<TextTarget> = None;

    let mut buf = Vec::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                match name.as_str() {
                    "channel" => {
                        let id = attr(&e, "id").unwrap_or_default();
                        current_channel = Some(Channel {
                            id,
                            name: String::new(),
                            icon: String::new(),
                        });
                    }
                    "programme" => {
                        let channel = attr(&e, "channel").unwrap_or_default();
                        let start = parse_xmltv_time(&attr(&e, "start").unwrap_or_default());
                        let stop = parse_xmltv_time(&attr(&e, "stop").unwrap_or_default());
                        current_programme = Some((
                            channel,
                            Programme {
                                start,
                                stop,
                                title: String::new(),
                                desc: String::new(),
                                icon: String::new(),
                            },
                        ));
                    }
                    "display-name" if current_channel.is_some() => {
                        text_target = Some(TextTarget::ChannelName);
                    }
                    "title" if current_programme.is_some() => {
                        text_target = Some(TextTarget::ProgTitle);
                    }
                    "desc" if current_programme.is_some() => {
                        text_target = Some(TextTarget::ProgDesc);
                    }
                    "icon" => {
                        if let Some(src) = attr(&e, "src") {
                            if let Some(c) = current_channel.as_mut() {
                                c.icon = src;
                            } else if let Some((_, p)) = current_programme.as_mut() {
                                p.icon = src;
                            }
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::Text(t)) => {
                if let Some(target) = text_target.take() {
                    let s = t.unescape().unwrap_or_default().into_owned();
                    match target {
                        TextTarget::ChannelName => {
                            if let Some(c) = current_channel.as_mut() {
                                c.name = s;
                            }
                        }
                        TextTarget::ProgTitle => {
                            if let Some((_, p)) = current_programme.as_mut() {
                                p.title = s;
                            }
                        }
                        TextTarget::ProgDesc => {
                            if let Some((_, p)) = current_programme.as_mut() {
                                p.desc = s;
                            }
                        }
                    }
                }
            }
            Ok(Event::End(e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                match name.as_str() {
                    "channel" => {
                        if let Some(mut c) = current_channel.take() {
                            if c.name.is_empty() {
                                c.name = c.id.clone();
                            }
                            channels.insert(c.id.clone(), c);
                        }
                    }
                    "programme" => {
                        if let Some((channel_id, p)) = current_programme.take() {
                            if !p.title.is_empty() {
                                programs
                                    .entry(channel_id)
                                    .or_insert_with(Vec::new)
                                    .push(p);
                            }
                        }
                    }
                    _ => {}
                }
                text_target = None;
            }
            Ok(Event::Eof) => break,
            Err(e) => anyhow::bail!("XML parse error at {}: {e}", reader.buffer_position()),
            _ => {}
        }
        buf.clear();
    }

    Ok((channels, programs))
}

#[derive(Copy, Clone)]
enum TextTarget {
    ChannelName,
    ProgTitle,
    ProgDesc,
}

fn attr(e: &quick_xml::events::BytesStart<'_>, key: &str) -> Option<String> {
    for a in e.attributes().flatten() {
        if a.key.as_ref() == key.as_bytes() {
            return a.unescape_value().ok().map(|v| v.into_owned());
        }
    }
    None
}

/// Parse XMLTV timestamp `YYYYMMDDHHMMSS ±HHMM` → Unix seconds.
pub fn parse_xmltv_time(ts: &str) -> i64 {
    let ts = ts.trim();
    if ts.len() < 14 {
        return 0;
    }
    let (date_part, tz_part) = if ts.len() > 14 {
        if ts.as_bytes()[14] == b' ' {
            (ts[..14].to_string(), ts[15..].trim().to_string())
        } else {
            (ts[..14].to_string(), ts[14..].trim().to_string())
        }
    } else {
        (ts.to_string(), String::new())
    };

    let dt = match chrono::NaiveDateTime::parse_from_str(&date_part, "%Y%m%d%H%M%S") {
        Ok(d) => d,
        Err(_) => return 0,
    };

    if tz_part.len() >= 5 {
        let bytes = tz_part.as_bytes();
        if bytes[0] == b'+' || bytes[0] == b'-' {
            let sign: i64 = if bytes[0] == b'+' { 1 } else { -1 };
            let th: i64 = tz_part[1..3].parse().unwrap_or(0);
            let tm: i64 = tz_part[3..5].parse().unwrap_or(0);
            let offset = sign * (th * 3600 + tm * 60);
            return dt.and_utc().timestamp() - offset;
        }
    }
    dt.and_utc().timestamp()
}

// ---------------------------------------------------------------------------
// Fuzzy matching (server.py L232-322)
// ---------------------------------------------------------------------------

static RE_TS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"[+-]\s*\d+\s*(ч|h|hours?)?").unwrap());
static RE_PAREN: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\([^)]*\)").unwrap());
static RE_WS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s+").unwrap());
static RE_HD_PREF: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(hd|fhd|uhd|4k)\s+").unwrap());
static RE_HD_SUF: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\s+(hd|fhd|uhd|4k)$").unwrap());
static RE_TS_CAP: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"([+-])\s*(\d+)\s*(ч|h|hours?)?").unwrap());

/// Precomputed XMLTV lookup: exact normalized-name map + list for fuzzy scan.
#[derive(Clone, Debug, Default)]
pub struct MatchIndex {
    /// (xmltv_id, display_name, normalized_name)
    pub entries: Vec<(String, String, String)>,
    /// normalized_name → xmltv_id (first wins)
    pub by_norm: HashMap<String, String>,
}

pub fn normalize_name(name: &str) -> String {
    let s = name.to_lowercase();
    let s = RE_TS.replace_all(&s, "").into_owned();
    let s = RE_PAREN.replace_all(&s, "").into_owned();
    let s = RE_WS.replace_all(&s, " ").into_owned();
    let s = s.trim().to_string();
    let s = RE_HD_PREF.replace(&s, "").into_owned();
    RE_HD_SUF.replace(&s, "").trim().to_string()
}

pub fn build_index(channels: &Channels) -> Vec<(String, String, String)> {
    build_match_index(channels).entries
}

pub fn build_match_index(channels: &Channels) -> MatchIndex {
    let mut entries = Vec::with_capacity(channels.len());
    let mut by_norm = HashMap::with_capacity(channels.len());
    for (id, c) in channels {
        let n = normalize_name(&c.name);
        if n.is_empty() {
            continue;
        }
        by_norm.entry(n.clone()).or_insert_with(|| id.clone());
        entries.push((id.clone(), c.name.clone(), n));
    }
    MatchIndex { entries, by_norm }
}

/// Match against a prebuilt index (call once per batch, not per channel).
pub fn match_in_index(name: &str, index: &MatchIndex) -> Option<(String, f32)> {
    let normalized = normalize_name(name);
    if normalized.is_empty() {
        return None;
    }
    if let Some(id) = index.by_norm.get(&normalized) {
        return Some((id.clone(), 1.0));
    }
    let mut best_id: Option<String> = None;
    let mut best_score: f32 = 0.0;

    for (id, _name, xmltv_norm) in &index.entries {
        let score = if normalized.contains(xmltv_norm.as_str()) {
            xmltv_norm.len() as f32 / normalized.len() as f32
        } else if xmltv_norm.contains(normalized.as_str()) {
            normalized.len() as f32 / xmltv_norm.len() as f32
        } else {
            let nw: std::collections::HashSet<&str> = normalized.split_whitespace().collect();
            let xw: std::collections::HashSet<&str> = xmltv_norm.split_whitespace().collect();
            let common: usize = nw.intersection(&xw).count();
            if common == 0 {
                continue;
            }
            let min_words = nw.len().min(xw.len());
            if common < 2.max(min_words * 50 / 100) {
                continue;
            }
            common as f32 / nw.len().max(xw.len()) as f32
        };
        if score > best_score {
            best_score = score;
            best_id = Some(id.clone());
        }
    }

    if best_score >= 0.4 {
        Some((best_id.unwrap(), best_score))
    } else {
        None
    }
}

pub fn match_channel(name: &str, channels: &Channels) -> Option<(String, f32)> {
    let index = build_match_index(channels);
    match_in_index(name, &index)
}

/// Strip time-shift suffix from channel name: "+4", "-2h", "+3ч".
pub fn strip_time_shift(name: &str) -> String {
    RE_TS.replace_all(name, "").trim().to_string()
}

/// Extract time-shift hours from channel name. Returns signed hours (e.g. +4, -3).
pub fn extract_time_shift(name: &str) -> i64 {
    for cap in RE_TS_CAP.captures_iter(name) {
        let sign: i64 = if &cap[1] == "+" { 1 } else { -1 };
        let hours: i64 = cap[2].parse().unwrap_or(0);
        let hours = if hours > 24 { hours % 24 } else { hours };
        return sign * hours;
    }
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_minimal_xmltv() {
        let xml = r#"<?xml version="1.0"?>
<tv>
  <channel id="c1">
    <display-name>Channel One</display-name>
  </channel>
  <programme start="20260101000000 +0000" stop="20260101010000 +0000" channel="c1">
    <title>News</title>
    <desc>Headlines</desc>
  </programme>
</tv>"#;
        let (ch, pr) = parse_xmltv(xml).unwrap();
        assert_eq!(ch.len(), 1);
        assert_eq!(ch.get("c1").unwrap().name, "Channel One");
        let progs = pr.get("c1").expect("c1 should have progs");
        assert_eq!(progs.len(), 1);
        assert_eq!(progs[0].title, "News");
        assert_eq!(progs[0].desc, "Headlines");
    }

    #[test]
    fn time_parse_utc() {
        let t = parse_xmltv_time("20260101120000 +0000");
        assert!(t > 0);
    }

    #[test]
    fn time_parse_positive_offset() {
        let utc = parse_xmltv_time("20260101120000 +0000");
        let plus3 = parse_xmltv_time("20260101120000 +0300");
        assert!(utc < plus3, "UTC ({utc}) should be earlier than +0300 ({plus3})");
    }

    #[test]
    fn normalize_strip_hd() {
        assert_eq!(normalize_name("HD First"), "first");
        assert_eq!(normalize_name("First HD"), "first");
        assert_eq!(normalize_name("First +4h"), "first");
        assert_eq!(normalize_name("First (Алания)"), "first");
    }

    #[test]
    fn match_exact() {
        let mut ch = Channels::new();
        ch.insert(
            "c1".into(),
            Channel {
                id: "c1".into(),
                name: "Первый канал".into(),
                icon: String::new(),
            },
        );
        let m = match_channel("Первый канал", &ch);
        assert!(m.is_some());
        assert_eq!(m.unwrap().0, "c1");
    }
}
