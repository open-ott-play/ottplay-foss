//! Narrow synchronous guest bridge backed by cancellable native async HTTPS.
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Instant;

use tokio::runtime::Handle;
use tokio_util::sync::CancellationToken;

use super::{check_budget, PluginError};

pub(super) const MAX_CALLS: usize = 2;
pub(super) const MAX_FETCH_BYTES: usize = 512 * 1024;

pub(super) struct NetworkHost {
    runtime: Handle,
    hosts: Vec<String>,
    calls: AtomicUsize,
    cancel: CancellationToken,
    deadline: Instant,
}

impl NetworkHost {
    pub(super) fn new(
        runtime: Handle,
        hosts: Vec<String>,
        cancel: CancellationToken,
        deadline: Instant,
    ) -> Self {
        Self {
            runtime,
            hosts,
            calls: AtomicUsize::new(0),
            cancel,
            deadline,
        }
    }

    pub(super) fn fetch(&self, url: &str) -> Result<String, PluginError> {
        check_budget(&self.cancel, self.deadline)?;
        // Failed or denied calls also consume the quota. Two independently
        // capped responses keep the aggregate accepted body at most 1 MiB.
        self.calls
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |count| {
                (count < MAX_CALLS).then_some(count + 1)
            })
            .map_err(|_| PluginError::NetworkLimit)?;
        self.runtime.block_on(async {
            tokio::select! {
                biased;
                _ = self.cancel.cancelled() => Err(PluginError::Cancelled),
                _ = tokio::time::sleep_until(tokio::time::Instant::from_std(self.deadline)) => Err(PluginError::TimedOut),
                result = crate::proxy::fetch_plugin_text(url, &self.hosts, MAX_FETCH_BYTES) => {
                    result.map_err(|code| match code {
                        "plugin_network_denied" => PluginError::NetworkDenied,
                        "plugin_network_limit" => PluginError::NetworkLimit,
                        _ => PluginError::NetworkFailed,
                    })
                }
            }
        })
    }
}
