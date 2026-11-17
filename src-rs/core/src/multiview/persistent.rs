//! Persistent local-source compositor. No network listener or provider selection.
//! Sources are independently decoded; raster geometry is imported from its owner.
//! Public broker/RPC admission remains a separate, unwired authorization gate.
use super::{
    decoder::{
        self, AudioQueue, AudioQueueStats, BoundContext, Decoder, DecoderConfig, DecoderError,
        GrantedFile, GrantedStream, PreparedStreamInfo, PresentationClock, StreamInput,
    },
    encoder::{
        CaptureFence, CaptureVideoFeed, Encoder, EncoderConfig, EncoderSnapshot, EncoderState,
    },
    frames::{compose_into, FrameSpec, FrameStatus, FrameView, LatestFrame},
    geometry::{CanvasSpec, ValidatedGeometry},
};
use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

#[derive(Clone)]
pub struct Config {
    pub ffmpeg: PathBuf,
    pub ffprobe: PathBuf,
    pub mkfifo: PathBuf,
    pub output_root: PathBuf,
    pub frame_spec: FrameSpec,
    pub startup_timeout: Duration,
    pub stale_after: Duration,
    pub max_duration: Duration,
    pub idle_timeout: Duration,
    pub max_disk_bytes: u64,
    /// Rust pixel/PCM buffers only, not thread stacks or FFmpeg process RSS.
    pub frame_memory_budget: u64,
    /// Actual input width * height * source FPS, before downscaling.
    pub max_input_pixel_rate: u64,
    /// True for an eventual broker host. False is explicit fixture custody only.
    pub require_broker_grants: bool,
}
impl Config {
    pub fn new(ffmpeg: PathBuf, ffprobe: PathBuf, output_root: PathBuf) -> Self {
        Self {
            ffmpeg,
            ffprobe,
            mkfifo: PathBuf::from("/usr/bin/mkfifo"),
            output_root,
            frame_spec: FrameSpec {
                width: 320,
                height: 180,
            },
            startup_timeout: Duration::from_secs(10),
            stale_after: Duration::from_secs(2),
            max_duration: Duration::from_secs(120),
            idle_timeout: Duration::from_secs(60),
            max_disk_bytes: 128 * 1024 * 1024,
            frame_memory_budget: 16 * 1024 * 1024,
            max_input_pixel_rate: 64_000_000,
            require_broker_grants: false,
        }
    }

    fn validate_output_timeouts(&self) -> Result<(), Error> {
        if self.startup_timeout.is_zero()
            || self.stale_after.is_zero()
            || self.startup_timeout > self.max_duration
            || self.stale_after > self.max_duration
        {
            return Err(Error::InvalidConfig);
        }
        Ok(())
    }

    fn encoder_config_at(
        &self,
        canvas: CanvasSpec,
        absolute_end: Instant,
        now: Instant,
    ) -> Result<EncoderConfig, Error> {
        self.validate_output_timeouts()?;
        let remaining = absolute_end
            .checked_duration_since(now)
            .filter(|remaining| !remaining.is_zero())
            .ok_or(Error::Stopped)?;
        // Setup and output rotation consume the same immutable session lease.
        // They may shorten encoder deadlines, never extend the session end.
        Ok(EncoderConfig {
            ffmpeg: self.ffmpeg.clone(),
            mkfifo: self.mkfifo.clone(),
            output_root: self.output_root.clone(),
            canvas,
            startup_timeout: self.startup_timeout.min(remaining),
            stall_timeout: self.stale_after.min(remaining),
            max_duration: remaining,
            idle_timeout: self.idle_timeout,
            max_disk_bytes: self.max_disk_bytes,
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Error {
    InvalidConfig,
    InvalidSlot,
    StaleRevision,
    CapacityExceeded,
    SourceFailed,
    NoAudio,
    OutputFailed,
    Stopped,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AudioPolicy {
    FollowsFocus,
    Muted,
    Slot(u8),
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SlotState {
    Empty,
    Starting,
    Playing,
    Stalled,
    Ended,
    Failed,
    Stopped,
}
#[derive(Clone, Debug)]
pub struct SlotSnapshot {
    pub slot_id: u8,
    pub source_revision: u64,
    pub decoder_pid: Option<u32>,
    pub frames: u64,
    pub state: SlotState,
    /// Interleaved i16 sample counters, reset per source generation.
    pub audio: AudioQueueStats,
}
#[derive(Clone, Debug)]
pub struct Snapshot {
    pub runtime: u64,
    pub geometry_revision: u64,
    pub focus_revision: u64,
    pub audio_revision: u64,
    pub focus_slot: u8,
    pub audio_policy: AudioPolicy,
    pub audio_slot: Option<u8>,
    pub encoder_pid: u32,
    pub output_generation: u64,
    pub output_frames: u64,
    pub output_state: EncoderState,
    pub hls_sequence: Option<u64>,
    pub hls_last_update_millis: u64,
    /// Interleaved i16 stereo samples completely written to the encoder.
    pub audio_samples_written: u64,
    pub video_frames_written: u64,
    pub slots: Vec<SlotSnapshot>,
    pub monotonic_millis: u64,
    /// Legacy callback miss counter. Audio no longer reads the control mutex.
    pub audio_callback_misses: u64,
}
#[derive(Clone, Debug)]
pub struct OutputEpochReceipt {
    pub runtime_id: u64,
    pub retired_generation: u64,
    pub new_generation: u64,
    pub old_output_removed: bool,
}
#[derive(Clone, Debug)]
pub struct ShutdownReceipt {
    pub owned_pids: Vec<u32>,
    pub output_removed: bool,
}

/// Owned preparation intent: capture while holding the host control barrier,
/// then release it before any slow producer acquisition or media probe. This is
/// not a source grant and cannot retarget a prepared source to the current focus.
pub struct StreamPreparation {
    binding: BoundContext,
    config: DecoderConfig,
    stop: Arc<AtomicBool>,
}
impl std::fmt::Debug for StreamPreparation {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("StreamPreparation { .. }")
    }
}
impl StreamPreparation {
    pub fn bound_context(&self) -> BoundContext {
        self.binding
    }
    pub fn decoder_config(&self) -> &DecoderConfig {
        &self.config
    }
    pub fn stop_token(&self) -> &AtomicBool {
        &self.stop
    }
    fn belongs_to(&self, stop: &Arc<AtomicBool>) -> bool {
        Arc::ptr_eq(&self.stop, stop)
    }
}

/// Conservative concurrent pixel/PCM storage, deliberately separate from RSS.
pub fn required_frame_buffer_bytes(frame: FrameSpec, canvas: CanvasSpec) -> Result<u64, Error> {
    if frame.width == 0
        || frame.height == 0
        || frame.width > 640
        || frame.height > 360
        || canvas.width == 0
        || canvas.height == 0
        || canvas.width > 1920
        || canvas.height > 1080
    {
        return Err(Error::InvalidConfig);
    }
    let slot = u64::from(frame.width) * u64::from(frame.height) * 3;
    let output = u64::from(canvas.width) * u64::from(canvas.height) * 3;
    slot.checked_mul(36)
        .and_then(|slots| {
            output
                .checked_mul(6)
                .and_then(|outputs| slots.checked_add(outputs))
        })
        .and_then(|pixels| pixels.checked_add(1024 * 1024))
        .ok_or(Error::InvalidConfig)
}

struct Slot {
    generation: u64,
    pid: Option<u32>,
    pixel_rate: u64,
    stopped: bool,
    video: Arc<LatestFrame>,
    audio: Arc<AudioQueue>,
}
// Freeze source mailboxes first. The wall stamp describes this immutable
// observation, never source PTS and never the later completion of composition.
fn freeze_frames(
    slots: &[Slot],
    visible: usize,
    stale_after: Duration,
) -> (Vec<(u8, FrameView)>, Instant) {
    let now = Instant::now();
    let frames = slots
        .iter()
        .enumerate()
        .take(visible)
        .map(|(slot, source)| (slot as u8, source.video.snapshot(now, stale_after)))
        .collect();
    (frames, Instant::now())
}

// Keep the same absolute tick deadline while making each sleep request bounded
// and interruptible by stop. This does not bound an OS scheduler's oversleep.
fn wait_compositor_deadline(
    stop: &AtomicBool,
    deadline: Instant,
    mut now: impl FnMut() -> Instant,
    mut sleep: impl FnMut(Duration),
) {
    while !stop.load(Ordering::Acquire) {
        let current = now();
        if current >= deadline {
            return;
        }
        sleep((deadline - current).min(Duration::from_millis(5)));
    }
}

struct State {
    geometry: ValidatedGeometry,
    // Reject a composed tick captured before a visual mutation.
    control_epoch: u64,
    focus_revision: u64,
    audio_revision: u64,
    focus: u8,
    audio_policy: AudioPolicy,
    slots: Vec<Slot>,
    audio_route: Arc<AtomicU64>,
    capture_video: Option<Arc<CaptureVideoFeed>>,
    output_bootstrap: bool,
}
impl State {
    fn bootstrap_sources_empty(&self) -> bool {
        self.control_epoch == 0
            && self.slots.iter().all(|source| {
                source.generation == 0
                    && source.pid.is_none()
                    && source.pixel_rate == 0
                    && !source.stopped
                    && source.video.sequence() == 0
                    && !source.audio.has_audio(0)
            })
    }
    fn capture_fence(&self) -> CaptureFence {
        let mut source_revisions = [0; 9];
        for (revision, source) in source_revisions.iter_mut().zip(&self.slots) {
            *revision = source.generation;
        }
        let stopped_mask = self
            .slots
            .iter()
            .enumerate()
            .fold(0u16, |mask, (slot, source)| {
                mask | if source.stopped { 1u16 << slot } else { 0 }
            });
        CaptureFence {
            control_epoch: self.control_epoch,
            visual_revision: self.geometry.revision(),
            stopped_mask,
            visible_mask: (1u16 << self.geometry.rects().len()) - 1,
            source_revisions,
        }
    }
    // The fresh encoder primes from a distinct black-only output feed. Source
    // state and decoder bindings remain intact and are never relabelled empty.
    fn output_fence(&self) -> CaptureFence {
        let mut fence = self.capture_fence();
        if self.output_bootstrap {
            fence.source_revisions = [0; 9];
            fence.stopped_mask = 0;
        }
        fence
    }
    fn suspend_output_audio(&self) {
        self.audio_route.store(0, Ordering::Release);
        for source in &self.slots {
            let _ = source.audio.set_selected(source.generation, false);
        }
    }
    fn activate_output(&mut self) -> Result<(), Error> {
        self.output_bootstrap = false;
        self.advance_control()?;
        self.update_audio_metrics();
        Ok(())
    }
    fn publish_capture(
        &self,
        pixels: Arc<[u8]>,
        captured_fence: CaptureFence,
        captured_at: Instant,
    ) -> Result<bool, Error> {
        if !self.output_fence().accepts_capture(captured_fence) {
            return Ok(false);
        }
        self.capture_video
            .as_ref()
            .ok_or(Error::OutputFailed)?
            .publish(pixels, captured_fence, captured_at)
            .map_err(|_| Error::OutputFailed)
    }
    // State remains locked through capture-fence publication. Visual/source
    // changes fence old reuse; focus/audio-only epochs remain video-compatible.
    fn advance_control(&mut self) -> Result<(), Error> {
        self.control_epoch = self
            .control_epoch
            .checked_add(1)
            .ok_or(Error::StaleRevision)?;
        self.capture_video
            .as_ref()
            .ok_or(Error::OutputFailed)?
            .invalidate(self.output_fence(), Instant::now())
            .map_err(|_| Error::OutputFailed)
    }

    fn audio_slot(&self) -> Option<u8> {
        let slot = match self.audio_policy {
            AudioPolicy::Muted => return None,
            AudioPolicy::FollowsFocus => self.focus,
            AudioPolicy::Slot(slot) => slot,
        };
        if usize::from(slot) >= self.geometry.rects().len() {
            return None;
        }
        // This is the configured owner, not an assertion of audible samples.
        // Missing/ended audio is rendered as silence by its bounded queue.
        Some(slot)
    }
    fn update_audio_metrics(&self) {
        let selected = if self.output_bootstrap {
            None
        } else {
            self.audio_slot()
        };
        for (slot, source) in self.slots.iter().enumerate() {
            let _ = source
                .audio
                .set_selected(source.generation, selected == Some(slot as u8));
        }
        let word = selected
            .map(|slot| {
                // Generation is bounded before any source mutation. One atomic word
                // prevents a callback observing a new slot with an old generation.
                ((self.slots[usize::from(slot)].generation + 1) << 4) | (u64::from(slot) + 1)
            })
            .unwrap_or(0);
        self.audio_route.store(word, Ordering::Release);
    }
}
fn lock<T>(value: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    value.lock().unwrap_or_else(|poison| poison.into_inner())
}
// Worker destruction can wait for a reader holding publication authority.
// Never retain this collection lock while stopping, joining or dropping one.
fn take_worker<T>(workers: &Mutex<Vec<Option<T>>>, slot: usize) -> Option<T> {
    lock(workers)[slot].take()
}
fn take_workers<T>(workers: &Mutex<Vec<Option<T>>>) -> Vec<T> {
    lock(workers).iter_mut().filter_map(Option::take).collect()
}

trait RetireWorker {
    fn request_retirement(&self);
    fn retire_before(&mut self, deadline: Instant) -> Result<(), ()>;
}
impl RetireWorker for Decoder {
    fn request_retirement(&self) {
        self.request_stop();
    }
    fn retire_before(&mut self, deadline: Instant) -> Result<(), ()> {
        self.stop_confirmed(deadline).map(|_| ()).map_err(|_| ())
    }
}
fn request_workers<T: RetireWorker>(workers: &Mutex<Vec<Option<T>>>) {
    for worker in lock(workers).iter().flatten() {
        worker.request_retirement();
    }
}
fn retire_workers<T: RetireWorker>(
    workers: &Mutex<Vec<Option<T>>>,
    deadline: Instant,
    uncertain: &AtomicBool,
) -> Result<(), ()> {
    let owned = lock(workers)
        .iter_mut()
        .enumerate()
        .filter_map(|(slot, worker)| worker.take().map(|worker| (slot, worker)))
        .collect::<Vec<_>>();
    for (_, worker) in &owned {
        worker.request_retirement();
    }
    let mut failed = false;
    for (slot, worker) in owned {
        let mut worker = std::mem::ManuallyDrop::new(worker);
        let retired = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            worker.retire_before(deadline)
        }));
        if !matches!(retired, Ok(Ok(()))) {
            failed = true;
            let worker = std::mem::ManuallyDrop::into_inner(worker);
            let mut collection = lock(workers);
            if collection[slot].is_none() {
                collection[slot] = Some(worker);
            } else {
                uncertain.store(true, Ordering::Release);
                std::mem::forget(worker); // bounded, terminal ownership-invariant quarantine
            }
            continue;
        }
        let worker = std::mem::ManuallyDrop::into_inner(worker);
        if std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| drop(worker))).is_err() {
            uncertain.store(true, Ordering::Release);
            failed = true;
        }
    }
    if failed {
        Err(())
    } else {
        Ok(())
    }
}
struct CompositorExit<T: RetireWorker> {
    session_stop: Arc<AtomicBool>,
    output_stop: Arc<AtomicBool>,
    planned: Arc<AtomicBool>,
    cleanup_uncertain: Arc<AtomicBool>,
    cleanup_deadline: Arc<Mutex<Option<Instant>>>,
    workers: Arc<Mutex<Vec<Option<T>>>>,
}
impl<T: RetireWorker> Drop for CompositorExit<T> {
    fn drop(&mut self) {
        let panicking = thread::panicking();
        if self.planned.load(Ordering::Acquire)
            && !self.session_stop.load(Ordering::Acquire)
            && !panicking
        {
            return;
        }
        self.session_stop.store(true, Ordering::Release);
        self.output_stop.store(true, Ordering::Release);
        if panicking {
            self.cleanup_uncertain.store(true, Ordering::Release);
        }
        let deadline = *lock(&self.cleanup_deadline)
            .get_or_insert_with(|| Instant::now() + Duration::from_secs(5));
        let _ = retire_workers(&self.workers, deadline, &self.cleanup_uncertain);
    }
}

