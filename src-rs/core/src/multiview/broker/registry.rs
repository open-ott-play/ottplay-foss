//! Server-owned source authority. Native witnesses never enroll sources.
//!
//! All mutations and publication callbacks share one barrier. Callbacks must be
//! bounded and must not re-enter this registry; lock order is registry -> output.
use super::wire::{
    self, Binding, CatalogItem, Descriptor, GrantRequest, GrantResponse, Permission, Principal,
    Protection, SourcesRequest, SourcesResponse,
};
use crate::multiview::decoder::{BoundContext, DecoderError, PublicationAuthority};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, MutexGuard, Weak,
    },
    time::{Duration, Instant},
};
use uuid::Uuid;

const MAX_SOURCES: usize = 256;
const MAX_ITEMS: usize = 4096;
const MAX_SESSIONS: usize = 64;
const MAX_SESSION_IDENTITIES: usize = 4096;
const MAX_PENDING: usize = 18;
const MAX_CURSORS: usize = 64;
const GRANT_TTL: Duration = Duration::from_secs(30);
const SESSION_TTL: Duration = Duration::from_secs(90);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RegistryError {
    InvalidRequest,
    Forbidden,
    NotFound,
    Stale,
    Expired,
    Limit,
    Busy,
    Revoked,
    Unavailable,
}
impl RegistryError {
    pub fn code(self) -> &'static str {
        match self {
            Self::InvalidRequest => "invalid_request",
            Self::Forbidden => "policy_restricted",
            Self::NotFound => "source_unavailable",
            Self::Stale => "source_changed",
            Self::Expired => "source_expired",
            Self::Limit => "limit_exceeded",
            Self::Busy => "busy",
            Self::Revoked => "policy_restricted",
            Self::Unavailable => "unavailable",
        }
    }
}
type Result<T> = std::result::Result<T, RegistryError>;
impl std::fmt::Display for RegistryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.code())
    }
}
impl std::error::Error for RegistryError {}

/// Trusted server configuration index. No path, URL or credential is accepted.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct EnrolledInput {
    pub config_index: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct SourcePrincipal {
    pub subject: String,
    pub installation_id: String,
}
impl From<&Principal> for SourcePrincipal {
    fn from(p: &Principal) -> Self {
        Self {
            subject: p.subject.clone(),
            installation_id: p.installation_id.clone(),
        }
    }
}

/// Construct only from trusted SourcesManage configuration, never native JSON.
#[derive(Clone)]
pub struct ItemEnrollment {
    pub item_ref: String,
    pub identity_version: u8,
    pub favorite_sha256: String,
    pub kind: String,
    pub input_adapter: String,
    pub protection: Protection,
    pub descriptor: Descriptor,
    pub input: EnrolledInput,
}
#[derive(Clone)]
pub struct Enrollment {
    pub source_ref: String,
    pub profile_uuid: Uuid,
    pub config_revision: String,
    pub policy_revision: String,
    pub allowed: BTreeSet<SourcePrincipal>,
    pub items: Vec<ItemEnrollment>,
}

