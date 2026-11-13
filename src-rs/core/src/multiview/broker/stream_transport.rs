//! Pull-based checked MPEG-TS subscriptions. The host owns the producer task and
//! joins it before acknowledging retirement. No URL crosses this boundary.
use super::network::{CheckedTransport, Error, OriginCredentials};
use axum::body::Bytes;
use std::{sync::Arc, time::Duration};
use tokio::{
    sync::{OwnedSemaphorePermit, Semaphore},
    time::Instant,
};
use tokio_util::sync::CancellationToken;

pub const CHUNK_BYTES: usize = 64 * 1024;
/// One inbound frame maximum. This is independent of HTTP/1's parser buffers;
/// the checked client uses Hyper's separately bounded parser, then 32KiB headers.
pub const INBOUND_FRAME_BYTES: usize = 512 * 1024;
const PACKET_BYTES: usize = 188;
const SNIFF_BYTES: usize = 5 * PACKET_BYTES;

/// Supplied by the trusted host, never a native request. Every subscription has
/// an absolute hard end; body backpressure does not extend it.
#[derive(Clone, Copy, Debug)]
pub struct StreamLimits {
    pub first_response: Duration,
    pub idle: Duration,
    pub hard_end: Instant,
}
impl StreamLimits {
    pub fn new(hard_end: Instant) -> Self {
        Self {
            first_response: Duration::from_secs(8),
            idle: Duration::from_secs(8),
            hard_end,
        }
    }
    fn validate(&self) -> Result<(), Error> {
        let now = Instant::now();
        if self.first_response.is_zero()
            || self.first_response > Duration::from_secs(30)
            || self.idle.is_zero()
            || self.idle > Duration::from_secs(30)
            || self.hard_end <= now
            || self.hard_end.duration_since(now) > Duration::from_secs(24 * 60 * 60)
        {
            return Err(Error::InvalidConfiguration);
        }
        Ok(())
    }
}

/// Ownership follows returned Bytes and every retained slice, including after
/// stream EOF/drop. No response or stream is captured, avoiding an ownership cycle.
struct ChunkOwner {
    bytes: Bytes,
    _request: Arc<OwnedSemaphorePermit>,
    _source: Arc<OwnedSemaphorePermit>,
    _chunk: OwnedSemaphorePermit,
}

/// At most one upstream frame, never a queue. Output is copied, so retaining a
/// 64KiB slice cannot retain the potentially larger upstream frame allocation.
#[derive(Default)]
struct PacketBuffer {
    pending: Option<Bytes>,
    received: u64,
}
impl PacketBuffer {
    fn accept(&mut self, bytes: Bytes) -> Result<(), Error> {
        if self.pending.is_some() {
            return Err(Error::Busy);
        }
        if bytes.len() > INBOUND_FRAME_BYTES {
            return Err(Error::TooLarge);
        }
        if !bytes.is_empty() {
            self.pending = Some(bytes);
        }
        Ok(())
    }
    fn take(&mut self, maximum: usize) -> Result<Option<Bytes>, Error> {
        if maximum == 0 || maximum > CHUNK_BYTES {
            return Err(Error::InvalidConfiguration);
        }
        let Some(pending) = self.pending.as_mut() else {
            return Ok(None);
        };
        let count = pending.len().min(maximum);
        check_packets(&pending[..count], self.received)?;
        let output = Bytes::copy_from_slice(&pending[..count]);
        // Drop only the consumed view; the single remainder stays here.
        drop(pending.split_to(count));
        self.received = self
            .received
            .checked_add(count as u64)
            .ok_or(Error::TooLarge)?;
        if pending.is_empty() {
            self.pending = None;
        }
        Ok(Some(output))
    }
    fn eof(&self) -> Result<(), Error> {
        if self.pending.is_some() || self.received % PACKET_BYTES as u64 != 0 {
            Err(Error::InvalidResponse)
        } else {
            Ok(())
        }
    }
}
impl AsRef<[u8]> for ChunkOwner {
    fn as_ref(&self) -> &[u8] {
        &self.bytes
    }
}