fn capture_stream_binding(
    state: &State,
    runtime: u64,
    slot: u8,
    expected_source_revision: u64,
) -> Result<BoundContext, Error> {
    if usize::from(slot) >= state.geometry.rects().len() {
        return Err(Error::InvalidSlot);
    }
    if state.slots[usize::from(slot)].generation != expected_source_revision {
        return Err(Error::StaleRevision);
    }
    Ok(BoundContext {
        runtime,
        slot_id: slot,
        source_revision: expected_source_revision,
        geometry_revision: state.geometry.revision(),
        focus_revision: state.focus_revision,
        audio_revision: state.audio_revision,
    })
}
fn validate_stream_binding(
    state: &State,
    runtime: u64,
    binding: &BoundContext,
) -> Result<(), Error> {
    // The issue proof retains its full original context. Current source CAS is
    // narrower: changing an unrelated focus or audio owner must not cancel an
    // explicit-slot source preparation, and must never retarget it.
    if runtime != binding.runtime
        || state.geometry.revision() != binding.geometry_revision
        || usize::from(binding.slot_id) >= state.geometry.rects().len()
        || state.slots[usize::from(binding.slot_id)].generation != binding.source_revision
    {
        return Err(Error::StaleRevision);
    }
    Ok(())
}

// Exactly one Session-owned publisher advances the source master clock across
// all output epochs. Audio still selects samples at its original fixed target;
// it must never publish competing output targets into that master clock.
fn mix_audio_tick(
    clock: &PresentationClock,
    route: &AtomicU64,
    queues: &[Arc<AudioQueue>],
    tick: Instant,
) -> Vec<i16> {
    if !matches!(clock.current(), Ok(Some(_))) {
        return vec![0; 1920];
    }
    let word = route.load(Ordering::Acquire);
    if word == 0 {
        return vec![0; 1920];
    }
    let slot = ((word & 15) - 1) as usize;
    let generation = (word >> 4) - 1;
    queues[slot].take_at(generation, tick)
}

pub(super) struct SessionClockDriver {
    stop: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
    join_failed: bool,
}
impl SessionClockDriver {
    pub(super) fn start(
        clock: Arc<PresentationClock>,
        stop: Arc<AtomicBool>,
    ) -> Result<Self, Error> {
        let (ready, first_tick) = std::sync::mpsc::channel();
        let cancelled = stop.clone();
        let worker = thread::Builder::new()
            .name("multiview-master-clock".into())
            .spawn(move || {
                struct StopOnExit(Arc<AtomicBool>);
                impl Drop for StopOnExit {
                    fn drop(&mut self) {
                        self.0.store(true, Ordering::Release);
                    }
                }
                let _stop_on_exit = StopOnExit(cancelled.clone());
                let mut ready = Some(ready);
                let period = Duration::from_millis(20);
                let mut next = Instant::now();
                while !cancelled.load(Ordering::Acquire) {
                    // This is real monotonic wall time, not a fabricated output
                    // target or a replacement for the decoder's five-second guard.
                    if clock.publish(Instant::now()).is_err() {
                        cancelled.store(true, Ordering::Release);
                        break;
                    }
                    if let Some(ready) = ready.take() {
                        let _ = ready.send(());
                    }
                    next += period;
                    let now = Instant::now();
                    if next <= now {
                        next = now + period;
                    }
                    wait_compositor_deadline(&cancelled, next, Instant::now, thread::sleep);
                }
            })
            .map_err(|_| Error::OutputFailed)?;
        let mut driver = Self {
            stop,
            worker: Some(worker),
            join_failed: false,
        };
        if first_tick.recv_timeout(Duration::from_secs(1)).is_err() {
            let _ = driver.stop();
            return Err(Error::OutputFailed);
        }
        Ok(driver)
    }
    pub(super) fn stop(&mut self) -> Result<(), Error> {
        self.stop.store(true, Ordering::Release);
        if let Some(worker) = self.worker.take() {
            self.join_failed |= worker.join().is_err();
        }
        if self.join_failed {
            Err(Error::OutputFailed)
        } else {
            Ok(())
        }
    }
}
impl Drop for SessionClockDriver {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

// Own the compositor before potentially blocking encoder startup. Failure at
// either startup check must stop/join it; success transfers its handle to Session.
struct CompositorStartup {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}
impl CompositorStartup {
    fn into_handle(mut self) -> JoinHandle<()> {
        self.thread.take().unwrap()
    }
}
impl Drop for CompositorStartup {
    fn drop(&mut self) {
        if let Some(thread) = self.thread.take() {
            self.stop.store(true, Ordering::Release);
            let _ = thread.join();
        }
    }
}

fn directory_removed(path: &Path) -> bool {
    matches!(std::fs::symlink_metadata(path), Err(error) if error.kind() == std::io::ErrorKind::NotFound)
}

fn unavailable_output(generation: u64) -> EncoderSnapshot {
    EncoderSnapshot {
        pid: 0,
        generation,
        frames: 0,
        state: EncoderState::Stopped,
        monotonic_millis: 0,
        hls_sequence: None,
        hls_last_update_millis: 0,
        audio_samples_written: 0,
        video_frames_written: 0,
    }
}

struct OutputEpoch {
    encoder: Encoder,
    _capture_video: Arc<CaptureVideoFeed>,
    stop: Arc<AtomicBool>,
    planned_retirement: Arc<AtomicBool>,
    compositor: Option<JoinHandle<()>>,
    compositor_join_failed: bool,
    cleanup_uncertain: Arc<AtomicBool>,
    cleanup_deadline: Arc<Mutex<Option<Instant>>>,
}

pub struct Session {
    config: Config,
    state: Arc<Mutex<State>>,
    decoders: Arc<Mutex<Vec<Option<Decoder>>>>,
    stop: Arc<AtomicBool>,
    output: Option<OutputEpoch>,
    capacity: Option<super::encoder::EncoderCapacity>,
    cleanup_uncertain: Arc<AtomicBool>,
    runtime_id: u64,
    absolute_end: Instant,
    retired_snapshot: EncoderSnapshot,
    retired_failure: Option<super::encoder::EncoderFailureDetail>,
    retired_directory: PathBuf,
    owned_pids: Vec<u32>,
    audio_callback_misses: Arc<AtomicU64>,
    presentation_clock: Arc<PresentationClock>,
    clock_driver: Option<SessionClockDriver>,
}

impl Session {
    pub fn start(config: Config, geometry: ValidatedGeometry) -> Result<Self, Error> {
        config.validate_output_timeouts()?;
        let canvas = geometry.canvas();
        if config.frame_spec.width == 0
            || config.frame_spec.height == 0
            || config.frame_spec.width > 640
            || config.frame_spec.height > 360
        {
            return Err(Error::InvalidConfig);
        }
        // Reader + mailbox + render snapshot + Vec-to-Arc conversion transient
        // per slot; six canvases cover three target buckets (including the
        // leased selection), old committed pixels and two conversion buffers.
        // The old committed allocation must drop before rotation/refill; PCM
        // and small-buffer allowance remain separate.
        // This reserves pixel storage, not FFmpeg RSS, allocators or thread stacks.
        let reserved = required_frame_buffer_bytes(config.frame_spec, canvas)?;
        if config.frame_spec.width == 0
            || config.frame_spec.height == 0
            || config.frame_spec.width > 640
            || config.frame_spec.height > 360
            || config.frame_spec.width % 2 != 0
            || config.frame_spec.height % 2 != 0
            || config.stale_after.is_zero()
            || config.stale_after > Duration::from_secs(10)
            || config.frame_memory_budget > 64 * 1024 * 1024
            || reserved > config.frame_memory_budget
            || config.max_input_pixel_rate == 0
            || config.max_input_pixel_rate > 9 * 1920 * 1080 * 30
            || canvas.fps > 15
            || !super::encoder::valid_lifetime(
                config.max_duration,
                config.idle_timeout,
                config.require_broker_grants,
            )
        {
            return Err(Error::InvalidConfig);
        }
        let mut slots = Vec::with_capacity(9);
        for _ in 0..9 {
            slots.push(Slot {
                generation: 0,
                pid: None,
                pixel_rate: 0,
                stopped: false,
                video: Arc::new(
                    LatestFrame::new(config.frame_spec, 0).map_err(|_| Error::InvalidConfig)?,
                ),
                audio: Arc::new(AudioQueue::new(0)),
            });
        }
        let audio_route = Arc::new(AtomicU64::new(0));
        let state = Arc::new(Mutex::new(State {
            geometry,
            control_epoch: 0,
            focus_revision: 0,
            audio_revision: 0,
            focus: 0,
            audio_policy: AudioPolicy::FollowsFocus,
            slots,
            audio_route,
            capture_video: None,
            output_bootstrap: true,
        }));
        if !lock(&state).bootstrap_sources_empty() {
            return Err(Error::InvalidConfig);
        }
        let absolute_end = Instant::now()
            .checked_add(config.max_duration)
            .ok_or(Error::InvalidConfig)?;
        let capacity = Encoder::reserve_output_capacity().map_err(|_| Error::OutputFailed)?;
        let stop = Arc::new(AtomicBool::new(false));
        let presentation_clock = Arc::new(PresentationClock::new());
        let clock_driver = SessionClockDriver::start(presentation_clock.clone(), stop.clone())?;
        let mut session = Self {
            config,
            state,
            decoders: Arc::new(Mutex::new((0..9).map(|_| None).collect())),
            stop,
            output: None,
            capacity: Some(capacity),
            cleanup_uncertain: Arc::new(AtomicBool::new(false)),
            runtime_id: 0,
            absolute_end,
            retired_snapshot: unavailable_output(0),
            retired_failure: None,
            retired_directory: PathBuf::new(),
            owned_pids: Vec::new(),
            audio_callback_misses: Arc::new(AtomicU64::new(0)),
            presentation_clock,
            clock_driver: Some(clock_driver),
        };
        if let Err(error) = session.start_output() {
            // Preserve the closed Session stage before its local owner retires.
            // No source/config/tool text or raw process stderr enters this record.
            super::encoder::emit_startup_record(&format!(
                "multiview_startup stage=session_output error={error:?} detail={:?} snapshot={:?}",
                session.retired_failure, session.retired_snapshot
            ));
            return Err(error);
        }
        session.runtime_id = session
            .output
            .as_ref()
            .ok_or(Error::OutputFailed)?
            .encoder
            .snapshot()
            .generation;
        Ok(session)
    }