#[derive(Clone)]
struct Item {
    catalog: CatalogItem,
    input: EnrolledInput,
}
struct Source {
    revision: String,
    profile_uuid: Uuid,
    config_revision: String,
    policy_revision: String,
    allowed: BTreeSet<SourcePrincipal>,
    items: BTreeMap<String, Item>,
}
#[derive(Clone)]
struct Selection {
    source_ref: String,
    source_revision: String,
    profile_uuid: Uuid,
    config_revision: String,
    policy_revision: String,
    item: Item,
}
struct Session {
    owner: SourcePrincipal,
    slots: BTreeMap<u8, Binding>,
    expires: Instant,
    revoked: bool,
    output_blocked: bool,
}
struct Grant {
    owner: SourcePrincipal,
    // A replay must match the actual pre-transition request, not merely another
    // plausible prior binding that happens to produce the same committed state.
    request: GrantRequest,
    context: Binding,
    selection: Selection,
    expires: Instant,
}
struct Cursor {
    owner: SourcePrincipal,
    context: Binding,
    catalog: String,
    offset: usize,
    expires: Instant,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Phase {
    Preparing,
    Attaching,
    Active,
    Retiring,
}
struct Lease {
    owner: SourcePrincipal,
    issue_context: Binding,
    context: Binding,
    selection: Selection,
    prepare_deadline: Instant,
    phase: Phase,
    promotion: Option<Binding>,
    revoked: Arc<AtomicBool>,
    output_revoked: bool,
    reaped: bool,
}
struct State {
    server_id: String,
    epoch: String,
    catalog: String,
    sources: BTreeMap<String, Source>,
    sessions: BTreeMap<String, Session>,
    used_session_ids: BTreeSet<String>,
    grants: BTreeMap<String, Grant>,
    cursors: BTreeMap<String, Cursor>,
    leases: BTreeMap<String, Lease>,
}

#[derive(Clone)]
pub struct Registry {
    state: Arc<Mutex<State>>,
}

/// An opaque reservation, not proof that a worker has been activated or reaped.
#[derive(Clone)]
pub struct Reservation {
    id: String,
    input: EnrolledInput,
    context: BoundContext,
    revoked: Arc<AtomicBool>,
    authority: Arc<dyn PublicationAuthority>,
}
impl Reservation {
    pub fn id(&self) -> &str {
        &self.id
    }
    pub fn input(&self) -> EnrolledInput {
        self.input
    }
    pub fn revoked(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.revoked)
    }
    pub fn decoder_context(&self) -> BoundContext {
        self.context
    }
    pub fn publication_authority(&self) -> Arc<dyn PublicationAuthority> {
        Arc::clone(&self.authority)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Retirement {
    pub reservation_id: String,
    pub session_id: String,
    pub slot_id: u8,
    pub cancellation_requested: bool,
    pub output_revoked: bool,
    pub reaped: bool,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RetirementProof {
    OutputRevoked,
    WorkerReaped,
}

fn fresh() -> String {
    Uuid::new_v4().simple().to_string()
}
fn principal_ok(p: &Principal, permission: Permission) -> Result<()> {
    if !p.permits(permission) || !wire::opaque(&p.subject) || !wire::opaque(&p.installation_id) {
        return Err(RegistryError::Forbidden);
    }
    Ok(())
}
fn same_owner(a: &SourcePrincipal, p: &Principal) -> bool {
    a.subject == p.subject && a.installation_id == p.installation_id
}
fn decoder_context(b: &Binding) -> BoundContext {
    let e = &b.backend_expected;
    BoundContext {
        runtime: e.runtime,
        slot_id: b.native_expected.slot_id,
        source_revision: b.backend_slot_revision,
        geometry_revision: e.geometry_revision,
        focus_revision: e.focus_revision,
        audio_revision: e.audio_revision,
    }
}
/// Active unchanged input survives focus/audio updates and geometry changes.
fn same_active_source(a: &Binding, b: &Binding) -> bool {
    a.server_epoch == b.server_epoch
        && a.session_id == b.session_id
        && a.backend_expected.runtime == b.backend_expected.runtime
        && a.backend_expected.scene == b.backend_expected.scene
        && a.native_expected.runtime == b.native_expected.runtime
        && a.native_expected.expected.scene == b.native_expected.expected.scene
        && a.native_expected.slot_id == b.native_expected.slot_id
        && a.native_expected.slot_generation == b.native_expected.slot_generation
        && a.native_expected.source_revision == b.native_expected.source_revision
        && a.backend_slot_revision == b.backend_slot_revision
}
/// Only an already redeemed explicit-slot source preparation may ignore focus
/// and audio revisions. Geometry, source identity and both runtimes still fence
/// its eventual attachment. Original grants and control commands use full CAS.
fn same_preparing_source(a: &Binding, b: &Binding) -> bool {
    same_active_source(a, b)
        && a.backend_expected.geometry_revision == b.backend_expected.geometry_revision
        && a.native_expected.expected.layout_revision == b.native_expected.expected.layout_revision
}
/// An attachment may advance its target source identity, not its scene or raster.
fn same_preparation_scene(a: &Binding, b: &Binding) -> bool {
    a.server_epoch == b.server_epoch
        && a.session_id == b.session_id
        && a.backend_expected.runtime == b.backend_expected.runtime
        && a.backend_expected.scene == b.backend_expected.scene
        && a.backend_expected.geometry_revision == b.backend_expected.geometry_revision
        && a.native_expected.runtime == b.native_expected.runtime
        && a.native_expected.expected.scene == b.native_expected.expected.scene
        && a.native_expected.expected.layout_revision == b.native_expected.expected.layout_revision
}
fn same_scene(a: &Binding, b: &Binding) -> bool {
    a.server_epoch == b.server_epoch
        && a.session_id == b.session_id
        && a.backend_expected == b.backend_expected
        && a.native_expected.runtime == b.native_expected.runtime
        && a.native_expected.expected == b.native_expected.expected
}

/// Grant selection may advance only the target's source intent. Scene-wide
/// revisions and identity remain authoritative server state, not UI proposals.
fn grant_context(request: &GrantRequest) -> Result<Binding> {
    let mut committed = request.context.clone();
    if let Some(next) = &request.next_native {
        let prior = &request.context.native_expected;
        if next.runtime != prior.runtime
            || next.expected != prior.expected
            || next.slot_id != prior.slot_id
        {
            return Err(RegistryError::InvalidRequest);
        }
        committed.native_expected = next.clone();
        if !committed.valid() {
            return Err(RegistryError::InvalidRequest);
        }
    }
    Ok(committed)
}

/// All fallible admission and the bounded backend callback happen before this
/// mutation. The caller holds the registry barrier throughout.
fn apply_binding(s: &mut State, expected: &Binding, next: &Binding) {
    let session = s.sessions.get_mut(&expected.session_id).unwrap();
    for current in session.slots.values_mut() {
        current.backend_expected = next.backend_expected.clone();
        current.native_expected.runtime = next.native_expected.runtime.clone();
        current.native_expected.expected = next.native_expected.expected.clone();
    }
    session
        .slots
        .insert(next.native_expected.slot_id, next.clone());
    s.grants
        .retain(|_, grant| grant.context.session_id != expected.session_id);
    s.cursors
        .retain(|_, cursor| cursor.context.session_id != expected.session_id);
    let ids: Vec<_> = s
        .leases
        .iter()
        .filter(|(_, lease)| {
            lease.context.session_id == expected.session_id
                && s.sessions[&expected.session_id]
                    .slots
                    .get(&lease.context.native_expected.slot_id)
                    .is_none_or(|current| {
                        if matches!(lease.phase, Phase::Preparing | Phase::Attaching) {
                            !same_preparing_source(current, &lease.context)
                        } else {
                            !same_active_source(current, &lease.context)
                        }
                    })
        })
        .map(|(id, _)| id.clone())
        .collect();
    for id in ids {
        retire(s, &id);
    }
}
fn live_session<'a>(s: &'a State, p: &Principal, id: &str, now: Instant) -> Result<&'a Session> {
    principal_ok(p, Permission::MultiviewControl)?;
    let session = s.sessions.get(id).ok_or(RegistryError::NotFound)?;
    if !same_owner(&session.owner, p) {
        return Err(RegistryError::Forbidden);
    }
    if session.revoked {
        return Err(RegistryError::Revoked);
    }
    if now >= session.expires {
        return Err(RegistryError::Expired);
    }
    Ok(session)
}
fn authorize(s: &State, p: &Principal, b: &Binding, now: Instant) -> Result<()> {
    if !b.valid() || b.server_epoch != s.epoch {
        return Err(RegistryError::Stale);
    }
    let session = live_session(s, p, &b.session_id, now)?;
    if session.slots.get(&b.native_expected.slot_id) != Some(b) {
        return Err(RegistryError::Stale);
    }
    Ok(())
}
fn selected_current(s: &State, owner: &SourcePrincipal, v: &Selection) -> bool {
    s.sources.get(&v.source_ref).is_some_and(|source| {
        source.revision == v.source_revision
            && source.profile_uuid == v.profile_uuid
            && source.config_revision == v.config_revision
            && source.policy_revision == v.policy_revision
            && source.allowed.contains(owner)
            && source
                .items
                .get(&v.item.catalog.item_ref)
                .is_some_and(|item| item.catalog == v.item.catalog && item.input == v.item.input)
    })
}
fn retirement(id: &str, lease: &Lease) -> Retirement {
    Retirement {
        reservation_id: id.to_owned(),
        session_id: lease.context.session_id.clone(),
        slot_id: lease.context.native_expected.slot_id,
        cancellation_requested: lease.revoked.load(Ordering::Acquire),
        output_revoked: lease.output_revoked,
        reaped: lease.reaped,
    }
}
fn retire(s: &mut State, id: &str) {
    if let Some(lease) = s.leases.get_mut(id) {
        lease.phase = Phase::Retiring;
        lease.revoked.store(true, Ordering::Release);
        if let Some(session) = s.sessions.get_mut(&lease.context.session_id) {
            session.output_blocked = true;
        }
    }
}
fn sweep(s: &mut State, now: Instant) {
    s.grants.retain(|_, grant| now < grant.expires);
    s.cursors.retain(|_, cursor| now < cursor.expires);
    let retired: Vec<_> = s
        .leases
        .iter()
        .filter(|(_, lease)| {
            lease.phase != Phase::Retiring
                && (matches!(lease.phase, Phase::Preparing | Phase::Attaching)
                    && now >= lease.prepare_deadline
                    || !selected_current(s, &lease.owner, &lease.selection)
                    || s.sessions
                        .get(&lease.context.session_id)
                        .is_none_or(|session| session.revoked || now >= session.expires))
        })
        .map(|(id, _)| id.clone())
        .collect();
    for id in retired {
        retire(s, &id);
    }
}

impl Registry {
    pub fn new(server_id: String, server_epoch: String) -> Result<Self> {
        if !wire::opaque(&server_id) || !wire::opaque(&server_epoch) {
            return Err(RegistryError::InvalidRequest);
        }
        Ok(Self {
            state: Arc::new(Mutex::new(State {
                server_id,
                epoch: server_epoch,
                catalog: fresh(),
                sources: BTreeMap::new(),
                sessions: BTreeMap::new(),
                used_session_ids: BTreeSet::new(),
                grants: BTreeMap::new(),
                cursors: BTreeMap::new(),
                leases: BTreeMap::new(),
            })),
        })
    }
    fn lock(&self) -> Result<MutexGuard<'_, State>> {
        self.state.lock().map_err(|_| RegistryError::Unavailable)
    }

