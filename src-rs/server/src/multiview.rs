//! Fixture-only adapter; never registered by the main server router.
//!
//! Geometry and successful synthetic renders are not production decoder grants.
//! In particular the finite-file worker cannot preserve independent live inputs
//! across a source replacement and must not advertise that operation.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Capability {
    pub geometry_slots: u8,
    pub native_concurrent_video_capacity: Option<u8>,
    pub admitted_composite_inputs: u8,
    pub independent_source_replacement: bool,
    pub reason: &'static str,
}

/// There is no production source broker or persistent compositor in this module.
pub const fn capability() -> Capability {
    Capability {
        geometry_slots: 9,
        native_concurrent_video_capacity: None,
        admitted_composite_inputs: 0,
        independent_source_replacement: false,
        reason: "backend_unqualified",
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AdmissionError {
    Unsupported,
    InvalidSlot,
    StaleRuntime,
    StaleLayout,
    StaleSource,
    StaleFocus,
    StaleAudio,
}

/// Proposed revision dimensions, not a serialized or frozen wire-v1 contract.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Revision {
    pub runtime: u64,
    pub layout: u64,
    pub source: u64,
    pub focus: u64,
    pub audio: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SlotContext {
    pub slot: u8,
    pub revision: Revision,
}

/// Ordinary commands must carry the slot and context captured when issued.
/// Permission and source-ticket validation are additional owner checks; this
/// comparison deliberately does not return a reusable authorization grant.
pub fn check_captured_context(
    captured: SlotContext,
    current: SlotContext,
) -> Result<(), AdmissionError> {
    if captured.slot > 8 || current.slot > 8 || captured.slot != current.slot {
        return Err(AdmissionError::InvalidSlot);
    }
    let old = captured.revision;
    let now = current.revision;
    if old.runtime != now.runtime {
        return Err(AdmissionError::StaleRuntime);
    }
    if old.layout != now.layout {
        return Err(AdmissionError::StaleLayout);
    }
    if old.source != now.source {
        return Err(AdmissionError::StaleSource);
    }
    if old.focus != now.focus {
        return Err(AdmissionError::StaleFocus);
    }
    if old.audio != now.audio {
        return Err(AdmissionError::StaleAudio);
    }
    Ok(())
}

/// Fail closed even after geometry planning or a successful finite-file fixture.
pub const fn admit_production_scene() -> Result<(), AdmissionError> {
    Err(AdmissionError::Unsupported)
}

// This intentionally private fixture router is not a production capability or
// a provider broker. Its catalog is fixed by its in-process fixture owner.
use axum::{
    body::{Body, Bytes},
    extract::{DefaultBodyLimit, Path as HttpPath, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Router,
};
use ottplay_core::multiview::{
    decoder::GrantedFile,
    geometry::{CanvasSpec, ImportedRect, OverlapPolicy, ValidatedGeometry},
    persistent::{self, AudioPolicy, Session},
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tokio::{
    io::AsyncReadExt,
    sync::{OwnedSemaphorePermit, Semaphore},
};
use uuid::Uuid;

pub struct FixtureSource {
    pub source_id: String,
    pub root: PathBuf,
    pub relative: PathBuf,
}
pub struct FixtureConfig {
    pub bearer: String,
    pub origin: String,
    pub session_config: persistent::Config,
    pub sources: Vec<FixtureSource>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct FullExpected {
    pub runtime: u64,
    pub scene: String,
    pub geometry_revision: u64,
    pub focus_revision: u64,
    pub audio_revision: u64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WireCanvas {
    width: u32,
    height: u32,
    fps: u32,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WireRect {
    slot_id: u8,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
    z: u8,
}
#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum WireOverlap {
    Disjoint,
    Pip,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WireGeometry {
    canvas: WireCanvas,
    revision: u64,
    rects: Vec<WireRect>,
    overlap: WireOverlap,
}
impl WireGeometry {
    fn validate(self) -> Result<ValidatedGeometry, Reply> {
        let canvas = CanvasSpec {
            width: self.canvas.width,
            height: self.canvas.height,
            fps: self.canvas.fps,
        };
        let rects = self
            .rects
            .into_iter()
            .map(|r| ImportedRect {
                slot_id: r.slot_id,
                x: r.x,
                y: r.y,
                width: r.width,
                height: r.height,
                z: r.z,
            })
            .collect::<Vec<_>>();
        ValidatedGeometry::new(
            canvas,
            self.revision,
            &rects,
            match self.overlap {
                WireOverlap::Disjoint => OverlapPolicy::Disjoint,
                WireOverlap::Pip => OverlapPolicy::Pip,
            },
        )
        .map_err(|_| Reply::error(StatusCode::BAD_REQUEST, "invalid_geometry"))
    }
}
#[derive(Deserialize)]
#[serde(tag = "mode", rename_all = "snake_case", deny_unknown_fields)]
enum WireAudio {
    FollowsFocus,
    Muted,
    Slot { slot: u8 },
}
#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
enum ControlRequest {
    Create {
        geometry: WireGeometry,
        lease_secs: u64,
    },
    Status {
        #[serde(default)]
        expected: Option<FullExpected>,
    },
    Sources {
        expected: FullExpected,
        slot: u8,
        source_rev: u64,
    },
    Play {
        expected: FullExpected,
        slot: u8,
        source_rev: u64,
        ticket: String,
    },
    Focus {
        expected: FullExpected,
        slot: u8,
    },
    Audio {
        expected: FullExpected,
        policy: WireAudio,
    },
    Layout {
        expected: FullExpected,
        geometry: WireGeometry,
    },
    Stop {
        expected: FullExpected,
        slot: u8,
        source_rev: u64,
    },
    Off {
        expected: FullExpected,
    },
}
impl ControlRequest {
    fn mutation(&self) -> bool {
        !matches!(self, Self::Status { .. })
    }
}

struct CatalogSource {
    id: String,
    // Constructor-owned fixture factory only; never accepted over HTTP.
    root: PathBuf,
    relative: PathBuf,
}
struct Ticket {
    owner: String,
    context: FullExpected,
    slot: u8,
    source_revision: u64,
    source_id: String,
    expires: Instant,
}
struct Active {
    session: Session,
    scene: String,
    media_lease: String,
    expires: Instant,
    visible_slots: usize,
    geometry: Value,
}
impl Active {
    fn context(&self) -> FullExpected {
        let snapshot = self.session.snapshot();
        FullExpected {
            runtime: snapshot.runtime,
            scene: self.scene.clone(),
            geometry_revision: snapshot.geometry_revision,
            focus_revision: snapshot.focus_revision,
            audio_revision: snapshot.audio_revision,
        }
    }
}
#[derive(Clone)]
struct Reply {
    status: StatusCode,
    body: Vec<u8>,
}
impl Reply {
    fn json(status: StatusCode, value: Value) -> Self {
        Self {
            status,
            body: serde_json::to_vec(&value)
                .unwrap_or_else(|_| b"{\"error\":\"internal\"}".to_vec()),
        }
    }
    fn error(status: StatusCode, code: &'static str) -> Self {
        Self::json(status, json!({"error":code,"fixture_only":true}))
    }
    fn response(self) -> Response {
        (
            self.status,
            [
                ("content-type", "application/json"),
                ("cache-control", "no-store"),
            ],
            self.body,
        )
            .into_response()
    }
}
struct Cached {
    id: String,
    request: Vec<u8>,
    response: Reply,
    expires: Instant,
}
#[derive(Default)]
struct Control {
    active: Option<Active>,
    tickets: HashMap<String, Ticket>,
    cache: VecDeque<Cached>,
}
#[derive(Clone)]
struct MediaLease {
    expires: Instant,
    revoked: Arc<AtomicBool>,
    directory: PathBuf,
}
struct Media {
    leases: Mutex<HashMap<String, MediaLease>>,
    permits: Arc<Semaphore>,
}
struct Fixture {
    bearer: String,
    origin: String,
    owner: String,
    config: persistent::Config,
    catalog: Vec<CatalogSource>,
    valid: bool,
    control: Mutex<Control>,
    media: Arc<Media>,
}
fn locked<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poison| poison.into_inner())
}
impl Fixture {
    fn authenticated(&self, headers: &HeaderMap) -> bool {
        if !self.valid
            || headers.get_all("authorization").iter().count() != 1
            || headers.get_all("origin").iter().count() != 1
        {
            return false;
        }
        let Some(origin) = headers.get("origin").and_then(|value| value.to_str().ok()) else {
            return false;
        };
        let Some(token) = headers
            .get("authorization")
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.strip_prefix("Bearer "))
        else {
            return false;
        };
        let mut difference = token.len() ^ self.bearer.len();
        for (actual, expected) in token.bytes().zip(self.bearer.bytes()) {
            difference |= usize::from(actual ^ expected);
        }
        difference == 0 && origin == self.origin
    }
    fn close(&self, control: &mut Control) -> Result<(), Reply> {
        if let Some(mut active) = control.active.take() {
            if let Some(lease) = locked(&self.media.leases).remove(&active.media_lease) {
                lease.revoked.store(true, Ordering::Release);
            }
            control.tickets.clear();
            active
                .session
                .shutdown()
                .map_err(|_| Reply::error(StatusCode::SERVICE_UNAVAILABLE, "shutdown_failed"))?;
        }
        Ok(())
    }
    fn expire(&self, control: &mut Control) {
        let now = Instant::now();
        control.tickets.retain(|_, ticket| ticket.expires > now);
        if control
            .active
            .as_ref()
            .is_some_and(|active| active.expires <= now)
        {
            let _ = self.close(control);
        }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let control = self
            .control
            .get_mut()
            .unwrap_or_else(|poison| poison.into_inner());
        for lease in locked(&self.media.leases).values() {
            lease.revoked.store(true, Ordering::Release);
        }
        if let Some(mut active) = control.active.take() {
            let _ = active.session.shutdown();
        }
    }
}

/// Opt-in fixture custody only. This does not modify the executable's router.
/// Invalid constructor configuration fails closed on every request.
pub fn fixture_router(config: FixtureConfig) -> Router {
    let FixtureConfig {
        bearer,
        origin,
        session_config,
        sources,
    } = config;
    let mut valid = (32..=256).contains(&bearer.len())
        && bearer.bytes().all(|byte| byte.is_ascii_graphic())
        && !origin.is_empty()
        && origin.len() <= 2048
        && origin != "*"
        && origin.bytes().all(|byte| byte.is_ascii_graphic())
        && sources.len() <= 128;
    let mut catalog = Vec::new();
    let mut ids = HashSet::new();
    for source in sources.into_iter().take(128) {
        if source.source_id.is_empty()
            || source.source_id.len() > 64
            || !source
                .source_id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-' | b'.'))
            || !ids.insert(source.source_id.clone())
        {
            valid = false;
            continue;
        }
        match GrantedFile::from_root(&source.root, &source.relative) {
            Ok(_) => catalog.push(CatalogSource {
                id: source.source_id,
                root: source.root,
                relative: source.relative,
            }),
            Err(_) => valid = false,
        }
    }
    let state = Arc::new(Fixture {
        bearer,
        origin,
        owner: Uuid::new_v4().to_string(),
        config: session_config,
        catalog,
        valid,
        control: Mutex::new(Control::default()),
        media: Arc::new(Media {
            leases: Mutex::new(HashMap::new()),
            permits: Arc::new(Semaphore::new(8)),
        }),
    });
    Router::new()
        .route("/control", post(control_http))
        .route("/media/:lease/:file", get(media_http))
        .layer(DefaultBodyLimit::max(16 * 1024))
        .fallback(|| async { Reply::error(StatusCode::NOT_FOUND, "not_found").response() })
        .method_not_allowed_fallback(|| async {
            Reply::error(StatusCode::METHOD_NOT_ALLOWED, "method_not_allowed").response()
        })
        .with_state(state)
}

async fn control_http(
    State(fixture): State<Arc<Fixture>>,
    headers: HeaderMap,
    body: Result<Bytes, axum::extract::rejection::BytesRejection>,
) -> Response {
    if !fixture.authenticated(&headers) {
        return Reply::error(StatusCode::UNAUTHORIZED, "unauthorized").response();
    }
    let body = match body {
        Ok(body) => body,
        Err(_) => return Reply::error(StatusCode::PAYLOAD_TOO_LARGE, "body_limit").response(),
    };
    let request = match serde_json::from_slice::<ControlRequest>(&body) {
        Ok(request) => request,
        Err(_) => return Reply::error(StatusCode::BAD_REQUEST, "invalid_request").response(),
    };
    let request_id = if request.mutation() {
        if headers.get_all("x-request-id").iter().count() != 1 {
            return Reply::error(StatusCode::BAD_REQUEST, "request_id_required").response();
        }
        match headers
            .get("x-request-id")
            .and_then(|value| value.to_str().ok())
        {
            Some(id)
                if !id.is_empty() && id.len() <= 64 && id.bytes().all(|b| b.is_ascii_graphic()) =>
            {
                Some(id.to_string())
            }
            _ => return Reply::error(StatusCode::BAD_REQUEST, "invalid_request_id").response(),
        }
    } else {
        None
    };
    match tokio::task::spawn_blocking(move || {
        let mut control = locked(&fixture.control);
        let now = Instant::now();
        control.cache.retain(|entry| entry.expires > now);
        if let Some(id) = &request_id {
            if let Some(entry) = control.cache.iter().find(|entry| &entry.id == id) {
                return if entry.request == body.as_ref() {
                    entry.response.clone()
                } else {
                    Reply::error(StatusCode::CONFLICT, "request_id_conflict")
                };
            }
        }
        fixture.expire(&mut control);
        let response = execute(&fixture, &mut control, request).unwrap_or_else(|error| error);
        if let Some(id) = request_id {
            let size = body.len() + response.body.len();
            while !control.cache.is_empty()
                && (control.cache.len() >= 64
                    || control
                        .cache
                        .iter()
                        .map(|entry| entry.request.len() + entry.response.body.len())
                        .sum::<usize>()
                        + size
                        > 256 * 1024)
            {
                control.cache.pop_front();
            }
            if size <= 256 * 1024 {
                control.cache.push_back(Cached {
                    id,
                    request: body.to_vec(),
                    response: response.clone(),
                    expires: Instant::now() + Duration::from_secs(120),
                });
            }
        }
        response
    })
    .await
    {
        Ok(response) => response.response(),
        Err(_) => Reply::error(StatusCode::INTERNAL_SERVER_ERROR, "internal").response(),
    }
}

fn check_expected(control: &Control, expected: &FullExpected) -> Result<(), Reply> {
    let active = control
        .active
        .as_ref()
        .ok_or_else(|| Reply::error(StatusCode::CONFLICT, "no_scene"))?;
    if active.context() != *expected {
        return Err(Reply::error(StatusCode::CONFLICT, "stale_context"));
    }
    Ok(())
}
fn check_source(active: &Active, slot: u8, revision: u64) -> Result<(), Reply> {
    if usize::from(slot) >= active.visible_slots {
        return Err(Reply::error(StatusCode::BAD_REQUEST, "invalid_slot"));
    }
    let snapshot = active.session.snapshot();
    if usize::from(slot) >= snapshot.slots.len()
        || !snapshot
            .slots
            .iter()
            .any(|row| row.slot_id == slot && row.source_revision == revision)
    {
        return Err(Reply::error(StatusCode::CONFLICT, "stale_source"));
    }
    Ok(())
}
fn accepted(active: &Active) -> Reply {
    Reply::json(
        StatusCode::OK,
        json!({"accepted":true,"fixture_only":true,"context":active.context()}),
    )
}
fn geometry_receipt(geometry: &ValidatedGeometry) -> Value {
    let canvas = geometry.canvas();
    let rects=geometry.rects().iter().map(|r|json!({"slot_id":r.slot_id,"x":r.x,"y":r.y,"width":r.width,"height":r.height,"z":r.z})).collect::<Vec<_>>();
    json!({"canvas":{"width":canvas.width,"height":canvas.height,"fps":canvas.fps},"revision":geometry.revision(),"rects":rects})
}
fn session_error(error: persistent::Error) -> Reply {
    use persistent::Error as E;
    let (status, code) = match error {
        E::InvalidConfig | E::InvalidSlot => (StatusCode::BAD_REQUEST, "invalid_request"),
        E::StaleRevision => (StatusCode::CONFLICT, "stale_context"),
        E::CapacityExceeded => (StatusCode::TOO_MANY_REQUESTS, "capacity"),
        E::NoAudio => (StatusCode::CONFLICT, "no_audio"),
        E::Stopped => (StatusCode::CONFLICT, "stopped"),
        E::SourceFailed => (StatusCode::UNPROCESSABLE_ENTITY, "source_failed"),
        E::OutputFailed => (StatusCode::SERVICE_UNAVAILABLE, "output_failed"),
    };
    Reply::error(status, code)
}
fn execute(
    fixture: &Fixture,
    control: &mut Control,
    request: ControlRequest,
) -> Result<Reply, Reply> {
    match request {
        ControlRequest::Create {
            geometry,
            lease_secs,
        } => {
            if control.active.is_some() {
                return Err(Reply::error(StatusCode::CONFLICT, "scene_exists"));
            }
            if lease_secs == 0 || lease_secs > 60 {
                return Err(Reply::error(StatusCode::BAD_REQUEST, "invalid_lease"));
            }
            let geometry = geometry.validate()?;
            let visible_slots = geometry.rects().len();
            let receipt = geometry_receipt(&geometry);
            let expires = Instant::now() + Duration::from_secs(lease_secs);
            let mut config = fixture.config.clone();
            config.max_duration = config.max_duration.min(Duration::from_secs(lease_secs));
            let session = Session::start(config, geometry).map_err(session_error)?;
            let media_lease = Uuid::new_v4().to_string();
            locked(&fixture.media.leases).insert(
                media_lease.clone(),
                MediaLease {
                    expires,
                    revoked: Arc::new(AtomicBool::new(false)),
                    directory: session.output_directory().to_path_buf(),
                },
            );
            control.active = Some(Active {
                session,
                scene: Uuid::new_v4().to_string(),
                media_lease: media_lease.clone(),
                expires,
                visible_slots,
                geometry: receipt,
            });
            let active = control.active.as_ref().unwrap();
            Ok(Reply::json(
                StatusCode::OK,
                json!({"accepted":true,"fixture_only":true,"context":active.context(),"geometry":active.geometry,"lease_id":media_lease,"public_capabilities":{"admitted_composite_inputs":0}}),
            ))
        }
        ControlRequest::Status { expected } => {
            if let Some(expected) = expected {
                check_expected(control, &expected)?;
            }
            let Some(active) = control.active.as_ref() else {
                return Ok(Reply::json(
                    StatusCode::OK,
                    json!({"fixture_only":true,"state":"off","public_capabilities":{"admitted_composite_inputs":0}}),
                ));
            };
            let snapshot = active.session.snapshot();
            let slots=snapshot.slots.iter().map(|row|json!({"slot":row.slot_id,"source_rev":row.source_revision,"frames":row.frames,"state":format!("{:?}",row.state).to_lowercase()})).collect::<Vec<_>>();
            Ok(Reply::json(
                StatusCode::OK,
                json!({"fixture_only":true,"context":active.context(),"geometry":active.geometry,"focus_slot":snapshot.focus_slot,"audio_slot":snapshot.audio_slot,"output_frames":snapshot.output_frames,"output_state":format!("{:?}",snapshot.output_state).to_lowercase(),"slots":slots,"public_capabilities":{"admitted_composite_inputs":0}}),
            ))
        }
        ControlRequest::Sources {
            expected,
            slot,
            source_rev,
        } => {
            check_expected(control, &expected)?;
            let active = control.active.as_ref().unwrap();
            check_source(active, slot, source_rev)?;
            let expires = active.expires.min(Instant::now() + Duration::from_secs(15));
            if control
                .tickets
                .values()
                .filter(|ticket| ticket.slot != slot)
                .count()
                + fixture.catalog.len()
                > 128
            {
                return Err(Reply::error(
                    StatusCode::TOO_MANY_REQUESTS,
                    "ticket_capacity",
                ));
            }
            control.tickets.retain(|_, ticket| ticket.slot != slot);
            let mut sources = Vec::new();
            for source in &fixture.catalog {
                let id = Uuid::new_v4().to_string();
                control.tickets.insert(
                    id.clone(),
                    Ticket {
                        owner: fixture.owner.clone(),
                        context: expected.clone(),
                        slot,
                        source_revision: source_rev,
                        source_id: source.id.clone(),
                        expires,
                    },
                );
                sources.push(json!({"source_id":source.id,"ticket":id}));
            }
            Ok(Reply::json(
                StatusCode::OK,
                json!({"fixture_only":true,"sources":sources}),
            ))
        }
        ControlRequest::Play {
            expected,
            slot,
            source_rev,
            ticket,
        } => {
            check_expected(control, &expected)?;
            check_source(control.active.as_ref().unwrap(), slot, source_rev)?;
            let grant = control
                .tickets
                .get(&ticket)
                .ok_or_else(|| Reply::error(StatusCode::CONFLICT, "invalid_ticket"))?;
            if grant.owner != fixture.owner
                || grant.context != expected
                || grant.slot != slot
                || grant.source_revision != source_rev
                || grant.expires <= Instant::now()
            {
                return Err(Reply::error(StatusCode::CONFLICT, "invalid_ticket"));
            }
            let source = fixture
                .catalog
                .iter()
                .find(|source| source.id == grant.source_id)
                .ok_or_else(|| Reply::error(StatusCode::CONFLICT, "invalid_ticket"))?;
            // A fresh descriptor capability is minted for this distinct play.
            // Exact request retries return the cached response before this point.
            let source_grant = GrantedFile::from_root(&source.root, &source.relative)
                .map_err(|_| Reply::error(StatusCode::UNPROCESSABLE_ENTITY, "source_failed"))?;
            control.tickets.remove(&ticket);
            let active = control.active.as_mut().unwrap();
            let revision = active
                .session
                .replace_source(slot, &source_grant, source_rev)
                .map_err(session_error)?;
            Ok(Reply::json(
                StatusCode::OK,
                json!({"accepted":true,"fixture_only":true,"context":active.context(),"slot":slot,"source_rev":revision}),
            ))
        }
        ControlRequest::Focus { expected, slot } => {
            check_expected(control, &expected)?;
            let active = control.active.as_mut().unwrap();
            active
                .session
                .focus(slot, expected.focus_revision)
                .map_err(session_error)?;
            Ok(accepted(active))
        }
        ControlRequest::Audio { expected, policy } => {
            check_expected(control, &expected)?;
            let active = control.active.as_mut().unwrap();
            let policy = match policy {
                WireAudio::FollowsFocus => AudioPolicy::FollowsFocus,
                WireAudio::Muted => AudioPolicy::Muted,
                WireAudio::Slot { slot } => AudioPolicy::Slot(slot),
            };
            active
                .session
                .set_audio_policy(policy, expected.audio_revision)
                .map_err(session_error)?;
            Ok(accepted(active))
        }
        ControlRequest::Layout { expected, geometry } => {
            check_expected(control, &expected)?;
            let geometry = geometry.validate()?;
            let visible_slots = geometry.rects().len();
            let receipt = geometry_receipt(&geometry);
            let active = control.active.as_mut().unwrap();
            active
                .session
                .set_geometry(geometry, expected.geometry_revision)
                .map_err(session_error)?;
            active.visible_slots = visible_slots;
            active.geometry = receipt;
            Ok(Reply::json(
                StatusCode::OK,
                json!({"accepted":true,"fixture_only":true,"context":active.context(),"geometry":active.geometry}),
            ))
        }
        ControlRequest::Stop {
            expected,
            slot,
            source_rev,
        } => {
            check_expected(control, &expected)?;
            let active = control.active.as_mut().unwrap();
            check_source(active, slot, source_rev)?;
            let revision = active
                .session
                .stop_slot(slot, source_rev)
                .map_err(session_error)?;
            Ok(Reply::json(
                StatusCode::OK,
                json!({"accepted":true,"fixture_only":true,"context":active.context(),"slot":slot,"source_rev":revision}),
            ))
        }
        ControlRequest::Off { expected } => {
            check_expected(control, &expected)?;
            fixture.close(control)?;
            Ok(Reply::json(
                StatusCode::OK,
                json!({"accepted":true,"fixture_only":true,"state":"off"}),
            ))
        }
    }
}

fn valid_media_name(name: &str) -> bool {
    name == "index.m3u8"
        || name
            .strip_prefix("segment-")
            .and_then(|name| name.strip_suffix(".ts"))
            .is_some_and(|digits| {
                digits.len() == 6 && digits.bytes().all(|byte| byte.is_ascii_digit())
            })
}
fn media_live(lease: &MediaLease) -> bool {
    lease.expires > Instant::now() && !lease.revoked.load(Ordering::Acquire)
}
struct StreamState {
    file: tokio::fs::File,
    lease: MediaLease,
    remaining: u64,
    _permit: OwnedSemaphorePermit,
}
async fn media_http(
    State(fixture): State<Arc<Fixture>>,
    path: Result<HttpPath<(String, String)>, axum::extract::rejection::PathRejection>,
    headers: HeaderMap,
) -> Response {
    if !fixture.authenticated(&headers) {
        return Reply::error(StatusCode::UNAUTHORIZED, "unauthorized").response();
    }
    let HttpPath((lease_id, file)) = match path {
        Ok(path) => path,
        Err(_) => return Reply::error(StatusCode::BAD_REQUEST, "invalid_path").response(),
    };
    if !valid_media_name(&file) {
        return Reply::error(StatusCode::NOT_FOUND, "media_missing").response();
    }
    let lease = locked(&fixture.media.leases).get(&lease_id).cloned();
    let Some(lease) = lease.filter(media_live) else {
        return Reply::error(StatusCode::GONE, "lease_expired").response();
    };
    let permit = match fixture.media.permits.clone().try_acquire_owned() {
        Ok(permit) => permit,
        Err(_) => return Reply::error(StatusCode::TOO_MANY_REQUESTS, "media_capacity").response(),
    };
    let path = lease.directory.join(&file);
    let metadata = match tokio::fs::symlink_metadata(&path).await {
        Ok(metadata) if metadata.is_file() => metadata,
        _ => return Reply::error(StatusCode::NOT_FOUND, "media_missing").response(),
    };
    let maximum = if file == "index.m3u8" {
        64 * 1024
    } else {
        8 * 1024 * 1024
    };
    if metadata.len() == 0 || metadata.len() > maximum {
        return Reply::error(StatusCode::SERVICE_UNAVAILABLE, "media_limit").response();
    }
    let mut options = tokio::fs::OpenOptions::new();
    options.read(true);
    #[cfg(target_os = "linux")]
    options.custom_flags(0x20000); // O_NOFOLLOW
    #[cfg(target_os = "macos")]
    options.custom_flags(0x100); // O_NOFOLLOW
    let file_handle = match options.open(path).await {
        Ok(file) => file,
        Err(_) => return Reply::error(StatusCode::NOT_FOUND, "media_missing").response(),
    };
    let metadata = match file_handle.metadata().await {
        Ok(metadata) if metadata.is_file() && metadata.len() > 0 && metadata.len() <= maximum => {
            metadata
        }
        _ => return Reply::error(StatusCode::SERVICE_UNAVAILABLE, "media_limit").response(),
    };
    let stream = futures_util::stream::unfold(
        StreamState {
            file: file_handle,
            lease,
            remaining: metadata.len(),
            _permit: permit,
        },
        |mut state| async move {
            if state.remaining == 0 {
                return None;
            }
            if !media_live(&state.lease) {
                state.remaining = 0;
                return Some((
                    Err(std::io::Error::new(
                        std::io::ErrorKind::PermissionDenied,
                        "media lease ended",
                    )),
                    state,
                ));
            }
            let mut bytes = vec![0u8; state.remaining.min(64 * 1024) as usize];
            match state.file.read(&mut bytes).await {
                Ok(0) => None,
                Ok(size) if media_live(&state.lease) => {
                    bytes.truncate(size);
                    state.remaining -= size as u64;
                    Some((Ok(bytes), state))
                }
                _ => {
                    state.remaining = 0;
                    Some((Err(std::io::Error::other("media unavailable")), state))
                }
            }
        },
    );
    let content_type = if file == "index.m3u8" {
        "application/vnd.apple.mpegurl"
    } else {
        "video/mp2t"
    };
    (
        [
            ("content-type", content_type),
            ("cache-control", "no-store"),
        ],
        Body::from_stream(stream),
    )
        .into_response()
}