    fn start_output(&mut self) -> Result<(), Error> {
        self.check_live_session()?;
        if self.output.is_some() || self.owned_pids.len() >= 256 {
            return Err(Error::CapacityExceeded);
        }
        let (canvas, video, audio_route, audio_queues) = {
            let mut state = lock(&self.state);
            if state.capture_video.is_some() {
                return Err(Error::OutputFailed);
            }
            state.output_bootstrap = true;
            state.suspend_output_audio();
            let canvas = state.geometry.canvas();
            let video = Arc::new(CaptureVideoFeed::new(
                vec![0; canvas.width as usize * canvas.height as usize * 3].into(),
                state.output_fence(),
                Instant::now(),
            ));
            state.capture_video = Some(video.clone());
            (
                canvas,
                video,
                state.audio_route.clone(),
                state
                    .slots
                    .iter()
                    .map(|slot| slot.audio.clone())
                    .collect::<Vec<_>>(),
            )
        };
        let output_stop = Arc::new(AtomicBool::new(false));
        let planned = Arc::new(AtomicBool::new(false));
        let cleanup_uncertain = self.cleanup_uncertain.clone();
        let cleanup_deadline = Arc::new(Mutex::new(None));
        let exit = CompositorExit {
            session_stop: self.stop.clone(),
            output_stop: output_stop.clone(),
            planned: planned.clone(),
            cleanup_uncertain: cleanup_uncertain.clone(),
            cleanup_deadline: cleanup_deadline.clone(),
            workers: self.decoders.clone(),
        };
        let (compose_state, compose_stop, compose_session_stop) =
            (self.state.clone(), output_stop.clone(), self.stop.clone());
        let stale_after = self.config.stale_after;
        let absolute_end = self.absolute_end;
        let compositor = thread::Builder::new()
            .name("multiview-compositor".into())
            .spawn(move || {
                let _exit = exit;
                let period = Duration::from_secs_f64(1.0 / f64::from(canvas.fps));
                let mut next = Instant::now();
                while !compose_stop.load(Ordering::Acquire) {
                    if compose_session_stop.load(Ordering::Acquire)
                        || Instant::now() >= absolute_end
                    {
                        compose_session_stop.store(true, Ordering::Release);
                        compose_stop.store(true, Ordering::Release);
                        break;
                    }
                    let (geometry, fence, frames, captured_at, bootstrap) = {
                        let state = lock(&compose_state);
                        let (frames, stamp) = if state.output_bootstrap {
                            (Vec::new(), Instant::now())
                        } else {
                            freeze_frames(&state.slots, state.geometry.rects().len(), stale_after)
                        };
                        (
                            state.geometry.clone(),
                            state.output_fence(),
                            frames,
                            stamp,
                            state.output_bootstrap,
                        )
                    };
                    let mut pixels = Vec::new();
                    if bootstrap {
                        pixels.resize(canvas.width as usize * canvas.height as usize * 3, 0);
                    } else if compose_into(&geometry, &frames, &mut pixels).is_err() {
                        compose_session_stop.store(true, Ordering::Release);
                        compose_stop.store(true, Ordering::Release);
                        break;
                    }
                    let pixels: Arc<[u8]> = pixels.into();
                    {
                        let state = lock(&compose_state);
                        if state.publish_capture(pixels, fence, captured_at).is_err() {
                            compose_session_stop.store(true, Ordering::Release);
                            compose_stop.store(true, Ordering::Release);
                        }
                    }
                    next += period;
                    let now = Instant::now();
                    if next > now {
                        wait_compositor_deadline(&compose_stop, next, Instant::now, thread::sleep);
                    } else {
                        next = now;
                    }
                }
            })
            .map_err(|_| Error::OutputFailed)?;
        let compositor = CompositorStartup {
            stop: output_stop.clone(),
            thread: Some(compositor),
        };
        let audio_clock = self.presentation_clock.clone();
        let audio =
            Arc::new(move |tick| mix_audio_tick(&audio_clock, &audio_route, &audio_queues, tick));
        let config = self
            .config
            .encoder_config_at(canvas, self.absolute_end, Instant::now())?;
        let capacity = self.capacity.take().ok_or(Error::OutputFailed)?;
        let encoder = match Encoder::start_session_capture_av(
            config,
            video.clone(),
            audio,
            output_stop.clone(),
            capacity,
            self.config.require_broker_grants,
        ) {
            Ok(encoder) => encoder,
            Err(failure) => {
                if failure.capacity.is_none() {
                    // The failed partial encoder retained its actual owner and
                    // global permit. A later input-only cleanup cannot turn
                    // that constructor quarantine into a successful receipt.
                    self.cleanup_uncertain.store(true, Ordering::Release);
                }
                self.capacity = failure.capacity;
                self.retired_failure = self.retired_failure.or(Some(failure.error.into()));
                return Err(Error::OutputFailed);
            }
        };
        self.owned_pids.push(encoder.snapshot().pid);
        self.output = Some(OutputEpoch {
            encoder,
            _capture_video: video,
            stop: output_stop,
            planned_retirement: planned,
            compositor: Some(compositor.into_handle()),
            compositor_join_failed: false,
            cleanup_uncertain,
            cleanup_deadline,
        });
        if self
            .presentation_clock
            .current()
            .map_err(|_| Error::OutputFailed)?
            .is_none()
        {
            return Err(Error::OutputFailed);
        }
        self.check_live_session()?;
        lock(&self.state).activate_output()?;
        Ok(())
    }

    fn check_live_session(&self) -> Result<(), Error> {
        if self.stop.load(Ordering::Acquire) || Instant::now() >= self.absolute_end {
            Err(Error::Stopped)
        } else {
            Ok(())
        }
    }
    fn touch(&self) {
        if let Some(output) = &self.output {
            output.encoder.touch();
        }
    }
    /// Trusted host only, after authenticated registry renewal commits. Media
    /// reads and status must never call this method or extend the absolute end.
    pub fn touch_output(&self) -> Result<(), Error> {
        if !self.config.require_broker_grants {
            return Err(Error::InvalidConfig);
        }
        self.check()?;
        self.touch();
        Ok(())
    }

    // Drop all old feed owners before allocating any new output pixel buffers.
    fn retire_output(&mut self, deadline: Instant) -> Result<(), Error> {
        let Some(mut output) = self.output.take() else {
            return Ok(());
        };
        *lock(&output.cleanup_deadline) = Some(deadline);
        output.planned_retirement.store(true, Ordering::Release);
        output.stop.store(true, Ordering::Release);
        if self.stop.load(Ordering::Acquire) {
            request_workers(&self.decoders);
        }
        let result = output.encoder.stop_retaining_capacity();
        if let Some(thread) = output.compositor.take() {
            output.compositor_join_failed |= thread.join().is_err();
        }
        self.retired_directory = output.encoder.output_directory().to_path_buf();
        self.retired_snapshot = unavailable_output(output.encoder.snapshot().generation);
        let failure = output.encoder.failure();
        self.retired_failure = self.retired_failure.or(output.encoder.failure_detail());
        let inputs_retired = !self.stop.load(Ordering::Acquire)
            || retire_workers(&self.decoders, deadline, &output.cleanup_uncertain).is_ok();
        if result.is_err()
            || !inputs_retired
            || output.compositor_join_failed
            || output.cleanup_uncertain.load(Ordering::Acquire)
            || !directory_removed(&self.retired_directory)
        {
            // Keep the actual encoder, old feed and capacity custody available
            // for shutdown's cleanup retry. A stopped-looking snapshot alone
            // never proves the old child/output has retired.
            self.stop.store(true, Ordering::Release);
            self.retired_snapshot.state = EncoderState::Failed;
            self.retired_failure = self
                .retired_failure
                .or(Some(super::encoder::EncoderError::Io.into()));
            self.output = Some(output);
            return Err(Error::OutputFailed);
        }
        match output.encoder.take_retired_capacity() {
            Ok(capacity) => {
                self.capacity = Some(capacity);
            }
            Err(_) => {
                self.stop.store(true, Ordering::Release);
                self.retired_snapshot.state = EncoderState::Failed;
                self.retired_failure = self
                    .retired_failure
                    .or(Some(super::encoder::EncoderError::Io.into()));
                self.output = Some(output);
                return Err(Error::OutputFailed);
            }
        }
        {
            // Audio callbacks are joined first: an in-flight take_at must not
            // reinstall last_take_end after selection continuity is reset.
            let mut state = lock(&self.state);
            state.suspend_output_audio();
            state.capture_video.take();
        }
        drop(output);
        if failure.is_some() {
            self.retired_snapshot.state = EncoderState::Failed;
            Err(Error::OutputFailed)
        } else {
            Ok(())
        }
    }

    /// The host must revoke the old output capability BEFORE this call and
    /// authorize a fresh capability only after success. This does not renew the
    /// Session lifetime. The continuity contract is limited to stream-backed
    /// sources; real-media qualification is separate from this API's existence.
    pub fn rotate_output(&mut self, expected_generation: u64) -> Result<OutputEpochReceipt, Error> {
        self.check()?;
        let retired_generation = self
            .output
            .as_ref()
            .ok_or(Error::OutputFailed)?
            .encoder
            .snapshot()
            .generation;
        if retired_generation != expected_generation {
            return Err(Error::StaleRevision);
        }
        if self.owned_pids.len() >= 256 {
            return Err(Error::CapacityExceeded);
        }
        if self
            .retire_output(Instant::now() + Duration::from_secs(5))
            .and_then(|_| self.start_output())
            .is_err()
        {
            let _ = self.shutdown();
            return Err(Error::OutputFailed);
        }
        Ok(OutputEpochReceipt {
            runtime_id: self.runtime_id,
            retired_generation,
            new_generation: self
                .output
                .as_ref()
                .ok_or(Error::OutputFailed)?
                .encoder
                .snapshot()
                .generation,
            old_output_removed: directory_removed(&self.retired_directory),
        })
    }

    fn check(&self) -> Result<(), Error> {
        if self.stop.load(Ordering::Acquire) || Instant::now() >= self.absolute_end {
            Err(Error::Stopped)
        } else if self.output.is_none() {
            Err(Error::OutputFailed)
        } else {
            Ok(())
        }
    }
    fn retain_failed_worker(&mut self, slot: usize, worker: Decoder) {
        self.stop.store(true, Ordering::Release);
        worker.request_stop();
        self.retired_snapshot = unavailable_output(
            self.output
                .as_ref()
                .map(|output| output.encoder.snapshot().generation)
                .unwrap_or(self.retired_snapshot.generation),
        );
        self.retired_snapshot.state = EncoderState::Failed;
        self.retired_failure = self
            .retired_failure
            .or(Some(super::encoder::EncoderError::Io.into()));
        let mut workers = lock(&self.decoders);
        if workers[slot].is_none() {
            workers[slot] = Some(worker);
        } else {
            self.cleanup_uncertain.store(true, Ordering::Release);
            std::mem::forget(worker);
        }
        for worker in workers.iter().flatten() {
            worker.request_stop();
        }
    }
    fn retire_owned_worker(
        &mut self,
        slot: usize,
        mut worker: Decoder,
        deadline: Instant,
    ) -> Result<(), Error> {
        worker.request_stop();
        if worker.stop_confirmed(deadline).is_err() {
            self.retain_failed_worker(slot, worker);
            return Err(Error::OutputFailed);
        }
        Ok(())
    }
    fn retire_slot_worker(&mut self, slot: usize, deadline: Instant) -> Result<(), Error> {
        let worker = take_worker(&self.decoders, slot);
        if let Some(worker) = worker {
            self.retire_owned_worker(slot, worker, deadline)?;
        }
        Ok(())
    }
    fn decoder_config(&self) -> DecoderConfig {
        DecoderConfig {
            ffmpeg: self.config.ffmpeg.clone(),
            ffprobe: self.config.ffprobe.clone(),
            frame_spec: self.config.frame_spec,
            fps: lock(&self.state).geometry.canvas().fps,
        }
    }
    pub fn capture_stream_preparation(
        &self,
        slot: u8,
        expected_source_revision: u64,
    ) -> Result<StreamPreparation, Error> {
        self.check()?;
        if self.owned_pids.len() >= 256 {
            return Err(Error::CapacityExceeded);
        }
        let state = lock(&self.state);
        let binding =
            capture_stream_binding(&state, self.runtime_id, slot, expected_source_revision)?;
        Ok(StreamPreparation {
            binding,
            config: DecoderConfig {
                ffmpeg: self.config.ffmpeg.clone(),
                ffprobe: self.config.ffprobe.clone(),
                frame_spec: self.config.frame_spec,
                fps: state.geometry.canvas().fps,
            },
            stop: self.stop.clone(),
        })
    }

