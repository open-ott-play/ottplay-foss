//! One stable output encoder; sources and layout never enter its command line.
//! Feeds are trusted, nonblocking in-process snapshots. Audio callbacks must not
//! do IO or wait on a decoder. Disk limits are polling guards, not OS quotas.
use super::geometry::CanvasSpec;
use std::path::{Path, PathBuf};
use std::sync::{atomic::AtomicBool, Arc, Mutex};
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
    previous: Option<(CaptureFence, Instant)>,
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
        Self {
            bytes: initial.len(),
            state: Mutex::new(CaptureState {
                active: false,
                generation: None,
                fence,
                previous: None,
                sequence: 0,
                last_capture: captured_at,
                pending: Some(Arc::new(CaptureFrame {
                    generation: 0,
                    sequence: 0,
                    fence,
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
        state.previous = Some((state.fence, changed_at));
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
    #[cfg(any(target_os = "linux", target_os = "macos"))]
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
        fence: CaptureFence,
        target: Instant,
    ) -> Result<bool, EncoderError> {
        let state = self.state.lock().map_err(|_| EncoderError::Io)?;
        Ok(state.generation == Some(generation)
            && (state.fence.same_visual(fence)
                || state.previous.is_some_and(|(previous, until)| {
                    previous.same_visual(fence) && target < until
                })))
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

    struct CaptureStartupState {
        video_done: bool,
        audio_done: bool,
        epoch: Option<Instant>,
    }
    struct CaptureStartup {
        state: Mutex<CaptureStartupState>,
        audio_reserved: AtomicBool,
        deadline: Instant,
        quantum: Duration,
        video_units: u64,
        audio_units: u64,
        feed: Arc<CaptureVideoFeed>,
        generation: u64,
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
                }),
                audio_reserved: AtomicBool::new(false),
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
                    self.feed.activate(self.generation)?;
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
        fn ready(&self) -> bool {
            lock(&self.state).epoch.is_some() && self.audio_reserved.load(Ordering::Acquire)
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
            || !feed.accepts(generation, frame.fence, target)?
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
            while !shared.stop.load(Ordering::Acquire) {
                let target = media_target(epoch, index, canvas.fps)?;
                pacer.wait_start(target, debt, &shared)?;
                let frame =
                    select_capture(&feed, generation, target, debt, &committed, &mut repeats)?;
                if frame.len() != canvas.width as usize * canvas.height as usize * 3 {
                    return Err(EncoderError::InvalidConfig);
                }
                let absolute = target
                    .checked_add(debt)
                    .ok_or(EncoderError::InvalidConfig)?;
                // The selected immutable frame is atomic across ordinary control
                // changes; output stop/deadline still aborts partial writes.
                match &frame.pixels {
                    CapturePixels::Rgb(bytes) => write_capture_complete(
                        &mut writer,
                        bytes,
                        &shared,
                        stall,
                        absolute,
                        || Ok(true),
                    )?,
                    CapturePixels::Black(bytes) => {
                        write_black_complete(&mut writer, *bytes, &shared, stall, absolute, || {
                            Ok(true)
                        })?
                    }
                }
                shared.video_frames_written.fetch_add(1, Ordering::Relaxed);
                committed = Some(frame);
                index = index.checked_add(1).ok_or(EncoderError::InvalidConfig)?;
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
            let mut pacer = CapturePacer::new(epoch, 50);
            let mut index = startup.audio_units;
            while !shared.stop.load(Ordering::Acquire) {
                let target = media_target(epoch, index, 50)?;
                pacer.wait_start(target, debt, &shared)?;
                let samples = feed.at(target);
                startup.audio_reserved.store(true, Ordering::Release);
                if samples.len() != 1920 {
                    return Err(EncoderError::InvalidConfig);
                }
                let mut bytes = [0u8; 3840];
                for (target, sample) in bytes.chunks_exact_mut(2).zip(samples) {
                    target.copy_from_slice(&sample.to_le_bytes());
                }
                let absolute = target
                    .checked_add(debt)
                    .ok_or(EncoderError::InvalidConfig)?;
                write_capture_complete(&mut writer, &bytes, &shared, stall, absolute, || Ok(true))?;
                shared
                    .audio_samples_written
                    .fetch_add(1920, Ordering::Relaxed);
                index = index.checked_add(1).ok_or(EncoderError::InvalidConfig)?;
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
                match encoder.snapshot().state {
                    EncoderState::Playing
                        if shared
                            .capture_startup
                            .as_ref()
                            .is_none_or(|startup| startup.ready()) =>
                    {
                        return Ok(encoder)
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
            let startup = Arc::new(CaptureStartup::new(
                10,
                epoch + Duration::from_secs(2),
                feed,
                1,
            ));
            {
                let mut state = lock(&startup.state);
                if video {
                    state.audio_done = true;
                } else {
                    state.video_done = true;
                }
            }
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
                .accepts(1, fence(0), epoch + Duration::from_millis(1))
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
                if accepted.len() >= self.frame_bytes * self.stop_after {
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
                began + Duration::from_secs(2),
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
            let publisher_feed = feed.clone();
            let publisher_stop = shared.stop.clone();
            let publisher = thread::spawn(move || {
                while !publisher_stop.load(Ordering::Acquire) {
                    publisher_feed
                        .publish(Arc::from(vec![9; 12]), fence(0), Instant::now())
                        .unwrap();
                    thread::sleep(Duration::from_millis(10));
                }
            });
            let video_writer = PressureWriter {
                blocked_until: began + Duration::from_millis(350),
                inject_after: None,
                frame_bytes: 12,
                accepted: vbytes.clone(),
                stop_after: 3,
                stop: shared.stop.clone(),
            };
            let audio_writer = PressureWriter {
                blocked_until: began,
                inject_after: None,
                frame_bytes: 3840,
                accepted: abytes.clone(),
                stop_after: 6,
                stop: shared.stop.clone(),
            };
            let vshared = shared.clone();
            let vfeed = feed.clone();
            let video = thread::spawn(move || {
                capture_video_loop(
                    video_writer,
                    vfeed,
                    tiny_canvas(),
                    Duration::from_secs(1),
                    vshared,
                )
            });
            capture_audio_loop(
                audio_writer,
                audio,
                tiny_canvas(),
                Duration::from_secs(1),
                shared.clone(),
            );
            video.join().unwrap();
            publisher.join().unwrap();
            assert!(lock(&shared.error).is_none());
            assert!(lock(&vbytes)[..12].iter().all(|byte| *byte == 0));
            assert!(lock(&abytes)[..5 * 3840].iter().all(|byte| *byte == 0));
            let epoch = lock(&startup.state).epoch.unwrap();
            let steady = epoch + startup.quantum;
            assert!(steady.duration_since(began) >= Duration::from_millis(350));
            assert_eq!(*lock(&observed).first().unwrap(), steady);
            assert_eq!(
                shared.audio_samples_written.load(Ordering::Relaxed),
                6 * 1920
            );
            assert!(shared.video_frames_written.load(Ordering::Relaxed) >= startup.video_units);
            assert!(startup.ready());
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
                .accepts(1, frame.fence, now + Duration::from_millis(2))
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
                .accepts(1, frame.fence, now + Duration::from_millis(2))
                .unwrap());
            assert!(!feed
                .accepts(1, frame.fence, now + Duration::from_millis(3))
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
