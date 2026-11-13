//! Async broker-to-decoder custody. No URL or provider credential crosses this
//! boundary. Probe and decode get distinct subscriptions under one source grant.
//!
//! Only the Unix socket transport is qualified here. Anonymous blocking pipes
//! must not be substituted: cancellation cannot abort a blocked writer thread.
use super::{
    network::Error as NetworkError,
    registry::Reservation,
    runtime::{AuthorizedSource, RuntimeError},
    stream_transport::{MpegTsStream, StreamLimits},
};
use std::{
    fs::File,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio::{sync::watch, task::JoinHandle};
use tokio_util::sync::CancellationToken;

const MAX_CUSTODY: Duration = Duration::from_secs(24 * 60 * 60);
const JOIN_LIMIT: Duration = Duration::from_secs(3);
const PROBE_BYTE_LIMIT: u64 = 8 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StreamPhase {
    Probe,
    Decode,
}
impl StreamPhase {
    fn index(self) -> usize {
        match self {
            Self::Probe => 0,
            Self::Decode => 1,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StreamError {
    Source(RuntimeError),
    InvalidPhase,
    Expired,
    UnsupportedPlatform,
    Io,
    Busy,
    JoinFailed,
    JoinTimeout,
    ProbeLimit,
}

/// Constructor rejection must not discard the provider cleanup owner. Recover
/// the source and await its cleanup before acknowledging host retirement.
pub struct StreamCreationFailure {
    pub error: StreamError,
    source: AuthorizedSource,
}
impl StreamCreationFailure {
    pub fn into_source(self) -> AuthorizedSource {
        self.source
    }
}
impl std::fmt::Debug for StreamCreationFailure {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("StreamCreationFailure")
            .field("error", &self.error)
            .finish_non_exhaustive()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ProducerRetirement {
    pub bytes: u64,
    pub eof: bool,
    pub cancelled: bool,
    pub joined: bool,
    pub error: Option<StreamError>,
}
impl ProducerRetirement {
    fn failed(error: StreamError) -> Self {
        Self {
            bytes: 0,
            eof: false,
            cancelled: false,
            joined: false,
            error: Some(error),
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FactoryRetirement {
    pub producers_joined: bool,
    pub provider_cleanup_confirmed: bool,
}

struct ProducerControl {
    cancel: CancellationToken,
    task: tokio::sync::Mutex<Option<JoinHandle<ProducerRetirement>>>,
    receipt: watch::Sender<Option<ProducerRetirement>>,
}
impl ProducerControl {
    fn joined(&self) -> bool {
        self.receipt.borrow().is_some_and(|receipt| receipt.joined)
    }
    async fn retire(&self) -> Result<ProducerRetirement, StreamError> {
        self.cancel.cancel();
        // Keep the JoinHandle in shared custody across await. Cancelling this
        // caller cannot detach the producer or make its receipt unrecoverable.
        let mut owned = self.task.lock().await;
        if let Some(receipt) = *self.receipt.borrow() {
            return Ok(receipt);
        }
        if let Some(task) = owned.as_mut() {
            let mut result = match tokio::time::timeout(JOIN_LIMIT, &mut *task).await {
                Ok(Ok(report)) => report,
                Ok(Err(_)) => ProducerRetirement::failed(StreamError::JoinFailed),
                Err(_) => {
                    // The task uses only cancellable async sockets. Await abort
                    // so dropping a handle never masquerades as a joined task.
                    task.abort();
                    let _ = task.await;
                    ProducerRetirement::failed(StreamError::JoinTimeout)
                }
            };
            result.joined = true;
            owned.take();
            self.receipt.send_replace(Some(result));
            return Ok(result);
        }
        Err(StreamError::JoinFailed)
    }
}
impl Drop for ProducerControl {
    fn drop(&mut self) {
        self.cancel.cancel();
    }
}

/// Reader custody moves exactly once into core's opaque StreamInput. This handle
/// retains producer cleanup ownership after that move; it is not a decoder or
/// provider retirement receipt.
pub struct OpenedStream {
    file: Option<File>,
    control: Arc<ProducerControl>,
}
impl OpenedStream {
    pub fn take_file(&mut self) -> Result<File, StreamError> {
        self.file.take().ok_or(StreamError::InvalidPhase)
    }
    pub fn cancel(&self) {
        self.control.cancel.cancel();
    }
    pub async fn retire(&mut self) -> Result<ProducerRetirement, StreamError> {
        self.cancel();
        self.file.take();
        self.control.retire().await
    }
}
impl Drop for OpenedStream {
    fn drop(&mut self) {
        self.cancel();
    }
}

struct Phases {
    attempted: [bool; 2],
    controls: [Option<Arc<ProducerControl>>; 2],
}

/// Owns one authorized source/provider lease, not one lease per phase. The
/// operator hard end is independent of grant redemption and rolling owner TTL.
pub struct StreamFactory {
    source: Option<Arc<AuthorizedSource>>,
    reservation: Reservation,
    hard_end: Instant,
    phases: Mutex<Phases>,
    cleanup: Option<JoinHandle<Result<FactoryRetirement, StreamError>>>,
    terminal: Option<Result<FactoryRetirement, StreamError>>,
}
impl StreamFactory {
    pub fn new(source: AuthorizedSource, hard_end: Instant) -> Result<Self, StreamCreationFailure> {
        let now = Instant::now();
        if hard_end <= now || hard_end.duration_since(now) > MAX_CUSTODY {
            return Err(StreamCreationFailure {
                error: StreamError::Expired,
                source,
            });
        }
        if let Err(error) = source.check_authority() {
            return Err(StreamCreationFailure {
                error: StreamError::Source(error),
                source,
            });
        }
        let reservation = source.reservation().clone();
        Ok(Self {
            source: Some(Arc::new(source)),
            reservation,
            hard_end,
            phases: Mutex::new(Phases {
                attempted: [false; 2],
                controls: [None, None],
            }),
            cleanup: None,
            terminal: None,
        })
    }
    pub fn reservation(&self) -> &Reservation {
        &self.reservation
    }
    pub fn hard_end(&self) -> Instant {
        self.hard_end
    }

    pub async fn open(&self, phase: StreamPhase) -> Result<OpenedStream, StreamError> {
        #[cfg(not(unix))]
        {
            let _ = phase;
            return Err(StreamError::UnsupportedPlatform);
        }
        #[cfg(unix)]
        {
            use std::os::fd::OwnedFd;
            if Instant::now() >= self.hard_end {
                return Err(StreamError::Expired);
            }
            let source = self
                .source
                .as_ref()
                .ok_or(StreamError::InvalidPhase)?
                .clone();
            source.check_authority().map_err(StreamError::Source)?;
            {
                let mut phases = self.phases.lock().map_err(|_| StreamError::JoinFailed)?;
                if phases.attempted[phase.index()] {
                    return Err(StreamError::InvalidPhase);
                }
                if phase == StreamPhase::Decode
                    && !phases.controls[0]
                        .as_ref()
                        .is_some_and(|control| control.joined())
                {
                    return Err(StreamError::InvalidPhase);
                }
                phases.attempted[phase.index()] = true;
            }
            let limits = StreamLimits::new(tokio::time::Instant::from_std(self.hard_end));
            let stream = source
                .open_mpeg_ts(limits)
                .await
                .map_err(StreamError::Source)?;
            source.check_authority().map_err(StreamError::Source)?;
            let (reader, writer) = tokio::net::UnixStream::pair().map_err(|_| StreamError::Io)?;
            let reader = reader.into_std().map_err(|_| StreamError::Io)?;
            // Pair endpoints have distinct open-file descriptions; this does not
            // change the writer's Tokio-managed nonblocking mode.
            reader.set_nonblocking(false).map_err(|_| StreamError::Io)?;
            let reader = File::from(OwnedFd::from(reader));
            let cancel = stream.cancellation();
            let (receipt, _) = watch::channel(None);
            let hard_end = self.hard_end;
            let control = Arc::new(ProducerControl {
                cancel: cancel.clone(),
                task: tokio::sync::Mutex::new(Some(tokio::spawn(pump(
                    source, stream, writer, phase, hard_end, cancel,
                )))),
                receipt,
            });
            self.phases
                .lock()
                .map_err(|_| StreamError::JoinFailed)?
                .controls[phase.index()] = Some(control.clone());
            Ok(OpenedStream {
                file: Some(reader),
                control,
            })
        }
    }

    /// Revoke source authority synchronously. Phase-only cancellation belongs to
    /// OpenedStream, so retiring Probe does not prevent a fresh Decode request.
    pub fn cancel(&self) {
        if let Some(source) = &self.source {
            source.cancel();
        }
        if let Ok(phases) = self.phases.lock() {
            for control in phases.controls.iter().flatten() {
                control.cancel.cancel();
            }
        }
    }

    /// Joins producers, then waits for provider cleanup. Decoder reaping and
    /// output revocation are separate host obligations; neither is acknowledged.
    pub async fn finish(&mut self) -> Result<FactoryRetirement, StreamError> {
        if let Some(result) = self.terminal {
            return result;
        }
        self.cancel();
        let controls = self
            .phases
            .lock()
            .map_err(|_| StreamError::JoinFailed)?
            .controls
            .clone();
        for control in controls.into_iter().flatten() {
            control.retire().await?;
        }
        if self.cleanup.is_none() {
            let source = self.source.take().ok_or(StreamError::InvalidPhase)?;
            let source = match Arc::try_unwrap(source) {
                Ok(source) => source,
                Err(source) => {
                    self.source = Some(source);
                    return Err(StreamError::Busy);
                }
            };
            // Mandatory provider cleanup retains its result even if this await
            // is cancelled. A later finish joins the same operation, no replay.
            self.cleanup = Some(tokio::spawn(async move {
                source
                    .finish()
                    .await
                    .map_err(StreamError::Source)
                    .map(|_| FactoryRetirement {
                        producers_joined: true,
                        provider_cleanup_confirmed: true,
                    })
            }));
        }
        let result = self
            .cleanup
            .as_mut()
            .ok_or(StreamError::JoinFailed)?
            .await
            .unwrap_or(Err(StreamError::JoinFailed));
        self.cleanup.take();
        self.terminal = Some(result);
        result
    }
}
impl Drop for StreamFactory {
    fn drop(&mut self) {
        self.cancel();
    }
}

#[cfg(unix)]
async fn pump(
    source: Arc<AuthorizedSource>,
    mut stream: MpegTsStream,
    mut writer: tokio::net::UnixStream,
    phase: StreamPhase,
    hard_end: Instant,
    cancel: CancellationToken,
) -> ProducerRetirement {
    use tokio::io::AsyncWriteExt;
    let mut report = ProducerRetirement {
        bytes: 0,
        eof: false,
        cancelled: false,
        joined: false,
        error: None,
    };
    let result: Result<(), StreamError> = async {
        loop {
            source.check_authority().map_err(StreamError::Source)?;
            let chunk = tokio::select! { biased;
                _ = cancel.cancelled() => { report.cancelled = true; return Ok(()); },
                _ = tokio::time::sleep_until(tokio::time::Instant::from_std(hard_end)) => return Err(StreamError::Expired),
                result = stream.next_chunk() => result.map_err(|error| StreamError::Source(RuntimeError::Network(error)))?,
            };
            let Some(chunk) = chunk else { report.eof = true; return Ok(()); };
            source.check_authority().map_err(StreamError::Source)?;
            let mut offset = 0;
            while offset < chunk.len() {
                source.check_authority().map_err(StreamError::Source)?;
                if phase == StreamPhase::Probe && report.bytes >= PROBE_BYTE_LIMIT { return Err(StreamError::ProbeLimit); }
                let end = if phase == StreamPhase::Probe {
                    chunk.len().min(offset + (PROBE_BYTE_LIMIT - report.bytes) as usize)
                } else { chunk.len() };
                let written = tokio::select! { biased;
                    _ = cancel.cancelled() => { report.cancelled = true; return Ok(()); },
                    _ = tokio::time::sleep_until(tokio::time::Instant::from_std(hard_end)) => return Err(StreamError::Expired),
                    result = tokio::time::timeout(Duration::from_secs(8), writer.write(&chunk[offset..end])) =>
                        result.map_err(|_| StreamError::Source(RuntimeError::Network(NetworkError::Timeout)))?
                            .map_err(|_| StreamError::Io)?,
                };
                if written == 0 { return Err(StreamError::Io); }
                report.bytes = report.bytes.checked_add(written as u64).ok_or(StreamError::ProbeLimit)?;
                offset += written;
            }
            // Drop the guarded chunk before requesting another: retained views
            // intentionally keep its one-chunk memory/admission permit occupied.
        }
    }.await;
    if let Err(error) = result {
        report.error = Some(error);
    }
    if cancel.is_cancelled() {
        report.cancelled = true;
    }
    stream.cancel();
    drop(writer);
    report
}

#[cfg(all(test, unix))]
#[path = "stream_tests.rs"]
mod tests;
