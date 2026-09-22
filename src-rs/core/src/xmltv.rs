//! XMLTV fetch + parse + fuzzy match.
use std::collections::HashMap;
use std::io::Read;

use flate2::read::GzDecoder;
use quick_xml::events::Event;
use quick_xml::Reader;
use reqwest::Client;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default)]
pub struct Channel {
    pub id: String,
    pub name: String,
    pub icon: String,
    /// Retained for native matching; the browser matcher keeps using `name`.
    pub names: Vec<String>,
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
    fetch_single_impl(source, false).await
}

/// Native custom feeds retain aliases and chronological programme order.
pub async fn fetch_single_native(source: &str) -> anyhow::Result<(Channels, Programs)> {
    fetch_single_impl(source, true).await
}

async fn fetch_single_impl(source: &str, native: bool) -> anyhow::Result<(Channels, Programs)> {
    let content: Vec<u8> = if source.starts_with("http://") || source.starts_with("https://") {
        let builder = Client::builder().user_agent("OTT-play-FOSS/1.0");
        let builder = if native {
            builder.timeout(std::time::Duration::from_secs(60))
        } else {
            builder
        };
        let client = builder.build()?;
        let resp = client.get(source).send().await?;
        let resp = if native {
            resp.error_for_status()?
        } else {
            resp
        };
        let bytes = resp.bytes().await?;
        bytes.to_vec()
    } else {
        std::fs::read(source)?
    };

    let is_gz = (!native && source.ends_with(".gz")) || content.starts_with(&[0x1f, 0x8b]);
    let raw: Vec<u8> = if is_gz {
        let mut d = GzDecoder::new(&content[..]);
        let mut out = Vec::new();
        d.read_to_end(&mut out)?;
        out
    } else {
        content
    };

    let text = String::from_utf8_lossy(&raw);
    parse_xmltv_impl(&text, native)
}

/// Event-based XMLTV parser. Cheap; no DOM.
pub fn parse_xmltv(xml: &str) -> anyhow::Result<(Channels, Programs)> {
    parse_xmltv_impl(xml, false)
}

pub fn parse_xmltv_native(xml: &str) -> anyhow::Result<(Channels, Programs)> {
    parse_xmltv_impl(xml, true)
}

