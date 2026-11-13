//! Independently owned file/descriptor decoders. No network resolution or fetches.
//!
//! Each source advances its video and audio together; selecting another audio
//! queue does not start a new decoder or reset the output encoder's sample clock.
use super::frames::{FrameSpec, LatestFrame};
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

struct AudioState {
    generation: u64,
    has_audio: bool,
    samples: VecDeque<i16>,
    stats: AudioQueueStats,
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
                samples: VecDeque::with_capacity(AUDIO_LIMIT),
                stats: AudioQueueStats::default(),
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
        state.samples.clear();
        state.stats = AudioQueueStats::default();
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
            let missing = output.len().saturating_sub(state.samples.len()) as u64;
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
                state.samples.clear();
            }
        }
    }

    fn available(&self, generation: u64) -> Result<(), DecoderError> {
        let mut state = self.state.lock().map_err(|_| DecoderError::Io)?;
        if state.generation != generation {
            return Err(DecoderError::StaleGeneration);
        }
        state.has_audio = true;
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

    fn try_push(&self, generation: u64, bytes: &[u8]) -> Result<(), DecoderError> {
        let count = bytes.len() / 2;
        if bytes.len() % 2 != 0 || count > AUDIO_BLOCK {
            return Err(DecoderError::InvalidInput);
        }
        let mut state = self.state.lock().map_err(|_| DecoderError::Io)?;
        if state.generation != generation {
            return Err(DecoderError::StaleGeneration);
        }
        if !state.has_audio {
            return Err(DecoderError::PublicationDenied);
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
        Ok(())
    }
}

fn publish_audio(
    binding: Option<&Binding>,
    queue: &AudioQueue,
    generation: u64,
    bytes: &[u8],
    cancelled: &AtomicBool,
    began: Instant,
) -> Result<(), DecoderError> {
    let mut full_since = None;
    loop {
        if cancelled.load(Ordering::Acquire) {
            return Err(DecoderError::PublicationDenied);
        }
        wait_active(binding, cancelled, began)?;
        let mut operation = || queue.try_push(generation, bytes);
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

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MediaInfo {
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub has_audio: bool,
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
    let (mut kind, mut width, mut height, mut avg, mut nominal) = ("", None, None, None, None);
    for line in text.lines() {
        match line {
            "[STREAM]" => {
                if in_stream || streams >= 32 {
                    return Err(DecoderError::ProbeFailed);
                }
                in_stream = true;
                streams += 1;
                (kind, width, height, avg, nominal) = ("", None, None, None, None);
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
                    "stream=codec_type,width,height,avg_frame_rate,r_frame_rate",
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
                "stream=codec_type,width,height,avg_frame_rate,r_frame_rate",
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
    ) -> Result<Self, DecoderError> {
        let frame_bytes = checked_frame_bytes(config)?;
        let spec = &config.frame_spec;
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
        command.args(["-fd", "0", "-i", "fd:"])
            .args(["-map", "0:v:0", "-an", "-vf"])
            .arg(format!("scale={}:{}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad={}:{}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps={}", spec.width,spec.height,spec.width,spec.height,config.fps))
            .args(["-threads", "1", "-c:v", "rawvideo", "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1"]);
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
                                    .publish(
                                        generation,
                                        sequence,
                                        std::mem::take(&mut bytes),
                                        Instant::now(),
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
                        match block(&mut stderr, &mut bytes) {
                            Ok(true) => {
                                if publish_audio(
                                    binding.as_deref(),
                                    &queue,
                                    generation,
                                    &bytes,
                                    &cancelled,
                                    began,
                                )
                                .is_err()
                                {
                                    if !cancelled.load(Ordering::Acquire) {
                                        fail_owned(
                                            &process,
                                            &cancelled,
                                            &video_audio,
                                            &queue,
                                            generation,
                                        );
                                    }
                                    break;
                                }
                            }
                            _ => break,
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
                        Some(Ok(Some(status))) if status.success() => break,
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
                has_audio: false
            }
            .pixel_rate(),
            1
        );
        assert_eq!(
            MediaInfo {
                width: 2,
                height: 2,
                fps: f64::NAN,
                has_audio: false
            }
            .pixel_rate(),
            u64::MAX
        );
    }
}