/// Each fresh Probe/Decode subscription owns an independent HTTP body. Dropping
/// one never cancels the shared provider/source lease. No Clone/Debug/Serialize.
/// App custody is bounded to one <=512KiB inbound frame, one <=64KiB output and
/// a 940-byte sniff prefix per admitted stream, separate from Hyper's parser.
pub struct MpegTsStream {
    response: Option<reqwest::Response>,
    prefix: Option<Bytes>,
    request: Arc<OwnedSemaphorePermit>,
    source: Arc<OwnedSemaphorePermit>,
    chunk_gate: Arc<Semaphore>,
    cancel: CancellationToken,
    limits: StreamLimits,
    buffer: PacketBuffer,
    failure: Option<Error>,
    eof: bool,
}
impl MpegTsStream {
    /// Opening is private to an already resolved, owned source. No new grant is
    /// redeemed and no provider stream resolver is invoked for a second reader.
    pub(super) async fn open(
        transport: &CheckedTransport,
        raw: &str,
        credentials: Option<&OriginCredentials>,
        owner: &CancellationToken,
        source: Arc<OwnedSemaphorePermit>,
        limits: StreamLimits,
    ) -> Result<Self, Error> {
        limits.validate()?;
        let cancel = owner.child_token();
        if cancel.is_cancelled() {
            return Err(Error::Cancelled);
        }
        let deadline = (Instant::now() + limits.first_response).min(limits.hard_end);
        let opened = transport
            .open_continuous(raw, credentials, &cancel, deadline)
            .await?;
        let mut stream = Self {
            response: Some(opened.response),
            prefix: None,
            request: opened.permit,
            source,
            chunk_gate: Arc::new(Semaphore::new(1)),
            cancel,
            limits,
            buffer: PacketBuffer::default(),
            failure: None,
            eof: false,
        };
        let mut prefix = Vec::new();
        while prefix.len() < SNIFF_BYTES {
            let idle_deadline = deadline.min(Instant::now() + limits.idle);
            let Some(bytes) = stream
                .read_frame(idle_deadline, SNIFF_BYTES - prefix.len())
                .await?
            else {
                return Err(Error::Unsupported);
            };
            prefix.extend_from_slice(&bytes);
        }
        // read_frame checked packet sync/adaptation headers at every offset;
        // at least five whole packets are required before any byte escapes.
        stream.prefix = Some(Bytes::from(prefix));
        Ok(stream)
    }

    pub fn cancel(&self) {
        self.cancel.cancel();
    }
    /// A clone only cancels this subscription, never the source/provider lease.
    pub fn cancellation(&self) -> CancellationToken {
        self.cancel.clone()
    }

    /// One outstanding chunk maximum. Busy never polls the upstream body and
    /// never revokes a valid stream; drop the previous Bytes/slices, then retry.
    pub async fn next_chunk(&mut self) -> Result<Option<Bytes>, Error> {
        if let Some(error) = self.failure {
            return Err(error);
        }
        if self.cancel.is_cancelled() {
            return self.fail(Error::Cancelled);
        }
        if Instant::now() >= self.limits.hard_end {
            return self.fail(Error::Timeout);
        }
        let chunk = self
            .chunk_gate
            .clone()
            .try_acquire_owned()
            .map_err(|_| Error::Busy)?;
        let bytes = if let Some(prefix) = self.prefix.take() {
            Some(prefix)
        } else if self.eof {
            None
        } else {
            let deadline = (Instant::now() + self.limits.idle).min(self.limits.hard_end);
            match self.read_frame(deadline, CHUNK_BYTES).await {
                Ok(bytes) => bytes,
                Err(error) => return self.fail(error),
            }
        };
        if self.cancel.is_cancelled() {
            return self.fail(Error::Cancelled);
        }
        if Instant::now() >= self.limits.hard_end {
            return self.fail(Error::Timeout);
        }
        Ok(bytes.map(|bytes| {
            Bytes::from_owner(ChunkOwner {
                bytes,
                _request: self.request.clone(),
                _source: self.source.clone(),
                _chunk: chunk,
            })
        }))
    }
    fn fail<T>(&mut self, error: Error) -> Result<T, Error> {
        self.failure = Some(error);
        self.response.take();
        self.prefix.take();
        self.buffer.pending.take();
        self.cancel.cancel();
        Err(error)
    }
    async fn read_frame(
        &mut self,
        deadline: Instant,
        maximum: usize,
    ) -> Result<Option<Bytes>, Error> {
        loop {
            if self.cancel.is_cancelled() {
                return Err(Error::Cancelled);
            }
            if Instant::now() >= deadline.min(self.limits.hard_end) {
                return Err(Error::Timeout);
            }
            if let Some(bytes) = self.buffer.take(maximum)? {
                return Ok(Some(bytes));
            }
            let response = self.response.as_mut().ok_or(Error::Cancelled)?;
            let next = tokio::select! { biased;
                _ = self.cancel.cancelled() => return Err(Error::Cancelled),
                value = tokio::time::timeout_at(deadline.min(self.limits.hard_end), response.chunk()) => value.map_err(|_| Error::Timeout)?.map_err(|_| Error::Transport)?,
            };
            let Some(bytes) = next else {
                self.eof = true;
                self.response.take();
                self.buffer.eof()?;
                return Ok(None);
            };
            self.buffer.accept(bytes)?;
        }
    }
}
impl Drop for MpegTsStream {
    fn drop(&mut self) {
        self.cancel.cancel();
    }
}

fn check_packets(bytes: &[u8], received: u64) -> Result<(), Error> {
    for (index, byte) in bytes.iter().enumerate() {
        let position = (received % PACKET_BYTES as u64 + index as u64) % PACKET_BYTES as u64;
        if position == 0 && *byte != 0x47 || position == 3 && byte & 0x30 == 0 {
            return Err(Error::Unsupported);
        }
    }
    Ok(())
}

#[cfg(test)]
#[path = "stream_transport_tests.rs"]
mod tests;