    /// The host must perform `probe_stream` outside its control mutex using the
    /// owned preparation config/token. Commit has no pathname open or probe.
    /// Stop/reap of the replaced child and spawning its replacement still occur
    /// here; those are never executed inside state or publication-authority locks.
    /// Hosts needing zero process work under their own control mutex need an
    /// additional reserve/retire/attach split. Producer cleanup remains host-owned.
    pub fn commit_stream(
        &mut self,
        preparation: StreamPreparation,
        source: &GrantedStream,
        prepared: PreparedStreamInfo,
        input: StreamInput,
    ) -> Result<u64, Error> {
        self.check()?;
        if self
            .presentation_clock
            .current()
            .map_err(|_| Error::OutputFailed)?
            .is_none()
        {
            return Err(Error::OutputFailed);
        }
        if !preparation.belongs_to(&self.stop) {
            return Err(Error::StaleRevision);
        }
        if self.owned_pids.len() >= 256 {
            return Err(Error::CapacityExceeded);
        }
        let binding = preparation.binding;
        let slot = usize::from(binding.slot_id);
        let generation = binding
            .source_revision
            .checked_add(1)
            .filter(|generation| *generation < (u64::MAX >> 4))
            .ok_or(Error::StaleRevision)?;
        source
            .check_binding(&binding)
            .map_err(|_| Error::SourceFailed)?;
        decoder::validate_stream_preparation(&preparation.config, source, &prepared, &input)
            .map_err(|_| Error::SourceFailed)?;
        let rate = prepared.info().pixel_rate();
        {
            let state = lock(&self.state);
            validate_stream_binding(&state, self.runtime_id, &binding)?;
            let others = state
                .slots
                .iter()
                .enumerate()
                .filter(|(index, _)| *index != slot)
                .try_fold(0u64, |sum, (_, value)| sum.checked_add(value.pixel_rate))
                .ok_or(Error::CapacityExceeded)?;
            if others
                .checked_add(rate)
                .is_none_or(|sum| sum > self.config.max_input_pixel_rate)
            {
                return Err(Error::CapacityExceeded);
            }
            // Verify all checked state counters before the first source effect.
            state
                .control_epoch
                .checked_add(2)
                .ok_or(Error::StaleRevision)?;
        }
        self.retire_slot_worker(slot, Instant::now() + Duration::from_secs(5))?;
        let (video, audio) = {
            let mut state = lock(&self.state);
            validate_stream_binding(&state, self.runtime_id, &binding)?;
            let target = &mut state.slots[slot];
            target
                .video
                .advance(target.generation, generation)
                .map_err(|_| Error::StaleRevision)?;
            target
                .audio
                .reset(target.generation, generation)
                .map_err(|_| Error::StaleRevision)?;
            target.generation = generation;
            target.pid = None;
            target.pixel_rate = rate;
            target.stopped = false;
            let result = (target.video.clone(), target.audio.clone());
            state.advance_control()?;
            result
        };
        let worker = match Decoder::start_stream_with_clock_owned(
            &preparation.config,
            source,
            prepared,
            input,
            generation,
            video.clone(),
            audio,
            self.presentation_clock.clone(),
        ) {
            Ok(worker) => worker,
            Err(failure) => {
                let _cause = failure.cause;
                if let Some(owner) = failure.owner {
                    self.owned_pids.push(owner.pid());
                    self.retain_failed_worker(slot, owner);
                }
                let _ = video.mark_failed(generation);
                lock(&self.state).slots[slot].pixel_rate = 0;
                return Err(Error::SourceFailed);
            }
        };
        let pid = worker.pid();
        self.owned_pids.push(pid);
        let mut pending = Some(worker);
        let mut attach = || {
            let mut workers = lock(&self.decoders);
            if self.stop.load(Ordering::Acquire) {
                return Err(DecoderError::PublicationDenied);
            }
            let mut state = lock(&self.state);
            if state.slots[slot].generation != generation
                || state.geometry.revision() != binding.geometry_revision
                || workers[slot].is_some()
            {
                return Err(DecoderError::StaleGeneration);
            }
            workers[slot] = pending.take();
            state.slots[slot].pid = Some(pid);
            // Use CURRENT focus/audio policy. Never restore the captured policy.
            state.update_audio_metrics();
            Ok(())
        };
        if source.attach(&binding, &mut attach).is_err() {
            let deadline = Instant::now() + Duration::from_secs(5);
            if let Some(worker) = pending.take() {
                self.retire_owned_worker(slot, worker, deadline)?;
            }
            let attached = { lock(&self.decoders)[slot].take() };
            if let Some(worker) = attached {
                self.retire_owned_worker(slot, worker, deadline)?;
            }
            let _ = video.mark_failed(generation);
            let mut state = lock(&self.state);
            state.slots[slot].pid = None;
            state.slots[slot].pixel_rate = 0;
            state.advance_control()?;
            return Err(Error::SourceFailed);
        }
        self.touch();
        Ok(generation)
    }
    pub fn replace_source(
        &mut self,
        slot: u8,
        source: &GrantedFile,
        expected_source_revision: u64,
    ) -> Result<u64, Error> {
        self.check()?;
        if self.owned_pids.len() >= 256 {
            return Err(Error::CapacityExceeded);
        }
        let next_generation = expected_source_revision
            .checked_add(1)
            .filter(|generation| *generation < (u64::MAX >> 4))
            .ok_or(Error::StaleRevision)?;
        let binding = {
            let state = lock(&self.state);
            if usize::from(slot) >= state.geometry.rects().len() {
                return Err(Error::InvalidSlot);
            }
            if state.slots[usize::from(slot)].generation != expected_source_revision {
                return Err(Error::StaleRevision);
            }
            BoundContext {
                runtime: self.runtime_id,
                slot_id: slot,
                source_revision: expected_source_revision,
                geometry_revision: state.geometry.revision(),
                focus_revision: state.focus_revision,
                audio_revision: state.audio_revision,
            }
        };
        if self.config.require_broker_grants || source.is_bound() {
            source
                .check_binding(&binding)
                .map_err(|_| Error::SourceFailed)?;
        }
        let config = self.decoder_config();
        let metadata = decoder::probe_source(&config, source).map_err(|_| Error::SourceFailed)?;
        self.check()?;
        let rate = metadata.pixel_rate();
        {
            let state = lock(&self.state);
            let others: u64 = state
                .slots
                .iter()
                .enumerate()
                .filter(|(index, _)| *index != usize::from(slot))
                .map(|(_, value)| value.pixel_rate)
                .sum();
            if others
                .checked_add(rate)
                .is_none_or(|sum| sum > self.config.max_input_pixel_rate)
            {
                return Err(Error::CapacityExceeded);
            }
        }
        // No transient tenth decoder: stop/reap only the replaced slot first.
        self.retire_slot_worker(usize::from(slot), Instant::now() + Duration::from_secs(5))?;
        let (generation, video, audio) = {
            let mut state = lock(&self.state);
            let source = &mut state.slots[usize::from(slot)];
            let next = next_generation;
            source
                .video
                .advance(source.generation, next)
                .map_err(|_| Error::StaleRevision)?;
            source
                .audio
                .reset(source.generation, next)
                .map_err(|_| Error::StaleRevision)?;
            source.generation = next;
            source.pid = None;
            source.pixel_rate = rate;
            source.stopped = false;
            let result = (next, source.video.clone(), source.audio.clone());
            state.advance_control()?;
            result
        };
        match Decoder::start(&config, source, generation, video.clone(), audio) {
            Ok(worker) => {
                let pid = worker.pid();
                self.owned_pids.push(pid);
                let mut pending = Some(worker);
                let mut attach = || {
                    let mut workers = lock(&self.decoders);
                    if self.stop.load(Ordering::Acquire) {
                        return Err(DecoderError::PublicationDenied);
                    }
                    let mut state = lock(&self.state);
                    if state.slots[usize::from(slot)].generation != generation {
                        return Err(DecoderError::StaleGeneration);
                    }
                    workers[usize::from(slot)] = pending.take();
                    state.slots[usize::from(slot)].pid = Some(pid);
                    state.update_audio_metrics();
                    Ok(())
                };
                let attached = if source.is_bound() {
                    // The mandatory broker barrier owns atomic authority here.
                    // This callback performs only bounded in-memory attachment.
                    source.attach(&binding, &mut attach)
                } else {
                    attach()
                };
                if attached.is_err() {
                    let deadline = Instant::now() + Duration::from_secs(5);
                    if let Some(worker) = pending.take() {
                        self.retire_owned_worker(usize::from(slot), worker, deadline)?;
                    }
                    self.retire_slot_worker(usize::from(slot), deadline)?;
                    let _ = video.mark_failed(generation);
                    let mut state = lock(&self.state);
                    state.slots[usize::from(slot)].pid = None;
                    state.slots[usize::from(slot)].pixel_rate = 0;
                    state.advance_control()?;
                    return Err(Error::SourceFailed);
                }
                self.touch();
                Ok(generation)
            }
            Err(_) => {
                let _ = video.mark_failed(generation);
                lock(&self.state).slots[usize::from(slot)].pixel_rate = 0;
                Err(Error::SourceFailed)
            }
        }
    }
    pub fn stop_slot(&mut self, slot: u8, expected_source_revision: u64) -> Result<u64, Error> {
        self.check()?;
        let next_generation = expected_source_revision
            .checked_add(1)
            .filter(|generation| *generation < (u64::MAX >> 4))
            .ok_or(Error::StaleRevision)?;
        {
            let state = lock(&self.state);
            if slot > 8 {
                return Err(Error::InvalidSlot);
            }
            if state.slots[usize::from(slot)].generation != expected_source_revision {
                return Err(Error::StaleRevision);
            }
        }
        self.retire_slot_worker(usize::from(slot), Instant::now() + Duration::from_secs(5))?;
        let mut state = lock(&self.state);
        let source = &mut state.slots[usize::from(slot)];
        let next = next_generation;
        source
            .video
            .advance(source.generation, next)
            .map_err(|_| Error::StaleRevision)?;
        source
            .audio
            .reset(source.generation, next)
            .map_err(|_| Error::StaleRevision)?;
        let _ = source.video.mark_ended(next);
        source.generation = next;
        source.pid = None;
        source.pixel_rate = 0;
        source.stopped = true;
        state.advance_control()?;
        state.update_audio_metrics();
        self.touch();
        Ok(next)
    }
    pub fn set_geometry(
        &mut self,
        geometry: ValidatedGeometry,
        expected_layout_revision: u64,
    ) -> Result<(), Error> {
        self.check()?;
        let mut state = lock(&self.state);
        if state.geometry.revision() != expected_layout_revision
            || geometry.revision() <= expected_layout_revision
        {
            return Err(Error::StaleRevision);
        }
        if geometry.canvas() != state.geometry.canvas() {
            return Err(Error::InvalidConfig);
        }
        if usize::from(state.focus) >= geometry.rects().len()
            || matches!(state.audio_policy, AudioPolicy::Slot(slot) if usize::from(slot)>=geometry.rects().len())
        {
            return Err(Error::InvalidSlot);
        }
        // Hidden workers intentionally keep advancing. Resource admission still
        // counts them. Suspending/checkpointing hidden VOD is not advertised.
        state.geometry = geometry;
        state.advance_control()?;
        state.update_audio_metrics();
        self.touch();
        Ok(())
    }
    pub fn focus(&mut self, slot: u8, expected_focus_revision: u64) -> Result<u64, Error> {
        self.check()?;
        let mut state = lock(&self.state);
        if usize::from(slot) >= state.geometry.rects().len() {
            return Err(Error::InvalidSlot);
        }
        if state.focus_revision != expected_focus_revision {
            return Err(Error::StaleRevision);
        }
        state.focus = slot;
        state.focus_revision = state
            .focus_revision
            .checked_add(1)
            .ok_or(Error::StaleRevision)?;
        if state.audio_policy == AudioPolicy::FollowsFocus {
            state.audio_revision = state
                .audio_revision
                .checked_add(1)
                .ok_or(Error::StaleRevision)?;
        }
        state.advance_control()?;
        state.update_audio_metrics();
        self.touch();
        Ok(state.focus_revision)
    }
    pub fn set_audio_policy(
        &mut self,
        policy: AudioPolicy,
        expected_audio_revision: u64,
    ) -> Result<u64, Error> {
        self.check()?;
        let mut state = lock(&self.state);
        if state.audio_revision != expected_audio_revision {
            return Err(Error::StaleRevision);
        }
        if let AudioPolicy::Slot(slot) = policy {
            if usize::from(slot) >= state.geometry.rects().len() {
                return Err(Error::InvalidSlot);
            }
            let source = &state.slots[usize::from(slot)];
            if !source.audio.has_audio(source.generation) {
                return Err(Error::NoAudio);
            }
        }
        state.audio_policy = policy;
        state.audio_revision = state
            .audio_revision
            .checked_add(1)
            .ok_or(Error::StaleRevision)?;
        state.advance_control()?;
        state.update_audio_metrics();
        self.touch();
        Ok(state.audio_revision)
    }
    /// Read the output encoder's first closed failure without changing state.
    pub fn output_failure(&self) -> Option<super::encoder::EncoderError> {
        self.output_failure_detail().map(|detail| detail.error)
    }
    /// Read one current source owner's diagnostic before replacement/retirement.
    /// Deliberately separate from snapshot(): do not add state -> workers lock order.
    pub fn source_failure_detail(
        &self,
        slot: u8,
        expected_source_revision: u64,
    ) -> Option<super::decoder::DecoderFailureDetail> {
        let workers = lock(&self.decoders);
        workers
            .get(usize::from(slot))?
            .as_ref()?
            .failure_detail(expected_source_revision)
    }
    pub fn output_failure_detail(&self) -> Option<super::encoder::EncoderFailureDetail> {
        if self.stop.load(Ordering::Acquire) && self.retired_snapshot.state == EncoderState::Failed
        {
            return self.retired_failure;
        }
        self.output
            .as_ref()
            .and_then(|output| output.encoder.failure_detail())
            .or(self.retired_failure)
    }
    pub fn snapshot(&self) -> Snapshot {
        let output = if self.stop.load(Ordering::Acquire)
            && self.retired_snapshot.state == EncoderState::Failed
        {
            self.retired_snapshot
        } else {
            self.output
                .as_ref()
                .map(|epoch| epoch.encoder.snapshot())
                .unwrap_or(self.retired_snapshot)
        };
        let state = lock(&self.state);
        let now = Instant::now();
        let slots = state
            .slots
            .iter()
            .enumerate()
            .map(|(id, source)| {
                let view = source.video.snapshot(now, self.config.stale_after);
                let (frames, status) = match view {
                    FrameView::Ready(ref frame) => (frame.sequence, SlotState::Playing),
                    FrameView::Slate(status) => (
                        source.video.sequence(),
                        match status {
                            FrameStatus::Starting => SlotState::Starting,
                            FrameStatus::Stalled => SlotState::Stalled,
                            FrameStatus::Ended => SlotState::Ended,
                            FrameStatus::Failed => SlotState::Failed,
                        },
                    ),
                };
                SlotSnapshot {
                    slot_id: id as u8,
                    source_revision: source.generation,
                    decoder_pid: source.pid,
                    frames,
                    state: if source.stopped {
                        SlotState::Stopped
                    } else if source.generation == 0 {
                        SlotState::Empty
                    } else {
                        status
                    },
                    audio: source.audio.stats(source.generation),
                }
            })
            .collect();
        Snapshot {
            runtime: self.runtime_id,
            geometry_revision: state.geometry.revision(),
            focus_revision: state.focus_revision,
            audio_revision: state.audio_revision,
            focus_slot: state.focus,
            audio_policy: state.audio_policy,
            audio_slot: state.audio_slot(),
            encoder_pid: output.pid,
            output_generation: output.generation,
            output_frames: output.frames,
            output_state: output.state,
            hls_sequence: output.hls_sequence,
            hls_last_update_millis: output.hls_last_update_millis,
            audio_samples_written: output.audio_samples_written,
            video_frames_written: output.video_frames_written,
            slots,
            monotonic_millis: output.monotonic_millis,
            audio_callback_misses: self.audio_callback_misses.load(Ordering::Relaxed),
        }
    }
    /// Private media custody for the authenticated host/isolated E2E driver only.
    /// Never serialize this filesystem path or a bearer URL in an RPC receipt.
    pub fn output_directory(&self) -> &Path {
        self.output
            .as_ref()
            .map(|output| output.encoder.output_directory())
            .unwrap_or(&self.retired_directory)
    }
    pub fn shutdown(&mut self) -> Result<ShutdownReceipt, Error> {
        self.stop.store(true, Ordering::Release);
        request_workers(&self.decoders);
        let deadline = Instant::now() + Duration::from_secs(5);
        let result = self.retire_output(deadline);
        let inputs = retire_workers(&self.decoders, deadline, &self.cleanup_uncertain);
        let clock_result = self
            .clock_driver
            .as_mut()
            .map_or(Ok(()), SessionClockDriver::stop);
        result?;
        if inputs.is_err() || self.cleanup_uncertain.load(Ordering::Acquire) {
            return Err(Error::OutputFailed);
        }
        clock_result?;
        lock(&self.state).capture_video.take();
        self.capacity.take();
        Ok(ShutdownReceipt {
            owned_pids: self.owned_pids.clone(),
            output_removed: directory_removed(self.output_directory()),
        })
    }
}
impl Drop for Session {
    fn drop(&mut self) {
        if self.shutdown().is_err() {
            if let Some(output) = self.output.take() {
                // An unprovable cleanup is quarantined, never converted into
                // released encoder capacity by Rust's automatic field Drop.
                // Explicit shutdown may retry while the Session is retained.
                std::mem::forget(output);
            }
            if let Some(capacity) = self.capacity.take() {
                std::mem::forget(capacity);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::geometry::{ImportedRect, OverlapPolicy};
    use super::*;

    #[test]
    fn output_encoder_config_shortens_equal_startup_after_setup() {
        let mut config = Config::new("no-ffmpeg".into(), "no-ffprobe".into(), "no-output".into());
        config.max_duration = Duration::from_secs(10);
        let began = Instant::now();
        let absolute_end = began + config.max_duration;
        let now = began + Duration::from_nanos(1);
        let canvas = CanvasSpec {
            width: 384,
            height: 256,
            fps: 10,
        };
        let encoder = config.encoder_config_at(canvas, absolute_end, now).unwrap();
        let remaining = Duration::from_secs(10) - Duration::from_nanos(1);
        assert_eq!(encoder.max_duration, remaining);
        assert_eq!(encoder.startup_timeout, remaining);
        assert_eq!(encoder.stall_timeout, Duration::from_secs(2));
        assert_eq!(encoder.idle_timeout, config.idle_timeout);
        assert_eq!(encoder.max_disk_bytes, config.max_disk_bytes);
        assert_eq!(encoder.ffmpeg, config.ffmpeg);
        assert_eq!(encoder.mkfifo, config.mkfifo);
        assert_eq!(encoder.output_root, config.output_root);
        assert_eq!(encoder.canvas, canvas);
        assert_eq!(now + encoder.max_duration, absolute_end);
        assert_eq!(config.startup_timeout, Duration::from_secs(10));
        assert_eq!(config.max_duration, Duration::from_secs(10));
    }

    #[test]
    fn output_encoder_config_shortens_both_timeouts_near_hard_end() {
        let config = Config::new("no-ffmpeg".into(), "no-ffprobe".into(), "no-output".into());
        let began = Instant::now();
        let absolute_end = began + config.max_duration;
        let canvas = CanvasSpec {
            width: 384,
            height: 256,
            fps: 10,
        };
        for remaining in [Duration::from_secs(1), Duration::from_nanos(1)] {
            let now = absolute_end - remaining;
            let encoder = config.encoder_config_at(canvas, absolute_end, now).unwrap();
            assert_eq!(encoder.max_duration, remaining);
            assert_eq!(encoder.startup_timeout, remaining);
            assert_eq!(encoder.stall_timeout, remaining);
            assert_eq!(now + encoder.max_duration, absolute_end);
            assert_eq!(encoder.idle_timeout, Duration::from_secs(60));
        }
        assert_eq!(config.startup_timeout, Duration::from_secs(10));
        assert_eq!(config.stale_after, Duration::from_secs(2));
        assert_eq!(config.max_duration, Duration::from_secs(120));
        assert_eq!(absolute_end, began + Duration::from_secs(120));
    }

    #[test]
    fn output_encoder_config_stops_at_or_after_hard_end() {
        let config = Config::new("no-ffmpeg".into(), "no-ffprobe".into(), "no-output".into());
        let absolute_end = Instant::now() + config.max_duration;
        let canvas = CanvasSpec {
            width: 384,
            height: 256,
            fps: 10,
        };
        for now in [absolute_end, absolute_end + Duration::from_nanos(1)] {
            assert_eq!(
                config.encoder_config_at(canvas, absolute_end, now).err(),
                Some(Error::Stopped)
            );
        }
    }

    #[test]
    fn session_rejects_invalid_original_timeouts_before_encoder_projection() {
        let geometry = || stream_state().geometry;
        for (startup, stale) in [
            (Duration::ZERO, Duration::from_secs(2)),
            (
                Duration::from_secs(10) + Duration::from_nanos(1),
                Duration::from_secs(2),
            ),
            (
                Duration::from_secs(10),
                Duration::from_secs(10) + Duration::from_nanos(1),
            ),
        ] {
            let mut config = Config::new(
                "must-not-execute".into(),
                "must-not-execute".into(),
                "must-not-create".into(),
            );
            config.max_duration = Duration::from_secs(10);
            config.startup_timeout = startup;
            config.stale_after = stale;
            assert_eq!(
                Session::start(config, geometry()).err(),
                Some(Error::InvalidConfig)
            );
        }
    }

    #[test]
    fn session_clock_keeps_waiting_decoder_live_through_output_gap_longer_than_five_seconds() {
        super::super::decoder::assert_session_clock_gap_with_driver(
            |clock, stop| SessionClockDriver::start(clock, stop).unwrap(),
            |driver| driver.stop().unwrap(),
        );
    }

    // A stop can wait for a reader entering Registry publication, while an
    // attach already holding Registry needs the worker collection. try_lock
    // observes both edges without ever creating a hanging test thread.
    struct CleanupProbe {
        workers: std::sync::Weak<Mutex<Vec<Option<CleanupProbe>>>>,
        registry: Arc<Mutex<()>>,
        observations: Arc<Mutex<Vec<(bool, bool)>>>,
        alive: Arc<std::sync::atomic::AtomicUsize>,
    }
    impl CleanupProbe {
        fn new(
            workers: &Arc<Mutex<Vec<Option<Self>>>>,
            registry: &Arc<Mutex<()>>,
            observations: &Arc<Mutex<Vec<(bool, bool)>>>,
            alive: &Arc<std::sync::atomic::AtomicUsize>,
        ) -> Self {
            alive.fetch_add(1, Ordering::Relaxed);
            Self {
                workers: Arc::downgrade(workers),
                registry: registry.clone(),
                observations: observations.clone(),
                alive: alive.clone(),
            }
        }
        fn stop(&mut self) {
            let workers_free = self.workers.upgrade().unwrap().try_lock().is_ok();
            let registry_free = self.registry.try_lock().is_ok();
            lock(&self.observations).push((workers_free, registry_free));
        }
    }
    impl Drop for CleanupProbe {
        fn drop(&mut self) {
            // Decoder Drop can also stop/join: its collection must be unlocked.
            let workers_free = self
                .workers
                .upgrade()
                .is_none_or(|workers| workers.try_lock().is_ok());
            lock(&self.observations).push((workers_free, true));
            self.alive.fetch_sub(1, Ordering::Relaxed);
        }
    }
    impl RetireWorker for CleanupProbe {
        fn request_retirement(&self) {}
        fn retire_before(&mut self, _: Instant) -> Result<(), ()> {
            self.stop();
            Ok(())
        }
    }
    #[test]
    fn confirmed_cleanup_cancels_every_sibling_and_retains_failed_slot_for_retry() {
        struct Worker {
            slot: usize,
            cancelled: Arc<Vec<AtomicBool>>,
            fail: Arc<AtomicBool>,
            retired: Arc<Mutex<Vec<(usize, Instant)>>>,
        }
        impl RetireWorker for Worker {
            fn request_retirement(&self) {
                self.cancelled[self.slot].store(true, Ordering::Release);
            }
            fn retire_before(&mut self, deadline: Instant) -> Result<(), ()> {
                assert!(self
                    .cancelled
                    .iter()
                    .all(|flag| flag.load(Ordering::Acquire)));
                lock(&self.retired).push((self.slot, deadline));
                if self.slot == 0 && self.fail.load(Ordering::Acquire) {
                    Err(())
                } else {
                    Ok(())
                }
            }
        }
        let cancelled = Arc::new((0..2).map(|_| AtomicBool::new(false)).collect::<Vec<_>>());
        let fail = Arc::new(AtomicBool::new(true));
        let retired = Arc::new(Mutex::new(Vec::new()));
        let workers = Mutex::new(
            (0..2)
                .map(|slot| {
                    Some(Worker {
                        slot,
                        cancelled: cancelled.clone(),
                        fail: fail.clone(),
                        retired: retired.clone(),
                    })
                })
                .collect(),
        );
        let deadline = Instant::now();
        let uncertain = AtomicBool::new(false);
        assert!(retire_workers(&workers, deadline, &uncertain).is_err());
        {
            let workers = lock(&workers);
            assert!(workers[0].is_some() && workers[1].is_none());
        }
        assert!(lock(&retired).iter().all(|(_, actual)| *actual == deadline));
        assert!(!uncertain.load(Ordering::Acquire));
        fail.store(false, Ordering::Release);
        retire_workers(&workers, deadline, &uncertain).unwrap();
        assert!(lock(&workers).iter().all(Option::is_none));
    }
    #[test]
    fn compositor_exit_preserves_planned_siblings_but_retires_unplanned_without_locks() {
        for planned in [false, true] {
            let workers = Arc::new(Mutex::new((0..9).map(|_| None).collect::<Vec<_>>()));
            let registry = Arc::new(Mutex::new(()));
            let observations = Arc::new(Mutex::new(Vec::new()));
            let alive = Arc::new(std::sync::atomic::AtomicUsize::new(0));
            lock(&workers)[0] = Some(CleanupProbe::new(
                &workers,
                &registry,
                &observations,
                &alive,
            ));
            let stop = Arc::new(AtomicBool::new(false));
            let uncertain = Arc::new(AtomicBool::new(false));
            drop(CompositorExit {
                session_stop: stop.clone(),
                output_stop: Arc::new(AtomicBool::new(false)),
                planned: Arc::new(AtomicBool::new(planned)),
                cleanup_uncertain: uncertain.clone(),
                cleanup_deadline: Arc::new(Mutex::new(None)),
                workers: workers.clone(),
            });
            assert_eq!(alive.load(Ordering::Relaxed), usize::from(planned));
            assert_eq!(stop.load(Ordering::Acquire), !planned);
            assert!(!uncertain.load(Ordering::Acquire));
            if !planned {
                assert!(lock(&observations).iter().all(|pair| *pair == (true, true)));
            }
            for mut worker in take_workers(&workers) {
                worker.stop();
            }
        }
    }
    #[test]
    fn compositor_panic_overrides_planned_retirement_and_releases_inner_guards_first() {
        let workers = Arc::new(Mutex::new((0..9).map(|_| None).collect::<Vec<_>>()));
        let registry = Arc::new(Mutex::new(()));
        let observations = Arc::new(Mutex::new(Vec::new()));
        let alive = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        lock(&workers)[0] = Some(CleanupProbe::new(
            &workers,
            &registry,
            &observations,
            &alive,
        ));
        let stop = Arc::new(AtomicBool::new(false));
        let uncertain = Arc::new(AtomicBool::new(false));
        assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _exit = CompositorExit {
                session_stop: stop.clone(),
                output_stop: Arc::new(AtomicBool::new(false)),
                planned: Arc::new(AtomicBool::new(true)),
                cleanup_uncertain: uncertain.clone(),
                cleanup_deadline: Arc::new(Mutex::new(None)),
                workers: workers.clone(),
            };
            let _state = lock(&registry);
            panic!("injected composition panic");
        }))
        .is_err());
        assert!(stop.load(Ordering::Acquire) && uncertain.load(Ordering::Acquire));
        assert_eq!(alive.load(Ordering::Relaxed), 0);
        // The registry mutex is poisoned by the injected panic, but the guard
        // still retires workers after releasing it (test via recovered lock).
        assert!(matches!(
            registry.try_lock(),
            Err(std::sync::TryLockError::Poisoned(_))
        ));
        assert!(lock(&workers).iter().all(Option::is_none));
    }
    #[test]
    fn cleanup_probe_drop_allows_collection_to_retire_first() {
        let workers = Arc::new(Mutex::new((0..9).map(|_| None).collect()));
        let registry = Arc::new(Mutex::new(()));
        let observations = Arc::new(Mutex::new(Vec::new()));
        let alive = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let probe = CleanupProbe::new(&workers, &registry, &observations, &alive);
        drop(workers);
        drop(probe);
        assert_eq!(alive.load(Ordering::Relaxed), 0);
        assert_eq!(*lock(&observations), vec![(true, true)]);
    }
    #[test]
    fn cleanup_moves_handles_before_stop_or_drop_breaking_registry_lock_cycle() {
        let workers = Arc::new(Mutex::new((0..9).map(|_| None).collect()));
        let registry = Arc::new(Mutex::new(()));
        let observations = Arc::new(Mutex::new(Vec::new()));
        let alive = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let probe = || CleanupProbe::new(&workers, &registry, &observations, &alive);
        lock(&workers)[0] = Some(probe());
        let registry_attach = lock(&registry);
        let mut held_workers = lock(&workers);
        let mut old_style = held_workers[0].take().unwrap();
        old_style.stop();
        // Release fake authority even if a subsequent assertion fails.
        drop(held_workers);
        drop(registry_attach);
        drop(old_style);
        let old_observation = lock(&observations)[0];
        assert_eq!(old_observation, (false, false));
        lock(&observations).clear();

        lock(&workers)[0] = Some(probe());
        lock(&workers)[8] = Some(probe());
        let registry_attach = lock(&registry);
        let mut one = take_worker(&workers, 0).unwrap();
        let mut rest = take_workers(&workers);
        one.stop();
        for worker in &mut rest {
            worker.stop();
        }
        let stop_observations = lock(&observations).clone();
        drop(registry_attach);
        drop(one);
        drop(rest);
        assert_eq!(stop_observations, vec![(true, false), (true, false)]);
        assert!(lock(&observations).iter().all(|(free, _)| *free));
        assert_eq!(lock(&workers).len(), 9);
        assert!(lock(&workers).iter().all(Option::is_none));
        assert_eq!(alive.load(Ordering::Relaxed), 0);
    }
    #[test]
    fn close_fence_rejects_late_attach_and_drains_earlier_attach() {
        let workers = Arc::new(Mutex::new((0..9).map(|_| None).collect::<Vec<_>>()));
        let registry = Arc::new(Mutex::new(()));
        let observations = Arc::new(Mutex::new(Vec::new()));
        let alive = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let stop = AtomicBool::new(false);
        let attach = |worker| {
            let mut guard = lock(&workers);
            // Same ordering as both production attach callbacks: close fence
            // is checked while the collection lock is held, not before it.
            if stop.load(Ordering::Acquire) {
                return Err(worker);
            }
            assert!(guard[0].is_none());
            guard[0] = Some(worker);
            Ok(())
        };
        assert!(attach(CleanupProbe::new(
            &workers,
            &registry,
            &observations,
            &alive
        ))
        .is_ok());
        stop.store(true, Ordering::Release);
        let retired = take_workers(&workers);
        let rejected = attach(CleanupProbe::new(
            &workers,
            &registry,
            &observations,
            &alive,
        ));
        assert_eq!(retired.len(), 1);
        assert!(rejected.is_err());
        drop(rejected);
        drop(retired);
        assert!(stop.load(Ordering::Acquire));
        assert_eq!(lock(&workers).len(), 9);
        assert!(lock(&workers).iter().all(Option::is_none));
        assert!(lock(&observations).iter().all(|(free, _)| *free));
        assert_eq!(alive.load(Ordering::Relaxed), 0);
    }

