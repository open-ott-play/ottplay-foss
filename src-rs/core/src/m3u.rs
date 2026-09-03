//! M3U channel matching + logo lookup + stream proxy.
use std::collections::HashMap;

use reqwest::Client;
use serde::{Deserialize, Serialize};

use super::xmltv::{self, Channels};

/// Input: array of {id, name, logo, url} from frontend
#[derive(Debug, Deserialize)]
pub struct M3uChannel {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub logo: String,
    #[serde(default)]
    pub url: String,
}

#[derive(Debug, Serialize)]
pub struct MatchResult {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub epg_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub epg_name: Option<String>,
    pub score: f32,
}

/// POST /m3u/match-channels
/// Match each channel name → XMLTV, register epg_hash → xmltv_id in epg_to_xmltv.
pub fn match_channels(
    channels: Vec<M3uChannel>,
    xmltv_ch: &Channels,
    epg_to_xmltv: &mut HashMap<String, String>,
    time_shift_by_epg: &mut HashMap<String, i64>,
) -> Vec<MatchResult> {
    channels
        .into_iter()
        .map(|ch| {
            if xmltv_ch.is_empty() {
                return MatchResult {
                    id: ch.id,
                    epg_id: None,
                    epg_name: None,
                    score: 0.0,
                };
            }
            let time_shift = xmltv::extract_time_shift(&ch.name);
            let base_name = xmltv::strip_time_shift(&ch.name);
            match xmltv::match_channel(&base_name, xmltv_ch) {
                Some((xmltv_id, score)) => {
                    let epg_hash =
                        compute_epg_hash(&format!("{xmltv_id}|{time_shift}"));
                    epg_to_xmltv.insert(epg_hash.clone(), xmltv_id.clone());
                    if time_shift != 0 {
                        time_shift_by_epg.insert(epg_hash.clone(), time_shift);
                    }
                    let epg_name = xmltv_ch.get(&xmltv_id).map(|c| c.name.clone());
                    MatchResult {
                        id: ch.id,
                        epg_id: Some(epg_hash),
                        epg_name,
                        score,
                    }
                }
                None => MatchResult {
                    id: ch.id,
                    epg_id: None,
                    epg_name: None,
                    score: 0.0,
                },
            }
        })
        .collect()
}

#[derive(Debug, Deserialize)]
pub struct LogoChannel {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Serialize)]
pub struct LogoResult {
    pub id: String,
    pub logo_url: String,
}

/// POST /m3u/match-logos
pub fn match_logos(
    channels: Vec<LogoChannel>,
    xmltv_ch: &Channels,
) -> Vec<LogoResult> {
    channels
        .into_iter()
        .map(|ch| {
            let logo_url = if xmltv_ch.is_empty() {
                format!(
                    "/logo/{}.svg?ch={}",
                    ch.id,
                    urlencoding::encode(&ch.name)
                )
            } else {
                let base_name = xmltv::strip_time_shift(&ch.name);
                match xmltv::match_channel(&base_name, xmltv_ch) {
                    Some((xmltv_id, _score)) => {
                        xmltv_ch
                            .get(&xmltv_id)
                            .and_then(|c| {
                                if c.icon.is_empty() {
                                    None
                                } else {
                                    Some(c.icon.clone())
                                }
                            })
                            .unwrap_or_else(|| {
                                format!(
                                    "/logo/{}.svg?ch={}",
                                    ch.id,
                                    urlencoding::encode(&ch.name)
                                )
                            })
                    }
                    None => format!(
                        "/logo/{}.svg?ch={}",
                        ch.id,
                        urlencoding::encode(&ch.name)
                    ),
                }
            };
            LogoResult { id: ch.id, logo_url }
        })
        .collect()
}

#[derive(Debug, Deserialize)]
pub struct ProxyParams {
    pub url: String,
    #[serde(default)]
    pub ua: String,
}

/// UA presets mirrored from server.py
const UA_PRESETS: &[(&str, &str)] = &[
    ("webos", "Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/68.0.3440.106 Safari/537.36 LG Browser/9.00.00"),
    ("tizen", "Mozilla/5.0 (SMART-TV; Linux; Tizen 5.5) AppleWebKit/537.36 (KHTML, like Gecko) SamsungTV/3.0 Chrome/76.0.3809.146 Safari/537.36"),
    ("viera", "Mozilla/5.0 (Unknown; Linux; Viera/1.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/68.0.3440.106 Safari/537.36"),
    ("mag", "Mozilla/5.0 (STB; Infomir MAG524) Maple 6.0 QtWebKit/3.0"),
    ("dune", "Mozilla/5.0 (Dune HD; DuneOS) AppleWebKit/537.36 (KHTML, like Gecko) DuneHD/1.0 Chrome/68.0.3440.106 Safari/537.36"),
];

/// POST /m3u/cp.php — proxy a stream with injected UA.
pub async fn proxy_stream(
    params: ProxyParams,
) -> Result<(reqwest::header::HeaderMap, Vec<u8>), String> {
    let mut url = params.url;
    if url.starts_with('@') {
        url = url[1..].to_string();
    }
    if url.is_empty() {
        return Err("No URL provided".into());
    }

    let ua = if params.ua.is_empty() {
        "OTT-play-FOSS/1.0".to_string()
    } else {
        UA_PRESETS
            .iter()
            .find(|(k, _)| k == &params.ua.as_str())
            .map(|(_, v)| v.to_string())
            .unwrap_or_else(|| params.ua.clone())
    };

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get(&url)
        .header("User-Agent", &ua)
        .send()
        .await
        .map_err(|e| format!("{e}"))?;

    let status = resp.status();
    let headers: reqwest::header::HeaderMap = resp.headers().clone();
    let body = resp
        .bytes()
        .await
        .map_err(|e| format!("{e}"))?
        .to_vec();

    if !status.is_success() {
        return Err(format!("Upstream {status}"));
    }

    Ok((headers, body))
}

/// Deterministic hash for EPG URL — mirrors server.py compute_epg_hash.
pub fn compute_epg_hash(identifier: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut h = DefaultHasher::new();
    identifier.hash(&mut h);
    format!("{:016x}", h.finish() & 0xFFFFFFFFFFFF)
}
