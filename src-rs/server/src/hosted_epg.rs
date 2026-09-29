//! Restricted, fixed-public-source EPG service for hosted browser/TV clients.
//! It never accepts playlist URLs, XMLTV URLs, proxy destinations or credentials.
use axum::{
    extract::{
        rejection::{JsonRejection, QueryRejection},
        DefaultBodyLimit, Query, State,
    },
    http::{header, HeaderValue, StatusCode},
    middleware,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use ottplay_core::xmltv::{self, Channels, MatchIndex, Programs};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use std::{
    collections::HashSet,
    io::Read,
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::sync::{RwLock, Semaphore};

const SOURCE: &str = "epg-one";
const SOURCE_URL: &str = "https://cdn.epg.one/epg2.xml.gz";
const REFRESH_MS: u64 = 7_200_000;
const WIRE_LIMIT: usize = 96 * 1024 * 1024;
const XML_LIMIT: usize = 512 * 1024 * 1024;
const MAX_ROWS: usize = 20_000;
const MAX_ROW_BYTES: usize = 8 * 1024 * 1024;

struct Snapshot {
    channels: Channels,
    programs: Programs,
    index: MatchIndex,
    generation: String,
    fetched_at: u64,
}

impl Snapshot {
    fn from_xml(xml: &str, fetched_at: u64) -> anyhow::Result<Self> {
        let (channels, programs, aliases) = xmltv::parse_xmltv_hosted(xml)?;
        anyhow::ensure!(
            channels
                .keys()
                .any(|id| programs.get(id).is_some_and(|rows| !rows.is_empty())),
            "EPG_EMPTY"
        );
        let index = MatchIndex::web(aliases)?;
        // This process-local opaque revision names a complete immutable snapshot;
        // it is not an authentication token and survives no server restart.
        let nonce = SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos();
        Ok(Self {
            channels,
            programs,
            index,
            generation: format!("{fetched_at:x}-{nonce:x}"),
            fetched_at,
        })
    }

    fn metadata(&self, now: u64) -> Value {
        json!({"version":1,"source":SOURCE,"generation":self.generation,
            "fetchedAt":self.fetched_at,"refreshMs":REFRESH_MS,
            "stale":now.saturating_sub(self.fetched_at) >= REFRESH_MS})
    }

    fn matches(&self, channels: Vec<ChannelInput>, now: u64) -> anyhow::Result<Value> {
        let mut mappings = Map::new();
        for row in channels {
            if let Some(id) = self
                .index
                .resolve(&row.tvg_id, &[&row.tvg_name, &row.name])?
            {
                let shift = self.index.web_shift_seconds(&row.name)?;
                let logo = self
                    .channels
                    .get(&id)
                    .map(|c| c.icon.as_str())
                    .unwrap_or("");
                mappings.insert(row.id, json!({"channelId":id,"shift":shift,"logo":logo}));
            }
        }
        let mut result = self.metadata(now);
        result["mappings"] = Value::Object(mappings);
        Ok(result)
    }

    fn programmes(&self, input: ProgrammeInput, now: u64) -> Result<Value, ApiError> {
        if input.generation != self.generation {
            return Err(ApiError::Generation);
        }
        if !self.channels.contains_key(&input.channel_id) {
            return Err(ApiError::NotFound);
        }
        let clock = (now / 1000) as i64;
        let history = if input.hours > 0 { input.hours } else { 48 };
        let from = clock - history * 3600;
        let until = clock + 48 * 3600;
        let mut rows = Vec::new();
        let mut bytes = 0;
        for row in self.programs.get(&input.channel_id).into_iter().flatten() {
            let start = row.start + input.shift;
            let stop = row.stop + input.shift;
            if stop <= from || start >= until {
                continue;
            }
            // Match the browser's decoded UTF-16 record budget, not HTTP gzip size.
            bytes += 80 + 2 * (row.title.encode_utf16().count() + row.desc.encode_utf16().count());
            if rows.len() >= MAX_ROWS || bytes > MAX_ROW_BYTES {
                return Err(ApiError::Limit);
            }
            rows.push(
                json!({"time":start,"time_to":stop,"name":row.title,"descr":row.desc,"icon":""}),
            );
        }
        let mut result = self.metadata(now);
        result["rows"] = Value::Array(rows);
        Ok(result)
    }
}

struct GuideState {
    snapshot: RwLock<Option<Arc<Snapshot>>>,
    match_requests: Arc<Semaphore>,
    programme_requests: Arc<Semaphore>,
}

impl GuideState {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            snapshot: RwLock::new(None),
            // QuickJS serializes access to the shared index. Bound its queue
            // separately so matching new playlists cannot starve guide reads.
            match_requests: Arc::new(Semaphore::new(2)),
            programme_requests: Arc::new(Semaphore::new(4)),
        })
    }

    async fn publish(&self, fresh: Snapshot) {
        let old = self.snapshot.write().await.replace(Arc::new(fresh));
        // Hundreds of thousands of strings must not be freed on the async runtime.
        let _ = tokio::task::spawn_blocking(move || drop(old)).await;
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ChannelInput {
    id: String,
    tvg_id: String,
    tvg_name: String,
    name: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct MatchInput {
    version: u8,
    source: String,
    channels: Vec<ChannelInput>,
}

impl MatchInput {
    fn valid(&self) -> bool {
        let mut ids = HashSet::new();
        self.version == 1
            && self.source == SOURCE
            && self.channels.len() <= 2048
            && self.channels.iter().all(|c| {
                !c.id.is_empty()
                    && ids.insert(&c.id)
                    && [&c.id, &c.tvg_id, &c.tvg_name, &c.name]
                        .iter()
                        .all(|s| s.encode_utf16().count() <= 512)
            })
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProgrammeInput {
    channel_id: String,
    shift: i64,
    hours: i64,
    generation: String,
}

impl ProgrammeInput {
    fn valid(&self) -> bool {
        !self.channel_id.is_empty()
            && self.channel_id.encode_utf16().count() <= 512
            && (-86400..=86400).contains(&self.shift)
            && self.shift % 3600 == 0
            && (0..=8784).contains(&self.hours)
            && !self.generation.is_empty()
            && self.generation.len() <= 80
    }
}

enum ApiError {
    Invalid,
    Large,
    NotReady,
    NotFound,
    Generation,
    Busy,
    Limit,
    Internal,
}
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, code) = match self {
            Self::Invalid => (StatusCode::BAD_REQUEST, "EPG_REQUEST"),
            Self::Large => (StatusCode::PAYLOAD_TOO_LARGE, "EPG_REQUEST_LIMIT"),
            Self::NotReady => (StatusCode::SERVICE_UNAVAILABLE, "EPG_NOT_READY"),
            Self::NotFound => (StatusCode::NOT_FOUND, "EPG_CHANNEL"),
            Self::Generation => (StatusCode::CONFLICT, "EPG_GENERATION"),
            Self::Busy => (StatusCode::TOO_MANY_REQUESTS, "EPG_BUSY"),
            Self::Limit => (StatusCode::UNPROCESSABLE_ENTITY, "EPG_CHANNEL_LIMIT"),
            Self::Internal => (StatusCode::INTERNAL_SERVER_ERROR, "EPG_INTERNAL"),
        };
        let mut response = (
            status,
            Json(json!({"version":1,"source":SOURCE,"error":{"code":code}})),
        )
            .into_response();
        if matches!(
            status,
            StatusCode::SERVICE_UNAVAILABLE | StatusCode::TOO_MANY_REQUESTS
        ) {
            response
                .headers_mut()
                .insert(header::RETRY_AFTER, HeaderValue::from_static("5"));
        }
        response
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn router(state: Arc<GuideState>) -> Router {
    Router::new()
        .route("/health", get(|| async { "OK" }))
        .route("/epg/v1/health", get(readiness))
        .route("/epg/v1/match", post(match_channels))
        .route("/epg/v1/programmes", get(programmes))
        .fallback(|| async { ApiError::NotFound })
        .layer(DefaultBodyLimit::max(512 * 1024))
        .layer(middleware::map_response(
            |mut response: Response| async move {
                response
                    .headers_mut()
                    .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
                response.headers_mut().insert(
                    header::X_CONTENT_TYPE_OPTIONS,
                    HeaderValue::from_static("nosniff"),
                );
                response
            },
        ))
        .with_state(state)
}

async fn readiness(State(state): State<Arc<GuideState>>) -> Result<Json<Value>, ApiError> {
    let snapshot = state.snapshot.read().await;
    snapshot
        .as_ref()
        .map(|s| Json(s.metadata(now_ms())))
        .ok_or(ApiError::NotReady)
}

async fn match_channels(
    State(state): State<Arc<GuideState>>,
    body: Result<Json<MatchInput>, JsonRejection>,
) -> Result<Response, ApiError> {
    let input = body
        .map_err(|e| {
            if e.status() == StatusCode::PAYLOAD_TOO_LARGE {
                ApiError::Large
            } else {
                ApiError::Invalid
            }
        })?
        .0;
    if !input.valid() {
        return Err(ApiError::Invalid);
    }
    let permit = state
        .match_requests
        .clone()
        .try_acquire_owned()
        .map_err(|_| ApiError::Busy)?;
    let snapshot = state
        .snapshot
        .read()
        .await
        .clone()
        .ok_or(ApiError::NotReady)?;
    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        snapshot
            .matches(input.channels, now_ms())
            .map(|value| Json(value).into_response())
            .map_err(|_| ApiError::Internal)
    })
    .await
    .map_err(|_| ApiError::Internal)?
}

async fn programmes(
    State(state): State<Arc<GuideState>>,
    query: Result<Query<ProgrammeInput>, QueryRejection>,
) -> Result<Response, ApiError> {
    let input = query.map_err(|_| ApiError::Invalid)?.0;
    if !input.valid() {
        return Err(ApiError::Invalid);
    }
    let permit = state
        .programme_requests
        .clone()
        .try_acquire_owned()
        .map_err(|_| ApiError::Busy)?;
    let snapshot = state
        .snapshot
        .read()
        .await
        .clone()
        .ok_or(ApiError::NotReady)?;
    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        snapshot
            .programmes(input, now_ms())
            .map(|value| Json(value).into_response())
    })
    .await
    .map_err(|_| ApiError::Internal)?
}

