//! Independently owned file/descriptor decoders. No network resolution or fetches.
//!
//! Each source advances its video and audio together; selecting another audio
//! queue does not start a new decoder or reset the output encoder's sample clock.
use super::frames::{FrameContentRect, FrameSpec, LatestFrame};
use std::{
    collections::VecDeque,
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::{Component, Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

const AUDIO_BLOCK: usize = 960 * 2;
const AUDIO_LIMIT: usize = AUDIO_BLOCK * 8;
const PROBE_LIMIT: u64 = 65_536;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DecoderError {
    InvalidInput,
    Unsupported,
    ProbeFailed,
    ProbeTimeout,
    ProbeLimit,
    StaleGeneration,
    Expired,
    Revoked,
    BindingMismatch,
    PublicationDenied,
    Backpressure,
    Stalled,
    Cancelled,
    Io,
}

pub struct DecoderConfig {
    pub ffmpeg: PathBuf,
    pub ffprobe: PathBuf,
    pub frame_spec: FrameSpec,
    pub fps: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
/// Immutable issue/attach identity: source_revision is the expected pre-play
/// ticket revision; the decoder's subsequent generation is a separate value.
/// Active-source authorization belongs to the
/// broker's owner/runtime/slot/source lease; unrelated focus/layout changes must
/// not retire unchanged decoders merely because these issue-time fields differ.
pub struct BoundContext {
    pub runtime: u64,
    pub slot_id: u8,
    pub source_revision: u64,
    pub geometry_revision: u64,
    pub focus_revision: u64,
    pub audio_revision: u64,
}

/// The trusted source broker must hold its owner/generation barrier across the
/// complete callback. An AtomicBool check without that barrier is insufficient.
/// Active frame publication must never implicitly activate a reserved grant.
pub trait PublicationAuthority: Send + Sync {
    /// Attach/promote a reserved source under its owner publication barrier.
    /// The callback is bounded in-memory work, never probe/spawn/stop/join.
    fn attach(
        &self,
        context: &BoundContext,
        operation: &mut dyn FnMut() -> Result<(), DecoderError>,
    ) -> Result<(), DecoderError>;

    /// Publish an already-active frame or PCM block. Never promote reservations.
    fn publish(
        &self,
        context: &BoundContext,
        operation: &mut dyn FnMut() -> Result<(), DecoderError>,
    ) -> Result<(), DecoderError>;
}

struct Binding {
    context: BoundContext,
    expires_at: Instant,
    revoked: Arc<AtomicBool>,
    authority: Arc<dyn PublicationAuthority>,
    active: AtomicBool,
}
impl Binding {
    fn check(&self, expected: &BoundContext) -> Result<(), DecoderError> {
        if expected != &self.context {
            return Err(DecoderError::BindingMismatch);
        }
        if self.revoked.load(Ordering::Acquire) {
            return Err(DecoderError::Revoked);
        }
        if Instant::now() >= self.expires_at {
            return Err(DecoderError::Expired);
        }
        Ok(())
    }

    fn publish(
        &self,
        expected: &BoundContext,
        attach: bool,
        operation: &mut dyn FnMut() -> Result<(), DecoderError>,
    ) -> Result<(), DecoderError> {
        self.check(expected)?;
        if !attach && !self.active.load(Ordering::Acquire) {
            return Err(DecoderError::PublicationDenied);
        }
        let mut attempts = 0u8;
        let mut outcome = None;
        let mut guarded = || {
            attempts = attempts.saturating_add(1);
            if attempts != 1 {
                return Err(DecoderError::PublicationDenied);
            }
            let result = self.check(expected).and_then(|_| {
                if !attach && !self.active.load(Ordering::Acquire) {
                    return Err(DecoderError::PublicationDenied);
                }
                operation()?;
                if attach {
                    self.active.store(true, Ordering::Release);
                }
                Ok(())
            });
            outcome = Some(result);
            result
        };
        if attach {
            self.authority.attach(expected, &mut guarded)?;
        } else {
            self.authority.publish(expected, &mut guarded)?;
        }
        if attempts != 1 {
            return Err(DecoderError::PublicationDenied);
        }
        outcome.ok_or(DecoderError::PublicationDenied)?
    }
}

struct FileIdentity {
    #[cfg(unix)]
    device: u64,
    #[cfg(unix)]
    inode: u64,
}
impl FileIdentity {
    fn read(file: &File) -> Result<Self, DecoderError> {
        let metadata = file.metadata().map_err(|_| DecoderError::InvalidInput)?;
        if !metadata.is_file() {
            return Err(DecoderError::InvalidInput);
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            Ok(Self {
                device: metadata.dev(),
                inode: metadata.ino(),
            })
        }
        #[cfg(not(unix))]
        {
            Ok(Self {})
        }
    }
    fn check(&self, file: &File) -> Result<(), DecoderError> {
        let actual = Self::read(file)?;
        #[cfg(unix)]
        if actual.device != self.device || actual.inode != self.inode {
            return Err(DecoderError::InvalidInput);
        }
        #[cfg(not(unix))]
        let _ = actual;
        Ok(())
    }
}
struct GrantState {
    file: File,
    claimed: bool,
}

/// No pathname is retained or reopened after custody is established.
pub struct GrantedFile {
    state: Mutex<GrantState>,
    identity: FileIdentity,
    binding: Option<Arc<Binding>>,
}
impl std::fmt::Debug for GrantedFile {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("GrantedFile { .. }")
    }
}
impl GrantedFile {
    /// Explicit fixture-only factory. Production requires an already authorized
    /// descriptor from the source broker; canonicalization/open is not atomic.
    pub fn from_root(root: &Path, relative: &Path) -> Result<Self, DecoderError> {
        if relative.as_os_str().is_empty()
            || relative
                .components()
                .any(|part| !matches!(part, Component::Normal(_)))
        {
            return Err(DecoderError::InvalidInput);
        }
        let root = root
            .canonicalize()
            .map_err(|_| DecoderError::InvalidInput)?;
        if !root.is_dir() {
            return Err(DecoderError::InvalidInput);
        }
        let path = root
            .join(relative)
            .canonicalize()
            .map_err(|_| DecoderError::InvalidInput)?;
        if !path.starts_with(&root) || !path.is_file() {
            return Err(DecoderError::InvalidInput);
        }
        let file = File::open(path).map_err(|_| DecoderError::InvalidInput)?;
        Self::from_file(file, None)
    }

    pub fn from_authorized_file(
        file: File,
        context: BoundContext,
        expires_at: Instant,
        revoked: Arc<AtomicBool>,
        authority: Arc<dyn PublicationAuthority>,
    ) -> Result<Self, DecoderError> {
        if context.slot_id > 8 {
            return Err(DecoderError::InvalidInput);
        }
        let binding = Arc::new(Binding {
            context,
            expires_at,
            revoked,
            authority,
            active: AtomicBool::new(false),
        });
        binding.check(&context)?;
        Self::from_file(file, Some(binding))
    }

    fn from_file(file: File, binding: Option<Arc<Binding>>) -> Result<Self, DecoderError> {
        let identity = FileIdentity::read(&file)?;
        Ok(Self {
            state: Mutex::new(GrantState {
                file,
                claimed: false,
            }),
            identity,
            binding,
        })
    }

    pub fn check_binding(&self, expected: &BoundContext) -> Result<(), DecoderError> {
        self.binding
            .as_ref()
            .ok_or(DecoderError::BindingMismatch)?
            .check(expected)
    }

    pub fn is_bound(&self) -> bool {
        self.binding.is_some()
    }

    pub fn attach(
        &self,
        expected: &BoundContext,
        operation: &mut dyn FnMut() -> Result<(), DecoderError>,
    ) -> Result<(), DecoderError> {
        self.binding
            .as_ref()
            .ok_or(DecoderError::BindingMismatch)?
            .publish(expected, true, operation)
    }

    fn check_live(&self) -> Result<(), DecoderError> {
        if let Some(binding) = &self.binding {
            binding.check(&binding.context)?;
        }
        Ok(())
    }

    /// Cloned files share an open-file description. Serialize probe/seek while
    /// unclaimed, then never seek or clone again once a decoder owns stdin.
    fn claim(&self) -> Result<File, DecoderError> {
        self.check_live()?;
        let mut state = self.state.lock().map_err(|_| DecoderError::Io)?;
        if state.claimed {
            return Err(DecoderError::StaleGeneration);
        }
        self.identity.check(&state.file)?;
        state
            .file
            .seek(SeekFrom::Start(0))
            .map_err(|_| DecoderError::Io)?;
        let file = state.file.try_clone().map_err(|_| DecoderError::Io)?;
        self.check_live()?;
        state.claimed = true;
        Ok(file)
    }

    fn while_unclaimed<T>(
        &self,
        operation: impl FnOnce(File) -> Result<T, DecoderError>,
    ) -> Result<T, DecoderError> {
        self.check_live()?;
        let mut state = self.state.lock().map_err(|_| DecoderError::Io)?;
        if state.claimed {
            return Err(DecoderError::StaleGeneration);
        }
        self.identity.check(&state.file)?;
        state
            .file
            .seek(SeekFrom::Start(0))
            .map_err(|_| DecoderError::Io)?;
        let result = operation(state.file.try_clone().map_err(|_| DecoderError::Io)?);
        // No child still owns this shared offset: the bounded probe reaps first.
        state
            .file
            .seek(SeekFrom::Start(0))
            .map_err(|_| DecoderError::Io)?;
        self.check_live()?;
        result
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum StreamPhase {
    Probe,
    Decode,
}
#[derive(Default)]
struct StreamState {
    probe_issued: bool,
    probe_completed: bool,
    decode_issued: bool,
    started: bool,
}
struct StreamIdentity(Mutex<StreamState>);

/// A trusted Rust transport factory transfers fresh, exclusively owned Probe
/// and Decode read descriptors for this same immutable source identity. The host
/// owns producer cancellation/join and must include it in WorkerRetired; dropping
/// this type or reaping FFmpeg does not prove that the producer has retired.
pub struct GrantedStream {
    binding: Arc<Binding>,
    identity: Arc<StreamIdentity>,
}
pub struct StreamInput {
    reader: File,
    phase: StreamPhase,
    identity: Arc<StreamIdentity>,
}

/// Actual, bounded FFprobe metadata. Private fields bind this one-use receipt to
/// its grant and the exact prepared configuration; callers cannot supply claims.
pub struct PreparedStreamInfo {
    information: MediaInfo,
    identity: Arc<StreamIdentity>,
    ffmpeg: PathBuf,
    _ffprobe: PathBuf,
    configured_ffmpeg: PathBuf,
    configured_ffprobe: PathBuf,
    frame_spec: FrameSpec,
    fps: u32,
}
impl PreparedStreamInfo {
    pub fn info(&self) -> MediaInfo {
        self.information
    }
}

/// A non-destructive preflight for the host's prepare/commit boundary. Call it
/// before stopping the old decoder; the opaque proof/input are not cloneable.
pub fn validate_stream_preparation(
    config: &DecoderConfig,
    source: &GrantedStream,
    prepared: &PreparedStreamInfo,
    input: &StreamInput,
) -> Result<(), DecoderError> {
    checked_frame_bytes(config)?;
    source.binding.check(&source.binding.context)?;
    if !Arc::ptr_eq(&prepared.identity, &source.identity)
        || !Arc::ptr_eq(&input.identity, &source.identity)
        || input.phase != StreamPhase::Decode
    {
        return Err(DecoderError::BindingMismatch);
    }
    if prepared.configured_ffmpeg != config.ffmpeg
        || prepared.configured_ffprobe != config.ffprobe
        || prepared.frame_spec != config.frame_spec
        || prepared.fps != config.fps
    {
        return Err(DecoderError::InvalidInput);
    }
    let state = source.identity.0.lock().map_err(|_| DecoderError::Io)?;
    if !state.probe_completed || !state.decode_issued || state.started {
        return Err(DecoderError::StaleGeneration);
    }
    Ok(())
}
impl std::fmt::Debug for GrantedStream {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("GrantedStream { .. }")
    }
}
impl std::fmt::Debug for StreamInput {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("StreamInput { .. }")
    }
}
impl std::fmt::Debug for PreparedStreamInfo {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("PreparedStreamInfo { .. }")
    }
}
impl GrantedStream {
    pub fn from_authorized_stream(
        context: BoundContext,
        expires_at: Instant,
        revoked: Arc<AtomicBool>,
        authority: Arc<dyn PublicationAuthority>,
    ) -> Result<Self, DecoderError> {
        #[cfg(not(unix))]
        {
            let _ = (context, expires_at, revoked, authority);
            return Err(DecoderError::Unsupported);
        }
        #[cfg(unix)]
        {
            if context.slot_id > 8 {
                return Err(DecoderError::InvalidInput);
            }
            let binding = Arc::new(Binding {
                context,
                expires_at,
                revoked,
                authority,
                active: AtomicBool::new(false),
            });
            binding.check(&context)?;
            Ok(Self {
                binding,
                identity: Arc::new(StreamIdentity(Mutex::new(StreamState::default()))),
            })
        }
    }

    pub fn hard_end(&self) -> Instant {
        self.binding.expires_at
    }

    pub fn check_binding(&self, expected: &BoundContext) -> Result<(), DecoderError> {
        self.binding.check(expected)
    }

    pub fn attach(
        &self,
        expected: &BoundContext,
        operation: &mut dyn FnMut() -> Result<(), DecoderError>,
    ) -> Result<(), DecoderError> {
        self.check_binding(expected)?;
        if !self
            .identity
            .0
            .lock()
            .map_err(|_| DecoderError::Io)?
            .started
        {
            return Err(DecoderError::StaleGeneration);
        }
        self.binding.publish(expected, true, operation)
    }

    fn wrap(&self, reader: File, phase: StreamPhase) -> Result<StreamInput, DecoderError> {
        self.binding.check(&self.binding.context)?;
        #[cfg(not(unix))]
        {
            let _ = (reader, phase);
            return Err(DecoderError::Unsupported);
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::FileTypeExt;
            let kind = reader
                .metadata()
                .map_err(|_| DecoderError::InvalidInput)?
                .file_type();
            if !kind.is_socket() && !kind.is_fifo() {
                return Err(DecoderError::InvalidInput);
            }
            let mut state = self.identity.0.lock().map_err(|_| DecoderError::Io)?;
            match phase {
                StreamPhase::Probe if !state.probe_issued && !state.started => {
                    state.probe_issued = true
                }
                StreamPhase::Decode
                    if state.probe_completed && !state.decode_issued && !state.started =>
                {
                    state.decode_issued = true
                }
                _ => return Err(DecoderError::StaleGeneration),
            }
            Ok(StreamInput {
                reader,
                phase,
                identity: self.identity.clone(),
            })
        }
    }

    pub fn wrap_probe(&self, reader: File) -> Result<StreamInput, DecoderError> {
        self.wrap(reader, StreamPhase::Probe)
    }
    pub fn wrap_decode(&self, reader: File) -> Result<StreamInput, DecoderError> {
        self.wrap(reader, StreamPhase::Decode)
    }
}

fn publish_bound(
    binding: Option<&Binding>,
    operation: &mut dyn FnMut() -> Result<(), DecoderError>,
) -> Result<(), DecoderError> {
    if let Some(binding) = binding {
        binding.publish(&binding.context, false, operation)
    } else {
        // Only the unbound, explicit local-fixture mode takes this path.
        operation()
    }
}

fn wait_active(
    binding: Option<&Binding>,
    cancelled: &AtomicBool,
    began: Instant,
) -> Result<(), DecoderError> {
    if let Some(binding) = binding {
        while !binding.active.load(Ordering::Acquire) {
            if cancelled.load(Ordering::Acquire) || began.elapsed() >= Duration::from_secs(5) {
                return Err(DecoderError::PublicationDenied);
            }
            binding.check(&binding.context)?;
            thread::sleep(Duration::from_millis(5));
        }
    }
    Ok(())
}

fn check_fd_protocol(bytes: &[u8]) -> bool {
    let Ok(text) = std::str::from_utf8(bytes) else {
        return false;
    };
    let mut input = false;
    for line in text.lines().map(str::trim) {
        match line {
            "Input:" => input = true,
            "Output:" => input = false,
            "fd" if input => return true,
            _ => {}
        }
    }
    false
}

// Stream scheduling uses the actual Decode descriptor's output timestamps.
// Probe timestamps, first-ready sample counts and callback arrival times are not
// clock authorities. Each reader retains at most one RGB frame / 20 ms PCM.
use super::timing::{PacketStats, RationalTime, StatsParser, StreamKind};

fn timed_error<T>(result: Result<T, super::timing::StatsError>) -> Result<T, DecoderError> {
    result.map_err(|_| DecoderError::InvalidInput)
}
fn rational_samples(value: RationalTime) -> Result<i128, DecoderError> {
    value
        .numerator()
        .checked_mul(48_000)
        .map(|n| n.div_euclid(value.denominator()))
        .ok_or(DecoderError::InvalidInput)
}
fn elapsed_time(later: Instant, earlier: Instant) -> Result<RationalTime, DecoderError> {
    let (negative, duration) = if later >= earlier {
        (false, later.duration_since(earlier))
    } else {
        (true, earlier.duration_since(later))
    };
    let n = i128::try_from(duration.as_nanos()).map_err(|_| DecoderError::InvalidInput)?;
    timed_error(RationalTime::new(
        if negative { -n } else { n },
        1_000_000_000,
    ))
}
/// Session-local logical output clock. Copying a tick never retains this lock
/// across a queue, publication callback, media IO or process operation.
pub(crate) struct PresentationClock {
    tick: Mutex<Option<Instant>>,
    invalid: AtomicBool,
}
impl PresentationClock {
    pub(crate) fn new() -> Self {
        Self {
            tick: Mutex::new(None),
            invalid: AtomicBool::new(false),
        }
    }
    pub(crate) fn publish(&self, tick: Instant) -> Result<(), DecoderError> {
        let mut current = self.tick.lock().map_err(|_| DecoderError::Io)?;
        if current.is_some_and(|previous| tick < previous) {
            self.invalid.store(true, Ordering::Release);
            return Err(DecoderError::InvalidInput);
        }
        if self.invalid.load(Ordering::Acquire) {
            return Err(DecoderError::InvalidInput);
        }
        *current = Some(tick);
        Ok(())
    }
    pub(crate) fn current(&self) -> Result<Option<Instant>, DecoderError> {
        if self.invalid.load(Ordering::Acquire) {
            return Err(DecoderError::InvalidInput);
        }
        self.tick
            .lock()
            .map(|tick| *tick)
            .map_err(|_| DecoderError::Io)
    }
}
#[derive(Clone, Copy)]
struct ClockOrigin {
    pts: RationalTime,
    presentation: Instant,
}
struct ClockState {
    video: Option<RationalTime>,
    audio: Option<RationalTime>,
    origin: Option<ClockOrigin>,
    first_ready: Option<Instant>,
    first_presentation: Option<Instant>,
}
struct SourceClock {
    fault: AtomicBool,
    state: Mutex<ClockState>,
    has_audio: bool,
    presentation: Option<Arc<PresentationClock>>,
}
impl SourceClock {
    #[cfg(test)]
    fn new(has_audio: bool) -> Self {
        Self::with_presentation(has_audio, None)
    }
    fn with_presentation(has_audio: bool, presentation: Option<Arc<PresentationClock>>) -> Self {
        Self {
            fault: AtomicBool::new(false),
            state: Mutex::new(ClockState {
                video: None,
                audio: None,
                origin: None,
                first_ready: None,
                first_presentation: None,
            }),
            has_audio,
            presentation,
        }
    }
    fn presentation_now(&self) -> Result<Option<Instant>, DecoderError> {
        match &self.presentation {
            Some(clock) => clock.current(),
            None => Ok(Some(Instant::now())),
        }
    }
    fn wait_for_presentation(
        &self,
        cancel: &AtomicBool,
        binding: Option<&Binding>,
    ) -> Result<Instant, DecoderError> {
        self.presentation_before(cancel, binding, Instant::now() + Duration::from_secs(5))
    }
    fn presentation_before(
        &self,
        cancel: &AtomicBool,
        binding: Option<&Binding>,
        deadline: Instant,
    ) -> Result<Instant, DecoderError> {
        loop {
            check_clock_live(cancel, binding)?;
            if let Some(tick) = self.presentation_now()? {
                return Ok(tick);
            }
            if Instant::now() >= deadline {
                return Err(DecoderError::Stalled);
            }
            thread::sleep(Duration::from_millis(2));
        }
    }
    fn commit(
        &self,
        s: &mut ClockState,
        presentation: Option<Instant>,
    ) -> Result<(), DecoderError> {
        let Some(first) = s.first_ready else {
            return Ok(());
        };
        if s.origin.is_none()
            && ((s.video.is_some() && (!self.has_audio || s.audio.is_some()))
                || first.elapsed() >= Duration::from_millis(500)
                || (self.presentation.is_some()
                    && presentation
                        .zip(s.first_presentation)
                        .is_some_and(|(now, first)| now >= first + Duration::from_millis(500))))
        {
            let v = s.video.or(s.audio).ok_or(DecoderError::InvalidInput)?;
            let a = s.audio.unwrap_or(v);
            let pts = if timed_error(v.checked_sub(a))?.numerator() < 0 {
                v
            } else {
                a
            };
            s.origin = Some(ClockOrigin {
                pts,
                presentation: (if self.presentation.is_some() {
                    s.first_presentation.ok_or(DecoderError::InvalidInput)?
                } else {
                    first
                })
                .checked_add(Duration::from_millis(500))
                .ok_or(DecoderError::InvalidInput)?,
            });
        }
        Ok(())
    }
    fn accept_first(
        origin: ClockOrigin,
        pts: RationalTime,
        now: Instant,
    ) -> Result<(), DecoderError> {
        let delta = timed_error(pts.checked_sub(origin.pts))?;
        if delta.numerator() < 0 {
            return Err(DecoderError::InvalidInput);
        }
        let due = origin
            .presentation
            .checked_add(timed_error(delta.to_duration_floor())?)
            .ok_or(DecoderError::InvalidInput)?;
        if now > due {
            Err(DecoderError::Stalled)
        } else {
            Ok(())
        }
    }
    #[cfg(test)]
    fn ready(&self, kind: StreamKind, pts: RationalTime) -> Result<(), DecoderError> {
        let presentation = self.presentation_now()?.ok_or(DecoderError::Stalled)?;
        self.ready_at(kind, pts, presentation)
    }
    fn ready_at(
        &self,
        kind: StreamKind,
        pts: RationalTime,
        presentation: Instant,
    ) -> Result<(), DecoderError> {
        let mut s = self.state.lock().map_err(|_| DecoderError::Io)?;
        if match kind {
            StreamKind::Video => s.video.is_some(),
            StreamKind::Audio => s.audio.is_some(),
        } {
            return Ok(());
        }
        self.commit(&mut s, Some(presentation))?;
        if let Some(origin) = s.origin {
            Self::accept_first(
                origin,
                pts,
                if self.presentation.is_some() {
                    presentation
                } else {
                    Instant::now()
                },
            )?;
        }
        let real_arrival = Instant::now();
        s.first_ready.get_or_insert(real_arrival);
        s.first_presentation
            .get_or_insert(if self.presentation.is_some() {
                presentation
            } else {
                real_arrival
            });
        match kind {
            StreamKind::Video => s.video = Some(pts),
            StreamKind::Audio => s.audio = Some(pts),
        }
        self.commit(&mut s, Some(presentation))
    }
    #[cfg(test)]
    fn origin(&self) -> Option<ClockOrigin> {
        self.origin_at(None)
    }
    fn origin_at(&self, presentation: Option<Instant>) -> Option<ClockOrigin> {
        let mut s = self.state.lock().ok()?;
        self.commit(&mut s, presentation).ok()?;
        s.origin
    }
    fn due_at(
        &self,
        pts: RationalTime,
        presentation: Instant,
    ) -> Result<Option<Instant>, DecoderError> {
        let Some(origin) = self.origin_at(Some(presentation)) else {
            return Ok(None);
        };
        let delta = timed_error(pts.checked_sub(origin.pts))?;
        if delta.numerator() < 0 {
            return Err(DecoderError::InvalidInput);
        }
        Ok(Some(
            origin
                .presentation
                .checked_add(timed_error(delta.to_duration_floor())?)
                .ok_or(DecoderError::InvalidInput)?,
        ))
    }
    fn permitted_at(
        &self,
        pts: RationalTime,
        lead: Duration,
        presentation: Instant,
    ) -> Result<bool, DecoderError> {
        Ok(self
            .due_at(pts, presentation)?
            .is_some_and(|due| presentation >= due.checked_sub(lead).unwrap_or(due)))
    }
    fn wait(
        &self,
        pts: RationalTime,
        lead: Duration,
        cancelled: &AtomicBool,
        binding: Option<&Binding>,
        began: Instant,
    ) -> Result<(), DecoderError> {
        self.wait_before(
            pts,
            lead,
            cancelled,
            binding,
            began,
            Instant::now() + Duration::from_secs(5),
        )
    }
    fn wait_before(
        &self,
        pts: RationalTime,
        lead: Duration,
        cancelled: &AtomicBool,
        binding: Option<&Binding>,
        began: Instant,
        real_deadline: Instant,
    ) -> Result<(), DecoderError> {
        loop {
            check_clock_live(cancelled, binding)?;
            if self.fault.load(Ordering::Acquire) {
                return Err(DecoderError::InvalidInput);
            }
            if let Some(presentation) = self.presentation_now()? {
                if self.permitted_at(pts, lead, presentation)? {
                    return Ok(());
                }
                if let Some(due) = self.due_at(pts, presentation)? {
                    let due = due.checked_sub(lead).unwrap_or(due);
                    if due.saturating_duration_since(presentation) > Duration::from_secs(5) {
                        return Err(DecoderError::Stalled);
                    }
                }
            }
            if Instant::now() >= real_deadline
                || (self.origin_at(None).is_none() && began.elapsed() >= Duration::from_secs(5))
            {
                return Err(DecoderError::Stalled);
            }
            thread::sleep(Duration::from_millis(2));
        }
    }
}
fn check_clock_live(cancelled: &AtomicBool, binding: Option<&Binding>) -> Result<(), DecoderError> {
    if cancelled.load(Ordering::Acquire) {
        return Err(DecoderError::Cancelled);
    }
    if let Some(b) = binding {
        b.check(&b.context)?;
    }
    Ok(())
}
struct PendingFirst {
    pts: RationalTime,
    bytes: Vec<u8>,
}
// Read-only qualification seam. No production/wire API or authority is exposed.
#[cfg(test)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct TimedAudioObservation {
    pub generation: u64,
    pub has_audio: bool,
    pub fault: bool,
    pub committed_frames: i128,
    pub buffered_samples: usize,
    pub pending_end_frames: Option<i128>,
    pub target_frames: Option<i128>,
    pub origin_presentation: Option<Instant>,
    pub first_audio_due: Option<Instant>,
}
struct TimedAudio {
    clock: Arc<SourceClock>,
    first: Option<RationalTime>,
    front: i128,
    next: i128,
    ended: Option<i128>,
    // Validated real-payload frontier; the producer terminal cause remains unknown.
    // This never proves process retirement or releases source/decoder custody.
    pending_end: Option<i128>,
    last_take_end: Option<i128>,
    unresolved_rendered_until: Option<Instant>,
    pending_first: Option<PendingFirst>,
}
impl AudioQueue {
    #[cfg(test)]
    pub(crate) fn timed_observation_for_test(
        &self,
        generation: u64,
        tick: Instant,
    ) -> Result<Option<TimedAudioObservation>, DecoderError> {
        let state = self.state.lock().map_err(|_| DecoderError::Io)?;
        if state.generation != generation {
            return Err(DecoderError::StaleGeneration);
        }
        let Some(timed) = &state.timed else {
            return Ok(None);
        };
        // Read the already-committed origin directly. Calling origin_at/due_at
        // here would advance clock initialization from an observer.
        let origin = timed
            .clock
            .state
            .lock()
            .map_err(|_| DecoderError::Io)?
            .origin;
        let (target_frames, first_audio_due) = match (origin, timed.first) {
            (Some(origin), Some(first)) => {
                let now_pts = timed_error(
                    origin
                        .pts
                        .checked_add(elapsed_time(tick, origin.presentation)?),
                )?;
                let target = rational_samples(timed_error(now_pts.checked_sub(first))?)?;
                let offset = timed_error(first.checked_sub(origin.pts))?;
                if offset.numerator() < 0 {
                    return Err(DecoderError::InvalidInput);
                }
                let due = origin
                    .presentation
                    .checked_add(timed_error(offset.to_duration_floor())?)
                    .ok_or(DecoderError::InvalidInput)?;
                (Some(target), Some(due))
            }
            _ => (None, None),
        };
        Ok(Some(TimedAudioObservation {
            generation: state.generation,
            has_audio: state.has_audio,
            fault: timed.clock.fault.load(Ordering::Acquire),
            committed_frames: timed.next,
            buffered_samples: state.samples.len(),
            pending_end_frames: timed.pending_end,
            target_frames,
            origin_presentation: origin.map(|origin| origin.presentation),
            first_audio_due,
        }))
    }
    fn timed(&self, generation: u64, clock: Arc<SourceClock>) -> Result<(), DecoderError> {
        let mut s = self.state.lock().map_err(|_| DecoderError::Io)?;
        if s.generation != generation {
            return Err(DecoderError::StaleGeneration);
        }
        s.samples.clear();
        s.timed = Some(TimedAudio {
            clock,
            first: None,
            front: 0,
            next: 0,
            ended: None,
            pending_end: None,
            last_take_end: None,
            unresolved_rendered_until: None,
            pending_first: None,
        });
        Ok(())
    }
    fn first_boundary(s: &mut AudioState, presentation: Instant) -> Result<(), DecoderError> {
        let t = s.timed.as_mut().ok_or(DecoderError::InvalidInput)?;
        if let (Some(first), Some(until)) = (t.first, t.unresolved_rendered_until) {
            if let Some(due) = t.clock.due_at(first, presentation)? {
                if due < until {
                    t.clock.fault.store(true, Ordering::Release);
                    t.pending_first = None;
                    t.pending_end = None;
                    s.has_audio = false;
                    s.samples.clear();
                    return Err(DecoderError::InvalidInput);
                }
                t.unresolved_rendered_until = None;
            }
        }
        Ok(())
    }
    fn register_first_locked(
        s: &mut AudioState,
        generation: u64,
        pts: RationalTime,
        presentation: Instant,
    ) -> Result<(), DecoderError> {
        if s.generation != generation {
            return Err(DecoderError::StaleGeneration);
        }
        if !s.has_audio {
            return Err(DecoderError::PublicationDenied);
        }
        let t = s.timed.as_mut().ok_or(DecoderError::InvalidInput)?;
        if let Some(first) = t.first {
            if first != pts {
                return Err(DecoderError::InvalidInput);
            }
        } else {
            t.clock.ready_at(StreamKind::Audio, pts, presentation)?;
            t.first = Some(pts);
        }
        Self::first_boundary(s, presentation)
    }
    #[cfg(test)]
    fn observe_first_audio(&self, generation: u64, pts: RationalTime) -> Result<(), DecoderError> {
        let clock = {
            self.state
                .lock()
                .map_err(|_| DecoderError::Io)?
                .timed
                .as_ref()
                .ok_or(DecoderError::InvalidInput)?
                .clock
                .clone()
        };
        let presentation = clock.presentation_now()?.ok_or(DecoderError::Stalled)?;
        let mut s = self.state.lock().map_err(|_| DecoderError::Io)?;
        Self::register_first_locked(&mut s, generation, pts, presentation)
    }
    #[cfg(test)]
    fn begin_audio(
        &self,
        generation: u64,
        pts: RationalTime,
        bytes: &[u8],
        presentation: Instant,
    ) -> Result<bool, DecoderError> {
        self.begin_audio_owned(generation, pts, bytes.to_vec(), presentation)
    }
    // Ownership of the existing first <=20 ms buffer moves here. Until it is
    // promoted neither the reader nor this queue retains a second future chunk.
    fn begin_audio_owned(
        &self,
        generation: u64,
        pts: RationalTime,
        bytes: Vec<u8>,
        presentation: Instant,
    ) -> Result<bool, DecoderError> {
        if bytes.is_empty() || bytes.len() > AUDIO_BLOCK * 2 || bytes.len() % 4 != 0 {
            return Err(DecoderError::InvalidInput);
        }
        let mut s = self.state.lock().map_err(|_| DecoderError::Io)?;
        Self::register_first_locked(&mut s, generation, pts, presentation)?;
        let t = s.timed.as_mut().unwrap();
        if t.pending_first.is_some() || t.next != 0 {
            return Err(DecoderError::InvalidInput);
        }
        t.pending_first = Some(PendingFirst { pts, bytes });
        Self::promote_first_locked(&mut s, generation, presentation)
    }
    fn promote_first_locked(
        s: &mut AudioState,
        generation: u64,
        presentation: Instant,
    ) -> Result<bool, DecoderError> {
        if s.generation != generation {
            return Err(DecoderError::StaleGeneration);
        }
        if !s.has_audio {
            return Err(DecoderError::PublicationDenied);
        }
        Self::first_boundary(s, presentation)?;
        let t = s.timed.as_ref().ok_or(DecoderError::InvalidInput)?;
        let Some(pending) = t.pending_first.as_ref() else {
            return Ok(true);
        };
        let end = timed_error(pending.pts.checked_add(timed_error(RationalTime::new(
            (pending.bytes.len() / 4) as i128,
            48000,
        ))?))?;
        if !t
            .clock
            .permitted_at(end, Duration::from_millis(140), presentation)?
        {
            return Ok(false);
        }
        let pending = s.timed.as_mut().unwrap().pending_first.take().unwrap();
        Self::push_locked(s, generation, pending.pts, &pending.bytes)?;
        Ok(true)
    }
    fn promote_first(&self, generation: u64, presentation: Instant) -> Result<bool, DecoderError> {
        let mut s = self.state.lock().map_err(|_| DecoderError::Io)?;
        Self::promote_first_locked(&mut s, generation, presentation)
    }
    fn push_at(
        &self,
        generation: u64,
        pts: RationalTime,
        bytes: &[u8],
    ) -> Result<(), DecoderError> {
        if bytes.len() > AUDIO_BLOCK * 2 || bytes.len() % 4 != 0 {
            return Err(DecoderError::InvalidInput);
        }
        let mut s = self.state.lock().map_err(|_| DecoderError::Io)?;
        Self::push_locked(&mut s, generation, pts, bytes)
    }
    fn push_locked(
        s: &mut AudioState,
        generation: u64,
        pts: RationalTime,
        bytes: &[u8],
    ) -> Result<(), DecoderError> {
        if bytes.len() > AUDIO_BLOCK * 2 || bytes.len() % 4 != 0 {
            return Err(DecoderError::InvalidInput);
        }
        if s.generation != generation {
            return Err(DecoderError::StaleGeneration);
        }
        if !s.has_audio {
            return Err(DecoderError::PublicationDenied);
        }
        let t = s.timed.as_mut().ok_or(DecoderError::InvalidInput)?;
        let first = t.first.ok_or(DecoderError::InvalidInput)?;
        let delta = timed_error(pts.checked_sub(first))?;
        let offset = rational_samples(delta)?;
        // Exact alignment, not floor/retimestamping of malformed PCM.
        if timed_error(RationalTime::new(offset, 48_000))? != delta
            || offset != t.next
            || t.ended.is_some()
            || t.pending_end.is_some()
        {
            return Err(DecoderError::InvalidInput);
        }
        let count = bytes.len() / 2;
        let room = AUDIO_LIMIT - s.samples.len();
        if count > room && s.stats.selected {
            return Err(DecoderError::Backpressure);
        }
        let dropped = count.saturating_sub(room);
        for _ in 0..dropped {
            s.samples.pop_front();
        }
        let t = s.timed.as_mut().unwrap();
        t.front += (dropped / 2) as i128;
        t.next += (count / 2) as i128;
        s.stats.dropped_old_samples = s.stats.dropped_old_samples.saturating_add(dropped as u64);
        s.stats.pushed_samples = s.stats.pushed_samples.saturating_add(count as u64);
        s.samples.extend(
            bytes
                .chunks_exact(2)
                .map(|x| i16::from_le_bytes([x[0], x[1]])),
        );
        Ok(())
    }
    // Call only after END N matches all N validated mux records, raw bytes and
    // successful queue commits, through the active source publication barrier.
    fn publish_pending_end(
        &self,
        generation: u64,
        final_pts: RationalTime,
    ) -> Result<(), DecoderError> {
        let mut s = self.state.lock().map_err(|_| DecoderError::Io)?;
        if s.generation != generation {
            return Err(DecoderError::StaleGeneration);
        }
        if !s.has_audio {
            return Err(DecoderError::PublicationDenied);
        }
        let t = s.timed.as_mut().ok_or(DecoderError::InvalidInput)?;
        let delta = timed_error(final_pts.checked_sub(t.first.ok_or(DecoderError::InvalidInput)?))?;
        let frontier = rational_samples(delta)?;
        if t.clock.fault.load(Ordering::Acquire)
            || t.pending_first.is_some()
            || t.unresolved_rendered_until.is_some()
            || t.ended.is_some()
            || t.pending_end.is_some()
            || frontier <= 0
            || frontier != t.next
            || timed_error(RationalTime::new(frontier, 48_000))? != delta
        {
            return Err(DecoderError::InvalidInput);
        }
        t.pending_end = Some(frontier);
        Ok(())
    }
    #[cfg(test)]
    fn end_at(&self, generation: u64) {
        if let Ok(mut s) = self.state.lock() {
            if s.generation == generation {
                if let Some(t) = &mut s.timed {
                    t.ended = Some(t.next);
                }
            }
        }
    }
    /// The caller supplies the fixed output-mixer deadline, never callback-now.
    /// Stream timestamps preserve known leading/trailing silence. File queues
    /// retain their original sample-count API and behavior.
    pub fn take_at(&self, generation: u64, tick: Instant) -> Vec<i16> {
        let mut out = vec![0; AUDIO_BLOCK];
        let Ok(mut s) = self.state.lock() else {
            return out;
        };
        if s.generation != generation || !s.has_audio {
            return out;
        }
        if s.timed.is_none() {
            drop(s);
            return self.take(generation, AUDIO_BLOCK);
        }
        let clock = s.timed.as_ref().unwrap().clock.clone();
        if Self::promote_first_locked(&mut s, generation, tick).is_err() {
            clock.fault.store(true, Ordering::Release);
            s.has_audio = false;
            s.samples.clear();
            if let Some(t) = &mut s.timed {
                t.pending_first = None;
                t.pending_end = None;
            }
            return out;
        }
        let t = s.timed.as_ref().unwrap();
        let first = t.first;
        let origin = t.clock.origin_at(Some(tick));
        let (Some(first), Some(origin)) = (first, origin) else {
            if let Some(end) = tick.checked_add(Duration::from_millis(20)) {
                let t = s.timed.as_mut().unwrap();
                t.unresolved_rendered_until = Some(
                    t.unresolved_rendered_until
                        .map_or(end, |previous| previous.max(end)),
                );
            } else {
                clock.fault.store(true, Ordering::Release);
                s.has_audio = false;
            }
            s.stats.unresolved_timing_samples = s
                .stats
                .unresolved_timing_samples
                .saturating_add(AUDIO_BLOCK as u64);
            return out;
        };
        if Self::first_boundary(&mut s, tick).is_err() {
            return out;
        }
        let target = (|| {
            let wall = elapsed_time(tick, origin.presentation)?;
            let pts = timed_error(origin.pts.checked_add(wall))?;
            rational_samples(timed_error(pts.checked_sub(first))?)
        })();
        let Ok(target) = target else {
            clock.fault.store(true, Ordering::Release);
            s.has_audio = false;
            s.samples.clear();
            if let Some(t) = &mut s.timed {
                t.pending_first = None;
                t.pending_end = None;
            }
            return out;
        };
        // Inactive sources need timestamp selection, not playback of stale PCM.
        // Once selected, fixed 20 ms deadlines must remain exactly contiguous.
        let continuous_selection = s.timed.as_ref().unwrap().last_take_end.is_some();
        if let Some(last) = s.timed.as_ref().unwrap().last_take_end {
            if target != last {
                s.stats.selected_underflow_samples = s
                    .stats
                    .selected_underflow_samples
                    .saturating_add(AUDIO_BLOCK as u64);
                clock.fault.store(true, Ordering::Release);
                s.has_audio = false;
                s.samples.clear();
                if let Some(t) = &mut s.timed {
                    t.pending_first = None;
                    t.pending_end = None;
                }
                return out;
            }
        }
        s.timed.as_mut().unwrap().last_take_end = Some(target + 960);
        if continuous_selection
            && s.timed.as_ref().unwrap().front < target
            && !s
                .timed
                .as_ref()
                .unwrap()
                .ended
                .or(s.timed.as_ref().unwrap().pending_end)
                .is_some_and(|end| target >= end)
        {
            clock.fault.store(true, Ordering::Release);
            s.has_audio = false;
            s.samples.clear();
            if let Some(t) = &mut s.timed {
                t.pending_first = None;
                t.pending_end = None;
            }
            return out;
        }
        let mut retired_inactive = 0u64;
        while s.timed.as_ref().unwrap().front < target && !s.samples.is_empty() {
            s.samples.pop_front();
            s.samples.pop_front();
            s.timed.as_mut().unwrap().front += 1;
            retired_inactive += 2;
        }
        s.stats.dropped_old_samples = s.stats.dropped_old_samples.saturating_add(retired_inactive);
        let mut missing = 0u64;
        for frame in 0..960 {
            let wanted = target + frame as i128;
            let t = s.timed.as_ref().unwrap();
            if wanted < 0 || t.ended.or(t.pending_end).is_some_and(|end| wanted >= end) {
                continue;
            }
            if wanted == t.front && s.samples.len() >= 2 {
                out[frame * 2] = s.samples.pop_front().unwrap();
                out[frame * 2 + 1] = s.samples.pop_front().unwrap();
                s.timed.as_mut().unwrap().front += 1;
            } else {
                missing += 2;
            }
        }
        s.stats.underflow_missing_samples =
            s.stats.underflow_missing_samples.saturating_add(missing);
        if s.stats.selected {
            s.stats.selected_underflow_samples =
                s.stats.selected_underflow_samples.saturating_add(missing);
        }
        if missing > 0 {
            // Do not repair an already-rendered hole by trimming late PCM.
            clock.fault.store(true, Ordering::Release);
            s.has_audio = false;
            s.samples.clear();
            if let Some(t) = &mut s.timed {
                t.pending_first = None;
                t.pending_end = None;
            }
        }
        out
    }
}