    pub fn metadata(&self) -> Result<(String, String, String)> {
        let s = self.lock()?;
        Ok((s.server_id.clone(), s.epoch.clone(), s.catalog.clone()))
    }

    /// `expected_revision=None` creates only; updates must CAS the current revision.
    /// Every update gives all items new revisions and revokes pending/active work.
    pub fn enroll(
        &self,
        p: &Principal,
        enrollment: Enrollment,
        expected_revision: Option<&str>,
    ) -> Result<String> {
        principal_ok(p, Permission::SourcesManage)?;
        if !wire::opaque(&enrollment.source_ref)
            || enrollment.profile_uuid.is_nil()
            || !wire::opaque(&enrollment.config_revision)
            || !wire::opaque(&enrollment.policy_revision)
            || enrollment.allowed.is_empty()
            || enrollment.allowed.len() > 128
            || enrollment
                .allowed
                .iter()
                .any(|a| !wire::opaque(&a.subject) || !wire::opaque(&a.installation_id))
            || enrollment.items.len() > MAX_ITEMS
        {
            return Err(RegistryError::InvalidRequest);
        }
        let mut items = BTreeMap::new();
        for item in enrollment.items {
            if !wire::opaque(&item.item_ref)
                || item.identity_version != 1
                || !wire::favorite_digest(&item.favorite_sha256)
                || !matches!(item.kind.as_str(), "live" | "vod" | "file")
                || !wire::opaque(&item.input_adapter)
                || item.descriptor.title.is_empty()
                || item.descriptor.title.len() > 512
                || item.descriptor.title.chars().any(char::is_control)
                || !wire::opaque(&item.descriptor.provider)
                || items.contains_key(&item.item_ref)
            {
                return Err(RegistryError::InvalidRequest);
            }
            let catalog = CatalogItem {
                source_ref: enrollment.source_ref.clone(),
                item_ref: item.item_ref.clone(),
                item_revision: fresh(),
                identity_version: item.identity_version,
                favorite_sha256: item.favorite_sha256,
                kind: item.kind,
                input_adapter: item.input_adapter,
                protection: item.protection,
                descriptor: item.descriptor,
            };
            items.insert(
                item.item_ref,
                Item {
                    catalog,
                    input: item.input,
                },
            );
        }
        let mut s = self.lock()?;
        let existing = s.sources.get(&enrollment.source_ref);
        if existing.map(|row| row.revision.as_str()) != expected_revision {
            return Err(RegistryError::Stale);
        }
        if existing.is_none() && s.sources.len() >= MAX_SOURCES {
            return Err(RegistryError::Limit);
        }
        let others: usize = s
            .sources
            .iter()
            .filter(|(id, _)| *id != &enrollment.source_ref)
            .map(|(_, row)| row.items.len())
            .sum();
        if others + items.len() > MAX_ITEMS {
            return Err(RegistryError::Limit);
        }
        let revision = fresh();
        let source_ref = enrollment.source_ref;
        s.sources.insert(
            source_ref.clone(),
            Source {
                revision: revision.clone(),
                profile_uuid: enrollment.profile_uuid,
                config_revision: enrollment.config_revision,
                policy_revision: enrollment.policy_revision,
                allowed: enrollment.allowed,
                items,
            },
        );
        Self::source_changed(&mut s, &source_ref);
        Ok(revision)
    }
    pub fn remove_source(
        &self,
        p: &Principal,
        source_ref: &str,
        expected_revision: &str,
    ) -> Result<Vec<Retirement>> {
        principal_ok(p, Permission::SourcesManage)?;
        let mut s = self.lock()?;
        if s.sources
            .get(source_ref)
            .map(|source| source.revision.as_str())
            != Some(expected_revision)
        {
            return Err(RegistryError::Stale);
        }
        s.sources.remove(source_ref);
        Self::source_changed(&mut s, source_ref);
        Ok(s.leases
            .iter()
            .filter(|(_, lease)| lease.selection.source_ref == source_ref)
            .map(|(id, lease)| retirement(id, lease))
            .collect())
    }
    fn source_changed(s: &mut State, source_ref: &str) {
        s.catalog = fresh();
        s.cursors.clear();
        s.grants
            .retain(|_, grant| grant.selection.source_ref != source_ref);
        let ids: Vec<_> = s
            .leases
            .iter()
            .filter(|(_, lease)| lease.selection.source_ref == source_ref)
            .map(|(id, _)| id.clone())
            .collect();
        for id in ids {
            retire(s, &id);
        }
    }
    pub fn create_session(&self, p: &Principal, context: &Binding) -> Result<()> {
        principal_ok(p, Permission::MultiviewControl)?;
        let mut s = self.lock()?;
        let now = Instant::now();
        if !context.valid() || context.server_epoch != s.epoch {
            return Err(RegistryError::InvalidRequest);
        }
        if s.used_session_ids.contains(&context.session_id) {
            return Err(RegistryError::Busy);
        }
        if s.sessions.len() >= MAX_SESSIONS || s.used_session_ids.len() >= MAX_SESSION_IDENTITIES {
            return Err(RegistryError::Limit);
        }
        s.used_session_ids.insert(context.session_id.clone());
        s.sessions.insert(
            context.session_id.clone(),
            Session {
                owner: p.into(),
                slots: BTreeMap::from([(context.native_expected.slot_id, context.clone())]),
                expires: now + SESSION_TTL,
                revoked: false,
                output_blocked: false,
            },
        );
        Ok(())
    }
    pub fn add_slot(&self, p: &Principal, context: &Binding) -> Result<()> {
        let mut s = self.lock()?;
        let session = live_session(&s, p, &context.session_id, Instant::now())?;
        if !context.valid()
            || context.server_epoch != s.epoch
            || session.slots.values().any(|old| !same_scene(old, context))
        {
            return Err(RegistryError::Stale);
        }
        if session.slots.contains_key(&context.native_expected.slot_id) {
            return Err(RegistryError::Busy);
        }
        s.sessions
            .get_mut(&context.session_id)
            .unwrap()
            .slots
            .insert(context.native_expected.slot_id, context.clone());
        Ok(())
    }
    pub fn authorize(&self, p: &Principal, context: &Binding) -> Result<()> {
        let s = self.lock()?;
        authorize(&s, p, context, Instant::now())
    }