    #[test]
    fn compositor_owner_stops_and_joins_on_encoder_startup_failure() {
        let stop = Arc::new(AtomicBool::new(false));
        let finished = Arc::new(AtomicBool::new(false));
        let saw_stop = Arc::new(AtomicBool::new(false));
        let (thread_stop, thread_finished, thread_saw_stop) =
            (stop.clone(), finished.clone(), saw_stop.clone());
        let worker = thread::spawn(move || {
            // Bounded fallback keeps a broken cleanup test from hanging.
            let until = Instant::now() + Duration::from_millis(100);
            while !thread_stop.load(Ordering::Acquire) && Instant::now() < until {
                thread::yield_now();
            }
            thread_saw_stop.store(thread_stop.load(Ordering::Acquire), Ordering::Release);
            thread_finished.store(true, Ordering::Release);
        });
        let result = (|| {
            let _startup = CompositorStartup {
                stop: stop.clone(),
                thread: Some(worker),
            };
            // Same RAII return path as a failed blocking Encoder start/check.
            Err::<(), Error>(Error::OutputFailed)
        })();
        assert_eq!(result, Err(Error::OutputFailed));
        assert!(stop.load(Ordering::Acquire));
        assert!(finished.load(Ordering::Acquire));
        assert!(saw_stop.load(Ordering::Acquire));
    }
    #[test]
    fn compositor_owner_transfer_does_not_cancel_successful_startup() {
        let stop = Arc::new(AtomicBool::new(false));
        let thread_stop = stop.clone();
        let worker = thread::spawn(move || {
            let until = Instant::now() + Duration::from_millis(100);
            while !thread_stop.load(Ordering::Acquire) && Instant::now() < until {
                thread::yield_now();
            }
        });
        let owner = CompositorStartup {
            stop: stop.clone(),
            thread: Some(worker),
        };
        let worker = owner.into_handle();
        assert!(!stop.load(Ordering::Acquire));
        stop.store(true, Ordering::Release);
        worker.join().unwrap();
    }
    #[test]
    fn compositor_waiter_keeps_absolute_deadline_with_bounded_sleep_requests() {
        use std::cell::{Cell, RefCell};
        let began = Instant::now();
        let deadline = began + Duration::from_millis(13);
        for oversleep in [Duration::ZERO, Duration::from_millis(7)] {
            let stop = AtomicBool::new(false);
            let clock = Cell::new(began);
            let requests = RefCell::new(Vec::new());
            wait_compositor_deadline(
                &stop,
                deadline,
                || clock.get(),
                |requested| {
                    assert!(clock.get() < deadline);
                    assert!(requested > Duration::ZERO);
                    assert!(requested <= Duration::from_millis(5));
                    assert!(requested <= deadline - clock.get());
                    requests.borrow_mut().push(requested);
                    clock.set(clock.get() + requested + oversleep);
                },
            );
            assert!(clock.get() >= deadline, "Never return early without stop");
            assert_eq!(deadline, began + Duration::from_millis(13));
            if oversleep.is_zero() {
                assert_eq!(
                    *requests.borrow(),
                    vec![
                        Duration::from_millis(5),
                        Duration::from_millis(5),
                        Duration::from_millis(3)
                    ]
                );
                assert_eq!(clock.get(), deadline);
            } else {
                // This models oversleep to prove bounded requests and no
                // rebasing; it makes no assertion about actual OS scheduling.
                assert_eq!(
                    *requests.borrow(),
                    vec![Duration::from_millis(5), Duration::from_millis(1)]
                );
                assert_eq!(clock.get(), began + Duration::from_millis(20));
            }
        }
    }
    #[test]
    fn compositor_waiter_stops_without_another_clock_or_sleep_request() {
        use std::cell::Cell;
        let began = Instant::now();
        let deadline = began + Duration::from_millis(50);
        let stop = AtomicBool::new(false);
        let clock_reads = Cell::new(0);
        let sleeps = Cell::new(0);
        wait_compositor_deadline(
            &stop,
            deadline,
            || {
                clock_reads.set(clock_reads.get() + 1);
                began
            },
            |requested| {
                assert_eq!(requested, Duration::from_millis(5));
                sleeps.set(sleeps.get() + 1);
                stop.store(true, Ordering::Release);
            },
        );
        assert_eq!(sleeps.get(), 1);
        assert_eq!(clock_reads.get(), 1);
        wait_compositor_deadline(
            &stop,
            deadline,
            || panic!("stopped: no clock sample"),
            |_| panic!("stopped: no sleep"),
        );
        assert_eq!(deadline, began + Duration::from_millis(50));
    }
    #[test]
    fn scene_visual_source_fences_distinguish_nonvisual_focus_audio_changes() {
        let mut state = stream_state();
        for source in &mut state.slots {
            source.generation = 0;
        }
        let pixels: Arc<[u8]> = vec![0; 16 * 4 * 3].into();
        let old = state.capture_fence();
        state.capture_video = Some(Arc::new(CaptureVideoFeed::new(
            pixels.clone(),
            old,
            Instant::now(),
        )));
        assert!(state
            .capture_video
            .as_ref()
            .unwrap()
            .publish(pixels.clone(), old, Instant::now())
            .unwrap());
        state.focus = 0;
        state.audio_policy = AudioPolicy::Muted;
        state.advance_control().unwrap();
        let nonvisual = state.capture_fence();
        assert_eq!(nonvisual.control_epoch, old.control_epoch + 1);
        assert_eq!(nonvisual.visual_revision, old.visual_revision);
        assert_eq!(nonvisual.source_revisions, old.source_revisions);
        // The actual production prepublication barrier admits a captured
        // snapshot across nonvisual controls, preserving its original metadata.
        assert!(state
            .publish_capture(pixels.clone(), old, Instant::now())
            .unwrap());
        state.focus = 1;
        state.advance_control().unwrap();
        assert!(state
            .publish_capture(pixels.clone(), old, Instant::now())
            .unwrap());
        assert!(state
            .capture_video
            .as_ref()
            .unwrap()
            .publish(pixels.clone(), nonvisual, Instant::now())
            .unwrap());
        state.geometry = ValidatedGeometry::new(
            state.geometry.canvas(),
            8,
            state.geometry.rects(),
            OverlapPolicy::Disjoint,
        )
        .unwrap();
        state.advance_control().unwrap();
        let visual = state.capture_fence();
        assert_eq!(visual.visual_revision, 8);
        assert!(!state
            .publish_capture(pixels.clone(), nonvisual, Instant::now())
            .unwrap());
        let future = CaptureFence {
            control_epoch: visual.control_epoch + 1,
            ..visual
        };
        assert!(!state
            .publish_capture(pixels.clone(), future, Instant::now())
            .unwrap());
        assert!(state
            .capture_video
            .as_ref()
            .unwrap()
            .publish(pixels.clone(), nonvisual, Instant::now())
            .is_err());
        assert!(state
            .capture_video
            .as_ref()
            .unwrap()
            .publish(pixels, visual, Instant::now())
            .unwrap());
        state.slots[2].generation += 1;
        state.slots[2].stopped = true;
        state.advance_control().unwrap();
        let replacement = state.capture_fence();
        assert_eq!(
            replacement.source_revisions[2],
            visual.source_revisions[2] + 1
        );
        assert_eq!(replacement.stopped_mask, 1 << 2);
        assert_eq!(replacement.visible_mask, 15);
        // Active writer admission/black transition and partial-frame behavior
        // are tested at the encoder boundary, not fabricated in an unbound feed.
    }
    #[test]
    fn bootstrap_rejects_any_real_source_even_without_a_decoder_pid() {
        let mut state = stream_state();
        assert!(!state.bootstrap_sources_empty());
        for source in &mut state.slots {
            source.generation = 0;
            source.video = Arc::new(
                LatestFrame::new(
                    FrameSpec {
                        width: 2,
                        height: 2,
                    },
                    0,
                )
                .unwrap(),
            );
            source.audio = Arc::new(AudioQueue::new(0));
        }
        assert!(state.bootstrap_sources_empty());
        state.slots[0]
            .video
            .publish(0, 1, vec![0; 12], Instant::now())
            .unwrap();
        assert!(!state.bootstrap_sources_empty());
    }
    #[test]
    fn capture_wall_stamp_follows_frozen_frame_views_without_changing_source_sequence() {
        let state = stream_state();
        let received = Instant::now();
        state.slots[2]
            .video
            .publish(5, 17, vec![3; 2 * 2 * 3], received)
            .unwrap();
        let (frames, captured_at) = freeze_frames(&state.slots, 4, Duration::from_secs(1));
        let frame = match &frames[2].1 {
            FrameView::Ready(frame) => frame,
            _ => panic!("expected frozen source frame"),
        };
        assert_eq!(frame.sequence, 17);
        assert!(captured_at >= frame.received_at);
        let (again, next_capture) = freeze_frames(&state.slots, 4, Duration::from_secs(1));
        let again = match &again[2].1 {
            FrameView::Ready(frame) => frame,
            _ => panic!("expected unchanged frozen source"),
        };
        assert_eq!(again.sequence, 17);
        assert!(next_capture >= captured_at);
        // A new actual observation may be visually static. Encoder reuse, not
        // this observation, must retain the earlier capture stamp/sequence.
    }

