//! Private broker boundary, constructed only by a trusted in-process owner.
//!
//! This module is deliberately not registered by main.rs. A catalog/grant is not
//! a decoder qualification: production control remains unavailable and caps=0.
//! Credentials and source enrollment have separate authorities. No HTTP request
//! provisions a credential, supplies a source URL, or acquires sources-manage.
use axum::{
    body::{Body, Bytes},
    extract::{DefaultBodyLimit, OriginalUri, Path, State},
    http::{HeaderMap, HeaderValue, Method, StatusCode, Version},
    response::{IntoResponse, Response},
    routing::{get, post},
    Extension, Router,
};
use futures_util::Stream;
use hmac::{Hmac, Mac};
use ottplay_core::multiview::broker::wire::{
    self, Binding, Capabilities, ControlRequest, GrantRequest, GrantResponse, Output, Permission,
    Principal, SessionCreateRequest, SourcesRequest, StatusRequest,
};
use serde::Serialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    net::{IpAddr, Ipv4Addr},
    pin::Pin,
    sync::{Arc, Mutex},
    task::{Context, Poll},
    time::{Instant, SystemTime, UNIX_EPOCH},
};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use uuid::Uuid;

use crate::media_connection::{ConnectionControl, MediaAuthority};
use ottplay_core::multiview::broker::registry::{Registry, RegistryError, SourcePrincipal};

#[cfg(test)]
#[path = "multiview_broker_live.rs"]
mod live;
#[cfg(test)]
#[path = "multiview_broker_live_output.rs"]
mod live_output;
#[cfg(test)]
pub use live::FixtureConfig;
#[cfg(test)]
pub(super) type LiveWatermark = Arc<dyn Fn() -> Result<u64, BoundaryError> + Send + Sync>;

const PREFIX: &str = "/multiview/v1";
const CACHE_ENTRIES: usize = 64;
const CACHE_BYTES: usize = 262_144;
const CACHE_TTL_MS: u64 = 120_000;
const PLAYLIST_BYTES: usize = 65_536;
const SEGMENT_BYTES: usize = 8_388_608;
const OUTPUT_BYTES: usize = 32 * 1024 * 1024;
const OUTPUTS: usize = 8;
const CHUNK_BYTES: usize = 65_536;
const OUTPUT_TTL_MS: u64 = 90_000;

/// A monotonic millisecond clock with an epoch-compatible initial value.
/// Injected clocks are trusted test/owner dependencies, never request fields.
pub trait Clock: Send + Sync {
    fn now_ms(&self) -> u64;
}
pub struct SystemClock {
    base: u64,
    started: Instant,
}
impl Default for SystemClock {
    fn default() -> Self {
        Self {
            base: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis()
                .min(u64::MAX as u128) as u64,
            started: Instant::now(),
        }
    }
}
impl Clock for SystemClock {
    fn now_ms(&self) -> u64 {
        self.base
            .saturating_add(self.started.elapsed().as_millis().min(u64::MAX as u128) as u64)
    }
}

/// Mirrors the dedicated native enrollment document. Deliberately no Debug or
/// Serialize implementation: bearer material must not enter public receipts.
pub struct Enrollment {
    pub server_id: String,
    pub origin: String,
    pub audience: String,
    pub installation_id: String,
    pub control_bearer: String,
}
pub struct CredentialConfig {
    pub enrollment: Enrollment,
    pub subject: String,
    pub permissions: BTreeSet<Permission>,
    pub revision: u64,
    pub expires_at_ms: u64,
}
pub struct ListenerPolicy {
    pub bind_ip: IpAddr,
    pub https: bool,
    pub lan_approved: bool,
}
impl Default for ListenerPolicy {
    fn default() -> Self {
        Self {
            bind_ip: IpAddr::V4(Ipv4Addr::LOCALHOST),
            https: false,
            lan_approved: false,
        }
    }
}
/// Constructed from private operator configuration, never from an HTTP body.
pub struct OperatorConfig {
    pub server_id: String,
    pub server_epoch: String,
    pub origin: String,
    pub listener: ListenerPolicy,
    pub allowed_origins: Vec<String>,
    pub signing_key: Vec<u8>,
    pub credentials: Vec<CredentialConfig>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BoundaryError {
    Configuration,
    Unauthorized,
    Forbidden,
    Invalid,
    Conflict,
    Unavailable,
    Limit,
    Revoked,
}
impl BoundaryError {
    fn response(self) -> Response {
        let (status, code) = match self {
            Self::Configuration | Self::Unavailable => {
                (StatusCode::SERVICE_UNAVAILABLE, "backend_unavailable")
            }
            Self::Unauthorized => (StatusCode::UNAUTHORIZED, "unauthorized"),
            Self::Forbidden => (StatusCode::FORBIDDEN, "forbidden"),
            Self::Invalid => (StatusCode::BAD_REQUEST, "invalid_request"),
            Self::Conflict => (StatusCode::CONFLICT, "revision_conflict"),
            Self::Limit => (StatusCode::TOO_MANY_REQUESTS, "resource_limit"),
            Self::Revoked => (StatusCode::GONE, "authority_revoked"),
        };
        private_response((status, axum::Json(json!({"version": 1, "error": code}))).into_response())
    }
}

struct Credential {
    principal: Principal,
    digest: [u8; 32],
    revision: u64,
    expires_at_ms: u64,
    revoked: bool,
}
#[derive(Clone)]
pub struct Authenticated {
    principal: Principal,
    credential_revision: u64,
}
impl Authenticated {
    pub fn principal(&self) -> &Principal {
        &self.principal
    }
}
#[derive(Clone, Hash, PartialEq, Eq)]
struct CacheKey {
    subject: String,
    installation: String,
    credential_revision: u64,
    epoch: String,
    session: String,
    endpoint: &'static str,
    request_id: String,
}
struct Cached {
    body_digest: [u8; 32],
    bytes: Bytes,
    expires: u64,
}
struct OutputRecord {
    authenticated: Authenticated,
    binding: Binding,
    generation: String,
    nonce: String,
    expires: u64,
    files: BTreeMap<String, Bytes>,
    token: String,
    #[cfg(test)]
    live: Option<Arc<live_output::LiveOutput>>,
    #[cfg(test)]
    live_watermark: Option<LiveWatermark>,
}
struct Mutable {
    credentials: HashMap<String, Credential>,
    cache: HashMap<CacheKey, Cached>,
    outputs: HashMap<String, Arc<OutputRecord>>,
    // A revocation tombstone is separate from the backend's worker-reaped proof.
    revoked_outputs: BTreeSet<String>,
}
struct Inner {
    server_id: String,
    origin: String,
    epoch: String,
    allowed_origins: BTreeSet<String>,
    signing_key: Vec<u8>,
    registry: Option<Arc<Registry>>,
    clock: Arc<dyn Clock>,
    mutable: Mutex<Mutable>,
    mutations: tokio::sync::Mutex<()>,
    streams: Arc<Semaphore>,
    #[cfg(test)]
    live: Option<Arc<live::LiveBackend>>,
    #[cfg(test)]
    live_bytes: Arc<Semaphore>,
}
#[derive(Clone)]
pub struct Broker(Arc<Inner>);

fn exact_origin(origin: &str, https_only: bool) -> bool {
    let Ok(url) = reqwest::Url::parse(origin) else {
        return false;
    };
    url.origin().ascii_serialization() == origin
        && url.username().is_empty()
        && url.password().is_none()
        && url
            .host_str()
            .is_some_and(|host| !host.contains('*') && !host.contains('%'))
        && url.query().is_none()
        && url.fragment().is_none()
        && (url.scheme() == "https"
            || (!https_only
                && url.scheme() == "http"
                && (url
                    .host_str()
                    .is_some_and(|host| host.parse::<IpAddr>().is_ok_and(|ip| ip.is_loopback()))
                    || reqwest::Url::parse("http://[::1]")
                        .is_ok_and(|loopback| url.host() == loopback.host()))))
}
fn private_lan(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => ip.is_private() && !ip.is_unspecified(),
        IpAddr::V6(ip) => ip.segments()[0] & 0xfe00 == 0xfc00,
    }
}
fn secret(value: &str) -> bool {
    (32..=128).contains(&value.len())
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}
fn digest(value: &[u8]) -> [u8; 32] {
    Sha256::digest(value).into()
}
fn same_digest(a: &[u8; 32], b: &[u8; 32]) -> bool {
    a.iter()
        .zip(b)
        .fold(0u8, |difference, (a, b)| difference | (a ^ b))
        == 0
}

