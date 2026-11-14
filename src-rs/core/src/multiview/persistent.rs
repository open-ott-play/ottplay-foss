//! Persistent local-source compositor. No network listener or provider selection.
//! Sources are independently decoded; raster geometry is imported from its owner.
//! Public broker/RPC admission remains a separate, unwired authorization gate.
use super::{
    decoder::{
        self, AudioQueue, AudioQueueStats, BoundContext, Decoder, DecoderConfig, DecoderError,
        GrantedFile, GrantedStream, PreparedStreamInfo, PresentationClock, StreamInput,
    },
    encoder::{Encoder, EncoderConfig, EncoderState},
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
    Ok(slot * 36 + output * 4 + 1024 * 1024)
}

struct Slot {
    generation: u64,
    pid: Option<u32>,
    pixel_rate: u64,
    stopped: bool,
    video: Arc<LatestFrame>,
    audio: Arc<AudioQueue>,
}
struct State {
    geometry: ValidatedGeometry,
    // Reject a composed tick captured before any control mutation.
    control_epoch: u64,
    focus_revision: u64,
    audio_revision: u64,
    focus: u8,
    audio_policy: AudioPolicy,
    slots: Vec<Slot>,
    audio_route: Arc<AtomicU64>,
}
impl State {
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
        let selected = self.audio_slot();
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

// The output tick advances regardless of mute/route. Publishing releases its
// short clock lock before reading a route or entering any source FIFO.
fn mix_audio_tick(
    clock: &PresentationClock,
    route: &AtomicU64,
    queues: &[Arc<AudioQueue>],
    tick: Instant,
) -> Vec<i16> {
    if clock.publish(tick).is_err() {
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

pub struct Session {
    config: Config,
    state: Arc<Mutex<State>>,
    decoders: Arc<Mutex<Vec<Option<Decoder>>>>,
    stop: Arc<AtomicBool>,
    compositor: Option<JoinHandle<()>>,
    encoder: Encoder,
    owned_pids: Vec<u32>,
    audio_callback_misses: Arc<AtomicU64>,
    presentation_clock: Arc<PresentationClock>,
}

impl Session {
    pub fn start(config: Config, geometry: ValidatedGeometry) -> Result<Self, Error> {
        let canvas = geometry.canvas();
        if config.frame_spec.width == 0
            || config.frame_spec.height == 0
            || config.frame_spec.width > 640
            || config.frame_spec.height > 360
        {
            return Err(Error::InvalidConfig);
        }
        let canvas_bytes = u64::from(canvas.width) * u64::from(canvas.height) * 3;
        // Reader + mailbox + render snapshot + Vec-to-Arc conversion transient
        // per slot; likewise four canvas buffers; PCM and small-buffer allowance.
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
        let audio_queues: Vec<_> = slots.iter().map(|source| source.audio.clone()).collect();
        let audio_route = Arc::new(AtomicU64::new(0));
        let state = Arc::new(Mutex::new(State {
            geometry: geometry.clone(),
            control_epoch: 0,
            focus_revision: 0,
            audio_revision: 0,
            focus: 0,
            audio_policy: AudioPolicy::FollowsFocus,
            slots,
            audio_route: audio_route.clone(),
        }));
        let stop = Arc::new(AtomicBool::new(false));
        let video = Arc::new(Mutex::new(Arc::<[u8]>::from(vec![
            0;
            canvas_bytes as usize
        ])));
        lock(&state).update_audio_metrics();
        let audio_callback_misses = Arc::new(AtomicU64::new(0));
        let presentation_clock = Arc::new(PresentationClock::new());
        let audio_clock = presentation_clock.clone();
        let audio = Arc::new(move |tick: Instant| {
            mix_audio_tick(&audio_clock, &audio_route, &audio_queues, tick)
        });
        let encoder = Encoder::start_timed_audio(
            EncoderConfig {
                ffmpeg: config.ffmpeg.clone(),
                mkfifo: config.mkfifo.clone(),
                output_root: config.output_root.clone(),
                canvas,
                startup_timeout: config.startup_timeout,
                stall_timeout: config.stale_after,
                max_duration: config.max_duration,
                idle_timeout: config.idle_timeout,
                max_disk_bytes: config.max_disk_bytes,
            },
            video.clone(),
            audio,
            stop.clone(),
        )
        .map_err(|_| Error::OutputFailed)?;
        if presentation_clock
            .current()
            .map_err(|_| Error::OutputFailed)?
            .is_none()
        {
            return Err(Error::OutputFailed);
        }
        let decoders = Arc::new(Mutex::new(
            (0..9).map(|_| None).collect::<Vec<Option<Decoder>>>(),
        ));
        let (compose_state, compose_stop, compose_decoders) =
            (state.clone(), stop.clone(), decoders.clone());
        let stale_after = config.stale_after;
        let compositor = thread::spawn(move || {
            let period = Duration::from_secs_f64(1.0 / f64::from(canvas.fps));
            let mut next = Instant::now();
            while !compose_stop.load(Ordering::Acquire) {
                let (geometry, epoch, frames) = {
                    let state = lock(&compose_state);
                    let now = Instant::now();
                    (
                        state.geometry.clone(),
                        state.control_epoch,
                        state
                            .slots
                            .iter()
                            .enumerate()
                            .filter(|(slot, _)| *slot < state.geometry.rects().len())
                            .map(|(slot, source)| {
                                (slot as u8, source.video.snapshot(now, stale_after))
                            })
                            .collect::<Vec<_>>(),
                    )
                };
                let mut pixels = Vec::new();
                if compose_into(&geometry, &frames, &mut pixels).is_err() {
                    compose_stop.store(true, Ordering::Release);
                    break;
                }
                {
                    let state = lock(&compose_state);
                    if state.control_epoch == epoch {
                        *lock(&video) = pixels.into();
                    }
                }
                next += period;
                let now = Instant::now();
                if next > now {
                    thread::sleep(next - now);
                } else {
                    next = now;
                }
            }
            // Encoder failure/lease expiry also reaps all input children, without
            // requiring a subsequent client command to discover the failure.
            for mut worker in take_workers(&compose_decoders) {
                worker.stop();
            }
        });
        let encoder_pid = encoder.snapshot().pid;
        Ok(Self {
            config,
            state,
            decoders,
            stop,
            compositor: Some(compositor),
            encoder,
            owned_pids: vec![encoder_pid],
            audio_callback_misses,
            presentation_clock,
        })
    }

    fn check(&self) -> Result<(), Error> {
        if self.stop.load(Ordering::Acquire) {
            Err(Error::Stopped)
        } else {
            Ok(())
        }
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
        let binding = capture_stream_binding(
            &state,
            self.encoder.snapshot().generation,
            slot,
            expected_source_revision,
        )?;
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
            validate_stream_binding(&state, self.encoder.snapshot().generation, &binding)?;
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
        let old = { lock(&self.decoders)[slot].take() };
        if let Some(mut old) = old {
            old.stop();
        }
        let (video, audio) = {
            let mut state = lock(&self.state);
            validate_stream_binding(&state, self.encoder.snapshot().generation, &binding)?;
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
            state.control_epoch += 1;
            result
        };
        let worker = match Decoder::start_stream_with_clock(
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
            Err(_) => {
                let _ = video.mark_failed(generation);
                lock(&self.state).slots[slot].pixel_rate = 0;
                return Err(Error::SourceFailed);
            }
        };
        let pid = worker.pid();
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
            if let Some(mut worker) = pending.take() {
                worker.stop();
            }
            let attached = { lock(&self.decoders)[slot].take() };
            if let Some(mut worker) = attached {
                worker.stop();
            }
            let _ = video.mark_failed(generation);
            let mut state = lock(&self.state);
            state.slots[slot].pid = None;
            state.slots[slot].pixel_rate = 0;
            state.control_epoch += 1;
            return Err(Error::SourceFailed);
        }
        self.owned_pids.push(pid);
        self.encoder.touch();
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
                runtime: self.encoder.snapshot().generation,
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
        if let Some(mut old) = take_worker(&self.decoders, usize::from(slot)) {
            old.stop();
        }
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
            state.control_epoch += 1;
            result
        };
        match Decoder::start(&config, source, generation, video.clone(), audio) {
            Ok(worker) => {
                let pid = worker.pid();
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
                    if let Some(mut worker) = pending.take() {
                        worker.stop();
                    }
                    if let Some(mut worker) = take_worker(&self.decoders, usize::from(slot)) {
                        worker.stop();
                    }
                    let _ = video.mark_failed(generation);
                    let mut state = lock(&self.state);
                    state.slots[usize::from(slot)].pid = None;
                    state.slots[usize::from(slot)].pixel_rate = 0;
                    state.control_epoch += 1;
                    return Err(Error::SourceFailed);
                }
                self.owned_pids.push(pid);
                self.encoder.touch();
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
        if let Some(mut old) = take_worker(&self.decoders, usize::from(slot)) {
            old.stop();
        }
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
        state.control_epoch += 1;
        state.update_audio_metrics();
        self.encoder.touch();
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
        state.control_epoch += 1;
        state.update_audio_metrics();
        self.encoder.touch();
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
        state.control_epoch += 1;
        state.update_audio_metrics();
        self.encoder.touch();
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
        state.control_epoch += 1;
        state.update_audio_metrics();
        self.encoder.touch();
        Ok(state.audio_revision)
    }
    pub fn snapshot(&self) -> Snapshot {
        let output = self.encoder.snapshot();
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
            runtime: output.generation,
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
        self.encoder.output_directory()
    }
    pub fn shutdown(&mut self) -> Result<ShutdownReceipt, Error> {
        self.stop.store(true, Ordering::Release);
        let result = self.encoder.stop().map_err(|_| Error::OutputFailed);
        if let Some(thread) = self.compositor.take() {
            let _ = thread.join();
        }
        for mut worker in take_workers(&self.decoders) {
            worker.stop();
        }
        result?;
        Ok(ShutdownReceipt {
            owned_pids: self.owned_pids.clone(),
            output_removed: !self.output_directory().exists(),
        })
    }
}
impl Drop for Session {
    fn drop(&mut self) {
        let _ = self.shutdown();
    }
}

#[cfg(test)]
mod tests {
    use super::super::geometry::{ImportedRect, OverlapPolicy};
    use super::*;

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
    fn presentation_tick_advances_before_muted_or_absent_owner_return() {
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
        assert_eq!(clock.current().unwrap(), Some(first));
        route.store((1 << 4) | 1, Ordering::Release);
        let second = first + Duration::from_millis(20);
        mix_audio_tick(&clock, &route, &queues, second);
        assert_eq!(clock.current().unwrap(), Some(second));
        route.store(0, Ordering::Release);
        let third = second + Duration::from_millis(20);
        mix_audio_tick(&clock, &route, &queues, third);
        mix_audio_tick(&clock, &route, &queues, third);
        assert_eq!(clock.current().unwrap(), Some(third));
        assert_eq!(clock.publish(first), Err(DecoderError::InvalidInput));
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
        }
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
        assert_eq!(required_frame_buffer_bytes(frame, canvas), Ok(13_490_176));
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
        config.frame_memory_budget = 13_490_175;
        assert_eq!(
            Session::start(config, geometry).err(),
            Some(Error::InvalidConfig)
        );
    }
}