    /// Owner-bound recovery read. No supplied native revisions are adopted, and
    /// no unknown slot is created. Mutating callers still require full CAS.
    pub fn current_binding(&self, p: &Principal, session_id: &str, slot_id: u8) -> Result<Binding> {
        if slot_id >= 9 || !wire::opaque(session_id) {
            return Err(RegistryError::InvalidRequest);
        }
        let mut s = self.lock()?;
        let now = Instant::now();
        sweep(&mut s, now);
        live_session(&s, p, session_id, now)?
            .slots
            .get(&slot_id)
            .cloned()
            .ok_or(RegistryError::NotFound)
    }

    /// Compare-and-swap authoritative state after a native/backend transition.
    /// Shared scene revisions advance on all slots; only the target's source
    /// revision changes. Active unchanged sources survive focus/layout changes.
    pub fn update_binding(&self, p: &Principal, expected: &Binding, next: &Binding) -> Result<()> {
        self.commit_binding(p, expected, next, &mut || Ok(()))
    }

    /// Atomically commit a trusted host's bounded backend CAS and registry state.
    /// The host validates its operation-specific native transition first. The
    /// callback must not re-enter Registry, probe, spawn, join or perform I/O; on
    /// error it must leave backend state unchanged. Lock order is host control ->
    /// Registry -> core state. No fallible registry checks follow the callback.
    pub fn commit_binding(
        &self,
        p: &Principal,
        expected: &Binding,
        next: &Binding,
        operation: &mut dyn FnMut() -> Result<()>,
    ) -> Result<()> {
        let mut s = self.lock()?;
        authorize(&s, p, expected, Instant::now())?;
        if !next.valid()
            || next.server_epoch != s.epoch
            || next.session_id != expected.session_id
            || next.native_expected.slot_id != expected.native_expected.slot_id
        {
            return Err(RegistryError::InvalidRequest);
        }
        operation()?;
        apply_binding(&mut s, expected, next);
        Ok(())
    }
    pub fn sources(&self, p: &Principal, request: &SourcesRequest) -> Result<SourcesResponse> {
        let mut s = self.lock()?;
        let now = Instant::now();
        sweep(&mut s, now);
        if request.version != wire::VERSION {
            return Err(RegistryError::InvalidRequest);
        }
        authorize(&s, p, &request.context, now)?;
        let owner = SourcePrincipal::from(p);
        let offset = if let Some(cursor) = &request.cursor {
            let cursor = s.cursors.get(cursor).ok_or(RegistryError::Expired)?;
            if cursor.owner != owner
                || cursor.context != request.context
                || cursor.catalog != s.catalog
            {
                return Err(RegistryError::Stale);
            }
            cursor.offset
        } else {
            0
        };
        let rows: Vec<_> = s
            .sources
            .values()
            .filter(|source| source.allowed.contains(&owner))
            .flat_map(|source| source.items.values())
            .filter(|item| item.catalog.protection.known && !item.catalog.protection.restricted)
            .map(|item| item.catalog.clone())
            .collect();
        if offset > rows.len() {
            return Err(RegistryError::Stale);
        }
        let items = rows
            .iter()
            .skip(offset)
            .take(128)
            .cloned()
            .collect::<Vec<_>>();
        let next_cursor = if offset + items.len() < rows.len() {
            let next = offset + items.len();
            if let Some((id, _)) = s.cursors.iter().find(|(_, cursor)| {
                cursor.owner == owner
                    && cursor.context == request.context
                    && cursor.catalog == s.catalog
                    && cursor.offset == next
            }) {
                Some(id.clone())
            } else {
                if s.cursors
                    .values()
                    .filter(|cursor| cursor.context.session_id == request.context.session_id)
                    .count()
                    >= MAX_CURSORS
                {
                    return Err(RegistryError::Limit);
                }
                let id = fresh();
                let catalog = s.catalog.clone();
                s.cursors.insert(
                    id.clone(),
                    Cursor {
                        owner,
                        context: request.context.clone(),
                        catalog,
                        offset: next,
                        expires: now + GRANT_TTL,
                    },
                );
                Some(id)
            }
        } else {
            None
        };
        Ok(SourcesResponse {
            version: wire::VERSION,
            server_id: s.server_id.clone(),
            context: request.context.clone(),
            catalog_revision: s.catalog.clone(),
            items,
            next_cursor,
        })
    }
    pub fn mint(&self, p: &Principal, request: &GrantRequest) -> Result<GrantResponse> {
        self.mint_with_commit(p, request, &mut |_| Ok(()))
    }
    /// Validate and stage the complete grant before publishing its HTTP receipt.
    /// The bounded callback shares the source/revocation barrier and must obey
    /// Registry -> credential/cache lock order. It must not re-enter Registry or
    /// perform I/O; on error it must not publish a receipt. The native transition
    /// and immutable grant commit only after callback success, without a later
    /// fallible registry check.
    pub fn mint_with_commit(
        &self,
        p: &Principal,
        request: &GrantRequest,
        operation: &mut dyn FnMut(&GrantResponse) -> Result<()>,
    ) -> Result<GrantResponse> {
        self.mint_at_with_commit(p, request, None, operation)
    }
    /// Replaying an idempotent HTTP response must not revive a consumed, stale,
    /// expired or revoked input grant. This does not extend its original expiry.
    pub fn validate_cached_grant(
        &self,
        p: &Principal,
        request: &GrantRequest,
        response: &GrantResponse,
    ) -> Result<()> {
        let mut s = self.lock()?;
        let now = Instant::now();
        sweep(&mut s, now);
        Self::validate_cached_locked(&s, p, request, response, now)
    }
    /// Cached secret publication uses the same barrier as source revocation.
    /// The callback must bound work and retain the registry -> output lock order.
    pub fn with_cached_grant_authority(
        &self,
        p: &Principal,
        request: &GrantRequest,
        response: &GrantResponse,
        operation: &mut dyn FnMut(&GrantResponse) -> Result<()>,
    ) -> Result<()> {
        let mut s = self.lock()?;
        let now = Instant::now();
        sweep(&mut s, now);
        Self::validate_cached_locked(&s, p, request, response, now)?;
        let mut refreshed = response.clone();
        refreshed.expires_in_ms = s.grants[&response.input_grant]
            .expires
            .duration_since(now)
            .as_millis() as u32;
        operation(&refreshed)
    }
    fn validate_cached_locked(
        s: &State,
        p: &Principal,
        request: &GrantRequest,
        response: &GrantResponse,
        now: Instant,
    ) -> Result<()> {
        // A successful source-intent transition makes its original prior CAS
        // stale. Replays authenticate the committed state AND stored original
        // request, never reapply the prior transition or infer a new binding.
        authorize(&s, p, &response.context, now)?;
        if request.version != wire::VERSION
            || request.remaining_budget_ms == 0
            || response.version != wire::VERSION
            || response.server_id != s.server_id
            || response.context != grant_context(request)?
            || response.catalog_revision != s.catalog
            || request.catalog_revision != s.catalog
        {
            return Err(RegistryError::Stale);
        }
        let grant = s
            .grants
            .get(&response.input_grant)
            .ok_or(RegistryError::Expired)?;
        if !same_owner(&grant.owner, p) {
            return Err(RegistryError::Forbidden);
        }
        let item = &grant.selection.item.catalog;
        if grant.request != *request
            || grant.context != response.context
            || !selected_current(&s, &grant.owner, &grant.selection)
            || response.item != *item
            || response.policy_revision != grant.selection.policy_revision
            || request.source_ref != item.source_ref
            || request.item_ref != item.item_ref
            || request.item_revision != item.item_revision
            || request.identity_version != item.identity_version
            || request.favorite_sha256 != item.favorite_sha256
        {
            return Err(RegistryError::Stale);
        }
        if !item.protection.known || item.protection.restricted {
            return Err(RegistryError::Forbidden);
        }
        Ok(())
    }
    #[cfg(test)]
    fn mint_at(
        &self,
        p: &Principal,
        request: &GrantRequest,
        now: Instant,
    ) -> Result<GrantResponse> {
        self.mint_at_with_commit(p, request, Some(now), &mut |_| Ok(()))
    }
    fn mint_at_with_commit(
        &self,
        p: &Principal,
        request: &GrantRequest,
        admission_time: Option<Instant>,
        operation: &mut dyn FnMut(&GrantResponse) -> Result<()>,
    ) -> Result<GrantResponse> {
        let mut s = self.lock()?;
        // Production admission starts after acquiring the authority barrier:
        // time spent queued behind another operation cannot extend a session
        // or revive an expired grant. Explicit time is only for bounded tests.
        let now = admission_time.unwrap_or_else(Instant::now);
        sweep(&mut s, now);
        if request.version != wire::VERSION || request.remaining_budget_ms == 0 {
            return Err(RegistryError::InvalidRequest);
        }
        authorize(&s, p, &request.context, now)?;
        let committed = grant_context(request)?;
        let changed = committed != request.context;
        if request.catalog_revision != s.catalog {
            return Err(RegistryError::Stale);
        }
        let owner = SourcePrincipal::from(p);
        let source = s
            .sources
            .get(&request.source_ref)
            .ok_or(RegistryError::NotFound)?;
        if !source.allowed.contains(&owner) {
            return Err(RegistryError::Forbidden);
        }
        let item = source
            .items
            .get(&request.item_ref)
            .ok_or(RegistryError::NotFound)?;
        if item.catalog.item_revision != request.item_revision
            || item.catalog.identity_version != request.identity_version
            || item.catalog.favorite_sha256 != request.favorite_sha256
        {
            return Err(RegistryError::Stale);
        }
        if !item.catalog.protection.known || item.catalog.protection.restricted {
            return Err(RegistryError::Forbidden);
        }
        let selection = Selection {
            source_ref: request.source_ref.clone(),
            source_revision: source.revision.clone(),
            profile_uuid: source.profile_uuid,
            config_revision: source.config_revision.clone(),
            policy_revision: source.policy_revision.clone(),
            item: item.clone(),
        };
        if s.grants
            .values()
            .filter(|grant| grant.context.session_id == request.context.session_id)
            .count()
            >= MAX_PENDING
        {
            return Err(RegistryError::Limit);
        }
        // Initial host qualification permits no implicit candidate replacement.
        // A pending grant must be redeemed/cancelled/expired, and every target
        // lease must finish retirement, before a different native source intent.
        if changed
            && (s.grants.values().any(|grant| {
                grant.context.session_id == committed.session_id
                    && grant.context.native_expected.slot_id == committed.native_expected.slot_id
            }) || s.leases.values().any(|lease| {
                lease.context.session_id == committed.session_id
                    && lease.context.native_expected.slot_id == committed.native_expected.slot_id
            }))
        {
            return Err(RegistryError::Busy);
        }
        let ttl = Duration::from_millis(u64::from(request.remaining_budget_ms)).min(GRANT_TTL);
        let expires = (now + ttl).min(s.sessions[&request.context.session_id].expires);
        let id = fresh();
        let response = GrantResponse {
            version: wire::VERSION,
            server_id: s.server_id.clone(),
            context: committed.clone(),
            item: selection.item.catalog.clone(),
            catalog_revision: s.catalog.clone(),
            policy_revision: selection.policy_revision.clone(),
            input_grant: id.clone(),
            expires_in_ms: expires.duration_since(now).as_millis() as u32,
        };
        let grant = Grant {
            owner,
            request: request.clone(),
            context: committed.clone(),
            selection,
            expires,
        };
        operation(&response)?;
        if changed {
            s.sessions
                .get_mut(&committed.session_id)
                .unwrap()
                .slots
                .insert(committed.native_expected.slot_id, committed.clone());
            s.cursors.retain(|_, cursor| {
                cursor.context.session_id != committed.session_id
                    || cursor.context.native_expected.slot_id != committed.native_expected.slot_id
            });
        }
        s.grants.insert(id, grant);
        Ok(response)
    }
    pub fn redeem(&self, p: &Principal, context: &Binding, grant: &str) -> Result<Reservation> {
        self.redeem_with_time(p, context, grant, None)
    }
    #[cfg(test)]
    fn redeem_at(
        &self,
        p: &Principal,
        context: &Binding,
        grant: &str,
        now: Instant,
    ) -> Result<Reservation> {
        self.redeem_with_time(p, context, grant, Some(now))
    }
    fn redeem_with_time(
        &self,
        p: &Principal,
        context: &Binding,
        grant: &str,
        admission_time: Option<Instant>,
    ) -> Result<Reservation> {
        let mut s = self.lock()?;
        let now = admission_time.unwrap_or_else(Instant::now);
        sweep(&mut s, now);
        authorize(&s, p, context, now)?;
        let pending = s.grants.get(grant).ok_or(RegistryError::Expired)?;
        if !same_owner(&pending.owner, p) {
            return Err(RegistryError::Forbidden);
        }
        if &pending.context != context || !selected_current(&s, &pending.owner, &pending.selection)
        {
            return Err(RegistryError::Stale);
        }
        if s.leases.values().any(|lease| {
            lease.context.session_id == context.session_id
                && lease.context.native_expected.slot_id == context.native_expected.slot_id
        }) {
            return Err(RegistryError::Busy);
        }
        let pending = s.grants.remove(grant).unwrap();
        let id = fresh();
        let revoked = Arc::new(AtomicBool::new(false));
        let bound = decoder_context(context);
        let result = Reservation {
            id: id.clone(),
            input: pending.selection.item.input,
            context: bound,
            revoked: Arc::clone(&revoked),
            authority: Arc::new(RegistryPublication {
                state: Arc::downgrade(&self.state),
                id: id.clone(),
                context: bound,
            }),
        };
        s.leases.insert(
            id,
            Lease {
                owner: pending.owner,
                issue_context: pending.context.clone(),
                context: pending.context,
                selection: pending.selection,
                prepare_deadline: pending.expires,
                phase: Phase::Preparing,
                promotion: None,
                revoked,
                output_revoked: false,
                reaped: false,
            },
        );
        Ok(result)
    }
    /// Resolver monitors retain the immutable issue binding. Redeemed preparation
    /// tolerates unrelated focus/audio changes; active input also survives layout
    /// changes and checks its promoted source identity.
    pub fn validate_reservation(
        &self,
        p: &Principal,
        issued: &Binding,
        reservation: &Reservation,
    ) -> Result<()> {
        let mut s = self.lock()?;
        let now = Instant::now();
        sweep(&mut s, now);
        let lease = s
            .leases
            .get(reservation.id())
            .ok_or(RegistryError::NotFound)?;
        if !same_owner(&lease.owner, p) || !Arc::ptr_eq(&lease.revoked, &reservation.revoked) {
            return Err(RegistryError::Forbidden);
        }
        if &lease.issue_context != issued {
            return Err(RegistryError::Stale);
        }
        let session = live_session(&s, p, &issued.session_id, now)?;
        if lease.phase == Phase::Retiring || lease.revoked.load(Ordering::Acquire) {
            return Err(RegistryError::Revoked);
        }
        if !selected_current(&s, &lease.owner, &lease.selection) {
            return Err(RegistryError::Stale);
        }
        let current = session
            .slots
            .get(&lease.context.native_expected.slot_id)
            .ok_or(RegistryError::Stale)?;
        if if lease.phase == Phase::Active {
            !same_active_source(current, &lease.context)
        } else {
            !same_preparing_source(current, &lease.context)
        } {
            return Err(RegistryError::Stale);
        }
        Ok(())
    }
    /// Arm the next GrantedFile attachment. This does not activate the decoder.
    /// The attachment itself enters PublicationAuthority once, which holds the
    /// barrier over the backend callback and promotion; callers must not wrap a
    /// GrantedFile.attach call inside another registry publication callback.
    /// `expected` remains the exact issue binding. Only the already redeemed
    /// source preparation may survive newer focus/audio revisions.
    pub fn prepare_attachment(
        &self,
        p: &Principal,
        expected: &Binding,
        next: &Binding,
        reservation: &Reservation,
    ) -> Result<()> {
        let mut s = self.lock()?;
        let now = Instant::now();
        sweep(&mut s, now);
        let session = live_session(&s, p, &expected.session_id, now)?;
        let current = session
            .slots
            .get(&expected.native_expected.slot_id)
            .ok_or(RegistryError::Stale)?;
        if !expected.valid()
            || expected.server_epoch != s.epoch
            || !same_preparing_source(current, expected)
        {
            return Err(RegistryError::Stale);
        }
        if !next.valid()
            || !same_preparation_scene(expected, next)
            || next.native_expected.slot_id != expected.native_expected.slot_id
        {
            return Err(RegistryError::InvalidRequest);
        }
        let lease = s
            .leases
            .get(&reservation.id)
            .ok_or(RegistryError::NotFound)?;
        if !same_owner(&lease.owner, p) || !Arc::ptr_eq(&lease.revoked, &reservation.revoked) {
            return Err(RegistryError::Forbidden);
        }
        if lease.phase != Phase::Preparing || lease.revoked.load(Ordering::Acquire) {
            return Err(RegistryError::Revoked);
        }
        if &lease.context != expected || !selected_current(&s, &lease.owner, &lease.selection) {
            return Err(RegistryError::Stale);
        }
        let lease = s.leases.get_mut(&reservation.id).unwrap();
        lease.phase = Phase::Attaching;
        lease.promotion = Some(next.clone());
        Ok(())
    }
    pub fn renew(&self, p: &Principal, context: &Binding) -> Result<()> {
        self.renew_with_time(p, context, None)
    }
    #[cfg(test)]
    fn renew_at(&self, p: &Principal, context: &Binding, now: Instant) -> Result<()> {
        self.renew_with_time(p, context, Some(now))
    }
    fn renew_with_time(
        &self,
        p: &Principal,
        context: &Binding,
        admission_time: Option<Instant>,
    ) -> Result<()> {
        let mut s = self.lock()?;
        let now = admission_time.unwrap_or_else(Instant::now);
        sweep(&mut s, now);
        authorize(&s, p, context, now)?;
        if s.leases.values().any(|lease| {
            lease.context.session_id == context.session_id
                && (lease.phase == Phase::Retiring
                    || !selected_current(&s, &lease.owner, &lease.selection))
        }) {
            return Err(RegistryError::Revoked);
        }
        s.sessions.get_mut(&context.session_id).unwrap().expires = now + SESSION_TTL;
        Ok(())
    }
    pub fn revoke_session(&self, p: &Principal, session_id: &str) -> Result<Vec<Retirement>> {
        principal_ok(p, Permission::MultiviewControl)?;
        let mut s = self.lock()?;
        let session = s
            .sessions
            .get_mut(session_id)
            .ok_or(RegistryError::NotFound)?;
        if !same_owner(&session.owner, p) {
            return Err(RegistryError::Forbidden);
        }
        session.revoked = true;
        session.output_blocked = true;
        s.grants
            .retain(|_, grant| grant.context.session_id != session_id);
        s.cursors
            .retain(|_, cursor| cursor.context.session_id != session_id);
        let ids: Vec<_> = s
            .leases
            .iter()
            .filter(|(_, lease)| lease.context.session_id == session_id)
            .map(|(id, _)| id.clone())
            .collect();
        for id in &ids {
            retire(&mut s, id);
        }
        Ok(ids.iter().map(|id| retirement(id, &s.leases[id])).collect())
    }
    /// Credential revocation is a server management action, not a native field.
    pub fn revoke_principal(
        &self,
        manager: &Principal,
        owner: &SourcePrincipal,
    ) -> Result<Vec<Retirement>> {
        principal_ok(manager, Permission::SourcesManage)?;
        let mut s = self.lock()?;
        let sessions: BTreeSet<_> = s
            .sessions
            .iter()
            .filter(|(_, session)| &session.owner == owner)
            .map(|(id, _)| id.clone())
            .collect();
        for id in &sessions {
            let session = s.sessions.get_mut(id).unwrap();
            session.revoked = true;
            session.output_blocked = true;
        }
        s.grants.retain(|_, grant| &grant.owner != owner);
        s.cursors.retain(|_, cursor| &cursor.owner != owner);
        let ids: Vec<_> = s
            .leases
            .iter()
            .filter(|(_, lease)| &lease.owner == owner)
            .map(|(id, _)| id.clone())
            .collect();
        for id in &ids {
            retire(&mut s, id);
        }
        Ok(ids.iter().map(|id| retirement(id, &s.leases[id])).collect())
    }
    pub fn retire_slot(&self, p: &Principal, context: &Binding) -> Result<Vec<Retirement>> {
        let mut s = self.lock()?;
        authorize(&s, p, context, Instant::now())?;
        s.grants.retain(|_, grant| {
            grant.context.session_id != context.session_id
                || grant.context.native_expected.slot_id != context.native_expected.slot_id
        });
        let ids: Vec<_> = s
            .leases
            .iter()
            .filter(|(_, lease)| {
                lease.context.session_id == context.session_id
                    && lease.context.native_expected.slot_id == context.native_expected.slot_id
            })
            .map(|(id, _)| id.clone())
            .collect();
        for id in &ids {
            retire(&mut s, id);
        }
        Ok(ids.iter().map(|id| retirement(id, &s.leases[id])).collect())
    }
    /// Owned cleanup remains possible after expiry, promotion or scene changes.
    /// It requests cancellation only; output revocation/reaping need real proofs.
    pub fn retire_reservation(
        &self,
        p: &Principal,
        reservation: &Reservation,
    ) -> Result<Retirement> {
        let mut s = self.lock()?;
        let lease = s
            .leases
            .get(reservation.id())
            .ok_or(RegistryError::NotFound)?;
        if !same_owner(&lease.owner, p) || !Arc::ptr_eq(&lease.revoked, &reservation.revoked) {
            return Err(RegistryError::Forbidden);
        }
        retire(&mut s, reservation.id());
        Ok(retirement(reservation.id(), &s.leases[reservation.id()]))
    }
    pub fn retirements(&self, p: &Principal, session_id: &str) -> Result<Vec<Retirement>> {
        principal_ok(p, Permission::MultiviewControl)?;
        let mut s = self.lock()?;
        sweep(&mut s, Instant::now());
        let session = s.sessions.get(session_id).ok_or(RegistryError::NotFound)?;
        if !same_owner(&session.owner, p) {
            return Err(RegistryError::Forbidden);
        }
        Ok(s.leases
            .iter()
            .filter(|(_, lease)| {
                lease.context.session_id == session_id && lease.phase == Phase::Retiring
            })
            .map(|(id, lease)| retirement(id, lease))
            .collect())
    }
    /// Call only after the corresponding owner has observed completion. Merely
    /// requesting cancellation is never proof of output revocation or reaping.
    pub fn acknowledge_retirement(
        &self,
        p: &Principal,
        reservation_id: &str,
        proof: RetirementProof,
    ) -> Result<Retirement> {
        principal_ok(p, Permission::MultiviewControl)?;
        let mut s = self.lock()?;
        let lease = s
            .leases
            .get_mut(reservation_id)
            .ok_or(RegistryError::NotFound)?;
        if !same_owner(&lease.owner, p) {
            return Err(RegistryError::Forbidden);
        }
        if lease.phase != Phase::Retiring {
            return Err(RegistryError::Busy);
        }
        match proof {
            RetirementProof::OutputRevoked => lease.output_revoked = true,
            RetirementProof::WorkerReaped => lease.reaped = true,
        }
        let result = retirement(reservation_id, lease);
        if lease.output_revoked && lease.reaped {
            s.leases.remove(reservation_id);
        }
        Ok(result)
    }
    /// After compositor scrubbing/replacement and all retirement proofs, enable a
    /// fresh output generation. Never call just because cancellation was sent.
    pub fn rearm_output(&self, p: &Principal, context: &Binding) -> Result<()> {
        let mut s = self.lock()?;
        sweep(&mut s, Instant::now());
        authorize(&s, p, context, Instant::now())?;
        if s.leases.values().any(|lease| {
            lease.context.session_id == context.session_id && lease.phase == Phase::Retiring
        }) {
            return Err(RegistryError::Busy);
        }
        s.sessions
            .get_mut(&context.session_id)
            .unwrap()
            .output_blocked = false;
        Ok(())
    }
    pub fn with_session_authority(
        &self,
        p: &Principal,
        session_id: &str,
        operation: &mut dyn FnMut() -> Result<()>,
    ) -> Result<()> {
        let mut s = self.lock()?;
        let now = Instant::now();
        sweep(&mut s, now);
        let session = live_session(&s, p, session_id, now)?;
        if session.output_blocked {
            return Err(RegistryError::Revoked);
        }
        operation()
    }
    pub fn with_binding_authority(
        &self,
        p: &Principal,
        context: &Binding,
        operation: &mut dyn FnMut() -> Result<()>,
    ) -> Result<()> {
        let mut s = self.lock()?;
        let now = Instant::now();
        sweep(&mut s, now);
        authorize(&s, p, context, now)?;
        if s.sessions[&context.session_id].output_blocked {
            return Err(RegistryError::Revoked);
        }
        operation()
    }
    pub fn close_session(&self, p: &Principal, session_id: &str) -> Result<()> {
        principal_ok(p, Permission::MultiviewControl)?;
        let mut s = self.lock()?;
        let session = s.sessions.get(session_id).ok_or(RegistryError::NotFound)?;
        if !same_owner(&session.owner, p) {
            return Err(RegistryError::Forbidden);
        }
        if !session.revoked
            || s.leases
                .values()
                .any(|lease| lease.context.session_id == session_id)
        {
            return Err(RegistryError::Busy);
        }
        s.sessions.remove(session_id);
        Ok(())
    }
}