#[cfg(unix)]
mod timed_io {
    use super::*;
    use std::{
        ffi::CString,
        fs::{self, OpenOptions},
        os::{
            fd::{AsRawFd, BorrowedFd},
            unix::{
                ffi::OsStrExt,
                fs::{DirBuilderExt, OpenOptionsExt},
            },
        },
        sync::atomic::AtomicU64,
    };
    #[cfg(target_os = "macos")]
    const NONBLOCK: i32 = 4;
    #[cfg(not(target_os = "macos"))]
    const NONBLOCK: i32 = 2048;
    unsafe extern "C" {
        fn mkfifo(path: *const std::ffi::c_char, mode: u32) -> i32;
        fn fcntl(fd: i32, cmd: i32, ...) -> i32;
    }
    pub(super) fn nonblocking(fd: BorrowedFd<'_>) -> Result<(), DecoderError> {
        let flags = unsafe { fcntl(fd.as_raw_fd(), 3) };
        if flags < 0 || unsafe { fcntl(fd.as_raw_fd(), 4, flags | NONBLOCK) } < 0 {
            return Err(DecoderError::Io);
        }
        Ok(())
    }
    pub(super) struct MetadataPipes {
        pub video: File,
        pub audio: Option<File>,
        pub video_path: PathBuf,
        pub audio_path: PathBuf,
        pub video_witness: File,
        pub audio_witness: Option<File>,
        pub video_witness_path: PathBuf,
        pub audio_witness_path: PathBuf,
        pub witness_key: String,
        root: PathBuf,
    }
    impl MetadataPipes {
        #[cfg(test)]
        pub(super) fn root_for_test(&self) -> PathBuf {
            self.root.clone()
        }
        pub fn new(audio: bool) -> Result<Self, DecoderError> {
            static NEXT: AtomicU64 = AtomicU64::new(0);
            let sequence = NEXT
                .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |n| n.checked_add(1))
                .map_err(|_| DecoderError::Io)?;
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|_| DecoderError::Io)?
                .as_nanos();
            let root = std::env::temp_dir().join(format!(
                "ottplay-decode-{}-{nonce}-{}",
                std::process::id(),
                sequence
            ));
            fs::DirBuilder::new()
                .mode(0o700)
                .create(&root)
                .map_err(|_| DecoderError::Io)?;
            let result = (|| {
                let video_path = root.join("video.fifo");
                let audio_path = root.join("audio.fifo");
                let video_witness_path = root.join("video-witness.fifo");
                let audio_witness_path = root.join("audio-witness.fifo");
                let open = |path: &Path| -> Result<File, DecoderError> {
                    let c = CString::new(path.as_os_str().as_bytes())
                        .map_err(|_| DecoderError::InvalidInput)?;
                    if unsafe { mkfifo(c.as_ptr(), 0o600) } != 0 {
                        return Err(DecoderError::Io);
                    }
                    OpenOptions::new()
                        .read(true)
                        .write(true)
                        .custom_flags(NONBLOCK)
                        .open(path)
                        .map_err(|_| DecoderError::Io)
                };
                let video = open(&video_path)?;
                let audio = if audio {
                    Some(open(&audio_path)?)
                } else {
                    None
                };
                // Open witnesses read-only before spawning. Pre-writer read(0)
                // is not a terminal signal; only the parsed host marker is.
                let witness = |path: &Path| -> Result<File, DecoderError> {
                    let c = CString::new(path.as_os_str().as_bytes())
                        .map_err(|_| DecoderError::InvalidInput)?;
                    if unsafe { mkfifo(c.as_ptr(), 0o600) } != 0 {
                        return Err(DecoderError::Io);
                    }
                    OpenOptions::new()
                        .read(true)
                        .custom_flags(NONBLOCK)
                        .open(path)
                        .map_err(|_| DecoderError::Io)
                };
                let video_witness = witness(&video_witness_path)?;
                let audio_witness = if audio.is_some() {
                    Some(witness(&audio_witness_path)?)
                } else {
                    None
                };
                Ok(Self {
                    video,
                    audio,
                    video_witness,
                    audio_witness,
                    video_witness_path,
                    audio_witness_path,
                    // Distinct per owned generation within this process; not a
                    // secret/authentication token. Private FDs and source/queue
                    // generation checks remain the authority.
                    witness_key: format!(
                        "ottplay_witness_{:016x}{sequence:016x}",
                        std::process::id()
                    ),
                    video_path,
                    audio_path,
                    root: root.clone(),
                })
            })();
            if result.is_err() {
                let _ = fs::remove_dir_all(&root);
            }
            result
        }
    }
    impl Drop for MetadataPipes {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }
    // FFmpeg first parses the filtergraph, then the metadata AVOption value.
    // Escape both layers. A single quoted path loses its quotes before ':' is
    // processed by the second parser. Never use lossy filesystem conversion.
    pub(super) fn filter_file(path: &Path) -> Result<String, DecoderError> {
        let value = path.to_str().ok_or(DecoderError::InvalidInput)?;
        if value.is_empty() || value.chars().any(|c| c.is_control()) {
            return Err(DecoderError::InvalidInput);
        }
        fn escape(value: &str, delimiters: &str) -> String {
            let mut out = String::with_capacity(value.len());
            for c in value.chars() {
                if c == '\\' || c == '\'' || c.is_ascii_whitespace() || delimiters.contains(c) {
                    out.push('\\');
                }
                out.push(c);
            }
            out
        }
        Ok(escape(&escape(value, ":"), "[],;"))
    }

    pub(super) fn witness_graphs(
        config: &DecoderConfig,
        content: FrameContentRect,
        pipes: &MetadataPipes,
        has_audio: bool,
    ) -> Result<(String, Option<String>), DecoderError> {
        let key = &pipes.witness_key;
        let video_path = filter_file(&pipes.video_witness_path)?;
        // Two independent single-kind graphs. The payload branches never pass
        // through concat/metadata; only private witness branches carry sentinels.
        let video = format!(
            "[0:v:0]{},format=pix_fmts=rgb24,split=2[vout][vr];\
             [vr]metadata=mode=delete,metadata=mode=add:key={key}:value=V_REAL[vreal];\
             color=c=black:size={}x{}:rate={},trim=end_frame=1,setsar=1,format=pix_fmts=rgb24,\
             metadata=mode=delete,metadata=mode=add:key={key}:value=V_END[vend];\
             [vreal][vend]concat=n=2:v=1:a=0,metadata=mode=print:key={key}:file={video_path}:direct=1,nullsink",
            content_filter(config.frame_spec, content, config.fps),
            config.frame_spec.width, config.frame_spec.height, config.fps,
        );
        let audio = if has_audio {
            let audio_path = filter_file(&pipes.audio_witness_path)?;
            Some(format!(
                "[0:a:0]aformat=sample_fmts=s16:sample_rates=48000:channel_layouts=stereo,asplit=2[aout][ar];\
                 [ar]ametadata=mode=delete,ametadata=mode=add:key={key}:value=A_REAL[areal];\
                 anullsrc=channel_layout=stereo:sample_rate=48000:nb_samples=1,atrim=end_sample=1,\
                 aformat=sample_fmts=s16:sample_rates=48000:channel_layouts=stereo,\
                 ametadata=mode=delete,ametadata=mode=add:key={key}:value=A_END[aend];\
                 [areal][aend]concat=n=2:v=0:a=1,ametadata=mode=print:key={key}:file={audio_path}:direct=1,anullsink"
            ))
        } else {
            None
        };
        Ok((video, audio))
    }

    #[derive(Clone, Copy, Default)]
    pub(super) struct WitnessState {
        pub end: Option<u64>,
        pub drained: bool,
        pub error: bool,
    }
    pub(super) type Witness = Arc<Mutex<WitnessState>>;
    pub(super) fn witness_snapshot(witness: &Witness) -> Result<WitnessState, DecoderError> {
        let state = *witness.lock().map_err(|_| DecoderError::Io)?;
        if state.error {
            Err(DecoderError::InvalidInput)
        } else {
            Ok(state)
        }
    }
    pub(super) struct WitnessParser {
        key: String,
        kind: char,
        line: Vec<u8>,
        header: Option<u64>,
        real: u64,
        end: Option<u64>,
    }
    impl WitnessParser {
        pub fn new(key: String, kind: StreamKind) -> Result<Self, DecoderError> {
            let suffix = key
                .strip_prefix("ottplay_witness_")
                .ok_or(DecoderError::InvalidInput)?;
            if suffix.len() != 32
                || !suffix
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            {
                return Err(DecoderError::InvalidInput);
            }
            Ok(Self {
                key,
                kind: match kind {
                    StreamKind::Video => 'V',
                    StreamKind::Audio => 'A',
                },
                line: Vec::with_capacity(256),
                header: None,
                real: 0,
                end: None,
            })
        }
        pub fn feed(&mut self, bytes: &[u8]) -> Result<(), DecoderError> {
            for &byte in bytes {
                // Even a partial post-END line is forbidden, not only a second END.
                if self.end.is_some() || (byte != b'\n' && !(0x20..=0x7e).contains(&byte)) {
                    return Err(DecoderError::InvalidInput);
                }
                if byte != b'\n' {
                    if self.line.len() == 256 {
                        return Err(DecoderError::InvalidInput);
                    }
                    self.line.push(byte);
                    continue;
                }
                let line =
                    std::str::from_utf8(&self.line).map_err(|_| DecoderError::InvalidInput)?;
                if let Some(ordinal) = self.header.take() {
                    if ordinal != self.real {
                        return Err(DecoderError::InvalidInput);
                    }
                    if line == format!("{}={}_REAL", self.key, self.kind) {
                        self.real = self.real.checked_add(1).ok_or(DecoderError::InvalidInput)?;
                    } else if line == format!("{}={}_END", self.key, self.kind) && self.real > 0 {
                        self.end = Some(self.real);
                    } else {
                        return Err(DecoderError::InvalidInput);
                    }
                } else {
                    let fields: Vec<_> = line.split_ascii_whitespace().collect();
                    if fields.len() != 3 {
                        return Err(DecoderError::InvalidInput);
                    }
                    let ordinal_text = fields[0]
                        .strip_prefix("frame:")
                        .ok_or(DecoderError::InvalidInput)?;
                    // FromStr accepts a leading '+', but the producer protocol
                    // is digits-only for ordinals (signed PTS is separate).
                    if ordinal_text.is_empty() || !ordinal_text.bytes().all(|b| b.is_ascii_digit())
                    {
                        return Err(DecoderError::InvalidInput);
                    }
                    let ordinal = ordinal_text
                        .parse::<u64>()
                        .map_err(|_| DecoderError::InvalidInput)?;
                    let pts = fields[1]
                        .strip_prefix("pts:")
                        .ok_or(DecoderError::InvalidInput)?;
                    if pts != "NOPTS" && pts.parse::<i64>().is_err() {
                        return Err(DecoderError::InvalidInput);
                    }
                    let time = fields[2]
                        .strip_prefix("pts_time:")
                        .ok_or(DecoderError::InvalidInput)?;
                    if time.len() > 64
                        || (time != "NOPTS" && !time.parse::<f64>().is_ok_and(f64::is_finite))
                    {
                        return Err(DecoderError::InvalidInput);
                    }
                    if ordinal != self.real {
                        return Err(DecoderError::InvalidInput);
                    }
                    self.header = Some(ordinal);
                }
                self.line.clear();
            }
            Ok(())
        }
        pub fn finish(&self) -> Result<(), DecoderError> {
            if self.end.is_none() || self.header.is_some() || !self.line.is_empty() {
                Err(DecoderError::InvalidInput)
            } else {
                Ok(())
            }
        }
    }
    pub(super) struct WitnessReader {
        file: File,
        parser: WitnessParser,
        pub state: Witness,
    }
    impl WitnessReader {
        pub fn new(file: File, key: String, kind: StreamKind) -> Result<Self, DecoderError> {
            Ok(Self {
                file,
                parser: WitnessParser::new(key, kind)?,
                state: Arc::new(Mutex::new(WitnessState::default())),
            })
        }
        // Exactly one bounded read per selected kind/sweep, with no lock over IO.
        fn poll(&mut self, done: bool) -> Result<bool, DecoderError> {
            let mut bytes = [0; 256];
            let result = self.file.read(&mut bytes);
            self.consume_read(result, &bytes, done)
        }
        pub(super) fn consume_read(
            &mut self,
            result: std::io::Result<usize>,
            bytes: &[u8],
            done: bool,
        ) -> Result<bool, DecoderError> {
            let count = match result {
                Ok(n) if n <= bytes.len() => n,
                Err(e) if e.kind() == std::io::ErrorKind::Interrupted => return Ok(false),
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => 0,
                _ => return Err(DecoderError::Io),
            };
            self.parser.feed(&bytes[..count])?;
            let drained = done && count == 0;
            if drained {
                self.parser.finish()?;
            }
            let mut state = self.state.lock().map_err(|_| DecoderError::Io)?;
            state.end = self.parser.end;
            state.drained = drained;
            Ok(drained)
        }
    }
    pub(super) fn drain_witnesses(
        readers: &mut [WitnessReader],
        done: &AtomicBool,
        cancel: &AtomicBool,
        binding: Option<&Binding>,
    ) -> Result<(), DecoderError> {
        if readers.is_empty() || readers.len() > 2 {
            return Err(DecoderError::InvalidInput);
        }
        let result = (|| loop {
            check_clock_live(cancel, binding)?;
            let mut all = true;
            for reader in readers.iter_mut() {
                all &= reader.poll(done.load(Ordering::Acquire))?;
            }
            if all {
                return Ok(());
            }
            thread::sleep(Duration::from_millis(2));
        })();
        if result.is_err() {
            for reader in readers {
                if let Ok(mut state) = reader.state.lock() {
                    state.error = true;
                }
            }
        }
        result
    }
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub(super) struct PendingWatermark {
        packets: u64,
        bytes: u64,
    }
    impl PendingWatermark {
        pub fn validate(
            self,
            committed_packets: u64,
            committed_bytes: u64,
        ) -> Result<(), DecoderError> {
            if self.packets == 0
                || self.packets != committed_packets
                || self.bytes != committed_bytes
            {
                Err(DecoderError::InvalidInput)
            } else {
                Ok(())
            }
        }
    }
    pub(super) enum StatsEvent {
        Packet(PacketStats),
        Pending(PendingWatermark),
    }
    pub(super) struct StatsReader {
        file: File,
        bytes: Vec<u8>,
        parser: StatsParser,
        kind: StreamKind,
        packets: u64,
        raw_bytes: u64,
    }
    impl StatsReader {
        pub fn new(file: File, frame_bytes: usize, kind: StreamKind) -> Result<Self, DecoderError> {
            Ok(Self {
                file,
                bytes: Vec::with_capacity(256),
                parser: timed_error(StatsParser::new(frame_bytes as u32))?,
                kind,
                packets: 0,
                raw_bytes: 0,
            })
        }
        #[cfg(test)]
        pub fn next(
            &mut self,
            done: &AtomicBool,
            cancel: &AtomicBool,
            binding: Option<&Binding>,
        ) -> Result<Option<PacketStats>, DecoderError> {
            match self.next_inner(done, cancel, binding, None)? {
                Some(StatsEvent::Packet(packet)) => Ok(Some(packet)),
                None => Ok(None),
                _ => Err(DecoderError::InvalidInput),
            }
        }
        pub fn next_pending(
            &mut self,
            done: &AtomicBool,
            cancel: &AtomicBool,
            binding: Option<&Binding>,
            witness: &Witness,
        ) -> Result<StatsEvent, DecoderError> {
            self.next_inner(done, cancel, binding, Some(witness))?
                .ok_or(DecoderError::InvalidInput)
        }
        fn next_inner(
            &mut self,
            done: &AtomicBool,
            cancel: &AtomicBool,
            binding: Option<&Binding>,
            witness: Option<&Witness>,
        ) -> Result<Option<StatsEvent>, DecoderError> {
            let began = Instant::now();
            loop {
                check_clock_live(cancel, binding)?;
                if let Some(at) = self.bytes.iter().position(|b| *b == b'\n') {
                    let line: Vec<_> = self.bytes.drain(..=at).collect();
                    let record = timed_error(self.parser.parse_line(&line))?;
                    if record.kind != self.kind
                        || record.audio_gap_before_frames.is_some_and(|gap| gap > 0)
                    {
                        return Err(DecoderError::InvalidInput);
                    }
                    self.packets = self
                        .packets
                        .checked_add(1)
                        .ok_or(DecoderError::InvalidInput)?;
                    self.raw_bytes = self
                        .raw_bytes
                        .checked_add(record.byte_size as u64)
                        .ok_or(DecoderError::InvalidInput)?;
                    if let Some(witness) = witness {
                        if witness_snapshot(witness)?
                            .end
                            .is_some_and(|end| self.packets > end)
                        {
                            return Err(DecoderError::InvalidInput);
                        }
                    }
                    return Ok(Some(StatsEvent::Packet(record)));
                }
                if self.bytes.len() > 256 {
                    return Err(DecoderError::InvalidInput);
                }
                let mut byte = [0u8; 1];
                match self.file.read(&mut byte) {
                    Ok(1) => {
                        self.bytes.push(byte[0]);
                        continue;
                    }
                    Ok(0) => {}
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                    Err(_) => return Err(DecoderError::Io),
                    _ => return Err(DecoderError::Io),
                }
                if let Some(witness) = witness {
                    let state = witness_snapshot(witness)?;
                    if let Some(end) = state.end {
                        if self.packets > end || (self.packets == end && !self.bytes.is_empty()) {
                            return Err(DecoderError::InvalidInput);
                        }
                        if self.packets == end {
                            return Ok(Some(StatsEvent::Pending(PendingWatermark {
                                packets: end,
                                bytes: self.raw_bytes,
                            })));
                        }
                    }
                }
                // Our own read/write keeper intentionally suppresses FIFO EOF.
                // Child retirement is a distinct signal, after draining bytes.
                if done.load(Ordering::Acquire) && witness.is_none() {
                    return if self.bytes.is_empty() {
                        Ok(None)
                    } else {
                        Err(DecoderError::InvalidInput)
                    };
                }
                if began.elapsed() >= Duration::from_secs(5) {
                    return Err(DecoderError::Stalled);
                }
                thread::sleep(Duration::from_millis(2));
            }
        }
    }
    // Remain an owned reader after terminal publication. No byte, even a partial
    // mux line/raw packet, may appear beyond the proven real frontier. Continue
    // through global monitor completion and witness drain before exiting.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn pending_tail(
        stats: &mut StatsReader,
        raw: &mut impl Read,
        witness: &Witness,
        watermark: PendingWatermark,
        clock: &SourceClock,
        final_pts: RationalTime,
        done: &AtomicBool,
        cancel: &AtomicBool,
        binding: Option<&Binding>,
        mut interval_complete: impl FnMut() -> Result<(), DecoderError>,
    ) -> Result<(), DecoderError> {
        let interval_deadline = Instant::now() + Duration::from_secs(5);
        let mut presented = false;
        loop {
            check_clock_live(cancel, binding)?;
            if clock.fault.load(Ordering::Acquire) {
                return Err(DecoderError::InvalidInput);
            }
            let state = witness_snapshot(witness)?;
            if state.end != Some(watermark.packets) || !stats.bytes.is_empty() {
                return Err(DecoderError::InvalidInput);
            }
            let mut byte = [0u8; 1];
            match stats.file.read(&mut byte) {
                Ok(0) => {}
                Err(e)
                    if e.kind() == std::io::ErrorKind::WouldBlock
                        || e.kind() == std::io::ErrorKind::Interrupted => {}
                Ok(_) => return Err(DecoderError::InvalidInput),
                Err(_) => return Err(DecoderError::Io),
            }
            let eof = match raw.read(&mut byte) {
                Ok(0) => true,
                Err(e)
                    if e.kind() == std::io::ErrorKind::WouldBlock
                        || e.kind() == std::io::ErrorKind::Interrupted =>
                {
                    false
                }
                Ok(_) => return Err(DecoderError::InvalidInput),
                Err(_) => return Err(DecoderError::Io),
            };
            if !presented {
                if let Some(now) = clock.presentation_now()? {
                    if clock.permitted_at(final_pts, Duration::ZERO, now)? {
                        interval_complete()?;
                        presented = true;
                    }
                }
                if !presented && Instant::now() >= interval_deadline {
                    return Err(DecoderError::Stalled);
                }
            }
            if presented && done.load(Ordering::Acquire) && state.drained && eof {
                return Ok(());
            }
            thread::sleep(Duration::from_millis(2));
        }
    }
    pub(super) fn raw(
        reader: &mut impl Read,
        bytes: &mut [u8],
        cancel: &AtomicBool,
        binding: Option<&Binding>,
    ) -> Result<(), DecoderError> {
        let mut n = 0;
        let began = Instant::now();
        while n < bytes.len() {
            check_clock_live(cancel, binding)?;
            match reader.read(&mut bytes[n..]) {
                Ok(0) => return Err(DecoderError::InvalidInput),
                Ok(k) => n += k,
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(_) => return Err(DecoderError::Io),
            }
            if n < bytes.len() {
                if began.elapsed() >= Duration::from_secs(5) {
                    return Err(DecoderError::Stalled);
                }
                thread::sleep(Duration::from_millis(2));
            }
        }
        Ok(())
    }
}