fn registry_error(error: RegistryError) -> BoundaryError {
    match error {
        RegistryError::Forbidden => BoundaryError::Forbidden,
        RegistryError::InvalidRequest => BoundaryError::Invalid,
        RegistryError::Limit => BoundaryError::Limit,
        RegistryError::Expired | RegistryError::Revoked => BoundaryError::Revoked,
        RegistryError::Unavailable => BoundaryError::Unavailable,
        _ => BoundaryError::Conflict,
    }
}

impl Broker {
    pub fn new(
        config: OperatorConfig,
        registry: Option<Arc<Registry>>,
        clock: Arc<dyn Clock>,
    ) -> Result<Self, BoundaryError> {
        let lan = !config.listener.bind_ip.is_loopback();
        if !wire::opaque(&config.server_id)
            || !wire::opaque(&config.server_epoch)
            || (lan
                && (!private_lan(config.listener.bind_ip)
                    || !config.listener.lan_approved
                    || !config.listener.https))
            || !exact_origin(&config.origin, lan)
            || (config.listener.https && !config.origin.starts_with("https://"))
            || !(32..=64).contains(&config.signing_key.len())
            || config.allowed_origins.len() > 16
            || config.credentials.is_empty()
            || config.credentials.len() > 64
        {
            return Err(BoundaryError::Configuration);
        }
        let mut origins = BTreeSet::new();
        for origin in config.allowed_origins {
            if !exact_origin(&origin, lan) || !origins.insert(origin) {
                return Err(BoundaryError::Configuration);
            }
        }
        let mut credentials = HashMap::new();
        let mut installations = BTreeSet::new();
        let mut secrets = BTreeSet::new();
        for value in config.credentials {
            let e = value.enrollment;
            if e.server_id != config.server_id
                || e.origin != config.origin
                || e.audience != wire::AUDIENCE
                || !wire::opaque(&e.installation_id)
                || !wire::opaque(&value.subject)
                || value.revision == 0
                || value.expires_at_ms <= clock.now_ms()
                || !secret(&e.control_bearer)
                || value.permissions != BTreeSet::from([Permission::MultiviewControl])
                || e.control_bearer.as_bytes() == config.signing_key
                || !installations.insert(e.installation_id.clone())
                || !secrets.insert(digest(e.control_bearer.as_bytes()))
            {
                return Err(BoundaryError::Configuration);
            }
            let principal = Principal {
                subject: value.subject.clone(),
                installation_id: e.installation_id,
                permissions: value.permissions,
            };
            let credential = Credential {
                principal,
                digest: digest(e.control_bearer.as_bytes()),
                revision: value.revision,
                expires_at_ms: value.expires_at_ms,
                revoked: false,
            };
            if credentials.insert(value.subject, credential).is_some() {
                return Err(BoundaryError::Configuration);
            }
        }
        if let Some(registry) = &registry {
            let (server_id, epoch, _) = registry
                .metadata()
                .map_err(|_| BoundaryError::Configuration)?;
            if server_id != config.server_id || epoch != config.server_epoch {
                return Err(BoundaryError::Configuration);
            }
        }
        Ok(Self(Arc::new(Inner {
            server_id: config.server_id,
            origin: config.origin,
            epoch: config.server_epoch,
            allowed_origins: origins,
            signing_key: config.signing_key,
            registry,
            clock,
            mutable: Mutex::new(Mutable {
                credentials,
                cache: HashMap::new(),
                outputs: HashMap::new(),
                revoked_outputs: BTreeSet::new(),
            }),
            mutations: tokio::sync::Mutex::new(()),
            streams: Arc::new(Semaphore::new(8)),
            #[cfg(test)]
            live: None,
            #[cfg(test)]
            live_bytes: Arc::new(Semaphore::new(OUTPUT_BYTES)),
        })))
    }

    /// Test-only, explicitly owned live fixture. This neither starts a listener
    /// nor makes the production constructor advertise a decoder capability.
    #[cfg(test)]
    pub fn new_fixture(
        config: OperatorConfig,
        registry: Arc<Registry>,
        clock: Arc<dyn Clock>,
        fixture: FixtureConfig,
    ) -> Result<
        (
            Self,
            Arc<ottplay_core::multiview::broker::runtime::SourceService>,
        ),
        BoundaryError,
    > {
        if !config.listener.bind_ip.is_loopback() {
            return Err(BoundaryError::Configuration);
        }
        let service = Arc::new(
            ottplay_core::multiview::broker::runtime::SourceService::new(registry.clone()),
        );
        let backend = live::LiveBackend::new(fixture, service.clone(), registry.clone())?;
        let mut broker = Self::new(config, Some(registry), clock)?;
        Arc::get_mut(&mut broker.0)
            .ok_or(BoundaryError::Configuration)?
            .live = Some(backend);
        Ok((broker, service))
    }