struct RegistryPublication {
    state: Weak<Mutex<State>>,
    id: String,
    context: BoundContext,
}
impl RegistryPublication {
    fn deliver(
        &self,
        context: &BoundContext,
        operation: &mut dyn FnMut() -> std::result::Result<(), DecoderError>,
        attaching: bool,
    ) -> std::result::Result<(), DecoderError> {
        if context != &self.context {
            return Err(DecoderError::BindingMismatch);
        }
        let state = self.state.upgrade().ok_or(DecoderError::Revoked)?;
        let mut s = state.lock().map_err(|_| DecoderError::PublicationDenied)?;
        let now = Instant::now();
        sweep(&mut s, now);
        let lease = s.leases.get(&self.id).ok_or(DecoderError::Revoked)?;
        if lease.phase
            != (if attaching {
                Phase::Attaching
            } else {
                Phase::Active
            })
            || lease.revoked.load(Ordering::Acquire)
        {
            return Err(DecoderError::PublicationDenied);
        }
        if !selected_current(&s, &lease.owner, &lease.selection) {
            return Err(DecoderError::Revoked);
        }
        let session = s
            .sessions
            .get(&lease.context.session_id)
            .ok_or(DecoderError::Revoked)?;
        if session.revoked || now >= session.expires {
            return Err(DecoderError::Expired);
        }
        let current = session
            .slots
            .get(&lease.context.native_expected.slot_id)
            .ok_or(DecoderError::StaleGeneration)?;
        let promotion = if lease.phase == Phase::Attaching {
            if !same_preparing_source(current, &lease.context) {
                return Err(DecoderError::StaleGeneration);
            }
            let mut next = lease
                .promotion
                .clone()
                .ok_or(DecoderError::PublicationDenied)?;
            // Preparation may finish after several focus/audio changes. Rebase
            // only these globals under the barrier; never restore issue-time
            // revisions or move the command to the currently focused slot.
            next.backend_expected.focus_revision = current.backend_expected.focus_revision;
            next.backend_expected.audio_revision = current.backend_expected.audio_revision;
            next.native_expected.expected.focus_revision =
                current.native_expected.expected.focus_revision.clone();
            next.native_expected.expected.audio_revision =
                current.native_expected.expected.audio_revision.clone();
            Some(next)
        } else {
            if !same_active_source(current, &lease.context) {
                return Err(DecoderError::StaleGeneration);
            }
            None
        };
        if let Err(error) = operation() {
            if promotion.is_some() {
                retire(&mut s, &self.id);
            }
            return Err(error);
        }
        if let Some(next) = promotion {
            let session = s.sessions.get_mut(&next.session_id).unwrap();
            for current in session.slots.values_mut() {
                current.backend_expected = next.backend_expected.clone();
                current.native_expected.runtime = next.native_expected.runtime.clone();
                current.native_expected.expected = next.native_expected.expected.clone();
            }
            session
                .slots
                .insert(next.native_expected.slot_id, next.clone());
            let lease = s.leases.get_mut(&self.id).unwrap();
            lease.context = next.clone();
            lease.phase = Phase::Active;
            lease.promotion = None;
            s.grants
                .retain(|_, grant| grant.context.session_id != next.session_id);
            s.cursors
                .retain(|_, cursor| cursor.context.session_id != next.session_id);
            let ids: Vec<_> = s
                .leases
                .iter()
                .filter(|(_, lease)| {
                    lease.context.session_id == next.session_id
                        && s.sessions[&next.session_id]
                            .slots
                            .get(&lease.context.native_expected.slot_id)
                            .is_none_or(|current| {
                                if matches!(lease.phase, Phase::Preparing | Phase::Attaching) {
                                    !same_preparing_source(current, &lease.context)
                                } else {
                                    !same_active_source(current, &lease.context)
                                }
                            })
                })
                .map(|(id, _)| id.clone())
                .collect();
            for id in ids {
                retire(&mut s, &id);
            }
        }
        Ok(())
    }
}

impl PublicationAuthority for RegistryPublication {
    fn attach(
        &self,
        context: &BoundContext,
        operation: &mut dyn FnMut() -> std::result::Result<(), DecoderError>,
    ) -> std::result::Result<(), DecoderError> {
        self.deliver(context, operation, true)
    }
    fn publish(
        &self,
        context: &BoundContext,
        operation: &mut dyn FnMut() -> std::result::Result<(), DecoderError>,
    ) -> std::result::Result<(), DecoderError> {
        self.deliver(context, operation, false)
    }
}

#[cfg(test)]
#[path = "registry_tests.rs"]
mod tests;