async fn fetch_snapshot(client: &reqwest::Client) -> anyhow::Result<Snapshot> {
    let mut response = client.get(SOURCE_URL).send().await?.error_for_status()?;
    anyhow::ensure!(
        response
            .content_length()
            .is_none_or(|n| n <= WIRE_LIMIT as u64),
        "EPG_WIRE_LIMIT"
    );
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        anyhow::ensure!(bytes.len() + chunk.len() <= WIRE_LIMIT, "EPG_WIRE_LIMIT");
        bytes.extend_from_slice(&chunk);
    }
    let fresh = now_ms();
    tokio::task::spawn_blocking(move || {
        let mut raw = Vec::new();
        if bytes.starts_with(&[31, 139]) {
            flate2::read::GzDecoder::new(&bytes[..])
                .take((XML_LIMIT + 1) as u64)
                .read_to_end(&mut raw)?;
        } else {
            raw = bytes;
        }
        anyhow::ensure!(raw.len() <= XML_LIMIT, "EPG_XML_LIMIT");
        let xml = std::str::from_utf8(&raw)?;
        Snapshot::from_xml(xml, fresh)
    })
    .await?
}

pub fn enabled() -> anyhow::Result<bool> {
    match std::env::var("EPG_ONLY").ok().as_deref() {
        None | Some("false" | "0") => Ok(false),
        Some("true" | "1") => Ok(true),
        _ => anyhow::bail!("EPG_ONLY must be true or false"),
    }
}

