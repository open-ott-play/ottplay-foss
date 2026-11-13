//! One stable output encoder; sources and layout never enter its command line.
//! Feeds are trusted, nonblocking in-process snapshots. Audio callbacks must not
//! do IO or wait on a decoder. Disk limits are polling guards, not OS quotas.
use super::geometry::CanvasSpec;
use std::path::{Path, PathBuf};
use std::sync::{atomic::AtomicBool, Arc, Mutex};
use std::time::Duration;

pub type VideoFeed = Arc<Mutex<Arc<[u8]>>>;
pub type AudioFeed = Arc<dyn Fn() -> Vec<i16> + Send + Sync>;

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

    struct Shared {
        stop: Arc<AtomicBool>,
        started: Instant,
        touched: Mutex<Instant>,
        snapshot: Mutex<EncoderSnapshot>,
        error: Mutex<Option<EncoderError>>,
        audio_samples_written: AtomicU64,
        video_frames_written: AtomicU64,
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
    fn audio_loop(mut writer: File, feed: AudioFeed, stall: Duration, shared: Arc<Shared>) {
        let period = Duration::from_millis(20);
        let mut deadline = Instant::now();
        while !shared.stop.load(Ordering::Acquire) {
            let samples = feed();
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
            match video.try_lock() {
                Ok(frame) if frame.len() == expected => {}
                _ => return Err(EncoderError::InvalidConfig),
            }
            let permit = Permit::acquire()?;
            let generation = GENERATION
                .fetch_update(Ordering::AcqRel, Ordering::Acquire, |value| {
                    value.checked_add(1)
                })
                .map_err(|_| EncoderError::InvalidConfig)?;
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
            let shared = Arc::new(Shared {
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
                .spawn(move || video_loop(video_writer, video, canvas, stall, shared_video))
            {
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
                .spawn(move || audio_loop(audio_writer, audio, stall, shared_audio))
            {
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
                    EncoderState::Playing => return Ok(encoder),
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
                    Ok(()) => {}
                    Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                    Err(_) => failed = true,
                }
                self.cleaned = true;
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