struct AudioState {
    generation: u64,
    has_audio: bool,
    // Untimed clean EOF preserves the remaining FIFO and known trailing silence.
    untimed_eof: bool,
    samples: VecDeque<i16>,
    stats: AudioQueueStats,
    timed: Option<TimedAudio>,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct AudioQueueStats {
    pub pushed_samples: u64,
    pub dropped_old_samples: u64,
    pub underflow_missing_samples: u64,
    pub selected_dropped_samples: u64,
    pub selected_underflow_samples: u64,
    pub buffered_samples: usize,
    pub selected: bool,
    /// Samples rendered while an expected track had not yet supplied its first PTS.
    pub unresolved_timing_samples: u64,
}
pub struct AudioQueue {
    state: Mutex<AudioState>,
}
impl AudioQueue {
    pub fn new(generation: u64) -> Self {
        Self {
            state: Mutex::new(AudioState {
                generation,
                has_audio: false,
                untimed_eof: false,
                samples: VecDeque::with_capacity(AUDIO_LIMIT),
                stats: AudioQueueStats::default(),
                timed: None,
            }),
        }
    }

    pub fn reset(&self, expected: u64, next: u64) -> Result<(), DecoderError> {
        let mut state = self.state.lock().map_err(|_| DecoderError::Io)?;
        if state.generation != expected || next <= expected {
            return Err(DecoderError::StaleGeneration);
        }
        state.generation = next;
        state.has_audio = false;
        state.untimed_eof = false;
        state.samples.clear();
        state.stats = AudioQueueStats::default();
        state.timed = None;
        Ok(())
    }

    /// Return a fixed-size block (at most 1920 interleaved stereo samples).
    /// Stale generations, absent tracks and underflow produce silence.
    pub fn take(&self, generation: u64, samples: usize) -> Vec<i16> {
        let mut output = vec![0; samples.min(AUDIO_BLOCK)];
        let Ok(mut state) = self.state.lock() else {
            return output;
        };
        if state.generation == generation && state.has_audio {
            let missing = if state.untimed_eof {
                0
            } else {
                output.len().saturating_sub(state.samples.len()) as u64
            };
            state.stats.underflow_missing_samples = state
                .stats
                .underflow_missing_samples
                .saturating_add(missing);
            if state.stats.selected {
                state.stats.selected_underflow_samples = state
                    .stats
                    .selected_underflow_samples
                    .saturating_add(missing);
            }
            for sample in &mut output {
                *sample = state.samples.pop_front().unwrap_or(0);
            }
        }
        output
    }

    pub fn stats(&self, generation: u64) -> AudioQueueStats {
        let Ok(state) = self.state.lock() else {
            return AudioQueueStats::default();
        };
        if state.generation != generation {
            return AudioQueueStats::default();
        }
        AudioQueueStats {
            buffered_samples: state.samples.len(),
            ..state.stats
        }
    }

    /// Selecting an owner never drains or resets its queue. Selected producers
    /// use bounded backpressure; inactive queues keep the latest bounded audio.
    pub fn set_selected(&self, generation: u64, selected: bool) -> Result<(), DecoderError> {
        let mut state = self.state.lock().map_err(|_| DecoderError::Io)?;
        if state.generation != generation {
            return Err(DecoderError::StaleGeneration);
        }
        if state.stats.selected != selected {
            if let Some(t) = &mut state.timed {
                t.last_take_end = None;
            }
        }
        state.stats.selected = selected;
        Ok(())
    }

    pub fn has_audio(&self, generation: u64) -> bool {
        self.state
            .lock()
            .map(|state| state.generation == generation && state.has_audio)
            .unwrap_or(false)
    }

    pub fn mark_unavailable(&self, generation: u64) {
        if let Ok(mut state) = self.state.lock() {
            if state.generation == generation {
                state.has_audio = false;
                state.untimed_eof = false;
                state.samples.clear();
                if let Some(t) = &mut state.timed {
                    t.pending_first = None;
                    t.pending_end = None;
                    t.unresolved_rendered_until = None;
                }
            }
        }
    }

    fn available(&self, generation: u64) -> Result<(), DecoderError> {
        let mut state = self.state.lock().map_err(|_| DecoderError::Io)?;
        if state.generation != generation {
            return Err(DecoderError::StaleGeneration);
        }
        state.has_audio = true;
        state.untimed_eof = false;
        Ok(())
    }

    fn check_generation(&self, generation: u64) -> Result<(), DecoderError> {
        let state = self.state.lock().map_err(|_| DecoderError::Io)?;
        if state.generation == generation {
            Ok(())
        } else {
            Err(DecoderError::StaleGeneration)
        }
    }

    // The file monitor must retain its authority fence after child success
    // until every known EOF sample is consumed. A momentarily empty live FIFO
    // is not completion. Replacement/unavailability already invalidates custody.
    fn untimed_drain_complete(&self, generation: u64) -> Result<bool, DecoderError> {
        let state = self.state.lock().map_err(|_| DecoderError::Io)?;
        Ok(state.generation != generation
            || !state.has_audio
            || (state.untimed_eof && state.samples.is_empty()))
    }

    fn try_push(&self, generation: u64, bytes: &[u8]) -> Result<(), DecoderError> {
        self.try_push_final(generation, bytes, false)
    }

