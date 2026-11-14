//! Synthetic fixture transport only: local UnixStream pairs, never a listener.
//! This module does not issue grants, inspect MPEG-TS, or prove decoder behavior.
use std::{
    fs::File,
    io::{self, Write},
    os::{fd::OwnedFd, unix::net::UnixStream},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

pub const MAX_PAYLOAD_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_PUMP_DURATION: Duration = Duration::from_secs(120);
pub const MAX_JOIN_WAIT: Duration = Duration::from_secs(5);
const CHUNK_BYTES: usize = 7 * 188;
pub const MIN_BYTES_PER_SECOND: usize = 1024;
pub const MAX_BYTES_PER_SECOND: usize = 16 * 1024 * 1024;
const RETRY: Duration = Duration::from_millis(2);

#[derive(Clone, Default)]
pub struct Cancellation(Arc<AtomicBool>);
impl Cancellation {
    pub fn cancel(&self) {
        self.0.store(true, Ordering::Release);
    }
    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::Acquire)
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StopReason {
    Complete,
    Cancelled,
    Deadline,
    ReaderClosed,
    Io(io::ErrorKind),
}
#[must_use = "only a joined outcome proves producer retirement"]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Outcome {
    pub end_reason: StopReason,
    pub bytes_written: usize,
    pub write_calls: usize,
    pub joined: bool,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StartError {
    EmptyPayload,
    OversizedPayload,
    InvalidDuration,
    InvalidRate,
    Socket(io::ErrorKind),
    Spawn(io::ErrorKind),
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum JoinError {
    InvalidWait,
    WaitExpired,
    AlreadyJoined,
    Panicked,
}

/// Initial release is a fixture timing gate, never authorization or revocation.
/// The deadline includes all time held at this gate. Rate is an upper pacing
/// target with at most one1316byte initial packet burst, not realtime QoS.
#[derive(Clone)]
pub struct Options {
    pub deadline: Instant,
    pub start_gate: Option<Arc<AtomicBool>>,
    pub max_bytes_per_second: Option<usize>,
}
impl Options {
    pub fn for_duration(duration: Duration) -> Result<Self, StartError> {
        if duration.is_zero() || duration > MAX_PUMP_DURATION {
            return Err(StartError::InvalidDuration);
        }
        Ok(Self {
            deadline: Instant::now() + duration,
            start_gate: None,
            max_bytes_per_second: None,
        })
    }
}

/// The caller MUST explicitly join. A cancelled or timed-out request is not
/// proof that its producer has retired. Drop requests cancellation only.
#[must_use = "keep this owner until explicit join proves producer retirement"]
pub struct Producer {
    cancelled: Cancellation,
    thread: Option<JoinHandle<Outcome>>,
}
impl Producer {
    pub fn cancellation(&self) -> Cancellation {
        self.cancelled.clone()
    }
    pub fn request_cancel(&self) {
        self.cancelled.cancel();
    }
    pub fn is_joined(&self) -> bool {
        self.thread.is_none()
    }
    pub fn is_finished(&self) -> bool {
        self.thread.as_ref().is_none_or(JoinHandle::is_finished)
    }

    /// Cooperative timed wait. WaitExpired preserves the handle for a later
    /// explicit stop/join; it never converts cancellation to retirement.
    pub fn join_until(&mut self, wait: Duration) -> Result<Outcome, JoinError> {
        if wait > MAX_JOIN_WAIT {
            return Err(JoinError::InvalidWait);
        }
        let Some(handle) = self.thread.as_ref() else {
            return Err(JoinError::AlreadyJoined);
        };
        let until = Instant::now() + wait;
        while !handle.is_finished() {
            let remaining = until.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(JoinError::WaitExpired);
            }
            thread::sleep(RETRY.min(remaining));
        }
        // No IO happens after the pump returns. is_finished is checked before
        // join; OS thread teardown is not promised to have a hard wall deadline.
        let mut result = self
            .thread
            .take()
            .unwrap()
            .join()
            .map_err(|_| JoinError::Panicked)?;
        result.joined = true;
        Ok(result)
    }
    pub fn stop_and_join(&mut self, wait: Duration) -> Result<Outcome, JoinError> {
        self.request_cancel();
        self.join_until(wait)
    }
}
impl Drop for Producer {
    fn drop(&mut self) {
        self.request_cancel();
        // Deliberately do not block in Drop. Misuse (dropping an unjoined owner)
        // can detach the Rust handle. Callers must treat that as unretired, and
        // the outer fixture process supervisor remains the final owner.
    }
}

/// Each call creates independent socket endpoints and a fresh blocking reader
/// File. Call twice for probe and decode; do not duplicate a reader's OFD.
/// Bytes are opaque here: only the real core may verify MPEG-TS metadata.
pub fn pair(payload: Arc<[u8]>, duration: Duration) -> Result<(File, Producer), StartError> {
    pair_with_options(payload, Options::for_duration(duration)?)
}
pub fn pair_with_options(
    payload: Arc<[u8]>,
    options: Options,
) -> Result<(File, Producer), StartError> {
    pair_with_options_and_cancel(payload, options, Cancellation::default())
}
pub fn pair_with_cancel(
    payload: Arc<[u8]>,
    duration: Duration,
    cancelled: Cancellation,
) -> Result<(File, Producer), StartError> {
    pair_with_options_and_cancel(payload, Options::for_duration(duration)?, cancelled)
}
fn pair_with_options_and_cancel(
    payload: Arc<[u8]>,
    options: Options,
    cancelled: Cancellation,
) -> Result<(File, Producer), StartError> {
    if payload.is_empty() {
        return Err(StartError::EmptyPayload);
    }
    if payload.len() > MAX_PAYLOAD_BYTES {
        return Err(StartError::OversizedPayload);
    }
    let remaining = options.deadline.saturating_duration_since(Instant::now());
    if remaining.is_zero() || remaining > MAX_PUMP_DURATION {
        return Err(StartError::InvalidDuration);
    }
    if options
        .max_bytes_per_second
        .is_some_and(|r| !(MIN_BYTES_PER_SECOND..=MAX_BYTES_PER_SECOND).contains(&r))
    {
        return Err(StartError::InvalidRate);
    }
    let (reader, mut writer) = UnixStream::pair().map_err(|e| StartError::Socket(e.kind()))?;
    // These are opposite endpoints, not dup handles. Setting writer flags does
    // not make the reader nonblocking; FFmpeg may perform ordinary fd reads.
    writer
        .set_nonblocking(true)
        .map_err(|e| StartError::Socket(e.kind()))?;
    let until = options.deadline;
    let signal = cancelled.clone();
    let handle = thread::Builder::new()
        .name("synthetic-ts-producer".into())
        .spawn(move || {
            let mut at = 0;
            let mut write_calls = 0;
            let mut released_at: Option<Instant> = None;
            let reason = loop {
                if signal.is_cancelled() {
                    break StopReason::Cancelled;
                }
                if Instant::now() >= until {
                    break StopReason::Deadline;
                }
                if at == payload.len() {
                    break StopReason::Complete;
                }
                if released_at.is_none() {
                    if options
                        .start_gate
                        .as_ref()
                        .is_some_and(|g| !g.load(Ordering::Acquire))
                    {
                        thread::sleep(RETRY.min(until.saturating_duration_since(Instant::now())));
                        continue;
                    }
                    released_at = Some(Instant::now());
                }
                if let Some(rate) = options.max_bytes_per_second {
                    let next =
                        released_at.unwrap() + Duration::from_secs_f64(at as f64 / rate as f64);
                    let pause = next.saturating_duration_since(Instant::now());
                    if !pause.is_zero() {
                        thread::sleep(
                            RETRY
                                .min(pause)
                                .min(until.saturating_duration_since(Instant::now())),
                        );
                        continue;
                    }
                }
                let end = at.saturating_add(CHUNK_BYTES).min(payload.len());
                write_calls += 1;
                match writer.write(&payload[at..end]) {
                    Ok(0) => break StopReason::Io(io::ErrorKind::WriteZero),
                    Ok(written) => {
                        at += written;
                    }
                    Err(e) if e.kind() == io::ErrorKind::WouldBlock => {
                        let left = until.saturating_duration_since(Instant::now());
                        thread::sleep(RETRY.min(left));
                    }
                    Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
                    Err(e)
                        if matches!(
                            e.kind(),
                            io::ErrorKind::BrokenPipe
                                | io::ErrorKind::ConnectionReset
                                | io::ErrorKind::NotConnected
                        ) =>
                    {
                        break StopReason::ReaderClosed
                    }
                    Err(e) => break StopReason::Io(e.kind()),
                }
            };
            drop(writer); // EOF is visible to a blocking reader on every terminal path.
            Outcome {
                end_reason: reason,
                bytes_written: at,
                write_calls,
                joined: false,
            }
        })
        .map_err(|e| StartError::Spawn(e.kind()))?;
    let descriptor: OwnedFd = reader.into();
    Ok((
        File::from(descriptor),
        Producer {
            cancelled,
            thread: Some(handle),
        },
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{io::Read, os::fd::AsRawFd};
    fn data(n: usize) -> Arc<[u8]> {
        (0..n).map(|i| (i % 251) as u8).collect::<Vec<_>>().into()
    }
    fn blocked() -> (File, Producer) {
        pair(data(MAX_PAYLOAD_BYTES), Duration::from_secs(2)).unwrap()
    }

    #[test]
    fn actual_payload_eof_and_explicit_join() {
        let expected = data(96 * 1024);
        let (mut reader, mut owner) = pair(expected.clone(), Duration::from_secs(2)).unwrap();
        let mut actual = Vec::new();
        reader.read_to_end(&mut actual).unwrap();
        let result = owner.join_until(Duration::from_secs(1)).unwrap();
        assert_eq!(actual.as_slice(), expected.as_ref());
        assert_eq!(
            result,
            Outcome {
                end_reason: StopReason::Complete,
                bytes_written: expected.len(),
                write_calls: result.write_calls,
                joined: true
            }
        );
        assert!(owner.is_joined());
    }
    #[test]
    fn blocked_reader_cancellation_retires_owner() {
        let (_reader, mut owner) = blocked();
        thread::sleep(Duration::from_millis(10));
        let began = Instant::now();
        let result = owner.stop_and_join(Duration::from_secs(1)).unwrap();
        assert!(result.joined);
        assert_eq!(result.end_reason, StopReason::Cancelled);
        assert!(result.bytes_written < MAX_PAYLOAD_BYTES);
        assert!(began.elapsed() < Duration::from_secs(1));
        assert!(owner.is_joined());
    }
    #[test]
    fn blocked_writer_deadline_is_distinct_from_cancellation() {
        let (_reader, mut owner) =
            pair(data(MAX_PAYLOAD_BYTES), Duration::from_millis(25)).unwrap();
        let result = owner.join_until(Duration::from_secs(1)).unwrap();
        assert_eq!(result.end_reason, StopReason::Deadline);
        assert!(result.bytes_written < MAX_PAYLOAD_BYTES);
        assert!(owner.is_joined());
    }
    #[test]
    fn join_timeout_keeps_handle_then_explicit_drain() {
        let (_reader, mut owner) = blocked();
        assert_eq!(
            owner.join_until(Duration::ZERO),
            Err(JoinError::WaitExpired)
        );
        assert!(!owner.is_joined());
        assert_eq!(
            owner
                .stop_and_join(Duration::from_secs(1))
                .unwrap()
                .end_reason,
            StopReason::Cancelled
        );
        assert!(owner.is_joined());
    }
    #[test]
    fn invalid_wait_does_not_consume_owner() {
        let (_reader, mut owner) = blocked();
        assert_eq!(
            owner.join_until(MAX_JOIN_WAIT + Duration::from_millis(1)),
            Err(JoinError::InvalidWait)
        );
        assert!(!owner.is_joined());
        assert!(owner.stop_and_join(Duration::from_secs(1)).unwrap().joined);
    }
    #[test]
    fn fresh_probe_and_decode_readers_are_independent_and_nonseekable() {
        let expected = data(32 * 1024);
        let (mut probe, mut a) = pair(expected.clone(), Duration::from_secs(2)).unwrap();
        let (mut decode, mut b) = pair(expected.clone(), Duration::from_secs(2)).unwrap();
        assert_ne!(probe.as_raw_fd(), decode.as_raw_fd());
        let mut first = [0; 188];
        probe.read_exact(&mut first).unwrap();
        let mut decode_all = Vec::new();
        decode.read_to_end(&mut decode_all).unwrap();
        assert_eq!(decode_all.as_slice(), expected.as_ref());
        let mut probe_tail = Vec::new();
        probe.read_to_end(&mut probe_tail).unwrap();
        assert_eq!(first.as_slice(), &expected[..188]);
        assert_eq!(probe_tail.as_slice(), &expected[188..]);
        use std::io::{Seek, SeekFrom};
        assert!(probe.seek(SeekFrom::Start(0)).is_err());
        assert_eq!(
            a.join_until(Duration::from_secs(1)).unwrap().end_reason,
            StopReason::Complete
        );
        assert_eq!(
            b.join_until(Duration::from_secs(1)).unwrap().end_reason,
            StopReason::Complete
        );
        assert!(a.is_joined() && b.is_joined());
    }
    #[test]
    fn cancellation_handle_does_not_imply_retirement() {
        let (_reader, mut owner) = blocked();
        let signal = owner.cancellation();
        signal.cancel();
        assert!(signal.is_cancelled());
        assert!(!owner.is_joined());
        assert!(owner.join_until(Duration::from_secs(1)).unwrap().joined);
        assert!(owner.is_joined());
    }
    #[test]
    fn reader_close_returns_typed_outcome_and_joins() {
        let (reader, mut owner) = blocked();
        drop(reader);
        let result = owner.join_until(Duration::from_secs(1)).unwrap();
        assert_eq!(result.end_reason, StopReason::ReaderClosed);
        assert!(owner.is_joined());
    }
    #[test]
    fn invalid_payload_and_duration_refuse_before_spawn() {
        assert!(matches!(
            pair(Arc::<[u8]>::from([]), Duration::from_secs(1)),
            Err(StartError::EmptyPayload)
        ));
        assert!(matches!(
            pair(data(MAX_PAYLOAD_BYTES + 1), Duration::from_secs(1)),
            Err(StartError::OversizedPayload)
        ));
        assert!(matches!(
            pair(data(1), Duration::ZERO),
            Err(StartError::InvalidDuration)
        ));
        assert!(matches!(
            pair(data(1), MAX_PUMP_DURATION + Duration::from_millis(1)),
            Err(StartError::InvalidDuration)
        ));
    }
    #[test]
    fn already_cancelled_sends_no_bytes() {
        let signal = Cancellation(Arc::new(AtomicBool::new(true)));
        let (mut reader, mut owner) =
            pair_with_cancel(data(188), Duration::from_secs(1), signal).unwrap();
        let mut bytes = Vec::new();
        reader.read_to_end(&mut bytes).unwrap();
        assert!(bytes.is_empty());
        assert_eq!(
            owner.join_until(Duration::from_secs(1)).unwrap(),
            Outcome {
                end_reason: StopReason::Cancelled,
                bytes_written: 0,
                write_calls: 0,
                joined: true
            }
        );
        assert_eq!(
            owner.join_until(Duration::ZERO),
            Err(JoinError::AlreadyJoined)
        );
    }
    #[test]
    fn held_start_gate_cancels_without_sending_bytes() {
        let gate = Arc::new(AtomicBool::new(false));
        let mut options = Options::for_duration(Duration::from_secs(1)).unwrap();
        options.start_gate = Some(gate);
        let (mut reader, mut owner) = pair_with_options(data(188), options).unwrap();
        thread::sleep(Duration::from_millis(10));
        let result = owner.stop_and_join(Duration::from_secs(1)).unwrap();
        assert_eq!(result.end_reason, StopReason::Cancelled);
        assert_eq!(result.bytes_written, 0);
        assert_eq!(result.write_calls, 0);
        assert!(result.joined);
        let mut bytes = Vec::new();
        reader.read_to_end(&mut bytes).unwrap();
        assert!(bytes.is_empty());
    }
    #[test]
    fn releasing_initial_gate_delivers_payload_and_eof() {
        let gate = Arc::new(AtomicBool::new(false));
        let mut options = Options::for_duration(Duration::from_secs(1)).unwrap();
        options.start_gate = Some(gate.clone());
        let (mut reader, mut owner) = pair_with_options(data(188), options).unwrap();
        assert_eq!(
            owner.join_until(Duration::ZERO),
            Err(JoinError::WaitExpired)
        );
        gate.store(true, Ordering::Release);
        let mut bytes = Vec::new();
        reader.read_to_end(&mut bytes).unwrap();
        assert_eq!(bytes.len(), 188);
        assert_eq!(
            owner.join_until(Duration::from_secs(1)).unwrap().end_reason,
            StopReason::Complete
        );
        assert!(owner.is_joined());
    }
    #[test]
    fn held_gate_deadline_sends_nothing() {
        let mut options = Options::for_duration(Duration::from_millis(25)).unwrap();
        options.start_gate = Some(Arc::new(AtomicBool::new(false)));
        let (_reader, mut owner) = pair_with_options(data(188), options).unwrap();
        let result = owner.join_until(Duration::from_secs(1)).unwrap();
        assert_eq!(result.end_reason, StopReason::Deadline);
        assert_eq!(result.bytes_written, 0);
        assert!(result.joined);
    }
    #[test]
    fn rate_pacing_retains_owner_until_done() {
        let mut options = Options::for_duration(Duration::from_secs(2)).unwrap();
        options.max_bytes_per_second = Some(64 * 1024);
        let began = Instant::now();
        let (mut reader, mut owner) = pair_with_options(data(16 * 1024), options).unwrap();
        let mut bytes = Vec::new();
        reader.read_to_end(&mut bytes).unwrap();
        let result = owner.join_until(Duration::from_secs(1)).unwrap();
        assert_eq!(bytes.len(), 16 * 1024);
        assert_eq!(result.end_reason, StopReason::Complete);
        assert!(result.joined);
        assert!(result.write_calls >= 13);
        assert!(began.elapsed() >= Duration::from_millis(200));
    }
    #[test]
    fn invalid_rate_refuses_before_spawn() {
        for rate in [0, MIN_BYTES_PER_SECOND - 1, MAX_BYTES_PER_SECOND + 1] {
            let mut options = Options::for_duration(Duration::from_secs(1)).unwrap();
            options.max_bytes_per_second = Some(rate);
            assert!(matches!(
                pair_with_options(data(188), options),
                Err(StartError::InvalidRate)
            ));
        }
    }
}
