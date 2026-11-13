//! Bounded, local-file-only composition proof. This is not a production media route.
//! Plan dimensions are declarations for trusted synthetic fixtures, not an input
//! probe or qualification of independent production sources. Disk checks are
//! polling safeguards with possible overshoot, not an operating-system quota.

use super::plan::Plan;
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant};

static FIXTURE_RUNNING: AtomicBool = AtomicBool::new(false);
const PROGRESS_LIMIT: u64 = 65_536;

pub struct LocalInput {
    pub slot: u8,
    pub path: PathBuf,
}

pub struct WorkerConfig {
    pub ffmpeg: PathBuf,
    pub output_root: PathBuf,
    pub max_disk_bytes: u64,
    pub startup_timeout: Duration,
    pub stall_timeout: Duration,
    pub total_timeout: Duration,
}

#[derive(Debug, PartialEq, Eq)]
pub enum WorkerError {
    InvalidInput,
    Unsupported,
    Busy,
    Cancelled,
    StartupTimeout,
    Stalled,
    Deadline,
    DiskLimit,
    SourceFailed,
    Io,
}

#[derive(Debug)]
pub struct Completed {
    pub frames: u64,
    pub output_file: PathBuf,
}

struct Permit;
impl Permit {
    fn acquire() -> Result<Self, WorkerError> {
        FIXTURE_RUNNING
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map(|_| Self)
            .map_err(|_| WorkerError::Busy)
    }
}
impl Drop for Permit {
    fn drop(&mut self) {
        FIXTURE_RUNNING.store(false, Ordering::Release);
    }
}

/// Own the child immediately after spawn; every return path kills and reaps it.
struct ChildGuard(Child);
impl Drop for ChildGuard {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

struct OutputGuard {
    path: PathBuf,
    keep: bool,
}
impl Drop for OutputGuard {
    fn drop(&mut self) {
        if !self.keep {
            let _ = fs::remove_dir_all(&self.path);
        }
    }
}

fn local_inputs(
    root: &Path,
    plan: &Plan,
    inputs: &[LocalInput],
) -> Result<Vec<PathBuf>, WorkerError> {
    if inputs.is_empty() || inputs.len() > 9 || inputs.len() != plan.input_slots.len() {
        return Err(WorkerError::InvalidInput);
    }
    let expected_root = root.join("inputs");
    let input_root = expected_root
        .canonicalize()
        .map_err(|_| WorkerError::InvalidInput)?;
    // The grant directory itself must not be a symlink to somewhere else.
    if input_root != expected_root || !input_root.is_dir() {
        return Err(WorkerError::InvalidInput);
    }
    let mut ordered = Vec::with_capacity(inputs.len());
    let mut seen = Vec::with_capacity(inputs.len());
    for slot in &plan.input_slots {
        if seen.contains(slot) {
            return Err(WorkerError::InvalidInput);
        }
        seen.push(*slot);
        let mut matching = inputs.iter().filter(|input| input.slot == *slot);
        let input = matching.next().ok_or(WorkerError::InvalidInput)?;
        if matching.next().is_some() {
            return Err(WorkerError::InvalidInput);
        }
        let path = input
            .path
            .canonicalize()
            .map_err(|_| WorkerError::InvalidInput)?;
        if !path.starts_with(&input_root) || !path.is_file() {
            return Err(WorkerError::InvalidInput);
        }
        ordered.push(path);
    }
    Ok(ordered)
}

fn disk_usage(output: &Path, progress: &Path) -> Result<u64, WorkerError> {
    let size = |path: &Path| match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_file() => Ok(metadata.len()),
        Ok(_) => Err(WorkerError::Io),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(0),
        Err(_) => Err(WorkerError::Io),
    };
    size(output)?
        .checked_add(size(progress)?)
        .ok_or(WorkerError::DiskLimit)
}

fn frames(progress: &Path) -> Result<u64, WorkerError> {
    let file = File::open(progress).map_err(|_| WorkerError::Io)?;
    if file.metadata().map_err(|_| WorkerError::Io)?.len() > PROGRESS_LIMIT {
        return Err(WorkerError::DiskLimit);
    }
    let mut bytes = Vec::new();
    file.take(PROGRESS_LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| WorkerError::Io)?;
    if bytes.len() as u64 > PROGRESS_LIMIT {
        return Err(WorkerError::DiskLimit);
    }
    let mut latest = 0;
    for line in bytes.split(|byte| *byte == b'\n') {
        if let Some(value) = line.strip_prefix(b"frame=") {
            if let Ok(value) = std::str::from_utf8(value) {
                if let Ok(value) = value.trim().parse::<u64>() {
                    latest = latest.max(value);
                }
            }
        }
    }
    Ok(latest)
}