    /// Merely constructing a Router does not start a listener or qualify inputs.
    pub fn router(&self) -> Router {
        Router::new()
            .route(
                "/multiview/v1/capabilities",
                get(capabilities).head(deny_method).options(preflight),
            )
            .route("/multiview/v1/sources", post(sources).options(preflight))
            .route(
                "/multiview/v1/input-grants",
                post(input_grants).options(preflight),
            )
            .route("/multiview/v1/control", post(control).options(preflight))
            .route("/multiview/v1/sessions", post(sessions).options(preflight))
            .route("/multiview/v1/status", post(status).options(preflight))
            .route(
                "/multiview/v1/media/:lease/:file",
                get(media).head(deny_method),
            )
            .layer(DefaultBodyLimit::max(wire::MAX_CONTROL_BYTES))
            .layer(axum::middleware::map_response(|response: Response| async {
                private_response(response)
            }))
            .with_state(self.clone())
    }

    fn origin(&self, headers: &HeaderMap) -> Result<Option<String>, BoundaryError> {
        let values: Vec<_> = headers.get_all("origin").iter().collect();
        if values.is_empty() {
            return Ok(None);
        }
        if values.len() != 1 {
            return Err(BoundaryError::Forbidden);
        }
        let value = values[0].to_str().map_err(|_| BoundaryError::Forbidden)?;
        if !self.0.allowed_origins.contains(value) {
            return Err(BoundaryError::Forbidden);
        }
        Ok(Some(value.to_string()))
    }

    pub fn authenticate(&self, headers: &HeaderMap) -> Result<Authenticated, BoundaryError> {
        self.origin(headers)?;
        let values: Vec<_> = headers.get_all("authorization").iter().collect();
        if values.len() != 1 {
            return Err(BoundaryError::Unauthorized);
        }
        let token = values[0]
            .to_str()
            .ok()
            .and_then(|v| v.strip_prefix("Bearer "))
            .filter(|v| secret(v))
            .ok_or(BoundaryError::Unauthorized)?;
        let requested = digest(token.as_bytes());
        let state = self
            .0
            .mutable
            .lock()
            .map_err(|_| BoundaryError::Unavailable)?;
        let now = self.0.clock.now_ms();
        let mut found = None;
        for value in state.credentials.values() {
            if same_digest(&value.digest, &requested) && !value.revoked && now < value.expires_at_ms
            {
                found = Some(Authenticated {
                    principal: value.principal.clone(),
                    credential_revision: value.revision,
                });
            }
        }
        found.ok_or(BoundaryError::Unauthorized)
    }

    fn current_credential(&self, state: &Mutable, owner: &Authenticated) -> bool {
        state
            .credentials
            .get(&owner.principal.subject)
            .is_some_and(|record| {
                !record.revoked
                    && record.revision == owner.credential_revision
                    && record.principal == owner.principal
                    && self.0.clock.now_ms() < record.expires_at_ms
            })
    }

    /// Operator-only in-process credential revocation. Cached secrets and every
    /// open output body observe this without waiting for worker cleanup. Registry
    /// revocation also cancels active source authority, not merely output reads.
    pub fn revoke_credential(&self, subject: &str) -> Result<(), BoundaryError> {
        let owner = {
            let mut state = self
                .0
                .mutable
                .lock()
                .map_err(|_| BoundaryError::Unavailable)?;
            let credential = state
                .credentials
                .get_mut(subject)
                .ok_or(BoundaryError::Invalid)?;
            credential.revoked = true;
            let owner = SourcePrincipal::from(&credential.principal);
            state.cache.retain(|key, _| key.subject != subject);
            owner
        };
        // Never invert the registry -> output publication lock order. This
        // administrative identity is constructed only here, never from native.
        if let Some(registry) = &self.0.registry {
            let manager = Principal {
                subject: "multiview_credential_manager".into(),
                installation_id: self.0.server_id.clone(),
                permissions: BTreeSet::from([Permission::SourcesManage]),
            };
            registry
                .revoke_principal(&manager, &owner)
                .map_err(|_| BoundaryError::Unavailable)?;
        }
        Ok(())
    }

    /// A future qualified session bootstrap must cap both its renewable owner
    /// lease and absolute custody ceiling by this remaining credential lifetime.
    /// Media polling is not a substitute for cancelling expired source work.
    pub fn credential_remaining_ms(&self, owner: &Authenticated) -> Result<u64, BoundaryError> {
        let state = self
            .0
            .mutable
            .lock()
            .map_err(|_| BoundaryError::Unavailable)?;
        if !self.current_credential(&state, owner) {
            return Err(BoundaryError::Unauthorized);
        }
        Ok(state.credentials[&owner.principal.subject]
            .expires_at_ms
            .saturating_sub(self.0.clock.now_ms()))
    }

    fn authorized<T>(
        &self,
        owner: &Authenticated,
        binding: &Binding,
        callback: impl FnOnce(&mut Mutable) -> Result<T, BoundaryError>,
    ) -> Result<T, BoundaryError> {
        if !binding.valid() || binding.server_epoch != self.0.epoch {
            return Err(BoundaryError::Conflict);
        }
        let registry = self.0.registry.as_ref().ok_or(BoundaryError::Unavailable)?;
        let mut callback = Some(callback);
        let mut result = Err(BoundaryError::Revoked);
        let checked = registry.with_binding_authority(&owner.principal, binding, &mut || {
            if let Some(callback) = callback.take() {
                result = match self.0.mutable.lock() {
                    Ok(mut state) if self.current_credential(&state, owner) => callback(&mut state),
                    Ok(_) => Err(BoundaryError::Unauthorized),
                    Err(_) => Err(BoundaryError::Unavailable),
                };
            }
            Ok(())
        });
        if checked.is_err() {
            return Err(BoundaryError::Revoked);
        }
        result
    }

    // Media callbacks run on the connection executor. Never wait for either
    // publication barrier: an unverified authority closes only this response,
    // leaving the unchanged output available to a later request.
    fn try_session_media<T>(
        &self,
        owner: &Authenticated,
        session: &str,
        callback: impl FnOnce(&mut Mutable) -> Result<T, BoundaryError>,
    ) -> Result<T, BoundaryError> {
        let registry = self.0.registry.as_ref().ok_or(BoundaryError::Unavailable)?;
        let mut callback = Some(callback);
        let mut result = Err(BoundaryError::Revoked);
        let checked = registry.try_with_session_authority(&owner.principal, session, &mut || {
            if let Some(callback) = callback.take() {
                result = match self.0.mutable.try_lock() {
                    Ok(mut state) if self.current_credential(&state, owner) => callback(&mut state),
                    Ok(_) => Err(BoundaryError::Unauthorized),
                    Err(_) => Err(BoundaryError::Unavailable),
                };
            }
            Ok(())
        });
        match checked {
            Ok(()) => result,
            Err(RegistryError::Busy | RegistryError::Unavailable) => {
                Err(BoundaryError::Unavailable)
            }
            Err(_) => Err(BoundaryError::Revoked),
        }
    }

