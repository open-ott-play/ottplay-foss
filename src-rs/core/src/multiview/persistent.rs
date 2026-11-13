//! Persistent local-source compositor. No network listener or provider selection.
//! Sources are independently decoded; raster geometry is imported from its owner.
//! Public broker/RPC admission remains a separate, unwired authorization gate.
use super::{
    decoder::{
        self, AudioQueue, AudioQueueStats, BoundContext, Decoder, DecoderConfig, DecoderError,
        GrantedFile,
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

pub struct Session {
    config: Config,
    state: Arc<Mutex<State>>,
    decoders: Arc<Mutex<Vec<Option<Decoder>>>>,
    stop: Arc<AtomicBool>,
    compositor: Option<JoinHandle<()>>,
    encoder: Encoder,
    owned_pids: Vec<u32>,
    audio_callback_misses: Arc<AtomicU64>,
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
        let audio = Arc::new(move || {
            // No control lock, snapshot lock or opportunistic silence branch.
            // Only this source's short, bounded PCM FIFO operation is involved.
            let word = audio_route.load(Ordering::Acquire);
            if word == 0 {
                return vec![0; 1920];
            }
            let slot = ((word & 15) - 1) as usize;
            let generation = (word >> 4) - 1;
            audio_queues[slot].take(generation, 1920)
        });
        let encoder = Encoder::start(
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
            for worker in lock(&compose_decoders).iter_mut() {
                if let Some(mut worker) = worker.take() {
                    worker.stop();
                }
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
        if let Some(mut old) = lock(&self.decoders)[usize::from(slot)].take() {
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
                    if let Some(mut worker) = lock(&self.decoders)[usize::from(slot)].take() {
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
        if let Some(mut old) = lock(&self.decoders)[usize::from(slot)].take() {
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
        for worker in lock(&self.decoders).iter_mut() {
            if let Some(mut worker) = worker.take() {
                worker.stop();
            }
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
