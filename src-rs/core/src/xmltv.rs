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

    let mut records = RecordTokens::new(native)?;

    let mut buf = Vec::new();
    let mut depth = 0usize;
    let mut root_seen = false;
    let mut root_closed = false;
    loop {
        let event = reader.read_event_into(&mut buf);
        let validation = (|| -> anyhow::Result<()> {
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
                        anyhow::ensure!(
                            text.decode()?.trim().is_empty(),
                            "Text outside XMLTV root"
                        );
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
            Ok(())
        })();
        if let Err(error) = validation {
            records.flush(&mut channels, &mut programs)?;
            return Err(error);
        }
        match event {
            Ok(Event::Start(element)) | Ok(Event::Empty(element)) => {
                // Empty elements have always supplied only a start event here.
                let mut row = vec![
                    "start".into(),
                    String::from_utf8_lossy(element.name().as_ref()).into_owned(),
                ];
                for key in ["id", "channel", "start", "stop", "src"] {
                    if let Some(value) = attr(&element, key) {
                        row.push(key.into());
                        row.push(value);
                    }
                }
                records.push(row, &mut channels, &mut programs)?;
            }
            Ok(Event::Text(text)) => {
                records.text(
                    text.decode()
                        .map(|text| text.into_owned())
                        .map_err(Into::into),
                    &mut channels,
                    &mut programs,
                )?;
            }
            Ok(Event::CData(text)) => {
                records.text(
                    text.decode()
                        .map(|text| text.into_owned())
                        .map_err(Into::into),
                    &mut channels,
                    &mut programs,
                )?;
            }
            Ok(Event::GeneralRef(reference)) => {
                let decoded = (|| -> anyhow::Result<String> {
                    if let Some(character) = reference.resolve_char_ref()? {
                        return Ok(character.to_string());
                    }
                    let name = reference.decode()?;
                    match quick_xml::escape::resolve_predefined_entity(&name) {
                        Some(value) => Ok(value.into()),
                        None => anyhow::bail!("Unsupported XML entity: &{name};"),
                    }
                })();
                records.text(decoded, &mut channels, &mut programs)?;
            }
            Ok(Event::End(element)) => records.push(
                vec![
                    "end".into(),
                    String::from_utf8_lossy(element.name().as_ref()).into_owned(),
                ],
                &mut channels,
                &mut programs,
            )?,
            Ok(Event::Eof) => break,
            Err(error) => {
                // A prior batched decode error keeps its original precedence.
                records.flush(&mut channels, &mut programs)?;
                anyhow::bail!("XML parse error at {}: {error}", reader.buffer_position());
            }
            _ => {}
        }
        buf.clear();
    }

    records.flush(&mut channels, &mut programs)?;
    if native {
        for entries in programs.values_mut() {
            let order = records
                .core
                .order(entries.iter().map(|entry| entry.start as f64).collect())?;
            anyhow::ensure!(order.len() == entries.len(), "Invalid shared XMLTV order");
            let mut original: Vec<_> = std::mem::take(entries).into_iter().map(Some).collect();
            for index in order {
                entries.push(
                    original
                        .get_mut(index)
                        .and_then(Option::take)
                        .ok_or_else(|| anyhow::anyhow!("Invalid shared XMLTV order"))?,
                );
            }
        }
    }
    Ok((channels, programs))
}

/// The bounded transport queue contains XML tokens and original decoder errors.
/// Only the shared reducer decides whether a text token belongs to a field.
struct RecordTokens {
    core: crate::shared_guide::GuideRecords,
    rows: Vec<Vec<String>>,
    bytes: usize,
    errors: Vec<Option<anyhow::Error>>,
}

impl RecordTokens {
    const MAX_ROWS: usize = 256;
    const MAX_BYTES: usize = 64 * 1024;

    fn new(native: bool) -> anyhow::Result<Self> {
        Ok(Self {
            core: crate::shared_guide::GuideRecords::new(native)?,
            rows: Vec::new(),
            bytes: 0,
            errors: Vec::new(),
        })
    }

    fn push(
        &mut self,
        row: Vec<String>,
        channels: &mut Channels,
        programs: &mut Programs,
    ) -> anyhow::Result<()> {
        self.bytes += row.iter().map(String::len).sum::<usize>();
        self.rows.push(row);
        if self.rows.len() >= Self::MAX_ROWS || self.bytes >= Self::MAX_BYTES {
            self.flush(channels, programs)?;
        }
        Ok(())
    }

    fn text(
        &mut self,
        value: anyhow::Result<String>,
        channels: &mut Channels,
        programs: &mut Programs,
    ) -> anyhow::Result<()> {
        let row = match value {
            Ok(value) => vec!["text".into(), value],
            Err(error) => {
                let index = self.errors.len();
                self.errors.push(Some(error));
                vec!["text-error".into(), index.to_string()]
            }
        };
        self.push(row, channels, programs)
    }

    fn flush(&mut self, channels: &mut Channels, programs: &mut Programs) -> anyhow::Result<()> {
        if self.rows.is_empty() {
            return Ok(());
        }
        let actions = self.core.accept(std::mem::take(&mut self.rows))?;
        for action in actions {
            match action.first().map(String::as_str) {
                Some("replace-channel") if action.len() >= 4 => {
                    let mut fields = action.into_iter().skip(1);
                    let id = fields.next().expect("checked length");
                    channels.insert(
                        id.clone(),
                        Channel {
                            id,
                            name: fields.next().expect("checked length"),
                            icon: fields.next().expect("checked length"),
                            names: fields.collect(),
                        },
                    );
                }
                Some("programme") if action.len() == 7 => {
                    let mut fields = action.into_iter().skip(1);
                    let channel = fields.next().expect("checked length");
                    programs.entry(channel).or_default().push(Programme {
                        start: fields.next().expect("checked length").parse::<f64>()? as i64,
                        stop: fields.next().expect("checked length").parse::<f64>()? as i64,
                        title: fields.next().expect("checked length"),
                        desc: fields.next().expect("checked length"),
                        icon: fields.next().expect("checked length"),
                    });
                }
                Some("error") if action.len() == 2 => {
                    let index: usize = action[1].parse()?;
                    return Err(self
                        .errors
                        .get_mut(index)
                        .and_then(Option::take)
                        .ok_or_else(|| anyhow::anyhow!("Invalid shared XMLTV decoder error"))?);
                }
                _ => anyhow::bail!("Invalid shared XMLTV action"),
            }
        }
        self.bytes = 0;
        self.errors.clear();
        Ok(())
    }
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
    MatchIndex::new(
        channels
            .iter()
            .map(|(id, c)| vec![id.clone(), c.name.clone()])
            .collect(),
    )
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