fn parse_xmltv_impl(xml: &str, native: bool) -> anyhow::Result<(Channels, Programs)> {
    let mut reader = Reader::from_str(xml);
    // quick-xml 0.41 emits references separately. Preserve whitespace between
    // text/reference/CDATA events and trim once when the complete field closes.
    reader.config_mut().trim_text(false);

    let mut channels: Channels = HashMap::new();
    let mut programs: Programs = HashMap::new();

    let mut current_channel: Option<Channel> = None;
    let mut current_programme: Option<(String, Programme)> = None;
    let mut text_target: Option<TextTarget> = None;
    let mut text_buffer = String::new();

    let mut buf = Vec::new();
    let mut depth = 0usize;
    let mut root_seen = false;
    let mut root_closed = false;
    loop {
        let event = reader.read_event_into(&mut buf);
        if native {
            // quick_xml can return EOF after complete channels inside an unclosed root.
            // Such a partial download must never replace the native cache.
            match &event {
                Ok(Event::Start(element)) => {
                    if depth == 0 {
                        anyhow::ensure!(
                            !root_seen && element.name().as_ref() == b"tv",
                            "Invalid XMLTV root"
                        );
                        root_seen = true;
                    }
                    depth += 1;
                }
                Ok(Event::Empty(element)) if depth == 0 => {
                    anyhow::ensure!(
                        !root_seen && element.name().as_ref() == b"tv",
                        "Invalid XMLTV root"
                    );
                    root_seen = true;
                    root_closed = true;
                }
                Ok(Event::End(element)) => {
                    anyhow::ensure!(depth > 0, "Unexpected XMLTV closing element");
                    depth -= 1;
                    if depth == 0 {
                        anyhow::ensure!(
                            element.name().as_ref() == b"tv",
                            "Invalid XMLTV closing root"
                        );
                        root_closed = true;
                    }
                }
                Ok(Event::Text(text)) if depth == 0 => {
                    anyhow::ensure!(text.decode()?.trim().is_empty(), "Text outside XMLTV root");
                }
                Ok(Event::GeneralRef(_)) if depth == 0 => {
                    anyhow::bail!("Entity outside XMLTV root")
                }
                Ok(Event::CData(_)) if depth == 0 => anyhow::bail!("CDATA outside XMLTV root"),
                Ok(Event::Eof) => anyhow::ensure!(
                    root_seen && root_closed && depth == 0,
                    "Incomplete XMLTV document"
                ),
                _ => {}
            }
        }
        match event {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                match name.as_str() {
                    "channel" => {
                        let id = attr(&e, "id").unwrap_or_default();
                        current_channel = Some(Channel {
                            id,
                            name: String::new(),
                            icon: String::new(),
                            names: Vec::new(),
                        });
                    }
                    "programme" => {
                        let channel = attr(&e, "channel").unwrap_or_default();
                        let start = parse_xmltv_time(&attr(&e, "start").unwrap_or_default())?;
                        let stop = parse_xmltv_time(&attr(&e, "stop").unwrap_or_default())?;
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
                        text_buffer.clear();
                    }
                    "title" if current_programme.is_some() => {
                        text_target = Some(TextTarget::ProgTitle);
                        text_buffer.clear();
                    }
                    "desc" if current_programme.is_some() => {
                        text_target = Some(TextTarget::ProgDesc);
                        text_buffer.clear();
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
                if text_target.is_some() {
                    text_buffer.push_str(&t.decode()?);
                }
            }
            Ok(Event::CData(t)) => {
                if text_target.is_some() {
                    text_buffer.push_str(&t.decode()?);
                }
            }
            Ok(Event::GeneralRef(reference)) => {
                if text_target.is_some() {
                    if let Some(character) = reference.resolve_char_ref()? {
                        text_buffer.push(character);
                    } else {
                        let name = reference.decode()?;
                        match quick_xml::escape::resolve_predefined_entity(&name) {
                            Some(value) => text_buffer.push_str(value),
                            None => anyhow::bail!("Unsupported XML entity: &{name};"),
                        }
                    }
                }
            }
            Ok(Event::End(e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                match name.as_str() {
                    "display-name" | "title" | "desc" => {
                        if let Some(target) = text_target.take() {
                            let value = text_buffer.trim().to_owned();
                            match target {
                                TextTarget::ChannelName => {
                                    if let Some(c) = current_channel.as_mut() {
                                        c.names.push(value.clone());
                                        c.name = value;
                                    }
                                }
                                TextTarget::ProgTitle => {
                                    if let Some((_, p)) = current_programme.as_mut() {
                                        p.title = value;
                                    }
                                }
                                TextTarget::ProgDesc => {
                                    if let Some((_, p)) = current_programme.as_mut() {
                                        p.desc = value;
                                    }
                                }
                            }
                        }
                        text_buffer.clear();
                    }
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
                                programs.entry(channel_id).or_default().push(p);
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

    if native {
        for programs in programs.values_mut() {
            programs.sort_by_key(|program| program.start);
        }
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
            return a
                .decoded_and_normalized_value(quick_xml::XmlVersion::Implicit1_0, e.decoder())
                .ok()
                .map(|v| v.into_owned());
        }
    }
    None
}

/// Parse XMLTV timestamps through the pinned shared core (seconds).
pub fn parse_xmltv_time(ts: &str) -> anyhow::Result<i64> {
    crate::shared_guide::text::<f64>("nativeGuideTime", ts).map(|value| value as i64)
}

pub use crate::shared_guide::GuideIndex as MatchIndex;

pub fn normalize_name(name: &str) -> anyhow::Result<String> {
    crate::shared_guide::text("nativeGuideName", name)
}

pub fn build_match_index(channels: &Channels) -> anyhow::Result<MatchIndex> {
    MatchIndex::new(channels.iter().map(|(id, c)| vec![id.clone(), c.name.clone()]).collect())
}

pub fn match_in_index(name: &str, index: &MatchIndex) -> anyhow::Result<Option<(String, f32)>> {
    index.match_name(name)
}

pub fn match_channel(name: &str, channels: &Channels) -> anyhow::Result<Option<(String, f32)>> {
    match_in_index(name, &build_match_index(channels)?)
}

pub fn strip_time_shift(name: &str) -> anyhow::Result<String> {
    crate::shared_guide::text("nativeGuideStripShift", name)
}

pub fn extract_time_shift(name: &str) -> anyhow::Result<i64> {
    crate::shared_guide::text::<i32>("nativeGuideShift", name).map(i64::from)
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
    fn xmltv_preserves_fragmented_entities_cdata_and_attribute_values() {
        let xml = r#"<tv>
<channel id="c1"><display-name>Channel &amp; &#x41;&#66;</display-name>
<icon src="https://example.test/icon?a=1&amp;b=2"/></channel>
<programme start="20260101000000 +0000" stop="20260101010000 +0000" channel="c1">
<title>  News &amp; Sport &#x1f3c6;  </title>
<desc>Before <![CDATA[<raw>&]]> after &quot;quotes&quot; &apos;ok&apos;</desc>
</programme></tv>"#;
        let (channels, programmes) = parse_xmltv(xml).unwrap();
        assert_eq!(channels["c1"].name, "Channel & AB");
        assert_eq!(channels["c1"].icon, "https://example.test/icon?a=1&b=2");
        assert_eq!(programmes["c1"][0].title, "News & Sport 🏆");
        assert_eq!(
            programmes["c1"][0].desc,
            "Before <raw>& after \"quotes\" 'ok'"
        );
    }

    #[test]
    fn xmltv_rejects_unresolved_entities_without_external_resolution() {
        assert!(parse_xmltv(
            "<tv><channel id='c1'><display-name>&external;</display-name></channel></tv>"
        )
        .is_err());
    }

    #[test]
    fn malformed_multibyte_timestamps_do_not_panic() {
        assert_eq!(parse_xmltv_time("2026010100000💥").unwrap(), 0);
        assert_eq!(parse_xmltv_time("20260101000000 +0💥").unwrap(), 0);
    }

    #[test]
    fn time_parse_utc() {
        let t = parse_xmltv_time("20260101120000 +0000").unwrap();
        assert!(t > 0);
    }

    #[test]
    fn time_parse_positive_offset() {
        let utc = parse_xmltv_time("20260101120000 +0000").unwrap();
        let plus3 = parse_xmltv_time("20260101120000 +0300").unwrap();
        assert_eq!(utc - plus3, 3 * 3600, "+0300 local noon is 09:00 UTC");
        let minus530 = parse_xmltv_time("20260101120000 -0530").unwrap();
        assert_eq!(minus530 - utc, 5 * 3600 + 30 * 60);
    }

    #[test]
    fn normalize_strip_hd() {
        assert_eq!(normalize_name("HD First").unwrap(), "first");
        assert_eq!(normalize_name("First HD").unwrap(), "first");
        assert_eq!(normalize_name("First +4h").unwrap(), "first");
        assert_eq!(normalize_name("First (Алания)").unwrap(), "first");
    }

    #[test]
    fn match_exact() {
        let mut ch = Channels::new();
        ch.insert(
            "c1".into(),
            Channel {
                id: "c1".into(),
                name: "Первый канал".into(),
                names: vec!["Первый канал".into()],
                icon: String::new(),
            },
        );
        let m = match_channel("Первый канал", &ch).unwrap();
        assert!(m.is_some());
        assert_eq!(m.unwrap().0, "c1");
    }
}