    #[test]
    fn audio_callback_never_competes_with_the_session_clock_publisher() {
        let clock = PresentationClock::new();
        let route = AtomicU64::new(0);
        let queues = (0..9)
            .map(|_| Arc::new(AudioQueue::new(0)))
            .collect::<Vec<_>>();
        let first = Instant::now();
        assert_eq!(
            mix_audio_tick(&clock, &route, &queues, first),
            vec![0; 1920]
        );
        assert_eq!(clock.current().unwrap(), None);
        clock.publish(first).unwrap();
        for word in [0, (1 << 4) | 1] {
            route.store(word, Ordering::Release);
            mix_audio_tick(&clock, &route, &queues, first + Duration::from_secs(8));
            assert_eq!(clock.current().unwrap(), Some(first));
        }
        clock.publish(first + Duration::from_millis(20)).unwrap();
        assert_eq!(clock.publish(first), Err(DecoderError::InvalidInput));
        assert_eq!(
            mix_audio_tick(&clock, &route, &queues, first),
            vec![0; 1920]
        );
        assert_eq!(clock.current(), Err(DecoderError::InvalidInput));
    }
    fn stream_state() -> State {
        let canvas = CanvasSpec {
            width: 16,
            height: 4,
            fps: 10,
        };
        let rects = (0..4)
            .map(|slot| ImportedRect {
                slot_id: slot,
                x: u32::from(slot) * 4,
                y: 0,
                width: 4,
                height: 4,
                z: slot,
            })
            .collect::<Vec<_>>();
        let geometry = ValidatedGeometry::new(canvas, 7, &rects, OverlapPolicy::Disjoint).unwrap();
        let slots = (0..9)
            .map(|slot| Slot {
                generation: if slot == 2 { 5 } else { 0 },
                pid: None,
                pixel_rate: 0,
                stopped: false,
                video: Arc::new(
                    LatestFrame::new(
                        FrameSpec {
                            width: 2,
                            height: 2,
                        },
                        if slot == 2 { 5 } else { 0 },
                    )
                    .unwrap(),
                ),
                audio: Arc::new(AudioQueue::new(if slot == 2 { 5 } else { 0 })),
            })
            .collect();
        State {
            geometry,
            control_epoch: 0,
            focus_revision: 11,
            audio_revision: 13,
            focus: 2,
            audio_policy: AudioPolicy::FollowsFocus,
            slots,
            audio_route: Arc::new(AtomicU64::new(0)),
            output_bootstrap: false,
            capture_video: Some(Arc::new(CaptureVideoFeed::new(
                Arc::<[u8]>::from(vec![0; 8 * 8 * 3]),
                CaptureFence {
                    control_epoch: 0,
                    visual_revision: 7,
                    stopped_mask: 0,
                    visible_mask: 15,
                    source_revisions: [0, 0, 5, 0, 0, 0, 0, 0, 0],
                },
                Instant::now(),
            ))),
        }
    }
    #[test]
    fn output_bootstrap_preserves_source_bindings_and_rejects_live_capture() {
        let mut state = stream_state();
        let runtime_id = 73;
        let intent = capture_stream_binding(&state, runtime_id, 2, 5).unwrap();
        let original = state.capture_fence();
        state.output_bootstrap = true;
        state.suspend_output_audio();
        let black = state.output_fence();
        assert_eq!(black.source_revisions, [0; 9]);
        assert_eq!(state.capture_fence(), original);
        assert_eq!(state.audio_route.load(Ordering::Acquire), 0);
        assert!(!state.slots[2].audio.stats(5).selected);
        assert!(!state.bootstrap_sources_empty());
        assert!(validate_stream_binding(&state, runtime_id, &intent).is_ok());
        assert_eq!(
            validate_stream_binding(&state, runtime_id + 1, &intent),
            Err(Error::StaleRevision)
        );
        let pixels: Arc<[u8]> = vec![0; 16 * 4 * 3].into();
        state.capture_video = Some(Arc::new(CaptureVideoFeed::new(
            pixels.clone(),
            black,
            Instant::now(),
        )));
        assert!(!state
            .publish_capture(pixels.clone(), original, Instant::now())
            .unwrap());
        assert!(state
            .publish_capture(pixels.clone(), black, Instant::now())
            .unwrap());
        state.activate_output().unwrap();
        assert_eq!(
            state.capture_fence().source_revisions,
            original.source_revisions
        );
        assert_eq!(state.focus_revision, intent.focus_revision);
        assert_eq!(state.audio_revision, intent.audio_revision);
        assert_eq!(state.slots[2].generation, 5);
        assert!(state.slots[2].audio.stats(5).selected);
        assert_eq!(state.audio_route.load(Ordering::Acquire), (6 << 4) | 3);
        assert!(!state
            .publish_capture(pixels, black, Instant::now())
            .unwrap());
        assert!(validate_stream_binding(&state, runtime_id, &intent).is_ok());
    }
    #[test]
    fn retired_output_snapshot_cannot_report_a_live_encoder_or_media() {
        let snapshot = unavailable_output(51);
        assert_eq!(snapshot.generation, 51);
        assert_eq!(snapshot.pid, 0);
        assert_eq!(snapshot.state, EncoderState::Stopped);
        assert_eq!(snapshot.hls_sequence, None);
        assert_eq!(snapshot.frames, 0);
        assert_eq!(snapshot.audio_samples_written, 0);
    }
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    #[test]
    fn failed_retirement_retains_real_owner_and_feed_until_cleanup_retry() {
        let _serial = Encoder::capacity_test_lock();
        let directory = std::env::temp_dir().join(format!(
            "ottplay-retirement-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::write(&directory, b"injected non-directory cleanup failure").unwrap();
        struct Cleanup(PathBuf);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                let _ = std::fs::remove_file(&self.0);
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }
        let _cleanup = Cleanup(directory.clone());
        let state = Arc::new(Mutex::new(stream_state()));
        let feed = lock(&state).capture_video.as_ref().unwrap().clone();
        let weak = Arc::downgrade(&feed);
        let mut session = Session {
            config: Config::new("no-tools".into(), "no-tools".into(), "no-tools".into()),
            state,
            decoders: Arc::new(Mutex::new((0..9).map(|_| None).collect())),
            stop: Arc::new(AtomicBool::new(false)),
            capacity: None,
            cleanup_uncertain: Arc::new(AtomicBool::new(false)),
            output: Some(OutputEpoch {
                encoder: Encoder::cleanup_test_encoder(directory.clone()),
                _capture_video: feed,
                stop: Arc::new(AtomicBool::new(false)),
                planned_retirement: Arc::new(AtomicBool::new(false)),
                compositor: None,
                compositor_join_failed: false,
                cleanup_uncertain: Arc::new(AtomicBool::new(false)),
                cleanup_deadline: Arc::new(Mutex::new(None)),
            }),
            runtime_id: 17,
            absolute_end: Instant::now() + Duration::from_secs(30),
            retired_snapshot: unavailable_output(0),
            retired_failure: None,
            retired_directory: PathBuf::new(),
            owned_pids: Vec::new(),
            audio_callback_misses: Arc::new(AtomicU64::new(0)),
            presentation_clock: Arc::new(PresentationClock::new()),
            clock_driver: None,
        };
        session
            .output
            .as_mut()
            .unwrap()
            .encoder
            .give_test_capacity();
        assert_eq!(
            session.retire_output(Instant::now() + Duration::from_secs(5)),
            Err(Error::OutputFailed)
        );
        assert!(
            session.output.is_some(),
            "actual encoder owner must remain, not just its snapshot"
        );
        assert!(session.stop.load(Ordering::Acquire));
        assert!(weak.upgrade().is_some());
        assert!(lock(&session.state).capture_video.is_some());
        assert_eq!(session.snapshot().output_state, EncoderState::Failed);
        assert_eq!(session.rotate_output(71).err(), Some(Error::Stopped));
        assert!(session.shutdown().is_err());
        assert!(session.output.is_some() && weak.upgrade().is_some());
        // Repair only this exact owned test path, then verify an explicit retry
        // releases the owner/feed after actual remove_dir_all succeeds.
        std::fs::remove_file(&directory).unwrap();
        std::fs::create_dir(&directory).unwrap();
        let receipt = session.shutdown().unwrap();
        assert!(receipt.output_removed);
        assert!(session.output.is_none());
        assert!(weak.upgrade().is_none());
        assert!(directory_removed(&directory));
    }
    // This is a separate opt-in real-media qualification, not an ordinary unit
    // test or evidence of the production broker adapter. Supply three owned,
    // 90-second synthetic MPEG-TS inputs from the existing strict media fixture.
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    #[test]
    #[ignore = "owned FFmpeg/FFprobe, three synthetic TS inputs and external process-group deadline required"]
    fn real_stream_output_rotation_preserves_sibling_decoders() {
        use std::{
            fs::File,
            io::{Read, Write},
            os::{fd::OwnedFd, unix::net::UnixStream},
        };
        struct Gate {
            context: BoundContext,
            active: Mutex<bool>,
        }
        impl decoder::PublicationAuthority for Gate {
            fn attach(
                &self,
                context: &BoundContext,
                operation: &mut dyn FnMut() -> Result<(), DecoderError>,
            ) -> Result<(), DecoderError> {
                let mut active = lock(&self.active);
                if context != &self.context || *active {
                    return Err(DecoderError::PublicationDenied);
                }
                operation()?;
                *active = true;
                Ok(())
            }
            fn publish(
                &self,
                context: &BoundContext,
                operation: &mut dyn FnMut() -> Result<(), DecoderError>,
            ) -> Result<(), DecoderError> {
                let active = lock(&self.active);
                if context != &self.context || !*active {
                    return Err(DecoderError::PublicationDenied);
                }
                operation()
            }
        }
        struct Pump {
            cancel: Arc<AtomicBool>,
            worker: Option<JoinHandle<()>>,
        }
        impl Pump {
            fn pair(bytes: Arc<[u8]>, paced: bool) -> (File, Self) {
                let (reader, mut writer) = UnixStream::pair().unwrap();
                writer.set_nonblocking(true).unwrap();
                let cancel = Arc::new(AtomicBool::new(false));
                let stopped = cancel.clone();
                let worker = thread::spawn(move || {
                    let began = Instant::now();
                    let deadline = began + Duration::from_secs(95);
                    let mut offset = 0;
                    while offset < bytes.len()
                        && !stopped.load(Ordering::Acquire)
                        && Instant::now() < deadline
                    {
                        if paced
                            && began.elapsed().as_secs_f64()
                                < offset as f64 * 90.0 / bytes.len() as f64
                        {
                            thread::sleep(Duration::from_millis(2));
                            continue;
                        }
                        let end = (offset + 7 * 188).min(bytes.len());
                        match writer.write(&bytes[offset..end]) {
                            Ok(0) => break,
                            Ok(written) => offset += written,
                            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                                thread::sleep(Duration::from_millis(2))
                            }
                            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {
                                continue
                            }
                            Err(_) => break,
                        }
                    }
                });
                let reader: OwnedFd = reader.into();
                (
                    File::from(reader),
                    Self {
                        cancel,
                        worker: Some(worker),
                    },
                )
            }
            fn finish(&mut self) {
                self.cancel.store(true, Ordering::Release);
                if let Some(worker) = self.worker.take() {
                    worker.join().unwrap();
                }
            }
        }
        impl Drop for Pump {
            fn drop(&mut self) {
                self.cancel.store(true, Ordering::Release);
                if let Some(worker) = self.worker.take() {
                    let _ = worker.join();
                }
            }
        }
        fn path(name: &str) -> PathBuf {
            let path = PathBuf::from(std::env::var_os(name).expect(name));
            assert!(path.is_absolute());
            path
        }
        fn progressed(session: &Session, prior: &[u64], deadline: Instant) -> Snapshot {
            loop {
                let current = session.snapshot();
                assert!(
                    session.output_failure().is_none(),
                    "{:?}",
                    session.output_failure_detail()
                );
                if current
                    .slots
                    .iter()
                    .take(3)
                    .zip(prior)
                    .all(|(slot, frames)| slot.frames > *frames)
                    && current.hls_sequence.is_some()
                {
                    return current;
                }
                assert!(
                    Instant::now() < deadline,
                    "rotation progress deadline: {current:?}"
                );
                thread::sleep(Duration::from_millis(50));
            }
        }
        let root = path("OTTPLAY_MULTIVIEW_ROTATE_CASE_DIR");
        std::fs::create_dir(&root).expect("fresh owned output root required");
        let canvas = CanvasSpec {
            width: 384,
            height: 288,
            fps: 10,
        };
        let rects = (0..3)
            .map(|slot| ImportedRect {
                slot_id: slot,
                x: u32::from(slot) * 128,
                y: 0,
                width: 128,
                height: 288,
                z: slot,
            })
            .collect::<Vec<_>>();
        let geometry = ValidatedGeometry::new(canvas, 1, &rects, OverlapPolicy::Disjoint).unwrap();
        let mut config = Config::new(
            path("OTTPLAY_MULTIVIEW_FFMPEG"),
            path("OTTPLAY_MULTIVIEW_FFPROBE"),
            root.clone(),
        );
        config.require_broker_grants = true;
        config.max_duration = Duration::from_secs(90);
        config.idle_timeout = Duration::from_secs(90);
        let deadline = Instant::now() + Duration::from_secs(80);
        let mut session = Session::start(config, geometry).unwrap();
        let mut producers = Vec::new();
        for (slot, name) in [
            "OTTPLAY_MULTIVIEW_ROTATE_INPUT_A",
            "OTTPLAY_MULTIVIEW_ROTATE_INPUT_B",
            "OTTPLAY_MULTIVIEW_ROTATE_INPUT_C",
        ]
        .iter()
        .enumerate()
        {
            let source_path = path(name);
            assert!(std::fs::symlink_metadata(&source_path)
                .unwrap()
                .file_type()
                .is_file());
            let mut payload = Vec::new();
            File::open(source_path)
                .unwrap()
                .take(16 * 1024 * 1024 + 1)
                .read_to_end(&mut payload)
                .unwrap();
            assert!(!payload.is_empty() && payload.len() <= 16 * 1024 * 1024);
            let payload: Arc<[u8]> = payload.into();
            let prep = session.capture_stream_preparation(slot as u8, 0).unwrap();
            let context = prep.bound_context();
            let grant = GrantedStream::from_authorized_stream(
                context,
                deadline,
                Arc::new(AtomicBool::new(false)),
                Arc::new(Gate {
                    context,
                    active: Mutex::new(false),
                }),
            )
            .unwrap();
            let (reader, mut probe_pump) = Pump::pair(payload.clone(), false);
            let prepared = decoder::probe_stream(
                prep.decoder_config(),
                &grant,
                grant.wrap_probe(reader).unwrap(),
                prep.stop_token(),
                Instant::now() + Duration::from_secs(5),
            );
            probe_pump.finish();
            let (reader, producer) = Pump::pair(payload, true);
            producers.push(producer);
            assert_eq!(
                session
                    .commit_stream(
                        prep,
                        &grant,
                        prepared.unwrap(),
                        grant.wrap_decode(reader).unwrap()
                    )
                    .unwrap(),
                1
            );
        }
        let mut before = progressed(&session, &[0; 3], deadline);
        let runtime = before.runtime;
        // The explicit slot preparation survives only the output change; a
        // subsequent source CAS still rejects any unrelated source replacement.
        let intent = session.capture_stream_preparation(2, 1).unwrap();
        for _ in 0..2 {
            let old_directory = session.output_directory().to_path_buf();
            let receipt = session.rotate_output(before.output_generation).unwrap();
            assert_eq!(receipt.runtime_id, runtime);
            assert_eq!(receipt.retired_generation, before.output_generation);
            assert_ne!(receipt.new_generation, receipt.retired_generation);
            assert!(receipt.old_output_removed && !old_directory.exists());
            let prior_frames = before
                .slots
                .iter()
                .take(3)
                .map(|slot| slot.frames)
                .collect::<Vec<_>>();
            let after = progressed(&session, &prior_frames, deadline);
            assert_eq!(after.runtime, runtime);
            assert_eq!(after.output_generation, receipt.new_generation);
            assert_ne!(after.encoder_pid, before.encoder_pid);
            for (old, new) in before.slots.iter().take(3).zip(&after.slots) {
                assert_eq!(old.decoder_pid, new.decoder_pid);
                assert_eq!(old.source_revision, new.source_revision);
            }
            assert_eq!(
                session.rotate_output(receipt.retired_generation).err(),
                Some(Error::StaleRevision)
            );
            assert!(!session.stop.load(Ordering::Acquire));
            assert!(validate_stream_binding(
                &lock(&session.state),
                runtime,
                &intent.bound_context()
            )
            .is_ok());
            before = after;
        }
        let receipt = session.shutdown().unwrap();
        assert!(receipt.output_removed);
        for producer in &mut producers {
            producer.finish();
        }
        std::fs::remove_dir(&root).unwrap();
    }
    #[test]
    fn stream_preparation_keeps_explicit_target_when_other_focus_audio_and_sources_change() {
        let mut state = stream_state();
        let binding = capture_stream_binding(&state, 73, 2, 5).unwrap();
        assert_eq!(
            (
                binding.slot_id,
                binding.focus_revision,
                binding.audio_revision
            ),
            (2, 11, 13)
        );
        state.focus = 0;
        state.focus_revision += 1;
        state.audio_policy = AudioPolicy::Slot(3);
        state.audio_revision += 1;
        state.slots[1].generation += 1;
        assert_eq!(validate_stream_binding(&state, 73, &binding), Ok(()));
        assert_eq!(binding.slot_id, 2);
        assert_eq!(state.focus, 0);
        assert_eq!(state.audio_policy, AudioPolicy::Slot(3));
        assert_eq!(state.slots[2].generation, 5);
    }
    #[test]
    fn stream_preparation_rejects_stale_runtime_geometry_target_source_and_hidden_target() {
        let mut state = stream_state();
        let binding = capture_stream_binding(&state, 73, 2, 5).unwrap();
        assert_eq!(
            capture_stream_binding(&state, 73, 4, 0),
            Err(Error::InvalidSlot)
        );
        assert_eq!(
            capture_stream_binding(&state, 73, 2, 4),
            Err(Error::StaleRevision)
        );
        assert_eq!(
            validate_stream_binding(&state, 74, &binding),
            Err(Error::StaleRevision)
        );
        state.slots[2].generation += 1;
        assert_eq!(
            validate_stream_binding(&state, 73, &binding),
            Err(Error::StaleRevision)
        );
        state.slots[2].generation = 5;
        state.geometry = ValidatedGeometry::new(
            state.geometry.canvas(),
            8,
            state.geometry.rects(),
            OverlapPolicy::Disjoint,
        )
        .unwrap();
        assert_eq!(
            validate_stream_binding(&state, 73, &binding),
            Err(Error::StaleRevision)
        );
        state.geometry = ValidatedGeometry::new(
            state.geometry.canvas(),
            7,
            &state.geometry.rects()[..2],
            OverlapPolicy::Disjoint,
        )
        .unwrap();
        assert_eq!(
            validate_stream_binding(&state, 73, &binding),
            Err(Error::StaleRevision)
        );
    }
    #[test]
    fn owned_stream_preparation_carries_original_proof_and_session_specific_stop_token() {
        let state = stream_state();
        let binding = capture_stream_binding(&state, 73, 2, 5).unwrap();
        let stop = Arc::new(AtomicBool::new(false));
        let preparation = StreamPreparation {
            binding,
            config: DecoderConfig {
                ffmpeg: "/not/executed".into(),
                ffprobe: "/not/executed".into(),
                frame_spec: FrameSpec {
                    width: 2,
                    height: 2,
                },
                fps: 10,
            },
            stop: stop.clone(),
        };
        assert!(preparation.belongs_to(&stop));
        assert!(!preparation.belongs_to(&Arc::new(AtomicBool::new(false))));
        let mut returned = preparation.bound_context();
        returned.slot_id = 1;
        assert_ne!(preparation.bound_context(), returned);
        assert_eq!(preparation.bound_context(), binding);
        assert_eq!(preparation.decoder_config().fps, 10);
        stop.store(true, Ordering::Release);
        assert!(preparation.stop_token().load(Ordering::Acquire));
    }

