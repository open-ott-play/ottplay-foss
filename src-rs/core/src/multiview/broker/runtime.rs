//! Connects opaque registry grants to immutable, operator-owned resolvers.
//!
//! This is a bounded source service, not a live decoder adapter. Callers retain
//! retirement ownership even after cancellation; no method here asserts reaping.
use super::{
    network::{CheckedTransport, Error as NetworkError, Fetched, HlsManifest, HlsResource},
    registry::{Enrollment, Registry, RegistryError, Reservation},
    resolvers::{PreparedSource, ServerSource},
    wire::{Binding, Permission, Principal},
};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

/// Construct only from explicit server configuration; never deserialize a native
/// source request or infer policy from a favorite digest or attachment alias.
pub struct SourceConfig {
    pub source: ServerSource,
    pub transport: CheckedTransport,
}
struct Configs {
    next_index: u64,
    entries: BTreeMap<u64, Arc<SourceConfig>>,
    sources: BTreeMap<String, Vec<u64>>,
}
pub struct SourceService {
    registry: Arc<Registry>,
    configs: Mutex<Configs>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RuntimeError {
    Registry(RegistryError),
    Network(NetworkError),
    InvalidConfiguration,
    Unavailable,
}

/// A consumed grant is never silently retried. If present, reservation remains
/// owned by the host until output revocation and actual cleanup are acknowledged.
pub struct ResolveFailure {
    pub error: RuntimeError,
    pub reservation: Option<Reservation>,
}

impl SourceService {
    pub fn new(registry: Arc<Registry>) -> Self {
        Self {
            registry,
            configs: Mutex::new(Configs {
                next_index: 1,
                entries: BTreeMap::new(),
                sources: BTreeMap::new(),
            }),
        }
    }

    /// Replacing any source rotates all item revisions before old configuration
    /// is dropped. Existing readers retain immutable config, but lose authority.
    pub fn enroll(
        &self,
        operator: &Principal,
        mut enrollment: Enrollment,
        mut configurations: BTreeMap<String, SourceConfig>,
        expected: Option<&str>,
    ) -> Result<String, RuntimeError> {
        if !operator.permits(Permission::SourcesManage) {
            return Err(RuntimeError::Registry(RegistryError::Forbidden));
        }
        let unique: BTreeSet<_> = enrollment
            .items
            .iter()
            .map(|item| item.item_ref.clone())
            .collect();
        if unique.len() != enrollment.items.len()
            || unique.len() != configurations.len()
            || unique.iter().any(|item| !configurations.contains_key(item))
        {
            return Err(RuntimeError::InvalidConfiguration);
        }
        let mut state = self.configs.lock().map_err(|_| RuntimeError::Unavailable)?;
        let mut additions = Vec::new();
        for item in &mut enrollment.items {
            let index = state.next_index;
            state.next_index = index.checked_add(1).ok_or(RuntimeError::Unavailable)?;
            item.input.config_index = index;
            additions.push((
                index,
                Arc::new(
                    configurations
                        .remove(&item.item_ref)
                        .ok_or(RuntimeError::InvalidConfiguration)?,
                ),
            ));
        }
        let source_ref = enrollment.source_ref.clone();
        let revision = self
            .registry
            .enroll(operator, enrollment, expected)
            .map_err(RuntimeError::Registry)?;
        if let Some(old) = state.sources.remove(&source_ref) {
            for index in old {
                state.entries.remove(&index);
            }
        }
        state.sources.insert(
            source_ref,
            additions.iter().map(|(index, _)| *index).collect(),
        );
        state.entries.extend(additions);
        Ok(revision)
    }

    pub fn remove(
        &self,
        operator: &Principal,
        source: &str,
        expected: &str,
    ) -> Result<Vec<super::registry::Retirement>, RuntimeError> {
        let mut state = self.configs.lock().map_err(|_| RuntimeError::Unavailable)?;
        let retirements = self
            .registry
            .remove_source(operator, source, expected)
            .map_err(RuntimeError::Registry)?;
        if let Some(old) = state.sources.remove(source) {
            for index in old {
                state.entries.remove(&index);
            }
        }
        Ok(retirements)
    }