pub fn start() -> anyhow::Result<Router> {
    if let Ok(source) = std::env::var("EPG_URLS") {
        anyhow::ensure!(
            source.trim() == SOURCE_URL,
            "EPG_ONLY supports only its configured public feed"
        );
    }
    let state = GuideState::new();
    let client = reqwest::Client::builder()
        .user_agent("OTT-play-FOSS/1.0")
        .connect_timeout(Duration::from_secs(30))
        .read_timeout(Duration::from_secs(60))
        .timeout(Duration::from_secs(600))
        // A moved public feed needs a reviewed configuration update, never a
        // redirect to an arbitrary destination or an internal address.
        .redirect(reqwest::redirect::Policy::none())
        .build()?;
    let refresh_state = state.clone();
    tokio::spawn(async move {
        let mut failures = 0u32;
        loop {
            match fetch_snapshot(&client).await {
                Ok(fresh) => {
                    refresh_state.publish(fresh).await;
                    failures = 0;
                }
                Err(_) => {
                    failures = failures.saturating_add(1u32);
                    tracing::warn!("Hosted EPG refresh failed; retaining accepted snapshot");
                }
            }
            let delay = ottplay_core::epg_refresh_interval(failures).unwrap_or(300);
            tokio::time::sleep(Duration::from_secs(delay)).await;
        }
    });
    Ok(router(state))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::{to_bytes, Body},
        http::Request,
    };
    use tower::ServiceExt;

    const XML: &str = r#"<tv><channel id="ren"><display-name>РЕН ТВ</display-name><display-name>REN TV</display-name><icon src="http://epg.one/ren.png"/></channel><channel id="other"><display-name>Другой</display-name></channel><channel id="amb1"><display-name>Shared Alias</display-name></channel><channel id="amb2"><display-name>Shared Alias</display-name></channel><programme channel="ren" start="20260929100000 +0300" stop="20260929110000 +0300"><title>Передача</title><desc>Описание</desc></programme></tv>"#;
    const NOW: u64 = 1_790_665_200_000; // 2026-09-29 07:00 UTC

    fn snapshot() -> Snapshot {
        Snapshot::from_xml(XML, NOW).unwrap()
    }
    fn channel(id: &str, tvg_id: &str, tvg_name: &str, name: &str) -> ChannelInput {
        ChannelInput {
            id: id.into(),
            tvg_id: tvg_id.into(),
            tvg_name: tvg_name.into(),
            name: name.into(),
        }
    }
    fn query(snapshot: &Snapshot, id: &str, shift: i64, hours: i64) -> ProgrammeInput {
        ProgrammeInput {
            channel_id: id.into(),
            shift,
            hours,
            generation: snapshot.generation.clone(),
        }
    }

    async fn request(app: Router, method: &str, path: &str, body: Value) -> (StatusCode, Value) {
        let response = app
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(path)
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
        assert_eq!(
            response.headers()[header::X_CONTENT_TYPE_OPTIONS],
            "nosniff"
        );
        let status = response.status();
        let bytes = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
        (status, serde_json::from_slice(&bytes).unwrap())
    }

    #[test]
    fn matching_preserves_id_name_priority_ambiguity_shift_and_metadata() {
        let s = snapshot();
        let result = s
            .matches(
                vec![
                    channel("id", "ren", "Другой", "Other +7"),
                    channel("tvg", "missing", "REN TV", "Другой"),
                    channel("name", "missing", "", "РЕН ТВ HD +3"),
                    channel("ambiguous", "", "Shared Alias", ""),
                    channel("exact", "amb2", "Shared Alias", ""),
                ],
                NOW,
            )
            .unwrap();
        assert_eq!(result["mappings"]["id"]["channelId"], "ren");
        assert_eq!(result["mappings"]["id"]["shift"], 25200);
        assert_eq!(result["mappings"]["tvg"]["channelId"], "ren");
        assert_eq!(result["mappings"]["name"]["channelId"], "ren");
        assert_eq!(result["mappings"]["name"]["shift"], 10800);
        assert_eq!(
            result["mappings"]["name"]["logo"],
            "https://cdn.epg.one/ren.png"
        );
        // The pinned web profile intentionally keeps the first display alias;
        // an exact XMLTV ID still wins over that ambiguous display name.
        assert_eq!(result["mappings"]["ambiguous"]["channelId"], "amb1");
        assert_eq!(result["mappings"]["exact"]["channelId"], "amb2");
        assert_eq!(result["fetchedAt"], NOW);
        assert_eq!(result["refreshMs"], REFRESH_MS);
        assert_eq!(result["stale"], false);
        assert_eq!(s.metadata(NOW + REFRESH_MS)["stale"], true);
    }

    #[test]
    fn programme_window_archive_timezone_and_shift_are_applied_once() {
        let mut s = snapshot();
        let zero = s.programmes(query(&s, "ren", 0, 0), NOW).ok().unwrap();
        assert_eq!(zero["rows"][0]["time"], NOW / 1000);
        assert_eq!(zero["rows"][0]["time_to"], NOW / 1000 + 3600);
        assert_eq!(zero["rows"][0]["icon"], "");
        let shifted = s.programmes(query(&s, "ren", 25200, 0), NOW).ok().unwrap();
        assert_eq!(shifted["rows"][0]["time"], NOW / 1000 + 25200);
        let clock = (NOW / 1000) as i64;
        let rows = s.programs.get_mut("ren").unwrap();
        rows.clear();
        for (name, start, stop) in [
            ("old", clock - 100 * 3600, clock - 99 * 3600),
            ("touch-from", clock - 49 * 3600, clock - 48 * 3600),
            ("overlap", clock - 48 * 3600 - 1, clock - 48 * 3600 + 1),
            ("future", clock + 48 * 3600 - 1, clock + 49 * 3600),
            ("touch-until", clock + 48 * 3600, clock + 49 * 3600),
        ] {
            rows.push(xmltv::Programme {
                start,
                stop,
                title: name.into(),
                ..Default::default()
            });
        }
        let default = s.programmes(query(&s, "ren", 0, 0), NOW).ok().unwrap();
        let names: Vec<_> = default["rows"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| r["name"].as_str().unwrap())
            .collect();
        assert_eq!(names, ["overlap", "future"]);
        let archive = s.programmes(query(&s, "ren", 0, 168), NOW).ok().unwrap();
        assert_eq!(archive["rows"].as_array().unwrap().len(), 4);
        assert!(
            s.programmes(query(&s, "other", 0, 168), NOW).ok().unwrap()["rows"]
                .as_array()
                .unwrap()
                .is_empty()
        );
        let mut old = query(&s, "ren", 0, 0);
        old.generation = "previous".into();
        assert!(matches!(s.programmes(old, NOW), Err(ApiError::Generation)));
        assert!(matches!(
            s.programmes(query(&s, "missing", 0, 0), NOW),
            Err(ApiError::NotFound)
        ));
    }

    #[tokio::test]
    async fn cold_errors_and_schema_are_bounded_and_never_cached() {
        let state = GuideState::new();
        let app = router(state.clone());
        let valid = json!({"version":1,"source":SOURCE,"channels":[]});
        for path in [
            "/epg/v1/health",
            "/epg/v1/programmes?channelId=ren&shift=0&hours=168&generation=test",
        ] {
            let (status, data) = request(app.clone(), "GET", path, Value::Null).await;
            assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
            assert_eq!(data["error"]["code"], "EPG_NOT_READY");
        }
        assert_eq!(
            request(app.clone(), "POST", "/epg/v1/match", valid.clone())
                .await
                .0,
            StatusCode::SERVICE_UNAVAILABLE
        );
        for bad in [
            json!({"version":1,"source":"https://private/","channels":[]}),
            json!({"version":1,"source":SOURCE,"channels":[],"url":"http://private/"}),
            json!({"version":1,"source":SOURCE,"channels":[{"id":"a","tvgId":"","tvgName":"","name":"","stream":"private"}]}),
            json!({"version":1,"source":SOURCE,"channels":[{"id":"a","tvgId":"","tvgName":"","name":""},{"id":"a","tvgId":"","tvgName":"","name":""}]}),
        ] {
            let (status, data) = request(app.clone(), "POST", "/epg/v1/match", bad).await;
            assert_eq!(status, StatusCode::BAD_REQUEST);
            assert!(!data.to_string().contains("private"));
        }
        for suffix in ["&url=http://private/", "&shift=1", "&hours=8785"] {
            let path = format!(
                "/epg/v1/programmes?channelId=ren&shift=0&hours=168&generation=test{suffix}"
            );
            assert_eq!(
                request(app.clone(), "GET", &path, Value::Null).await.0,
                StatusCode::BAD_REQUEST
            );
        }
        for path in ["/proxy", "/api/epg/channels", "/", "/control"] {
            assert_eq!(
                request(app.clone(), "GET", path, Value::Null).await.0,
                StatusCode::NOT_FOUND
            );
        }
        let oversized =
            json!({"version":1,"source":SOURCE,"channels":[],"padding":"x".repeat(524288)});
        assert_eq!(
            request(app, "POST", "/epg/v1/match", oversized).await.0,
            StatusCode::PAYLOAD_TOO_LARGE
        );
    }

    #[tokio::test]
    async fn refresh_keeps_good_snapshot_and_generations_are_coherent() {
        let state = GuideState::new();
        let first = snapshot();
        let generation = first.generation.clone();
        state.publish(first).await;
        assert!(Snapshot::from_xml("<tv><channel id='x'/>", NOW + 1).is_err());
        assert!(Snapshot::from_xml(r#"<tv><channel id="a"/><programme channel="b" start="20260929090000 +0000" stop="20260929100000 +0000"/></tv>"#, NOW+1).is_err());
        assert_eq!(
            state.snapshot.read().await.as_ref().unwrap().generation,
            generation
        );
        let app = router(state.clone());
        let (status, matched) = request(app.clone(), "POST", "/epg/v1/match", json!({"version":1,"source":SOURCE,"channels":[{"id":"c","tvgId":"ren","tvgName":"","name":"РЕН ТВ"}]})).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(matched["generation"], generation);
        assert_eq!(matched["mappings"]["c"]["channelId"], "ren");
        state
            .publish(Snapshot::from_xml(XML, NOW + 1).unwrap())
            .await;
        let path =
            format!("/epg/v1/programmes?channelId=ren&shift=0&hours=168&generation={generation}");
        assert_eq!(
            request(app.clone(), "GET", &path, Value::Null).await.0,
            StatusCode::CONFLICT
        );
        let permit = state
            .match_requests
            .clone()
            .acquire_many_owned(2)
            .await
            .unwrap();
        assert_eq!(
            request(
                app.clone(),
                "POST",
                "/epg/v1/match",
                json!({"version":1,"source":SOURCE,"channels":[]})
            )
            .await
            .0,
            StatusCode::TOO_MANY_REQUESTS
        );
        let current = state
            .snapshot
            .read()
            .await
            .as_ref()
            .unwrap()
            .generation
            .clone();
        let current_path =
            format!("/epg/v1/programmes?channelId=ren&shift=0&hours=168&generation={current}");
        // Match admission remains saturated. Guide requests have independent
        // capacity and never need the shared matcher context's lock.
        assert_eq!(
            request(app.clone(), "GET", &current_path, Value::Null)
                .await
                .0,
            StatusCode::OK
        );
        let guide_permits = state
            .programme_requests
            .clone()
            .acquire_many_owned(4)
            .await
            .unwrap();
        assert_eq!(
            request(app.clone(), "GET", &current_path, Value::Null)
                .await
                .0,
            StatusCode::TOO_MANY_REQUESTS
        );
        assert_eq!(
            request(app, "GET", "/epg/v1/health", Value::Null).await.0,
            StatusCode::OK
        );
        drop(guide_permits);
        drop(permit);
    }

    #[test]
    fn response_budgets_fail_instead_of_returning_partial_archive() {
        let mut s = snapshot();
        let row = s.programs["ren"][0].clone();
        s.programs
            .insert("ren".into(), vec![row.clone(); MAX_ROWS + 1]);
        assert!(matches!(
            s.programmes(query(&s, "ren", 0, 0), NOW),
            Err(ApiError::Limit)
        ));
        s.programs.insert(
            "ren".into(),
            vec![xmltv::Programme {
                title: "😀".repeat(MAX_ROW_BYTES / 4),
                ..row
            }],
        );
        assert!(matches!(
            s.programmes(query(&s, "ren", 0, 0), NOW),
            Err(ApiError::Limit)
        ));
    }

    /// Offline qualification only: no fetches, credentials or synthetic timing
    /// assertions. Feed and reference clock are supplied explicitly by the runner.
    #[test]
    #[ignore = "requires a retained public XMLTV gzip and output directory"]
    fn hosted_retained_feed_qualification() {
        let path = std::env::var("OTTPLAY_EPG_TEST_GZIP").expect("public fixture path");
        let output = std::env::var("OTTPLAY_EPG_TEST_OUTPUT").expect("output directory");
        let now: u64 = std::env::var("OTTPLAY_EPG_TEST_NOW")
            .expect("reference epoch seconds")
            .parse::<u64>()
            .unwrap()
            * 1000;
        let started = std::time::Instant::now();
        let mut xml = String::new();
        flate2::read::GzDecoder::new(std::fs::File::open(path).unwrap())
            .read_to_string(&mut xml)
            .unwrap();
        let decoded_ms = started.elapsed().as_millis();
        let snapshot = Snapshot::from_xml(&xml, now).unwrap();
        let ready_ms = started.elapsed().as_millis();
        let matches = snapshot
            .matches(
                vec![
                    channel("ren", "hlsproxy-382", "", "РЕН ТВ HD"),
                    channel("plus7", "18", "", "РЕН ТВ +7"),
                ],
                now,
            )
            .unwrap();
        assert_eq!(matches["mappings"]["ren"]["channelId"], "18");
        assert_eq!(matches["mappings"]["plus7"]["shift"], 25200);
        let mut cases = Map::new();
        for (label, shift, hours) in [
            ("ren48", 0, 48),
            ("ren168", 0, 168),
            ("ren336", 0, 336),
            ("renPlus7", 25200, 48),
            ("renMinus3", -10800, 48),
        ] {
            let result = snapshot
                .programmes(query(&snapshot, "18", shift, hours), now)
                .ok()
                .unwrap();
            cases.insert(label.into(), result["rows"].clone());
        }
        let mut report = json!({"referenceEpoch":now/1000,"decodeMs":decoded_ms,"readyMs":ready_ms,"xmlBytes":xml.len(),
            "channels":snapshot.channels.len(),"programmes":snapshot.programs.values().map(Vec::len).sum::<usize>(),
            "matchAndQueryMs":started.elapsed().as_millis()-ready_ms,"cases":cases});
        if std::env::var("OTTPLAY_EPG_TEST_REFRESH").as_deref() == Ok("1") {
            let refresh_started = std::time::Instant::now();
            let replacement = Snapshot::from_xml(&xml, now + 1).unwrap();
            assert_ne!(replacement.generation, snapshot.generation);
            assert_eq!(
                replacement.programs["18"].len(),
                snapshot.programs["18"].len()
            );
            assert!(matches!(
                replacement.programmes(query(&snapshot, "18", 0, 48), now),
                Err(ApiError::Generation)
            ));
            report["refreshMsWithOldSnapshotHeld"] = json!(refresh_started.elapsed().as_millis());
            // Both snapshots remain alive through the comparison to exercise
            // the actual refresh peak, not just cold-start allocation.
            drop(replacement);
        }
        std::fs::write(
            std::path::Path::new(&output).join("server-feed-qualification.json"),
            serde_json::to_vec(&report).unwrap(),
        )
        .unwrap();
        println!(
            "hosted feed qualification: channels={} programmes={} ready={}ms match+queries={}ms",
            report["channels"], report["programmes"], ready_ms, report["matchAndQueryMs"]
        );
    }
}