    #[cfg(test)]
    pub(crate) fn with_mutable_lock_for_test(&self, operation: impl FnOnce()) {
        let _guard = self.0.mutable.lock().expect("test mutable lock poisoned");
        operation();
    }

    fn grant_reply(
        &self,
        owner: &Authenticated,
        request: &GrantRequest,
        response: &GrantResponse,
    ) -> Result<Bytes, BoundaryError> {
        let registry = self.0.registry.as_ref().ok_or(BoundaryError::Unavailable)?;
        let mut result = Err(BoundaryError::Revoked);
        let checked = registry.with_cached_grant_authority(
            &owner.principal,
            request,
            response,
            &mut |refreshed| {
                result = match self.0.mutable.lock() {
                    Ok(state) if self.current_credential(&state, owner) => json_bytes(refreshed),
                    Ok(_) => Err(BoundaryError::Unauthorized),
                    Err(_) => Err(BoundaryError::Unavailable),
                };
                Ok(())
            },
        );
        if checked.is_err() {
            return Err(BoundaryError::Revoked);
        }
        result
    }

    fn reserve_cache_capacity(
        &self,
        owner: &Authenticated,
        binding: &Binding,
    ) -> Result<(), BoundaryError> {
        self.authorized(owner, binding, |state| {
            let now = self.0.clock.now_ms();
            state.cache.retain(|_, record| now < record.expires);
            // Reserve enough for a bounded single-item response before minting.
            if state.cache.len() >= CACHE_ENTRIES
                || state.cache.values().map(|r| r.bytes.len()).sum::<usize>()
                    + wire::MAX_CONTROL_BYTES
                    > CACHE_BYTES
            {
                return Err(BoundaryError::Limit);
            }
            Ok(())
        })
    }

    fn cache_key(
        &self,
        owner: &Authenticated,
        context: &Binding,
        endpoint: &'static str,
        headers: &HeaderMap,
    ) -> Result<CacheKey, BoundaryError> {
        let values: Vec<_> = headers.get_all("x-request-id").iter().collect();
        if values.len() != 1 {
            return Err(BoundaryError::Invalid);
        }
        let request_id = values[0].to_str().map_err(|_| BoundaryError::Invalid)?;
        if !wire::opaque(request_id) {
            return Err(BoundaryError::Invalid);
        }
        Ok(CacheKey {
            subject: owner.principal.subject.clone(),
            installation: owner.principal.installation_id.clone(),
            credential_revision: owner.credential_revision,
            epoch: context.server_epoch.clone(),
            session: context.session_id.clone(),
            endpoint,
            request_id: request_id.into(),
        })
    }

    fn cached(
        &self,
        owner: &Authenticated,
        key: &CacheKey,
        body: &[u8],
    ) -> Result<Option<Bytes>, BoundaryError> {
        // Lookup precedes fresh-operation CAS: a completed native transition
        // deliberately changed the caller's prior binding. This private value
        // must still pass grant_reply's current grant/source publication barrier
        // before any secret response is sent; a cache hit is never authority.
        let mut state = self
            .0
            .mutable
            .lock()
            .map_err(|_| BoundaryError::Unavailable)?;
        if !self.current_credential(&state, owner) {
            return Err(BoundaryError::Unauthorized);
        }
        let now = self.0.clock.now_ms();
        state.cache.retain(|_, record| now < record.expires);
        match state.cache.get(key) {
            Some(record) if same_digest(&record.body_digest, &digest(body)) => {
                Ok(Some(record.bytes.clone()))
            }
            Some(_) => Err(BoundaryError::Conflict),
            None => Ok(None),
        }
    }
    /// Only called from the registry's staged mint commit callback. This method
    /// must not reenter Registry: lock order is Registry -> credential/cache.
    fn remember_grant(
        &self,
        owner: &Authenticated,
        key: CacheKey,
        body: &[u8],
        response: Bytes,
    ) -> Result<Bytes, BoundaryError> {
        let mut state = self
            .0
            .mutable
            .lock()
            .map_err(|_| BoundaryError::Unavailable)?;
        if !self.current_credential(&state, owner) {
            return Err(BoundaryError::Unauthorized);
        }
        let now = self.0.clock.now_ms();
        state.cache.retain(|_, record| now < record.expires);
        if state.cache.len() >= CACHE_ENTRIES
            || state.cache.values().map(|r| r.bytes.len()).sum::<usize>() + response.len()
                > CACHE_BYTES
        {
            return Err(BoundaryError::Limit);
        }
        state.cache.insert(
            key,
            Cached {
                body_digest: digest(body),
                bytes: response.clone(),
                expires: now.saturating_add(CACHE_TTL_MS),
            },
        );
        Ok(response)
    }

    /// Trusted generated bytes only, never a filesystem path or provider URL.
    /// Publication does not claim decoder success. The caller must separately
    /// establish its backend proof before exposing this private Output to native.
    pub fn publish_output(
        &self,
        owner: &Authenticated,
        binding: &Binding,
        playlist: &str,
        segments: BTreeMap<String, Bytes>,
        lifetime_ms: u32,
    ) -> Result<Output, BoundaryError> {
        if lifetime_ms == 0 || lifetime_ms as u64 > OUTPUT_TTL_MS {
            return Err(BoundaryError::Invalid);
        }
        let lines = validate_generated_hls(playlist, &segments)?;
        self.authorized(owner, binding, |state| {
            let now = self.0.clock.now_ms();
            let nonce = Uuid::new_v4().simple().to_string();
            let generation = Uuid::new_v4().simple().to_string();
            let expires = now
                .saturating_add(lifetime_ms as u64)
                .min(state.credentials[&owner.principal.subject].expires_at_ms);
            let mut record = OutputRecord {
                authenticated: owner.clone(),
                binding: binding.clone(),
                generation: generation.clone(),
                nonce: nonce.clone(),
                expires,
                files: BTreeMap::new(),
                token: String::new(),
                #[cfg(test)]
                live: None,
                #[cfg(test)]
                live_watermark: None,
            };
            record.token = self.sign(&record)?;
            let prefix = format!("{PREFIX}/media/{}", record.token);
            let rewritten = lines
                .into_iter()
                .map(|line| {
                    if segment_name(line) {
                        format!("{prefix}/{line}\n")
                    } else {
                        format!("{line}\n")
                    }
                })
                .collect::<String>();
            if rewritten.len() > PLAYLIST_BYTES {
                return Err(BoundaryError::Limit);
            }
            record.files = segments;
            record
                .files
                .insert("index.m3u8".into(), Bytes::from(rewritten));
            // Replacement revokes the old generation immediately, while retaining
            // custody until the backend explicitly acknowledges worker reaping.
            let old: Vec<_> = state
                .outputs
                .iter()
                .filter(|(_, r)| {
                    r.binding.session_id == binding.session_id
                        && r.authenticated.principal == owner.principal
                })
                .map(|(key, _)| key.clone())
                .collect();
            let retained: usize = state
                .outputs
                .values()
                .flat_map(|r| r.files.values())
                .map(Bytes::len)
                .sum();
            let added: usize = record.files.values().map(Bytes::len).sum();
            if state.outputs.len() >= OUTPUTS || retained.saturating_add(added) > OUTPUT_BYTES {
                return Err(BoundaryError::Limit);
            }
            state.revoked_outputs.extend(old);
            let playlist_path = format!("{prefix}/index.m3u8");
            state.outputs.insert(nonce, Arc::new(record));
            Ok(Output {
                session_id: binding.session_id.clone(),
                server_epoch: binding.server_epoch.clone(),
                output_generation: generation,
                playlist_path,
                lease_expires_in_ms: expires.saturating_sub(now) as u32,
            })
        })
    }