    pub async fn resolve(
        &self,
        principal: &Principal,
        context: &Binding,
        grant: &str,
        caller: &CancellationToken,
    ) -> Result<AuthorizedSource, ResolveFailure> {
        if caller.is_cancelled() {
            return Err(ResolveFailure {
                error: RuntimeError::Network(NetworkError::Cancelled),
                reservation: None,
            });
        }
        let reservation = self
            .registry
            .redeem(principal, context, grant)
            .map_err(|error| ResolveFailure {
                error: RuntimeError::Registry(error),
                reservation: None,
            })?;
        let mut guard = ResolutionGuard {
            registry: self.registry.clone(),
            principal: principal.clone(),
            context: context.clone(),
            reservation: reservation.clone(),
            cancellation: caller.child_token(),
            monitor: None,
        };
        let configuration = self
            .configs
            .lock()
            .map_err(|_| guard.failure(RuntimeError::Unavailable))?
            .entries
            .get(&reservation.input().config_index)
            .cloned()
            .ok_or_else(|| guard.failure(RuntimeError::InvalidConfiguration))?;
        guard.check().map_err(|error| guard.failure(error))?;
        // The monitor does no network I/O. Each fetch also checks synchronously
        // before admission and after completion; stale bytes are never returned.
        let registry = guard.registry.clone();
        let principal = guard.principal.clone();
        let context = guard.context.clone();
        let watched = guard.reservation.clone();
        let cancel = guard.cancellation.clone();
        guard.monitor = Some(tokio::spawn(async move {
            let mut ticks = tokio::time::interval(Duration::from_millis(50));
            loop {
                tokio::select! {
                    _ = cancel.cancelled() => break,
                    _ = ticks.tick() => {
                        if registry.validate_reservation(&principal, &context, &watched).is_err() {
                            cancel.cancel(); break;
                        }
                    }
                }
            }
            // Cancellation closes publication authority as well as network I/O.
            // Provider cleanup and worker reaping still need separate receipts.
            let _ = registry.retire_reservation(&principal, &watched);
        }));
        let prepared = match configuration
            .source
            .resolve(&configuration.transport, &guard.cancellation)
            .await
        {
            Ok(source) => source,
            Err(error) => return Err(guard.failure(RuntimeError::Network(error))),
        };
        if let Err(error) = guard.check() {
            let cleanup = prepared.finish().await;
            return Err(guard.failure(cleanup.err().map(RuntimeError::Network).unwrap_or(error)));
        }
        Ok(AuthorizedSource {
            prepared: Some(prepared),
            guard,
        })
    }
}

struct ResolutionGuard {
    registry: Arc<Registry>,
    principal: Principal,
    context: Binding,
    reservation: Reservation,
    cancellation: CancellationToken,
    monitor: Option<JoinHandle<()>>,
}
impl ResolutionGuard {
    fn cancel_and_retire(&self) {
        self.cancellation.cancel();
        let _ = self
            .registry
            .retire_reservation(&self.principal, &self.reservation);
    }
    fn check(&self) -> Result<(), RuntimeError> {
        self.registry
            .validate_reservation(&self.principal, &self.context, &self.reservation)
            .map_err(RuntimeError::Registry)?;
        if self.cancellation.is_cancelled() {
            return Err(RuntimeError::Network(NetworkError::Cancelled));
        }
        Ok(())
    }
    fn failure(&self, error: RuntimeError) -> ResolveFailure {
        ResolveFailure {
            error,
            reservation: Some(self.reservation.clone()),
        }
    }
}
impl Drop for ResolutionGuard {
    fn drop(&mut self) {
        self.cancel_and_retire();
        if let Some(monitor) = self.monitor.take() {
            monitor.abort();
        }
    }
}

#[cfg(test)]
#[path = "runtime_tests.rs"]
mod tests;

/// No direct accessor to PreparedSource: authorization cannot be bypassed by a
/// consumer retaining raw upstream credentials or a copied unchecked fetcher.
pub struct AuthorizedSource {
    prepared: Option<PreparedSource>,
    guard: ResolutionGuard,
}
impl AuthorizedSource {
    pub fn reservation(&self) -> &Reservation {
        &self.guard.reservation
    }
    pub fn cancel(&self) {
        self.guard.cancel_and_retire();
    }
    pub async fn fetch_root(&self) -> Result<Fetched, RuntimeError> {
        self.guard.check()?;
        let bytes = self
            .prepared
            .as_ref()
            .ok_or(RuntimeError::Unavailable)?
            .fetch_root()
            .await
            .map_err(RuntimeError::Network)?;
        self.guard.check()?;
        Ok(bytes)
    }
    pub fn parse_hls(&self, fetched: &Fetched) -> Result<HlsManifest, RuntimeError> {
        self.guard.check()?;
        self.prepared
            .as_ref()
            .ok_or(RuntimeError::Unavailable)?
            .parse_hls(fetched)
            .map_err(RuntimeError::Network)
    }
    pub async fn fetch_hls_resource(
        &self,
        resource: &HlsResource,
    ) -> Result<Fetched, RuntimeError> {
        self.guard.check()?;
        let bytes = self
            .prepared
            .as_ref()
            .ok_or(RuntimeError::Unavailable)?
            .fetch_hls_resource(resource)
            .await
            .map_err(RuntimeError::Network)?;
        self.guard.check()?;
        Ok(bytes)
    }
    /// Successful provider cleanup is separate from decoder reaping/output
    /// revocation. The host owns those barriers and must retain this reservation.
    pub async fn finish(mut self) -> Result<(), RuntimeError> {
        self.guard.cancel_and_retire();
        let cleanup = self
            .prepared
            .take()
            .ok_or(RuntimeError::Unavailable)?
            .finish()
            .await
            .map_err(RuntimeError::Network);
        if let Some(monitor) = self.guard.monitor.take() {
            let _ = monitor.await;
        }
        cleanup
    }
}
