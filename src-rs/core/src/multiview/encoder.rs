//! One stable output encoder; sources and layout never enter its command line.
//! Feeds are trusted, nonblocking in-process snapshots. Audio callbacks must not
//! do IO or wait on a decoder. Disk limits are polling guards, not OS quotas.
use super::geometry::CanvasSpec;
use std::path::{Path, PathBuf};
use std::sync::{atomic::AtomicBool, Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

pub type VideoFeed = Arc<Mutex<Arc<[u8]>>>;
/// A capture-time fence, independent of source PTS or file A/V alignment.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CaptureFence {
    pub control_epoch: u64,
    pub visual_revision: u64,
    pub stopped_mask: u16,
    pub visible_mask: u16,
    pub source_revisions: [u64; 9],
}
#[cfg_attr(not(any(target_os = "linux", target_os = "macos")), allow(dead_code))]
#[derive(Debug)]
struct CaptureFrame {
    generation: u64,
    sequence: u64,
    fence: CaptureFence,
    invalidated_at: Arc<OnceLock<Instant>>,
    captured_at: Instant,
    pixels: CapturePixels,
}
enum CapturePixels {
    Rgb(Arc<[u8]>),
    Black(usize),
}
impl std::fmt::Debug for CapturePixels {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Rgb(bytes) => f.debug_tuple("Rgb").field(&bytes.len()).finish(),
            Self::Black(bytes) => f.debug_tuple("Black").field(bytes).finish(),
        }
    }
}
#[cfg_attr(not(any(target_os = "linux", target_os = "macos")), allow(dead_code))]
impl CaptureFrame {
    fn len(&self) -> usize {
        match &self.pixels {
            CapturePixels::Rgb(bytes) => bytes.len(),
            CapturePixels::Black(bytes) => *bytes,
        }
    }
}
impl CaptureFence {
    fn same_visual(self, other: Self) -> bool {
        self.visual_revision == other.visual_revision
            && self.stopped_mask == other.stopped_mask
            && self.visible_mask == other.visible_mask
            && self.source_revisions == other.source_revisions
    }
}
#[cfg_attr(not(any(target_os = "linux", target_os = "macos")), allow(dead_code))]
struct CaptureState {
    active: bool,
    generation: Option<u64>,
    fence: CaptureFence,
    invalidated_at: Arc<OnceLock<Instant>>,
    sequence: u64,
    last_capture: Instant,
    pending: Option<Arc<CaptureFrame>>,
}
/// One protected, unconsumed candidate. A newer/future publication cannot
/// replace it before the writer has considered its capture timestamp.
pub struct CaptureVideoFeed {
    state: Mutex<CaptureState>,
    bytes: usize,
}
impl CaptureVideoFeed {
    pub fn new(initial: Arc<[u8]>, fence: CaptureFence, captured_at: Instant) -> Self {
        let invalidated_at = Arc::new(OnceLock::new());
        Self {
            bytes: initial.len(),
            state: Mutex::new(CaptureState {
                active: false,
                generation: None,
                fence,
                invalidated_at: invalidated_at.clone(),
                sequence: 0,
                last_capture: captured_at,
                pending: Some(Arc::new(CaptureFrame {
                    generation: 0,
                    sequence: 0,
                    fence,
                    invalidated_at,
                    captured_at,
                    pixels: CapturePixels::Rgb(initial),
                })),
            }),
        }
    }
    pub fn invalidate(&self, fence: CaptureFence, changed_at: Instant) -> Result<(), EncoderError> {
        let mut state = self.state.lock().map_err(|_| EncoderError::Io)?;
        if fence == state.fence {
            return Ok(());
        }
        if fence.control_epoch <= state.fence.control_epoch || changed_at < state.last_capture {
            return Err(EncoderError::InvalidConfig);
        }
        if state.fence.same_visual(fence) {
            state.fence = fence;
            return Ok(());
        }
        // Every retained frame owns the first invalidation boundary of its
        // visual epoch. Later changes cannot overwrite that frame's custody.
        state
            .invalidated_at
            .set(changed_at)
            .map_err(|_| EncoderError::InvalidConfig)?;
        state.invalidated_at = Arc::new(OnceLock::new());
        state.fence = fence;
        state.sequence = state
            .sequence
            .checked_add(1)
            .ok_or(EncoderError::InvalidConfig)?;
        state.last_capture = changed_at;
        state.pending = Some(Arc::new(CaptureFrame {
            generation: state.generation.unwrap_or(0),
            sequence: state.sequence,
            fence,
            invalidated_at: state.invalidated_at.clone(),
            captured_at: changed_at,
            pixels: CapturePixels::Black(self.bytes),
        }));
        Ok(())
    }
    /// False means that the older candidate retains the one publication credit.
    /// It is never replaced with a potentially future capture.
    pub fn publish(
        &self,
        pixels: Arc<[u8]>,
        fence: CaptureFence,
        captured_at: Instant,
    ) -> Result<bool, EncoderError> {
        if pixels.len() != self.bytes {
            return Err(EncoderError::InvalidConfig);
        }
        let mut state = self.state.lock().map_err(|_| EncoderError::Io)?;
        if state.fence != fence || captured_at < state.last_capture {
            return Err(EncoderError::InvalidConfig);
        }
        if !state.active
            && state
                .fence
                .source_revisions
                .iter()
                .any(|revision| *revision != 0)
        {
            return Err(EncoderError::InvalidConfig);
        }
        if state.pending.is_some() && state.active {
            return Ok(false);
        }
        state.sequence = state
            .sequence
            .checked_add(1)
            .ok_or(EncoderError::InvalidConfig)?;
        state.last_capture = captured_at;
        state.pending = Some(Arc::new(CaptureFrame {
            generation: state.generation.unwrap_or(0),
            sequence: state.sequence,
            fence,
            invalidated_at: state.invalidated_at.clone(),
            captured_at,
            pixels: CapturePixels::Rgb(pixels),
        }));
        Ok(true)
    }
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    fn empty_sources(&self, generation: u64) -> Result<bool, EncoderError> {
        let state = self.state.lock().map_err(|_| EncoderError::Io)?;
        Ok(state.generation == Some(generation)
            && state
                .fence
                .source_revisions
                .iter()
                .all(|revision| *revision == 0))
    }
    #[cfg(all(test, any(target_os = "linux", target_os = "macos")))]
    fn activate(&self, generation: u64) -> Result<(), EncoderError> {
        let mut state = self.state.lock().map_err(|_| EncoderError::Io)?;
        if state.generation != Some(generation)
            || state.active
            || state
                .fence
                .source_revisions
                .iter()
                .any(|revision| *revision != 0)
        {
            return Err(EncoderError::InvalidConfig);
        }
        state.active = true;
        Ok(())
    }
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    fn activate_for_target(
        &self,
        generation: u64,
        target: Instant,
        age_limit: Duration,
    ) -> Result<Option<Instant>, EncoderError> {
        let mut state = self.state.lock().map_err(|_| EncoderError::Io)?;
        if state.generation != Some(generation)
            || state.active
            || state
                .fence
                .source_revisions
                .iter()
                .any(|revision| *revision != 0)
        {
            return Err(EncoderError::InvalidConfig);
        }
        let valid = state.pending.as_ref().is_some_and(|frame| {
            frame.generation == generation
                && frame.fence.same_visual(state.fence)
                && target
                    .checked_duration_since(frame.captured_at)
                    .is_some_and(|age| age <= age_limit)
        });
        if valid {
            state.active = true;
            Ok(state.pending.as_ref().map(|frame| frame.captured_at))
        } else {
            Ok(None)
        }
    }
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    fn bind(&self, generation: u64) -> Result<(), EncoderError> {
        let mut state = self.state.lock().map_err(|_| EncoderError::Io)?;
        if state.generation.is_some() {
            return Err(EncoderError::InvalidConfig);
        }
        state.generation = Some(generation);
        if let Some(frame) = &mut state.pending {
            let frame = Arc::get_mut(frame).ok_or(EncoderError::InvalidConfig)?;
            frame.generation = generation;
        }
        Ok(())
    }
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    fn take_at(
        &self,
        generation: u64,
        target: Instant,
    ) -> Result<(CaptureFence, Option<Arc<CaptureFrame>>), EncoderError> {
        let mut state = self.state.lock().map_err(|_| EncoderError::Io)?;
        if state.generation != Some(generation) {
            return Err(EncoderError::InvalidConfig);
        }
        let frame = if state
            .pending
            .as_ref()
            .is_some_and(|frame| frame.captured_at <= target)
        {
            state.pending.take()
        } else {
            None
        };
        Ok((state.fence, frame))
    }
    #[cfg(test)]
    fn matches(&self, generation: u64, fence: CaptureFence) -> Result<bool, EncoderError> {
        let state = self.state.lock().map_err(|_| EncoderError::Io)?;
        Ok(state.generation == Some(generation) && state.fence.same_visual(fence))
    }
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    fn accepts(
        &self,
        generation: u64,
        frame: &CaptureFrame,
        target: Instant,
    ) -> Result<bool, EncoderError> {
        let state = self.state.lock().map_err(|_| EncoderError::Io)?;
        if state.generation != Some(generation) || frame.generation != generation {
            return Ok(false);
        }
        Ok(match frame.invalidated_at.get() {
            Some(until) => target < *until,
            None => {
                Arc::ptr_eq(&state.invalidated_at, &frame.invalidated_at)
                    && state.fence.same_visual(frame.fence)
            }
        })
    }
}

pub type AudioFeed = Arc<dyn Fn() -> Vec<i16> + Send + Sync>;
/// Opt-in source-clock mixer. The argument is the fixed 50 Hz presentation tick,
/// not the wall-clock instant at which a delayed callback happens to execute.
pub type TimedAudioFeed = Arc<dyn Fn(Instant) -> Vec<i16> + Send + Sync>;