    /// One stable signed path for an owned fixture encoder. Playlist/segments
    /// are reread through bounded file custody; status must not republish it.
    #[cfg(test)]
    pub(super) fn publish_live_output(
        &self,
        owner: &Authenticated,
        binding: &Binding,
        directory: std::path::PathBuf,
        lifetime_ms: u32,
        minimum_sequence: u64,
        watermark: Option<LiveWatermark>,
    ) -> Result<Output, BoundaryError> {
        if lifetime_ms == 0 || lifetime_ms as u64 > OUTPUT_TTL_MS || self.0.live.is_none() {
            return Err(BoundaryError::Invalid);
        }
        let remaining = self.credential_remaining_ms(owner)?;
        let expires = self
            .0
            .clock
            .now_ms()
            .saturating_add(u64::from(lifetime_ms).min(remaining));
        let mut record = OutputRecord {
            authenticated: owner.clone(),
            binding: binding.clone(),
            generation: Uuid::new_v4().simple().to_string(),
            nonce: Uuid::new_v4().simple().to_string(),
            expires,
            files: BTreeMap::new(),
            token: String::new(),
            live: None,
            live_watermark: watermark,
        };
        record.token = self.sign(&record)?;
        let prefix = format!("{PREFIX}/media/{}", record.token);
        // Directory acquisition is outside registry/output publication locks.
        record.live = Some(Arc::new(live_output::LiveOutput::new(
            directory,
            self.0.live_bytes.clone(),
            prefix.clone(),
            minimum_sequence,
        )?));
        self.authorized(owner, binding, |state| {
            if state.outputs.len() >= OUTPUTS {
                return Err(BoundaryError::Limit);
            }
            if state.outputs.iter().any(|(key, old)| {
                old.binding.session_id == binding.session_id && !state.revoked_outputs.contains(key)
            }) {
                return Err(BoundaryError::Conflict);
            }
            let output = Output {
                session_id: binding.session_id.clone(),
                server_epoch: binding.server_epoch.clone(),
                output_generation: record.generation.clone(),
                playlist_path: format!("{prefix}/index.m3u8"),
                lease_expires_in_ms: expires.saturating_sub(self.0.clock.now_ms()) as u32,
            };
            state.outputs.insert(record.nonce.clone(), Arc::new(record));
            Ok(output)
        })
    }

    #[cfg(test)]
    fn check_live_output(&self, record: &OutputRecord, token: &str) -> Result<(), BoundaryError> {
        self.with_output_authority(record, token, || Ok(()))
    }

    fn signed_message(&self, record: &OutputRecord) -> Result<Vec<u8>, BoundaryError> {
        serde_json::to_vec(&(
            "ottplay-generated-hls-v1",
            wire::AUDIENCE,
            &self.0.server_id,
            &self.0.origin,
            &record.binding,
            &record.authenticated.principal.subject,
            &record.authenticated.principal.installation_id,
            record.authenticated.credential_revision,
            &record.generation,
            &record.nonce,
            record.expires,
        ))
        .map_err(|_| BoundaryError::Unavailable)
    }
    fn sign(&self, record: &OutputRecord) -> Result<String, BoundaryError> {
        let mut mac = Hmac::<Sha256>::new_from_slice(&self.0.signing_key)
            .map_err(|_| BoundaryError::Unavailable)?;
        mac.update(&self.signed_message(record)?);
        let signature = mac
            .finalize()
            .into_bytes()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>();
        Ok(format!("{}.{}", record.nonce, signature))
    }
    fn verify(&self, record: &OutputRecord, token: &str) -> bool {
        let Some((nonce, signature)) = token.split_once('.') else {
            return false;
        };
        if nonce != record.nonce || signature.len() != 64 {
            return false;
        }
        let mut bytes = [0u8; 32];
        for (position, pair) in signature.as_bytes().chunks_exact(2).enumerate() {
            fn hex(b: u8) -> Option<u8> {
                match b {
                    b'0'..=b'9' => Some(b - b'0'),
                    b'a'..=b'f' => Some(b - b'a' + 10),
                    _ => None,
                }
            }
            let (Some(a), Some(b)) = (hex(pair[0]), hex(pair[1])) else {
                return false;
            };
            bytes[position] = (a << 4) | b;
        }
        let Ok(message) = self.signed_message(record) else {
            return false;
        };
        let Ok(mut mac) = Hmac::<Sha256>::new_from_slice(&self.0.signing_key) else {
            return false;
        };
        mac.update(&message);
        mac.verify_slice(&bytes).is_ok()
    }

    /// Does not assert worker cleanup. That receipt is a separate owner action.
    pub fn revoke_output(&self, session_id: &str) -> Result<(), BoundaryError> {
        let mut state = self
            .0
            .mutable
            .lock()
            .map_err(|_| BoundaryError::Unavailable)?;
        let revoked: Vec<_> = state
            .outputs
            .iter()
            .filter(|(_, record)| record.binding.session_id == session_id)
            .map(|(key, _)| key.clone())
            .collect();
        state.revoked_outputs.extend(revoked);
        Ok(())
    }

    /// Call only after the real worker-reaped barrier. It releases broker-owned
    /// bytes for an already revoked output; it cannot make active bytes readable.
    pub fn acknowledge_reaped(
        &self,
        session_id: &str,
        generation: &str,
    ) -> Result<(), BoundaryError> {
        let mut state = self
            .0
            .mutable
            .lock()
            .map_err(|_| BoundaryError::Unavailable)?;
        let key = state
            .outputs
            .iter()
            .find(|(_, r)| r.binding.session_id == session_id && r.generation == generation)
            .map(|(key, _)| key.clone())
            .ok_or(BoundaryError::Invalid)?;
        if !state.revoked_outputs.contains(&key) {
            return Err(BoundaryError::Conflict);
        }
        // A slow or abandoned HTTP response still owns these bytes. Reaping the
        // decoder alone must not subtract them from the global storage budget.
        if Arc::strong_count(&state.outputs[&key]) != 1 {
            return Err(BoundaryError::Conflict);
        }
        state.outputs.remove(&key);
        state.revoked_outputs.remove(&key);
        Ok(())
    }