/// Execute synthetic local fixtures only. Neither process creation nor geometry
/// constitutes production capacity or proof that the requested videos rendered.
pub fn run_fixture(
    config: &WorkerConfig,
    plan: &Plan,
    inputs: &[LocalInput],
    cancel: &AtomicBool,
) -> Result<Completed, WorkerError> {
    if cancel.load(Ordering::Acquire) {
        return Err(WorkerError::Cancelled);
    }
    if config.max_disk_bytes == 0
        || config.max_disk_bytes > 128 * 1024 * 1024
        || config.startup_timeout.is_zero()
        || config.stall_timeout.is_zero()
        || config.total_timeout.is_zero()
        || plan.validate().is_err()
        || plan.output.width == 0
        || plan.output.height == 0
        || plan.output.fps == 0
        || plan.output.width > 1920
        || plan.output.height > 1080
        || plan.output.fps > 30
        || plan
            .audio_owner_input
            .is_some_and(|index| index >= inputs.len())
    {
        return Err(WorkerError::InvalidInput);
    }
    let root = config
        .output_root
        .canonicalize()
        .map_err(|_| WorkerError::InvalidInput)?;
    if !root.is_dir() {
        return Err(WorkerError::InvalidInput);
    }
    let ordered = local_inputs(&root, plan, inputs)?;
    let ffmpeg = config
        .ffmpeg
        .canonicalize()
        .map_err(|_| WorkerError::Unsupported)?;
    if !ffmpeg.is_file() {
        return Err(WorkerError::Unsupported);
    }
    let _permit = Permit::acquire()?;
    let directory = root.join("output");
    fs::create_dir(&directory).map_err(|error| {
        if error.kind() == std::io::ErrorKind::AlreadyExists {
            WorkerError::Busy
        } else {
            WorkerError::Io
        }
    })?;
    let mut output_guard = OutputGuard {
        path: directory.clone(),
        keep: false,
    };
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))
            .map_err(|_| WorkerError::Io)?;
    }
    let output_file = directory.join("composite.mp4");
    let progress_file = directory.join("progress.txt");
    File::options()
        .write(true)
        .create_new(true)
        .open(&progress_file)
        .map_err(|_| WorkerError::Io)?;
    let mut command = Command::new(ffmpeg);
    command.args([
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-n",
        "-filter_threads",
        "1",
        "-filter_complex_threads",
        "1",
    ]);
    for input in ordered {
        // Do not allow HLS/concat manifests to reference URLs or other local files.
        command
            .args([
                "-protocol_whitelist",
                "file,pipe",
                "-format_whitelist",
                "mov,matroska,webm,mpegts,avi",
                "-threads",
                "1",
                "-max_pixels",
                "2073600",
                "-i",
            ])
            .arg(input);
    }
    command.args(["-filter_complex", &plan.filter_graph, "-map", "[vout]"]);
    if let Some(owner) = plan.audio_owner_input {
        command.args(["-map", &format!("{owner}:a:0"), "-c:a", "aac", "-ac", "2"]);
    } else {
        command.arg("-an");
    }
    command
        .args([
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-pix_fmt",
            "yuv420p",
            "-threads",
            "1",
            "-shortest",
            "-t",
        ])
        .arg(format!("{:.3}", config.total_timeout.as_secs_f64()))
        .args([
            "-map_metadata",
            "-1",
            "-map_chapters",
            "-1",
            "-stats_period",
            "0.1",
            "-progress",
        ])
        .arg(&progress_file)
        .arg("-fs")
        .arg(config.max_disk_bytes.to_string())
        .args(["-f", "mp4"])
        .arg(&output_file)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let started = Instant::now();
    let child = command.spawn().map_err(|_| WorkerError::Unsupported)?;
    let mut child = ChildGuard(child);
    let mut changed = started;
    let mut observed_frames = 0;
    loop {
        if cancel.load(Ordering::Acquire) {
            return Err(WorkerError::Cancelled);
        }
        if started.elapsed() >= config.total_timeout {
            return Err(WorkerError::Deadline);
        }
        if disk_usage(&output_file, &progress_file)? > config.max_disk_bytes {
            return Err(WorkerError::DiskLimit);
        }
        let current_frames = frames(&progress_file)?;
        if current_frames > observed_frames {
            observed_frames = current_frames;
            changed = Instant::now();
        }
        if let Some(status) = child.0.try_wait().map_err(|_| WorkerError::Io)? {
            observed_frames = observed_frames.max(frames(&progress_file)?);
            if disk_usage(&output_file, &progress_file)? > config.max_disk_bytes {
                return Err(WorkerError::DiskLimit);
            }
            if !status.success()
                || observed_frames == 0
                || fs::metadata(&output_file)
                    .map(|m| m.len() == 0)
                    .unwrap_or(true)
            {
                return Err(WorkerError::SourceFailed);
            }
            output_guard.keep = true;
            return Ok(Completed {
                frames: observed_frames,
                output_file,
            });
        }
        if observed_frames == 0 && started.elapsed() >= config.startup_timeout {
            return Err(WorkerError::StartupTimeout);
        }
        if observed_frames > 0 && changed.elapsed() >= config.stall_timeout {
            return Err(WorkerError::Stalled);
        }
        thread::sleep(Duration::from_millis(20));
    }
}