    #[test]
    fn buffer_reservation_includes_conversion_transients_and_rejects_overflow_inputs() {
        let canvas = CanvasSpec {
            width: 960,
            height: 540,
            fps: 10,
        };
        let frame = FrameSpec {
            width: 320,
            height: 180,
        };
        let required = required_frame_buffer_bytes(frame, canvas).unwrap();
        assert_eq!(required, 16_600_576);
        assert_eq!(16 * 1024 * 1024 - required, 176_640);
        assert!(required_frame_buffer_bytes(
            FrameSpec {
                width: u32::MAX,
                height: u32::MAX
            },
            canvas
        )
        .is_err());
        assert!(required_frame_buffer_bytes(
            frame,
            CanvasSpec {
                width: u32::MAX,
                height: u32::MAX,
                fps: 10
            }
        )
        .is_err());
        let geometry = ValidatedGeometry::new(
            canvas,
            1,
            &[ImportedRect {
                slot_id: 0,
                x: 0,
                y: 0,
                width: 960,
                height: 540,
                z: 0,
            }],
            OverlapPolicy::Disjoint,
        )
        .unwrap();
        let mut config = Config::new(
            PathBuf::from("no-ffmpeg-must-start"),
            PathBuf::from("no-probe-must-start"),
            PathBuf::from("no-output-must-open"),
        );
        // The default budget still admits the six-canvas reservation without tools.
        assert_eq!(config.frame_memory_budget, 16 * 1024 * 1024);
        assert!(required <= config.frame_memory_budget);
        // Raising the configured budget beyond the existing cap remains invalid.
        config.frame_memory_budget = 64 * 1024 * 1024 + 1;
        assert_eq!(
            Session::start(config.clone(), geometry.clone()).err(),
            Some(Error::InvalidConfig)
        );
        // Exactly the previous five-canvas budget must reject before tool startup.
        config.frame_memory_budget = 15_045_376;
        assert_eq!(
            Session::start(config, geometry).err(),
            Some(Error::InvalidConfig)
        );
    }
}