    fn with_output_authority<T>(
        &self,
        record: &OutputRecord,
        token: &str,
        callback: impl FnOnce() -> Result<T, BoundaryError>,
    ) -> Result<T, BoundaryError> {
        // Focus/audio/layout CAS changes do not tear down an unchanged encoder
        // generation. Source revocation blocks this session's output in Registry.
        self.try_session_media(&record.authenticated, &record.binding.session_id, |state| {
            if self.0.clock.now_ms() >= record.expires
                || state.revoked_outputs.contains(&record.nonce)
                || !state
                    .outputs
                    .get(&record.nonce)
                    .is_some_and(|r| r.generation == record.generation)
                || !self.verify(record, token)
            {
                return Err(BoundaryError::Revoked);
            }
            callback()
        })
    }

    fn output_chunk(
        &self,
        record: &OutputRecord,
        token: &str,
        file: &str,
        offset: usize,
    ) -> Result<Option<Bytes>, BoundaryError> {
        self.with_output_authority(record, token, || {
            let bytes = record.files.get(file).ok_or(BoundaryError::Invalid)?;
            // A downstream chunk must not retain an entire segment allocation
            // after its response is dropped and output custody is reclaimed.
            Ok((offset < bytes.len()).then(|| {
                Bytes::copy_from_slice(&bytes[offset..bytes.len().min(offset + CHUNK_BYTES)])
            }))
        })
    }
}

fn segment_name(name: &str) -> bool {
    name.len() == 17
        && name.starts_with("segment-")
        && name.ends_with(".ts")
        && name.as_bytes()[8..14].iter().all(u8::is_ascii_digit)
}
fn validate_generated_hls<'a>(
    playlist: &'a str,
    segments: &BTreeMap<String, Bytes>,
) -> Result<Vec<&'a str>, BoundaryError> {
    if playlist.len() > PLAYLIST_BYTES
        || segments.is_empty()
        || segments.len() > 128
        || playlist.contains('\r')
        || segments.iter().any(|(name, bytes)| {
            !segment_name(name) || bytes.is_empty() || bytes.len() > SEGMENT_BYTES
        })
        || segments.values().map(Bytes::len).sum::<usize>() > OUTPUT_BYTES
    {
        return Err(BoundaryError::Invalid);
    }
    let lines: Vec<_> = playlist.lines().collect();
    if lines.first() != Some(&"#EXTM3U") {
        return Err(BoundaryError::Invalid);
    }
    let mut referenced = BTreeSet::new();
    for line in &lines {
        if segment_name(line) {
            if !segments.contains_key(*line) {
                return Err(BoundaryError::Invalid);
            }
            referenced.insert(*line);
            continue;
        }
        let simple = matches!(
            *line,
            "#EXTM3U"
                | "#EXT-X-ENDLIST"
                | "#EXT-X-INDEPENDENT-SEGMENTS"
                | "#EXT-X-DISCONTINUITY"
                | "#EXT-X-PLAYLIST-TYPE:EVENT"
                | "#EXT-X-PLAYLIST-TYPE:VOD"
        );
        let numeric = [
            "#EXT-X-VERSION:",
            "#EXT-X-TARGETDURATION:",
            "#EXT-X-MEDIA-SEQUENCE:",
            "#EXT-X-DISCONTINUITY-SEQUENCE:",
        ]
        .iter()
        .any(|prefix| {
            line.strip_prefix(prefix).is_some_and(|number| {
                !number.is_empty()
                    && number.len() <= 20
                    && number.bytes().all(|b| b.is_ascii_digit())
            })
        });
        let duration = line
            .strip_prefix("#EXTINF:")
            .and_then(|s| s.strip_suffix(','))
            .is_some_and(|number| {
                number.len() <= 20
                    && number
                        .parse::<f64>()
                        .is_ok_and(|n| n.is_finite() && n > 0.0)
                    && number.bytes().all(|b| b.is_ascii_digit() || b == b'.')
            });
        if !simple && !numeric && !duration {
            return Err(BoundaryError::Invalid);
        }
    }
    if referenced.len() != segments.len() {
        return Err(BoundaryError::Invalid);
    }
    Ok(lines)
}