pub struct EncoderConfig {
    pub ffmpeg: PathBuf,
    pub mkfifo: PathBuf,
    pub output_root: PathBuf,
    pub canvas: CanvasSpec,
    pub startup_timeout: Duration,
    pub stall_timeout: Duration,
    pub max_duration: Duration,
    pub idle_timeout: Duration,
    pub max_disk_bytes: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EncoderState {
    Starting,
    Playing,
    Failed,
    Stopped,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EncoderError {
    InvalidConfig,
    Unsupported,
    Busy,
    Cancelled,
    StartupTimeout,
    Stalled,
    Deadline,
    Idle,
    DiskLimit,
    Io,
    ProcessFailed,
    InvalidManifest,
}

#[derive(Clone, Copy, Debug)]
pub struct EncoderSnapshot {
    pub pid: u32,
    pub generation: u64,
    pub frames: u64,
    pub state: EncoderState,
    pub monotonic_millis: u64,
    /// Sequence of the last closed segment in the validated raw playlist.
    pub hls_sequence: Option<u64>,
    pub hls_last_update_millis: u64,
    /// Interleaved i16 samples; updated only after a complete PCM chunk write.
    pub audio_samples_written: u64,
    pub video_frames_written: u64,
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
mod runtime {
    use super::*;
    use std::fs::{self, DirBuilder, File, OpenOptions};
    use std::io::{self, Read, Write};
    use std::os::fd::{AsFd, AsRawFd, BorrowedFd};
    use std::os::unix::fs::{DirBuilderExt, FileTypeExt, OpenOptionsExt};
    use std::process::{Child, Command, Stdio};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::thread::{self, JoinHandle};
    use std::time::{Instant, SystemTime, UNIX_EPOCH};

    static ACTIVE: AtomicBool = AtomicBool::new(false);
    static GENERATION: AtomicU64 = AtomicU64::new(1);
    const PROGRESS_LIMIT: u64 = 65_536;
    #[cfg(target_os = "macos")]
    const NONBLOCK: i32 = 4;
    #[cfg(not(target_os = "macos"))]
    const NONBLOCK: i32 = 2048;
    unsafe extern "C" {
        fn fcntl(fd: i32, command: i32, ...) -> i32;
    }

    fn nonblocking(fd: BorrowedFd<'_>) -> io::Result<()> {
        // The borrowed descriptor remains alive throughout both calls.
        let flags = unsafe { fcntl(fd.as_raw_fd(), 3) };
        if flags < 0 {
            return Err(io::Error::last_os_error());
        }
        if unsafe { fcntl(fd.as_raw_fd(), 4, flags | NONBLOCK) } < 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }

    struct Permit;
    impl Permit {
        fn acquire() -> Result<Self, EncoderError> {
            ACTIVE
                .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
                .map(|_| Self)
                .map_err(|_| EncoderError::Busy)
        }
    }
    impl Drop for Permit {
        fn drop(&mut self) {
            ACTIVE.store(false, Ordering::Release);
        }
    }
    struct ChildGuard(Child);
    impl Drop for ChildGuard {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
    struct Directory {
        path: PathBuf,
        keep: bool,
    }
    impl Drop for Directory {
        fn drop(&mut self) {
            if !self.keep {
                let _ = fs::remove_dir_all(&self.path);
            }
        }
    }

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    enum CapturePhase {
        Initializing,
        Steady,
        Failed,
    }
    #[derive(Clone, Copy, Default)]
    struct CaptureLane {
        next_target: Option<Instant>,
        in_flight: bool,
        last_full_target: Option<Instant>,
        #[cfg(test)]
        first_strict_target: Option<Instant>,
        strict_full_writes: u64,
    }
    struct CaptureStartupState {
        video_done: bool,
        audio_done: bool,
        epoch: Option<Instant>,
        phase: CapturePhase,
        failure: Option<EncoderError>,
        lanes: [CaptureLane; 2],
        #[cfg(test)]
        steady_at: Option<Instant>,
        #[cfg(test)]
        steady_targets: [Option<Instant>; 2],
        #[cfg(test)]
        steady_capture: Option<Instant>,
    }
    struct CaptureStartup {
        state: Mutex<CaptureStartupState>,
        constructor_complete: AtomicBool,
        deadline: Instant,
        quantum: Duration,
        video_units: u64,
        audio_units: u64,
        feed: Arc<CaptureVideoFeed>,
        generation: u64,
    }
    struct CaptureWrite<'a> {
        startup: &'a CaptureStartup,
        lane: usize,
        phase: CapturePhase,
        target: Instant,
        finished: bool,
    }
    impl CaptureWrite<'_> {
        fn complete(mut self, next_target: Instant) -> Result<(), EncoderError> {
            let mut state = lock(&self.startup.state);
            let lane = &mut state.lanes[self.lane];
            if !lane.in_flight || lane.next_target != Some(self.target) {
                return Err(EncoderError::InvalidConfig);
            }
            lane.last_full_target = Some(self.target);
            lane.next_target = Some(next_target);
            lane.in_flight = false;
            if self.phase == CapturePhase::Steady {
                lane.strict_full_writes = lane
                    .strict_full_writes
                    .checked_add(1)
                    .ok_or(EncoderError::InvalidConfig)?;
                #[cfg(test)]
                {
                    let _ = lane.first_strict_target.get_or_insert(self.target);
                }
            }
            self.finished = true;
            Ok(())
        }
        fn fail(mut self, error: EncoderError) {
            let mut state = lock(&self.startup.state);
            state.phase = CapturePhase::Failed;
            state.failure.get_or_insert(error);
            state.lanes[self.lane].in_flight = false;
            self.finished = true;
        }
    }
    impl Drop for CaptureWrite<'_> {
        fn drop(&mut self) {
            if !self.finished {
                let mut state = lock(&self.startup.state);
                state.phase = CapturePhase::Failed;
                state.failure.get_or_insert(EncoderError::Cancelled);
                state.lanes[self.lane].in_flight = false;
            }
        }
    }
    impl CaptureStartup {
        fn new(fps: u32, deadline: Instant, feed: Arc<CaptureVideoFeed>, generation: u64) -> Self {
            let (mut a, mut b) = (fps, 50);
            while b != 0 {
                (a, b) = (b, a % b);
            }
            Self {
                state: Mutex::new(CaptureStartupState {
                    video_done: false,
                    audio_done: false,
                    epoch: None,
                    phase: CapturePhase::Initializing,
                    failure: None,
                    lanes: [CaptureLane::default(); 2],
                    #[cfg(test)]
                    steady_at: None,
                    #[cfg(test)]
                    steady_targets: [None; 2],
                    #[cfg(test)]
                    steady_capture: None,
                }),
                constructor_complete: AtomicBool::new(false),
                deadline,
                quantum: Duration::from_nanos(1_000_000_000 / u64::from(a)),
                video_units: u64::from(fps / a),
                audio_units: u64::from(50 / a),
                feed,
                generation,
            }
        }
        fn finish(&self, video: bool, shared: &Shared) -> Result<Instant, EncoderError> {
            {
                let mut state = lock(&self.state);
                if video {
                    state.video_done = true;
                } else {
                    state.audio_done = true;
                }
                if state.video_done && state.audio_done && state.epoch.is_none() {
                    // Q/counts are fixed here; actual readiness is a separate gate.
                    let steady = Instant::now();
                    state.epoch = Some(
                        steady
                            .checked_sub(self.quantum)
                            .ok_or(EncoderError::InvalidConfig)?,
                    );
                }
            }
            loop {
                if shared.stop.load(Ordering::Acquire) {
                    return Err(EncoderError::Cancelled);
                }
                if Instant::now() > self.deadline {
                    return Err(EncoderError::StartupTimeout);
                }
                if let Some(epoch) = lock(&self.state).epoch {
                    return Ok(epoch);
                }
                if !self.feed.empty_sources(self.generation)? {
                    return Err(EncoderError::InvalidConfig);
                }
                thread::sleep(Duration::from_millis(2));
            }
        }
        fn publish_next(&self, lane: usize, target: Instant) -> Result<(), EncoderError> {
            let mut state = lock(&self.state);
            if state.lanes[lane].in_flight {
                return Err(EncoderError::InvalidConfig);
            }
            match state.lanes[lane].next_target {
                Some(previous) if previous != target => return Err(EncoderError::InvalidConfig),
                _ => state.lanes[lane].next_target = Some(target),
            }
            Ok(())
        }
        fn try_steady(&self, shared: &Shared, age_limit: Duration) -> Result<bool, EncoderError> {
            let mut state = lock(&self.state);
            match state.phase {
                CapturePhase::Steady => return Ok(true),
                CapturePhase::Failed => {
                    return Err(state.failure.unwrap_or(EncoderError::Cancelled))
                }
                CapturePhase::Initializing => {}
            }
            if shared.stop.load(Ordering::Acquire) {
                return Err(EncoderError::Cancelled);
            }
            if lock(&shared.snapshot).state != EncoderState::Playing {
                return Ok(false);
            }
            let now = Instant::now();
            if now > self.deadline {
                return Err(EncoderError::StartupTimeout);
            }
            if state
                .lanes
                .iter()
                .any(|lane| lane.in_flight || lane.next_target.is_none_or(|target| target < now))
            {
                return Ok(false);
            }
            let target = state.lanes[0]
                .next_target
                .ok_or(EncoderError::InvalidConfig)?;
            let Some(_captured_at) =
                self.feed
                    .activate_for_target(self.generation, target, age_limit)?
            else {
                return Ok(false);
            };
            #[cfg(test)]
            {
                state.steady_at = Some(now);
                state.steady_targets = [state.lanes[0].next_target, state.lanes[1].next_target];
                state.steady_capture = Some(_captured_at);
            }
            state.phase = CapturePhase::Steady;
            Ok(true)
        }
        fn reserve(&self, lane: usize, target: Instant) -> Result<CaptureWrite<'_>, EncoderError> {
            let mut state = lock(&self.state);
            if state.phase == CapturePhase::Failed {
                return Err(state.failure.unwrap_or(EncoderError::Cancelled));
            }
            if state.lanes[lane].in_flight || state.lanes[lane].next_target != Some(target) {
                return Err(EncoderError::InvalidConfig);
            }
            if state.phase == CapturePhase::Initializing
                && !self.feed.empty_sources(self.generation)?
            {
                return Err(EncoderError::InvalidConfig);
            }
            state.lanes[lane].in_flight = true;
            Ok(CaptureWrite {
                startup: self,
                lane,
                phase: state.phase,
                target,
                finished: false,
            })
        }
        fn phase(&self) -> Result<CapturePhase, EncoderError> {
            let state = lock(&self.state);
            if state.phase == CapturePhase::Failed {
                Err(state.failure.unwrap_or(EncoderError::Cancelled))
            } else {
                Ok(state.phase)
            }
        }
        fn ready(&self, shared: &Shared, debt: Duration) -> bool {
            let state = lock(&self.state);
            let now = Instant::now();
            state.phase == CapturePhase::Steady
                && lock(&shared.snapshot).state == EncoderState::Playing
                && state.lanes.iter().all(|lane| {
                    lane.strict_full_writes > 0
                        && lane.last_full_target.is_some_and(|target| {
                            now.checked_duration_since(target)
                                .is_some_and(|age| age <= debt)
                        })
                })
        }
    }
    struct Shared {
        stop: Arc<AtomicBool>,
        started: Instant,
        touched: Mutex<Instant>,
        snapshot: Mutex<EncoderSnapshot>,
        error: Mutex<Option<EncoderError>>,
        audio_samples_written: AtomicU64,
        video_frames_written: AtomicU64,
        capture_startup: Option<Arc<CaptureStartup>>,
    }
    fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
        mutex.lock().unwrap_or_else(|poison| poison.into_inner())
    }
    fn fail(shared: &Shared, error: EncoderError) {
        let mut first = lock(&shared.error);
        if first.is_none() {
            *first = Some(error);
        }
        lock(&shared.snapshot).state = EncoderState::Failed;
        shared.stop.store(true, Ordering::Release);
    }
    fn elapsed_millis(started: Instant) -> u64 {
        started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64
    }

    fn write_nonblocking(
        writer: &mut impl Write,
        bytes: &[u8],
        shared: &Shared,
        timeout: Duration,
    ) -> Result<(), EncoderError> {
        let mut offset = 0;
        let mut advanced = Instant::now();
        while offset < bytes.len() {
            if shared.stop.load(Ordering::Acquire) {
                return Err(EncoderError::Cancelled);
            }
            if advanced.elapsed() >= timeout {
                return Err(EncoderError::Stalled);
            }
            match writer.write(&bytes[offset..]) {
                Ok(0) => return Err(EncoderError::ProcessFailed),
                Ok(size) => {
                    offset += size;
                    advanced = Instant::now();
                }
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(2))
                }
                Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
                Err(_) => return Err(EncoderError::Io),
            }
        }
        Ok(())
    }
    fn sleep_until(deadline: Instant, shared: &Shared) {
        while !shared.stop.load(Ordering::Acquire) {
            let now = Instant::now();
            if now >= deadline {
                break;
            }
            thread::sleep((deadline - now).min(Duration::from_millis(5)));
        }
    }
    enum AudioInput {
        Legacy(AudioFeed),
        Timed(TimedAudioFeed),
    }
    impl AudioInput {
        fn at(&self, tick: Instant) -> Vec<i16> {
            match self {
                Self::Legacy(feed) => feed(),
                Self::Timed(feed) => feed(tick),
            }
        }
    }
    fn next_audio_mixer_tick(previous: Instant) -> Result<Instant, EncoderError> {
        previous
            .checked_add(Duration::from_millis(20))
            .ok_or(EncoderError::InvalidConfig)
    }
    enum VideoInput {
        Legacy(VideoFeed),
        Capture(Arc<CaptureVideoFeed>),
    }
    fn media_target(epoch: Instant, index: u64, rate: u32) -> Result<Instant, EncoderError> {
        if rate == 0 {
            return Err(EncoderError::InvalidConfig);
        }
        let seconds = index / u64::from(rate);
        let nanos = (u128::from(index % u64::from(rate)) * 1_000_000_000 / u128::from(rate)) as u32;
        epoch
            .checked_add(Duration::new(seconds, nanos))
            .ok_or(EncoderError::InvalidConfig)
    }
    /// Capture age is independent of physical writer debt. Ceil preserves
    /// rational two-period boundaries after per-tick nanosecond quantization.
    fn capture_age_limit(canvas: CanvasSpec) -> Result<Duration, EncoderError> {
        if !(1..=30).contains(&canvas.fps) {
            return Err(EncoderError::InvalidConfig);
        }
        let rate = u64::from(canvas.fps);
        let nanos = 2_000_000_000u64
            .checked_add(rate - 1)
            .ok_or(EncoderError::InvalidConfig)?
            / rate;
        Ok(Duration::from_nanos(nanos))
    }
    fn capture_debt(canvas: CanvasSpec, stall: Duration) -> Duration {
        Duration::from_nanos(2_000_000_000 / u64::from(canvas.fps))
            .min(Duration::from_millis(200))
            .min(stall)
    }
    struct CapturePacer {
        epoch: Instant,
        rate: u32,
        bucket: u64,
        starts: u8,
    }
    impl CapturePacer {
        fn new(epoch: Instant, rate: u32) -> Self {
            Self {
                epoch,
                rate,
                bucket: 0,
                starts: 0,
            }
        }
        fn permit_at(&mut self, now: Instant) -> Result<bool, EncoderError> {
            let elapsed = now
                .checked_duration_since(self.epoch)
                .ok_or(EncoderError::InvalidConfig)?;
            let bucket = u64::try_from(
                elapsed
                    .as_nanos()
                    .checked_mul(u128::from(self.rate))
                    .ok_or(EncoderError::InvalidConfig)?
                    / 1_000_000_000,
            )
            .map_err(|_| EncoderError::InvalidConfig)?;
            if bucket != self.bucket {
                self.bucket = bucket;
                self.starts = 0;
            }
            if self.starts == 2 {
                return Ok(false);
            }
            self.starts += 1;
            Ok(true)
        }
        #[cfg(test)]
        fn wait_start(
            &mut self,
            target: Instant,
            debt: Duration,
            shared: &Shared,
        ) -> Result<Instant, EncoderError> {
            loop {
                if shared.stop.load(Ordering::Acquire) {
                    return Err(EncoderError::Cancelled);
                }
                let now = Instant::now();
                if now < target {
                    sleep_until(target, shared);
                    continue;
                }
                if now.duration_since(target) > debt {
                    return Err(EncoderError::Stalled);
                }
                if self.permit_at(now)? {
                    return Ok(now);
                }
                let next = media_target(
                    self.epoch,
                    self.bucket
                        .checked_add(1)
                        .ok_or(EncoderError::InvalidConfig)?,
                    self.rate,
                )?;
                sleep_until(next, shared);
            }
        }
        fn wait_capture_start<'a>(
            &mut self,
            target: Instant,
            debt: Duration,
            age_limit: Duration,
            shared: &Shared,
            startup: &'a CaptureStartup,
            lane: usize,
        ) -> Result<CaptureWrite<'a>, EncoderError> {
            loop {
                startup.try_steady(shared, age_limit)?;
                if shared.stop.load(Ordering::Acquire) {
                    return Err(EncoderError::Cancelled);
                }
                let now = Instant::now();
                if !startup.constructor_complete.load(Ordering::Acquire) && now > startup.deadline {
                    return Err(EncoderError::StartupTimeout);
                }
                let phase = startup.phase()?;
                if now < target {
                    thread::sleep((target - now).min(Duration::from_millis(2)));
                    continue;
                }
                if phase == CapturePhase::Steady && now.duration_since(target) > debt {
                    return Err(EncoderError::Stalled);
                }
                if !self.permit_at(now)? {
                    thread::sleep(Duration::from_millis(2));
                    continue;
                }
                let reservation = startup.reserve(lane, target)?;
                if reservation.phase == CapturePhase::Steady
                    && Instant::now().duration_since(target) > debt
                {
                    reservation.fail(EncoderError::Stalled);
                    return Err(EncoderError::Stalled);
                }
                return Ok(reservation);
            }
        }
    }
    fn write_capture_complete(
        writer: &mut impl Write,
        bytes: &[u8],
        shared: &Shared,
        stall: Duration,
        absolute: Instant,
        mut authorized: impl FnMut() -> Result<bool, EncoderError>,
    ) -> Result<(), EncoderError> {
        let mut offset = 0;
        let mut advanced = Instant::now();
        while offset < bytes.len() {
            if shared.stop.load(Ordering::Acquire) {
                return Err(EncoderError::Cancelled);
            }
            if Instant::now() > absolute || advanced.elapsed() >= stall {
                return Err(EncoderError::Stalled);
            }
            if !authorized()? {
                return Err(EncoderError::Cancelled);
            }
            match writer.write(&bytes[offset..]) {
                Ok(0) => return Err(EncoderError::ProcessFailed),
                Ok(count) if count <= bytes.len() - offset => {
                    offset += count;
                    advanced = Instant::now();
                }
                Ok(_) => return Err(EncoderError::Io),
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(2))
                }
                Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
                Err(_) => return Err(EncoderError::Io),
            }
        }
        // Completion cannot acknowledge an expired/revoked partial frame.
        if Instant::now() > absolute {
            return Err(EncoderError::Stalled);
        }
        if !authorized()? {
            return Err(EncoderError::Cancelled);
        }
        Ok(())
    }
    fn write_black_complete(
        writer: &mut impl Write,
        bytes: usize,
        shared: &Shared,
        stall: Duration,
        absolute: Instant,
        mut authorized: impl FnMut() -> Result<bool, EncoderError>,
    ) -> Result<(), EncoderError> {
        let zeros = [0u8; 4096];
        let mut remaining = bytes;
        while remaining != 0 {
            let count = remaining.min(zeros.len());
            write_capture_complete(
                writer,
                &zeros[..count],
                shared,
                stall,
                absolute,
                &mut authorized,
            )?;
            remaining -= count;
        }
        Ok(())
    }
    fn select_capture(
        feed: &CaptureVideoFeed,
        generation: u64,
        target: Instant,
        debt: Duration,
        committed: &Option<Arc<CaptureFrame>>,
        repeats: &mut u8,
    ) -> Result<Arc<CaptureFrame>, EncoderError> {
        let (_, next) = feed.take_at(generation, target)?;
        let frame = match next {
            Some(frame) => {
                if committed
                    .as_ref()
                    .is_some_and(|old| frame.sequence <= old.sequence)
                {
                    return Err(EncoderError::InvalidConfig);
                }
                *repeats = 0;
                frame
            }
            None => {
                *repeats = repeats.checked_add(1).ok_or(EncoderError::Stalled)?;
                if *repeats > 2 {
                    return Err(EncoderError::Stalled);
                }
                committed.as_ref().cloned().ok_or(EncoderError::Stalled)?
            }
        };
        if frame.generation != generation
            || !feed.accepts(generation, &frame, target)?
            || target
                .checked_duration_since(frame.captured_at)
                .is_none_or(|age| age > debt)
        {
            return Err(EncoderError::Stalled);
        }
        Ok(frame)
    }
    fn capture_video_loop(
        mut writer: impl Write,
        feed: Arc<CaptureVideoFeed>,
        canvas: CanvasSpec,
        stall: Duration,
        shared: Arc<Shared>,
    ) {
        let generation = lock(&shared.snapshot).generation;
        let debt = capture_debt(canvas, stall);
        let mut committed = None;
        let mut repeats = 0;
        let result = (|| -> Result<(), EncoderError> {
            let age_limit = capture_age_limit(canvas)?;
            let startup = shared
                .capture_startup
                .as_ref()
                .ok_or(EncoderError::InvalidConfig)?;
            for _ in 0..startup.video_units {
                write_black_complete(
                    &mut writer,
                    canvas.width as usize * canvas.height as usize * 3,
                    &shared,
                    stall,
                    startup.deadline,
                    || feed.empty_sources(generation),
                )?;
                shared.video_frames_written.fetch_add(1, Ordering::Relaxed);
            }
            let epoch = startup.finish(true, &shared)?;
            let mut pacer = CapturePacer::new(epoch, canvas.fps);
            let mut index = startup.video_units;
            startup.publish_next(0, media_target(epoch, index, canvas.fps)?)?;
            while !shared.stop.load(Ordering::Acquire) {
                let target = media_target(epoch, index, canvas.fps)?;
                let reservation =
                    pacer.wait_capture_start(target, debt, age_limit, &shared, startup, 0)?;
                let frame = if reservation.phase == CapturePhase::Steady {
                    match select_capture(
                        &feed,
                        generation,
                        target,
                        age_limit,
                        &committed,
                        &mut repeats,
                    ) {
                        Ok(frame) => {
                            if frame.len() != canvas.width as usize * canvas.height as usize * 3 {
                                reservation.fail(EncoderError::InvalidConfig);
                                return Err(EncoderError::InvalidConfig);
                            }
                            Some(frame)
                        }
                        Err(error) => {
                            reservation.fail(error);
                            return Err(error);
                        }
                    }
                } else {
                    None
                };
                let absolute = if reservation.phase == CapturePhase::Initializing {
                    startup.deadline
                } else {
                    target
                        .checked_add(debt)
                        .ok_or(EncoderError::InvalidConfig)?
                };
                let written = match frame.as_ref().map(|frame| &frame.pixels) {
                    Some(CapturePixels::Rgb(bytes))
                        if bytes.len() == canvas.width as usize * canvas.height as usize * 3 =>
                    {
                        write_capture_complete(&mut writer, bytes, &shared, stall, absolute, || {
                            Ok(true)
                        })
                    }
                    Some(CapturePixels::Black(bytes)) => {
                        write_black_complete(&mut writer, *bytes, &shared, stall, absolute, || {
                            Ok(true)
                        })
                    }
                    None => write_black_complete(
                        &mut writer,
                        canvas.width as usize * canvas.height as usize * 3,
                        &shared,
                        stall,
                        absolute,
                        || feed.empty_sources(generation),
                    ),
                    _ => Err(EncoderError::InvalidConfig),
                };
                if let Err(error) = written {
                    reservation.fail(error);
                    return Err(error);
                }
                shared.video_frames_written.fetch_add(1, Ordering::Relaxed);
                if let Some(frame) = frame {
                    committed = Some(frame);
                }
                index = index.checked_add(1).ok_or(EncoderError::InvalidConfig)?;
                reservation.complete(media_target(epoch, index, canvas.fps)?)?;
            }
            Ok(())
        })();
        if let Err(error) = result {
            if !shared.stop.load(Ordering::Acquire) {
                fail(&shared, error);
            }
        }
    }
    fn capture_audio_loop(
        mut writer: impl Write,
        feed: AudioInput,
        canvas: CanvasSpec,
        stall: Duration,
        shared: Arc<Shared>,
    ) {
        let debt = capture_debt(canvas, stall);
        let result = (|| -> Result<(), EncoderError> {
            let startup = shared
                .capture_startup
                .as_ref()
                .ok_or(EncoderError::InvalidConfig)?;
            let generation = lock(&shared.snapshot).generation;
            let silent = [0u8; 3840];
            for _ in 0..startup.audio_units {
                write_capture_complete(
                    &mut writer,
                    &silent,
                    &shared,
                    stall,
                    startup.deadline,
                    || startup.feed.empty_sources(generation),
                )?;
                shared
                    .audio_samples_written
                    .fetch_add(1920, Ordering::Relaxed);
            }
            let epoch = startup.finish(false, &shared)?;
            let age_limit = capture_age_limit(canvas)?;
            let mut pacer = CapturePacer::new(epoch, 50);
            let mut index = startup.audio_units;
            startup.publish_next(1, media_target(epoch, index, 50)?)?;
            while !shared.stop.load(Ordering::Acquire) {
                let target = media_target(epoch, index, 50)?;
                let reservation =
                    pacer.wait_capture_start(target, debt, age_limit, &shared, startup, 1)?;
                let mut bytes = [0u8; 3840];
                if reservation.phase == CapturePhase::Steady {
                    let samples = feed.at(target);
                    if samples.len() != 1920 {
                        reservation.fail(EncoderError::InvalidConfig);
                        return Err(EncoderError::InvalidConfig);
                    }
                    for (target, sample) in bytes.chunks_exact_mut(2).zip(samples) {
                        target.copy_from_slice(&sample.to_le_bytes());
                    }
                }
                let initializing = reservation.phase == CapturePhase::Initializing;
                let absolute = if initializing {
                    startup.deadline
                } else {
                    target
                        .checked_add(debt)
                        .ok_or(EncoderError::InvalidConfig)?
                };
                let written =
                    write_capture_complete(&mut writer, &bytes, &shared, stall, absolute, || {
                        if initializing {
                            startup.feed.empty_sources(generation)
                        } else {
                            Ok(true)
                        }
                    });
                if let Err(error) = written {
                    reservation.fail(error);
                    return Err(error);
                }
                shared
                    .audio_samples_written
                    .fetch_add(1920, Ordering::Relaxed);
                index = index.checked_add(1).ok_or(EncoderError::InvalidConfig)?;
                reservation.complete(media_target(epoch, index, 50)?)?;
            }
            Ok(())
        })();
        if let Err(error) = result {
            if !shared.stop.load(Ordering::Acquire) {
                fail(&shared, error);
            }
        }
    }
    fn video_loop(
        mut writer: std::process::ChildStdin,
        feed: VideoFeed,
        canvas: CanvasSpec,
        stall: Duration,
        shared: Arc<Shared>,
    ) {
        let period = Duration::from_secs_f64(1.0 / f64::from(canvas.fps));
        let expected = canvas.width as usize * canvas.height as usize * 3;
        let mut deadline = Instant::now();
        while !shared.stop.load(Ordering::Acquire) {
            let began = Instant::now();
            let frame = loop {
                match feed.try_lock() {
                    Ok(frame) => break frame.clone(),
                    Err(std::sync::TryLockError::Poisoned(_)) => {
                        fail(&shared, EncoderError::Io);
                        return;
                    }
                    Err(std::sync::TryLockError::WouldBlock) => {
                        if shared.stop.load(Ordering::Acquire) {
                            return;
                        }
                        if began.elapsed() >= stall {
                            fail(&shared, EncoderError::Stalled);
                            return;
                        }
                        thread::sleep(Duration::from_millis(2));
                    }
                }
            };
            if frame.len() != expected {
                fail(&shared, EncoderError::InvalidConfig);
                return;
            }
            if let Err(error) = write_nonblocking(&mut writer, &frame, &shared, stall) {
                if !shared.stop.load(Ordering::Acquire) {
                    fail(&shared, error);
                }
                return;
            }
            shared.video_frames_written.fetch_add(1, Ordering::Relaxed);
            deadline += period;
            // Do not send an unbounded catch-up burst after backpressure.
            if deadline < Instant::now() {
                deadline = Instant::now();
            }
            sleep_until(deadline, &shared);
        }
    }
    fn audio_loop(mut writer: File, feed: AudioInput, stall: Duration, shared: Arc<Shared>) {
        let period = Duration::from_millis(20);
        let mut deadline = Instant::now();
        let mut logical_mixer_tick = deadline;
        while !shared.stop.load(Ordering::Acquire) {
            let samples = feed.at(logical_mixer_tick);
            let mut bytes = [0u8; 3840];
            if samples.len() == 1920 {
                for (target, sample) in bytes.chunks_exact_mut(2).zip(samples) {
                    target.copy_from_slice(&sample.to_le_bytes());
                }
            }
            if let Err(error) = write_nonblocking(&mut writer, &bytes, &shared, stall) {
                if !shared.stop.load(Ordering::Acquire) {
                    fail(&shared, error);
                }
                return;
            }
            shared
                .audio_samples_written
                .fetch_add(1920, Ordering::Relaxed);
            // The encoded sample timeline advances by exactly one complete
            // 960-frame PCM block. Scheduling jitter must not retimestamp it.
            logical_mixer_tick = match next_audio_mixer_tick(logical_mixer_tick) {
                Ok(next) => next,
                Err(error) => {
                    fail(&shared, error);
                    return;
                }
            };
            // Preserve the original physical writer cadence for both APIs.
            // This does not add catch-up bursts or hide pressure by rebasing PTS.
            deadline += period;
            if deadline < Instant::now() {
                deadline = Instant::now();
            }
            sleep_until(deadline, &shared);
        }
    }

    fn progress(reader: &mut File, pending: &mut Vec<u8>) -> Result<u64, EncoderError> {
        let mut latest = 0;
        let mut read = 0;
        let mut buffer = [0u8; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(size) => {
                    pending.extend_from_slice(&buffer[..size]);
                    read += size;
                }
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => break,
                Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                Err(_) => return Err(EncoderError::Io),
            }
            if pending.len() as u64 > PROGRESS_LIMIT {
                return Err(EncoderError::DiskLimit);
            }
            if let Some(end) = pending.iter().rposition(|byte| *byte == b'\n') {
                for line in pending[..=end].split(|byte| *byte == b'\n') {
                    if let Some(value) = line.strip_prefix(b"frame=") {
                        if let Ok(value) = std::str::from_utf8(value) {
                            if let Ok(value) = value.trim().parse::<u64>() {
                                latest = latest.max(value);
                            }
                        }
                    }
                }
                pending.drain(..=end);
            }
            if read >= PROGRESS_LIMIT as usize {
                break;
            }
        }
        Ok(latest)
    }
    fn disk_usage(directory: &Path) -> Result<u64, EncoderError> {
        let mut bytes = 0u64;
        let mut count = 0;
        for entry in fs::read_dir(directory).map_err(|_| EncoderError::Io)? {
            count += 1;
            if count > 32 {
                return Err(EncoderError::DiskLimit);
            }
            let entry = entry.map_err(|_| EncoderError::Io)?;
            let metadata = match fs::symlink_metadata(entry.path()) {
                Ok(metadata) => metadata,
                // FFmpeg atomically renames/deletes its rolling HLS resources.
                Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
                Err(_) => return Err(EncoderError::Io),
            };
            if metadata.file_type().is_fifo()
                && (entry.file_name() == "audio.pcm" || entry.file_name() == "progress.pipe")
            {
                continue;
            }
            if !metadata.is_file() {
                return Err(EncoderError::Io);
            }
            bytes = bytes
                .checked_add(metadata.len())
                .ok_or(EncoderError::DiskLimit)?;
        }
        Ok(bytes)
    }
    const PLAYLIST_LIMIT: usize = 8192;
    #[derive(Debug, PartialEq, Eq)]
    struct Playlist {
        last_sequence: u64,
        segments: Vec<String>,
    }
    /// Validate the raw generated leaf; never rewrite target duration, names or
    /// sequence numbers to turn an invalid transport into successful playback.
    fn parse_playlist(bytes: &[u8]) -> Result<Playlist, EncoderError> {
        if bytes.is_empty() || bytes.len() > PLAYLIST_LIMIT {
            return Err(EncoderError::InvalidManifest);
        }
        let text = std::str::from_utf8(bytes).map_err(|_| EncoderError::InvalidManifest)?;
        let mut lines = text.lines();
        if lines.next() != Some("#EXTM3U") {
            return Err(EncoderError::InvalidManifest);
        }
        let mut target: Option<u32> = None;
        let mut sequence: Option<u64> = None;
        let mut pending: Option<f64> = None;
        let mut maximum = 0.0f64;
        let mut segments = Vec::with_capacity(8);
        let mut version = false;
        let mut independent = false;
        for line in lines {
            if line.is_empty() {
                continue;
            }
            if let Some(duration) = pending.take() {
                if segments.len() >= 8 {
                    return Err(EncoderError::InvalidManifest);
                }
                let digits = line
                    .strip_prefix("segment-")
                    .and_then(|name| name.strip_suffix(".ts"))
                    .ok_or(EncoderError::InvalidManifest)?;
                if digits.len() != 6 || !digits.bytes().all(|byte| byte.is_ascii_digit()) {
                    return Err(EncoderError::InvalidManifest);
                }
                let number = digits
                    .parse::<u64>()
                    .map_err(|_| EncoderError::InvalidManifest)?;
                let expected = sequence
                    .ok_or(EncoderError::InvalidManifest)?
                    .checked_add(segments.len() as u64)
                    .ok_or(EncoderError::InvalidManifest)?;
                if number != expected {
                    return Err(EncoderError::InvalidManifest);
                }
                maximum = maximum.max(duration);
                segments.push(line.to_owned());
                continue;
            }
            if let Some(value) = line.strip_prefix("#EXT-X-TARGETDURATION:") {
                if target.is_some()
                    || segments.len() > 0
                    || value.is_empty()
                    || !value.bytes().all(|byte| byte.is_ascii_digit())
                {
                    return Err(EncoderError::InvalidManifest);
                }
                let value = value
                    .parse::<u32>()
                    .map_err(|_| EncoderError::InvalidManifest)?;
                if value == 0 {
                    return Err(EncoderError::InvalidManifest);
                }
                target = Some(value);
            } else if let Some(value) = line.strip_prefix("#EXT-X-MEDIA-SEQUENCE:") {
                if sequence.is_some()
                    || segments.len() > 0
                    || value.is_empty()
                    || !value.bytes().all(|byte| byte.is_ascii_digit())
                {
                    return Err(EncoderError::InvalidManifest);
                }
                sequence = Some(
                    value
                        .parse::<u64>()
                        .map_err(|_| EncoderError::InvalidManifest)?,
                );
            } else if let Some(value) = line.strip_prefix("#EXT-X-VERSION:") {
                if version
                    || value.is_empty()
                    || !value.bytes().all(|byte| byte.is_ascii_digit())
                    || value
                        .parse::<u32>()
                        .ok()
                        .filter(|version| *version > 0)
                        .is_none()
                {
                    return Err(EncoderError::InvalidManifest);
                }
                version = true;
            } else if line == "#EXT-X-INDEPENDENT-SEGMENTS" {
                if independent {
                    return Err(EncoderError::InvalidManifest);
                }
                independent = true;
            } else if let Some(value) = line.strip_prefix("#EXTINF:") {
                let (duration, title) =
                    value.split_once(',').ok_or(EncoderError::InvalidManifest)?;
                if !title.is_empty()
                    || duration.is_empty()
                    || duration.len() > 64
                    || !duration
                        .bytes()
                        .all(|byte| byte.is_ascii_digit() || byte == b'.')
                {
                    return Err(EncoderError::InvalidManifest);
                }
                let duration = duration
                    .parse::<f64>()
                    .map_err(|_| EncoderError::InvalidManifest)?;
                if !duration.is_finite() || duration <= 0.0 {
                    return Err(EncoderError::InvalidManifest);
                }
                pending = Some(duration);
            } else {
                return Err(EncoderError::InvalidManifest);
            }
        }
        if pending.is_some()
            || segments.is_empty()
            || f64::from(target.ok_or(EncoderError::InvalidManifest)?) < maximum.ceil()
        {
            return Err(EncoderError::InvalidManifest);
        }
        let last_sequence = sequence
            .ok_or(EncoderError::InvalidManifest)?
            .checked_add(segments.len() as u64 - 1)
            .ok_or(EncoderError::InvalidManifest)?;
        Ok(Playlist {
            last_sequence,
            segments,
        })
    }
    fn current_playlist(directory: &Path) -> Result<Option<Playlist>, EncoderError> {
        let mut options = OpenOptions::new();
        options.read(true);
        #[cfg(target_os = "linux")]
        options.custom_flags(NONBLOCK | 0x20000); // O_NOFOLLOW
        #[cfg(target_os = "macos")]
        options.custom_flags(NONBLOCK | 0x100); // O_NOFOLLOW
        let file = match options.open(directory.join("index.m3u8")) {
            Ok(file) => file,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err(EncoderError::InvalidManifest),
        };
        let metadata = file.metadata().map_err(|_| EncoderError::Io)?;
        if !metadata.is_file() || metadata.len() > PLAYLIST_LIMIT as u64 {
            return Err(EncoderError::InvalidManifest);
        }
        let mut bytes = Vec::new();
        file.take(PLAYLIST_LIMIT as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| EncoderError::Io)?;
        let playlist = parse_playlist(&bytes)?;
        // At most eight known, strictly generated resource names are inspected.
        for name in &playlist.segments {
            match fs::symlink_metadata(directory.join(name)) {
                Ok(metadata) if metadata.is_file() && metadata.len() > 0 => {}
                Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
                _ => return Err(EncoderError::InvalidManifest),
            }
        }
        Ok(Some(playlist))
    }
    fn monitor(
        mut child: ChildGuard,
        _keeper: File,
        mut progress_reader: File,
        directory: PathBuf,
        config: EncoderConfig,
        shared: Arc<Shared>,
    ) {
        let mut last = 0;
        let mut advanced = shared.started;
        let mut pending = Vec::new();
        let mut hls_sequence = None;
        let mut hls_advanced = shared.started;
        let hls_stall_timeout = config.stall_timeout.max(Duration::from_secs(3));
        while !shared.stop.load(Ordering::Acquire) {
            if shared.started.elapsed() >= config.max_duration {
                fail(&shared, EncoderError::Deadline);
                break;
            }
            if lock(&shared.touched).elapsed() >= config.idle_timeout {
                fail(&shared, EncoderError::Idle);
                break;
            }
            match disk_usage(&directory) {
                Ok(size) if size <= config.max_disk_bytes => {}
                Ok(_) => {
                    fail(&shared, EncoderError::DiskLimit);
                    break;
                }
                Err(error) => {
                    fail(&shared, error);
                    break;
                }
            }
            match progress(&mut progress_reader, &mut pending) {
                Ok(frames) => {
                    if frames > last {
                        last = frames;
                        advanced = Instant::now();
                    }
                    let mut snapshot = lock(&shared.snapshot);
                    snapshot.frames = snapshot.frames.max(frames);
                    snapshot.monotonic_millis = elapsed_millis(shared.started);
                }
                Err(error) => {
                    fail(&shared, error);
                    break;
                }
            }
            match current_playlist(&directory) {
                Ok(Some(playlist)) => {
                    if hls_sequence.is_some_and(|previous| playlist.last_sequence < previous) {
                        fail(&shared, EncoderError::InvalidManifest);
                        break;
                    }
                    let mut snapshot = lock(&shared.snapshot);
                    if hls_sequence != Some(playlist.last_sequence) {
                        hls_sequence = Some(playlist.last_sequence);
                        hls_advanced = Instant::now();
                        snapshot.hls_sequence = hls_sequence;
                        snapshot.hls_last_update_millis = elapsed_millis(shared.started);
                    }
                    if snapshot.state == EncoderState::Starting && snapshot.frames > 0 {
                        snapshot.state = EncoderState::Playing;
                    }
                }
                Ok(None) => {}
                Err(error) => {
                    fail(&shared, error);
                    break;
                }
            }
            match child.0.try_wait() {
                Ok(None) => {}
                Ok(Some(_)) => {
                    fail(&shared, EncoderError::ProcessFailed);
                    break;
                }
                Err(_) => {
                    fail(&shared, EncoderError::Io);
                    break;
                }
            }
            let starting = lock(&shared.snapshot).state == EncoderState::Starting;
            if starting && shared.started.elapsed() >= config.startup_timeout {
                fail(&shared, EncoderError::StartupTimeout);
                break;
            }
            if !starting && advanced.elapsed() >= config.stall_timeout {
                fail(&shared, EncoderError::Stalled);
                break;
            }
            if !starting && hls_advanced.elapsed() >= hls_stall_timeout {
                fail(&shared, EncoderError::Stalled);
                break;
            }
            thread::sleep(Duration::from_millis(20));
        }
        // ChildGuard kills and reaps before this monitor returns. Keeper closes
        // afterwards; every writer already checks stop and uses nonblocking IO.
        drop(child);
    }

    pub struct Encoder {
        shared: Arc<Shared>,
        directory: PathBuf,
        monitor: Option<JoinHandle<()>>,
        video: Option<JoinHandle<()>>,
        audio: Option<JoinHandle<()>>,
        permit: Option<Permit>,
        cleaned: bool,
    }
    impl Encoder {
        pub fn start(
            config: EncoderConfig,
            video: VideoFeed,
            audio: AudioFeed,
            stop: Arc<AtomicBool>,
        ) -> Result<Self, EncoderError> {
            Self::start_audio(
                config,
                VideoInput::Legacy(video),
                AudioInput::Legacy(audio),
                stop,
            )
        }
        pub fn start_timed_audio(
            config: EncoderConfig,
            video: VideoFeed,
            audio: TimedAudioFeed,
            stop: Arc<AtomicBool>,
        ) -> Result<Self, EncoderError> {
            Self::start_audio(
                config,
                VideoInput::Legacy(video),
                AudioInput::Timed(audio),
                stop,
            )
        }
        pub fn start_capture_av(
            config: EncoderConfig,
            video: Arc<CaptureVideoFeed>,
            audio: TimedAudioFeed,
            stop: Arc<AtomicBool>,
        ) -> Result<Self, EncoderError> {
            Self::start_audio(
                config,
                VideoInput::Capture(video),
                AudioInput::Timed(audio),
                stop,
            )
        }
        fn start_audio(
            config: EncoderConfig,
            video: VideoInput,
            audio: AudioInput,
            stop: Arc<AtomicBool>,
        ) -> Result<Self, EncoderError> {
            if stop.load(Ordering::Acquire) {
                return Err(EncoderError::Cancelled);
            }
            let canvas = config.canvas;
            if canvas.width == 0
                || canvas.height == 0
                || canvas.width > 1920
                || canvas.height > 1080
                || canvas.width % 2 != 0
                || canvas.height % 2 != 0
                || canvas.fps == 0
                || canvas.fps > 30
                || config.startup_timeout.is_zero()
                || config.stall_timeout.is_zero()
                || config.max_duration.is_zero()
                || config.max_duration > Duration::from_secs(300)
                || config.idle_timeout.is_zero()
                || config.idle_timeout > Duration::from_secs(60)
                || config.startup_timeout > config.max_duration
                || config.stall_timeout > config.max_duration
                || config.max_disk_bytes == 0
                || config.max_disk_bytes > 128 * 1024 * 1024
            {
                return Err(EncoderError::InvalidConfig);
            }
            let root = config
                .output_root
                .canonicalize()
                .map_err(|_| EncoderError::InvalidConfig)?;
            if !root.is_dir() || !config.ffmpeg.is_absolute() || !config.mkfifo.is_absolute() {
                return Err(EncoderError::InvalidConfig);
            }
            let ffmpeg = config
                .ffmpeg
                .canonicalize()
                .map_err(|_| EncoderError::Unsupported)?;
            let mkfifo = config
                .mkfifo
                .canonicalize()
                .map_err(|_| EncoderError::Unsupported)?;
            if !ffmpeg.is_file() || !mkfifo.is_file() {
                return Err(EncoderError::Unsupported);
            }
            let expected = canvas.width as usize * canvas.height as usize * 3;
            match &video {
                VideoInput::Legacy(video) => match video.try_lock() {
                    Ok(frame) if frame.len() == expected => {}
                    _ => return Err(EncoderError::InvalidConfig),
                },
                VideoInput::Capture(video) if video.bytes == expected => {}
                _ => return Err(EncoderError::InvalidConfig),
            }
            let permit = Permit::acquire()?;
            let generation = GENERATION
                .fetch_update(Ordering::AcqRel, Ordering::Acquire, |value| {
                    value.checked_add(1)
                })
                .map_err(|_| EncoderError::InvalidConfig)?;
            if let VideoInput::Capture(feed) = &video {
                feed.bind(generation)?;
            }
            let capture_mode = matches!(&video, VideoInput::Capture(_));
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_err(|_| EncoderError::Io)?
                .as_nanos();
            let directory = root.join(format!("scene-{}-{generation}-{nonce}", std::process::id()));
            DirBuilder::new()
                .mode(0o700)
                .create(&directory)
                .map_err(|_| EncoderError::Io)?;
            let mut owned = Directory {
                path: directory.clone(),
                keep: false,
            };
            let fifo = directory.join("audio.pcm");
            let progress_fifo = directory.join("progress.pipe");
            let mut maker = ChildGuard(
                Command::new(mkfifo)
                    .arg(&fifo)
                    .arg(&progress_fifo)
                    .stdin(Stdio::null())
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .spawn()
                    .map_err(|_| EncoderError::Unsupported)?,
            );
            let began = Instant::now();
            loop {
                if stop.load(Ordering::Acquire) {
                    return Err(EncoderError::Cancelled);
                }
                if began.elapsed() >= Duration::from_secs(2) {
                    return Err(EncoderError::Unsupported);
                }
                if let Some(status) = maker.0.try_wait().map_err(|_| EncoderError::Io)? {
                    if !status.success() {
                        return Err(EncoderError::Unsupported);
                    }
                    break;
                }
                thread::sleep(Duration::from_millis(5));
            }
            drop(maker);
            if [&fifo, &progress_fifo].iter().any(|path| {
                !fs::symlink_metadata(path).is_ok_and(|metadata| metadata.file_type().is_fifo())
            }) {
                return Err(EncoderError::Unsupported);
            }
            let keeper = OpenOptions::new()
                .read(true)
                .write(true)
                .custom_flags(NONBLOCK)
                .open(&fifo)
                .map_err(|_| EncoderError::Io)?;
            let audio_writer = OpenOptions::new()
                .write(true)
                .custom_flags(NONBLOCK)
                .open(&fifo)
                .map_err(|_| EncoderError::Io)?;
            let progress_reader = OpenOptions::new()
                .read(true)
                .write(true)
                .custom_flags(NONBLOCK)
                .open(&progress_fifo)
                .map_err(|_| EncoderError::Io)?;
            let gop = canvas.fps.to_string();
            let mut command = Command::new(ffmpeg);
            command
                .args([
                    "-nostdin",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-n",
                    "-thread_queue_size",
                    "4",
                    "-f",
                    "rawvideo",
                    "-pixel_format",
                    "rgb24",
                    "-video_size",
                ])
                .arg(format!("{}x{}", canvas.width, canvas.height))
                .args([
                    "-framerate",
                    &canvas.fps.to_string(),
                    "-probesize",
                    "32",
                    "-analyzeduration",
                    "0",
                    "-i",
                    "pipe:0",
                    "-thread_queue_size",
                    "4",
                    "-f",
                    "s16le",
                    "-ar",
                    "48000",
                    "-ac",
                    "2",
                    "-probesize",
                    "32",
                    "-analyzeduration",
                    "0",
                    "-i",
                ])
                .arg(&fifo)
                .args([
                    "-map",
                    "0:v:0",
                    "-map",
                    "1:a:0",
                    "-c:v",
                    "libx264",
                    "-preset",
                    "ultrafast",
                    "-tune",
                    "zerolatency",
                    "-threads",
                    "1",
                    "-g",
                    &gop,
                    "-keyint_min",
                    &gop,
                    "-sc_threshold",
                    "0",
                    "-pix_fmt",
                    "yuv420p",
                    "-c:a",
                    "aac",
                    "-b:a",
                    "128k",
                    "-f",
                    "hls",
                    "-hls_time",
                    "1",
                    "-hls_list_size",
                    "8",
                    "-hls_delete_threshold",
                    "2",
                    "-hls_flags",
                    "delete_segments+temp_file+independent_segments",
                    "-hls_segment_filename",
                ])
                .arg(directory.join("segment-%06d.ts"))
                .args(["-stats_period", "0.1", "-progress"])
                .arg(&progress_fifo)
                .arg(directory.join("index.m3u8"))
                .stdin(Stdio::piped())
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            let mut child = ChildGuard(command.spawn().map_err(|_| EncoderError::Unsupported)?);
            let video_writer = child.0.stdin.take().ok_or(EncoderError::Io)?;
            nonblocking(video_writer.as_fd()).map_err(|_| EncoderError::Io)?;
            let started = Instant::now();
            let capture_startup = match &video {
                VideoInput::Capture(feed) => Some(Arc::new(CaptureStartup::new(
                    canvas.fps,
                    started
                        .checked_add(config.startup_timeout)
                        .ok_or(EncoderError::InvalidConfig)?,
                    feed.clone(),
                    generation,
                ))),
                VideoInput::Legacy(_) => None,
            };
            let shared = Arc::new(Shared {
                capture_startup,
                stop,
                started,
                touched: Mutex::new(started),
                snapshot: Mutex::new(EncoderSnapshot {
                    pid: child.0.id(),
                    generation,
                    frames: 0,
                    state: EncoderState::Starting,
                    monotonic_millis: 0,
                    hls_sequence: None,
                    hls_last_update_millis: 0,
                    audio_samples_written: 0,
                    video_frames_written: 0,
                }),
                error: Mutex::new(None),
                audio_samples_written: AtomicU64::new(0),
                video_frames_written: AtomicU64::new(0),
            });
            let mut encoder = Self {
                shared: shared.clone(),
                directory: directory.clone(),
                monitor: None,
                video: None,
                audio: None,
                permit: Some(permit),
                cleaned: false,
            };
            owned.keep = true;
            let stall = config.stall_timeout;
            let shared_video = shared.clone();
            match thread::Builder::new()
                .name("multiview-video".into())
                .spawn(move || match video {
                    VideoInput::Legacy(video) => {
                        video_loop(video_writer, video, canvas, stall, shared_video)
                    }
                    VideoInput::Capture(video) => {
                        capture_video_loop(video_writer, video, canvas, stall, shared_video)
                    }
                }) {
                Ok(handle) => encoder.video = Some(handle),
                Err(_) => {
                    drop(child);
                    fail(&shared, EncoderError::Io);
                    return Err(EncoderError::Io);
                }
            }
            let shared_audio = shared.clone();
            match thread::Builder::new()
                .name("multiview-audio".into())
                .spawn(move || {
                    if capture_mode {
                        capture_audio_loop(audio_writer, audio, canvas, stall, shared_audio);
                    } else {
                        audio_loop(audio_writer, audio, stall, shared_audio);
                    }
                }) {
                Ok(handle) => encoder.audio = Some(handle),
                Err(_) => {
                    drop(child);
                    fail(&shared, EncoderError::Io);
                    return Err(EncoderError::Io);
                }
            }
            let shared_monitor = shared.clone();
            match thread::Builder::new()
                .name("multiview-encoder".into())
                .spawn(move || {
                    monitor(
                        child,
                        keeper,
                        progress_reader,
                        directory,
                        config,
                        shared_monitor,
                    )
                }) {
                Ok(handle) => encoder.monitor = Some(handle),
                Err(_) => {
                    fail(&shared, EncoderError::Io);
                    return Err(EncoderError::Io);
                }
            }
            loop {
                if shared.capture_startup.as_ref().is_some_and(|startup| {
                    !startup.constructor_complete.load(Ordering::Acquire)
                        && Instant::now() > startup.deadline
                }) {
                    fail(&shared, EncoderError::StartupTimeout);
                }
                match encoder.snapshot().state {
                    EncoderState::Playing
                        if shared.capture_startup.as_ref().is_none_or(|startup| {
                            startup.ready(&shared, capture_debt(canvas, stall))
                        }) =>
                    {
                        if let Some(startup) = &shared.capture_startup {
                            startup.constructor_complete.store(true, Ordering::Release);
                        }
                        return Ok(encoder);
                    }
                    EncoderState::Failed => {
                        return Err(lock(&shared.error).unwrap_or(EncoderError::ProcessFailed))
                    }
                    _ if shared.stop.load(Ordering::Acquire) => {
                        return Err(EncoderError::Cancelled)
                    }
                    _ => thread::sleep(Duration::from_millis(10)),
                }
            }
        }
        pub fn snapshot(&self) -> EncoderSnapshot {
            let mut snapshot = *lock(&self.shared.snapshot);
            snapshot.monotonic_millis = elapsed_millis(self.shared.started);
            snapshot.audio_samples_written =
                self.shared.audio_samples_written.load(Ordering::Relaxed);
            snapshot.video_frames_written =
                self.shared.video_frames_written.load(Ordering::Relaxed);
            snapshot
        }
        pub fn output_directory(&self) -> &Path {
            &self.directory
        }
        pub fn touch(&self) {
            *lock(&self.shared.touched) = Instant::now();
        }
        pub fn stop(&mut self) -> Result<(), EncoderError> {
            self.shared.stop.store(true, Ordering::Release);
            let mut failed = false;
            for handle in [&mut self.monitor, &mut self.video, &mut self.audio] {
                if let Some(handle) = handle.take() {
                    if handle.join().is_err() {
                        failed = true;
                    }
                }
            }
            if !self.cleaned {
                match fs::remove_dir_all(&self.directory) {
                    Ok(()) => self.cleaned = true,
                    Err(error) if error.kind() == io::ErrorKind::NotFound => self.cleaned = true,
                    Err(_) => failed = true,
                }
            }
            self.permit.take();
            if lock(&self.shared.snapshot).state != EncoderState::Failed {
                lock(&self.shared.snapshot).state = EncoderState::Stopped;
            }
            if failed {
                Err(EncoderError::Io)
            } else {
                Ok(())
            }
        }
    }
    impl Drop for Encoder {
        fn drop(&mut self) {
            let _ = self.stop();
        }
    }

    #[cfg(test)]
    mod transport_tests {
        use super::*;
        #[test]
        fn timed_audio_receives_fixed_ticks_while_legacy_callback_remains_compatible() {
            let first = Instant::now();
            let observed = Arc::new(Mutex::new(Vec::new()));
            let recorded = observed.clone();
            let timed = AudioInput::Timed(Arc::new(move |tick| {
                lock(&recorded).push(tick);
                vec![7; 1920]
            }));
            assert_eq!(timed.at(first), vec![7; 1920]);
            let late = first + Duration::from_millis(137);
            let next = next_audio_mixer_tick(first).unwrap();
            assert_eq!(next, first + Duration::from_millis(20));
            timed.at(next);
            assert_eq!(
                *lock(&observed),
                vec![first, first + Duration::from_millis(20)]
            );
            let legacy = AudioInput::Legacy(Arc::new(|| vec![3; 1920]));
            assert_eq!(legacy.at(first), vec![3; 1920]);
            let physical_deadline = (first + Duration::from_millis(20)).max(late);
            assert_eq!(physical_deadline, late);
            assert_eq!(next, first + Duration::from_millis(20));
            let _legacy_start: fn(
                EncoderConfig,
                VideoFeed,
                AudioFeed,
                Arc<AtomicBool>,
            ) -> Result<Encoder, EncoderError> = Encoder::start;
            let _timed_start: fn(
                EncoderConfig,
                VideoFeed,
                TimedAudioFeed,
                Arc<AtomicBool>,
            ) -> Result<Encoder, EncoderError> = Encoder::start_timed_audio;
        }
        fn first_pixel(frame: &CaptureFrame) -> u8 {
            match &frame.pixels {
                CapturePixels::Rgb(bytes) => bytes[0],
                CapturePixels::Black(_) => 0,
            }
        }
        fn fence(epoch: u64) -> CaptureFence {
            CaptureFence {
                control_epoch: epoch,
                visual_revision: epoch,
                stopped_mask: 0,
                visible_mask: 1,
                source_revisions: [epoch; 9],
            }
        }
        fn shared_at(epoch: Instant) -> Arc<Shared> {
            Arc::new(Shared {
                stop: Arc::new(AtomicBool::new(false)),
                started: epoch,
                touched: Mutex::new(epoch),
                error: Mutex::new(None),
                snapshot: Mutex::new(EncoderSnapshot {
                    pid: 1,
                    generation: 1,
                    frames: 0,
                    state: EncoderState::Playing,
                    monotonic_millis: 0,
                    hls_sequence: None,
                    hls_last_update_millis: 0,
                    audio_samples_written: 0,
                    video_frames_written: 0,
                }),
                audio_samples_written: AtomicU64::new(0),
                video_frames_written: AtomicU64::new(0),
                capture_startup: None,
            })
        }
        fn isolated_capture_shared(
            epoch: Instant,
            feed: Arc<CaptureVideoFeed>,
            video: bool,
        ) -> Arc<Shared> {
            let mut shared = shared_at(epoch);
            feed.activate(1).unwrap();
            let startup = Arc::new(CaptureStartup::new(
                10,
                epoch + Duration::from_secs(2),
                feed,
                1,
            ));
            {
                let mut state = lock(&startup.state);
                // These isolated-writer tests explicitly model a warm peer;
                // the separate two-writer startup test uses the real gate.
                state.phase = CapturePhase::Steady;
                state.epoch = Some(epoch - startup.quantum);
                if video {
                    state.audio_done = true;
                } else {
                    state.video_done = true;
                }
            }
            startup.constructor_complete.store(true, Ordering::Release);
            let owned = Arc::get_mut(&mut shared).unwrap();
            if video {
                owned
                    .audio_samples_written
                    .store(startup.audio_units * 1920, Ordering::Relaxed);
            } else {
                owned
                    .video_frames_written
                    .store(startup.video_units, Ordering::Relaxed);
            }
            owned.capture_startup = Some(startup);
            shared
        }
        fn tiny_canvas() -> CanvasSpec {
            CanvasSpec {
                width: 2,
                height: 2,
                fps: 10,
            }
        }
        #[test]
        fn capture_handoff_preserves_eligible_pending_despite_newer_future_publications() {
            let epoch = Instant::now();
            let feed = CaptureVideoFeed::new(Arc::from(vec![0; 12]), fence(0), epoch);
            feed.bind(1).unwrap();
            feed.activate(1).unwrap();
            let (_, initial) = feed.take_at(1, epoch).unwrap();
            assert_eq!(initial.unwrap().sequence, 0);
            let early = epoch + Duration::from_millis(2);
            assert!(feed
                .publish(Arc::from(vec![1; 12]), fence(0), early)
                .unwrap());
            assert!(!feed
                .publish(
                    Arc::from(vec![2; 12]),
                    fence(0),
                    epoch + Duration::from_millis(102)
                )
                .unwrap());
            let (_, candidate) = feed.take_at(1, epoch + Duration::from_millis(100)).unwrap();
            assert_eq!(first_pixel(&candidate.unwrap()), 1);
            assert!(feed
                .publish(
                    Arc::from(vec![3; 12]),
                    fence(0),
                    epoch + Duration::from_millis(202)
                )
                .unwrap());
            assert!(feed
                .take_at(1, epoch + Duration::from_millis(200))
                .unwrap()
                .1
                .is_none());
            assert_eq!(
                first_pixel(
                    &feed
                        .take_at(1, epoch + Duration::from_millis(300))
                        .unwrap()
                        .1
                        .unwrap()
                ),
                3
            );
        }
        #[test]
        fn capture_boundaries_and_control_replacement_fail_without_backdating() {
            let epoch = Instant::now();
            let feed = CaptureVideoFeed::new(Arc::from(vec![0; 12]), fence(0), epoch);
            feed.bind(1).unwrap();
            feed.activate(1).unwrap();
            let mut repeats = 0;
            let initial = select_capture(
                &feed,
                1,
                epoch,
                Duration::from_millis(200),
                &None,
                &mut repeats,
            )
            .unwrap();
            let committed = Some(initial);
            assert!(select_capture(
                &feed,
                1,
                epoch + Duration::from_millis(100),
                Duration::from_millis(200),
                &committed,
                &mut repeats
            )
            .is_ok());
            assert!(select_capture(
                &feed,
                1,
                epoch + Duration::from_millis(200),
                Duration::from_millis(200),
                &committed,
                &mut repeats
            )
            .is_ok());
            assert!(select_capture(
                &feed,
                1,
                epoch + Duration::from_millis(200) + Duration::from_nanos(1),
                Duration::from_millis(200),
                &committed,
                &mut 0
            )
            .is_err());
            assert!(select_capture(
                &feed,
                1,
                epoch + Duration::from_millis(200),
                Duration::from_millis(200),
                &committed,
                &mut repeats
            )
            .is_err());
            feed.invalidate(fence(1), epoch + Duration::from_millis(1))
                .unwrap();
            feed.invalidate(fence(1), epoch + Duration::from_millis(1))
                .unwrap();
            assert!(!feed.matches(1, fence(0)).unwrap());
            assert!(select_capture(
                &feed,
                1,
                epoch,
                Duration::from_millis(200),
                &committed,
                &mut 0
            )
            .is_ok());
            assert!(!feed
                .accepts(
                    1,
                    committed.as_ref().unwrap(),
                    epoch + Duration::from_millis(1)
                )
                .unwrap());
            let transitioned = select_capture(
                &feed,
                1,
                epoch + Duration::from_millis(1),
                Duration::from_millis(200),
                &committed,
                &mut 0,
            )
            .unwrap();
            assert!(matches!(transitioned.pixels, CapturePixels::Black(12)));
            assert!(feed
                .publish(Arc::from(vec![1; 12]), fence(0), epoch)
                .is_err());
            assert!(feed
                .invalidate(fence(0), epoch + Duration::from_millis(1))
                .is_err());
        }
        #[test]
        fn capture_rational_targets_and_both_pacer_credit_limits_are_exact() {
            let epoch = Instant::now();
            for rate in [1, 10, 15, 30, 50] {
                let target = media_target(epoch, u64::from(rate) * 65, rate).unwrap();
                assert_eq!(target.duration_since(epoch), Duration::from_secs(65));
                let mut pacer = CapturePacer::new(epoch, rate);
                assert!(pacer.permit_at(epoch).unwrap());
                assert!(pacer.permit_at(epoch).unwrap());
                assert!(!pacer.permit_at(epoch).unwrap());
                assert!(pacer
                    .permit_at(media_target(epoch, 1, rate).unwrap() + Duration::from_nanos(1))
                    .unwrap());
            }
            assert_eq!(
                capture_debt(tiny_canvas(), Duration::from_secs(1)),
                Duration::from_millis(200)
            );
            let mut fast = tiny_canvas();
            fast.fps = 30;
            assert_eq!(
                capture_debt(fast, Duration::from_secs(1)),
                Duration::from_nanos(66_666_666)
            );
            assert!(media_target(epoch, u64::MAX, 1).is_err());
        }
        struct PressureWriter {
            blocked_until: Instant,
            inject_after: Option<(usize, Duration)>,
            frame_bytes: usize,
            accepted: Arc<Mutex<Vec<u8>>>,
            stop_after: usize,
            stop: Arc<AtomicBool>,
        }
        impl Write for PressureWriter {
            fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
                if self
                    .inject_after
                    .is_some_and(|(after, _)| lock(&self.accepted).len() >= after)
                {
                    let (_, duration) = self.inject_after.take().unwrap();
                    self.blocked_until = Instant::now() + duration;
                }
                if Instant::now() < self.blocked_until {
                    return Err(io::ErrorKind::WouldBlock.into());
                }
                let count = bytes.len().min(7);
                let mut accepted = lock(&self.accepted);
                accepted.extend_from_slice(&bytes[..count]);
                if self
                    .frame_bytes
                    .checked_mul(self.stop_after)
                    .is_some_and(|limit| accepted.len() >= limit)
                {
                    self.stop.store(true, Ordering::Release);
                }
                Ok(count)
            }
            fn flush(&mut self) -> io::Result<()> {
                Ok(())
            }
        }
        #[test]
        fn production_capture_video_writer_recovers_bounded_pressure_with_immutable_partial_bytes()
        {
            let epoch = Instant::now();
            let feed = Arc::new(CaptureVideoFeed::new(
                Arc::from(vec![0; 12]),
                fence(0),
                epoch,
            ));
            feed.bind(1).unwrap();
            let shared = isolated_capture_shared(epoch, feed.clone(), true);
            let accepted = Arc::new(Mutex::new(Vec::new()));
            let producer = feed.clone();
            let stop = shared.stop.clone();
            let publishing = thread::spawn(move || {
                let mut value = 1u8;
                while !stop.load(Ordering::Acquire) {
                    producer
                        .publish(Arc::from(vec![value; 12]), fence(0), Instant::now())
                        .unwrap();
                    value = value.wrapping_add(1);
                    thread::sleep(Duration::from_millis(15));
                }
            });
            let writer = PressureWriter {
                blocked_until: epoch,
                inject_after: Some((12, Duration::from_millis(100))),
                frame_bytes: 12,
                accepted: accepted.clone(),
                stop_after: 5,
                stop: shared.stop.clone(),
            };
            capture_video_loop(
                writer,
                feed,
                tiny_canvas(),
                Duration::from_secs(1),
                shared.clone(),
            );
            publishing.join().unwrap();
            assert_eq!(shared.video_frames_written.load(Ordering::Relaxed), 5);
            assert!(lock(&shared.error).is_none());
            let bytes = lock(&accepted);
            assert_eq!(bytes.len(), 60);
            assert!(bytes[..12].iter().all(|byte| *byte == 0));
            assert!(bytes
                .chunks_exact(12)
                .all(|frame| frame.iter().all(|byte| *byte == frame[0])));
            assert!(bytes[24] != bytes[48]);
        }
        #[test]
        fn production_capture_video_writer_terminates_pressure_beyond_debt_bound() {
            let epoch = Instant::now();
            let feed = Arc::new(CaptureVideoFeed::new(
                Arc::from(vec![0; 12]),
                fence(0),
                epoch,
            ));
            feed.bind(1).unwrap();
            let shared = isolated_capture_shared(epoch, feed.clone(), true);
            let accepted = Arc::new(Mutex::new(Vec::new()));
            let writer = PressureWriter {
                blocked_until: epoch,
                inject_after: Some((12, Duration::from_millis(350))),
                frame_bytes: 12,
                accepted: accepted.clone(),
                stop_after: 5,
                stop: shared.stop.clone(),
            };
            capture_video_loop(
                writer,
                feed,
                tiny_canvas(),
                Duration::from_secs(1),
                shared.clone(),
            );
            assert_eq!(*lock(&shared.error), Some(EncoderError::Stalled));
            assert_eq!(shared.video_frames_written.load(Ordering::Relaxed), 1);
            assert_eq!(*lock(&accepted), vec![0; 12]);
        }
        #[test]
        fn production_capture_audio_writer_keeps_pcm_ticks_contiguous_after_asymmetric_pressure() {
            let epoch = Instant::now();
            let feed = Arc::new(CaptureVideoFeed::new(
                Arc::from(vec![0; 12]),
                fence(0),
                epoch,
            ));
            feed.bind(1).unwrap();
            let shared = isolated_capture_shared(epoch, feed, false);
            let ticks = Arc::new(Mutex::new(Vec::new()));
            let recorded = ticks.clone();
            let audio = AudioInput::Timed(Arc::new(move |tick| {
                let mut ticks = lock(&recorded);
                ticks.push(tick);
                vec![ticks.len() as i16; 1920]
            }));
            let accepted = Arc::new(Mutex::new(Vec::new()));
            let writer = PressureWriter {
                blocked_until: epoch,
                inject_after: Some((5 * 3840, Duration::from_millis(100))),
                frame_bytes: 3840,
                accepted: accepted.clone(),
                stop_after: 11,
                stop: shared.stop.clone(),
            };
            capture_audio_loop(
                writer,
                audio,
                tiny_canvas(),
                Duration::from_secs(1),
                shared.clone(),
            );
            assert!(lock(&shared.error).is_none());
            assert_eq!(
                shared.audio_samples_written.load(Ordering::Relaxed),
                11 * 1920
            );
            let startup = shared.capture_startup.as_ref().unwrap();
            let common = lock(&startup.state).epoch.unwrap();
            let ticks = lock(&ticks);
            assert_eq!(ticks.len(), 6);
            for (index, tick) in ticks.iter().enumerate() {
                assert_eq!(*tick, media_target(common, 5 + index as u64, 50).unwrap());
            }
            let bytes = lock(&accepted);
            assert!(bytes[..5 * 3840].iter().all(|byte| *byte == 0));
            for (index, block) in bytes[5 * 3840..].chunks_exact(3840).enumerate() {
                assert!(block
                    .chunks_exact(2)
                    .all(|pair| i16::from_le_bytes([pair[0], pair[1]]) == index as i16 + 1));
            }
        }
        #[test]
        fn capture_bootstrap_quantum_is_equal_for_video_and_fifty_hz_audio() {
            let now = Instant::now();
            for fps in 1..=30 {
                let feed = Arc::new(CaptureVideoFeed::new(Arc::from(vec![0; 12]), fence(0), now));
                let startup = CaptureStartup::new(fps, now + Duration::from_secs(2), feed, 1);
                assert_eq!(
                    u128::from(startup.video_units) * 1_000_000_000 / u128::from(fps),
                    startup.quantum.as_nanos()
                );
                assert_eq!(
                    u128::from(startup.audio_units) * 20_000_000,
                    startup.quantum.as_nanos()
                );
                assert!(startup.quantum <= Duration::from_secs(1));
                assert!(startup.video_units <= 30 && startup.audio_units <= 50);
            }
        }
        #[test]
        fn actual_both_writer_startup_primes_only_black_silence_then_latches_one_epoch() {
            let began = Instant::now();
            let feed = Arc::new(CaptureVideoFeed::new(
                Arc::from(vec![9; 12]),
                fence(0),
                began,
            ));
            feed.bind(1).unwrap();
            let mut shared = shared_at(began);
            let startup = Arc::new(CaptureStartup::new(
                10,
                began + Duration::from_secs(3),
                feed.clone(),
                1,
            ));
            Arc::get_mut(&mut shared).unwrap().capture_startup = Some(startup.clone());
            let vbytes = Arc::new(Mutex::new(Vec::new()));
            let abytes = Arc::new(Mutex::new(Vec::new()));
            let observed = Arc::new(Mutex::new(Vec::new()));
            let record = observed.clone();
            let audio = AudioInput::Timed(Arc::new(move |tick| {
                lock(&record).push(tick);
                vec![7; 1920]
            }));
            let pf = feed.clone();
            let ps = shared.stop.clone();
            let publisher = thread::spawn(move || {
                while !ps.load(Ordering::Acquire) {
                    pf.publish(Arc::from(vec![9; 12]), fence(0), Instant::now())
                        .unwrap();
                    thread::sleep(Duration::from_millis(10));
                }
            });
            let ready_shared = shared.clone();
            let ready_startup = startup.clone();
            let observer = thread::spawn(move || {
                while Instant::now() < began + Duration::from_secs(3)
                    && !ready_shared.stop.load(Ordering::Acquire)
                {
                    if ready_startup.ready(&ready_shared, Duration::from_millis(200)) {
                        ready_startup
                            .constructor_complete
                            .store(true, Ordering::Release);
                        ready_shared.stop.store(true, Ordering::Release);
                        return true;
                    }
                    thread::sleep(Duration::from_millis(1));
                }
                ready_shared.stop.store(true, Ordering::Release);
                false
            });
            let vw = PressureWriter {
                blocked_until: began + Duration::from_millis(350),
                inject_after: None,
                frame_bytes: 12,
                accepted: vbytes.clone(),
                stop_after: usize::MAX,
                stop: shared.stop.clone(),
            };
            let aw = PressureWriter {
                blocked_until: began,
                inject_after: None,
                frame_bytes: 3840,
                accepted: abytes.clone(),
                stop_after: usize::MAX,
                stop: shared.stop.clone(),
            };
            let vs = shared.clone();
            let vf = feed.clone();
            let video = thread::spawn(move || {
                capture_video_loop(vw, vf, tiny_canvas(), Duration::from_secs(1), vs)
            });
            capture_audio_loop(
                aw,
                audio,
                tiny_canvas(),
                Duration::from_secs(1),
                shared.clone(),
            );
            video.join().unwrap();
            publisher.join().unwrap();
            assert!(observer.join().unwrap());
            assert!(lock(&shared.error).is_none());
            assert!(lock(&vbytes)[..12].iter().all(|byte| *byte == 0));
            assert!(lock(&abytes)[..5 * 3840].iter().all(|byte| *byte == 0));
            let state = lock(&startup.state);
            let epoch = state.epoch.unwrap();
            let latched = epoch + startup.quantum;
            assert!(latched.duration_since(began) >= Duration::from_millis(350));
            assert_eq!(
                *lock(&observed).first().unwrap(),
                state.lanes[1].first_strict_target.unwrap()
            );
            assert!(state.lanes.iter().all(|lane| lane.strict_full_writes >= 1));
            assert!(shared.audio_samples_written.load(Ordering::Relaxed) >= 6 * 1920);
            assert!(shared.video_frames_written.load(Ordering::Relaxed) >= startup.video_units + 1);
        }
        #[test]
        fn focus_changes_preserve_visual_candidates_and_partial_frame_contents() {
            let now = Instant::now();
            let feed = CaptureVideoFeed::new(Arc::from(vec![8; 12]), fence(0), now);
            feed.bind(1).unwrap();
            feed.activate(1).unwrap();
            let (_, frame) = feed.take_at(1, now).unwrap();
            let frame = frame.unwrap();
            let mut focus = fence(0);
            focus.control_epoch = 1;
            feed.invalidate(focus, now + Duration::from_millis(1))
                .unwrap();
            assert!(feed
                .accepts(1, &frame, now + Duration::from_millis(2))
                .unwrap());
            assert_eq!(first_pixel(&frame), 8);
            let visual = CaptureFence {
                control_epoch: 2,
                visual_revision: 1,
                ..focus
            };
            feed.invalidate(visual, now + Duration::from_millis(3))
                .unwrap();
            assert!(feed
                .accepts(1, &frame, now + Duration::from_millis(2))
                .unwrap());
            assert!(!feed
                .accepts(1, &frame, now + Duration::from_millis(3))
                .unwrap());
            // Frame already selected for a partial write remains immutable;
            // the next target sees the new typed slate rather than old pixels.
            assert_eq!(first_pixel(&frame), 8);
            let (_, pending) = feed.take_at(1, now + Duration::from_millis(3)).unwrap();
            assert!(matches!(pending.unwrap().pixels, CapturePixels::Black(12)));
        }

        #[test]
        fn actual_partial_rgb_write_finishes_old_image_across_normal_visual_change() {
            struct ChangeWriter {
                feed: Arc<CaptureVideoFeed>,
                bytes: Arc<Mutex<Vec<u8>>>,
                stop: Arc<AtomicBool>,
                changed: bool,
            }
            impl Write for ChangeWriter {
                fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
                    let mut all = lock(&self.bytes);
                    let count = bytes.len().min(7);
                    all.extend_from_slice(&bytes[..count]);
                    if all.len() > 12 && !self.changed {
                        self.changed = true;
                        let mut visual = fence(0);
                        visual.control_epoch = 1;
                        visual.visual_revision = 1;
                        self.feed.invalidate(visual, Instant::now()).unwrap();
                    }
                    if all.len() == 24 {
                        self.stop.store(true, Ordering::Release);
                    }
                    Ok(count)
                }
                fn flush(&mut self) -> io::Result<()> {
                    Ok(())
                }
            }
            let began = Instant::now();
            let feed = Arc::new(CaptureVideoFeed::new(
                Arc::from(vec![8; 12]),
                fence(0),
                began,
            ));
            feed.bind(1).unwrap();
            let shared = isolated_capture_shared(began, feed.clone(), true);
            let bytes = Arc::new(Mutex::new(Vec::new()));
            let writer = ChangeWriter {
                feed: feed.clone(),
                bytes: bytes.clone(),
                stop: shared.stop.clone(),
                changed: false,
            };
            capture_video_loop(
                writer,
                feed.clone(),
                tiny_canvas(),
                Duration::from_secs(1),
                shared.clone(),
            );
            assert!(lock(&shared.error).is_none());
            assert_eq!(*lock(&bytes), [vec![0; 12], vec![8; 12]].concat());
            assert_eq!(shared.video_frames_written.load(Ordering::Relaxed), 2);
            let (_, next) = feed
                .take_at(1, Instant::now() + Duration::from_millis(100))
                .unwrap();
            assert!(matches!(next.unwrap().pixels, CapturePixels::Black(12)));
        }
        #[test]
        fn retained_rgb_allocation_is_released_after_committed_replacement() {
            let now = Instant::now();
            let pixels: Arc<[u8]> = Arc::from(vec![7; 12]);
            let weak = Arc::downgrade(&pixels);
            let feed = CaptureVideoFeed::new(pixels, fence(0), now);
            feed.bind(1).unwrap();
            feed.activate(1).unwrap();
            let (_, old) = feed.take_at(1, now).unwrap();
            let mut committed = old;
            assert!(weak.upgrade().is_some());
            feed.publish(
                Arc::from(vec![8; 12]),
                fence(0),
                now + Duration::from_millis(1),
            )
            .unwrap();
            let fresh = select_capture(
                &feed,
                1,
                now + Duration::from_millis(2),
                Duration::from_millis(200),
                &committed,
                &mut 0,
            )
            .unwrap();
            committed = Some(fresh);
            assert!(weak.upgrade().is_none());
            assert_eq!(first_pixel(committed.as_ref().unwrap()), 8);
        }

        #[test]
        fn capture_owner_boundary_survives_three_changes_where_legacy_previous_slot_rejects() {
            let epoch = Instant::now();
            let feed = CaptureVideoFeed::new(Arc::from(vec![1; 12]), fence(0), epoch);
            feed.bind(1).unwrap();
            feed.activate(1).unwrap();
            let (_, owner) = feed.take_at(1, epoch).unwrap();
            let owner = owner.unwrap();
            feed.invalidate(fence(1), epoch + Duration::from_millis(105))
                .unwrap();
            feed.invalidate(fence(2), epoch + Duration::from_millis(110))
                .unwrap();
            feed.invalidate(fence(3), epoch + Duration::from_millis(112))
                .unwrap();
            let delayed_target = epoch + Duration::from_millis(100);
            // Exact published466 model: only current D and immediately previous C
            // survive. That model wrongly forgets A's first boundary at105ms.
            let legacy_current = fence(3);
            let legacy_previous = Some((fence(2), epoch + Duration::from_millis(112)));
            let legacy_accepts = legacy_current.same_visual(owner.fence)
                || legacy_previous.is_some_and(|(previous, until)| {
                    previous.same_visual(owner.fence) && delayed_target < until
                });
            assert!(
                !legacy_accepts,
                "Negative control must retain the original rejection"
            );
            let selected = select_capture(
                &feed,
                1,
                delayed_target,
                Duration::from_millis(200),
                &Some(owner.clone()),
                &mut 0,
            )
            .unwrap();
            assert!(Arc::ptr_eq(&selected, &owner));
            assert_eq!(
                owner.invalidated_at.get(),
                Some(&(epoch + Duration::from_millis(105)))
            );
            assert!(!feed.accepts(2, &owner, delayed_target).unwrap());
        }
        #[test]
        fn capture_owner_first_boundary_is_exact_and_focus_does_not_close_it() {
            let epoch = Instant::now();
            let feed = CaptureVideoFeed::new(Arc::from(vec![1; 12]), fence(0), epoch);
            feed.bind(1).unwrap();
            feed.activate(1).unwrap();
            let (_, owner) = feed.take_at(1, epoch).unwrap();
            let owner = owner.unwrap();
            let focus = CaptureFence {
                control_epoch: 1,
                ..fence(0)
            };
            feed.invalidate(focus, epoch + Duration::from_millis(100))
                .unwrap();
            assert!(owner.invalidated_at.get().is_none());
            assert!(feed
                .accepts(1, &owner, epoch + Duration::from_millis(101))
                .unwrap());
            let boundary = epoch + Duration::from_millis(105);
            feed.invalidate(
                CaptureFence {
                    control_epoch: 2,
                    ..fence(1)
                },
                boundary,
            )
            .unwrap();
            feed.invalidate(
                CaptureFence {
                    control_epoch: 3,
                    ..fence(2)
                },
                epoch + Duration::from_millis(110),
            )
            .unwrap();
            feed.invalidate(
                CaptureFence {
                    control_epoch: 4,
                    ..fence(3)
                },
                epoch + Duration::from_millis(115),
            )
            .unwrap();
            assert!(feed
                .accepts(1, &owner, boundary - Duration::from_nanos(1))
                .unwrap());
            assert!(!feed.accepts(1, &owner, boundary).unwrap());
            assert!(!feed
                .accepts(1, &owner, boundary + Duration::from_nanos(1))
                .unwrap());
            assert_eq!(owner.invalidated_at.get(), Some(&boundary));
        }
        #[test]
        fn low_fps_transition_uses_two_period_capture_age_not_legacy_write_debt() {
            let epoch = Instant::now();
            for fps in 1..=4 {
                let mut canvas = tiny_canvas();
                canvas.fps = fps;
                let age_limit = capture_age_limit(canvas).unwrap();
                let physical_debt = capture_debt(canvas, Duration::from_secs(2));
                assert_eq!(physical_debt, Duration::from_millis(200));
                let feed = CaptureVideoFeed::new(Arc::from(vec![1; 12]), fence(0), epoch);
                feed.bind(1).unwrap();
                feed.activate(1).unwrap();
                let (_, prior) = feed.take_at(1, epoch).unwrap();
                let changed = epoch + Duration::from_millis(100);
                feed.invalidate(fence(1), changed).unwrap();
                let first_tick = media_target(epoch, 1, fps).unwrap();
                let first =
                    select_capture(&feed, 1, first_tick, age_limit, &prior, &mut 0).unwrap();
                assert!(matches!(first.pixels, CapturePixels::Black(12)));
                // FPS1..3 already exceed200ms on the very next tick. FPS4's
                // first tick is only150ms old, then its next tick exceeds200ms.
                if fps <= 3 {
                    assert!(first_tick.duration_since(changed) > physical_debt);
                }
                let second_tick = media_target(epoch, 2, fps).unwrap();
                let age = second_tick.duration_since(changed);
                assert!(age > physical_debt && age <= age_limit);
                let legacy_age_accepts = age <= physical_debt;
                assert!(
                    !legacy_age_accepts,
                    "Published466 age/debt coupling must reject this control"
                );
                let selected = select_capture(
                    &feed,
                    1,
                    second_tick,
                    age_limit,
                    &Some(first.clone()),
                    &mut 0,
                )
                .unwrap();
                assert!(Arc::ptr_eq(&first, &selected));
                assert_eq!(
                    selected.captured_at, changed,
                    "Never refresh the retained capture timestamp"
                );
            }
        }
        #[test]
        fn capture_age_ceil_is_exact_at_two_periods_and_rejects_one_nanosecond_more() {
            let epoch = Instant::now();
            for fps in 1..=30 {
                let mut canvas = tiny_canvas();
                canvas.fps = fps;
                let limit = capture_age_limit(canvas).unwrap();
                assert_eq!(
                    limit.as_nanos(),
                    2_000_000_000u128.div_ceil(u128::from(fps))
                );
                assert!(limit <= Duration::from_secs(2));
                let feed = CaptureVideoFeed::new(Arc::from(vec![1; 12]), fence(0), epoch);
                feed.bind(1).unwrap();
                feed.activate(1).unwrap();
                let exact = select_capture(&feed, 1, epoch + limit, limit, &None, &mut 0).unwrap();
                assert!(select_capture(
                    &feed,
                    1,
                    epoch + limit + Duration::from_nanos(1),
                    limit,
                    &Some(exact),
                    &mut 0
                )
                .is_err());
            }
            let mut thirds = tiny_canvas();
            thirds.fps = 3;
            let limit = capture_age_limit(thirds).unwrap();
            assert_eq!(limit, Duration::from_nanos(666_666_667));
            let capture = media_target(epoch, 1, 3).unwrap();
            let target = media_target(epoch, 3, 3).unwrap();
            assert_eq!(target.duration_since(capture), limit);
            let feed = CaptureVideoFeed::new(Arc::from(vec![1; 12]), fence(0), capture);
            feed.bind(1).unwrap();
            feed.activate(1).unwrap();
            assert!(select_capture(&feed, 1, target, limit, &None, &mut 0).is_ok());
        }
        #[test]
        fn longer_capture_age_does_not_relax_actual_physical_pacer_or_write_deadlines() {
            let now = Instant::now();
            let mut canvas = tiny_canvas();
            canvas.fps = 1;
            assert_eq!(capture_age_limit(canvas).unwrap(), Duration::from_secs(2));
            let debt = capture_debt(canvas, Duration::from_secs(2));
            assert_eq!(debt, Duration::from_millis(200));
            let past = now - Duration::from_millis(201);
            let shared = shared_at(past);
            let mut pacer = CapturePacer::new(past, 1);
            assert_eq!(
                pacer.wait_start(past, debt, &shared),
                Err(EncoderError::Stalled)
            );
            let mut written = Vec::new();
            assert_eq!(
                write_capture_complete(
                    &mut written,
                    &[7; 12],
                    &shared,
                    Duration::from_secs(2),
                    Instant::now() - Duration::from_nanos(1),
                    || Ok(true)
                ),
                Err(EncoderError::Stalled)
            );
            assert!(written.is_empty());
        }
        #[test]
        fn retired_visual_epoch_token_has_no_shared_history_owner() {
            let epoch = Instant::now();
            let feed = CaptureVideoFeed::new(Arc::from(vec![1; 12]), fence(0), epoch);
            feed.bind(1).unwrap();
            feed.activate(1).unwrap();
            let (_, owner) = feed.take_at(1, epoch).unwrap();
            let owner = owner.unwrap();
            let weak = Arc::downgrade(&owner.invalidated_at);
            feed.invalidate(fence(1), epoch + Duration::from_millis(1))
                .unwrap();
            feed.invalidate(fence(2), epoch + Duration::from_millis(2))
                .unwrap();
            feed.invalidate(fence(3), epoch + Duration::from_millis(3))
                .unwrap();
            assert!(weak.upgrade().is_some());
            drop(owner);
            assert!(
                weak.upgrade().is_none(),
                "Only retained owner frames may retain retired epoch tokens"
            );
        }

        #[test]
        fn actual_initialization_waits_for_hls_readiness_after_raw_ack_and_350ms_pressure() {
            let began = Instant::now();
            let feed = Arc::new(CaptureVideoFeed::new(
                Arc::from(vec![9; 12]),
                fence(0),
                began,
            ));
            feed.bind(1).unwrap();
            let mut shared = shared_at(began);
            lock(&shared.snapshot).state = EncoderState::Starting;
            let startup = Arc::new(CaptureStartup::new(
                10,
                began + Duration::from_secs(4),
                feed.clone(),
                1,
            ));
            Arc::get_mut(&mut shared).unwrap().capture_startup = Some(startup.clone());
            let vbytes = Arc::new(Mutex::new(Vec::new()));
            let abytes = Arc::new(Mutex::new(Vec::new()));
            let observed = Arc::new(Mutex::new(Vec::new()));
            let recorded = observed.clone();
            let audio = AudioInput::Timed(Arc::new(move |tick| {
                lock(&recorded).push(tick);
                vec![7; 1920]
            }));
            let ready_at = Arc::new(Mutex::new(None));
            let ready_record = ready_at.clone();
            let rs = shared.clone();
            let rb = startup.clone();
            let readiness = thread::spawn(move || {
                while lock(&rb.state).epoch.is_none() && !rs.stop.load(Ordering::Acquire) {
                    thread::sleep(Duration::from_millis(1));
                }
                thread::sleep(Duration::from_millis(350));
                let now = Instant::now();
                *lock(&ready_record) = Some(now);
                lock(&rs.snapshot).state = EncoderState::Playing;
            });
            let pf = feed.clone();
            let ps = shared.stop.clone();
            let publisher = thread::spawn(move || {
                while !ps.load(Ordering::Acquire) {
                    pf.publish(Arc::from(vec![9; 12]), fence(0), Instant::now())
                        .unwrap();
                    thread::sleep(Duration::from_millis(10));
                }
            });
            #[derive(Clone, Copy)]
            struct ReadinessCheckpoint {
                phase: CapturePhase,
                strict_full_writes: [u64; 2],
                last_full_targets: [Instant; 2],
                sampled_at: Instant,
                monitor_state: EncoderState,
            }
            let os = shared.clone();
            let ob = startup.clone();
            let observer = thread::spawn(move || {
                while Instant::now() < began + Duration::from_secs(4)
                    && !os.stop.load(Ordering::Acquire)
                {
                    if ob.ready(&os, Duration::from_millis(200)) {
                        // Recheck under the production startup->snapshot lock
                        // order; never call ready() recursively under state.
                        let state = lock(&ob.state);
                        let sampled_at = Instant::now();
                        let monitor_state = lock(&os.snapshot).state;
                        if state.phase == CapturePhase::Steady
                            && monitor_state == EncoderState::Playing
                            && state.lanes.iter().all(|lane| {
                                lane.strict_full_writes > 0
                                    && lane.last_full_target.is_some_and(|target| {
                                        sampled_at
                                            .checked_duration_since(target)
                                            .is_some_and(|age| age <= Duration::from_millis(200))
                                    })
                            })
                        {
                            let checkpoint = ReadinessCheckpoint {
                                phase: state.phase,
                                strict_full_writes: [
                                    state.lanes[0].strict_full_writes,
                                    state.lanes[1].strict_full_writes,
                                ],
                                last_full_targets: [
                                    state.lanes[0].last_full_target.unwrap(),
                                    state.lanes[1].last_full_target.unwrap(),
                                ],
                                sampled_at,
                                monitor_state,
                            };
                            ob.constructor_complete.store(true, Ordering::Release);
                            // In-flight writers may now finish cancellation and
                            // change phase to Failed(Cancelled); preserve the
                            // actual live readiness proof before that teardown.
                            os.stop.store(true, Ordering::Release);
                            return Some(checkpoint);
                        }
                    }
                    thread::sleep(Duration::from_millis(1));
                }
                os.stop.store(true, Ordering::Release);
                None
            });
            let vw = PressureWriter {
                blocked_until: began,
                inject_after: Some((12, Duration::from_millis(350))),
                frame_bytes: 12,
                accepted: vbytes.clone(),
                stop_after: usize::MAX,
                stop: shared.stop.clone(),
            };
            let aw = PressureWriter {
                blocked_until: began,
                inject_after: None,
                frame_bytes: 3840,
                accepted: abytes.clone(),
                stop_after: usize::MAX,
                stop: shared.stop.clone(),
            };
            let vs = shared.clone();
            let vf = feed.clone();
            let video = thread::spawn(move || {
                capture_video_loop(vw, vf, tiny_canvas(), Duration::from_secs(1), vs)
            });
            capture_audio_loop(
                aw,
                audio,
                tiny_canvas(),
                Duration::from_secs(1),
                shared.clone(),
            );
            video.join().unwrap();
            publisher.join().unwrap();
            readiness.join().unwrap();
            let checkpoint = observer
                .join()
                .unwrap()
                .expect("No atomic live readiness checkpoint");
            assert_eq!(checkpoint.phase, CapturePhase::Steady);
            assert_eq!(checkpoint.monitor_state, EncoderState::Playing);
            assert!(checkpoint
                .strict_full_writes
                .iter()
                .all(|count| *count >= 1));
            assert!(checkpoint.last_full_targets.iter().all(|target| {
                checkpoint
                    .sampled_at
                    .checked_duration_since(*target)
                    .is_some_and(|age| age <= Duration::from_millis(200))
            }));
            assert!(lock(&shared.error).is_none());
            let state = lock(&startup.state);
            let epoch = state.epoch.unwrap();
            let raw_ack_latch = epoch + startup.quantum;
            let published_ready = lock(&ready_at).unwrap();
            assert!(published_ready.duration_since(raw_ack_latch) >= Duration::from_millis(350));
            // Old Q-only readiness would begin a strict write here, whose
            // unchanged200ms absolute deadline precedes the350ms release.
            assert!(raw_ack_latch + Duration::from_millis(200) < published_ready);
            let gate = state.steady_at.unwrap();
            assert!(gate >= published_ready);
            match state.phase {
                CapturePhase::Steady => assert!(state.failure.is_none()),
                CapturePhase::Failed => assert_eq!(state.failure, Some(EncoderError::Cancelled)),
                CapturePhase::Initializing => {
                    panic!("Live readiness cannot return to initialization")
                }
            }
            assert!(state
                .steady_targets
                .iter()
                .all(|target| target.unwrap() >= gate));
            assert!(state.steady_capture.unwrap() <= state.steady_targets[0].unwrap());
            assert!(
                state.steady_targets[0]
                    .unwrap()
                    .duration_since(state.steady_capture.unwrap())
                    <= Duration::from_millis(200)
            );
            assert!(state.lanes.iter().all(|lane| lane.strict_full_writes >= 1));
            let first_v = state.lanes[0].first_strict_target.unwrap();
            let first_a = state.lanes[1].first_strict_target.unwrap();
            assert!(first_v >= gate && first_a >= gate);
            let prefix_v = (first_v.duration_since(epoch).as_nanos() / 100_000_000) as usize;
            let prefix_a = (first_a.duration_since(epoch).as_nanos() / 20_000_000) as usize;
            assert!(
                prefix_v > startup.video_units as usize && prefix_a > startup.audio_units as usize
            );
            let video_bytes = lock(&vbytes);
            let audio_bytes = lock(&abytes);
            assert!(video_bytes[..prefix_v * 12].iter().all(|byte| *byte == 0));
            assert_eq!(&video_bytes[prefix_v * 12..(prefix_v + 1) * 12], &[9; 12]);
            assert!(audio_bytes[..prefix_a * 3840].iter().all(|byte| *byte == 0));
            assert_eq!(*lock(&observed).first().unwrap(), first_a);
            assert_eq!(
                capture_debt(tiny_canvas(), Duration::from_secs(1)),
                Duration::from_millis(200)
            );
        }
        #[test]
        fn initialization_gate_is_atomic_fresh_idle_and_irreversible() {
            let now = Instant::now();
            let target = now + Duration::from_millis(500);
            let feed = Arc::new(CaptureVideoFeed::new(Arc::from(vec![0; 12]), fence(0), now));
            feed.bind(1).unwrap();
            let startup = CaptureStartup::new(1, now + Duration::from_secs(3), feed.clone(), 1);
            let shared = shared_at(now);
            lock(&shared.snapshot).state = EncoderState::Starting;
            startup.publish_next(0, target).unwrap();
            startup.publish_next(1, target).unwrap();
            assert!(!startup.try_steady(&shared, Duration::from_secs(2)).unwrap());
            lock(&shared.snapshot).state = EncoderState::Playing;
            let writing = startup.reserve(0, target).unwrap();
            assert!(!startup.try_steady(&shared, Duration::from_secs(2)).unwrap());
            writing.complete(target + Duration::from_secs(1)).unwrap();
            assert!(startup.try_steady(&shared, Duration::from_secs(2)).unwrap());
            lock(&shared.snapshot).state = EncoderState::Starting;
            assert!(startup.try_steady(&shared, Duration::from_secs(2)).unwrap());
            assert_eq!(startup.phase().unwrap(), CapturePhase::Steady);
            assert!(!startup.ready(&shared, Duration::from_millis(200)));
        }
        #[test]
        fn initialization_does_not_activate_stale_or_future_capture() {
            let now = Instant::now();
            let target = now + Duration::from_millis(500);
            for captured in [now - Duration::from_secs(3), now + Duration::from_secs(2)] {
                let feed = Arc::new(CaptureVideoFeed::new(
                    Arc::from(vec![0; 12]),
                    fence(0),
                    captured,
                ));
                feed.bind(1).unwrap();
                let startup = CaptureStartup::new(1, now + Duration::from_secs(3), feed.clone(), 1);
                let shared = shared_at(now);
                startup.publish_next(0, target).unwrap();
                startup.publish_next(1, target).unwrap();
                assert!(!startup.try_steady(&shared, Duration::from_secs(2)).unwrap());
                assert!(!feed.state.lock().unwrap().active);
            }
        }
        #[test]
        fn abandoned_reservation_fails_without_peer_ack_wait() {
            let now = Instant::now();
            let target = now + Duration::from_millis(500);
            let feed = Arc::new(CaptureVideoFeed::new(Arc::from(vec![0; 12]), fence(0), now));
            feed.bind(1).unwrap();
            let startup = CaptureStartup::new(1, now + Duration::from_secs(3), feed, 1);
            let shared = shared_at(now);
            startup.publish_next(0, target).unwrap();
            startup.publish_next(1, target).unwrap();
            let reservation = startup.reserve(0, target).unwrap();
            drop(reservation);
            assert_eq!(startup.phase(), Err(EncoderError::Cancelled));
            assert_eq!(
                startup.try_steady(&shared, Duration::from_secs(2)),
                Err(EncoderError::Cancelled)
            );
        }
        #[test]
        fn constructor_readiness_requires_both_strict_full_commits_and_recent_targets() {
            let now = Instant::now();
            let feed = Arc::new(CaptureVideoFeed::new(Arc::from(vec![0; 12]), fence(0), now));
            let startup = CaptureStartup::new(10, now + Duration::from_secs(2), feed, 1);
            let shared = shared_at(now);
            {
                let mut state = lock(&startup.state);
                state.phase = CapturePhase::Steady;
                state.lanes[1].strict_full_writes = 1;
                state.lanes[1].last_full_target = Some(now);
            }
            assert!(!startup.ready(&shared, Duration::from_millis(200)));
            {
                let mut state = lock(&startup.state);
                state.lanes[0].strict_full_writes = 1;
                state.lanes[0].last_full_target = Some(now - Duration::from_millis(201));
            }
            assert!(!startup.ready(&shared, Duration::from_millis(200)));
            lock(&startup.state).lanes[0].last_full_target = Some(now);
            assert!(startup.ready(&shared, Duration::from_millis(200)));
        }

        fn leaf(start: u64, count: u64, duration: &str, target: u32) -> Vec<u8> {
            let mut text=format!("#EXTM3U\n#EXT-X-VERSION:6\n#EXT-X-TARGETDURATION:{target}\n#EXT-X-MEDIA-SEQUENCE:{start}\n#EXT-X-INDEPENDENT-SEGMENTS\n");
            for index in start..start + count {
                text.push_str(&format!("#EXTINF:{duration},\nsegment-{index:06}.ts\n"));
            }
            text.into_bytes()
        }
        #[test]
        fn raw_generated_leaf_binds_first_sequence_count_and_last_closed_segment() {
            let playlist = parse_playlist(&leaf(0, 1, "1.000000", 1)).unwrap();
            assert_eq!(playlist.last_sequence, 0);
            assert_eq!(playlist.segments, vec!["segment-000000.ts"]);
            let playlist = parse_playlist(&leaf(48, 8, "1.000000", 1)).unwrap();
            assert_eq!(playlist.last_sequence, 55);
            assert_eq!(playlist.segments.len(), 8);
        }
        #[test]
        fn failed_output_directory_cleanup_can_be_retried() {
            let directory = std::env::temp_dir().join(format!(
                "ottplay-encoder-cleanup-{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            struct Cleanup(PathBuf);
            impl Drop for Cleanup {
                fn drop(&mut self) {
                    let _ = fs::remove_dir_all(&self.0);
                    let _ = fs::remove_file(&self.0);
                }
            }
            let _cleanup = Cleanup(directory.clone());
            fs::write(&directory, b"not a directory").unwrap();
            let now = Instant::now();
            let shared = Arc::new(Shared {
                stop: Arc::new(AtomicBool::new(false)),
                started: now,
                touched: Mutex::new(now),
                snapshot: Mutex::new(EncoderSnapshot {
                    pid: 0,
                    generation: 1,
                    frames: 0,
                    state: EncoderState::Starting,
                    monotonic_millis: 0,
                    hls_sequence: None,
                    hls_last_update_millis: 0,
                    audio_samples_written: 0,
                    video_frames_written: 0,
                }),
                error: Mutex::new(None),
                audio_samples_written: AtomicU64::new(0),
                video_frames_written: AtomicU64::new(0),
                capture_startup: None,
            });
            let mut encoder = Encoder {
                shared,
                directory: directory.clone(),
                monitor: None,
                video: None,
                audio: None,
                permit: None,
                cleaned: false,
            };

            assert_eq!(encoder.stop(), Err(EncoderError::Io));
            assert!(!encoder.cleaned);
            fs::remove_file(&directory).unwrap();
            fs::create_dir(&directory).unwrap();
            fs::write(directory.join("owned-output.ts"), b"fixture output").unwrap();

            assert_eq!(encoder.stop(), Ok(()));
            assert!(encoder.cleaned);
            assert!(!directory.exists());
        }

        #[test]
        fn raw_target_duration_is_checked_not_rewritten() {
            assert_eq!(
                parse_playlist(&leaf(0, 1, "1.000001", 1)),
                Err(EncoderError::InvalidManifest)
            );
            assert!(parse_playlist(&leaf(0, 1, "1.000001", 2)).is_ok());
            for duration in ["0", "-1", "NaN", "inf", "1e3", "1.0.0"] {
                assert_eq!(
                    parse_playlist(&leaf(0, 1, duration, 2)),
                    Err(EncoderError::InvalidManifest)
                );
            }
            assert_eq!(
                parse_playlist(&leaf(0, 1, "1.0", 0)),
                Err(EncoderError::InvalidManifest)
            );
        }
        #[test]
        fn duplicate_gap_path_and_unbounded_leaf_are_closed_errors() {
            let bytes = leaf(0, 2, "1.0", 1);
            let text = String::from_utf8(bytes).unwrap();
            for invalid in [
                text.replace("segment-000001.ts", "segment-000000.ts"),
                text.replace("segment-000001.ts", "segment-000002.ts"),
                text.replace("segment-000001.ts", "../segment-000001.ts"),
                text.replace("segment-000001.ts", "https://fixture.invalid/segment.ts"),
            ] {
                assert_eq!(
                    parse_playlist(invalid.as_bytes()),
                    Err(EncoderError::InvalidManifest)
                );
            }
            assert_eq!(
                parse_playlist(&leaf(0, 9, "1.0", 1)),
                Err(EncoderError::InvalidManifest)
            );
            assert_eq!(
                parse_playlist(&leaf(0, 0, "1.0", 1)),
                Err(EncoderError::InvalidManifest)
            );
            assert_eq!(
                parse_playlist(&vec![b'x'; PLAYLIST_LIMIT + 1]),
                Err(EncoderError::InvalidManifest)
            );
            let mut dangling = leaf(0, 1, "1.0", 1);
            dangling.extend_from_slice(b"#EXTINF:1.0,\n");
            assert_eq!(
                parse_playlist(&dangling),
                Err(EncoderError::InvalidManifest)
            );
        }
    }
}
#[cfg(any(target_os = "linux", target_os = "macos"))]
pub use runtime::Encoder;

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
pub struct Encoder;
#[cfg(not(any(target_os = "linux", target_os = "macos")))]
impl Encoder {
    pub fn start(
        _: EncoderConfig,
        _: VideoFeed,
        _: AudioFeed,
        _: Arc<AtomicBool>,
    ) -> Result<Self, EncoderError> {
        Err(EncoderError::Unsupported)
    }
    pub fn start_timed_audio(
        _: EncoderConfig,
        _: VideoFeed,
        _: TimedAudioFeed,
        _: Arc<AtomicBool>,
    ) -> Result<Self, EncoderError> {
        Err(EncoderError::Unsupported)
    }
    pub fn start_capture_av(
        _: EncoderConfig,
        _: Arc<CaptureVideoFeed>,
        _: TimedAudioFeed,
        _: Arc<AtomicBool>,
    ) -> Result<Self, EncoderError> {
        Err(EncoderError::Unsupported)
    }
    pub fn snapshot(&self) -> EncoderSnapshot {
        EncoderSnapshot {
            pid: 0,
            generation: 0,
            frames: 0,
            state: EncoderState::Stopped,
            monotonic_millis: 0,
            hls_sequence: None,
            hls_last_update_millis: 0,
            audio_samples_written: 0,
            video_frames_written: 0,
        }
    }
    pub fn output_directory(&self) -> &Path {
        Path::new("")
    }
    pub fn touch(&self) {}
    pub fn stop(&mut self) -> Result<(), EncoderError> {
        Ok(())
    }
}
#[cfg(not(any(target_os = "linux", target_os = "macos")))]
impl Drop for Encoder {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}