    // The final aligned tail and EOF become visible in the same queue lock.
    // A failed/backpressured push changes neither the FIFO nor the EOF state.
    fn try_push_final(
        &self,
        generation: u64,
        bytes: &[u8],
        final_chunk: bool,
    ) -> Result<(), DecoderError> {
        let count = bytes.len() / 2;
        if bytes.len() % 2 != 0 || count > AUDIO_BLOCK || (final_chunk && bytes.len() % 4 != 0) {
            return Err(DecoderError::InvalidInput);
        }
        let mut state = self.state.lock().map_err(|_| DecoderError::Io)?;
        if state.generation != generation {
            return Err(DecoderError::StaleGeneration);
        }
        if !state.has_audio || state.untimed_eof {
            return Err(DecoderError::PublicationDenied);
        }
        if final_chunk && state.timed.is_some() {
            return Err(DecoderError::InvalidInput);
        }
        let missing_room = count.saturating_sub(AUDIO_LIMIT - state.samples.len());
        if missing_room > 0 && state.stats.selected {
            // No bytes or counters change when the complete block cannot fit.
            return Err(DecoderError::Backpressure);
        }
        for _ in 0..missing_room {
            state.samples.pop_front();
        }
        state.stats.dropped_old_samples = state
            .stats
            .dropped_old_samples
            .saturating_add(missing_room as u64);
        state.stats.pushed_samples = state.stats.pushed_samples.saturating_add(count as u64);
        for pair in bytes.chunks_exact(2) {
            state
                .samples
                .push_back(i16::from_le_bytes([pair[0], pair[1]]));
        }
        state.untimed_eof = final_chunk;
        Ok(())
    }
}

fn publish_audio(
    binding: Option<&Binding>,
    queue: &AudioQueue,
    generation: u64,
    bytes: &[u8],
    final_chunk: bool,
    cancelled: &AtomicBool,
    began: Instant,
) -> Result<(), DecoderError> {
    let mut full_since = None;
    loop {
        if cancelled.load(Ordering::Acquire) {
            return Err(DecoderError::PublicationDenied);
        }
        wait_active(binding, cancelled, began)?;
        let mut operation = || {
            if final_chunk {
                queue.try_push_final(generation, bytes, true)
            } else {
                queue.try_push(generation, bytes)
            }
        };
        match publish_bound(binding, &mut operation) {
            Err(DecoderError::Backpressure) => {
                let since = full_since.get_or_insert_with(Instant::now);
                if since.elapsed() >= Duration::from_secs(2) {
                    return Err(DecoderError::Stalled);
                }
                // The broker publication barrier and queue mutex are both gone.
                thread::sleep(Duration::from_millis(2));
            }
            result => return result,
        }
    }
}

struct Process(Option<Child>);
impl Process {
    fn stop(&mut self) {
        if let Some(mut child) = self.0.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}
impl Drop for Process {
    fn drop(&mut self) {
        self.stop();
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SampleAspectRatio {
    pub numerator: u32,
    pub denominator: u32,
}
impl SampleAspectRatio {
    pub const SQUARE: Self = Self {
        numerator: 1,
        denominator: 1,
    };
    fn parse(value: Option<&str>) -> Result<Self, DecoderError> {
        let Some(value) = value else {
            return Ok(Self::SQUARE);
        };
        if value == "N/A" || value == "0:1" {
            return Ok(Self::SQUARE);
        }
        let (n, d) = value.split_once(':').ok_or(DecoderError::ProbeFailed)?;
        let (n, d) = (
            n.parse::<u32>().map_err(|_| DecoderError::ProbeFailed)?,
            d.parse::<u32>().map_err(|_| DecoderError::ProbeFailed)?,
        );
        if n == 0 || d == 0 {
            return Err(DecoderError::InvalidInput);
        }
        let (mut a, mut b) = (n, d);
        while b != 0 {
            (a, b) = (b, a % b);
        }
        Ok(Self {
            numerator: n / a,
            denominator: d / a,
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MediaInfo {
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub has_audio: bool,
    pub sample_aspect_ratio: SampleAspectRatio,
}
impl MediaInfo {
    /// Conservative whole decoded pixels/second; invalid public values saturate.
    pub fn pixel_rate(&self) -> u64 {
        if self.width == 0 || self.height == 0 || !self.fps.is_finite() || self.fps <= 0.0 {
            return u64::MAX;
        }
        let pixels = u64::from(self.width) * u64::from(self.height);
        let rate = (pixels as f64 * self.fps).ceil();
        if !rate.is_finite() || rate >= u64::MAX as f64 {
            u64::MAX
        } else {
            rate as u64
        }
    }
}
// Probe-bound display geometry; dynamic SAR/resolution changes and rotation
// are not qualified here. Coded geometry still governs input resource admission.
fn content_rect(info: MediaInfo, buffer: FrameSpec) -> Result<FrameContentRect, DecoderError> {
    let sar = info.sample_aspect_ratio;
    if info.width == 0
        || info.height == 0
        || sar.numerator == 0
        || sar.denominator == 0
        || buffer.width < 2
        || buffer.height < 2
        || buffer.width % 2 != 0
        || buffer.height % 2 != 0
    {
        return Err(DecoderError::InvalidInput);
    }
    let n = u128::from(info.width)
        .checked_mul(u128::from(sar.numerator))
        .ok_or(DecoderError::InvalidInput)?;
    let d = u128::from(info.height)
        .checked_mul(u128::from(sar.denominator))
        .ok_or(DecoderError::InvalidInput)?;
    let (w, h) = if n
        .checked_mul(u128::from(buffer.height))
        .ok_or(DecoderError::InvalidInput)?
        >= d.checked_mul(u128::from(buffer.width))
            .ok_or(DecoderError::InvalidInput)?
    {
        (
            u128::from(buffer.width),
            u128::from(buffer.width)
                .checked_mul(d)
                .ok_or(DecoderError::InvalidInput)?
                / n,
        )
    } else {
        (
            u128::from(buffer.height)
                .checked_mul(n)
                .ok_or(DecoderError::InvalidInput)?
                / d,
            u128::from(buffer.height),
        )
    };
    let (w, h) = (
        u32::try_from(w).map_err(|_| DecoderError::InvalidInput)? & !1,
        u32::try_from(h).map_err(|_| DecoderError::InvalidInput)? & !1,
    );
    if w < 2 || h < 2 {
        return Err(DecoderError::InvalidInput);
    }
    let content = FrameContentRect {
        x: (buffer.width - w) / 2,
        y: (buffer.height - h) / 2,
        width: w,
        height: h,
    };
    content
        .validate(buffer)
        .map_err(|_| DecoderError::InvalidInput)?;
    Ok(content)
}
fn content_filter(buffer: FrameSpec, content: FrameContentRect, fps: u32) -> String {
    // RGB before pad prevents chroma-subsampling from rounding odd x/y offsets.
    format!(
        "scale={}:{},setsar=1,format=rgb24,pad={}:{}:{}:{}:color=black,fps={}",
        content.width, content.height, buffer.width, buffer.height, content.x, content.y, fps
    )
}

fn rate(value: &str) -> Result<f64, DecoderError> {
    let (n, d) = value.split_once('/').ok_or(DecoderError::ProbeFailed)?;
    let n = n.parse::<u64>().map_err(|_| DecoderError::ProbeFailed)?;
    let d = d.parse::<u64>().map_err(|_| DecoderError::ProbeFailed)?;
    if n == 0 || d == 0 {
        return Err(DecoderError::InvalidInput);
    }
    let result = n as f64 / d as f64;
    if result > 30.0 {
        return Err(DecoderError::InvalidInput);
    }
    Ok(result)
}
fn metadata(bytes: &[u8]) -> Result<MediaInfo, DecoderError> {
    let text = std::str::from_utf8(bytes).map_err(|_| DecoderError::ProbeFailed)?;
    let (mut in_stream, mut streams, mut video, mut audio) = (false, 0, false, false);
    let mut selected = None;
    let (mut kind, mut width, mut height, mut avg, mut nominal, mut sar) =
        ("", None, None, None, None, None);
    for line in text.lines() {
        match line {
            "[STREAM]" => {
                if in_stream || streams >= 32 {
                    return Err(DecoderError::ProbeFailed);
                }
                in_stream = true;
                streams += 1;
                (kind, width, height, avg, nominal, sar) = ("", None, None, None, None, None);
            }
            "[/STREAM]" => {
                if !in_stream {
                    return Err(DecoderError::ProbeFailed);
                }
                if kind == "video" && !video {
                    let w = width.ok_or(DecoderError::ProbeFailed)?;
                    let h = height.ok_or(DecoderError::ProbeFailed)?;
                    if w == 0 || h == 0 || w > 1920 || h > 1080 {
                        return Err(DecoderError::InvalidInput);
                    }
                    let fps = rate(avg.ok_or(DecoderError::ProbeFailed)?)?
                        .max(rate(nominal.ok_or(DecoderError::ProbeFailed)?)?);
                    selected = Some(MediaInfo {
                        width: w,
                        height: h,
                        fps,
                        has_audio: false,
                        sample_aspect_ratio: SampleAspectRatio::parse(sar)?,
                    });
                    video = true;
                }
                audio |= kind == "audio";
                in_stream = false;
            }
            _ if in_stream => {
                if let Some((key, value)) = line.split_once('=') {
                    match key {
                        "codec_type" => kind = value,
                        "width" => {
                            width = Some(
                                value
                                    .parse::<u32>()
                                    .map_err(|_| DecoderError::ProbeFailed)?,
                            )
                        }
                        "height" => {
                            height = Some(
                                value
                                    .parse::<u32>()
                                    .map_err(|_| DecoderError::ProbeFailed)?,
                            )
                        }
                        "avg_frame_rate" => avg = Some(value),
                        "r_frame_rate" => nominal = Some(value),
                        "sample_aspect_ratio" => {
                            if sar.replace(value).is_some() {
                                return Err(DecoderError::ProbeFailed);
                            }
                        }
                        _ => {}
                    }
                }
            }
            _ => {}
        }
    }
    if !video || in_stream {
        return Err(DecoderError::ProbeFailed);
    }
    let mut selected = selected.ok_or(DecoderError::ProbeFailed)?;
    selected.has_audio = audio;
    Ok(selected)
}

fn tool(path: &Path) -> Result<PathBuf, DecoderError> {
    let path = path.canonicalize().map_err(|_| DecoderError::Unsupported)?;
    if !path.is_file() {
        return Err(DecoderError::Unsupported);
    }
    Ok(path)
}
fn captured(command: &mut Command) -> Result<Vec<u8>, DecoderError> {
    captured_until(command, Instant::now() + Duration::from_secs(5), &|| Ok(()))
}

fn captured_until(
    command: &mut Command,
    deadline: Instant,
    check: &dyn Fn() -> Result<(), DecoderError>,
) -> Result<Vec<u8>, DecoderError> {
    check()?;
    if Instant::now() >= deadline {
        return Err(DecoderError::ProbeTimeout);
    }
    let child = command
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| DecoderError::Unsupported)?;
    let mut process = Process(Some(child));
    let stdout = process
        .0
        .as_mut()
        .unwrap()
        .stdout
        .take()
        .ok_or(DecoderError::Io)?;
    let reader = thread::Builder::new()
        .name("multiview-probe".into())
        .spawn(move || {
            let mut bytes = Vec::new();
            stdout
                .take(PROBE_LIMIT + 1)
                .read_to_end(&mut bytes)
                .map(|_| bytes)
        })
        .map_err(|_| DecoderError::Io)?;
    let outcome = loop {
        if let Err(error) = check() {
            break Err(error);
        }
        if Instant::now() >= deadline {
            break Err(DecoderError::ProbeTimeout);
        }
        match process.0.as_mut().unwrap().try_wait() {
            Ok(Some(status)) => {
                break if status.success() {
                    Ok(())
                } else {
                    Err(DecoderError::ProbeFailed)
                }
            }
            Err(_) => break Err(DecoderError::Io),
            Ok(None) => {}
        }
        thread::sleep(Duration::from_millis(10));
    };
    process.stop();
    let bytes = reader
        .join()
        .map_err(|_| DecoderError::Io)?
        .map_err(|_| DecoderError::Io)?;
    if bytes.len() as u64 > PROBE_LIMIT {
        return Err(DecoderError::ProbeLimit);
    }
    outcome?;
    Ok(bytes)
}

fn stream_fd_tool(
    path: &Path,
    deadline: Instant,
    check: &dyn Fn() -> Result<(), DecoderError>,
) -> Result<PathBuf, DecoderError> {
    check()?;
    if Instant::now() >= deadline {
        return Err(DecoderError::ProbeTimeout);
    }
    let path = tool(path)?;
    let bytes = captured_until(
        Command::new(&path)
            .args(["-v", "quiet", "-protocols"])
            .stdin(Stdio::null()),
        deadline,
        check,
    )?;
    if !check_fd_protocol(&bytes) {
        return Err(DecoderError::Unsupported);
    }
    Ok(path)
}

// Help is streamed and discarded under a separate finite discovery budget.
// This does not widen PROBE_LIMIT, the 64 KiB actual-media metadata limit.
#[cfg(any(target_os = "linux", target_os = "macos", test))]
const STREAM_HELP_LIMIT: usize = 4 * 1024 * 1024;
#[cfg(test)]
fn scan_stream_stats_help(reader: impl Read) -> Result<(bool, bool), DecoderError> {
    scan_stream_stats_help_until(reader, &|| Ok(()))
}
#[cfg(any(target_os = "linux", target_os = "macos", test))]
fn scan_stream_stats_help_until(
    mut reader: impl Read,
    check: &dyn Fn() -> Result<(), DecoderError>,
) -> Result<(bool, bool), DecoderError> {
    let mut count = 0usize;
    let mut tail = Vec::with_capacity(4224);
    let (mut stats, mut format) = (false, false);
    let mut bytes = [0u8; 4096];
    loop {
        check()?;
        // Read at most one byte beyond the cap so even a hostile producer has
        // a finite byte budget. No full help output is retained.
        let allowance = bytes.len().min(STREAM_HELP_LIMIT - count + 1);
        let n = match reader.read(&mut bytes[..allowance]) {
            Ok(n) => n,
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(2));
                continue;
            }
            Err(_) => return Err(DecoderError::Io),
        };
        if n == 0 {
            return Ok((stats, format));
        }
        count += n;
        if count > STREAM_HELP_LIMIT {
            return Err(DecoderError::Unsupported);
        }
        tail.extend_from_slice(&bytes[..n]);
        stats |= tail
            .windows(b"-stats_mux_pre[".len())
            .any(|w| w == b"-stats_mux_pre[");
        format |= tail
            .windows(b"-stats_mux_pre_fmt[".len())
            .any(|w| w == b"-stats_mux_pre_fmt[");
        if tail.len() > 128 {
            tail.drain(..tail.len() - 128);
        }
    }
}
#[cfg(any(target_os = "linux", target_os = "macos", test))]
fn stream_stats_supported(fields: (bool, bool), successful_exit: bool) -> Result<(), DecoderError> {
    if successful_exit && fields == (true, true) {
        Ok(())
    } else {
        Err(DecoderError::Unsupported)
    }
}

// Stream-only discovery shares the whole probe deadline. A reader error or
// limit wakes the parent immediately; finding both flags is not early success:
// the bounded remainder must drain and the tool must exit successfully.
#[cfg(any(target_os = "linux", target_os = "macos"))]
fn require_stream_stats(
    path: &Path,
    deadline: Instant,
    check: &dyn Fn() -> Result<(), DecoderError>,
) -> Result<(), DecoderError> {
    check()?;
    if Instant::now() >= deadline {
        return Err(DecoderError::ProbeTimeout);
    }
    let child = Command::new(path)
        .args(["-hide_banner", "-h", "full"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| DecoderError::Unsupported)?;
    let mut process = Process(Some(child));
    let stdout = process
        .0
        .as_mut()
        .unwrap()
        .stdout
        .take()
        .ok_or(DecoderError::Io)?;
    use std::os::fd::AsFd;
    timed_io::nonblocking(stdout.as_fd())?;
    let stop = Arc::new(AtomicBool::new(false));
    let reader_stop = stop.clone();
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    let reader = thread::Builder::new()
        .name("multiview-stats-features".into())
        .spawn(move || {
            let check_reader = || {
                if reader_stop.load(Ordering::Acquire) {
                    return Err(DecoderError::PublicationDenied);
                }
                if Instant::now() >= deadline {
                    return Err(DecoderError::ProbeTimeout);
                }
                Ok(())
            };
            let _ = sender.send(scan_stream_stats_help_until(stdout, &check_reader));
        })
        .map_err(|_| DecoderError::Io)?;
    let mut fields = None;
    let mut exit = None;
    let outcome = loop {
        if let Err(error) = check() {
            break Err(error);
        }
        if Instant::now() >= deadline {
            break Err(DecoderError::ProbeTimeout);
        }
        if fields.is_none() {
            match receiver.try_recv() {
                Ok(Ok(found)) => fields = Some(found),
                Ok(Err(error)) => break Err(error),
                Err(std::sync::mpsc::TryRecvError::Empty) => {}
                Err(std::sync::mpsc::TryRecvError::Disconnected) => break Err(DecoderError::Io),
            }
        }
        if exit.is_none() {
            match process.0.as_mut().unwrap().try_wait() {
                Ok(Some(status)) if !status.success() => break Err(DecoderError::Unsupported),
                Ok(Some(_)) => exit = Some(true),
                Ok(None) => {}
                Err(_) => break Err(DecoderError::Io),
            }
        }
        if let (Some(found), Some(success)) = (fields, exit) {
            break stream_stats_supported(found, success);
        }
        thread::sleep(Duration::from_millis(5));
    };
    // Kill/wait before joining: cap, read failure, cancellation and deadline
    // cannot leave a writer blocked on the pipe or a child unreaped.
    stop.store(true, Ordering::Release);
    process.stop();
    reader.join().map_err(|_| DecoderError::Io)?;
    outcome
}
#[cfg(not(any(target_os = "linux", target_os = "macos")))]
fn require_stream_stats(
    _path: &Path,
    _deadline: Instant,
    check: &dyn Fn() -> Result<(), DecoderError>,
) -> Result<(), DecoderError> {
    check()?;
    Err(DecoderError::Unsupported)
}

fn require_fd(path: &Path) -> Result<(), DecoderError> {
    let bytes = captured(
        Command::new(tool(path)?)
            .args(["-v", "quiet", "-protocols"])
            .stdin(Stdio::null()),
    )
    .map_err(|_| DecoderError::Unsupported)?;
    if check_fd_protocol(&bytes) {
        Ok(())
    } else {
        Err(DecoderError::Unsupported)
    }
}

/// All probes use the already-open descriptor. No pathname fallback is allowed.
pub fn probe_source(
    config: &DecoderConfig,
    source: &GrantedFile,
) -> Result<MediaInfo, DecoderError> {
    source.while_unclaimed(|file| {
        require_fd(&config.ffmpeg)?;
        require_fd(&config.ffprobe)?;
        source.check_live()?;
        let bytes = captured(
            Command::new(tool(&config.ffprobe)?)
                .args([
                    "-v",
                    "quiet",
                    "-protocol_whitelist",
                    "fd",
                    "-format_whitelist",
                    "mov,matroska,webm,mpegts,avi",
                    "-probesize",
                    "1048576",
                    "-analyzeduration",
                    "1000000",
                    "-show_entries",
                    "stream=codec_type,width,height,avg_frame_rate,r_frame_rate,sample_aspect_ratio",
                    "-of",
                    "default=noprint_wrappers=0:nokey=0",
                    "-fd",
                    "0",
                    "-i",
                    "fd:",
                ])
                .stdin(Stdio::from(file)),
        )?;
        metadata(&bytes)
    })
}

/// Probe a fresh, non-seekable MPEG-TS descriptor. The host must cancel and join
/// its producer after this returns, including errors, before opening Decode.
/// The returned receipt proves metadata/FFprobe retirement, not producer drain.
pub fn probe_stream(
    config: &DecoderConfig,
    source: &GrantedStream,
    input: StreamInput,
    cancel: &AtomicBool,
    deadline: Instant,
) -> Result<PreparedStreamInfo, DecoderError> {
    checked_frame_bytes(config)?;
    if input.phase != StreamPhase::Probe || !Arc::ptr_eq(&input.identity, &source.identity) {
        return Err(DecoderError::BindingMismatch);
    }
    {
        let state = source.identity.0.lock().map_err(|_| DecoderError::Io)?;
        if !state.probe_issued || state.probe_completed || state.started {
            return Err(DecoderError::StaleGeneration);
        }
    }
    let deadline = deadline
        .min(source.hard_end())
        .min(Instant::now() + Duration::from_secs(5));
    let check = || {
        if cancel.load(Ordering::Acquire) {
            return Err(DecoderError::Cancelled);
        }
        source.binding.check(&source.binding.context)
    };
    let ffmpeg = stream_fd_tool(&config.ffmpeg, deadline, &check)?;
    let ffprobe = stream_fd_tool(&config.ffprobe, deadline, &check)?;
    require_stream_stats(&ffmpeg, deadline, &check)?;
    let bytes = captured_until(
        Command::new(&ffprobe)
            .args([
                "-v",
                "quiet",
                "-protocol_whitelist",
                "fd",
                "-format_whitelist",
                "mpegts",
                "-f",
                "mpegts",
                "-probesize",
                "1048576",
                "-analyzeduration",
                "1000000",
                "-show_entries",
                "stream=codec_type,width,height,avg_frame_rate,r_frame_rate,sample_aspect_ratio",
                "-of",
                "default=noprint_wrappers=0:nokey=0",
                "-fd",
                "0",
                "-i",
                "fd:",
            ])
            .stdin(Stdio::from(input.reader)),
        deadline,
        &check,
    )?;
    let information = metadata(&bytes)?;
    check()?;
    if Instant::now() >= deadline {
        return Err(DecoderError::ProbeTimeout);
    }
    {
        let mut state = source.identity.0.lock().map_err(|_| DecoderError::Io)?;
        if state.probe_completed || state.started {
            return Err(DecoderError::StaleGeneration);
        }
        state.probe_completed = true;
    }
    Ok(PreparedStreamInfo {
        information,
        identity: source.identity.clone(),
        ffmpeg,
        _ffprobe: ffprobe,
        configured_ffmpeg: config.ffmpeg.clone(),
        configured_ffprobe: config.ffprobe.clone(),
        frame_spec: config.frame_spec,
        fps: config.fps,
    })
}

fn checked_frame_bytes(config: &DecoderConfig) -> Result<usize, DecoderError> {
    let spec = config.frame_spec;
    if spec.width == 0
        || spec.height == 0
        || spec.width > 640
        || spec.height > 360
        || spec.width % 2 != 0
        || spec.height % 2 != 0
        || config.fps == 0
        || config.fps > 15
    {
        return Err(DecoderError::InvalidInput);
    }
    (spec.width as usize)
        .checked_mul(spec.height as usize)
        .and_then(|n| n.checked_mul(3))
        .ok_or(DecoderError::InvalidInput)
}

#[derive(Clone, Copy)]
enum InputFormat {
    FileContainers,
    MpegTs,
}

// Unlike fixed RGB frames, a finite stereo PCM stream may end in a short
// aligned block. A partial sample or stereo frame is malformed, never padded.
fn pcm_block(reader: &mut impl Read, bytes: &mut [u8]) -> std::io::Result<usize> {
    let mut filled = 0;
    while filled < bytes.len() {
        match reader.read(&mut bytes[filled..]) {
            Ok(0) => break,
            Ok(n) => filled += n,
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(error),
        }
    }
    if filled % 4 != 0 {
        return Err(std::io::ErrorKind::InvalidData.into());
    }
    Ok(filled)
}

/// Return true for a complete block, false for clean EOF; reject partial blocks.
fn block(reader: &mut impl Read, bytes: &mut [u8]) -> std::io::Result<bool> {
    let mut filled = 0;
    while filled < bytes.len() {
        match reader.read(&mut bytes[filled..]) {
            Ok(0) if filled == 0 => return Ok(false),
            Ok(0) => return Err(std::io::ErrorKind::UnexpectedEof.into()),
            Ok(count) => filled += count,
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {}
            Err(error) => return Err(error),
        }
    }
    Ok(true)
}

// A short track may wait arbitrarily long for its live sibling. Once every
// selected track has committed its terminal frontier, retain the original five
// second no-progress bound while the global child monitor proves retirement.
fn pending_exit_expired(
    since: &mut Option<Instant>,
    video_pending: bool,
    audio_pending: bool,
    now: Instant,
) -> bool {
    if !video_pending || !audio_pending {
        return false;
    }
    let start = since.get_or_insert(now);
    now.saturating_duration_since(*start) >= Duration::from_secs(5)
}

fn fail_owned(
    process: &Mutex<Process>,
    cancelled: &AtomicBool,
    video: &LatestFrame,
    audio: &AudioQueue,
    generation: u64,
) {
    let _ = video.mark_failed(generation);
    audio.mark_unavailable(generation);
    cancelled.store(true, Ordering::Release);
    process
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .stop();
}

pub struct Decoder {
    pid: u32,
    process: Arc<Mutex<Process>>,
    cancelled: Arc<AtomicBool>,
    readers: Vec<JoinHandle<()>>,
    audio: Arc<AudioQueue>,
    generation: u64,
    #[cfg(unix)]
    metadata_pipes: Option<timed_io::MetadataPipes>,
}
impl Decoder {
    pub fn start(
        config: &DecoderConfig,
        source: &GrantedFile,
        generation: u64,
        video: Arc<LatestFrame>,
        audio: Arc<AudioQueue>,
    ) -> Result<Self, DecoderError> {
        checked_frame_bytes(config)?;
        if video.generation() != generation {
            return Err(DecoderError::StaleGeneration);
        }
        audio.check_generation(generation)?;
        let information = probe_source(config, source)?;
        if video.generation() != generation {
            return Err(DecoderError::StaleGeneration);
        }
        audio.check_generation(generation)?;
        let ffmpeg = tool(&config.ffmpeg)?;
        Self::start_input(
            config,
            source.claim()?,
            source.binding.clone(),
            information,
            InputFormat::FileContainers,
            ffmpeg,
            generation,
            video,
            audio,
            None,
        )
    }

    pub fn start_stream(
        config: &DecoderConfig,
        source: &GrantedStream,
        prepared: PreparedStreamInfo,
        input: StreamInput,
        generation: u64,
        video: Arc<LatestFrame>,
        audio: Arc<AudioQueue>,
    ) -> Result<Self, DecoderError> {
        Self::start_stream_impl(
            config, source, prepared, input, generation, video, audio, None,
        )
    }
    pub(crate) fn start_stream_with_clock(
        config: &DecoderConfig,
        source: &GrantedStream,
        prepared: PreparedStreamInfo,
        input: StreamInput,
        generation: u64,
        video: Arc<LatestFrame>,
        audio: Arc<AudioQueue>,
        presentation: Arc<PresentationClock>,
    ) -> Result<Self, DecoderError> {
        if presentation.current()?.is_none() {
            return Err(DecoderError::Unsupported);
        }
        Self::start_stream_impl(
            config,
            source,
            prepared,
            input,
            generation,
            video,
            audio,
            Some(presentation),
        )
    }
    fn start_stream_impl(
        config: &DecoderConfig,
        source: &GrantedStream,
        prepared: PreparedStreamInfo,
        input: StreamInput,
        generation: u64,
        video: Arc<LatestFrame>,
        audio: Arc<AudioQueue>,
        presentation: Option<Arc<PresentationClock>>,
    ) -> Result<Self, DecoderError> {
        validate_stream_preparation(config, source, &prepared, &input)?;
        if source.binding.context.source_revision.checked_add(1) != Some(generation) {
            return Err(DecoderError::StaleGeneration);
        }
        if video.generation() != generation {
            return Err(DecoderError::StaleGeneration);
        }
        audio.check_generation(generation)?;
        {
            let mut state = source.identity.0.lock().map_err(|_| DecoderError::Io)?;
            if state.started {
                return Err(DecoderError::StaleGeneration);
            }
            state.started = true;
        }
        Self::start_input(
            config,
            input.reader,
            Some(source.binding.clone()),
            prepared.information,
            InputFormat::MpegTs,
            prepared.ffmpeg,
            generation,
            video,
            audio,
            presentation,
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn start_input(
        config: &DecoderConfig,
        input: File,
        publication: Option<Arc<Binding>>,
        information: MediaInfo,
        format: InputFormat,
        ffmpeg: PathBuf,
        generation: u64,
        video: Arc<LatestFrame>,
        audio: Arc<AudioQueue>,
        presentation: Option<Arc<PresentationClock>>,
    ) -> Result<Self, DecoderError> {
        if matches!(format, InputFormat::MpegTs) {
            return Self::start_clocked(
                config,
                input,
                publication,
                information,
                ffmpeg,
                generation,
                video,
                audio,
                presentation,
            );
        }
        let frame_bytes = checked_frame_bytes(config)?;
        let content = content_rect(information, config.frame_spec)?;
        if video.generation() != generation {
            return Err(DecoderError::StaleGeneration);
        }
        audio.check_generation(generation)?;
        if let Some(binding) = &publication {
            binding.check(&binding.context)?;
        }
        let mut command = Command::new(ffmpeg);
        command.args([
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "quiet",
            "-nostats",
            "-filter_threads",
            "1",
            "-filter_complex_threads",
            "1",
            "-re",
            "-protocol_whitelist",
            "fd",
            "-format_whitelist",
            match format {
                InputFormat::FileContainers => "mov,matroska,webm,mpegts,avi",
                InputFormat::MpegTs => "mpegts",
            },
            "-threads",
            "1",
            "-max_pixels",
            "2073600",
        ]);
        if matches!(format, InputFormat::MpegTs) {
            command.args([
                "-f",
                "mpegts",
                "-analyzeduration",
                "1000000",
                "-probesize",
                "1048576",
            ]);
        }
        command
            .args(["-fd", "0", "-i", "fd:"])
            .args(["-map", "0:v:0", "-an", "-vf"])
            .arg(content_filter(config.frame_spec, content, config.fps))
            .args([
                "-threads", "1", "-c:v", "rawvideo", "-pix_fmt", "rgb24", "-f", "rawvideo",
                "pipe:1",
            ]);
        if information.has_audio {
            command.args([
                "-map",
                "0:a:0",
                "-vn",
                "-threads",
                "1",
                "-c:a",
                "pcm_s16le",
                "-ac",
                "2",
                "-ar",
                "48000",
                "-f",
                "s16le",
                "pipe:2",
            ]);
        }
        command
            .stdin(Stdio::from(input))
            .stdout(Stdio::piped())
            .stderr(if information.has_audio {
                Stdio::piped()
            } else {
                Stdio::null()
            });
        let child = command.spawn().map_err(|_| DecoderError::Unsupported)?;
        let mut process = Process(Some(child));
        let pid = process.0.as_ref().unwrap().id();
        let stdout = process
            .0
            .as_mut()
            .unwrap()
            .stdout
            .take()
            .ok_or(DecoderError::Io)?;
        let stderr = process.0.as_mut().unwrap().stderr.take();
        let mut decoder = Self {
            pid,
            process: Arc::new(Mutex::new(process)),
            cancelled: Arc::new(AtomicBool::new(false)),
            readers: Vec::new(),
            audio: audio.clone(),
            generation,
            #[cfg(unix)]
            metadata_pipes: None,
        };
        if information.has_audio {
            audio.available(generation)?;
        } else {
            audio.mark_unavailable(generation);
        }
        let cancelled = decoder.cancelled.clone();
        let video_reader = video.clone();
        let process = decoder.process.clone();
        let queue = audio.clone();
        let binding = publication.clone();
        let began = Instant::now();
        let handle = thread::Builder::new()
            .name("multiview-video".into())
            .spawn(move || {
                let mut reader = stdout;
                let mut sequence = 0u64;
                loop {
                    let mut bytes = vec![0; frame_bytes];
                    match block(&mut reader, &mut bytes) {
                        Ok(true) if !cancelled.load(Ordering::Acquire) => {
                            let Some(next) = sequence.checked_add(1) else {
                                let _ = video_reader.mark_failed(generation);
                                break;
                            };
                            sequence = next;
                            if wait_active(binding.as_deref(), &cancelled, began).is_err() {
                                if !cancelled.load(Ordering::Acquire) {
                                    fail_owned(
                                        &process,
                                        &cancelled,
                                        &video_reader,
                                        &queue,
                                        generation,
                                    );
                                }
                                break;
                            }
                            let mut operation = || {
                                video_reader
                                    .publish_content(
                                        generation,
                                        sequence,
                                        std::mem::take(&mut bytes),
                                        Instant::now(),
                                        content,
                                    )
                                    .map_err(|_| DecoderError::StaleGeneration)
                            };
                            if publish_bound(binding.as_deref(), &mut operation).is_err() {
                                // The broker barrier is released before kill/wait.
                                fail_owned(&process, &cancelled, &video_reader, &queue, generation);
                                break;
                            }
                        }
                        outcome => {
                            if !cancelled.load(Ordering::Acquire) {
                                if matches!(outcome, Ok(false)) && sequence > 0 {
                                    let _ = video_reader.mark_ended(generation);
                                } else {
                                    let _ = video_reader.mark_failed(generation);
                                }
                            }
                            break;
                        }
                    }
                }
            })
            .map_err(|_| DecoderError::Io)?;
        decoder.readers.push(handle);
        if let Some(mut stderr) = stderr {
            let cancelled = decoder.cancelled.clone();
            let queue = audio.clone();
            let process = decoder.process.clone();
            let video_audio = video.clone();
            let binding = publication.clone();
            let handle = thread::Builder::new()
                .name("multiview-audio".into())
                .spawn(move || {
                    let mut bytes = [0u8; AUDIO_BLOCK * 2];
                    while !cancelled.load(Ordering::Acquire) {
                        let count = match pcm_block(&mut stderr, &mut bytes) {
                            Ok(count) => count,
                            Err(_) => {
                                if !cancelled.load(Ordering::Acquire) {
                                    fail_owned(
                                        &process,
                                        &cancelled,
                                        &video_audio,
                                        &queue,
                                        generation,
                                    );
                                }
                                return;
                            }
                        };
                        let final_chunk = count < bytes.len();
                        if publish_audio(
                            binding.as_deref(),
                            &queue,
                            generation,
                            &bytes[..count],
                            final_chunk,
                            &cancelled,
                            began,
                        )
                        .is_err()
                        {
                            if !cancelled.load(Ordering::Acquire) {
                                fail_owned(&process, &cancelled, &video_audio, &queue, generation);
                            }
                            return;
                        }
                        if final_chunk {
                            // A successful child exit is checked separately by
                            // the monitor. Do not stop/clear its queued PCM here.
                            return;
                        }
                    }
                    queue.mark_unavailable(generation);
                })
                .map_err(|_| DecoderError::Io)?;
            decoder.readers.push(handle);
        }
        let process = decoder.process.clone();
        let cancelled = decoder.cancelled.clone();
        let queue = audio;
        let binding = publication.clone();
        let handle = thread::Builder::new()
            .name("multiview-decoder-state".into())
            .spawn(move || {
                while !cancelled.load(Ordering::Acquire) {
                    if binding.as_ref().is_some_and(|binding| {
                        !binding.active.load(Ordering::Acquire)
                            && began.elapsed() >= Duration::from_secs(5)
                    }) {
                        fail_owned(&process, &cancelled, &video, &queue, generation);
                        break;
                    }
                    if binding
                        .as_ref()
                        .is_some_and(|binding| binding.check(&binding.context).is_err())
                    {
                        fail_owned(&process, &cancelled, &video, &queue, generation);
                        break;
                    }
                    let status = process
                        .lock()
                        .ok()
                        .and_then(|mut process| process.0.as_mut().map(|child| child.try_wait()));
                    match status {
                        Some(Ok(None)) => {}
                        Some(Ok(Some(status))) if status.success() => {
                            match queue.untimed_drain_complete(generation) {
                                Ok(true) => break,
                                Ok(false) => {}
                                Err(_) => {
                                    fail_owned(&process, &cancelled, &video, &queue, generation);
                                    break;
                                }
                            }
                        }
                        _ => {
                            if !cancelled.load(Ordering::Acquire) {
                                fail_owned(&process, &cancelled, &video, &queue, generation);
                            }
                            break;
                        }
                    }
                    thread::sleep(Duration::from_millis(10));
                }
            })
            .map_err(|_| DecoderError::Io)?;
        decoder.readers.push(handle);
        Ok(decoder)
    }

    #[cfg(not(unix))]
    #[allow(clippy::too_many_arguments)]
    fn start_clocked(
        _config: &DecoderConfig,
        _input: File,
        _publication: Option<Arc<Binding>>,
        _information: MediaInfo,
        _ffmpeg: PathBuf,
        _generation: u64,
        _video: Arc<LatestFrame>,
        _audio: Arc<AudioQueue>,
        _presentation: Option<Arc<PresentationClock>>,
    ) -> Result<Self, DecoderError> {
        Err(DecoderError::Unsupported)
    }

    #[cfg(unix)]
    #[allow(clippy::too_many_arguments)]
    fn start_clocked(
        config: &DecoderConfig,
        input: File,
        publication: Option<Arc<Binding>>,
        information: MediaInfo,
        ffmpeg: PathBuf,
        generation: u64,
        video: Arc<LatestFrame>,
        audio: Arc<AudioQueue>,
        presentation: Option<Arc<PresentationClock>>,
    ) -> Result<Self, DecoderError> {
        use std::os::fd::AsFd;
        let frame_bytes = checked_frame_bytes(config)?;
        if video.generation() != generation {
            return Err(DecoderError::StaleGeneration);
        }
        audio.check_generation(generation)?;
        if let Some(b) = &publication {
            b.check(&b.context)?;
        }
        let pipes = timed_io::MetadataPipes::new(information.has_audio)?;
        let video_stats = pipes.video.try_clone().map_err(|_| DecoderError::Io)?;
        let audio_stats = pipes
            .audio
            .as_ref()
            .map(File::try_clone)
            .transpose()
            .map_err(|_| DecoderError::Io)?;
        let content = content_rect(information, config.frame_spec)?;
        let (video_graph, audio_graph) =
            timed_io::witness_graphs(config, content, &pipes, information.has_audio)?;
        let video_witness_reader = timed_io::WitnessReader::new(
            pipes
                .video_witness
                .try_clone()
                .map_err(|_| DecoderError::Io)?,
            pipes.witness_key.clone(),
            StreamKind::Video,
        )?;
        let video_witness = video_witness_reader.state.clone();
        let mut witness_readers = vec![video_witness_reader];
        let audio_witness = if let Some(file) = &pipes.audio_witness {
            let reader = timed_io::WitnessReader::new(
                file.try_clone().map_err(|_| DecoderError::Io)?,
                pipes.witness_key.clone(),
                StreamKind::Audio,
            )?;
            let state = reader.state.clone();
            witness_readers.push(reader);
            Some(state)
        } else {
            None
        };
        let mut cmd = Command::new(ffmpeg);
        cmd.args([
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "quiet",
            "-nostats",
            "-filter_threads",
            "1",
            "-filter_complex_threads",
            "1",
            "-protocol_whitelist",
            "fd",
            "-format_whitelist",
            "mpegts",
            "-threads",
            "1",
            "-max_pixels",
            "2073600",
            "-f",
            "mpegts",
            "-analyzeduration",
            "1000000",
            "-probesize",
            "1048576",
            "-fd",
            "0",
            "-i",
            "fd:",
            "-filter_complex",
        ])
        .arg(video_graph);
        if let Some(graph) = audio_graph {
            cmd.arg("-filter_complex").arg(graph);
        }
        // Passthrough preserves the already-normalized fps-filter output: no
        // post-split duplicate/drop or encoder flush packet can escape END N.
        cmd.args([
            "-map",
            "[vout]",
            "-an",
            "-fps_mode:v",
            "passthrough",
            "-enc_time_base:v",
            "filter",
            "-threads",
            "1",
            "-c:v",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "-f",
            "rawvideo",
            "-stats_mux_pre",
        ])
        .arg(&pipes.video_path)
        .args(["-stats_mux_pre_fmt", "V {n} {pts} {tb} {size}", "pipe:1"]);
        if information.has_audio {
            cmd.args([
                "-map",
                "[aout]",
                "-vn",
                "-threads",
                "1",
                "-c:a",
                "pcm_s16le",
                "-ac",
                "2",
                "-ar",
                "48000",
                "-f",
                "s16le",
                "-stats_mux_pre",
            ])
            .arg(&pipes.audio_path)
            .args(["-stats_mux_pre_fmt", "A {n} {pts} {tb} {size}", "pipe:2"]);
        }
        let child = cmd
            .stdin(Stdio::from(input))
            .stdout(Stdio::piped())
            .stderr(if information.has_audio {
                Stdio::piped()
            } else {
                Stdio::null()
            })
            .spawn()
            .map_err(|_| DecoderError::Unsupported)?;
        let mut process = Process(Some(child));
        let pid = process.0.as_ref().unwrap().id();
        let mut stdout = process
            .0
            .as_mut()
            .unwrap()
            .stdout
            .take()
            .ok_or(DecoderError::Io)?;
        let stderr = process.0.as_mut().unwrap().stderr.take();
        timed_io::nonblocking(stdout.as_fd())?;
        if let Some(s) = &stderr {
            timed_io::nonblocking(s.as_fd())?;
        }
        let clock = Arc::new(SourceClock::with_presentation(
            information.has_audio,
            presentation,
        ));
        let finished = Arc::new(AtomicBool::new(false));
        let video_pending = Arc::new(AtomicBool::new(false));
        let audio_pending = Arc::new(AtomicBool::new(!information.has_audio));
        let video_complete = Arc::new(AtomicBool::new(false));
        let audio_complete = Arc::new(AtomicBool::new(!information.has_audio));
        let mut decoder = Self {
            pid,
            process: Arc::new(Mutex::new(process)),
            cancelled: Arc::new(AtomicBool::new(false)),
            readers: Vec::new(),
            audio: audio.clone(),
            generation,
            metadata_pipes: Some(pipes),
        };
        if information.has_audio {
            audio.available(generation)?;
            audio.timed(generation, clock.clone())?;
        } else {
            audio.mark_unavailable(generation);
        }
        let began = Instant::now();
        let output_fps = config.fps;
        {
            let process = decoder.process.clone();
            let cancelled = decoder.cancelled.clone();
            let queue = audio.clone();
            let video = video.clone();
            let binding = publication.clone();
            let done = finished.clone();
            let handle = thread::Builder::new()
                .name("multiview-witness".into())
                .spawn(move || {
                    let result = timed_io::drain_witnesses(
                        &mut witness_readers,
                        &done,
                        &cancelled,
                        binding.as_deref(),
                    );
                    if result.is_err() && !cancelled.load(Ordering::Acquire) {
                        fail_owned(&process, &cancelled, &video, &queue, generation);
                    }
                })
                .map_err(|_| DecoderError::Io)?;
            decoder.readers.push(handle);
        }

        {
            let process = decoder.process.clone();
            let cancelled = decoder.cancelled.clone();
            let queue = audio.clone();
            let video = video.clone();
            let binding = publication.clone();
            let clock = clock.clone();
            let done = finished.clone();
            let complete = video_complete.clone();
            let pending = video_pending.clone();
            let handle = thread::Builder::new()
                .name("multiview-timed-video".into())
                .spawn(move || {
                    let result = (|| -> Result<(), DecoderError> {
                        let mut stats = timed_io::StatsReader::new(
                            video_stats,
                            frame_bytes,
                            StreamKind::Video,
                        )?;
                        let mut sequence = 0u64;
                        let mut committed_bytes = 0u64;
                        let mut final_end = None;
                        let watermark = loop {
                            let packet = match stats.next_pending(
                                &done,
                                &cancelled,
                                binding.as_deref(),
                                &video_witness,
                            )? {
                                timed_io::StatsEvent::Packet(packet) => packet,
                                timed_io::StatsEvent::Pending(watermark) => break watermark,
                            };
                            let pts = timed_error(packet.timestamp())?;
                            if final_end.is_some_and(|expected| expected != pts) {
                                return Err(DecoderError::InvalidInput);
                            }
                            final_end = Some(timed_error(pts.checked_add(timed_error(
                                RationalTime::new(1, output_fps as i128),
                            )?))?);
                            let mut bytes = vec![0; frame_bytes];
                            timed_io::raw(&mut stdout, &mut bytes, &cancelled, binding.as_deref())?;
                            if sequence == 0 {
                                wait_active(binding.as_deref(), &cancelled, began)?;
                                let presentation =
                                    clock.wait_for_presentation(&cancelled, binding.as_deref())?;
                                let mut observe =
                                    || clock.ready_at(StreamKind::Video, pts, presentation);
                                publish_bound(binding.as_deref(), &mut observe)?;
                            }
                            clock.wait(
                                pts,
                                Duration::ZERO,
                                &cancelled,
                                binding.as_deref(),
                                began,
                            )?;
                            wait_active(binding.as_deref(), &cancelled, began)?;
                            sequence = sequence.checked_add(1).ok_or(DecoderError::InvalidInput)?;
                            let mut operation = || {
                                video
                                    .publish_content(
                                        generation,
                                        sequence,
                                        std::mem::take(&mut bytes),
                                        Instant::now(),
                                        content,
                                    )
                                    .map_err(|_| DecoderError::StaleGeneration)
                            };
                            publish_bound(binding.as_deref(), &mut operation)?;
                            committed_bytes = committed_bytes
                                .checked_add(frame_bytes as u64)
                                .ok_or(DecoderError::InvalidInput)?;
                        };
                        watermark.validate(sequence, committed_bytes)?;
                        pending.store(true, Ordering::Release);
                        // Ended is a presentation slate at the last real frame's
                        // interval, not clean EOF or decoder/source retirement.
                        timed_io::pending_tail(
                            &mut stats,
                            &mut stdout,
                            &video_witness,
                            watermark,
                            &clock,
                            final_end.ok_or(DecoderError::InvalidInput)?,
                            &done,
                            &cancelled,
                            binding.as_deref(),
                            || {
                                let mut operation = || {
                                    video
                                        .mark_ended(generation)
                                        .map_err(|_| DecoderError::StaleGeneration)
                                };
                                publish_bound(binding.as_deref(), &mut operation)
                            },
                        )?;
                        Ok(())
                    })();
                    if result.is_ok() {
                        complete.store(true, Ordering::Release);
                    }
                    if result.is_err() && !cancelled.load(Ordering::Acquire) {
                        fail_owned(&process, &cancelled, &video, &queue, generation);
                    }
                })
                .map_err(|_| DecoderError::Io)?;
            decoder.readers.push(handle);
        }
        if let (Some(mut stderr), Some(stats_file), Some(audio_witness)) =
            (stderr, audio_stats, audio_witness)
        {
            let process = decoder.process.clone();
            let cancelled = decoder.cancelled.clone();
            let queue = audio.clone();
            let video = video.clone();
            let binding = publication.clone();
            let done = finished.clone();
            let complete = audio_complete.clone();
            let pending = audio_pending.clone();
            let clock = clock.clone();
            let handle = thread::Builder::new()
                .name("multiview-timed-audio".into())
                .spawn(move || {
                    let result = (|| -> Result<(), DecoderError> {
                        let mut stats =
                            timed_io::StatsReader::new(stats_file, frame_bytes, StreamKind::Audio)?;
                        let mut packets = 0u64;
                        let mut committed_bytes = 0u64;
                        let mut final_end = None;
                        let mut bytes = vec![0u8; AUDIO_BLOCK * 2];
                        let watermark = loop {
                            let packet = match stats.next_pending(
                                &done,
                                &cancelled,
                                binding.as_deref(),
                                &audio_witness,
                            )? {
                                timed_io::StatsEvent::Packet(packet) => packet,
                                timed_io::StatsEvent::Pending(watermark) => break watermark,
                            };
                            let start = timed_error(packet.timestamp())?;
                            let size = packet.byte_size as usize;
                            let mut offset = 0usize;
                            packets = packets.checked_add(1).ok_or(DecoderError::InvalidInput)?;
                            while offset < size {
                                let count = (size - offset).min(AUDIO_BLOCK * 2);
                                bytes.resize(count, 0);
                                timed_io::raw(
                                    &mut stderr,
                                    &mut bytes[..count],
                                    &cancelled,
                                    binding.as_deref(),
                                )?;
                                let pts = timed_error(start.checked_add(timed_error(
                                    RationalTime::new((offset / 4) as i128, 48_000),
                                )?))?;
                                let end = timed_error(pts.checked_add(timed_error(
                                    RationalTime::new((count / 4) as i128, 48_000),
                                )?))?;
                                final_end = Some(end);
                                let mut first_queued = false;
                                if packets == 1 && offset == 0 {
                                    wait_active(binding.as_deref(), &cancelled, began)?;
                                    let presentation = clock
                                        .wait_for_presentation(&cancelled, binding.as_deref())?;
                                    let mut owned = Some(std::mem::take(&mut bytes));
                                    let mut observe = || {
                                        first_queued = queue.begin_audio_owned(
                                            generation,
                                            pts,
                                            owned.take().ok_or(DecoderError::InvalidInput)?,
                                            presentation,
                                        )?;
                                        Ok(())
                                    };
                                    publish_bound(binding.as_deref(), &mut observe)?;
                                    let deadline = Instant::now() + Duration::from_secs(5);
                                    while !first_queued {
                                        check_clock_live(&cancelled, binding.as_deref())?;
                                        let presentation = clock.presentation_before(
                                            &cancelled,
                                            binding.as_deref(),
                                            deadline,
                                        )?;
                                        let mut promote = || {
                                            first_queued =
                                                queue.promote_first(generation, presentation)?;
                                            Ok(())
                                        };
                                        publish_bound(binding.as_deref(), &mut promote)?;
                                        if !first_queued {
                                            if Instant::now() >= deadline {
                                                return Err(DecoderError::Stalled);
                                            }
                                            thread::sleep(Duration::from_millis(2));
                                        }
                                    }
                                }
                                if !first_queued {
                                    clock.wait(
                                        end,
                                        Duration::from_millis(140),
                                        &cancelled,
                                        binding.as_deref(),
                                        began,
                                    )?;
                                    let mut full_since = None;
                                    loop {
                                        check_clock_live(&cancelled, binding.as_deref())?;
                                        wait_active(binding.as_deref(), &cancelled, began)?;
                                        let mut operation =
                                            || queue.push_at(generation, pts, &bytes[..count]);
                                        match publish_bound(binding.as_deref(), &mut operation) {
                                            Err(DecoderError::Backpressure) => {
                                                let since =
                                                    full_since.get_or_insert_with(Instant::now);
                                                if since.elapsed() >= Duration::from_secs(2) {
                                                    return Err(DecoderError::Stalled);
                                                }
                                                thread::sleep(Duration::from_millis(2));
                                            }
                                            r => {
                                                r?;
                                                break;
                                            }
                                        }
                                    }
                                }
                                offset += count;
                            }
                            committed_bytes = committed_bytes
                                .checked_add(size as u64)
                                .ok_or(DecoderError::InvalidInput)?;
                        };
                        watermark.validate(packets, committed_bytes)?;
                        let final_pts = final_end.ok_or(DecoderError::InvalidInput)?;
                        let mut terminal = || queue.publish_pending_end(generation, final_pts);
                        publish_bound(binding.as_deref(), &mut terminal)?;
                        pending.store(true, Ordering::Release);
                        timed_io::pending_tail(
                            &mut stats,
                            &mut stderr,
                            &audio_witness,
                            watermark,
                            &clock,
                            final_pts,
                            &done,
                            &cancelled,
                            binding.as_deref(),
                            || Ok(()),
                        )?;
                        Ok(())
                    })();
                    if result.is_ok() {
                        complete.store(true, Ordering::Release);
                    }
                    if result.is_err() && !cancelled.load(Ordering::Acquire) {
                        fail_owned(&process, &cancelled, &video, &queue, generation);
                    }
                })
                .map_err(|_| DecoderError::Io)?;
            decoder.readers.push(handle);
        }
        {
            let process = decoder.process.clone();
            let cancelled = decoder.cancelled.clone();
            let queue = audio;
            let binding = publication;
            let handle = thread::Builder::new()
                .name("multiview-timed-state".into())
                .spawn(move || {
                    let mut pending_since = None;
                    while !cancelled.load(Ordering::Acquire) {
                        if clock.fault.load(Ordering::Acquire) {
                            fail_owned(&process, &cancelled, &video, &queue, generation);
                            break;
                        }
                        if binding.as_ref().is_some_and(|b| {
                            b.check(&b.context).is_err()
                                || (!b.active.load(Ordering::Acquire)
                                    && began.elapsed() >= Duration::from_secs(5))
                        }) {
                            fail_owned(&process, &cancelled, &video, &queue, generation);
                            break;
                        }
                        if finished.load(Ordering::Acquire) {
                            if video_complete.load(Ordering::Acquire)
                                && audio_complete.load(Ordering::Acquire)
                            {
                                break;
                            }
                            thread::sleep(Duration::from_millis(2));
                            continue;
                        }
                        let status = process
                            .lock()
                            .ok()
                            .and_then(|mut p| p.0.as_mut().map(Child::try_wait));
                        match status {
                            Some(Ok(None)) => {
                                if pending_exit_expired(
                                    &mut pending_since,
                                    video_pending.load(Ordering::Acquire),
                                    audio_pending.load(Ordering::Acquire),
                                    Instant::now(),
                                ) {
                                    fail_owned(&process, &cancelled, &video, &queue, generation);
                                    break;
                                }
                            }
                            Some(Ok(Some(s))) if s.success() => {
                                finished.store(true, Ordering::Release);
                            }
                            _ => {
                                if !cancelled.load(Ordering::Acquire) {
                                    fail_owned(&process, &cancelled, &video, &queue, generation);
                                }
                                break;
                            }
                        }
                        thread::sleep(Duration::from_millis(10));
                    }
                })
                .map_err(|_| DecoderError::Io)?;
            decoder.readers.push(handle);
        }
        Ok(decoder)
    }

    #[cfg(test)]
    pub(crate) fn readers_finished_for_test(&self) -> bool {
        !self.readers.is_empty() && self.readers.iter().all(JoinHandle::is_finished)
    }
    #[cfg(test)]
    pub(crate) fn child_running_for_test(&self) -> Result<bool, DecoderError> {
        let mut process = self.process.lock().map_err(|_| DecoderError::Io)?;
        let child = process.0.as_mut().ok_or(DecoderError::InvalidInput)?;
        child
            .try_wait()
            .map(|status| status.is_none())
            .map_err(|_| DecoderError::Io)
    }
    #[cfg(test)]
    pub(crate) fn child_exit_success_for_test(&self) -> Result<Option<bool>, DecoderError> {
        let mut process = self.process.lock().map_err(|_| DecoderError::Io)?;
        let child = process.0.as_mut().ok_or(DecoderError::InvalidInput)?;
        child
            .try_wait()
            .map(|status| status.map(|status| status.success()))
            .map_err(|_| DecoderError::Io)
    }
    #[cfg(test)]
    pub(crate) fn fail_owned_child_for_test(&self) -> Result<(), DecoderError> {
        let mut process = self.process.lock().map_err(|_| DecoderError::Io)?;
        let child = process.0.as_mut().ok_or(DecoderError::InvalidInput)?;
        if child.try_wait().map_err(|_| DecoderError::Io)?.is_some() {
            // A naturally finished child cannot qualify late-failure injection.
            return Err(DecoderError::InvalidInput);
        }
        // Act on the retained owned Child handle, never a PID lookup. Do not
        // set cancelled/finished or publish failure here: ordinary readers and
        // the global monitor must observe/refine the real subprocess failure.
        child.kill().map_err(|_| DecoderError::Io)
    }

    pub fn pid(&self) -> u32 {
        self.pid
    }

    pub fn stop(&mut self) {
        self.cancelled.store(true, Ordering::Release);
        self.audio.mark_unavailable(self.generation);
        self.process
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .stop();
        for reader in self.readers.drain(..) {
            let _ = reader.join();
        }
        #[cfg(unix)]
        {
            self.metadata_pipes.take();
        }
    }
}
impl Drop for Decoder {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sar_info(width: u32, height: u32, sar: Option<&str>) -> MediaInfo {
        let sar = sar
            .map(|value| format!("sample_aspect_ratio={value}\n"))
            .unwrap_or_default();
        metadata(format!("[STREAM]\ncodec_type=video\nwidth={width}\nheight={height}\navg_frame_rate=10/1\nr_frame_rate=10/1\n{sar}[/STREAM]\n").as_bytes()).unwrap()
    }
    #[test]
    fn duplicate_sar_cannot_hide_invalid_or_conflicting_metadata() {
        for values in [
            "sample_aspect_ratio=1:0\nsample_aspect_ratio=1:1\n",
            "sample_aspect_ratio=4:3\nsample_aspect_ratio=1:1\n",
        ] {
            let text = format!("[STREAM]\ncodec_type=video\nwidth=320\nheight=240\navg_frame_rate=10/1\nr_frame_rate=10/1\n{values}[/STREAM]\n");
            assert_eq!(metadata(text.as_bytes()), Err(DecoderError::ProbeFailed));
        }
    }
    #[test]
    fn untimed_monitor_terminal_state_requires_known_eof_and_fully_drained_fifo() {
        let queue = AudioQueue::new(1);
        queue.available(1).unwrap();
        // Before the reader proves EOF, an empty or temporarily drained FIFO
        // must retain the monitor and its direct Binding revocation checks.
        assert_eq!(queue.untimed_drain_complete(1), Ok(false));
        queue.try_push(1, &pcm(4, 960)).unwrap();
        queue.take(1, AUDIO_BLOCK);
        assert_eq!(queue.untimed_drain_complete(1), Ok(false));
        queue.try_push_final(1, &pcm(7, 144), true).unwrap();
        assert_eq!(queue.untimed_drain_complete(1), Ok(false));
        let tail = queue.take(1, AUDIO_BLOCK);
        assert_eq!(&tail[..288], &[7; 288]);
        assert_eq!(queue.untimed_drain_complete(1), Ok(true));
        let stats = queue.stats(1);
        assert_eq!(queue.take(1, AUDIO_BLOCK), vec![0; AUDIO_BLOCK]);
        assert_eq!(queue.stats(1), stats);
    }
    #[test]
    fn untimed_monitor_terminal_state_retires_replaced_or_unavailable_generation() {
        let queue = AudioQueue::new(1);
        queue.available(1).unwrap();
        queue.try_push_final(1, &pcm(6, 144), true).unwrap();
        assert_eq!(queue.untimed_drain_complete(1), Ok(false));
        queue.reset(1, 2).unwrap();
        queue.available(2).unwrap();
        queue.try_push(2, &pcm(9, 144)).unwrap();
        let before = queue.stats(2);
        assert_eq!(queue.untimed_drain_complete(1), Ok(true));
        assert_eq!(queue.untimed_drain_complete(2), Ok(false));
        assert_eq!(queue.stats(2), before);
        queue.mark_unavailable(2);
        assert_eq!(queue.untimed_drain_complete(2), Ok(true));
        assert_eq!(queue.stats(2).buffered_samples, 0);
        let empty = AudioQueue::new(3);
        assert_eq!(empty.untimed_drain_complete(3), Ok(true));
        empty.available(3).unwrap();
        assert_eq!(empty.untimed_drain_complete(3), Ok(false));
        empty.try_push_final(3, &[], true).unwrap();
        assert_eq!(empty.untimed_drain_complete(3), Ok(true));
    }

    #[test]
    fn untimed_eof_tail_backpressure_is_atomic_and_drain_is_exact() {
        let queue = AudioQueue::new(1);
        queue.available(1).unwrap();
        queue.set_selected(1, true).unwrap();
        for value in 1..=8 {
            queue.try_push(1, &pcm(value, 960)).unwrap();
        }
        let before = queue.stats(1);
        assert_eq!(
            queue.try_push_final(1, &pcm(99, 144), true),
            Err(DecoderError::Backpressure)
        );
        assert_eq!(queue.stats(1), before);
        assert!(!queue.state.lock().unwrap().untimed_eof);
        assert_eq!(queue.take(1, AUDIO_BLOCK), vec![1; AUDIO_BLOCK]);
        queue.try_push_final(1, &pcm(99, 144), true).unwrap();
        assert!(queue.state.lock().unwrap().untimed_eof);
        assert!(queue.stats(1).buffered_samples <= AUDIO_LIMIT);
        for value in 2..=8 {
            assert_eq!(queue.take(1, AUDIO_BLOCK), vec![value; AUDIO_BLOCK]);
        }
        let tail = queue.take(1, AUDIO_BLOCK);
        assert_eq!(&tail[..288], &[99; 288]);
        assert!(tail[288..].iter().all(|sample| *sample == 0));
        assert_eq!(queue.take(1, AUDIO_BLOCK), vec![0; AUDIO_BLOCK]);
        let after = queue.stats(1);
        assert_eq!(after.buffered_samples, 0);
        assert_eq!(after.selected_underflow_samples, 0);
        assert_eq!(after.underflow_missing_samples, 0);
        assert_eq!(after.dropped_old_samples, 0);
        assert_eq!(
            queue.try_push(1, &pcm(3, 1)),
            Err(DecoderError::PublicationDenied)
        );
    }
    #[test]
    fn untimed_empty_eof_stale_generation_and_immediate_clear_are_distinct() {
        let queue = AudioQueue::new(1);
        queue.available(1).unwrap();
        queue.set_selected(1, true).unwrap();
        queue.take(1, AUDIO_BLOCK);
        assert_eq!(
            queue.stats(1).selected_underflow_samples,
            AUDIO_BLOCK as u64
        );
        queue.try_push_final(1, &[], true).unwrap();
        let before = queue.stats(1);
        queue.take(1, AUDIO_BLOCK);
        assert_eq!(queue.stats(1), before);
        queue.reset(1, 2).unwrap();
        queue.available(2).unwrap();
        queue.try_push(2, &pcm(5, 144)).unwrap();
        let before = queue.stats(2);
        assert_eq!(
            queue.try_push_final(1, &[], true),
            Err(DecoderError::StaleGeneration)
        );
        assert_eq!(queue.stats(2), before);
        assert!(!queue.state.lock().unwrap().untimed_eof);
        queue.try_push_final(2, &[], true).unwrap();
        queue.mark_unavailable(2);
        assert!(!queue.has_audio(2));
        assert_eq!(queue.stats(2).buffered_samples, 0);
        assert_eq!(queue.take(2, AUDIO_BLOCK), vec![0; AUDIO_BLOCK]);
        queue.reset(2, 3).unwrap();
        assert!(!queue.state.lock().unwrap().untimed_eof);
    }
    #[test]
    fn untimed_eof_reset_drops_tail_and_final_mode_cannot_touch_timed_queue() {
        let queue = AudioQueue::new(1);
        queue.available(1).unwrap();
        queue.try_push_final(1, &pcm(6, 144), true).unwrap();
        queue.reset(1, 2).unwrap();
        assert_eq!(queue.stats(2).buffered_samples, 0);
        assert!(!queue.state.lock().unwrap().untimed_eof);
        assert_eq!(queue.take(2, AUDIO_BLOCK), vec![0; AUDIO_BLOCK]);
        let (timed, clock, _) = queue_clock(rational(0, 1));
        let before = timed.stats(1);
        assert_eq!(
            timed.try_push_final(1, &[], true),
            Err(DecoderError::InvalidInput)
        );
        assert_eq!(timed.stats(1), before);
        assert!(!timed.state.lock().unwrap().untimed_eof);
        assert!(!clock.fault.load(Ordering::Acquire));
    }
    #[test]
    fn pcm_reader_preserves_aligned_short_tail_and_rejects_malformed_tail() {
        for length in [0, 4, 576, 3840] {
            let input = vec![7; length];
            let mut reader = help_reader(input.clone(), 17);
            let mut output = [0; AUDIO_BLOCK * 2];
            let count = pcm_block(&mut reader, &mut output).unwrap();
            assert_eq!(count, length);
            assert_eq!(&output[..count], input.as_slice());
        }
        for length in [1, 2, 3, 3839] {
            let mut reader = help_reader(vec![7; length], 17);
            assert_eq!(
                pcm_block(&mut reader, &mut [0; AUDIO_BLOCK * 2])
                    .unwrap_err()
                    .kind(),
                std::io::ErrorKind::InvalidData
            );
        }
        let mut reader = help_reader(vec![7; 100], 17);
        reader.fail_at = Some(17);
        assert!(pcm_block(&mut reader, &mut [0; AUDIO_BLOCK * 2]).is_err());
        struct InterruptedOnce {
            first: bool,
            bytes: std::io::Cursor<Vec<u8>>,
        }
        impl Read for InterruptedOnce {
            fn read(&mut self, output: &mut [u8]) -> std::io::Result<usize> {
                if self.first {
                    self.first = false;
                    return Err(std::io::ErrorKind::Interrupted.into());
                }
                self.bytes.read(output)
            }
        }
        let mut reader = InterruptedOnce {
            first: true,
            bytes: std::io::Cursor::new(pcm(8, 144)),
        };
        let mut output = [0; AUDIO_BLOCK * 2];
        assert_eq!(pcm_block(&mut reader, &mut output).unwrap(), 576);
        assert_eq!(&output[..576], pcm(8, 144).as_slice());
    }
    #[test]
    fn untimed_final_push_rejects_malformed_tail_without_queue_mutation() {
        let queue = AudioQueue::new(1);
        queue.available(1).unwrap();
        queue.try_push(1, &pcm(8, 144)).unwrap();
        let before = queue.stats(1);
        for tail in [&[0u8][..], &[0, 0][..], &[0, 0, 0][..]] {
            assert_eq!(
                queue.try_push_final(1, tail, true),
                Err(DecoderError::InvalidInput)
            );
            assert_eq!(queue.stats(1), before);
            assert!(!queue.state.lock().unwrap().untimed_eof);
        }
        // The reader's malformed/error path invokes fail_owned, whose existing
        // mark_unavailable immediately removes even previously buffered samples.
        queue.mark_unavailable(1);
        assert!(!queue.has_audio(1));
        assert_eq!(queue.stats(1).buffered_samples, 0);
    }

    #[test]
    fn probe_sar_normalizes_display_content_without_changing_input_budget() {
        let buffer = FrameSpec {
            width: 320,
            height: 180,
        };
        let wide = sar_info(1440, 1080, Some("4:3"));
        assert_eq!(wide.pixel_rate(), 1440 * 1080 * 10);
        assert_eq!(
            content_rect(wide, buffer).unwrap(),
            FrameContentRect {
                x: 0,
                y: 0,
                width: 320,
                height: 180
            }
        );
        assert_eq!(
            content_rect(sar_info(720, 576, Some("16:15")), buffer).unwrap(),
            FrameContentRect {
                x: 40,
                y: 0,
                width: 240,
                height: 180
            }
        );
        assert_eq!(
            content_rect(sar_info(320, 240, Some("1:1")), buffer).unwrap(),
            FrameContentRect {
                x: 40,
                y: 0,
                width: 240,
                height: 180
            }
        );
        assert_eq!(
            content_rect(sar_info(318, 180, Some("1:1")), buffer).unwrap(),
            FrameContentRect {
                x: 1,
                y: 0,
                width: 318,
                height: 180
            }
        );
        assert_eq!(
            SampleAspectRatio::parse(Some("8:6")).unwrap(),
            SampleAspectRatio {
                numerator: 4,
                denominator: 3
            }
        );
    }
    #[test]
    fn unknown_sar_defaults_but_invalid_ratios_and_subpixel_content_fail() {
        for value in [None, Some("N/A"), Some("0:1")] {
            assert_eq!(
                sar_info(320, 240, value).sample_aspect_ratio,
                SampleAspectRatio::SQUARE
            );
        }
        for value in ["1:0", "0:2", "4/3", "-1:1", "4294967296:1", ""] {
            assert!(SampleAspectRatio::parse(Some(value)).is_err());
        }
        let mut impossible = sar_info(320, 240, None);
        impossible.sample_aspect_ratio = SampleAspectRatio {
            numerator: u32::MAX,
            denominator: 1,
        };
        assert_eq!(
            content_rect(
                impossible,
                FrameSpec {
                    width: 320,
                    height: 180
                }
            ),
            Err(DecoderError::InvalidInput)
        );
    }
    #[test]
    fn content_filter_has_explicit_rgb_padding_before_odd_offset() {
        let buffer = FrameSpec {
            width: 320,
            height: 180,
        };
        let content = content_rect(sar_info(318, 180, None), buffer).unwrap();
        assert_eq!(
            content_filter(buffer, content, 10),
            "scale=318:180,setsar=1,format=rgb24,pad=320:180:1:0:color=black,fps=10"
        );
    }
    struct ControlledHelp {
        bytes: std::io::Cursor<Vec<u8>>,
        chunk: usize,
        fail_at: Option<u64>,
    }
    impl Read for ControlledHelp {
        fn read(&mut self, output: &mut [u8]) -> std::io::Result<usize> {
            if self.fail_at.is_some_and(|at| self.bytes.position() >= at) {
                return Err(std::io::Error::other("controlled read failure"));
            }
            let limit = output.len().min(self.chunk);
            self.bytes.read(&mut output[..limit])
        }
    }
    fn help_reader(bytes: Vec<u8>, chunk: usize) -> ControlledHelp {
        ControlledHelp {
            bytes: std::io::Cursor::new(bytes),
            chunk,
            fail_at: None,
        }
    }
    #[test]
    fn stats_help_streams_beyond_one_mib_and_across_read_boundaries() {
        let mut bytes = vec![b'x'; 1_100_000];
        bytes.extend_from_slice(
            b"\n-stats_mux_pre[:stream] path\n-stats_mux_pre_fmt[:stream] format\n",
        );
        bytes.resize(1_213_717, b' ');
        assert_eq!(
            scan_stream_stats_help(help_reader(bytes, 17)),
            Ok((true, true))
        );
    }
    #[test]
    fn stats_help_requires_both_flags_and_successful_exit() {
        assert_eq!(
            scan_stream_stats_help(help_reader(b"-stats_mux_pre[:stream]".to_vec(), 1)),
            Ok((true, false))
        );
        assert_eq!(
            stream_stats_supported((true, false), true),
            Err(DecoderError::Unsupported)
        );
        assert_eq!(
            stream_stats_supported((true, true), false),
            Err(DecoderError::Unsupported)
        );
        assert_eq!(stream_stats_supported((true, true), true), Ok(()));
    }
    #[test]
    fn stats_help_read_failure_after_flags_is_not_success() {
        let mut reader = help_reader(b"-stats_mux_pre[ -stats_mux_pre_fmt[ trailing".to_vec(), 40);
        reader.fail_at = Some(40);
        assert_eq!(scan_stream_stats_help(reader), Err(DecoderError::Io));
    }
    struct RetryingHelp {
        attempts: usize,
        payload: std::io::Cursor<Vec<u8>>,
    }
    impl Read for RetryingHelp {
        fn read(&mut self, output: &mut [u8]) -> std::io::Result<usize> {
            self.attempts += 1;
            match self.attempts {
                1 => Err(std::io::ErrorKind::Interrupted.into()),
                2 => Err(std::io::ErrorKind::WouldBlock.into()),
                _ => self.payload.read(output),
            }
        }
    }
    #[test]
    fn stats_help_retries_interrupted_and_nonblocking_reads() {
        let mut reader = RetryingHelp {
            attempts: 0,
            payload: std::io::Cursor::new(b"-stats_mux_pre[ -stats_mux_pre_fmt[".to_vec()),
        };
        assert_eq!(scan_stream_stats_help(&mut reader), Ok((true, true)));
        assert!(reader.attempts >= 4);
    }
    #[test]
    fn stats_help_pending_read_observes_cancellation_and_deadline() {
        struct Pending;
        impl Read for Pending {
            fn read(&mut self, _: &mut [u8]) -> std::io::Result<usize> {
                Err(std::io::ErrorKind::WouldBlock.into())
            }
        }
        for failure in [DecoderError::PublicationDenied, DecoderError::ProbeTimeout] {
            let checks = std::cell::Cell::new(0);
            let check = || {
                let n = checks.get() + 1;
                checks.set(n);
                if n >= 3 {
                    Err(failure)
                } else {
                    Ok(())
                }
            };
            assert_eq!(scan_stream_stats_help_until(Pending, &check), Err(failure));
            assert_eq!(checks.get(), 3);
        }
    }
    #[test]
    fn stats_help_exact_limit_with_complete_flags_is_accepted() {
        let mut bytes = b"-stats_mux_pre[ -stats_mux_pre_fmt[".to_vec();
        bytes.resize(STREAM_HELP_LIMIT, b'x');
        let mut reader = help_reader(bytes, 4096);
        assert_eq!(scan_stream_stats_help(&mut reader), Ok((true, true)));
        assert_eq!(reader.bytes.position(), STREAM_HELP_LIMIT as u64);
    }
    #[test]
    fn stats_help_limit_is_finite_even_after_both_flags() {
        let mut bytes = b"-stats_mux_pre[ -stats_mux_pre_fmt[".to_vec();
        bytes.resize(STREAM_HELP_LIMIT + 128, b'x');
        let mut reader = help_reader(bytes, 4096);
        assert_eq!(
            scan_stream_stats_help(&mut reader),
            Err(DecoderError::Unsupported)
        );
        assert_eq!(reader.bytes.position(), (STREAM_HELP_LIMIT + 1) as u64);
    }

    fn rational(n: i128, d: i128) -> RationalTime {
        RationalTime::new(n, d).unwrap()
    }
    fn queue_clock(first: RationalTime) -> (AudioQueue, Arc<SourceClock>, Instant) {
        let clock = Arc::new(SourceClock::new(true));
        let wall = Instant::now();
        {
            let mut s = clock.state.lock().unwrap();
            s.origin = Some(ClockOrigin {
                pts: rational(0, 1),
                presentation: wall,
            });
            s.video = Some(rational(0, 1));
            s.audio = Some(first);
        }
        let q = AudioQueue::new(1);
        q.available(1).unwrap();
        q.timed(1, clock.clone()).unwrap();
        q.observe_first_audio(1, first).unwrap();
        (q, clock, wall)
    }
    fn pcm(value: i16, frames: usize) -> Vec<u8> {
        (0..frames * 2).flat_map(|_| value.to_le_bytes()).collect()
    }
    #[test]
    fn timed_queue_preserves_delayed_pts_and_partial_packet_tail() {
        let (q, _, wall) = queue_clock(rational(2, 5));
        q.set_selected(1, true).unwrap();
        q.push_at(1, rational(2, 5), &pcm(7, 960)).unwrap();
        q.push_at(1, rational(21, 50), &pcm(8, 144)).unwrap();
        q.push_at(1, rational(423, 1000), &pcm(9, 816)).unwrap();
        assert!(q
            .take_at(1, wall + Duration::from_millis(380))
            .iter()
            .all(|v| *v == 0));
        assert!(q
            .take_at(1, wall + Duration::from_millis(400))
            .iter()
            .all(|v| *v == 7));
        let out = q.take_at(1, wall + Duration::from_millis(420));
        assert!(out[..288].iter().all(|v| *v == 8));
        assert!(out[288..].iter().all(|v| *v == 9));
        assert_eq!(q.stats(1).selected_underflow_samples, 0);
    }
    #[test]
    fn timed_queue_reselects_at_current_pts_without_disabling_audio() {
        let (q, _, wall) = queue_clock(rational(0, 1));
        for i in 0..7 {
            q.push_at(1, rational(i, 50), &pcm(i as i16 + 1, 960))
                .unwrap();
        }
        q.set_selected(1, true).unwrap();
        assert_eq!(q.take_at(1, wall)[0], 1);
        q.set_selected(1, false).unwrap();
        q.push_at(1, rational(7, 50), &pcm(8, 960)).unwrap();
        q.push_at(1, rational(8, 50), &pcm(9, 960)).unwrap();
        q.set_selected(1, true).unwrap();
        assert!(q
            .take_at(1, wall + Duration::from_millis(100))
            .iter()
            .all(|v| *v == 6));
        assert!(q.has_audio(1));
        assert_eq!(q.stats(1).selected_underflow_samples, 0);
    }
    #[test]
    fn timed_selected_underflow_is_terminal_not_late_sample_trim() {
        let (q, _, wall) = queue_clock(rational(0, 1));
        q.set_selected(1, true).unwrap();
        q.push_at(1, rational(0, 1), &pcm(1, 960)).unwrap();
        assert_eq!(q.take_at(1, wall)[0], 1);
        assert!(q
            .take_at(1, wall + Duration::from_millis(20))
            .iter()
            .all(|v| *v == 0));
        assert!(!q.has_audio(1));
        assert_eq!(q.stats(1).selected_underflow_samples, 1920);
        assert_eq!(
            q.push_at(1, rational(1, 50), &pcm(2, 960)),
            Err(DecoderError::PublicationDenied)
        );
    }
    #[test]
    fn timed_selected_fifo_full_has_no_mutation_or_drop() {
        let (q, _, _) = queue_clock(rational(0, 1));
        q.set_selected(1, true).unwrap();
        for i in 0..8 {
            q.push_at(1, rational(i, 50), &pcm(i as i16, 960)).unwrap();
        }
        let before = q.stats(1);
        assert_eq!(
            q.push_at(1, rational(8, 50), &pcm(9, 960)),
            Err(DecoderError::Backpressure)
        );
        assert_eq!(q.stats(1), before);
        assert_eq!(before.buffered_samples, AUDIO_LIMIT);
    }
    #[test]
    fn timed_eof_preserves_tail_and_then_known_silence() {
        let (q, _, wall) = queue_clock(rational(0, 1));
        q.set_selected(1, true).unwrap();
        q.push_at(1, rational(0, 1), &pcm(4, 144)).unwrap();
        q.end_at(1);
        let out = q.take_at(1, wall);
        assert!(out[..288].iter().all(|v| *v == 4));
        assert!(out[288..].iter().all(|v| *v == 0));
        assert!(q
            .take_at(1, wall + Duration::from_millis(20))
            .iter()
            .all(|v| *v == 0));
        assert!(q.has_audio(1));
        assert_eq!(q.stats(1).selected_underflow_samples, 0);
    }
    #[test]
    fn test_pending_observer_is_generation_scoped_and_does_not_advance_clock_or_queue() {
        let (q, clock, wall) = queue_clock(rational(0, 1));
        q.push_at(1, rational(0, 1), &pcm(7, 144)).unwrap();
        let before = q.stats(1);
        let observed = q.timed_observation_for_test(1, wall).unwrap().unwrap();
        assert_eq!(observed.generation, 1);
        assert_eq!(observed.committed_frames, 144);
        assert_eq!(observed.buffered_samples, 288);
        assert_eq!(observed.target_frames, Some(0));
        assert_eq!(observed.origin_presentation, Some(wall));
        assert_eq!(observed.first_audio_due, Some(wall));
        assert_eq!(observed.pending_end_frames, None);
        assert!(observed.has_audio && !observed.fault);
        assert_eq!(q.stats(1), before);
        assert_eq!(
            q.timed_observation_for_test(2, wall),
            Err(DecoderError::StaleGeneration)
        );
        q.publish_pending_end(1, rational(144, 48000)).unwrap();
        assert_eq!(
            q.timed_observation_for_test(1, wall)
                .unwrap()
                .unwrap()
                .pending_end_frames,
            Some(144)
        );
        q.mark_unavailable(1);
        let failed = q.timed_observation_for_test(1, wall).unwrap().unwrap();
        assert!(!failed.has_audio);
        assert_eq!(failed.pending_end_frames, None);
        clock.state.lock().unwrap().origin = None;
        let undecided = q
            .timed_observation_for_test(1, wall + Duration::from_secs(60))
            .unwrap()
            .unwrap();
        assert_eq!(undecided.origin_presentation, None);
        assert_eq!(undecided.target_frames, None);
        assert!(clock.state.lock().unwrap().origin.is_none());
    }
    #[test]
    fn pending_audio_tail_preserves_real_prefix_and_rejects_late_push() {
        let (q, _, wall) = queue_clock(rational(0, 1));
        q.set_selected(1, true).unwrap();
        q.push_at(1, rational(0, 1), &pcm(4, 144)).unwrap();
        q.publish_pending_end(1, rational(144, 48000)).unwrap();
        assert_eq!(q.state.lock().unwrap().timed.as_ref().unwrap().ended, None);
        let out = q.take_at(1, wall);
        assert!(out[..288].iter().all(|v| *v == 4));
        assert!(out[288..].iter().all(|v| *v == 0));
        assert!(q
            .take_at(1, wall + Duration::from_millis(20))
            .iter()
            .all(|v| *v == 0));
        assert!(q.has_audio(1));
        assert_eq!(q.stats(1).selected_underflow_samples, 0);
        assert_eq!(
            q.push_at(1, rational(144, 48000), &pcm(5, 1)),
            Err(DecoderError::InvalidInput)
        );
        assert_eq!(
            q.publish_pending_end(1, rational(144, 48000)),
            Err(DecoderError::InvalidInput)
        );
    }
    #[test]
    fn pending_audio_frontier_requires_committed_exact_nonbackdated_samples() {
        let (q, _, _) = queue_clock(rational(0, 1));
        assert_eq!(
            q.publish_pending_end(1, rational(0, 1)),
            Err(DecoderError::InvalidInput)
        );
        q.push_at(1, rational(0, 1), &pcm(7, 144)).unwrap();
        for end in [
            rational(143, 48000),
            rational(145, 48000),
            rational(289, 96000),
        ] {
            assert_eq!(
                q.publish_pending_end(1, end),
                Err(DecoderError::InvalidInput)
            );
        }
        {
            let mut state = q.state.lock().unwrap();
            state.timed.as_mut().unwrap().pending_first = Some(PendingFirst {
                pts: rational(144, 48000),
                bytes: pcm(1, 1),
            });
        }
        assert_eq!(
            q.publish_pending_end(1, rational(144, 48000)),
            Err(DecoderError::InvalidInput)
        );
        q.state
            .lock()
            .unwrap()
            .timed
            .as_mut()
            .unwrap()
            .pending_first = None;
        q.publish_pending_end(1, rational(144, 48000)).unwrap();
    }
    #[test]
    fn pending_audio_cannot_hide_a_hole_before_frontier_or_survive_failure() {
        let (q, clock, wall) = queue_clock(rational(0, 1));
        q.set_selected(1, true).unwrap();
        q.push_at(1, rational(0, 1), &pcm(8, 144)).unwrap();
        q.publish_pending_end(1, rational(144, 48000)).unwrap();
        q.state.lock().unwrap().samples.clear();
        q.take_at(1, wall);
        assert!(clock.fault.load(Ordering::Acquire));
        assert!(!q.has_audio(1));
        assert_eq!(
            q.state.lock().unwrap().timed.as_ref().unwrap().pending_end,
            None
        );
        let (q, _, _) = queue_clock(rational(0, 1));
        q.push_at(1, rational(0, 1), &pcm(1, 144)).unwrap();
        q.publish_pending_end(1, rational(144, 48000)).unwrap();
        q.mark_unavailable(1);
        assert_eq!(
            q.state.lock().unwrap().timed.as_ref().unwrap().pending_end,
            None
        );
        assert_eq!(
            q.publish_pending_end(1, rational(144, 48000)),
            Err(DecoderError::PublicationDenied)
        );
    }
    #[test]
    fn pending_audio_publication_keeps_generation_and_source_authority_fences() {
        let (q, _, _) = queue_clock(rational(0, 1));
        q.push_at(1, rational(0, 1), &pcm(1, 144)).unwrap();
        assert_eq!(
            q.publish_pending_end(2, rational(144, 48000)),
            Err(DecoderError::StaleGeneration)
        );
        let gate = Arc::new(Gate {
            allowed: Mutex::new(false),
        });
        let revoked = Arc::new(AtomicBool::new(false));
        let binding = Binding {
            context: context(),
            expires_at: Instant::now() + Duration::from_secs(10),
            revoked: revoked.clone(),
            authority: gate.clone(),
            active: AtomicBool::new(true),
        };
        let mut publish = || q.publish_pending_end(1, rational(144, 48000));
        assert!(publish_bound(Some(&binding), &mut publish).is_err());
        assert_eq!(
            q.state.lock().unwrap().timed.as_ref().unwrap().pending_end,
            None
        );
        *gate.allowed.lock().unwrap() = true;
        revoked.store(true, Ordering::Release);
        assert_eq!(
            publish_bound(Some(&binding), &mut publish),
            Err(DecoderError::Revoked)
        );
        assert_eq!(
            q.state.lock().unwrap().timed.as_ref().unwrap().pending_end,
            None
        );
    }
    #[cfg(unix)]
    fn witness_key() -> String {
        "ottplay_witness_0123456789abcdef0123456789abcdef".into()
    }
    #[cfg(unix)]
    fn witness_record(ordinal: u64, kind: char, end: bool) -> Vec<u8> {
        format!(
            "frame:{ordinal:<4} pts:0       pts_time:0\n{}={kind}_{}\n",
            witness_key(),
            if end { "END" } else { "REAL" }
        )
        .into_bytes()
    }
    #[cfg(unix)]
    #[test]
    fn witness_records_require_contiguous_private_real_then_one_terminal() {
        let good = [witness_record(0, 'A', false), witness_record(1, 'A', true)].concat();
        let mut parser = timed_io::WitnessParser::new(witness_key(), StreamKind::Audio).unwrap();
        for byte in &good {
            parser.feed(&[*byte]).unwrap();
        }
        parser.finish().unwrap();
        assert_eq!(parser.feed(b"x"), Err(DecoderError::InvalidInput));
        for bad in [
            String::from_utf8(witness_record(0, 'A', false))
                .unwrap()
                .replacen("frame:0", "frame:+0", 1)
                .into_bytes(),
            vec![b'x'; 257],
            witness_record(0, 'A', true),
            witness_record(1, 'A', false),
            witness_record(0, 'V', false),
            String::from_utf8(witness_record(0, 'A', false))
                .unwrap()
                .replace("0123456789abcdef", "fedcba9876543210")
                .into_bytes(),
            [witness_record(0, 'A', false), witness_record(0, 'A', true)].concat(),
            [good.clone(), witness_record(1, 'A', true)].concat(),
        ] {
            let mut parser =
                timed_io::WitnessParser::new(witness_key(), StreamKind::Audio).unwrap();
            assert!(parser.feed(&bad).is_err());
        }
        for partial in [
            b"frame:0".to_vec(),
            witness_record(0, 'A', false),
            good[..good.len() - 1].to_vec(),
        ] {
            let mut parser =
                timed_io::WitnessParser::new(witness_key(), StreamKind::Audio).unwrap();
            parser.feed(&partial).unwrap();
            assert_eq!(parser.finish(), Err(DecoderError::InvalidInput));
        }
    }
    #[cfg(unix)]
    #[test]
    fn witness_interrupted_read_cannot_hide_post_terminal_bytes() {
        let pipes = timed_io::MetadataPipes::new(false).unwrap();
        let mut reader = timed_io::WitnessReader::new(
            pipes.video_witness.try_clone().unwrap(),
            witness_key(),
            StreamKind::Video,
        )
        .unwrap();
        let good = [witness_record(0, 'V', false), witness_record(1, 'V', true)].concat();
        assert!(!reader.consume_read(Ok(good.len()), &good, false).unwrap());
        assert!(!reader
            .consume_read(
                Err(std::io::Error::from(std::io::ErrorKind::Interrupted)),
                &[],
                true
            )
            .unwrap());
        assert!(!timed_io::witness_snapshot(&reader.state).unwrap().drained);
        assert_eq!(
            reader.consume_read(Ok(1), b"x", true),
            Err(DecoderError::InvalidInput)
        );
    }
    #[cfg(unix)]
    #[test]
    fn witness_owned_worker_drains_both_kinds_without_presentation_and_joins() {
        use std::io::Write;
        let pipes = timed_io::MetadataPipes::new(true).unwrap();
        let root = pipes.root_for_test();
        let mut readers = vec![
            timed_io::WitnessReader::new(
                pipes.video_witness.try_clone().unwrap(),
                witness_key(),
                StreamKind::Video,
            )
            .unwrap(),
            timed_io::WitnessReader::new(
                pipes.audio_witness.as_ref().unwrap().try_clone().unwrap(),
                witness_key(),
                StreamKind::Audio,
            )
            .unwrap(),
        ];
        let states: Vec<_> = readers.iter().map(|r| r.state.clone()).collect();
        let mut vw = std::fs::OpenOptions::new()
            .write(true)
            .open(&pipes.video_witness_path)
            .unwrap();
        let mut aw = std::fs::OpenOptions::new()
            .write(true)
            .open(&pipes.audio_witness_path)
            .unwrap();
        let done = Arc::new(AtomicBool::new(false));
        let cancel = Arc::new(AtomicBool::new(false));
        let worker = {
            let done = done.clone();
            let cancel = cancel.clone();
            thread::spawn(move || timed_io::drain_witnesses(&mut readers, &done, &cancel, None))
        };
        // All fixture writes fit one small FIFO buffer; no producer child and no
        // presentation clock runs. The independent worker must still drain END.
        let write_result = vw
            .write_all(&[witness_record(0, 'V', false), witness_record(1, 'V', true)].concat())
            .and_then(|_| {
                aw.write_all(
                    &[witness_record(0, 'A', false), witness_record(1, 'A', true)].concat(),
                )
            });
        let deadline = Instant::now() + Duration::from_secs(1);
        while Instant::now() < deadline
            && !states
                .iter()
                .all(|s| timed_io::witness_snapshot(s).is_ok_and(|s| s.end == Some(1)))
        {
            thread::sleep(Duration::from_millis(2));
        }
        let observed = states
            .iter()
            .all(|s| timed_io::witness_snapshot(s).is_ok_and(|s| s.end == Some(1) && !s.drained));
        cancel.store(true, Ordering::Release);
        let joined = worker.join();
        assert!(write_result.is_ok());
        assert!(observed);
        assert_eq!(joined.unwrap(), Err(DecoderError::Cancelled));
        drop(vw);
        drop(aw);
        drop(pipes);
        assert!(!root.exists());
    }
    #[cfg(unix)]
    #[test]
    fn pending_stats_watermark_requires_exact_mux_records_and_committed_raw_bytes() {
        use std::io::Write;
        let pipes = timed_io::MetadataPipes::new(false).unwrap();
        let witness = Arc::new(Mutex::new(timed_io::WitnessState {
            end: Some(1),
            drained: false,
            error: false,
        }));
        let mut writer = pipes.video.try_clone().unwrap();
        writer.write_all(b"V 0 0 1/10 18432\n").unwrap();
        let mut reader =
            timed_io::StatsReader::new(pipes.video.try_clone().unwrap(), 18432, StreamKind::Video)
                .unwrap();
        let done = AtomicBool::new(false);
        let cancel = AtomicBool::new(false);
        assert!(matches!(
            reader.next_pending(&done, &cancel, None, &witness).unwrap(),
            timed_io::StatsEvent::Packet(_)
        ));
        let timed_io::StatsEvent::Pending(proof) =
            reader.next_pending(&done, &cancel, None, &witness).unwrap()
        else {
            panic!("expected verified pending frontier");
        };
        assert_eq!(proof.validate(1, 18432), Ok(()));
        assert_eq!(proof.validate(0, 18432), Err(DecoderError::InvalidInput));
        assert_eq!(proof.validate(1, 18431), Err(DecoderError::InvalidInput));
        writer.write_all(b"V").unwrap();
        assert!(reader.next_pending(&done, &cancel, None, &witness).is_err());
    }
    #[test]
    fn pending_exit_watchdog_waits_for_all_selected_tracks_without_extending_limit() {
        let start = Instant::now();
        let mut since = None;
        assert!(!pending_exit_expired(&mut since, true, false, start));
        assert!(!pending_exit_expired(
            &mut since,
            true,
            false,
            start + Duration::from_secs(30)
        ));
        assert_eq!(since, None);
        assert!(!pending_exit_expired(
            &mut since,
            true,
            true,
            start + Duration::from_secs(30)
        ));
        assert!(!pending_exit_expired(
            &mut since,
            true,
            true,
            start + Duration::from_secs(34)
        ));
        assert!(pending_exit_expired(
            &mut since,
            true,
            true,
            start + Duration::from_secs(35)
        ));
        assert_eq!(since, Some(start + Duration::from_secs(30)));
    }
    #[cfg(unix)]
    fn pending_reader_fixture() -> (
        timed_io::MetadataPipes,
        timed_io::StatsReader,
        timed_io::Witness,
        timed_io::PendingWatermark,
    ) {
        use std::io::Write;
        let pipes = timed_io::MetadataPipes::new(false).unwrap();
        pipes
            .video
            .try_clone()
            .unwrap()
            .write_all(b"V 0 0 1/10 18432\n")
            .unwrap();
        let witness = Arc::new(Mutex::new(timed_io::WitnessState {
            end: Some(1),
            drained: false,
            error: false,
        }));
        let mut reader =
            timed_io::StatsReader::new(pipes.video.try_clone().unwrap(), 18432, StreamKind::Video)
                .unwrap();
        let done = AtomicBool::new(false);
        let cancel = AtomicBool::new(false);
        assert!(matches!(
            reader.next_pending(&done, &cancel, None, &witness).unwrap(),
            timed_io::StatsEvent::Packet(_)
        ));
        let timed_io::StatsEvent::Pending(proof) =
            reader.next_pending(&done, &cancel, None, &witness).unwrap()
        else {
            panic!("pending fixture");
        };
        (pipes, reader, witness, proof)
    }
    #[cfg(unix)]
    #[test]
    fn pending_tail_requires_logical_interval_global_success_and_witness_drain() {
        let (_pipes, mut stats, witness, proof) = pending_reader_fixture();
        let master = Arc::new(PresentationClock::new());
        let clock = Arc::new(SourceClock::with_presentation(false, Some(master.clone())));
        let wall = Instant::now();
        master.publish(wall).unwrap();
        clock
            .ready_at(StreamKind::Video, rational(0, 1), wall)
            .unwrap();
        let done = Arc::new(AtomicBool::new(false));
        let cancel = Arc::new(AtomicBool::new(false));
        let interval = Arc::new(AtomicBool::new(false));
        struct CancelOnDrop(Arc<AtomicBool>);
        impl Drop for CancelOnDrop {
            fn drop(&mut self) {
                self.0.store(true, Ordering::Release);
            }
        }
        let (before, held_after_interval, joined) = thread::scope(|scope| {
            let done_worker = done.clone();
            let cancel_worker = cancel.clone();
            let interval_worker = interval.clone();
            let witness_worker = witness.clone();
            let handle = scope.spawn(move || {
                timed_io::pending_tail(
                    &mut stats,
                    &mut std::io::Cursor::new(Vec::<u8>::new()),
                    &witness_worker,
                    proof,
                    &clock,
                    rational(1, 10),
                    &done_worker,
                    &cancel_worker,
                    None,
                    || {
                        interval_worker.store(true, Ordering::Release);
                        Ok(())
                    },
                )
            });
            let _cancel_guard = CancelOnDrop(cancel.clone());
            thread::sleep(Duration::from_millis(10));
            let before = !interval.load(Ordering::Acquire) && !handle.is_finished();
            master.publish(wall + Duration::from_millis(600)).unwrap();
            let deadline = Instant::now() + Duration::from_secs(1);
            while !interval.load(Ordering::Acquire) && Instant::now() < deadline {
                thread::sleep(Duration::from_millis(2));
            }
            let held_after_interval = interval.load(Ordering::Acquire) && !handle.is_finished();
            // Independent proof of global success is insufficient without the
            // bounded witness reader's final post-exit drain.
            done.store(true, Ordering::Release);
            thread::sleep(Duration::from_millis(10));
            let held_after_interval = held_after_interval && !handle.is_finished();
            witness.lock().unwrap().drained = true;
            let deadline = Instant::now() + Duration::from_secs(1);
            while !handle.is_finished() && Instant::now() < deadline {
                thread::sleep(Duration::from_millis(2));
            }
            if !handle.is_finished() {
                cancel.store(true, Ordering::Release);
            }
            (before, held_after_interval, handle.join().unwrap())
        });
        assert!(before);
        assert!(held_after_interval);
        assert_eq!(joined, Ok(()));
    }
    #[cfg(unix)]
    #[test]
    fn pending_tail_rejects_extra_raw_stats_error_cancel_and_revocation() {
        use std::io::Write;
        for case in 0..6 {
            let (pipes, mut stats, witness, proof) = pending_reader_fixture();
            let (_, clock, _) = queue_clock(rational(0, 1));
            let done = AtomicBool::new(true);
            let cancel = AtomicBool::new(case == 3);
            witness.lock().unwrap().drained = true;
            if case == 1 {
                pipes.video.try_clone().unwrap().write_all(b"V").unwrap();
            }
            if case == 2 {
                witness.lock().unwrap().error = true;
            }
            let binding = Binding {
                context: context(),
                expires_at: Instant::now() + Duration::from_secs(10),
                revoked: Arc::new(AtomicBool::new(case == 4)),
                authority: Arc::new(Gate {
                    allowed: Mutex::new(true),
                }),
                active: AtomicBool::new(true),
            };
            struct Raw {
                extra: bool,
                error: bool,
            }
            impl Read for Raw {
                fn read(&mut self, out: &mut [u8]) -> std::io::Result<usize> {
                    if self.error {
                        return Err(std::io::Error::from(std::io::ErrorKind::Other));
                    }
                    if self.extra {
                        out[0] = 1;
                        Ok(1)
                    } else {
                        Ok(0)
                    }
                }
            }
            let mut raw = Raw {
                extra: case == 0,
                error: case == 5,
            };
            let mut published = false;
            let result = timed_io::pending_tail(
                &mut stats,
                &mut raw,
                &witness,
                proof,
                &clock,
                rational(0, 1),
                &done,
                &cancel,
                Some(&binding),
                || {
                    published = true;
                    Ok(())
                },
            );
            assert_eq!(
                result,
                Err(match case {
                    3 => DecoderError::Cancelled,
                    4 => DecoderError::Revoked,
                    5 => DecoderError::Io,
                    _ => DecoderError::InvalidInput,
                })
            );
            assert!(!published);
        }
    }
    #[cfg(unix)]
    #[test]
    fn witness_file_paths_escape_both_filter_grammar_layers() {
        fn unescape(value: &str) -> String {
            let mut chars = value.chars();
            let mut result = String::new();
            while let Some(c) = chars.next() {
                result.push(if c == '\\' { chars.next().unwrap() } else { c });
            }
            result
        }
        let path = " /owned/a b/'quote':colon\\slash,[bracket];tail ";
        let escaped = timed_io::filter_file(Path::new(path)).unwrap();
        let inner = unescape(&escaped);
        assert_ne!(inner, path);
        assert!(inner.contains("\\:"));
        assert!(inner.contains("\\'"));
        assert_eq!(unescape(&inner), path);
        assert!(timed_io::filter_file(Path::new("/bad\npath")).is_err());
        use std::os::unix::ffi::OsStrExt;
        assert!(
            timed_io::filter_file(Path::new(std::ffi::OsStr::from_bytes(b"/bad\xff"))).is_err()
        );
    }
    #[cfg(unix)]
    #[test]
    fn witness_graphs_keep_private_sentinels_out_of_payload_branches() {
        let pipes = timed_io::MetadataPipes::new(true).unwrap();
        let config = stream_config();
        let content = FrameContentRect::full(config.frame_spec);
        let (video, audio) = timed_io::witness_graphs(&config, content, &pipes, true).unwrap();
        let audio = audio.unwrap();
        assert!(video.starts_with(&format!(
            "[0:v:0]{},format=pix_fmts=rgb24,split=2[vout][vr];",
            content_filter(config.frame_spec, content, config.fps)
        )));
        assert!(audio.starts_with("[0:a:0]aformat=sample_fmts=s16:sample_rates=48000:channel_layouts=stereo,asplit=2[aout][ar];"));
        assert_eq!(video.matches("trim=end_frame=1").count(), 1);
        assert_eq!(audio.matches("atrim=end_sample=1").count(), 1);
        assert!(video.contains("[vr]metadata=mode=delete,metadata=mode=add:"));
        assert!(audio.contains("[ar]ametadata=mode=delete,ametadata=mode=add:"));
        assert!(video.ends_with(":direct=1,nullsink"));
        assert!(audio.ends_with(":direct=1,anullsink"));
        assert!(!video.contains("[0:a:"));
        assert!(!audio.contains("[0:v:"));
        assert!(timed_io::witness_graphs(&config, content, &pipes, false)
            .unwrap()
            .1
            .is_none());
    }
    #[test]
    fn clock_bounded_first_track_window_allows_future_audio_not_backdated() {
        let clock = SourceClock::new(true);
        clock.ready(StreamKind::Video, rational(0, 1)).unwrap();
        {
            let mut state = clock.state.lock().unwrap();
            let first = Instant::now() - Duration::from_millis(600);
            state.first_ready = Some(first);
            state.first_presentation = Some(first);
        }
        let origin = clock.origin().unwrap();
        assert_eq!(origin.pts, rational(0, 1));
        clock.ready(StreamKind::Audio, rational(2, 1)).unwrap();
        assert_eq!(clock.origin().unwrap().pts, rational(0, 1));
        let late = SourceClock::new(true);
        late.ready(StreamKind::Video, rational(0, 1)).unwrap();
        {
            let mut state = late.state.lock().unwrap();
            let first = Instant::now() - Duration::from_millis(600);
            state.first_ready = Some(first);
            state.first_presentation = Some(first);
        }
        late.origin().unwrap();
        assert_eq!(
            late.ready(StreamKind::Audio, rational(0, 1)),
            Err(DecoderError::Stalled)
        );
    }
    #[test]
    fn unknown_first_audio_is_counted_separately_and_cancel_wait_is_bounded() {
        let (q, clock, wall) = queue_clock(rational(0, 1));
        q.state.lock().unwrap().timed.as_mut().unwrap().first = None;
        clock.state.lock().unwrap().audio = None;
        q.take_at(1, wall);
        assert_eq!(q.stats(1).unresolved_timing_samples, 1920);
        assert_eq!(q.stats(1).selected_underflow_samples, 0);
        let cancel = AtomicBool::new(true);
        assert_eq!(
            clock.wait(
                rational(1, 1),
                Duration::ZERO,
                &cancel,
                None,
                Instant::now()
            ),
            Err(DecoderError::Cancelled)
        );
    }
    #[cfg(unix)]
    #[test]
    fn actual_owned_metadata_fifo_eof_and_malformed_record_fail_closed() {
        use std::io::Write;
        let pipes = timed_io::MetadataPipes::new(true).unwrap();
        let root = pipes.root_for_test();
        let mut writer = pipes.video.try_clone().unwrap();
        writer.write_all(b"V 0 0 1/10 18432\n").unwrap();
        let mut reader =
            timed_io::StatsReader::new(pipes.video.try_clone().unwrap(), 18432, StreamKind::Video)
                .unwrap();
        let done = AtomicBool::new(true);
        let cancel = AtomicBool::new(false);
        assert_eq!(
            reader
                .next(&done, &cancel, None)
                .unwrap()
                .unwrap()
                .byte_size,
            18432
        );
        assert!(reader.next(&done, &cancel, None).unwrap().is_none());
        writer.write_all(b"V 2 1 1/10 18432\n").unwrap();
        assert!(reader.next(&done, &cancel, None).is_err());
        drop(reader);
        drop(writer);
        drop(pipes);
        assert!(!root.exists());
    }
    #[test]
    fn first_track_at_exact_clock_deadline_is_not_backdated() {
        let wall = Instant::now();
        let origin = ClockOrigin {
            pts: rational(7, 1),
            presentation: wall,
        };
        assert_eq!(
            SourceClock::accept_first(origin, rational(9, 1), wall + Duration::from_secs(2)),
            Ok(())
        );
        assert_eq!(
            SourceClock::accept_first(
                origin,
                rational(9, 1),
                wall + Duration::from_secs(2) + Duration::from_nanos(1)
            ),
            Err(DecoderError::Stalled)
        );
    }
    #[test]
    fn timed_eof_drain_clock_fault_is_distinct_from_valid_eos() {
        let (q, clock, wall) = queue_clock(rational(0, 1));
        q.set_selected(1, true).unwrap();
        q.push_at(1, rational(0, 1), &pcm(3, 960)).unwrap();
        q.end_at(1);
        q.take_at(1, wall);
        q.take_at(1, wall + Duration::from_millis(20));
        assert!(!clock.fault.load(Ordering::Acquire));
        let (q, clock, wall) = queue_clock(rational(0, 1));
        q.set_selected(1, true).unwrap();
        q.push_at(1, rational(0, 1), &pcm(3, 960)).unwrap();
        q.end_at(1);
        q.take_at(1, wall);
        q.take_at(1, wall + Duration::from_millis(40));
        assert!(clock.fault.load(Ordering::Acquire));
    }
    #[test]
    fn idempotent_selected_reassertion_does_not_reseed_cursor() {
        let (q, clock, wall) = queue_clock(rational(0, 1));
        q.set_selected(1, true).unwrap();
        q.push_at(1, rational(0, 1), &pcm(1, 960)).unwrap();
        q.push_at(1, rational(1, 50), &pcm(2, 960)).unwrap();
        q.take_at(1, wall);
        q.set_selected(1, true).unwrap();
        assert_eq!(q.take_at(1, wall + Duration::from_millis(20))[0], 2);
        assert!(!clock.fault.load(Ordering::Acquire));
        q.set_selected(1, true).unwrap();
        q.take_at(1, wall + Duration::from_millis(60));
        assert!(clock.fault.load(Ordering::Acquire));
    }
    #[test]
    fn selected_from_birth_first_payload_late_is_not_initial_retirement() {
        let (q, clock, wall) = queue_clock(rational(0, 1));
        q.set_selected(1, true).unwrap();
        assert!(q
            .take_at(1, wall - Duration::from_millis(20))
            .iter()
            .all(|v| *v == 0));
        assert_eq!(q.stats(1).unresolved_timing_samples, 0);
        q.take_at(1, wall);
        assert_eq!(q.stats(1).selected_underflow_samples, 1920);
        assert!(clock.fault.load(Ordering::Acquire));
        for i in 0..8 {
            assert_eq!(
                q.push_at(1, rational(i, 50), &pcm(i as i16, 960)),
                Err(DecoderError::PublicationDenied)
            );
        }
        assert_eq!(q.stats(1).dropped_old_samples, 0);
    }
    #[test]
    fn known_future_first_pts_is_leading_silence_before_first_payload() {
        let (q, clock, wall) = queue_clock(rational(2, 5));
        q.set_selected(1, true).unwrap();
        for i in 0..20 {
            assert!(q
                .take_at(1, wall + Duration::from_millis(i * 20))
                .iter()
                .all(|v| *v == 0));
        }
        assert_eq!(q.stats(1).unresolved_timing_samples, 0);
        assert_eq!(q.stats(1).selected_underflow_samples, 0);
        assert!(!clock.fault.load(Ordering::Acquire));
        q.push_at(1, rational(2, 5), &pcm(5, 960)).unwrap();
        assert!(q
            .take_at(1, wall + Duration::from_millis(400))
            .iter()
            .all(|v| *v == 5));
    }
    #[test]
    fn inactive_wall_lead_counterexample_exact_898_samples() {
        let (q, _, wall) = queue_clock(rational(0, 1));
        let total = 115536usize;
        for offset in (0..total).step_by(960) {
            let count = (total - offset).min(960);
            q.push_at(1, rational(offset as i128, 48000), &pcm(7, count))
                .unwrap();
        }
        assert_eq!(q.stats(1).pushed_samples, 231072);
        assert_eq!(q.stats(1).dropped_old_samples, 215712);
        assert_eq!(q.stats(1).buffered_samples, 15360);
        q.set_selected(1, true).unwrap();
        q.take_at(1, wall + Duration::from_nanos(2_237_645_834));
        assert_eq!(
            q.stats(1).selected_underflow_samples,
            898,
            "wall admission reproduces the preserved initial handoff hole"
        );
    }
    fn master_queue(
        first: Option<RationalTime>,
    ) -> (
        AudioQueue,
        Arc<SourceClock>,
        Arc<PresentationClock>,
        Instant,
    ) {
        let master = Arc::new(PresentationClock::new());
        let base = Instant::now() - Duration::from_secs(3);
        master.publish(base).unwrap();
        let clock = Arc::new(SourceClock::with_presentation(true, Some(master.clone())));
        {
            let mut s = clock.state.lock().unwrap();
            s.origin = Some(ClockOrigin {
                pts: rational(0, 1),
                presentation: base,
            });
            s.video = Some(rational(0, 1));
            s.audio = first;
        }
        let q = AudioQueue::new(1);
        q.available(1).unwrap();
        q.timed(1, clock.clone()).unwrap();
        if let Some(first) = first {
            q.observe_first_audio(1, first).unwrap();
        }
        (q, clock, master, base)
    }
    #[test]
    fn master_wait_holds_original_whole_sequence_then_releases() {
        let (q, clock, master, base) = master_queue(Some(rational(0, 1)));
        let target = base + Duration::from_nanos(2_237_645_834);
        // This helper deliberately uses an older host reference. The failure's
        // minimum wall lead is modeled explicitly, not measured from host-now.
        let synthetic_wall = base + Duration::from_nanos(2_267_000_000);
        assert_eq!(
            synthetic_wall.duration_since(target),
            Duration::from_nanos(29_354_166)
        );
        let actual_host_lag = Instant::now().saturating_duration_since(target);
        assert!(actual_host_lag >= Duration::from_millis(700));
        master.publish(target).unwrap();
        let cancel = AtomicBool::new(false);
        let (blocked_tx, blocked_rx) = std::sync::mpsc::sync_channel(1);
        let (released_tx, released_rx) = std::sync::mpsc::sync_channel(1);
        thread::scope(|scope| {
            let producer = scope.spawn(|| -> Result<(), DecoderError> {
                let deadline = Instant::now() + Duration::from_secs(2);
                // Exactly the RED sequence: whole20ms chunks plus its336-frame
                // final tail, total115536. No chunk is shortened to the lead.
                for offset in (0..115536usize).step_by(960) {
                    let count = (115536 - offset).min(960);
                    if offset == 113280 {
                        blocked_tx.send(()).unwrap();
                    }
                    clock.wait_before(
                        rational((offset + count) as i128, 48000),
                        Duration::from_millis(140),
                        &cancel,
                        None,
                        Instant::now(),
                        deadline,
                    )?;
                    q.push_at(1, rational(offset as i128, 48000), &pcm(7, count))?;
                    if offset == 113280 {
                        released_tx.send(count).unwrap();
                    }
                }
                Ok(())
            });
            blocked_rx.recv_timeout(Duration::from_secs(1)).unwrap();
            let before = q.stats(1);
            assert_eq!(before.pushed_samples, 226560);
            assert_eq!(before.buffered_samples, 15360);
            thread::sleep(Duration::from_millis(20));
            assert_eq!(q.stats(1), before);
            assert!(released_rx.try_recv().is_err());
            q.set_selected(1, true).unwrap();
            assert!(q.take_at(1, target).iter().all(|v| *v == 7));
            assert_eq!(q.stats(1).selected_underflow_samples, 0);
            master.publish(target + Duration::from_millis(20)).unwrap();
            assert_eq!(
                released_rx.recv_timeout(Duration::from_secs(1)).unwrap(),
                960
            );
            master.publish(target + Duration::from_millis(40)).unwrap();
            producer.join().unwrap().unwrap();
        });
        assert_eq!(q.stats(1).pushed_samples, 231072);
        assert_eq!(q.stats(1).selected_underflow_samples, 0);
        assert!(!clock.fault.load(Ordering::Acquire));
    }
    #[test]
    fn shared_clock_anchors_to_first_presentation_not_physical_arrival() {
        let master = Arc::new(PresentationClock::new());
        let tick = Instant::now() - Duration::from_secs(2);
        master.publish(tick).unwrap();
        let clock = SourceClock::with_presentation(true, Some(master));
        clock
            .ready_at(StreamKind::Video, rational(-1, 4), tick)
            .unwrap();
        clock
            .ready_at(
                StreamKind::Audio,
                rational(3, 20),
                tick + Duration::from_millis(20),
            )
            .unwrap();
        let origin = clock.origin().unwrap();
        assert_eq!(origin.pts, rational(-1, 4));
        assert_eq!(origin.presentation, tick + Duration::from_millis(500));
        assert_eq!(clock.state.lock().unwrap().first_presentation, Some(tick));
    }
    #[test]
    fn atomic_first_chunk_wins_before_consumer_without_false_hole() {
        let (q, clock, _, base) = master_queue(None);
        q.set_selected(1, true).unwrap();
        assert!(q
            .begin_audio(1, rational(1, 200), &pcm(11, 960), base)
            .unwrap());
        let out = q.take_at(1, base);
        assert!(out[..480].iter().all(|v| *v == 0));
        assert!(out[480..].iter().all(|v| *v == 11));
        assert_eq!(q.stats(1).selected_underflow_samples, 0);
        assert!(!clock.fault.load(Ordering::Acquire));
    }
    #[test]
    fn unknown_old_route_reserves_entire_block_even_when_not_selected() {
        let (q, clock, _, base) = master_queue(None);
        assert!(!q.stats(1).selected);
        q.take_at(1, base);
        assert_eq!(
            q.begin_audio(1, rational(1, 200), &pcm(11, 960), base),
            Err(DecoderError::InvalidInput)
        );
        assert!(clock.fault.load(Ordering::Acquire));
        assert_eq!(q.stats(1).pushed_samples, 0);
    }
    #[test]
    fn unresolved_straddling_origin_is_rejected_but_exact_end_allowed() {
        let (q, clock, _, base) = master_queue(None);
        clock
            .state
            .lock()
            .unwrap()
            .origin
            .as_mut()
            .unwrap()
            .presentation = base + Duration::from_millis(10);
        q.take_at(1, base);
        assert_eq!(
            q.begin_audio(1, rational(0, 1), &pcm(4, 960), base),
            Err(DecoderError::InvalidInput)
        );
        assert!(clock.fault.load(Ordering::Acquire));
        let (q, clock, master, base) = master_queue(None);
        clock
            .state
            .lock()
            .unwrap()
            .origin
            .as_mut()
            .unwrap()
            .presentation = base + Duration::from_millis(20);
        q.take_at(1, base);
        assert!(q
            .begin_audio(1, rational(0, 1), &pcm(4, 960), base)
            .unwrap());
        master.publish(base + Duration::from_millis(20)).unwrap();
        assert!(q
            .take_at(1, base + Duration::from_millis(20))
            .iter()
            .all(|v| *v == 4));
        assert!(!clock.fault.load(Ordering::Acquire));
    }
    #[test]
    fn unknown_origin_commit_cannot_relabel_already_rendered_audio() {
        let (q, clock, _, base) = master_queue(Some(rational(0, 1)));
        clock.state.lock().unwrap().origin = None;
        q.take_at(1, base);
        clock.state.lock().unwrap().origin = Some(ClockOrigin {
            pts: rational(0, 1),
            presentation: base + Duration::from_millis(10),
        });
        q.take_at(1, base + Duration::from_millis(20));
        assert!(clock.fault.load(Ordering::Acquire));
        assert!(!q.has_audio(1));
    }
    #[test]
    fn future_first_audio_remains_pending_until_master_end_lead_allows() {
        let (q, clock, master, base) = master_queue(None);
        q.set_selected(1, true).unwrap();
        assert!(!q
            .begin_audio(1, rational(2, 5), &pcm(3, 960), base)
            .unwrap());
        assert_eq!(q.stats(1).buffered_samples, 0);
        for i in 0..=20 {
            let tick = base + Duration::from_millis(i * 20);
            master.publish(tick).unwrap();
            if i == 14 {
                assert!(clock
                    .permitted_at(rational(21, 50), Duration::from_millis(140), tick)
                    .unwrap());
                assert!(q.promote_first(1, tick).unwrap());
            }
            let out = q.take_at(1, tick);
            assert!(out.iter().all(|v| *v == if i < 20 { 0 } else { 3 }));
        }
        assert_eq!(q.stats(1).selected_underflow_samples, 0);
        assert_eq!(q.stats(1).unresolved_timing_samples, 0);
    }
    #[test]
    fn late_first_check_uses_master_and_preserves_negative_pts_offset() {
        let (q, clock, _, base) = master_queue(None);
        assert!(q
            .begin_audio(1, rational(1, 10), &pcm(8, 960), base)
            .unwrap());
        assert!(!clock.fault.load(Ordering::Acquire));
        let (q, clock, master, base) = master_queue(Some(rational(-3, 20)));
        {
            let mut s = clock.state.lock().unwrap();
            s.origin = Some(ClockOrigin {
                pts: rational(-1, 4),
                presentation: base,
            });
            s.video = Some(rational(-1, 4));
        }
        q.set_selected(1, true).unwrap();
        q.push_at(1, rational(-3, 20), &pcm(8, 960)).unwrap();
        for i in 0..=5 {
            let tick = base + Duration::from_millis(i * 20);
            master.publish(tick).unwrap();
            assert!(q
                .take_at(1, tick)
                .iter()
                .all(|v| *v == if i < 5 { 0 } else { 8 }));
        }
        assert!(!clock.fault.load(Ordering::Acquire));
    }
    #[test]
    fn missing_or_frozen_master_has_real_deadline_and_cancel() {
        let master = Arc::new(PresentationClock::new());
        let clock = SourceClock::with_presentation(false, Some(master.clone()));
        let cancel = AtomicBool::new(false);
        let expired = Instant::now() - Duration::from_nanos(1);
        assert_eq!(
            clock.presentation_before(&cancel, None, expired),
            Err(DecoderError::Stalled)
        );
        let tick = Instant::now() - Duration::from_secs(3);
        master.publish(tick).unwrap();
        clock
            .ready_at(StreamKind::Video, rational(0, 1), tick)
            .unwrap();
        assert_eq!(
            clock.wait_before(
                rational(0, 1),
                Duration::ZERO,
                &cancel,
                None,
                Instant::now(),
                expired
            ),
            Err(DecoderError::Stalled)
        );
        cancel.store(true, Ordering::Release);
        assert_eq!(
            clock.wait_before(
                rational(0, 1),
                Duration::ZERO,
                &cancel,
                None,
                Instant::now(),
                expired
            ),
            Err(DecoderError::Cancelled)
        );
        cancel.store(false, Ordering::Release);
        master.publish(tick + Duration::from_millis(500)).unwrap();
        assert_eq!(
            clock.wait_before(
                rational(0, 1),
                Duration::ZERO,
                &cancel,
                None,
                Instant::now(),
                expired
            ),
            Ok(())
        );
    }
    #[test]
    fn shared_clock_eof_tail_and_final_video_interval_use_logical_ticks() {
        let (q, clock, master, base) = master_queue(Some(rational(0, 1)));
        q.set_selected(1, true).unwrap();
        q.push_at(1, rational(0, 1), &pcm(6, 144)).unwrap();
        q.end_at(1);
        let out = q.take_at(1, base);
        assert!(out[..288].iter().all(|v| *v == 6));
        assert!(out[288..].iter().all(|v| *v == 0));
        master.publish(base + Duration::from_millis(20)).unwrap();
        assert!(q
            .take_at(1, base + Duration::from_millis(20))
            .iter()
            .all(|v| *v == 0));
        let expired = Instant::now() - Duration::from_nanos(1);
        assert_eq!(
            clock.wait_before(
                rational(1, 10),
                Duration::ZERO,
                &AtomicBool::new(false),
                None,
                Instant::now(),
                expired
            ),
            Err(DecoderError::Stalled)
        );
        master.publish(base + Duration::from_millis(100)).unwrap();
        assert_eq!(
            clock.wait_before(
                rational(1, 10),
                Duration::ZERO,
                &AtomicBool::new(false),
                None,
                Instant::now(),
                expired
            ),
            Ok(())
        );
        assert_eq!(q.stats(1).selected_underflow_samples, 0);
        assert!(!clock.fault.load(Ordering::Acquire));
    }
    #[test]
    fn owner_flag_transition_before_route_does_not_change_shared_clock() {
        let (q, clock, master, base) = master_queue(Some(rational(0, 1)));
        let target = base + Duration::from_secs(2);
        master.publish(target).unwrap();
        let end = 102720usize;
        for offset in (0..end).step_by(960) {
            let count = (end - offset).min(960);
            q.push_at(1, rational(offset as i128, 48000), &pcm(2, count))
                .unwrap();
        }
        q.set_selected(1, true).unwrap();
        q.set_selected(1, false).unwrap();
        assert!(q.take_at(1, target).iter().all(|v| *v == 2));
        assert_eq!(master.current().unwrap(), Some(target));
        q.set_selected(1, true).unwrap();
        let next = target + Duration::from_millis(20);
        master.publish(next).unwrap();
        assert!(q.take_at(1, next).iter().all(|v| *v == 2));
        q.set_selected(1, true).unwrap();
        let next = next + Duration::from_millis(20);
        master.publish(next).unwrap();
        assert!(q.take_at(1, next).iter().all(|v| *v == 2));
        assert!(!clock.fault.load(Ordering::Acquire));
    }
    fn unanchored_audio_first() -> (
        AudioQueue,
        Arc<SourceClock>,
        Arc<PresentationClock>,
        Instant,
    ) {
        let master = Arc::new(PresentationClock::new());
        let base = Instant::now() - Duration::from_secs(3);
        master.publish(base).unwrap();
        let clock = Arc::new(SourceClock::with_presentation(true, Some(master.clone())));
        let q = AudioQueue::new(1);
        q.available(1).unwrap();
        q.timed(1, clock.clone()).unwrap();
        (q, clock, master, base)
    }
    #[test]
    fn audio_first_video_two_seconds_late_promotes_at_logical_fallback_boundary() {
        let (q, clock, master, base) = unanchored_audio_first();
        q.set_selected(1, true).unwrap();
        let bytes = pcm(13, 960);
        let pointer = bytes.as_ptr();
        assert!(!q.begin_audio_owned(1, rational(0, 1), bytes, base).unwrap());
        {
            let s = q.state.lock().unwrap();
            let pending = s.timed.as_ref().unwrap().pending_first.as_ref().unwrap();
            assert_eq!(pending.bytes.as_ptr(), pointer);
            assert_eq!(pending.bytes.len(), 3840);
            assert!(s.samples.is_empty());
        }
        for i in 0..25 {
            let tick = base + Duration::from_millis(i * 20);
            master.publish(tick).unwrap();
            assert!(q.take_at(1, tick).iter().all(|v| *v == 0));
        }
        assert!(
            clock.state.lock().unwrap().first_ready.unwrap().elapsed() < Duration::from_millis(500)
        );
        let boundary = base + Duration::from_millis(500);
        master.publish(boundary).unwrap();
        assert!(q.take_at(1, boundary).iter().all(|v| *v == 13));
        assert!(q
            .state
            .lock()
            .unwrap()
            .timed
            .as_ref()
            .unwrap()
            .pending_first
            .is_none());
        assert_eq!(q.stats(1).selected_underflow_samples, 0);
        let origin = clock.origin().unwrap();
        assert_eq!(origin.presentation, boundary);
        master.publish(base + Duration::from_secs(2)).unwrap();
        clock
            .ready_at(
                StreamKind::Video,
                rational(2, 1),
                base + Duration::from_secs(2),
            )
            .unwrap();
        assert_eq!(clock.origin().unwrap().presentation, boundary);
        assert_eq!(
            clock
                .due_at(rational(2, 1), base + Duration::from_secs(2))
                .unwrap(),
            Some(base + Duration::from_millis(2500))
        );
    }
    #[test]
    fn real_discovery_cap_and_muted_reader_promote_the_same_owned_chunk() {
        let (q, clock, master, base) = unanchored_audio_first();
        assert!(!q
            .begin_audio_owned(1, rational(0, 1), pcm(9, 960), base)
            .unwrap());
        clock.state.lock().unwrap().first_ready = Some(Instant::now() - Duration::from_millis(600));
        assert!(!q.promote_first(1, base).unwrap());
        assert_eq!(
            clock.origin().unwrap().presentation,
            base + Duration::from_millis(500)
        );
        assert_eq!(q.stats(1).buffered_samples, 0);
        assert!(!q.stats(1).selected);
        master.publish(base + Duration::from_millis(380)).unwrap();
        assert!(q
            .promote_first(1, base + Duration::from_millis(380))
            .unwrap());
        assert!(q
            .state
            .lock()
            .unwrap()
            .timed
            .as_ref()
            .unwrap()
            .pending_first
            .is_none());
        assert_eq!(q.stats(1).buffered_samples, 1920);
        q.set_selected(1, true).unwrap();
        master.publish(base + Duration::from_millis(500)).unwrap();
        assert!(q
            .take_at(1, base + Duration::from_millis(500))
            .iter()
            .all(|v| *v == 9));
        assert_eq!(q.stats(1).selected_underflow_samples, 0);
    }
    #[test]
    fn video_first_audio_two_seconds_late_keeps_offset_and_muted_promotion() {
        let (q, clock, master, base) = unanchored_audio_first();
        clock
            .ready_at(StreamKind::Video, rational(0, 1), base)
            .unwrap();
        for i in 0..=100 {
            let tick = base + Duration::from_millis(i * 20);
            master.publish(tick).unwrap();
            q.take_at(1, tick);
        }
        assert!(!q
            .begin_audio_owned(
                1,
                rational(2, 1),
                pcm(5, 960),
                base + Duration::from_secs(2)
            )
            .unwrap());
        assert_eq!(
            clock.origin().unwrap().presentation,
            base + Duration::from_millis(500)
        );
        assert_eq!(q.stats(1).buffered_samples, 0);
        master.publish(base + Duration::from_millis(2380)).unwrap();
        assert!(q
            .promote_first(1, base + Duration::from_millis(2380))
            .unwrap());
        q.set_selected(1, true).unwrap();
        master.publish(base + Duration::from_millis(2500)).unwrap();
        assert!(q
            .take_at(1, base + Duration::from_millis(2500))
            .iter()
            .all(|v| *v == 5));
        assert_eq!(q.stats(1).selected_underflow_samples, 0);
    }
    #[test]
    fn pending_ownership_is_released_by_reset_unavailable_and_fault() {
        let (q, _, _, base) = unanchored_audio_first();
        q.begin_audio_owned(1, rational(0, 1), pcm(3, 960), base)
            .unwrap();
        q.mark_unavailable(1);
        assert!(q
            .state
            .lock()
            .unwrap()
            .timed
            .as_ref()
            .unwrap()
            .pending_first
            .is_none());
        let (q, _, _, base) = unanchored_audio_first();
        q.begin_audio_owned(1, rational(0, 1), pcm(3, 960), base)
            .unwrap();
        q.reset(1, 2).unwrap();
        assert!(q.state.lock().unwrap().timed.is_none());
        assert_eq!(q.promote_first(1, base), Err(DecoderError::StaleGeneration));
        let (q, clock, master, base) = master_queue(None);
        q.begin_audio_owned(1, rational(2, 1), pcm(3, 960), base)
            .unwrap();
        q.set_selected(1, true).unwrap();
        q.take_at(1, base);
        master.publish(base + Duration::from_millis(40)).unwrap();
        q.take_at(1, base + Duration::from_millis(40));
        assert!(clock.fault.load(Ordering::Acquire));
        assert!(q
            .state
            .lock()
            .unwrap()
            .timed
            .as_ref()
            .unwrap()
            .pending_first
            .is_none());
    }
    #[test]
    fn standalone_origin_uses_real_arrival_and_real_only_fallback() {
        let clock = SourceClock::new(true);
        let artificial = Instant::now() - Duration::from_secs(2);
        clock
            .ready_at(StreamKind::Audio, rational(0, 1), artificial)
            .unwrap();
        let first = clock.state.lock().unwrap().first_ready.unwrap();
        assert!(clock
            .origin_at(Some(first + Duration::from_secs(2)))
            .is_none());
        {
            let mut s = clock.state.lock().unwrap();
            s.first_ready = Some(first - Duration::from_millis(600));
            s.first_presentation = Some(artificial);
        }
        assert_eq!(
            clock.origin().unwrap().presentation,
            first - Duration::from_millis(100)
        );
    }
    fn push(queue: &AudioQueue, generation: u64, bytes: &[u8]) {
        for block in bytes.chunks(AUDIO_BLOCK * 2) {
            queue.try_push(generation, block).unwrap();
        }
    }

    struct Scratch(PathBuf);
    impl Scratch {
        fn new() -> Self {
            static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let root = std::env::temp_dir().join(format!(
                "multiview-grant-{}-{nonce}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            std::fs::create_dir(&root).unwrap();
            std::fs::write(root.join("source.bin"), b"original").unwrap();
            Self(root)
        }
        fn file(&self) -> File {
            File::open(self.0.join("source.bin")).unwrap()
        }
    }
    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn descriptor_custody_survives_path_replacement_and_claim_is_one_shot() {
        let scratch = Scratch::new();
        let source = GrantedFile::from_root(&scratch.0, Path::new("source.bin")).unwrap();
        std::fs::rename(scratch.0.join("source.bin"), scratch.0.join("old.bin")).unwrap();
        std::fs::write(scratch.0.join("source.bin"), b"replacement").unwrap();
        for _ in 0..2 {
            source
                .while_unclaimed(|mut file| {
                    let mut bytes = [0; 8];
                    file.read_exact(&mut bytes).unwrap();
                    assert_eq!(&bytes, b"original");
                    Ok(())
                })
                .unwrap();
        }
        let mut file = source.claim().unwrap();
        let mut prefix = [0; 2];
        file.read_exact(&mut prefix).unwrap();
        assert_eq!(&prefix, b"or");
        assert_eq!(
            source.while_unclaimed(|_| Ok(())),
            Err(DecoderError::StaleGeneration)
        );
        assert!(matches!(source.claim(), Err(DecoderError::StaleGeneration)));
        assert_eq!(format!("{source:?}"), "GrantedFile { .. }");
        assert!(matches!(
            GrantedFile::from_root(&scratch.0, Path::new("../source.bin")),
            Err(DecoderError::InvalidInput)
        ));
    }

    struct Gate {
        allowed: Mutex<bool>,
    }
    impl PublicationAuthority for Gate {
        fn attach(
            &self,
            context: &BoundContext,
            operation: &mut dyn FnMut() -> Result<(), DecoderError>,
        ) -> Result<(), DecoderError> {
            self.publish(context, operation)
        }

        fn publish(
            &self,
            _: &BoundContext,
            operation: &mut dyn FnMut() -> Result<(), DecoderError>,
        ) -> Result<(), DecoderError> {
            let allowed = self.allowed.lock().unwrap();
            if !*allowed {
                return Err(DecoderError::PublicationDenied);
            }
            operation()
        }
    }
    fn context() -> BoundContext {
        BoundContext {
            runtime: 1,
            slot_id: 2,
            source_revision: 3,
            geometry_revision: 4,
            focus_revision: 5,
            audio_revision: 6,
        }
    }

    #[cfg(unix)]
    fn socket_file() -> File {
        use std::os::{fd::OwnedFd, unix::net::UnixStream};
        let (reader, writer) = UnixStream::pair().unwrap();
        drop(writer);
        File::from(OwnedFd::from(reader))
    }

    #[cfg(unix)]
    fn stream_grant(revoked: Arc<AtomicBool>) -> GrantedStream {
        GrantedStream::from_authorized_stream(
            context(),
            Instant::now() + Duration::from_secs(60),
            revoked,
            Arc::new(Gate {
                allowed: Mutex::new(true),
            }),
        )
        .unwrap()
    }

    #[cfg(unix)]
    fn stream_config() -> DecoderConfig {
        DecoderConfig {
            ffmpeg: PathBuf::from("/not-an-executable/ffmpeg"),
            ffprobe: PathBuf::from("/not-an-executable/ffprobe"),
            frame_spec: FrameSpec {
                width: 320,
                height: 180,
            },
            fps: 10,
        }
    }

    #[cfg(unix)]
    fn sealed_stream_fixture(source: &GrantedStream, config: &DecoderConfig) -> PreparedStreamInfo {
        // Private unit fixture only: production proofs are minted by FFprobe.
        let mut state = source.identity.0.lock().unwrap();
        state.probe_issued = true;
        state.probe_completed = true;
        PreparedStreamInfo {
            information: MediaInfo {
                width: 320,
                height: 180,
                fps: 10.0,
                has_audio: false,
                sample_aspect_ratio: SampleAspectRatio::SQUARE,
            },
            identity: source.identity.clone(),
            ffmpeg: config.ffmpeg.clone(),
            _ffprobe: config.ffprobe.clone(),
            configured_ffmpeg: config.ffmpeg.clone(),
            configured_ffprobe: config.ffprobe.clone(),
            frame_spec: config.frame_spec,
            fps: config.fps,
        }
    }

    #[cfg(unix)]
    #[test]
    fn stream_preflight_rejects_cross_grant_config_reuse_and_revocation_without_effects() {
        let revoked = Arc::new(AtomicBool::new(false));
        let source = stream_grant(revoked.clone());
        let other = stream_grant(Arc::new(AtomicBool::new(false)));
        let config = stream_config();
        let proof = sealed_stream_fixture(&source, &config);
        let other_proof = sealed_stream_fixture(&other, &config);
        let input = source.wrap_decode(socket_file()).unwrap();
        let other_input = other.wrap_decode(socket_file()).unwrap();
        assert_eq!(
            validate_stream_preparation(&config, &source, &proof, &other_input),
            Err(DecoderError::BindingMismatch)
        );
        assert_eq!(
            validate_stream_preparation(&config, &source, &other_proof, &input),
            Err(DecoderError::BindingMismatch)
        );
        let mut changed = stream_config();
        changed.fps = 11;
        assert_eq!(
            validate_stream_preparation(&changed, &source, &proof, &input),
            Err(DecoderError::InvalidInput)
        );
        changed = stream_config();
        changed.ffprobe = PathBuf::from("/a-different-tool");
        assert_eq!(
            validate_stream_preparation(&changed, &source, &proof, &input),
            Err(DecoderError::InvalidInput)
        );
        assert_eq!(
            validate_stream_preparation(&config, &source, &proof, &input),
            Ok(())
        );
        assert!(matches!(
            source.wrap_decode(socket_file()),
            Err(DecoderError::StaleGeneration)
        ));
        revoked.store(true, Ordering::Release);
        assert_eq!(
            validate_stream_preparation(&config, &source, &proof, &input),
            Err(DecoderError::Revoked)
        );
        assert!(!source.identity.0.lock().unwrap().started);
    }

    #[cfg(unix)]
    #[test]
    fn stream_probe_cancel_and_deadline_do_not_spawn_tools_or_complete_the_proof() {
        for cancelled in [true, false] {
            let source = stream_grant(Arc::new(AtomicBool::new(false)));
            let input = source.wrap_probe(socket_file()).unwrap();
            assert!(matches!(
                source.wrap_probe(socket_file()),
                Err(DecoderError::StaleGeneration)
            ));
            let deadline = if cancelled {
                Instant::now() + Duration::from_secs(1)
            } else {
                Instant::now()
            };
            let result = probe_stream(
                &stream_config(),
                &source,
                input,
                &AtomicBool::new(cancelled),
                deadline,
            );
            assert_eq!(
                result.unwrap_err(),
                if cancelled {
                    DecoderError::Cancelled
                } else {
                    DecoderError::ProbeTimeout
                }
            );
            assert!(!source.identity.0.lock().unwrap().probe_completed);
            assert!(matches!(
                source.wrap_decode(socket_file()),
                Err(DecoderError::StaleGeneration)
            ));
        }
    }

    #[cfg(unix)]
    #[test]
    fn stream_start_rejects_arbitrary_decode_generation_before_claim_or_spawn() {
        let source = stream_grant(Arc::new(AtomicBool::new(false)));
        let config = stream_config();
        let proof = sealed_stream_fixture(&source, &config);
        let input = source.wrap_decode(socket_file()).unwrap();
        let generation = context().source_revision + 2;
        let result = Decoder::start_stream(
            &config,
            &source,
            proof,
            input,
            generation,
            Arc::new(LatestFrame::new(config.frame_spec, generation).unwrap()),
            Arc::new(AudioQueue::new(generation)),
        );
        assert!(matches!(result, Err(DecoderError::StaleGeneration)));
        assert!(!source.identity.0.lock().unwrap().started);
    }

    #[test]
    fn binding_revocation_expiry_and_atomic_authority_deny_without_publication() {
        let scratch = Scratch::new();
        let gate = Arc::new(Gate {
            allowed: Mutex::new(true),
        });
        let revoked = Arc::new(AtomicBool::new(false));
        let source = GrantedFile::from_authorized_file(
            scratch.file(),
            context(),
            Instant::now() + Duration::from_secs(60),
            revoked.clone(),
            gate.clone(),
        )
        .unwrap();
        let mut count = 0;
        source
            .attach(&context(), &mut || {
                count += 1;
                Ok(())
            })
            .unwrap();
        assert_eq!(count, 1);
        let mut other = context();
        other.audio_revision += 1;
        assert_eq!(
            source.attach(&other, &mut || {
                count += 1;
                Ok(())
            }),
            Err(DecoderError::BindingMismatch)
        );
        *gate.allowed.lock().unwrap() = false;
        assert_eq!(
            source.attach(&context(), &mut || {
                count += 1;
                Ok(())
            }),
            Err(DecoderError::PublicationDenied)
        );
        *gate.allowed.lock().unwrap() = true;
        revoked.store(true, Ordering::Release);
        assert_eq!(
            source.attach(&context(), &mut || {
                count += 1;
                Ok(())
            }),
            Err(DecoderError::Revoked)
        );
        assert_eq!(count, 1);
        assert!(matches!(
            GrantedFile::from_authorized_file(
                scratch.file(),
                context(),
                Instant::now(),
                Arc::new(AtomicBool::new(false)),
                gate
            ),
            Err(DecoderError::Expired)
        ));
        let fixture = GrantedFile::from_root(&scratch.0, Path::new("source.bin")).unwrap();
        assert_eq!(
            fixture.check_binding(&context()),
            Err(DecoderError::BindingMismatch)
        );
    }

    #[test]
    fn revocation_inside_the_authority_barrier_prevents_the_operation() {
        struct Revoke(Arc<AtomicBool>);
        impl PublicationAuthority for Revoke {
            fn attach(
                &self,
                context: &BoundContext,
                operation: &mut dyn FnMut() -> Result<(), DecoderError>,
            ) -> Result<(), DecoderError> {
                self.publish(context, operation)
            }
            fn publish(
                &self,
                _: &BoundContext,
                operation: &mut dyn FnMut() -> Result<(), DecoderError>,
            ) -> Result<(), DecoderError> {
                self.0.store(true, Ordering::Release);
                operation()
            }
        }
        let scratch = Scratch::new();
        let revoked = Arc::new(AtomicBool::new(false));
        let source = GrantedFile::from_authorized_file(
            scratch.file(),
            context(),
            Instant::now() + Duration::from_secs(60),
            revoked.clone(),
            Arc::new(Revoke(revoked)),
        )
        .unwrap();
        let mut called = false;
        assert_eq!(
            source.attach(&context(), &mut || {
                called = true;
                Ok(())
            }),
            Err(DecoderError::Revoked)
        );
        assert!(!called);
    }

    #[test]
    fn protocol_gate_requires_input_fd_not_a_substring_or_output_only() {
        assert!(check_fd_protocol(
            b"Supported file protocols:\nInput:\nfile\nfd\nOutput:\npipe\n"
        ));
        assert!(!check_fd_protocol(b"Input:\nfile\nOutput:\nfd\n"));
        assert!(!check_fd_protocol(b"Input:\nsome-fd-extension\n"));
    }

    #[test]
    fn frame_authority_cannot_activate_a_pending_grant() {
        let scratch = Scratch::new();
        let source = GrantedFile::from_authorized_file(
            scratch.file(),
            context(),
            Instant::now() + Duration::from_secs(60),
            Arc::new(AtomicBool::new(false)),
            Arc::new(Gate {
                allowed: Mutex::new(true),
            }),
        )
        .unwrap();
        let mut count = 0;
        assert_eq!(
            publish_bound(source.binding.as_deref(), &mut || {
                count += 1;
                Ok(())
            }),
            Err(DecoderError::PublicationDenied)
        );
        assert_eq!(count, 0);
        source.attach(&context(), &mut || Ok(())).unwrap();
        publish_bound(source.binding.as_deref(), &mut || {
            count += 1;
            Ok(())
        })
        .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn attach_and_active_publication_dispatch_to_distinct_atomic_owner_operations() {
        use std::sync::atomic::AtomicUsize;
        struct SplitGate {
            active: Mutex<bool>,
            attach_calls: AtomicUsize,
            publish_calls: AtomicUsize,
        }
        impl PublicationAuthority for SplitGate {
            fn attach(
                &self,
                expected: &BoundContext,
                operation: &mut dyn FnMut() -> Result<(), DecoderError>,
            ) -> Result<(), DecoderError> {
                let mut active = self.active.lock().unwrap();
                if expected != &context() || *active {
                    return Err(DecoderError::PublicationDenied);
                }
                self.attach_calls.fetch_add(1, Ordering::Relaxed);
                operation()?;
                *active = true;
                Ok(())
            }
            fn publish(
                &self,
                expected: &BoundContext,
                operation: &mut dyn FnMut() -> Result<(), DecoderError>,
            ) -> Result<(), DecoderError> {
                let active = self.active.lock().unwrap();
                if expected != &context() || !*active {
                    return Err(DecoderError::PublicationDenied);
                }
                self.publish_calls.fetch_add(1, Ordering::Relaxed);
                operation()
            }
        }
        let scratch = Scratch::new();
        let gate = Arc::new(SplitGate {
            active: Mutex::new(false),
            attach_calls: AtomicUsize::new(0),
            publish_calls: AtomicUsize::new(0),
        });
        let revoked = Arc::new(AtomicBool::new(false));
        let source = GrantedFile::from_authorized_file(
            scratch.file(),
            context(),
            Instant::now() + Duration::from_secs(60),
            revoked.clone(),
            gate.clone(),
        )
        .unwrap();
        let mut operations = 0;
        assert_eq!(
            publish_bound(source.binding.as_deref(), &mut || {
                operations += 1;
                Ok(())
            }),
            Err(DecoderError::PublicationDenied)
        );
        let mut wrong = context();
        wrong.focus_revision += 1;
        assert_eq!(
            source.attach(&wrong, &mut || {
                operations += 1;
                Ok(())
            }),
            Err(DecoderError::BindingMismatch)
        );
        assert_eq!(gate.attach_calls.load(Ordering::Relaxed), 0);
        assert_eq!(gate.publish_calls.load(Ordering::Relaxed), 0);
        assert_eq!(operations, 0);
        source
            .attach(&context(), &mut || {
                operations += 1;
                Ok(())
            })
            .unwrap();
        assert!(*gate.active.lock().unwrap());
        assert_eq!(gate.attach_calls.load(Ordering::Relaxed), 1);
        assert_eq!(gate.publish_calls.load(Ordering::Relaxed), 0);
        publish_bound(source.binding.as_deref(), &mut || {
            operations += 1;
            Ok(())
        })
        .unwrap();
        assert_eq!(gate.publish_calls.load(Ordering::Relaxed), 1);
        revoked.store(true, Ordering::Release);
        assert_eq!(
            source.attach(&context(), &mut || {
                operations += 1;
                Ok(())
            }),
            Err(DecoderError::Revoked)
        );
        assert_eq!(
            publish_bound(source.binding.as_deref(), &mut || {
                operations += 1;
                Ok(())
            }),
            Err(DecoderError::Revoked)
        );
        assert_eq!(operations, 2);
        assert_eq!(gate.attach_calls.load(Ordering::Relaxed), 1);
        assert_eq!(gate.publish_calls.load(Ordering::Relaxed), 1);
    }

    #[test]
    fn audio_stats_separate_inactive_overflow_and_selected_underflow() {
        let queue = AudioQueue::new(1);
        queue.available(1).unwrap();
        let bytes = vec![0u8; (AUDIO_LIMIT + 2) * 2];
        push(&queue, 1, &bytes);
        assert_eq!(queue.stats(1).dropped_old_samples, 2);
        assert_eq!(queue.stats(1).selected_dropped_samples, 0);
        let buffered = queue.stats(1).buffered_samples;
        queue.set_selected(1, true).unwrap();
        assert_eq!(queue.stats(1).buffered_samples, buffered);
        assert_eq!(
            queue.try_push(1, &[0, 0, 0, 0]),
            Err(DecoderError::Backpressure)
        );
        assert_eq!(queue.stats(1).selected_dropped_samples, 0);
        for _ in 0..8 {
            queue.take(1, AUDIO_BLOCK);
        }
        queue.take(1, 2);
        assert_eq!(queue.stats(1).selected_underflow_samples, 2);
        queue.reset(1, 2).unwrap();
        assert_eq!(queue.stats(2), AudioQueueStats::default());
        queue.take(2, 2);
        assert_eq!(queue.stats(2).underflow_missing_samples, 0);
    }

    #[test]
    fn audio_generations_do_not_leak_or_clear_the_replacement() {
        let queue = AudioQueue::new(5);
        queue.available(5).unwrap();
        push(&queue, 5, &[1, 0, 2, 0]);
        queue.reset(5, 6).unwrap();
        assert!(!queue.has_audio(6));
        assert_eq!(queue.reset(5, 7), Err(DecoderError::StaleGeneration));
        assert_eq!(queue.reset(6, 6), Err(DecoderError::StaleGeneration));
        queue.available(6).unwrap();
        push(&queue, 6, &[7, 0, 8, 0]);
        assert_eq!(
            queue.try_push(5, &[99, 0]),
            Err(DecoderError::StaleGeneration)
        );
        queue.mark_unavailable(5);
        assert!(queue.has_audio(6));
        assert_eq!(queue.take(5, 2), [0, 0]);
        assert_eq!(queue.take(6, 4), [7, 8, 0, 0]);
        assert_eq!(queue.take(6, usize::MAX).len(), AUDIO_BLOCK);
    }

    #[test]
    fn audio_ring_drops_old_samples_with_a_fixed_upper_bound() {
        let queue = AudioQueue::new(1);
        queue.available(1).unwrap();
        let bytes: Vec<_> = (0..AUDIO_LIMIT + 4)
            .flat_map(|at| (at as i16).to_le_bytes())
            .collect();
        push(&queue, 1, &bytes);
        assert_eq!(queue.state.lock().unwrap().samples.len(), AUDIO_LIMIT);
        assert_eq!(queue.take(1, 2), [4, 5]);
        queue.mark_unavailable(1);
        assert_eq!(queue.take(1, 2), [0, 0]);
        assert_eq!(queue.state.lock().unwrap().samples.len(), 0);
    }

    #[test]
    fn selected_full_queue_retries_whole_blocks_without_drops_or_reordering() {
        let queue = AudioQueue::new(1);
        queue.available(1).unwrap();
        queue.set_selected(1, true).unwrap();
        let original: Vec<_> = (0..AUDIO_LIMIT)
            .flat_map(|sample| (sample as i16).to_le_bytes())
            .collect();
        push(&queue, 1, &original);
        let pending: Vec<_> = (AUDIO_LIMIT..AUDIO_LIMIT + AUDIO_BLOCK)
            .flat_map(|sample| (sample as i16).to_le_bytes())
            .collect();
        let before = queue.stats(1);
        assert_eq!(queue.try_push(1, &pending), Err(DecoderError::Backpressure));
        assert_eq!(queue.stats(1), before);
        assert_eq!(
            queue.take(1, AUDIO_BLOCK),
            (0..AUDIO_BLOCK)
                .map(|sample| sample as i16)
                .collect::<Vec<_>>()
        );
        queue.try_push(1, &pending).unwrap();
        let mut remaining = Vec::new();
        for _ in 0..8 {
            remaining.extend(queue.take(1, AUDIO_BLOCK));
        }
        assert_eq!(
            remaining,
            (AUDIO_BLOCK..AUDIO_LIMIT + AUDIO_BLOCK)
                .map(|sample| sample as i16)
                .collect::<Vec<_>>()
        );
        assert_eq!(queue.stats(1).dropped_old_samples, 0);
        assert_eq!(queue.stats(1).selected_dropped_samples, 0);
        assert_eq!(queue.stats(1).selected_underflow_samples, 0);
    }

    #[test]
    fn actual_probe_metadata_rejects_unknown_and_excessive_video_cost() {
        let document = |width, height, avg: &str, nominal: &str| {
            format!("[STREAM]\ncodec_type=video\nwidth={width}\nheight={height}\navg_frame_rate={avg}\nr_frame_rate={nominal}\n[/STREAM]\n[STREAM]\ncodec_type=audio\n[/STREAM]\n")
        };
        let info = metadata(document(320, 180, "10/1", "10/1").as_bytes()).unwrap();
        assert_eq!(info.pixel_rate(), 576_000);
        assert!(info.has_audio);
        for invalid in [
            document(1921, 1080, "30/1", "30/1"),
            document(1920, 1081, "30/1", "30/1"),
            document(320, 180, "0/0", "30/1"),
            document(320, 180, "30/1", "31/1"),
        ] {
            assert_eq!(
                metadata(invalid.as_bytes()),
                Err(DecoderError::InvalidInput)
            );
        }
        assert_eq!(
            metadata(b"[STREAM]\ncodec_type=audio\n[/STREAM]\n"),
            Err(DecoderError::ProbeFailed)
        );
        assert_eq!(
            MediaInfo {
                width: 2,
                height: 2,
                fps: 0.1,
                has_audio: false,
                sample_aspect_ratio: SampleAspectRatio::SQUARE,
            }
            .pixel_rate(),
            1
        );
        assert_eq!(
            MediaInfo {
                width: 2,
                height: 2,
                fps: f64::NAN,
                has_audio: false,
                sample_aspect_ratio: SampleAspectRatio::SQUARE,
            }
            .pixel_rate(),
            u64::MAX
        );
    }
}