fn private_response(mut response: Response) -> Response {
    for (name, value) in [
        ("cache-control", "no-store"),
        ("referrer-policy", "no-referrer"),
        ("x-content-type-options", "nosniff"),
    ] {
        response
            .headers_mut()
            .insert(name, HeaderValue::from_static(value));
    }
    response
}
fn json_bytes<T: Serialize>(value: &T) -> Result<Bytes, BoundaryError> {
    let bytes = serde_json::to_vec(value).map_err(|_| BoundaryError::Unavailable)?;
    if bytes.len() > wire::MAX_RESULT_BYTES {
        return Err(BoundaryError::Limit);
    }
    Ok(bytes.into())
}
fn json_response(bytes: Bytes) -> Response {
    private_response(([("content-type", "application/json")], bytes).into_response())
}
fn finish(
    broker: &Broker,
    headers: &HeaderMap,
    result: Result<Response, BoundaryError>,
) -> Response {
    let mut response = result.unwrap_or_else(BoundaryError::response);
    if let Ok(Some(origin)) = broker.origin(headers) {
        if let Ok(value) = HeaderValue::from_str(&origin) {
            response
                .headers_mut()
                .insert("access-control-allow-origin", value);
            response
                .headers_mut()
                .insert("vary", HeaderValue::from_static("Origin"));
        }
    }
    response
}
fn parse<T: serde::de::DeserializeOwned>(
    headers: &HeaderMap,
    uri: &axum::http::Uri,
    bytes: &[u8],
) -> Result<T, BoundaryError> {
    let content_types: Vec<_> = headers.get_all("content-type").iter().collect();
    if bytes.len() > wire::MAX_CONTROL_BYTES
        || uri.query().is_some()
        || content_types.len() != 1
        || content_types[0] != "application/json"
    {
        return Err(BoundaryError::Invalid);
    }
    serde_json::from_slice(bytes).map_err(|_| BoundaryError::Invalid)
}
async fn deny_method() -> Response {
    private_response(StatusCode::METHOD_NOT_ALLOWED.into_response())
}
async fn preflight(State(broker): State<Broker>, headers: HeaderMap) -> Response {
    let result = (|| {
        let Some(_) = broker.origin(&headers)? else {
            return Err(BoundaryError::Forbidden);
        };
        let requested = headers
            .get("access-control-request-method")
            .and_then(|v| v.to_str().ok())
            .ok_or(BoundaryError::Invalid)?;
        if requested != "GET" && requested != "POST" {
            return Err(BoundaryError::Forbidden);
        }
        if headers
            .get("access-control-request-headers")
            .and_then(|v| v.to_str().ok())
            .is_some_and(|value| {
                value.split(',').any(|h| {
                    !matches!(
                        h.trim().to_ascii_lowercase().as_str(),
                        "authorization" | "content-type" | "x-request-id"
                    )
                })
            })
        {
            return Err(BoundaryError::Forbidden);
        }
        Ok(private_response(
            (
                StatusCode::NO_CONTENT,
                [
                    ("access-control-allow-methods", "GET, POST"),
                    (
                        "access-control-allow-headers",
                        "authorization, content-type, x-request-id",
                    ),
                    ("access-control-max-age", "0"),
                ],
            )
                .into_response(),
        ))
    })();
    finish(&broker, &headers, result)
}
async fn capabilities(
    State(broker): State<Broker>,
    OriginalUri(uri): OriginalUri,
    headers: HeaderMap,
) -> Response {
    let result = (|| {
        broker.authenticate(&headers)?;
        if uri.query().is_some() {
            return Err(BoundaryError::Invalid);
        }
        let catalog_revision = match &broker.0.registry {
            Some(registry) => {
                registry
                    .metadata()
                    .map_err(|_| BoundaryError::Unavailable)?
                    .2
            }
            None => "unavailable".into(),
        };
        let (max_inputs, qualified_input_adapters, output_profiles) = (0, vec![], vec![]);
        #[cfg(test)]
        let (max_inputs, qualified_input_adapters, output_profiles) = match &broker.0.live {
            Some(live) => (
                live.profile().max_inputs,
                live.input_adapters().to_vec(),
                vec![live.profile().clone()],
            ),
            None => (max_inputs, qualified_input_adapters, output_profiles),
        };
        Ok(json_response(json_bytes(&Capabilities {
            version: wire::VERSION,
            server_id: broker.0.server_id.clone(),
            server_epoch: broker.0.epoch.clone(),
            max_inputs,
            qualified_input_adapters,
            output_profiles,
            output_auth: "hmac_path_v1".into(),
            catalog_revision,
        })?))
    })();
    finish(&broker, &headers, result)
}
async fn sources(
    State(broker): State<Broker>,
    OriginalUri(uri): OriginalUri,
    headers: HeaderMap,
    bytes: Bytes,
) -> Response {
    let result = (|| {
        let owner = broker.authenticate(&headers)?;
        let request: SourcesRequest = parse(&headers, &uri, &bytes)?;
        if request.version != wire::VERSION {
            return Err(BoundaryError::Invalid);
        }
        #[cfg(test)]
        if let Some(live) = &broker.0.live {
            live.ensure_context(&owner, &request.context)?;
        }
        let registry = broker
            .0
            .registry
            .as_ref()
            .ok_or(BoundaryError::Unavailable)?;
        let result = registry
            .sources(&owner.principal, &request)
            .map_err(registry_error)?;
        broker.authorized(&owner, &request.context, |_| {
            Ok(json_response(json_bytes(&result)?))
        })
    })();
    finish(&broker, &headers, result)
}
async fn input_grants(
    State(broker): State<Broker>,
    OriginalUri(uri): OriginalUri,
    headers: HeaderMap,
    bytes: Bytes,
) -> Response {
    let result = (|| {
        let owner = broker.authenticate(&headers)?;
        let request: GrantRequest = parse(&headers, &uri, &bytes)?;
        if request.version != wire::VERSION {
            return Err(BoundaryError::Invalid);
        }
        let key = broker.cache_key(&owner, &request.context, "input-grants", &headers)?;
        let _mutation = broker
            .0
            .mutations
            .try_lock()
            .map_err(|_| BoundaryError::Limit)?;
        if let Some(response) = broker.cached(&owner, &key, &bytes)? {
            let response: GrantResponse =
                serde_json::from_slice(&response).map_err(|_| BoundaryError::Unavailable)?;
            return Ok(json_response(
                broker.grant_reply(&owner, &request, &response)?,
            ));
        }
        #[cfg(test)]
        if let Some(live) = &broker.0.live {
            live.ensure_context(&owner, &request.context)?;
        }
        broker.reserve_cache_capacity(&owner, &request.context)?;
        let registry = broker
            .0
            .registry
            .as_ref()
            .ok_or(BoundaryError::Unavailable)?;
        let mut cache_failure = None;
        let response = registry
            .mint_with_commit(
                &owner.principal,
                &request,
                &mut |candidate| match json_bytes(candidate)
                    .and_then(|reply| broker.remember_grant(&owner, key.clone(), &bytes, reply))
                {
                    Ok(_) => Ok(()),
                    Err(error) => {
                        cache_failure = Some(error);
                        Err(RegistryError::Unavailable)
                    }
                },
            )
            .map_err(|error| cache_failure.unwrap_or_else(|| registry_error(error)))?;
        Ok(json_response(
            broker.grant_reply(&owner, &request, &response)?,
        ))
    })();
    finish(&broker, &headers, result)
}
async fn control(
    State(broker): State<Broker>,
    OriginalUri(uri): OriginalUri,
    headers: HeaderMap,
    bytes: Bytes,
) -> Response {
    let result = async {
        let owner = broker.authenticate(&headers)?;
        let request: ControlRequest = parse(&headers, &uri, &bytes)?;
        if request.version != wire::VERSION || !request.context.valid() {
            return Err(BoundaryError::Invalid);
        }
        let key = broker.cache_key(&owner, &request.context, "control", &headers)?;
        #[cfg(test)]
        if let Some(live) = &broker.0.live {
            let response = live
                .control(
                    broker.clone(),
                    owner,
                    request,
                    key.request_id,
                    digest(&bytes),
                )
                .await?;
            return Ok(json_response(json_bytes(&response)?));
        }
        let _ = key;
        Err(BoundaryError::Unavailable)
    }
    .await;
    finish(&broker, &headers, result)
}
async fn sessions(
    State(broker): State<Broker>,
    OriginalUri(uri): OriginalUri,
    headers: HeaderMap,
    bytes: Bytes,
) -> Response {
    let result = async {
        let owner = broker.authenticate(&headers)?;
        let request: SessionCreateRequest = parse(&headers, &uri, &bytes)?;
        if request.version != wire::VERSION || request.server_epoch != broker.0.epoch {
            return Err(BoundaryError::Invalid);
        }
        let ids: Vec<_> = headers.get_all("x-request-id").iter().collect();
        if ids.len() != 1 || !ids[0].to_str().is_ok_and(wire::opaque) {
            return Err(BoundaryError::Invalid);
        }
        #[cfg(test)]
        if let Some(live) = &broker.0.live {
            let response = live
                .create(
                    broker.clone(),
                    owner,
                    request,
                    ids[0]
                        .to_str()
                        .map_err(|_| BoundaryError::Invalid)?
                        .to_owned(),
                    digest(&bytes),
                )
                .await?;
            return Ok(json_response(json_bytes(&response)?));
        }
        let _ = owner;
        Err(BoundaryError::Unavailable)
    }
    .await;
    finish(&broker, &headers, result)
}
async fn status(
    State(broker): State<Broker>,
    OriginalUri(uri): OriginalUri,
    headers: HeaderMap,
    bytes: Bytes,
) -> Response {
    let result = async {
        let owner = broker.authenticate(&headers)?;
        let request: StatusRequest = parse(&headers, &uri, &bytes)?;
        if request.version != wire::VERSION
            || request.server_epoch != broker.0.epoch
            || !wire::opaque(&request.session_id)
        {
            return Err(BoundaryError::Invalid);
        }
        #[cfg(test)]
        if let Some(live) = &broker.0.live {
            let response = live.status(broker.clone(), owner, request).await?;
            return Ok(json_response(json_bytes(&response)?));
        }
        let _ = owner;
        Err(BoundaryError::Unavailable)
    }
    .await;
    finish(&broker, &headers, result)
}

