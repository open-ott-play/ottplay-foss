//! Explicitly injected fixture host. No production route installs this backend.
//! Long source acquisition/probing runs outside the session control mutex; owned
//! operations survive a dropped HTTP waiter and retain their cleanup receipts.
use super::{Authenticated, BoundaryError, Broker};
use futures_util::FutureExt;
use ottplay_core::multiview::{
    broker::{
        registry::{Registry, RegistryError, Reservation, RetirementProof, SlotSourceRefs},
        runtime::SourceService,
        stream::{OpenedStream, StreamFactory, StreamPhase},
        wire::{
            self, Binding, ControlOp, ControlRequest, ControlResponse, Geometry, NativeExpected,
            Output, OutputProfile, SessionCreateRequest, SessionState, StatusRequest,
            StatusResponse,
        },
    },
    decoder::{self, GrantedStream},
    encoder::EncoderState,
    geometry::{CanvasSpec, ImportedRect, OverlapPolicy, ValidatedGeometry},
    persistent::{self, Session},
};
use std::{
    collections::BTreeMap,
    future::Future,
    panic::AssertUnwindSafe,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio::sync::watch;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

const MAX_OPERATIONS: usize = 64;
const MAX_SESSIONS: usize = 16;
const FIXTURE_LIMIT: Duration = Duration::from_secs(60);

pub struct FixtureConfig {
    pub media: persistent::Config,
    pub profile: OutputProfile,
    pub input_adapters: Vec<String>,
}
pub struct LiveBackend {
    config: FixtureConfig,
    sources: Arc<SourceService>,
    registry: Arc<Registry>,
    host: Mutex<Host>,
}
struct Host {
    sessions: BTreeMap<String, Arc<LiveSession>>,
    creating: bool,
    operations: BTreeMap<String, Operation>,
}
struct Operation {
    digest: [u8; 32],
    completed: watch::Sender<Option<Result<Reply, BoundaryError>>>,
    expires: Instant,
}
#[derive(Clone)]
enum Reply {
    Created(StatusResponse),
    Controlled(ControlResponse),
}
struct LiveSession {
    id: String,
    scene: String,
    owner: Authenticated,
    end: Instant,
    cancel: CancellationToken,
    control: Mutex<Control>,
    close_receipt: Mutex<Option<watch::Receiver<Option<Result<(), BoundaryError>>>>>,
}
struct Control {
    core: Option<Session>,
    snapshot: persistent::Snapshot,
    geometry: Geometry,
    bindings: BTreeMap<u8, Binding>,
    sources: BTreeMap<u8, SourceOwner>,
    pending: BTreeMap<u8, Pending>,
    failures: BTreeMap<u8, &'static str>,
    uncertain: Vec<Retained>,
    output_removed: bool,
    output: Option<Output>,
    output_started_ms: u64,
    retired_output: Vec<Output>,
    output_fence: Option<u64>,
    awaiting_clean_output: bool,
    closing: bool,
    closed: bool,
    cleanup_failed: bool,
}
struct SourceOwner {
    factory: StreamFactory,
    decode: OpenedStream,
}
struct Retained {
    reservation: Reservation,
    cleanup: bool,
}
struct Pending {
    cancel: CancellationToken,
    done: watch::Receiver<bool>,
}

fn acknowledge_retired_outputs(
    broker: &Broker,
    session_id: &str,
    outputs: &mut Vec<Output>,
    output_removed: bool,
) -> bool {
    // Revocation blocks reads immediately, but only the confirmed core shutdown
    // receipt may release worker/output custody. An uncertain shutdown retries.
    if !output_removed {
        return false;
    }
    outputs.retain(|output| {
        broker
            .acknowledge_reaped(session_id, &output.output_generation)
            .is_err()
    });
    outputs.is_empty()
}

fn project_slot_source_refs(
    registry: &Registry,
    principal: &wire::Principal,
    binding: Option<&Binding>,
    observed_slot_id: u8,
    observed_source_revision: u64,
    state: wire::SlotState,
) -> Option<SlotSourceRefs> {
    if !matches!(
        state,
        wire::SlotState::Preparing | wire::SlotState::Playing | wire::SlotState::Stalled
    ) {
        return None;
    }
    let binding = binding.filter(|b| b.native_expected.slot_id == observed_slot_id)?;
    // Metadata is projected from redeemed authority, never from a requested
    // grant, selected UI item, SourceOwner cache or a guessed playback source.
    registry
        .slot_source_refs(principal, binding, observed_source_revision)
        .ok()
        .flatten()
}

impl Control {
    fn authority_invalid(&self) -> bool {
        self.sources.values().any(|source| {
            source
                .factory
                .reservation()
                .revoked()
                .load(std::sync::atomic::Ordering::Acquire)
        })
    }

    fn composite_ready(&self) -> bool {
        self.snapshot.output_state == EncoderState::Playing
            && self.snapshot.output_frames > 0
            && self.snapshot.hls_sequence.is_some()
            && !self.closed
            && !self.closing
            && !self.cleanup_failed
            && !self.awaiting_clean_output
            && !self.authority_invalid()
    }

    fn reported_output(&self, now_ms: u64) -> Option<Output> {
        self.output.clone().and_then(|mut output| {
            output.lease_expires_in_ms = u64::from(output.lease_expires_in_ms)
                .saturating_sub(now_ms.saturating_sub(self.output_started_ms))
                .min(u32::MAX as u64) as u32;
            (output.lease_expires_in_ms > 0).then_some(output)
        })
    }

    fn session_state(&self, now_ms: u64) -> SessionState {
        if self.closed {
            SessionState::Closed
        } else if self.closing {
            SessionState::Closing
        } else if self.cleanup_failed
            || self.authority_invalid()
            || matches!(
                self.snapshot.output_state,
                EncoderState::Failed | EncoderState::Stopped
            )
        {
            SessionState::Failed
        } else if self.composite_ready() && self.reported_output(now_ms).is_some() {
            SessionState::Ready
        } else {
            SessionState::Preparing
        }
    }
}

fn error(value: RegistryError) -> BoundaryError {
    match value {
        RegistryError::Forbidden => BoundaryError::Forbidden,
        RegistryError::InvalidRequest => BoundaryError::Invalid,
        RegistryError::Limit => BoundaryError::Limit,
        RegistryError::Expired | RegistryError::Revoked => BoundaryError::Revoked,
        RegistryError::Unavailable => BoundaryError::Unavailable,
        _ => BoundaryError::Conflict,
    }
}
fn media_error(value: persistent::Error) -> BoundaryError {
    match value {
        persistent::Error::StaleRevision => BoundaryError::Conflict,
        persistent::Error::InvalidConfig
        | persistent::Error::InvalidSlot
        | persistent::Error::NoAudio => BoundaryError::Invalid,
        persistent::Error::CapacityExceeded => BoundaryError::Limit,
        _ => BoundaryError::Unavailable,
    }
}
fn same_owner(a: &Authenticated, b: &Authenticated) -> bool {
    a.principal == b.principal && a.credential_revision == b.credential_revision
}
fn backend(snapshot: &persistent::Snapshot, scene: &str) -> wire::BackendExpected {
    wire::BackendExpected {
        runtime: snapshot.runtime,
        scene: scene.into(),
        geometry_revision: snapshot.geometry_revision,
        focus_revision: snapshot.focus_revision,
        audio_revision: snapshot.audio_revision,
    }
}
fn refresh(control: &mut Control, scene: &str) {
    if let Some(core) = &control.core {
        control.snapshot = core.snapshot();
    }
    let expected = backend(&control.snapshot, scene);
    for binding in control.bindings.values_mut() {
        binding.backend_expected = expected.clone();
        if let Some(slot) = control
            .snapshot
            .slots
            .iter()
            .find(|s| s.slot_id == binding.native_expected.slot_id)
        {
            binding.backend_slot_revision = slot.source_revision;
        }
    }
}
fn geometry(value: &Geometry, profile: &OutputProfile) -> Result<ValidatedGeometry, BoundaryError> {
    if value.canvas != profile.canvas
        || value.rects.len() > usize::from(profile.max_inputs)
        || !profile.geometry_modes.contains(&value.mode)
    {
        return Err(BoundaryError::Invalid);
    }
    ValidatedGeometry::new(
        CanvasSpec {
            width: value.canvas.width,
            height: value.canvas.height,
            fps: value.canvas.fps,
        },
        value.revision,
        &value
            .rects
            .iter()
            .map(|r| ImportedRect {
                slot_id: r.slot_id,
                x: r.x,
                y: r.y,
                width: r.width,
                height: r.height,
                z: r.z,
            })
            .collect::<Vec<_>>(),
        match value.mode {
            wire::GeometryMode::Disjoint => OverlapPolicy::Disjoint,
            wire::GeometryMode::Pip => OverlapPolicy::Pip,
        },
    )
    .map_err(|_| BoundaryError::Invalid)
}

/// Native revision transitions are explicit and operation-specific. This is not
/// a general rebinding path and never changes runtime, scene or target slot.
fn native_transition(
    context: &Binding,
    proposed: Option<&NativeExpected>,
    operation: &ControlOp,
    audio: persistent::AudioPolicy,
) -> Result<NativeExpected, BoundaryError> {
    let Some(proposed) = proposed else {
        return Ok(context.native_expected.clone());
    };
    let mut allowed = context.native_expected.clone();
    match operation {
        ControlOp::Focus {} => {
            allowed.expected.focus_revision = proposed.expected.focus_revision.clone();
            if audio == persistent::AudioPolicy::FollowsFocus {
                allowed.expected.audio_revision = proposed.expected.audio_revision.clone();
            }
        }
        ControlOp::Audio { .. } => {
            allowed.expected.audio_revision = proposed.expected.audio_revision.clone()
        }
        ControlOp::Layout { .. } => {
            allowed.expected.layout_revision = proposed.expected.layout_revision.clone()
        }
        ControlOp::Stop {} => {
            allowed.source_revision = proposed.source_revision.clone();
            allowed.slot_generation = proposed.slot_generation.clone();
        }
        ControlOp::Play { .. } | ControlOp::Renew {} | ControlOp::Off {} => {}
    }
    let mut candidate = context.clone();
    candidate.native_expected = allowed.clone();
    if *proposed != allowed || !candidate.valid() {
        return Err(BoundaryError::Invalid);
    }
    Ok(allowed)
}

impl LiveBackend {
    pub fn new(
        mut config: FixtureConfig,
        sources: Arc<SourceService>,
        registry: Arc<Registry>,
    ) -> Result<Arc<Self>, BoundaryError> {
        if config.media.max_duration.is_zero()
            || config.media.max_duration > FIXTURE_LIMIT
            || !wire::opaque(&config.profile.profile_id)
            || config.profile.max_inputs == 0
            || config.profile.max_inputs > 9
            || config.profile.canvas.width == 0
            || config.profile.canvas.height == 0
            || config.profile.canvas.width > 1920
            || config.profile.canvas.height > 1080
            || config.profile.canvas.width % 2 != 0
            || config.profile.canvas.height % 2 != 0
            || config.profile.canvas.fps == 0
            || config.profile.canvas.fps > 15
            || config.profile.geometry_modes.is_empty()
            || config.profile.geometry_modes.len() > 2
            || (config.profile.geometry_modes.len() == 2
                && config.profile.geometry_modes[0] == config.profile.geometry_modes[1])
            || (config.profile.max_inputs < 2
                && config
                    .profile
                    .geometry_modes
                    .contains(&wire::GeometryMode::Pip))
            || config.input_adapters.is_empty()
            || config.input_adapters.len() > 16
            || config.input_adapters.iter().any(|s| !wire::opaque(s))
        {
            return Err(BoundaryError::Configuration);
        }
        config.media.require_broker_grants = true;
        Ok(Arc::new(Self {
            config,
            sources,
            registry,
            host: Mutex::new(Host {
                sessions: BTreeMap::new(),
                creating: false,
                operations: BTreeMap::new(),
            }),
        }))
    }
    pub fn profile(&self) -> &OutputProfile {
        &self.config.profile
    }
    pub fn input_adapters(&self) -> &[String] {
        &self.config.input_adapters
    }

    fn sync_registry(
        &self,
        session: &LiveSession,
        state: &mut Control,
    ) -> Result<(), BoundaryError> {
        for slot in state.bindings.keys().copied().collect::<Vec<_>>() {
            let binding = self
                .registry
                .current_binding(&session.owner.principal, &session.id, slot)
                .map_err(error)?;
            state.bindings.insert(slot, binding);
        }
        Ok(())
    }

    fn session(&self, owner: &Authenticated, id: &str) -> Result<Arc<LiveSession>, BoundaryError> {
        let host = self.host.lock().map_err(|_| BoundaryError::Unavailable)?;
        let session = host.sessions.get(id).ok_or(BoundaryError::Conflict)?;
        if !same_owner(&session.owner, owner) {
            return Err(BoundaryError::Forbidden);
        }
        Ok(session.clone())
    }
    fn key(
        owner: &Authenticated,
        endpoint: &str,
        session: &str,
        id: &str,
    ) -> Result<String, BoundaryError> {
        if !wire::opaque(id) {
            return Err(BoundaryError::Invalid);
        }
        Ok(format!(
            "{}\0{}\0{}\0{}\0{}\0{}",
            owner.principal.subject,
            owner.principal.installation_id,
            owner.credential_revision,
            endpoint,
            session,
            id
        ))
    }
    async fn operation<F>(
        &self,
        key: String,
        digest: [u8; 32],
        future: F,
    ) -> Result<Reply, BoundaryError>
    where
        F: Future<Output = Result<Reply, BoundaryError>> + Send + 'static,
    {
        let mut receive = {
            let mut host = self.host.lock().map_err(|_| BoundaryError::Unavailable)?;
            let now = Instant::now();
            host.operations
                .retain(|_, v| v.expires > now || v.completed.borrow().is_none());
            if let Some(previous) = host.operations.get(&key) {
                if !super::same_digest(&previous.digest, &digest) {
                    return Err(BoundaryError::Conflict);
                }
                previous.completed.subscribe()
            } else {
                if host.operations.len() >= MAX_OPERATIONS {
                    return Err(BoundaryError::Limit);
                }
                let (completed, receive) = watch::channel(None);
                host.operations.insert(
                    key,
                    Operation {
                        digest,
                        completed: completed.clone(),
                        expires: now + Duration::from_secs(120),
                    },
                );
                tokio::spawn(async move {
                    let result = AssertUnwindSafe(future)
                        .catch_unwind()
                        .await
                        .unwrap_or(Err(BoundaryError::Unavailable));
                    completed.send_replace(Some(result));
                });
                receive
            }
        };
        loop {
            if let Some(result) = receive.borrow().clone() {
                return result;
            }
            receive
                .changed()
                .await
                .map_err(|_| BoundaryError::Unavailable)?;
        }
    }

    pub async fn create(
        self: &Arc<Self>,
        broker: Broker,
        owner: Authenticated,
        request: SessionCreateRequest,
        request_id: String,
        body_digest: [u8; 32],
    ) -> Result<StatusResponse, BoundaryError> {
        broker.credential_remaining_ms(&owner)?;
        let key = Self::key(&owner, "create", &request.server_epoch, &request_id)?;
        let task = self.clone();
        let task_broker = broker.clone();
        let task_owner = owner.clone();
        let result = self
            .operation(key, body_digest, async move {
                task.create_owned(task_broker, task_owner, request)
                    .await
                    .map(Reply::Created)
            })
            .await?;
        broker.credential_remaining_ms(&owner)?;
        match result {
            Reply::Created(value) => {
                self.status(
                    broker,
                    owner,
                    StatusRequest {
                        version: wire::VERSION,
                        server_epoch: value.server_epoch,
                        session_id: value.session_id,
                        native_expected: value.native_expected,
                    },
                )
                .await
            }
            _ => Err(BoundaryError::Conflict),
        }
    }
    async fn create_owned(
        self: &Arc<Self>,
        broker: Broker,
        owner: Authenticated,
        request: SessionCreateRequest,
    ) -> Result<StatusResponse, BoundaryError> {
        if request.version != wire::VERSION
            || request.server_epoch != broker.0.epoch
            || request.output_profile_id != self.config.profile.profile_id
        {
            return Err(BoundaryError::Invalid);
        }
        let validated = geometry(&request.geometry, &self.config.profile)?;
        if usize::from(request.native_expected.slot_id) >= request.geometry.rects.len() {
            return Err(BoundaryError::Invalid);
        }
        let native = &request.native_expected;
        let provisional = Binding {
            server_epoch: request.server_epoch.clone(),
            session_id: "create".into(),
            backend_expected: wire::BackendExpected {
                runtime: 0,
                scene: "create".into(),
                geometry_revision: 0,
                focus_revision: 0,
                audio_revision: 0,
            },
            native_expected: native.clone(),
            backend_slot_revision: 0,
        };
        if !provisional.valid() {
            return Err(BoundaryError::Invalid);
        }
        let lifetime = self.config.media.max_duration.min(Duration::from_millis(
            broker.credential_remaining_ms(&owner)?,
        ));
        if lifetime.is_zero() {
            return Err(BoundaryError::Revoked);
        }
        let hard_end = Instant::now() + lifetime;
        {
            let mut host = self.host.lock().map_err(|_| BoundaryError::Unavailable)?;
            if host.creating
                || host
                    .sessions
                    .values()
                    .any(|s| s.control.lock().map_or(true, |c| !c.closed))
            {
                return Err(BoundaryError::Conflict);
            }
            if host.sessions.len() >= MAX_SESSIONS {
                return Err(BoundaryError::Limit);
            }
            host.creating = true;
        }
        let mut config = self.config.media.clone();
        config.max_duration = lifetime;
        let started = tokio::task::spawn_blocking(move || Session::start(config, validated)).await;
        let mut core = match started {
            Ok(Ok(core)) => core,
            result => {
                self.host
                    .lock()
                    .map_err(|_| BoundaryError::Unavailable)?
                    .creating = false;
                return Err(match result {
                    Ok(Err(error)) => media_error(error),
                    _ => BoundaryError::Unavailable,
                });
            }
        };
        if let Err(error) = broker.credential_remaining_ms(&owner) {
            if tokio::task::spawn_blocking(move || core.shutdown())
                .await
                .is_ok_and(|r| r.is_ok())
            {
                self.host
                    .lock()
                    .map_err(|_| BoundaryError::Unavailable)?
                    .creating = false;
            }
            return Err(error);
        }
        let snapshot = core.snapshot();
        let id = Uuid::new_v4().simple().to_string();
        let scene = Uuid::new_v4().simple().to_string();
        let binding = Binding {
            server_epoch: request.server_epoch,
            session_id: id.clone(),
            backend_expected: backend(&snapshot, &scene),
            native_expected: request.native_expected,
            backend_slot_revision: 0,
        };
        if let Err(error) = self.registry.create_session(&owner.principal, &binding) {
            if tokio::task::spawn_blocking(move || core.shutdown())
                .await
                .is_ok_and(|r| r.is_ok())
            {
                self.host
                    .lock()
                    .map_err(|_| BoundaryError::Unavailable)?
                    .creating = false;
            }
            return Err(crate_error(error));
        }
        let session = Arc::new(LiveSession {
            id: id.clone(),
            scene,
            owner: owner.clone(),
            end: hard_end,
            cancel: CancellationToken::new(),
            control: Mutex::new(Control {
                core: Some(core),
                snapshot,
                geometry: request.geometry,
                bindings: BTreeMap::from([(binding.native_expected.slot_id, binding.clone())]),
                sources: BTreeMap::new(),
                pending: BTreeMap::new(),
                failures: BTreeMap::new(),
                uncertain: Vec::new(),
                output_removed: false,
                output: None,
                output_started_ms: 0,
                retired_output: Vec::new(),
                output_fence: None,
                awaiting_clean_output: false,
                closing: false,
                closed: false,
                cleanup_failed: false,
            }),
            close_receipt: Mutex::new(None),
        });
        {
            let mut host = self.host.lock().map_err(|_| BoundaryError::Unavailable)?;
            host.sessions.insert(id, session.clone());
            host.creating = false;
        }
        let task = self.clone();
        let watchdog_session = session.clone();
        let watchdog_broker = broker.clone();
        tokio::spawn(async move {
            let mut retirement_attempts = 0u8;
            loop {
                tokio::time::sleep(Duration::from_millis(100)).await;
                let expired = Instant::now() >= watchdog_session.end
                    || watchdog_broker
                        .credential_remaining_ms(&watchdog_session.owner)
                        .is_err();
                let invalid = watchdog_session.control.lock().map_or(true, |c| {
                    c.closed
                        || c.closing
                        || c.cleanup_failed
                        || c.sources.values().any(|s| {
                            s.factory
                                .reservation()
                                .revoked()
                                .load(std::sync::atomic::Ordering::Acquire)
                        })
                        || c.core.as_ref().is_some_and(|core| {
                            matches!(
                                core.snapshot().output_state,
                                EncoderState::Failed | EncoderState::Stopped
                            )
                        })
                        || c.bindings.keys().next().is_none_or(|slot| {
                            task.registry
                                .current_binding(
                                    &watchdog_session.owner.principal,
                                    &watchdog_session.id,
                                    *slot,
                                )
                                .is_err()
                        })
                });
                if expired || invalid {
                    if task
                        .close_owned(&watchdog_broker, &watchdog_session)
                        .await
                        .is_ok()
                    {
                        break;
                    }
                    retirement_attempts += 1;
                    if retirement_attempts >= 20 {
                        break;
                    }
                }
            }
        });
        self.snapshot(&broker, &session, &binding.native_expected)
    }

    /// The first command for an empty native slot may enroll that slot identity;
    /// it cannot replace any existing identity or change shared native revisions.
    pub fn ensure_context(
        &self,
        owner: &Authenticated,
        value: &Binding,
    ) -> Result<(), BoundaryError> {
        let session = self.session(owner, &value.session_id)?;
        let mut control = session
            .control
            .lock()
            .map_err(|_| BoundaryError::Unavailable)?;
        if control.closed || control.closing || Instant::now() >= session.end {
            return Err(BoundaryError::Revoked);
        }
        if control
            .bindings
            .contains_key(&value.native_expected.slot_id)
        {
            let expected = self
                .registry
                .current_binding(
                    &owner.principal,
                    &value.session_id,
                    value.native_expected.slot_id,
                )
                .map_err(error)?;
            control
                .bindings
                .insert(value.native_expected.slot_id, expected.clone());
            if expected != *value {
                return Err(BoundaryError::Conflict);
            }
            return self
                .registry
                .authorize(&owner.principal, value)
                .map_err(error);
        }
        self.sync_registry(&session, &mut control)?;
        let first = control
            .bindings
            .values()
            .next()
            .ok_or(BoundaryError::Conflict)?;
        let slot = control
            .snapshot
            .slots
            .iter()
            .find(|s| s.slot_id == value.native_expected.slot_id)
            .ok_or(BoundaryError::Invalid)?;
        if !value.valid()
            || value.server_epoch != first.server_epoch
            || value.backend_expected != backend(&control.snapshot, &session.scene)
            || value.native_expected.runtime != first.native_expected.runtime
            || value.native_expected.expected != first.native_expected.expected
            || value.backend_slot_revision != 0
            || slot.source_revision != 0
            || usize::from(value.native_expected.slot_id) >= control.geometry.rects.len()
        {
            return Err(BoundaryError::Conflict);
        }
        self.registry
            .add_slot(&owner.principal, value)
            .map_err(error)?;
        control
            .bindings
            .insert(value.native_expected.slot_id, value.clone());
        Ok(())
    }

    pub async fn status(
        &self,
        broker: Broker,
        owner: Authenticated,
        request: StatusRequest,
    ) -> Result<StatusResponse, BoundaryError> {
        broker.credential_remaining_ms(&owner)?;
        if request.version != wire::VERSION || request.server_epoch != broker.0.epoch {
            return Err(BoundaryError::Invalid);
        }
        let session = self.session(&owner, &request.session_id)?;
        self.snapshot(&broker, &session, &request.native_expected)
    }
    fn snapshot(
        &self,
        broker: &Broker,
        session: &Arc<LiveSession>,
        native: &NativeExpected,
    ) -> Result<StatusResponse, BoundaryError> {
        let mut control = session
            .control
            .lock()
            .map_err(|_| BoundaryError::Unavailable)?;
        let binding = if control.closed || control.closing || control.cleanup_failed {
            control
                .bindings
                .get(&native.slot_id)
                .cloned()
                .ok_or(BoundaryError::Conflict)?
        } else {
            let current = self
                .registry
                .current_binding(&session.owner.principal, &session.id, native.slot_id)
                .map_err(error)?;
            control.bindings.insert(native.slot_id, current.clone());
            current
        };
        if binding.native_expected.runtime != native.runtime
            || binding.native_expected.expected.scene != native.expected.scene
        {
            return Err(BoundaryError::Conflict);
        }
        if let Some(core) = &control.core {
            control.snapshot = core.snapshot();
        }
        let ready = control.composite_ready();
        if ready && control.output.is_none() && !control.awaiting_clean_output {
            if let Some(core) = &control.core {
                let lifetime = session
                    .end
                    .saturating_duration_since(Instant::now())
                    .as_millis()
                    .min(u32::MAX as u128) as u32;
                if lifetime > 0 {
                    let issued_ms = broker.0.clock.now_ms();
                    if let Ok(output) = broker.publish_live_output(
                        &session.owner,
                        &binding,
                        core.output_directory().to_path_buf(),
                        lifetime,
                        control.output_fence.map_or(0, |n| n.saturating_add(1)),
                        None,
                    ) {
                        control.output = Some(output);
                        control.output_started_ms = issued_ms;
                    }
                }
            }
        }
        let now_ms = broker.0.clock.now_ms();
        let reported_output = control.reported_output(now_ms);
        let state = control.session_state(now_ms);
        let slots = control
            .snapshot
            .slots
            .iter()
            .filter(|s| {
                usize::from(s.slot_id) < control.geometry.rects.len()
                    || control.bindings.contains_key(&s.slot_id)
            })
            .map(|s| {
                let state = if control.closed {
                    wire::SlotState::Closed
                } else if control.closing
                    || control.sources.get(&s.slot_id).is_some_and(|source| {
                        source
                            .factory
                            .reservation()
                            .revoked()
                            .load(std::sync::atomic::Ordering::Acquire)
                    })
                {
                    wire::SlotState::Closing
                } else if control.pending.contains_key(&s.slot_id) {
                    wire::SlotState::Preparing
                } else if control.failures.contains_key(&s.slot_id) {
                    wire::SlotState::Failed
                } else {
                    match s.state {
                        persistent::SlotState::Empty => wire::SlotState::Empty,
                        persistent::SlotState::Starting => wire::SlotState::Preparing,
                        persistent::SlotState::Playing if s.frames > 0 => wire::SlotState::Playing,
                        persistent::SlotState::Playing | persistent::SlotState::Stalled => {
                            wire::SlotState::Stalled
                        }
                        persistent::SlotState::Ended | persistent::SlotState::Stopped => {
                            wire::SlotState::Closed
                        }
                        persistent::SlotState::Failed => wire::SlotState::Failed,
                    }
                };
                let source_binding = control.bindings.get(&s.slot_id).and_then(|_| {
                    self.registry
                        .current_binding(&session.owner.principal, &session.id, s.slot_id)
                        .ok()
                        .filter(|current| {
                            current.backend_expected.runtime == control.snapshot.runtime
                                && current.backend_expected.scene == session.scene
                        })
                });
                let source_refs = project_slot_source_refs(
                    &self.registry,
                    &session.owner.principal,
                    source_binding.as_ref(),
                    s.slot_id,
                    s.source_revision,
                    state,
                );
                let (source_ref, item_ref) = source_refs
                    .map(|refs| (Some(refs.source_ref), Some(refs.item_ref)))
                    .unwrap_or((None, None));
                wire::SlotSnapshot {
                    slot_id: s.slot_id,
                    source_revision: s.source_revision,
                    state,
                    error: control.failures.get(&s.slot_id).map(|e| (*e).into()),
                    frames: s.frames,
                    position_ms: None,
                    duration_ms: None,
                    source_ref,
                    item_ref,
                }
            })
            .collect();
        let audio = wire::AudioState {
            policy: match control.snapshot.audio_policy {
                persistent::AudioPolicy::FollowsFocus => wire::AudioPolicy::FollowsFocus,
                persistent::AudioPolicy::Muted => wire::AudioPolicy::Muted,
                persistent::AudioPolicy::Slot(_) => wire::AudioPolicy::Slot,
            },
            slot_id: control.snapshot.audio_slot,
        };
        Ok(StatusResponse {
            version: wire::VERSION,
            server_id: broker.0.server_id.clone(),
            server_epoch: broker.0.epoch.clone(),
            session_id: session.id.clone(),
            native_expected: binding.native_expected.clone(),
            backend_expected: binding.backend_expected.clone(),
            state,
            geometry: control.geometry.clone(),
            slots,
            audio,
            output: if ready { reported_output } else { None },
        })
    }

    pub async fn control(
        self: &Arc<Self>,
        broker: Broker,
        owner: Authenticated,
        request: ControlRequest,
        request_id: String,
        body_digest: [u8; 32],
    ) -> Result<ControlResponse, BoundaryError> {
        broker.credential_remaining_ms(&owner)?;
        let key = Self::key(&owner, "control", &request.context.session_id, &request_id)?;
        let task = self.clone();
        let task_broker = broker.clone();
        let task_owner = owner.clone();
        let result = self
            .operation(key, body_digest, async move {
                task.control_owned(task_broker, task_owner, request, request_id)
                    .await
                    .map(Reply::Controlled)
            })
            .await?;
        broker.credential_remaining_ms(&owner)?;
        match result {
            Reply::Controlled(value) => Ok(value),
            _ => Err(BoundaryError::Conflict),
        }
    }
    async fn control_owned(
        self: &Arc<Self>,
        broker: Broker,
        owner: Authenticated,
        request: ControlRequest,
        operation_id: String,
    ) -> Result<ControlResponse, BoundaryError> {
        if request.version != wire::VERSION {
            return Err(BoundaryError::Invalid);
        }
        broker.credential_remaining_ms(&owner)?;
        let session = self.session(&owner, &request.context.session_id)?;
        let next_native = {
            let state = session
                .control
                .lock()
                .map_err(|_| BoundaryError::Unavailable)?;
            native_transition(
                &request.context,
                request.next_native.as_ref(),
                &request.op,
                state.snapshot.audio_policy,
            )?
        };
        let cleanup_only = if matches!(&request.op, ControlOp::Off {}) {
            let state = session
                .control
                .lock()
                .map_err(|_| BoundaryError::Unavailable)?;
            if state.closing || state.closed || state.cleanup_failed {
                if state.bindings.get(&request.context.native_expected.slot_id)
                    != Some(&request.context)
                {
                    return Err(BoundaryError::Conflict);
                }
                true
            } else {
                false
            }
        } else {
            false
        };
        if cleanup_only {
            self.close_owned(&broker, &session).await?;
            let state = session
                .control
                .lock()
                .map_err(|_| BoundaryError::Unavailable)?;
            return Ok(ControlResponse {
                version: wire::VERSION,
                context: state.bindings[&request.context.native_expected.slot_id].clone(),
                accepted: true,
                operation_id,
                state: if state.closed {
                    SessionState::Closed
                } else {
                    SessionState::Closing
                },
            });
        }
        self.ensure_context(&owner, &request.context)?;
        match request.op {
            ControlOp::Play { input_grant } => {
                self.play(&broker, &session, &request.context, &input_grant)
                    .await?
            }
            ControlOp::Stop {} => {
                self.stop(&broker, &session, &request.context, &next_native)
                    .await?
            }
            ControlOp::Off {} => {
                self.registry
                    .authorize(&owner.principal, &request.context)
                    .map_err(error)?;
                self.close_owned(&broker, &session).await?;
            }
            op => {
                let task = self.clone();
                let target = session.clone();
                let context = request.context.clone();
                tokio::task::spawn_blocking(move || {
                    let mut state = target
                        .control
                        .lock()
                        .map_err(|_| BoundaryError::Unavailable)?;
                    task.registry
                        .authorize(&target.owner.principal, &context)
                        .map_err(error)?;
                    if state.closing || state.closed {
                        return Err(BoundaryError::Revoked);
                    }
                    if matches!(op, ControlOp::Renew {}) {
                        return task.registry.renew(&target.owner.principal, &context).map_err(error);
                    }
                    let mut next = context.clone();
                    next.native_expected = next_native;
                    let validated = if let ControlOp::Layout { ref geometry } = op {
                        if geometry.revision <= context.backend_expected.geometry_revision
                            || geometry.rects.len() < state.geometry.rects.len()
                            || usize::from(state.snapshot.focus_slot) >= geometry.rects.len()
                            || matches!(state.snapshot.audio_policy, persistent::AudioPolicy::Slot(slot) if usize::from(slot) >= geometry.rects.len()) {
                            return Err(BoundaryError::Invalid);
                        }
                        Some(crate_geometry(geometry, &task.config.profile)?)
                    } else { None };
                    match &op {
                        ControlOp::Focus {} => {
                            if usize::from(context.native_expected.slot_id) >= state.geometry.rects.len() { return Err(BoundaryError::Invalid); }
                            next.backend_expected.focus_revision = next.backend_expected.focus_revision.checked_add(1).ok_or(BoundaryError::Conflict)?;
                            if state.snapshot.audio_policy == persistent::AudioPolicy::FollowsFocus {
                                next.backend_expected.audio_revision = next.backend_expected.audio_revision.checked_add(1).ok_or(BoundaryError::Conflict)?;
                            }
                        }
                        ControlOp::Audio { .. } => next.backend_expected.audio_revision = next.backend_expected.audio_revision.checked_add(1).ok_or(BoundaryError::Conflict)?,
                        ControlOp::Layout { geometry } => next.backend_expected.geometry_revision = geometry.revision,
                        _ => return Err(BoundaryError::Invalid),
                    }
                    let mut callback_error = None;
                    let mut validated = validated;
                    let checked = task.registry.commit_binding(&target.owner.principal, &context, &next, &mut || {
                        let core = state.core.as_mut().ok_or(RegistryError::Revoked)?;
                        let result = match &op {
                            ControlOp::Focus {} => core.focus(context.native_expected.slot_id, context.backend_expected.focus_revision).map(|_| ()),
                            ControlOp::Audio { policy } => core.set_audio_policy(match policy {
                                wire::AudioPolicy::FollowsFocus => persistent::AudioPolicy::FollowsFocus,
                                wire::AudioPolicy::Muted => persistent::AudioPolicy::Muted,
                                wire::AudioPolicy::Slot => persistent::AudioPolicy::Slot(context.native_expected.slot_id),
                            }, context.backend_expected.audio_revision).map(|_| ()),
                            ControlOp::Layout { .. } => core.set_geometry(validated.take().ok_or(RegistryError::InvalidRequest)?, context.backend_expected.geometry_revision),
                            _ => return Err(RegistryError::InvalidRequest),
                        };
                        result.map_err(|failure| { callback_error = Some(media_error(failure)); RegistryError::Unavailable })
                    });
                    if let Err(failure) = checked { return Err(callback_error.unwrap_or_else(|| error(failure))); }
                    if let ControlOp::Layout { geometry } = op { state.geometry = geometry; }
                    refresh(&mut state, &target.scene);
                    task.sync_registry(&target, &mut state)?;
                    Ok(())
                })
                .await
                .map_err(|_| BoundaryError::Unavailable)??;
            }
        }
        let mut state = session
            .control
            .lock()
            .map_err(|_| BoundaryError::Unavailable)?;
        if let Some(core) = &state.core {
            state.snapshot = core.snapshot();
        }
        let context = state
            .bindings
            .get(&request.context.native_expected.slot_id)
            .cloned()
            .ok_or(BoundaryError::Conflict)?;
        Ok(ControlResponse {
            version: wire::VERSION,
            context,
            accepted: true,
            operation_id,
            state: state.session_state(broker.0.clock.now_ms()),
        })
    }

    async fn play(
        self: &Arc<Self>,
        broker: &Broker,
        session: &Arc<LiveSession>,
        context: &Binding,
        grant: &str,
    ) -> Result<(), BoundaryError> {
        let slot = context.native_expected.slot_id;
        let (preparation, cancel, done) = {
            let mut state = session
                .control
                .lock()
                .map_err(|_| BoundaryError::Unavailable)?;
            self.registry
                .authorize(&session.owner.principal, context)
                .map_err(error)?;
            if state.closing
                || state.closed
                || state.pending.contains_key(&slot)
                || state.sources.contains_key(&slot)
            {
                return Err(BoundaryError::Conflict);
            }
            let preparation = state
                .core
                .as_ref()
                .ok_or(BoundaryError::Revoked)?
                .capture_stream_preparation(slot, context.backend_slot_revision)
                .map_err(media_error)?;
            let cancel = session.cancel.child_token();
            let (done, receiver) = watch::channel(false);
            state.pending.insert(
                slot,
                Pending {
                    cancel: cancel.clone(),
                    done: receiver,
                },
            );
            state.failures.remove(&slot);
            (preparation, cancel, done)
        };
        let outcome = AssertUnwindSafe(self.play_prepared(
            broker,
            session,
            context,
            grant,
            preparation,
            cancel,
        ))
        .catch_unwind()
        .await;
        let result = match outcome {
            Ok(result) => result,
            Err(_) => {
                if let Ok(mut state) = session.control.lock() {
                    state.cleanup_failed = true;
                }
                Err(BoundaryError::Unavailable)
            }
        };
        if let Ok(mut state) = session.control.lock() {
            state.pending.remove(&slot);
            if result.is_err() {
                state.failures.insert(slot, "source_failed");
            }
        }
        done.send_replace(true);
        result
    }
    async fn play_prepared(
        self: &Arc<Self>,
        broker: &Broker,
        session: &Arc<LiveSession>,
        context: &Binding,
        grant: &str,
        preparation: persistent::StreamPreparation,
        cancel: CancellationToken,
    ) -> Result<(), BoundaryError> {
        let source = match self
            .sources
            .resolve(&session.owner.principal, context, grant, &cancel)
            .await
        {
            Ok(source) => source,
            Err(failure) => {
                if let Some(reservation) = failure.reservation {
                    session
                        .control
                        .lock()
                        .map_err(|_| BoundaryError::Unavailable)?
                        .uncertain
                        .push(Retained {
                            reservation,
                            cleanup: false,
                        });
                }
                return Err(BoundaryError::Unavailable);
            }
        };
        let reservation = source.reservation().clone();
        let mut factory = match StreamFactory::new(source, session.end) {
            Ok(factory) => factory,
            Err(failure) => {
                let cleaned = failure.into_source().finish().await.is_ok();
                self.finish_reservation(session, &reservation, cleaned, true);
                return Err(BoundaryError::Revoked);
            }
        };
        let granted = match GrantedStream::from_authorized_stream(
            reservation.decoder_context(),
            factory.hard_end(),
            reservation.revoked(),
            reservation.publication_authority(),
        ) {
            Ok(granted) => granted,
            Err(_) => {
                let cleaned = factory.finish().await.is_ok();
                self.finish_reservation(session, &reservation, cleaned, true);
                return Err(BoundaryError::Unavailable);
            }
        };
        if preparation.bound_context() != reservation.decoder_context() {
            let cleaned = factory.finish().await.is_ok();
            self.finish_reservation(session, &reservation, cleaned, true);
            return Err(BoundaryError::Conflict);
        }
        let mut probe = match factory.open(StreamPhase::Probe).await {
            Ok(probe) => probe,
            Err(_) => {
                let cleaned = factory.finish().await.is_ok();
                self.finish_reservation(session, &reservation, cleaned, true);
                return Err(BoundaryError::Unavailable);
            }
        };
        let probe_input = match probe
            .take_file()
            .ok()
            .and_then(|file| granted.wrap_probe(file).ok())
        {
            Some(input) => input,
            None => {
                let _ = probe.retire().await;
                let cleaned = factory.finish().await.is_ok();
                self.finish_reservation(session, &reservation, cleaned, true);
                return Err(BoundaryError::Unavailable);
            }
        };
        let revoked = reservation.revoked();
        let deadline = session.end.min(Instant::now() + Duration::from_secs(5));
        let probed = tokio::task::spawn_blocking(move || {
            let result = decoder::probe_stream(
                preparation.decoder_config(),
                &granted,
                probe_input,
                revoked.as_ref(),
                deadline,
            );
            (preparation, granted, result)
        })
        .await;
        let joined = probe.retire().await.is_ok_and(|r| r.joined);
        let (preparation, granted, info) = match probed {
            Ok((p, g, Ok(info))) if joined => (p, g, info),
            _ => {
                let cleaned = factory.finish().await.is_ok();
                self.finish_reservation(session, &reservation, cleaned, true);
                return Err(BoundaryError::Unavailable);
            }
        };
        if cancel.is_cancelled() || broker.credential_remaining_ms(&session.owner).is_err() {
            let cleaned = factory.finish().await.is_ok();
            self.finish_reservation(session, &reservation, cleaned, true);
            return Err(BoundaryError::Revoked);
        }
        let mut decode = match factory.open(StreamPhase::Decode).await {
            Ok(decode) => decode,
            Err(_) => {
                let cleaned = factory.finish().await.is_ok();
                self.finish_reservation(session, &reservation, cleaned, true);
                return Err(BoundaryError::Unavailable);
            }
        };
        let input = match decode
            .take_file()
            .ok()
            .and_then(|file| granted.wrap_decode(file).ok())
        {
            Some(input) => input,
            None => {
                let _ = decode.retire().await;
                let cleaned = factory.finish().await.is_ok();
                self.finish_reservation(session, &reservation, cleaned, true);
                return Err(BoundaryError::Unavailable);
            }
        };
        let task = self.clone();
        let target = session.clone();
        let issue = context.clone();
        let capability = reservation.clone();
        let commit_cancel = cancel.clone();
        let commit = tokio::task::spawn_blocking(move || {
            let mut state = target
                .control
                .lock()
                .map_err(|_| BoundaryError::Unavailable)?;
            if state.closing || state.closed || commit_cancel.is_cancelled() {
                return Err(BoundaryError::Revoked);
            }
            let mut next = issue.clone();
            next.backend_slot_revision = next
                .backend_slot_revision
                .checked_add(1)
                .ok_or(BoundaryError::Conflict)?;
            task.registry
                .prepare_attachment(&target.owner.principal, &issue, &next, &capability)
                .map_err(error)?;
            let result = state
                .core
                .as_mut()
                .ok_or(BoundaryError::Revoked)?
                .commit_stream(preparation, &granted, info, input);
            refresh(&mut state, &target.scene);
            if result.is_err() {
                let _ = task
                    .registry
                    .retire_reservation(&target.owner.principal, &capability);
                let recovered = task
                    .registry
                    .current_binding(
                        &target.owner.principal,
                        &target.id,
                        issue.native_expected.slot_id,
                    )
                    .and_then(|old| {
                        let mut current = old.clone();
                        current.backend_expected = backend(&state.snapshot, &target.scene);
                        current.backend_slot_revision = state
                            .snapshot
                            .slots
                            .iter()
                            .find(|s| s.slot_id == issue.native_expected.slot_id)
                            .ok_or(RegistryError::Stale)?
                            .source_revision;
                        task.registry
                            .update_binding(&target.owner.principal, &old, &current)
                    });
                if recovered.is_err() {
                    state.cleanup_failed = true;
                }
            }
            if task.sync_registry(&target, &mut state).is_err() {
                state.cleanup_failed = true;
            }
            result.map(|_| ()).map_err(media_error)
        })
        .await;
        let (result, worker_reaped) = match commit {
            Ok(result) => (result, true),
            Err(_) => (Err(BoundaryError::Unavailable), false),
        };
        if let Err(error) = result {
            let _ = decode.retire().await;
            let cleaned = factory.finish().await.is_ok();
            self.finish_reservation(session, &reservation, cleaned, worker_reaped);
            return Err(error);
        }
        let install = {
            let state = session
                .control
                .lock()
                .map_err(|_| BoundaryError::Unavailable)?;
            !state.closing && !state.closed && !cancel.is_cancelled()
        };
        if !install {
            factory.cancel();
            let _ = decode.retire().await;
            let cleaned = factory.finish().await.is_ok();
            let reaped = session.control.lock().map_or(false, |s| {
                s.snapshot
                    .slots
                    .iter()
                    .find(|s| s.slot_id == context.native_expected.slot_id)
                    .is_some_and(|s| s.decoder_pid.is_none())
            });
            self.finish_reservation(session, &reservation, cleaned, reaped);
            return Err(BoundaryError::Revoked);
        }
        // Recheck and install while holding the same mutex used by Stop/Off.
        let mut resources = Some(SourceOwner { factory, decode });
        {
            let mut state = session
                .control
                .lock()
                .map_err(|_| BoundaryError::Unavailable)?;
            if !state.closing && !state.closed && !cancel.is_cancelled() {
                state
                    .sources
                    .insert(context.native_expected.slot_id, resources.take().unwrap());
            }
        }
        if let Some(mut resources) = resources {
            resources.factory.cancel();
            let _ = resources.decode.retire().await;
            let cleaned = resources.factory.finish().await.is_ok();
            self.finish_reservation(session, &reservation, cleaned, false);
            return Err(BoundaryError::Revoked);
        }
        Ok(())
    }

    fn finish_reservation(
        &self,
        session: &Arc<LiveSession>,
        reservation: &Reservation,
        cleanup: bool,
        worker_reaped: bool,
    ) {
        let _ = self
            .registry
            .retire_reservation(&session.owner.principal, reservation);
        if cleanup && worker_reaped {
            let _ = self.registry.acknowledge_retirement(
                &session.owner.principal,
                reservation.id(),
                RetirementProof::OutputRevoked,
            );
            let _ = self.registry.acknowledge_retirement(
                &session.owner.principal,
                reservation.id(),
                RetirementProof::WorkerReaped,
            );
            if let Ok(state) = session.control.lock() {
                if !state.closing && !state.closed && !state.awaiting_clean_output {
                    if let Some(binding) =
                        state.bindings.get(&reservation.decoder_context().slot_id)
                    {
                        let _ = self
                            .registry
                            .rearm_output(&session.owner.principal, binding);
                    }
                }
            }
        } else if let Ok(mut state) = session.control.lock() {
            state.uncertain.push(Retained {
                reservation: reservation.clone(),
                cleanup,
            });
            state.cleanup_failed = true;
        }
    }
    async fn stop(
        self: &Arc<Self>,
        broker: &Broker,
        session: &Arc<LiveSession>,
        context: &Binding,
        next_native: &NativeExpected,
    ) -> Result<(), BoundaryError> {
        let target = session.clone();
        let issue = context.clone();
        let task = self.clone();
        let boundary = broker.clone();
        let next_native = next_native.clone();
        let (source, pending, reaped, transition) = tokio::task::spawn_blocking(move || {
            let mut state = target
                .control
                .lock()
                .map_err(|_| BoundaryError::Unavailable)?;
            task.registry
                .authorize(&target.owner.principal, &issue)
                .map_err(error)?;
            let slot = issue.native_expected.slot_id;
            task.registry
                .retire_slot(&target.owner.principal, &issue)
                .map_err(error)?;
            let pending = state.pending.get(&slot).map(|pending| {
                pending.cancel.cancel();
                pending.done.clone()
            });
            boundary.revoke_output(&target.id)?;
            if let Some(output) = state.output.take() {
                state.retired_output.push(output);
            }
            state.output_fence = state.snapshot.hls_sequence;
            state.awaiting_clean_output = true;
            let reaped = state
                .core
                .as_mut()
                .ok_or(BoundaryError::Revoked)?
                .stop_slot(slot, issue.backend_slot_revision)
                .map_err(media_error);
            let source = state.sources.remove(&slot);
            refresh(&mut state, &target.scene);
            let mut next = state.bindings[&slot].clone();
            next.native_expected = next_native;
            let transition = task
                .registry
                .update_binding(&target.owner.principal, &issue, &next)
                .map_err(error);
            if transition.is_ok() {
                state.bindings.insert(slot, next);
            }
            // Source custody must leave this closure even when authorization
            // expires after the decoder has stopped. Never lose its async join.
            let worker_reaped = reaped.is_ok();
            Ok::<_, BoundaryError>((source, pending, worker_reaped, reaped.and(transition)))
        })
        .await
        .map_err(|_| BoundaryError::Unavailable)??;
        let mut cleanup_confirmed = true;
        if let Some(mut source) = source {
            source.factory.cancel();
            let joined = source.decode.retire().await.is_ok_and(|r| r.joined);
            let cleanup = source
                .factory
                .finish()
                .await
                .is_ok_and(|r| r.producers_joined && r.provider_cleanup_confirmed);
            self.finish_reservation(
                session,
                source.factory.reservation(),
                joined && cleanup,
                reaped,
            );
            cleanup_confirmed = joined && cleanup;
        }
        if let Some(mut done) = pending {
            while !*done.borrow() {
                if done.changed().await.is_err() {
                    break;
                }
            }
        }
        // The host will rearm only with core's clean-output watermark, not a
        // guessed HLS sequence delay. Until that proof exists output is withheld.
        transition?;
        if !reaped || !cleanup_confirmed {
            return Err(BoundaryError::Unavailable);
        }
        Ok(())
    }
    async fn close_owned(
        self: &Arc<Self>,
        broker: &Broker,
        session: &Arc<LiveSession>,
    ) -> Result<(), BoundaryError> {
        let mut receive = {
            let mut owner = session
                .close_receipt
                .lock()
                .map_err(|_| BoundaryError::Unavailable)?;
            let previous = owner.as_ref().map(|receiver| *receiver.borrow());
            match previous {
                Some(None) => owner.as_ref().unwrap().clone(),
                Some(Some(Ok(()))) => {
                    return if session
                        .control
                        .lock()
                        .map_err(|_| BoundaryError::Unavailable)?
                        .closed
                    {
                        Ok(())
                    } else {
                        Err(BoundaryError::Unavailable)
                    };
                }
                _ => {
                    let (completed, receive) = watch::channel(None);
                    *owner = Some(receive.clone());
                    let task = self.clone();
                    let boundary = broker.clone();
                    let target = session.clone();
                    tokio::spawn(async move {
                        let outcome = AssertUnwindSafe(task.close_once(&boundary, &target))
                            .catch_unwind()
                            .await;
                        let result = match outcome {
                            Ok(result) => result,
                            Err(_) => {
                                if let Ok(mut state) = target.control.lock() {
                                    state.closing = false;
                                    state.cleanup_failed = true;
                                }
                                Err(BoundaryError::Unavailable)
                            }
                        };
                        if result.is_err() {
                            if let Ok(mut state) = target.control.lock() {
                                state.closing = false;
                                state.cleanup_failed = true;
                            }
                        }
                        completed.send_replace(Some(result));
                    });
                    receive
                }
            }
        };
        loop {
            if let Some(result) = *receive.borrow() {
                return result;
            }
            receive
                .changed()
                .await
                .map_err(|_| BoundaryError::Unavailable)?;
        }
    }
    async fn close_once(
        self: &Arc<Self>,
        broker: &Broker,
        session: &Arc<LiveSession>,
    ) -> Result<(), BoundaryError> {
        let pending = {
            let mut state = session
                .control
                .lock()
                .map_err(|_| BoundaryError::Unavailable)?;
            if state.closed {
                return Ok(());
            }
            if state.closing {
                return Err(BoundaryError::Conflict);
            }
            state.closing = true;
            session.cancel.cancel();
            broker.revoke_output(&session.id)?;
            let _ = self
                .registry
                .revoke_session(&session.owner.principal, &session.id);
            if let Some(output) = state.output.take() {
                state.retired_output.push(output);
            }
            state
                .pending
                .values()
                .map(|p| {
                    p.cancel.cancel();
                    p.done.clone()
                })
                .collect::<Vec<_>>()
        };
        for mut done in pending {
            while !*done.borrow() {
                if done.changed().await.is_err() {
                    break;
                }
            }
        }
        let target = session.clone();
        let (sources, removed) = tokio::task::spawn_blocking(move || {
            let mut state = target
                .control
                .lock()
                .map_err(|_| BoundaryError::Unavailable)?;
            if let Some(core) = state.core.as_mut() {
                let receipt = core.shutdown();
                if let Ok(receipt) = receipt {
                    state.output_removed = receipt.output_removed;
                    state.core.take();
                }
            }
            Ok::<_, BoundaryError>((std::mem::take(&mut state.sources), state.output_removed))
        })
        .await
        .map_err(|_| BoundaryError::Unavailable)??;
        let mut clean = removed;
        for (_, mut source) in sources {
            source.factory.cancel();
            let joined = source.decode.retire().await.is_ok_and(|r| r.joined);
            let cleanup = source
                .factory
                .finish()
                .await
                .is_ok_and(|r| r.producers_joined && r.provider_cleanup_confirmed);
            self.finish_reservation(
                session,
                source.factory.reservation(),
                joined && cleanup,
                removed,
            );
            clean &= joined && cleanup;
        }
        let mut state = session
            .control
            .lock()
            .map_err(|_| BoundaryError::Unavailable)?;
        clean &=
            acknowledge_retired_outputs(broker, &session.id, &mut state.retired_output, removed);
        if removed {
            state.uncertain.retain(|retained| {
                if !retained.cleanup {
                    return true;
                }
                let _ = self.registry.acknowledge_retirement(
                    &session.owner.principal,
                    retained.reservation.id(),
                    RetirementProof::OutputRevoked,
                );
                self.registry
                    .acknowledge_retirement(
                        &session.owner.principal,
                        retained.reservation.id(),
                        RetirementProof::WorkerReaped,
                    )
                    .is_err()
            });
        }
        clean &= state.uncertain.is_empty();
        if clean {
            clean = self
                .registry
                .close_session(&session.owner.principal, &session.id)
                .is_ok();
        }
        state.closed = clean;
        state.closing = false;
        state.cleanup_failed = !clean;
        if clean {
            Ok(())
        } else {
            Err(BoundaryError::Unavailable)
        }
    }
}

fn crate_geometry(
    value: &Geometry,
    profile: &OutputProfile,
) -> Result<ValidatedGeometry, BoundaryError> {
    geometry(value, profile)
}
fn crate_error(value: RegistryError) -> BoundaryError {
    error(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tokio::sync::oneshot;

    // These paths are deliberately unusable. Pure host tests must not open
    // media, create output directories or launch a subprocess.
    fn config() -> FixtureConfig {
        let mut media = persistent::Config::new(
            "/not-executed/ffmpeg".into(),
            "/not-executed/ffprobe".into(),
            "/not-created/multiview-host-test".into(),
        );
        media.max_duration = Duration::from_secs(10);
        FixtureConfig {
            media,
            profile: OutputProfile {
                profile_id: "fixture-profile".into(),
                canvas: wire::Canvas {
                    width: 320,
                    height: 180,
                    fps: 5,
                },
                max_inputs: 2,
                geometry_modes: vec![wire::GeometryMode::Disjoint, wire::GeometryMode::Pip],
            },
            input_adapters: vec!["http_mpegts".into()],
        }
    }

    fn host(config: FixtureConfig) -> Result<Arc<LiveBackend>, BoundaryError> {
        let registry =
            Arc::new(Registry::new("fixture-server".into(), "fixture-epoch".into()).unwrap());
        let sources = Arc::new(SourceService::new(registry.clone()));
        LiveBackend::new(config, sources, registry)
    }

    fn binding() -> Binding {
        Binding {
            server_epoch: "fixture-epoch".into(),
            session_id: "fixture-session".into(),
            backend_expected: wire::BackendExpected {
                runtime: 1,
                scene: "backend-scene".into(),
                geometry_revision: 2,
                focus_revision: 3,
                audio_revision: 4,
            },
            native_expected: NativeExpected {
                runtime: "native-runtime".into(),
                expected: wire::NativeRevisions {
                    scene: "native-scene".into(),
                    layout_revision: "layout-1".into(),
                    focus_revision: "focus-1".into(),
                    audio_revision: "audio-1".into(),
                },
                slot_id: 0,
                slot_generation: "slot-1".into(),
                source_revision: "source-1".into(),
            },
            backend_slot_revision: 0,
        }
    }

    fn changed_native(original: &NativeExpected, field: usize) -> NativeExpected {
        let mut next = original.clone();
        match field {
            0 => next.runtime = "other-runtime".into(),
            1 => next.expected.scene = "other-scene".into(),
            2 => next.expected.layout_revision = "layout-2".into(),
            3 => next.expected.focus_revision = "focus-2".into(),
            4 => next.expected.audio_revision = "audio-2".into(),
            5 => next.slot_id = 1,
            6 => next.slot_generation = "slot-2".into(),
            7 => next.source_revision = "source-2".into(),
            _ => unreachable!(),
        }
        next
    }

    #[test]
    fn native_changes_are_operation_specific_before_any_effect() {
        let context = binding();
        let layout = Geometry {
            canvas: config().profile.canvas,
            revision: 3,
            mode: wire::GeometryMode::Disjoint,
            rects: vec![wire::Rect {
                slot_id: 0,
                x: 0,
                y: 0,
                width: 320,
                height: 180,
                z: 0,
            }],
        };
        let cases: Vec<(ControlOp, persistent::AudioPolicy, Vec<usize>)> = vec![
            (
                ControlOp::Focus {},
                persistent::AudioPolicy::FollowsFocus,
                vec![3, 4],
            ),
            (ControlOp::Focus {}, persistent::AudioPolicy::Muted, vec![3]),
            (
                ControlOp::Focus {},
                persistent::AudioPolicy::Slot(0),
                vec![3],
            ),
            (
                ControlOp::Audio {
                    policy: wire::AudioPolicy::Muted,
                },
                persistent::AudioPolicy::FollowsFocus,
                vec![4],
            ),
            (
                ControlOp::Layout { geometry: layout },
                persistent::AudioPolicy::FollowsFocus,
                vec![2],
            ),
            (
                ControlOp::Stop {},
                persistent::AudioPolicy::FollowsFocus,
                vec![6, 7],
            ),
            (
                ControlOp::Play {
                    input_grant: "opaque-grant".into(),
                },
                persistent::AudioPolicy::FollowsFocus,
                vec![],
            ),
            (
                ControlOp::Renew {},
                persistent::AudioPolicy::FollowsFocus,
                vec![],
            ),
            (
                ControlOp::Off {},
                persistent::AudioPolicy::FollowsFocus,
                vec![],
            ),
        ];
        for (op, audio, allowed) in cases {
            assert_eq!(
                native_transition(&context, None, &op, audio).unwrap(),
                context.native_expected
            );
            assert_eq!(
                native_transition(&context, Some(&context.native_expected), &op, audio).unwrap(),
                context.native_expected
            );
            for field in 0..8 {
                let next = changed_native(&context.native_expected, field);
                let result = native_transition(&context, Some(&next), &op, audio);
                if allowed.contains(&field) {
                    assert_eq!(result.unwrap(), next, "operation {op:?}, field {field}");
                    let mut mixed = next;
                    mixed.runtime = "unrelated-runtime".into();
                    assert_eq!(
                        native_transition(&context, Some(&mixed), &op, audio),
                        Err(BoundaryError::Invalid)
                    );
                } else {
                    assert_eq!(
                        result,
                        Err(BoundaryError::Invalid),
                        "operation {op:?}, field {field}"
                    );
                }
            }
        }
        let mut invalid = context.native_expected.clone();
        invalid.source_revision = "not an opaque revision".into();
        assert_eq!(
            native_transition(
                &context,
                Some(&invalid),
                &ControlOp::Stop {},
                persistent::AudioPolicy::Muted
            ),
            Err(BoundaryError::Invalid)
        );
    }

    #[test]
    fn configuration_rejects_lifetime_and_profile_without_launching_media() {
        let invalid: Vec<fn(&mut FixtureConfig)> = vec![
            |c| c.media.max_duration = Duration::ZERO,
            |c| c.media.max_duration = FIXTURE_LIMIT + Duration::from_millis(1),
            |c| c.profile.profile_id = "invalid profile".into(),
            |c| c.profile.canvas.width = 0,
            |c| c.profile.canvas.width = 321,
            |c| c.profile.canvas.height = 181,
            |c| c.profile.canvas.width = 1922,
            |c| c.profile.canvas.height = 1082,
            |c| c.profile.canvas.fps = 16,
            |c| c.profile.max_inputs = 10,
            |c| c.profile.geometry_modes.clear(),
            |c| c.profile.geometry_modes = vec![wire::GeometryMode::Disjoint; 2],
            |c| c.profile.max_inputs = 1,
            |c| c.input_adapters.clear(),
        ];
        for modify in invalid {
            let mut candidate = config();
            modify(&mut candidate);
            assert!(matches!(host(candidate), Err(BoundaryError::Configuration)));
        }
        let mut maximum = config();
        maximum.media.max_duration = FIXTURE_LIMIT;
        assert!(host(maximum).is_ok());
    }

    fn owner() -> Authenticated {
        Authenticated {
            principal: wire::Principal {
                subject: "fixture-owner".into(),
                installation_id: "fixture-device".into(),
                permissions: [wire::Permission::MultiviewControl].into_iter().collect(),
            },
            credential_revision: 1,
        }
    }

    // These fixtures exercise selection metadata only. Calling the publication
    // authority with a bounded empty callback models registry promotion; it
    // does not start a decoder, create a Session or qualify media readiness.
    fn selection_fixture() -> (Registry, wire::Principal, Binding) {
        use ottplay_core::multiview::broker::registry::{
            EnrolledInput, Enrollment, ItemEnrollment, SourcePrincipal,
        };
        let principal = owner().principal;
        let registry = Registry::new("fixture-server".into(), "fixture-epoch".into()).unwrap();
        let manager = wire::Principal {
            permissions: [wire::Permission::SourcesManage].into_iter().collect(),
            ..principal.clone()
        };
        registry
            .enroll(
                &manager,
                Enrollment {
                    source_ref: "same-source".into(),
                    profile_uuid: Uuid::from_u128(123),
                    config_revision: "config-1".into(),
                    policy_revision: "policy-1".into(),
                    allowed: [SourcePrincipal::from(&principal)].into_iter().collect(),
                    items: ["item-a", "item-b"]
                        .into_iter()
                        .enumerate()
                        .map(|(index, item)| ItemEnrollment {
                            item_ref: item.into(),
                            identity_version: 1,
                            favorite_sha256: if index == 0 {
                                "a".repeat(64)
                            } else {
                                "b".repeat(64)
                            },
                            kind: "vod".into(),
                            input_adapter: "http-finite".into(),
                            protection: wire::Protection {
                                known: true,
                                restricted: false,
                            },
                            descriptor: wire::Descriptor {
                                title: item.into(),
                                provider: "fixture".into(),
                            },
                            input: EnrolledInput {
                                config_index: index as u64,
                            },
                        })
                        .collect(),
                },
                None,
            )
            .unwrap();
        let context = binding();
        registry.create_session(&principal, &context).unwrap();
        (registry, principal, context)
    }

    fn select_item(
        registry: &Registry,
        principal: &wire::Principal,
        context: &Binding,
        item_ref: &str,
        next_native: Option<NativeExpected>,
    ) -> wire::GrantResponse {
        let catalog = registry
            .sources(
                principal,
                &wire::SourcesRequest {
                    version: wire::VERSION,
                    context: context.clone(),
                    cursor: None,
                },
            )
            .unwrap();
        let item = catalog
            .items
            .iter()
            .find(|item| item.item_ref == item_ref)
            .unwrap();
        registry
            .mint(
                principal,
                &wire::GrantRequest {
                    version: wire::VERSION,
                    context: context.clone(),
                    next_native,
                    source_ref: item.source_ref.clone(),
                    item_ref: item.item_ref.clone(),
                    item_revision: item.item_revision.clone(),
                    identity_version: item.identity_version,
                    favorite_sha256: item.favorite_sha256.clone(),
                    catalog_revision: catalog.catalog_revision.clone(),
                    remaining_budget_ms: 30_000,
                },
            )
            .unwrap()
    }

    fn projected_pair(
        registry: &Registry,
        principal: &wire::Principal,
        context: Option<&Binding>,
        row_slot: u8,
        row_revision: u64,
        row_state: wire::SlotState,
    ) -> Option<(String, String)> {
        project_slot_source_refs(
            registry,
            principal,
            context,
            row_slot,
            row_revision,
            row_state,
        )
        .map(|refs| (refs.source_ref, refs.item_ref))
    }

    #[test]
    fn source_refs_follow_redemption_and_exact_promoted_revision_only() {
        let (registry, principal, context) = selection_fixture();
        let expected = Some(("same-source".into(), "item-a".into()));
        let preparing = wire::SlotState::Preparing;
        assert_eq!(
            projected_pair(&registry, &principal, Some(&context), 0, 0, preparing),
            None
        );
        let grant = select_item(&registry, &principal, &context, "item-a", None);
        // A selection or minted grant is not evidence of redeemed preparation.
        assert_eq!(
            projected_pair(&registry, &principal, Some(&grant.context), 0, 0, preparing),
            None
        );
        let reservation = registry
            .redeem(&principal, &grant.context, &grant.input_grant)
            .unwrap();
        // No resolver or producer has been constructed: redeemed Preparing may
        // nevertheless truthfully identify the exact server-owned selection.
        assert_eq!(
            projected_pair(&registry, &principal, Some(&grant.context), 0, 0, preparing),
            expected
        );
        for state in [
            wire::SlotState::Empty,
            wire::SlotState::Failed,
            wire::SlotState::Closing,
            wire::SlotState::Closed,
        ] {
            assert_eq!(
                projected_pair(&registry, &principal, Some(&grant.context), 0, 0, state),
                None
            );
        }
        assert_eq!(
            projected_pair(&registry, &principal, None, 0, 0, preparing),
            None
        );
        assert_eq!(
            projected_pair(&registry, &principal, Some(&grant.context), 1, 0, preparing),
            None
        );
        assert_eq!(
            projected_pair(&registry, &principal, Some(&grant.context), 0, 1, preparing),
            None
        );
        let mut foreign = principal.clone();
        foreign.installation_id = "other-installation".into();
        assert_eq!(
            projected_pair(&registry, &foreign, Some(&grant.context), 0, 0, preparing),
            None
        );

        let mut focused = grant.context.clone();
        focused.backend_expected.focus_revision += 1;
        focused.native_expected.expected.focus_revision = "focus-2".into();
        registry
            .update_binding(&principal, &grant.context, &focused)
            .unwrap();
        assert_eq!(
            projected_pair(&registry, &principal, Some(&grant.context), 0, 0, preparing),
            None
        );
        assert_eq!(
            projected_pair(&registry, &principal, Some(&focused), 0, 0, preparing),
            expected
        );

        let mut candidate = grant.context.clone();
        candidate.backend_slot_revision += 1;
        registry
            .prepare_attachment(&principal, &grant.context, &candidate, &reservation)
            .unwrap();
        assert_eq!(
            projected_pair(&registry, &principal, Some(&focused), 0, 0, preparing),
            expected
        );
        reservation
            .publication_authority()
            .attach(&reservation.decoder_context(), &mut || Ok(()))
            .unwrap();
        let active = registry
            .current_binding(&principal, &context.session_id, 0)
            .unwrap();
        assert_eq!(active.backend_slot_revision, 1);
        assert_eq!(
            projected_pair(&registry, &principal, Some(&active), 0, 0, preparing),
            None
        );
        assert_eq!(
            projected_pair(&registry, &principal, Some(&focused), 0, 1, preparing),
            None
        );
        for state in [
            preparing,
            wire::SlotState::Playing,
            wire::SlotState::Stalled,
        ] {
            assert_eq!(
                projected_pair(&registry, &principal, Some(&active), 0, 1, state),
                expected
            );
        }
        registry
            .revoke_session(&principal, &context.session_id)
            .unwrap();
        assert_eq!(
            projected_pair(
                &registry,
                &principal,
                Some(&active),
                0,
                1,
                wire::SlotState::Playing
            ),
            None
        );
    }

    #[test]
    fn replacement_within_one_source_never_reports_the_previous_item() {
        let (registry, principal, context) = selection_fixture();
        let first = select_item(&registry, &principal, &context, "item-a", None);
        let reservation = registry
            .redeem(&principal, &first.context, &first.input_grant)
            .unwrap();
        let mut active = first.context.clone();
        active.backend_slot_revision += 1;
        registry
            .prepare_attachment(&principal, &first.context, &active, &reservation)
            .unwrap();
        reservation
            .publication_authority()
            .attach(&reservation.decoder_context(), &mut || Ok(()))
            .unwrap();
        let active = registry
            .current_binding(&principal, &context.session_id, 0)
            .unwrap();
        assert_eq!(
            projected_pair(
                &registry,
                &principal,
                Some(&active),
                0,
                1,
                wire::SlotState::Playing
            ),
            Some(("same-source".into(), "item-a".into()))
        );
        registry
            .retire_reservation(&principal, &reservation)
            .unwrap();
        assert_eq!(
            projected_pair(
                &registry,
                &principal,
                Some(&active),
                0,
                1,
                wire::SlotState::Playing
            ),
            None
        );
        // No worker/output was ever created in this metadata-only fixture.
        registry
            .acknowledge_retirement(&principal, reservation.id(), RetirementProof::OutputRevoked)
            .unwrap();
        registry
            .acknowledge_retirement(&principal, reservation.id(), RetirementProof::WorkerReaped)
            .unwrap();
        let mut stopped = active.clone();
        stopped.backend_slot_revision += 1;
        registry
            .update_binding(&principal, &active, &stopped)
            .unwrap();
        registry.rearm_output(&principal, &stopped).unwrap();
        let mut next_native = stopped.native_expected.clone();
        next_native.slot_generation = "slot-second-item".into();
        next_native.source_revision = "source-second-item".into();
        let second = select_item(&registry, &principal, &stopped, "item-b", Some(next_native));
        assert_eq!(
            projected_pair(
                &registry,
                &principal,
                Some(&second.context),
                0,
                2,
                wire::SlotState::Preparing
            ),
            None
        );
        let _second_reservation = registry
            .redeem(&principal, &second.context, &second.input_grant)
            .unwrap();
        assert_eq!(
            projected_pair(
                &registry,
                &principal,
                Some(&second.context),
                0,
                2,
                wire::SlotState::Preparing
            ),
            Some(("same-source".into(), "item-b".into()))
        );
        assert_eq!(
            projected_pair(
                &registry,
                &principal,
                Some(&active),
                0,
                1,
                wire::SlotState::Playing
            ),
            None
        );
    }

    #[tokio::test]
    async fn output_custody_requires_shutdown_proof_and_released_http_body() {
        use super::super::{Clock, CredentialConfig, Enrollment, ListenerPolicy, OperatorConfig};
        use axum::{
            body::{Body, Bytes},
            http::{Request, StatusCode},
        };
        use tower::Service;

        struct FixedClock;
        impl Clock for FixedClock {
            fn now_ms(&self) -> u64 {
                1_000
            }
        }
        let owner = owner();
        let context = binding();
        let registry =
            Arc::new(Registry::new("fixture-server".into(), "fixture-epoch".into()).unwrap());
        registry.create_session(&owner.principal, &context).unwrap();
        let broker = Broker::new(
            OperatorConfig {
                server_id: "fixture-server".into(),
                server_epoch: "fixture-epoch".into(),
                origin: "http://127.0.0.1:8794".into(),
                listener: ListenerPolicy::default(),
                allowed_origins: vec![],
                signing_key: vec![0x31; 32],
                credentials: vec![CredentialConfig {
                    enrollment: Enrollment {
                        server_id: "fixture-server".into(),
                        origin: "http://127.0.0.1:8794".into(),
                        audience: wire::AUDIENCE.into(),
                        installation_id: owner.principal.installation_id.clone(),
                        control_bearer: "synthetic-fixture-bearer-0000000001".into(),
                    },
                    subject: owner.principal.subject.clone(),
                    permissions: owner.principal.permissions.clone(),
                    revision: owner.credential_revision,
                    expires_at_ms: 100_000,
                }],
            },
            Some(registry),
            Arc::new(FixedClock),
        )
        .unwrap();
        // Synthetic bytes exercise broker custody only; no Session is created
        // and nothing here claims encoder readiness or playable media.
        let output = broker.publish_output(
            &owner,
            &context,
            "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:2.0,\nsegment-000000.ts\n#EXT-X-ENDLIST\n",
            BTreeMap::from([("segment-000000.ts".into(), Bytes::from_static(b"custody-fixture"))]),
            10_000,
        ).unwrap();
        let held = broker
            .router()
            .call(
                Request::get(&output.playlist_path)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(held.status(), StatusCode::OK);
        broker.revoke_output(&context.session_id).unwrap();
        let mut retired = vec![output];

        // Even a confirmed worker stop must wait for an outstanding HTTP body.
        assert!(!acknowledge_retired_outputs(
            &broker,
            &context.session_id,
            &mut retired,
            true
        ));
        assert_eq!(retired.len(), 1);
        drop(held);

        // With no reader masking the issue, a failed/uncertain shutdown must
        // still retain the real broker record, tombstone and host retry entry.
        assert!(!acknowledge_retired_outputs(
            &broker,
            &context.session_id,
            &mut retired,
            false
        ));
        assert_eq!(retired.len(), 1);
        {
            let state = broker.0.mutable.lock().unwrap();
            assert_eq!(state.outputs.len(), 1);
            assert_eq!(state.revoked_outputs.len(), 1);
        }
        assert!(acknowledge_retired_outputs(
            &broker,
            &context.session_id,
            &mut retired,
            true
        ));
        assert!(retired.is_empty());
        assert!(broker.0.mutable.lock().unwrap().outputs.is_empty());
        assert!(broker.0.mutable.lock().unwrap().revoked_outputs.is_empty());
        assert!(acknowledge_retired_outputs(
            &broker,
            &context.session_id,
            &mut retired,
            true
        ));
    }

    #[test]
    fn operation_identity_is_scoped_to_owner_installation_credential_route_and_session() {
        let original = owner();
        let key = LiveBackend::key(&original, "control", "session", "request").unwrap();
        for field in 0..3 {
            let mut other = original.clone();
            match field {
                0 => other.principal.subject = "other-owner".into(),
                1 => other.principal.installation_id = "other-device".into(),
                _ => other.credential_revision += 1,
            }
            assert_ne!(
                LiveBackend::key(&other, "control", "session", "request").unwrap(),
                key
            );
        }
        assert_ne!(
            LiveBackend::key(&original, "create", "session", "request").unwrap(),
            key
        );
        assert_ne!(
            LiveBackend::key(&original, "control", "other-session", "request").unwrap(),
            key
        );
        assert!(LiveBackend::key(&original, "control", "session", "invalid request").is_err());
    }

    #[tokio::test]
    async fn operation_survives_waiter_cancellation_and_never_reexecutes_same_body() {
        let backend = host(config()).unwrap();
        let key = LiveBackend::key(&owner(), "control", "session", "request").unwrap();
        let count = Arc::new(AtomicUsize::new(0));
        let (started, running) = oneshot::channel();
        let (release, held) = oneshot::channel();
        let task = backend.clone();
        let task_key = key.clone();
        let executions = count.clone();
        let waiter = tokio::spawn(async move {
            task.operation(task_key, [1; 32], async move {
                executions.fetch_add(1, Ordering::SeqCst);
                let _ = started.send(());
                let _ = held.await;
                Err(BoundaryError::Unavailable)
            })
            .await
        });
        tokio::time::timeout(Duration::from_secs(5), running)
            .await
            .unwrap()
            .unwrap();
        waiter.abort();
        assert!(waiter.await.is_err());
        assert!(backend.host.lock().unwrap().operations[&key]
            .completed
            .borrow()
            .is_none());

        let executions = count.clone();
        let conflict = backend
            .operation(key.clone(), [2; 32], async move {
                executions.fetch_add(1, Ordering::SeqCst);
                Err(BoundaryError::Invalid)
            })
            .await;
        assert!(matches!(conflict, Err(BoundaryError::Conflict)));

        let task = backend.clone();
        let task_key = key.clone();
        let executions = count.clone();
        let duplicate = tokio::spawn(async move {
            task.operation(task_key, [1; 32], async move {
                executions.fetch_add(1, Ordering::SeqCst);
                Err(BoundaryError::Invalid)
            })
            .await
        });
        tokio::task::yield_now().await;
        assert!(!duplicate.is_finished());
        release.send(()).unwrap();
        let reply = tokio::time::timeout(Duration::from_secs(5), duplicate)
            .await
            .unwrap()
            .unwrap();
        assert!(matches!(reply, Err(BoundaryError::Unavailable)));

        let executions = count.clone();
        let replay = backend
            .operation(key, [1; 32], async move {
                executions.fetch_add(1, Ordering::SeqCst);
                Err(BoundaryError::Invalid)
            })
            .await;
        assert!(matches!(replay, Err(BoundaryError::Unavailable)));
        assert_eq!(count.load(Ordering::SeqCst), 1);
    }
}