// Body and real connection share one permit and output record. Neither EOF
// nor response-body drop can release custody while the connection still writes.
struct MediaCustody {
    broker: Broker,
    record: Arc<OutputRecord>,
    token: String,
    _permit: OwnedSemaphorePermit,
}
impl MediaAuthority for MediaCustody {
    fn authorized(&self) -> bool {
        #[cfg(test)]
        if self.record.live.is_some() {
            return self
                .broker
                .check_live_output(&self.record, &self.token)
                .is_ok();
        }
        self.broker
            .with_output_authority(&self.record, &self.token, || Ok(()))
            .is_ok()
    }
}

struct GuardedBody {
    custody: Arc<MediaCustody>,
    file: String,
    offset: usize,
    failed: bool,
    #[cfg(test)]
    live_bytes: Option<Bytes>,
}
impl Stream for GuardedBody {
    type Item = Result<Bytes, std::io::Error>;
    fn poll_next(mut self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        if self.failed {
            return Poll::Ready(None);
        }
        #[cfg(test)]
        if let Some(bytes) = self.live_bytes.as_ref() {
            if self
                .custody
                .broker
                .check_live_output(&self.custody.record, &self.custody.token)
                .is_err()
            {
                self.failed = true;
                return Poll::Ready(Some(Err(std::io::Error::new(
                    std::io::ErrorKind::PermissionDenied,
                    "Output authority revoked",
                ))));
            }
            if self.offset >= bytes.len() {
                return Poll::Ready(None);
            }
            // A slice retains the file's byte permit even after this HTTP body
            // is abandoned; another read cannot reclaim that memory admission.
            let chunk = bytes.slice(self.offset..bytes.len().min(self.offset + CHUNK_BYTES));
            self.offset += chunk.len();
            return Poll::Ready(Some(Ok(chunk)));
        }
        match self.custody.broker.output_chunk(
            &self.custody.record,
            &self.custody.token,
            &self.file,
            self.offset,
        ) {
            Ok(Some(bytes)) => {
                self.offset += bytes.len();
                Poll::Ready(Some(Ok(bytes)))
            }
            Ok(None) => Poll::Ready(None),
            Err(_) => {
                self.failed = true;
                Poll::Ready(Some(Err(std::io::Error::new(
                    std::io::ErrorKind::PermissionDenied,
                    "Output authority revoked",
                ))))
            }
        }
    }
}
async fn media(
    State(broker): State<Broker>,
    OriginalUri(uri): OriginalUri,
    Path((token, file)): Path<(String, String)>,
    method: Method,
    version: Version,
    connection: Option<Extension<ConnectionControl>>,
    headers: HeaderMap,
) -> Response {
    let result = async {
        broker.origin(&headers)?;
        if method != Method::GET
            || uri.query().is_some()
            || headers.contains_key("range")
            || !(file == "index.m3u8" || segment_name(&file))
            || uri.path() != format!("{PREFIX}/media/{token}/{file}")
        {
            return Err(BoundaryError::Invalid);
        }
        if token.len() != 97 {
            return Err(BoundaryError::Unauthorized);
        }
        let nonce = token
            .split_once('.')
            .map(|(nonce, _)| nonce)
            .ok_or(BoundaryError::Unauthorized)?;
        let record = broker
            .0
            .mutable
            .try_lock()
            .map_err(|_| BoundaryError::Unavailable)?
            .outputs
            .get(nonce)
            .cloned()
            .ok_or(BoundaryError::Unauthorized)?;
        // Admission only; bytes are copied after the body acquires its permit.
        #[cfg(test)]
        if record.live.is_some() {
            broker.check_live_output(&record, &token)?;
        } else {
            broker.output_chunk(&record, &token, &file, usize::MAX)?;
        }
        #[cfg(not(test))]
        broker.output_chunk(&record, &token, &file, usize::MAX)?;
        // Private media needs its own supervised HTTP/1 connection. Reject before
        // stream admission; an HTTP/2 request must never arm or cancel its peers.
        if !matches!(version, Version::HTTP_10 | Version::HTTP_11) {
            return Err(BoundaryError::Unavailable);
        }
        let Extension(connection) = connection.ok_or(BoundaryError::Unavailable)?;
        let permit = broker
            .0
            .streams
            .clone()
            .try_acquire_owned()
            .map_err(|_| BoundaryError::Limit)?;
        #[cfg(test)]
        let live_bytes = if let Some(live) = record.live.as_ref() {
            // A short core provenance query precedes filesystem I/O. Neither
            // the control mutex nor publication barrier covers the awaited read.
            let minimum = match &record.live_watermark {
                Some(proof) => proof()?,
                None => 0,
            };
            let bytes = live.read_with_minimum(&file, minimum).await?;
            broker.check_live_output(&record, &token)?;
            Some(bytes)
        } else {
            None
        };
        let mime = if file == "index.m3u8" {
            "application/vnd.apple.mpegurl"
        } else {
            "video/mp2t"
        };
        let custody = Arc::new(MediaCustody {
            broker: broker.clone(),
            record,
            token,
            _permit: permit,
        });
        let lease = connection.media_lease(custody.clone());
        let body = GuardedBody {
            custody,
            file,
            offset: 0,
            failed: false,
            #[cfg(test)]
            live_bytes,
        };
        let mut response =
            private_response(([("content-type", mime)], Body::from_stream(body)).into_response());
        response.extensions_mut().insert(lease);
        Ok(response)
    }
    .await;
    finish(&broker, &headers, result)
}
