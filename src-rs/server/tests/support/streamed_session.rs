//! Opt-in Unix Session fixture using the real core and owned synthetic inputs.
//! This helper does not register a router or grant production/native capacity.
//! The caller owns the unchanged 110-second external process-group deadline;
//! filesystem operations and thread joins here are cooperative, not hard bounds.

#[path = "streamed_archive.rs"]
mod archive_v2;
#[path = "streamed_transport.rs"]
mod pump;

use archive_v2::{sha256, Archive};
use ottplay_core::multiview::{
    decoder::{self, BoundContext, DecoderError, GrantedStream, PublicationAuthority},
    encoder::{
        EncoderError, EncoderFailureDetail, EncoderFailureLane, EncoderFailureSite, EncoderState,
    },
    frames::FrameSpec,
    geometry::{CanvasSpec, ImportedRect, OverlapPolicy, ValidatedGeometry},
    persistent::{AudioPolicy, Config, Session, SlotState, Snapshot},
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    os::unix::fs::{DirBuilderExt, OpenOptionsExt},
    path::{Component, Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

const INPUT_SECONDS: u64 = 90;
const B_HOLD_SECONDS: u64 = 75;
const INPUT_LIMIT: u64 = 16 * 1024 * 1024;
const MANIFEST_LIMIT: u64 = 64 * 1024;
const EVENT_LIMIT: usize = 8 * 1024 * 1024;

fn require(condition: bool, reason: &str) -> Result<(), String> {
    if condition {
        Ok(())
    } else {
        Err(reason.to_owned())
    }
}
fn error(stage: &str, value: impl std::fmt::Debug) -> String {
    format!("{stage}: {value:?}")
}
fn absolute_normal(path: &Path) -> bool {
    path.is_absolute()
        && path
            .components()
            .all(|part| matches!(part, Component::RootDir | Component::Normal(_)))
}
fn env_path(name: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(std::env::var_os(name).ok_or_else(|| format!("missing {name}"))?);
    require(
        absolute_normal(&path),
        "fixture paths must be absolute and normalized",
    )?;
    Ok(path)
}
fn tool(name: &str) -> Result<PathBuf, String> {
    let path = env_path(name)?
        .canonicalize()
        .map_err(|e| error("fixture tool", e))?;
    require(path.is_file(), "fixture tool must be an absolute file")?;
    Ok(path)
}
fn private_dir(path: &Path) -> Result<(), String> {
    fs::DirBuilder::new()
        .mode(0o700)
        .create(path)
        .map_err(|e| error("fresh owned directory", e))
}
fn read_regular(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    require(
        absolute_normal(path),
        "input path must be absolute and normalized",
    )?;
    // These are immutable, runner-owned fixture paths, not user media grants.
    // Reject symlinks in every existing component, not only the final file.
    let mut component_path = PathBuf::new();
    for component in path.components() {
        component_path.push(component.as_os_str());
        let metadata =
            fs::symlink_metadata(&component_path).map_err(|e| error("owned input component", e))?;
        require(
            !metadata.file_type().is_symlink(),
            "owned input contains a symlink",
        )?;
    }
    let mut file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)
        .map_err(|e| error("open owned input", e))?;
    let metadata = file
        .metadata()
        .map_err(|e| error("owned input metadata", e))?;
    require(
        metadata.is_file() && metadata.len() > 0 && metadata.len() <= limit,
        "owned input is not a bounded regular file",
    )?;
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    (&mut file)
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| error("read owned input", e))?;
    require(
        bytes.len() as u64 == metadata.len() && bytes.len() as u64 <= limit,
        "owned input length changed",
    )?;
    Ok(bytes)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct InputManifest {
    schema: String,
    seconds: u64,
    fps: u32,
    width: u32,
    height: u32,
    inputs: Vec<InputEntry>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct InputEntry {
    id: u8,
    path: PathBuf,
    bytes: u64,
    sha256: String,
}
struct OwnedInput {
    id: u8,
    path: PathBuf,
    payload: Arc<[u8]>,
    sha256: String,
}
struct OwnedInputs {
    manifest_sha256: String,
    sources: Vec<OwnedInput>,
}
fn load_inputs(path: &Path) -> Result<OwnedInputs, String> {
    let bytes = read_regular(path, MANIFEST_LIMIT)?;
    let mut manifest: InputManifest =
        serde_json::from_slice(&bytes).map_err(|e| error("input manifest", e))?;
    require(
        manifest.schema == "ottplay.multiview.stream-inputs.v1"
            && manifest.seconds == INPUT_SECONDS
            && manifest.fps == 10
            && manifest.width == 96
            && manifest.height == 64,
        "unsupported fixture manifest geometry or duration",
    )?;
    require(
        manifest.inputs.len() == 2,
        "exactly two fixture sources are required",
    )?;
    manifest.inputs.sort_by_key(|entry| entry.id);
    let mut sources = Vec::with_capacity(2);
    let mut common_parent = None;
    for (index, entry) in manifest.inputs.into_iter().enumerate() {
        require(
            entry.id == index as u8 + 1,
            "fixture source ids must be exactly 1 and 2",
        )?;
        require(
            absolute_normal(&entry.path)
                && entry.path.file_name()
                    == Some(std::ffi::OsStr::new(&format!("source-{}.ts", entry.id))),
            "fixture source filename does not match its id",
        )?;
        require(
            entry.bytes > 0 && entry.bytes <= INPUT_LIMIT,
            "fixture source length exceeds its bound",
        )?;
        require(
            entry.sha256.len() == 64
                && entry
                    .sha256
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)),
            "fixture source requires a lowercase SHA256",
        )?;
        let parent = entry
            .path
            .parent()
            .ok_or_else(|| "fixture source has no parent".to_owned())?
            .canonicalize()
            .map_err(|e| error("fixture input parent", e))?;
        if let Some(expected) = &common_parent {
            require(
                expected == &parent,
                "fixture sources must share a canonical parent",
            )?;
        } else {
            common_parent = Some(parent);
        }
        let payload = read_regular(&entry.path, INPUT_LIMIT)?;
        require(
            payload.len() as u64 == entry.bytes && sha256(&payload) == entry.sha256,
            "fixture source byte count or SHA256 mismatch",
        )?;
        sources.push(OwnedInput {
            id: entry.id,
            path: entry.path,
            payload: payload.into(),
            sha256: entry.sha256,
        });
    }
    Ok(OwnedInputs {
        manifest_sha256: sha256(&bytes),
        sources,
    })
}
fn fresh_case(path: &Path) -> Result<PathBuf, String> {
    require(
        absolute_normal(path),
        "case directory must be absolute and normalized",
    )?;
    let parent = path
        .parent()
        .ok_or_else(|| "case directory has no parent".to_owned())?
        .canonicalize()
        .map_err(|e| error("case parent", e))?;
    let name = path
        .file_name()
        .ok_or_else(|| "case directory has no final name".to_owned())?;
    let canonical = parent.join(name);
    require(
        matches!(fs::symlink_metadata(&canonical), Err(e) if e.kind() == std::io::ErrorKind::NotFound),
        "case directory must be fresh",
    )?;
    private_dir(&canonical)?;
    Ok(canonical)
}
fn metadata_dirs() -> Result<Vec<String>, String> {
    let prefix = format!("ottplay-decode-{}-", std::process::id());
    let mut names = Vec::new();
    for entry in
        fs::read_dir(std::env::temp_dir()).map_err(|e| error("metadata directory inventory", e))?
    {
        let entry = entry.map_err(|e| error("metadata directory entry", e))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with(&prefix) {
            names.push(name);
            require(
                names.len() <= 64,
                "metadata directory inventory exceeds fixture limit",
            )?;
        }
    }
    names.sort();
    Ok(names)
}
fn pid_absent(pid: u32) -> bool {
    // Signal zero only inspects the owned PID; it sends no process signal.
    (unsafe { libc::kill(pid as libc::pid_t, 0) }) == -1
        && std::io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH)
}
fn snapshot_json(snapshot: &Snapshot) -> Value {
    let slots: Vec<_> = snapshot.slots.iter().map(|source| {
        let audio = source.audio;
        json!({"slot_id":source.slot_id,"source_revision":source.source_revision,
            "decoder_pid":source.decoder_pid,"frames":source.frames,"state":format!("{:?}",source.state),
            "audio":{"pushed_samples":audio.pushed_samples,"dropped_old_samples":audio.dropped_old_samples,
                "underflow_missing_samples":audio.underflow_missing_samples,"selected_dropped_samples":audio.selected_dropped_samples,
                "selected_underflow_samples":audio.selected_underflow_samples,"buffered_samples":audio.buffered_samples,
                "selected":audio.selected,"unresolved_timing_samples":audio.unresolved_timing_samples}})
    }).collect();
    json!({"runtime":snapshot.runtime,"geometry_revision":snapshot.geometry_revision,
        "focus_revision":snapshot.focus_revision,"audio_revision":snapshot.audio_revision,
        "focus_slot":snapshot.focus_slot,"audio_slot":snapshot.audio_slot,"audio_callback_misses":snapshot.audio_callback_misses,
        "encoder_pid":snapshot.encoder_pid,"output_generation":snapshot.output_generation,"output_frames":snapshot.output_frames,
        "output_state":format!("{:?}",snapshot.output_state),"monotonic_millis":snapshot.monotonic_millis,
        "hls_sequence":snapshot.hls_sequence,"hls_last_update_millis":snapshot.hls_last_update_millis,
        "audio_samples_written":snapshot.audio_samples_written,"video_frames_written":snapshot.video_frames_written,"slots":slots})
}
// Only closed enum labels and the already logged numeric/enum snapshot enter
// this fixture error. Never include subprocess stderr, tool paths or grant data.
fn encoder_error_label(cause: Option<EncoderError>) -> &'static str {
    match cause {
        Some(EncoderError::InvalidConfig) => "InvalidConfig",
        Some(EncoderError::Unsupported) => "Unsupported",
        Some(EncoderError::Busy) => "Busy",
        Some(EncoderError::Cancelled) => "Cancelled",
        Some(EncoderError::StartupTimeout) => "StartupTimeout",
        Some(EncoderError::Stalled) => "Stalled",
        Some(EncoderError::Deadline) => "Deadline",
        Some(EncoderError::Idle) => "Idle",
        Some(EncoderError::DiskLimit) => "DiskLimit",
        Some(EncoderError::Io) => "Io",
        Some(EncoderError::ProcessFailed) => "ProcessFailed",
        Some(EncoderError::InvalidManifest) => "InvalidManifest",
        None => "Unavailable",
    }
}
fn failure_detail_json(detail: Option<EncoderFailureDetail>) -> Value {
    let (site, lane) = match detail {
        Some(detail) => (
            match detail.site {
                EncoderFailureSite::SelectionMissing => "SelectionMissing",
                EncoderFailureSite::SelectionFuture => "SelectionFuture",
                EncoderFailureSite::SelectionOwner => "SelectionOwner",
                EncoderFailureSite::SelectionAge => "SelectionAge",
                EncoderFailureSite::SelectionRepeat => "SelectionRepeat",
                EncoderFailureSite::PacerDebt => "PacerDebt",
                EncoderFailureSite::WriteAbsolute => "WriteAbsolute",
                EncoderFailureSite::WriteNoProgress => "WriteNoProgress",
                EncoderFailureSite::MonitorProgress => "MonitorProgress",
                EncoderFailureSite::MonitorHls => "MonitorHls",
                EncoderFailureSite::Other => "Other",
            },
            match detail.lane {
                EncoderFailureLane::Video => "Video",
                EncoderFailureLane::Audio => "Audio",
                EncoderFailureLane::Monitor => "Monitor",
                EncoderFailureLane::Other => "Other",
            },
        ),
        None => ("Unavailable", "Unavailable"),
    };
    json!({"error":encoder_error_label(detail.map(|value| value.error)),"site":site,"lane":lane})
}
fn output_failure_message(
    snapshot: &Snapshot,
    cause: impl FnOnce() -> Option<EncoderFailureDetail>,
) -> Option<String> {
    if snapshot.output_state != EncoderState::Failed {
        return None;
    }
    let detail = cause();
    let cause = encoder_error_label(detail.map(|value| value.error));
    Some(format!(
        "encoder output Failed: cause={cause}; detail={}; snapshot={}",
        failure_detail_json(detail),
        snapshot_json(snapshot)
    ))
}

// Observe an already failed scenario before collector/Session cleanup can erase
// the causal output state. A diagnostic failure must never replace the original.
fn retain_failure_observation(
    original: Option<String>,
    observe: impl FnOnce() -> Result<(), String>,
) -> Option<String> {
    original.map(|first| match observe() {
        Ok(()) => first,
        Err(observation) => format!("{first}; final output observation: {observation}"),
    })
}

struct Events {
    file: File,
    started: Instant,
    previous_write_us: u128,
    count: u64,
    bytes: usize,
}
impl Events {
    fn new(root: &Path) -> Result<Self, String> {
        Ok(Self {
            file: OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(root.join("EVENTS.jsonl"))
                .map_err(|e| error("event file", e))?,
            started: Instant::now(),
            previous_write_us: 0,
            count: 0,
            bytes: 0,
        })
    }
    fn note(&mut self, phase: &str, session: &Session) -> Result<Snapshot, String> {
        let begin = Instant::now();
        let snapshot = session.snapshot();
        let read_us = begin.elapsed().as_micros();
        let row = json!({"phase":phase,"driver_elapsed_ms":self.started.elapsed().as_millis(),
            "snapshot_call_us":read_us,"previous_event_write_us":self.previous_write_us,
            "audio_policy":format!("{:?}",snapshot.audio_policy),"snapshot":snapshot_json(&snapshot)});
        let mut bytes = serde_json::to_vec(&row).map_err(|e| error("event encoding", e))?;
        bytes.push(b'\n');
        require(
            self.bytes
                .checked_add(bytes.len())
                .is_some_and(|total| total <= EVENT_LIMIT),
            "event log exceeds fixture limit",
        )?;
        let writing = Instant::now();
        self.file
            .write_all(&bytes)
            .map_err(|e| error("event write", e))?;
        self.previous_write_us = writing.elapsed().as_micros();
        self.bytes += bytes.len();
        self.count += 1;
        // Preserve the exact observation before failing; the scenario boundary
        // retains this error in CONTROL and still executes its normal cleanup.
        if let Some(failure) = output_failure_message(&snapshot, || session.output_failure_detail())
        {
            return Err(failure);
        }
        Ok(snapshot) // The exact logged value is the one used by every assertion.
    }
}

struct FixtureAuthority {
    context: BoundContext,
    active: Mutex<bool>,
}
impl PublicationAuthority for FixtureAuthority {
    fn attach(
        &self,
        context: &BoundContext,
        operation: &mut dyn FnMut() -> Result<(), DecoderError>,
    ) -> Result<(), DecoderError> {
        let mut active = self.active.lock().map_err(|_| DecoderError::Io)?;
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
        let active = self.active.lock().map_err(|_| DecoderError::Io)?;
        if context != &self.context || !*active {
            return Err(DecoderError::PublicationDenied);
        }
        operation()
    }
}
struct ProducerOwner {
    label: String,
    producer: pump::Producer,
}
#[derive(Default)]
struct Producers {
    owners: Vec<ProducerOwner>,
    receipts: Vec<String>,
}
impl Producers {
    fn add(&mut self, label: String, producer: pump::Producer) -> usize {
        let index = self.owners.len();
        self.owners.push(ProducerOwner { label, producer });
        index
    }
    fn retire(&mut self, index: usize) -> Result<(), String> {
        let owner = &mut self.owners[index];
        if owner.producer.is_joined() {
            return Ok(());
        }
        let outcome = owner
            .producer
            .stop_and_join(Duration::from_secs(2))
            .map_err(|e| error("producer retirement", e))?;
        self.receipts.push(format!("{}:{outcome:?}", owner.label));
        require(outcome.joined, "producer did not join")
    }
    fn finish(&mut self) -> bool {
        for owner in &self.owners {
            owner.producer.request_cancel();
        }
        let mut joined = true;
        for index in 0..self.owners.len() {
            if let Err(failure) = self.retire(index) {
                joined = false;
                self.receipts.push(failure);
            }
        }
        joined && self.owners.iter().all(|owner| owner.producer.is_joined())
    }
}
impl Drop for Producers {
    fn drop(&mut self) {
        for owner in &self.owners {
            owner.producer.request_cancel();
        }
        for owner in &mut self.owners {
            if !owner.producer.is_joined() {
                let _ = owner.producer.stop_and_join(Duration::from_secs(5));
            }
        }
    }
}
struct Collector {
    stop: Arc<AtomicBool>,
    failure: Arc<Mutex<Option<String>>>,
    thread: Option<JoinHandle<Result<String, String>>>,
}
impl Collector {
    fn new(source: PathBuf, destination: PathBuf) -> Result<Self, String> {
        let stop = Arc::new(AtomicBool::new(false));
        let failure = Arc::new(Mutex::new(None));
        let done = stop.clone();
        let status = failure.clone();
        let thread = thread::Builder::new()
            .name("multiview-fixture-archive".into())
            .spawn(move || {
                let mut archive = match Archive::new(source, destination) {
                    Ok(archive) => archive,
                    Err(failure) => {
                        if let Ok(mut slot) = status.lock() {
                            *slot = Some(failure.clone());
                        }
                        return Err(failure);
                    }
                };
                let captured = (|| {
                    while !done.load(Ordering::Acquire) {
                        archive.capture()?;
                        thread::sleep(Duration::from_millis(500));
                    }
                    archive.capture()
                })();
                let result = archive.finish(
                    captured.is_ok(),
                    captured.as_ref().err().map(String::as_str),
                );
                if let Err(failure) = &result {
                    if let Ok(mut slot) = status.lock() {
                        *slot = Some(failure.clone());
                    }
                }
                result
            })
            .map_err(|e| error("archive thread", e))?;
        Ok(Self {
            stop,
            failure,
            thread: Some(thread),
        })
    }
    fn check(&self) -> Result<(), String> {
        let status = self
            .failure
            .lock()
            .map_err(|_| "archive status poisoned".to_owned())?;
        status.clone().map_or(Ok(()), Err)
    }
    fn finish(&mut self) -> Result<String, String> {
        self.stop.store(true, Ordering::Release);
        self.thread
            .take()
            .ok_or_else(|| "archive already joined".to_owned())?
            .join()
            .map_err(|_| "archive thread panicked".to_owned())?
    }
}
impl Drop for Collector {
    fn drop(&mut self) {
        if self.thread.is_some() {
            let _ = self.finish();
        }
    }
}
#[derive(Default)]
struct Control {
    b_begin: Value,
    b_end: Value,
    a_return_begin: Value,
    a_return_end: Value,
    a_cut: Option<String>,
    b_cut: Option<String>,
    intervals: Vec<Value>,
    metadata_during: Vec<String>,
    count: u64,
}
fn pip() -> Result<ValidatedGeometry, String> {
    ValidatedGeometry::new(
        CanvasSpec {
            width: 384,
            height: 288,
            fps: 10,
        },
        0,
        &[
            ImportedRect {
                slot_id: 0,
                x: 0,
                y: 0,
                width: 384,
                height: 288,
                z: 0,
            },
            ImportedRect {
                slot_id: 1,
                x: 256,
                y: 0,
                width: 128,
                height: 96,
                z: 1,
            },
        ],
        OverlapPolicy::Pip,
    )
    .map_err(|e| error("fixture geometry", e))
}
fn closed_playlist(session: &Session, root: &Path, name: &str) -> Result<String, String> {
    let path = session.output_directory().join("index.m3u8");
    let bytes = read_regular(&path, MANIFEST_LIMIT)?;
    let text = std::str::from_utf8(&bytes).map_err(|e| error("cutoff UTF8", e))?;
    require(
        text.starts_with("#EXTM3U\n"),
        "cutoff is not an HLS playlist",
    )?;
    let names: Vec<_> = text
        .lines()
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .collect();
    require(!names.is_empty(), "cutoff has no closed segments")?;
    for item in names {
        let number = item
            .strip_prefix("segment-")
            .and_then(|v| v.strip_suffix(".ts"))
            .ok_or_else(|| "cutoff has an unexpected media name".to_owned())?;
        require(
            number.len() == 6 && number.bytes().all(|b| b.is_ascii_digit()),
            "cutoff has an invalid segment name",
        )?;
    }
    OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(root.join(name))
        .and_then(|mut file| file.write_all(&bytes))
        .map_err(|e| error("literal cutoff write", e))?;
    Ok(sha256(&bytes))
}
fn scenario(
    session: &mut Session,
    inputs: &OwnedInputs,
    producers: &mut Producers,
    events: &mut Events,
    collector: &Collector,
    root: &Path,
    control: &mut Control,
) -> Result<(), String> {
    for source in &inputs.sources {
        let slot = source.id - 1;
        let prep = session
            .capture_stream_preparation(slot, 0)
            .map_err(|e| error("capture source", e))?;
        let context = prep.bound_context();
        let grant = GrantedStream::from_authorized_stream(
            context,
            Instant::now() + Duration::from_secs(95),
            Arc::new(AtomicBool::new(false)),
            Arc::new(FixtureAuthority {
                context,
                active: Mutex::new(false),
            }),
        )
        .map_err(|e| error("fixture grant", e))?;
        let options = pump::Options::for_duration(Duration::from_secs(6))
            .map_err(|e| error("probe options", e))?;
        let (reader, producer) = pump::pair_with_options(source.payload.clone(), options)
            .map_err(|e| error("probe producer", e))?;
        let owner = producers.add(format!("probe{slot}"), producer);
        let input = grant
            .wrap_probe(reader)
            .map_err(|e| error("probe descriptor", e))?;
        let prepared = decoder::probe_stream(
            prep.decoder_config(),
            &grant,
            input,
            prep.stop_token(),
            Instant::now() + Duration::from_secs(5),
        );
        producers.retire(owner)?;
        let prepared = prepared.map_err(|e| error("actual source probe", e))?;
        let mut options = pump::Options::for_duration(Duration::from_secs(95))
            .map_err(|e| error("decode options", e))?;
        options.max_bytes_per_second = Some(source.payload.len() / INPUT_SECONDS as usize);
        let (reader, producer) = pump::pair_with_options(source.payload.clone(), options)
            .map_err(|e| error("decode producer", e))?;
        producers.add(format!("decode{slot}"), producer);
        let input = grant
            .wrap_decode(reader)
            .map_err(|e| error("decode descriptor", e))?;
        require(
            session
                .commit_stream(prep, &grant, prepared, input)
                .map_err(|e| error("commit source", e))?
                == 1,
            "unexpected committed source revision",
        )?;
    }
    let startup = Instant::now() + Duration::from_secs(10);
    loop {
        let snapshot = events.note("startup", session)?;
        if snapshot
            .slots
            .iter()
            .take(2)
            .all(|source| source.state == SlotState::Playing && source.frames >= 3)
            && snapshot.output_frames > 0
        {
            break;
        }
        require(Instant::now() < startup, "fixture startup deadline")?;
        collector.check()?;
        thread::sleep(Duration::from_millis(50));
    }
    control.metadata_during = metadata_dirs()?;
    let before = events.note("A_initial_policy_before", session)?;
    session
        .set_audio_policy(AudioPolicy::Slot(0), before.audio_revision)
        .map_err(|e| error("initial audio owner", e))?;
    let stable = events.note("stable_identity_baseline", session)?;
    let pids = [stable.slots[0].decoder_pid, stable.slots[1].decoder_pid];
    for (label, slot, seconds) in [
        ("A_initial", 0u8, 2u64),
        ("B_selected", 1, B_HOLD_SECONDS),
        ("A_return", 0, 4),
    ] {
        if label != "A_initial" {
            let before = events.note(&format!("{label}_policy_before"), session)?;
            session
                .set_audio_policy(AudioPolicy::Slot(slot), before.audio_revision)
                .map_err(|e| error("change audio owner", e))?;
        }
        let selected = events.note(&format!("{label}_begin"), session)?;
        require(
            selected.audio_slot == Some(slot),
            "unexpected selected audio owner",
        )?;
        if slot == 1 {
            control.b_begin = snapshot_json(&selected);
        }
        if label == "A_return" {
            control.a_return_begin = snapshot_json(&selected);
        }
        let until = Instant::now() + Duration::from_secs(seconds);
        let mut keepalive = Instant::now() + Duration::from_secs(20);
        while Instant::now() < until {
            let snapshot = events.note(&format!("{label}_monitor"), session)?;
            require(
                snapshot.runtime == stable.runtime
                    && snapshot.encoder_pid == stable.encoder_pid
                    && snapshot.output_generation == stable.output_generation
                    && snapshot.geometry_revision == stable.geometry_revision,
                "output identity changed",
            )?;
            require(
                snapshot.audio_slot == Some(slot)
                    && snapshot.audio_revision == selected.audio_revision,
                "selected audio route changed",
            )?;
            require(
                format!("{:?}", snapshot.output_state) == "Playing",
                "output is not Playing",
            )?;
            for (index, pid) in pids.iter().enumerate() {
                let source = &snapshot.slots[index];
                require(
                    source.decoder_pid == *pid
                        && source.source_revision == 1
                        && source.state == SlotState::Playing,
                    "source identity or playback state changed",
                )?;
            }
            collector.check()?;
            if Instant::now() >= keepalive {
                let before = events.note("focus_keepalive_before", session)?;
                session
                    .focus(0, before.focus_revision)
                    .map_err(|e| error("focus keepalive", e))?;
                keepalive += Duration::from_secs(20);
                events.note("focus_keepalive_audio_unchanged", session)?;
            }
            control.count += 1;
            thread::sleep(Duration::from_millis(50));
        }
        let end = events.note(&format!("{label}_end"), session)?;
        let elapsed = end
            .monotonic_millis
            .checked_sub(selected.monotonic_millis)
            .ok_or_else(|| "host clock regressed".to_owned())?;
        let first = selected.slots[usize::from(slot)].audio;
        let last = end.slots[usize::from(slot)].audio;
        let dropped = last
            .selected_dropped_samples
            .checked_sub(first.selected_dropped_samples)
            .ok_or_else(|| "drop counter regressed".to_owned())?;
        let underflow = last
            .selected_underflow_samples
            .checked_sub(first.selected_underflow_samples)
            .ok_or_else(|| "underflow counter regressed".to_owned())?;
        let misses = end
            .audio_callback_misses
            .checked_sub(selected.audio_callback_misses)
            .ok_or_else(|| "callback counter regressed".to_owned())?;
        require(
            elapsed >= seconds * 1000 && dropped == 0 && underflow == 0 && misses == 0,
            "selected interval duration or PCM counters failed",
        )?;
        require(
            end.encoder_pid == stable.encoder_pid && end.audio_slot == Some(slot),
            "selected end identity changed",
        )?;
        for (index, pid) in pids.iter().enumerate() {
            require(
                end.slots[index].decoder_pid == *pid
                    && end.slots[index].state == SlotState::Playing,
                "selected end source changed",
            )?;
        }
        control.intervals.push(json!({"phase":label,"slot":slot,"planned_seconds":seconds,"actual_host_millis":elapsed,
            "selected_dropped_samples_delta":dropped,"selected_underflow_samples_delta":underflow,"audio_callback_miss_delta":misses,
            "audio_samples_written_begin":selected.audio_samples_written,"audio_samples_written_end":end.audio_samples_written}));
        if label == "A_initial" {
            control.a_cut = Some(closed_playlist(session, root, "A-END-LIVE.m3u8")?);
            events.note("A_closed_prefix_cut_BEFORE_B_command", session)?;
        }
        if slot == 1 {
            control.b_end = snapshot_json(&end);
            control.b_cut = Some(closed_playlist(session, root, "B-END-LIVE.m3u8")?);
            events.note("B_closed_prefix_cut_BEFORE_A_command", session)?;
        }
        if label == "A_return" {
            control.a_return_end = snapshot_json(&end);
        }
    }
    Ok(())
}

/// Run only after the explicit ignored-test invocation has an owned input
/// manifest, a fresh WORK case path and an external 110-second supervisor.
pub fn run_from_env() -> Result<(), String> {
    let inputs = load_inputs(&env_path("OTTPLAY_MULTIVIEW_STREAM_INPUTS")?)?;
    let ffmpeg = tool("OTTPLAY_MULTIVIEW_FFMPEG")?;
    let ffprobe = tool("OTTPLAY_MULTIVIEW_FFPROBE")?;
    let root = fresh_case(&env_path("OTTPLAY_MULTIVIEW_STREAM_CASE_DIR")?)?;
    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        run_case(&inputs, ffmpeg, ffprobe, &root)
    }));
    let result = match outcome {
        Ok(result) => result,
        Err(_) => Err("fixture setup or cleanup panicked".to_owned()),
    };
    if let Err(failure) = &result {
        // All run_case owners have dropped before this setup-error fallback.
        // Never claim PID/producer proof when setup did not reach its receipt.
        let control = root.join("CONTROL.json");
        if !control.exists() {
            let live = root.join("live");
            let live_removed = match fs::remove_dir(&live) {
                Ok(()) => true,
                Err(error) => error.kind() == std::io::ErrorKind::NotFound,
            };
            let report = json!({"pass":false,"setup_or_cleanup_error":failure,
                "cleanup_proof_complete":false,"empty_live_directory_removed":live_removed});
            let bytes =
                serde_json::to_vec_pretty(&report).map_err(|e| error("failure receipt", e))?;
            OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(control)
                .and_then(|mut file| file.write_all(&bytes))
                .map_err(|e| error("failure receipt write", e))?;
        }
    }
    result
}

fn run_case(
    inputs: &OwnedInputs,
    ffmpeg: PathBuf,
    ffprobe: PathBuf,
    root: &Path,
) -> Result<(), String> {
    let live = root.join("live");
    private_dir(&live)?;
    let metadata_before = metadata_dirs()?;
    let mut config = Config::new(ffmpeg, ffprobe, live.clone());
    config.frame_spec = FrameSpec {
        width: 96,
        height: 64,
    };
    config.stale_after = Duration::from_millis(600);
    config.max_duration = Duration::from_secs(100);
    config.idle_timeout = Duration::from_secs(30);
    let mut session = Session::start(config, pip()?).map_err(|e| error("Session startup", e))?;
    let mut producers = Producers::default();
    let mut collector = Collector::new(
        session.output_directory().to_path_buf(),
        root.join("archive"),
    )?;
    let mut events = Events::new(root)?;
    let mut control = Control::default();
    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        scenario(
            &mut session,
            inputs,
            &mut producers,
            &mut events,
            &collector,
            root,
            &mut control,
        )
    }));
    let scenario_error = retain_failure_observation(
        match outcome {
            Ok(Ok(())) => None,
            Ok(Err(failure)) => Some(failure),
            Err(_) => Some("fixture scenario panicked".to_owned()),
        },
        || events.note("failure", &session).map(|_| ()),
    );
    let archive_result = collector.finish();
    let shutdown = session.shutdown();
    let (owned, output_removed, shutdown_error) = match shutdown {
        Ok(receipt) => (receipt.owned_pids, receipt.output_removed, None),
        Err(failure) => (Vec::new(), false, Some(error("Session shutdown", failure))),
    };
    // Only a successful, nonempty shutdown receipt proves which children
    // belonged to this actor. An absent receipt is not vacuous PID proof.
    let pids_absent =
        shutdown_error.is_none() && !owned.is_empty() && owned.iter().all(|pid| pid_absent(*pid));
    let producers_joined = producers.finish();
    let live_removed = output_removed && pids_absent && fs::remove_dir(&live).is_ok();
    let metadata_after = metadata_dirs()?;
    let metadata_clean = metadata_before == metadata_after;
    let archive_ok = archive_result.is_ok();
    let archive = match archive_result {
        Ok(text) => {
            serde_json::from_str::<Value>(&text).map_err(|e| error("archive receipt", e))?
        }
        Err(failure) => json!({"error":failure}),
    };
    let pass = scenario_error.is_none()
        && archive_ok
        && output_removed
        && live_removed
        && pids_absent
        && producers_joined
        && metadata_clean;
    events
        .file
        .sync_data()
        .map_err(|e| error("event sync", e))?;
    let source_receipts: Vec<_> = inputs.sources.iter().map(|source| json!({"id":source.id,"path":source.path,"bytes":source.payload.len(),"sha256":source.sha256})).collect();
    let report = json!({"scope":"actual ottplay_core Session with synthetic trusted FD grants and paced UnixStream producers; not production/native admission",
        "pass":pass,"scenario_error":scenario_error,"sample_count":control.count,"event_count":events.count,
        "planned_B_host_hold_seconds":B_HOLD_SECONDS,"selected_intervals":control.intervals,"B_selected_begin":control.b_begin,"B_selected_end":control.b_end,
        "A_return_begin":control.a_return_begin,"A_return_end":control.a_return_end,"A_end_live_playlist_sha256":control.a_cut,
        "B_end_live_playlist_sha256":control.b_cut,"input_manifest_sha256":inputs.manifest_sha256,"inputs":source_receipts,
        "metadata_fifo_guard":{"before":metadata_before,"during":control.metadata_during,"after":metadata_after,"clean":metadata_clean},
        "producers_joined":producers_joined,"producer_receipts":producers.receipts,
        "archive":archive,"shutdown":{"owned_pids":owned,"output_removed":output_removed,"live_directory_removed":live_removed,
            "all_owned_pids_absent":pids_absent,"error":shutdown_error}});
    let bytes = serde_json::to_vec_pretty(&report).map_err(|e| error("control receipt", e))?;
    require(
        bytes.len() <= 256 * 1024,
        "control receipt exceeds fixture bound",
    )?;
    OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(root.join("CONTROL.json"))
        .and_then(|mut file| file.write_all(&bytes))
        .map_err(|e| error("control receipt write", e))?;
    require(
        pass,
        "streamed Session fixture failed; inspect owned CONTROL/EVENTS/archive",
    )
}

#[cfg(test)]
mod output_failure_tests {
    use super::*;

    fn detail(error: EncoderError) -> EncoderFailureDetail {
        EncoderFailureDetail {
            error,
            site: EncoderFailureSite::Other,
            lane: EncoderFailureLane::Other,
        }
    }

    fn snapshot(state: EncoderState) -> Snapshot {
        Snapshot {
            runtime: u64::MAX,
            geometry_revision: 2,
            focus_revision: 3,
            audio_revision: 4,
            focus_slot: 0,
            audio_policy: AudioPolicy::Muted,
            audio_slot: None,
            encoder_pid: 7,
            output_generation: 11,
            output_frames: 19,
            output_state: state,
            hls_sequence: Some(23),
            hls_last_update_millis: 29,
            audio_samples_written: 31,
            video_frames_written: 37,
            slots: Vec::new(),
            monotonic_millis: 41,
            audio_callback_misses: 43,
        }
    }

    #[test]
    fn failed_output_records_each_closed_cause_and_the_observed_counters() {
        for (cause, expected) in [
            (EncoderError::InvalidConfig, "InvalidConfig"),
            (EncoderError::Unsupported, "Unsupported"),
            (EncoderError::Busy, "Busy"),
            (EncoderError::Cancelled, "Cancelled"),
            (EncoderError::StartupTimeout, "StartupTimeout"),
            (EncoderError::Stalled, "Stalled"),
            (EncoderError::Deadline, "Deadline"),
            (EncoderError::Idle, "Idle"),
            (EncoderError::DiskLimit, "DiskLimit"),
            (EncoderError::Io, "Io"),
            (EncoderError::ProcessFailed, "ProcessFailed"),
            (EncoderError::InvalidManifest, "InvalidManifest"),
        ] {
            let message =
                output_failure_message(&snapshot(EncoderState::Failed), || Some(detail(cause)))
                    .expect("Failed must fail immediately with a closed cause");
            assert!(message.starts_with(&format!("encoder output Failed: cause={expected};")));
            assert!(
                expected.len() <= 15 && expected.bytes().all(|byte| byte.is_ascii_alphabetic())
            );
            let observed: Value =
                serde_json::from_str(message.split_once("; snapshot=").unwrap().1)
                    .expect("counter snapshot remains structured JSON");
            assert_eq!(observed, snapshot_json(&snapshot(EncoderState::Failed)));
            assert_eq!(observed["output_frames"], 19);
            assert_eq!(observed["audio_samples_written"], 31);
            assert_eq!(observed["video_frames_written"], 37);
            assert!(!message.contains('\n') && message.len() <= 4096);
        }
    }

    #[test]
    fn failed_output_without_latched_cause_is_explicitly_uncertain() {
        let message = output_failure_message(&snapshot(EncoderState::Failed), || None)
            .expect("Failed without a cause must still fail immediately");
        assert!(message.starts_with("encoder output Failed: cause=Unavailable;"));
        assert!(!message.contains("ProcessFailed") && !message.contains("StartupTimeout"));
    }

    #[test]
    fn nonfailed_output_never_turns_a_stale_or_missing_cause_into_failure() {
        for state in [
            EncoderState::Starting,
            EncoderState::Playing,
            EncoderState::Stopped,
        ] {
            for cause in [
                None,
                Some(EncoderError::Io),
                Some(EncoderError::ProcessFailed),
            ] {
                let accessed = std::cell::Cell::new(false);
                assert!(output_failure_message(&snapshot(state), || {
                    accessed.set(true);
                    cause.map(detail)
                })
                .is_none());
                assert!(
                    !accessed.get(),
                    "nonfailed output must not query the failure accessor"
                );
            }
        }
    }
    #[test]
    fn successful_scenario_never_requests_failure_observation() {
        assert_eq!(
            retain_failure_observation(None, || panic!("success must not query output failure")),
            None
        );
    }

    #[test]
    fn early_failure_keeps_original_error_and_observes_exactly_once() {
        for observation in [
            Ok(()),
            Err("encoder output Failed: cause=Stalled".to_owned()),
        ] {
            let calls = std::cell::Cell::new(0);
            let expected = match &observation {
                Ok(()) => "actual source probe: Cancelled".to_owned(),
                Err(detail) => {
                    format!("actual source probe: Cancelled; final output observation: {detail}")
                }
            };
            let actual = retain_failure_observation(
                Some("actual source probe: Cancelled".to_owned()),
                || {
                    calls.set(calls.get() + 1);
                    observation
                },
            );
            assert_eq!(calls.get(), 1);
            assert_eq!(actual.as_deref(), Some(expected.as_str()));
        }
    }

    #[test]
    fn failure_detail_serialization_is_closed_and_explicitly_unavailable() {
        for (site, site_label) in [
            (EncoderFailureSite::SelectionMissing, "SelectionMissing"),
            (EncoderFailureSite::SelectionFuture, "SelectionFuture"),
            (EncoderFailureSite::SelectionOwner, "SelectionOwner"),
            (EncoderFailureSite::SelectionAge, "SelectionAge"),
            (EncoderFailureSite::SelectionRepeat, "SelectionRepeat"),
            (EncoderFailureSite::PacerDebt, "PacerDebt"),
            (EncoderFailureSite::WriteAbsolute, "WriteAbsolute"),
            (EncoderFailureSite::WriteNoProgress, "WriteNoProgress"),
            (EncoderFailureSite::MonitorProgress, "MonitorProgress"),
            (EncoderFailureSite::MonitorHls, "MonitorHls"),
            (EncoderFailureSite::Other, "Other"),
        ] {
            for (lane, lane_label) in [
                (EncoderFailureLane::Video, "Video"),
                (EncoderFailureLane::Audio, "Audio"),
                (EncoderFailureLane::Monitor, "Monitor"),
                (EncoderFailureLane::Other, "Other"),
            ] {
                let value = failure_detail_json(Some(EncoderFailureDetail {
                    error: EncoderError::Stalled,
                    site,
                    lane,
                }));
                assert_eq!(
                    value,
                    json!({"error":"Stalled","site":site_label,"lane":lane_label})
                );
                assert_eq!(value.as_object().unwrap().len(), 3);
                for label in [site_label, lane_label] {
                    assert!(
                        label.len() <= 16 && label.bytes().all(|byte| byte.is_ascii_alphabetic())
                    );
                }
            }
        }
        assert_eq!(
            failure_detail_json(None),
            json!({"error":"Unavailable","site":"Unavailable","lane":"Unavailable"})
        );
    }

    #[test]
    fn early_output_failure_keeps_origin_detail_and_parseable_snapshot() {
        let original = EncoderFailureDetail {
            error: EncoderError::Stalled,
            site: EncoderFailureSite::SelectionAge,
            lane: EncoderFailureLane::Video,
        };
        let calls = std::cell::Cell::new(0);
        let message = output_failure_message(&snapshot(EncoderState::Failed), || {
            calls.set(calls.get() + 1);
            Some(original)
        })
        .unwrap();
        assert_eq!(calls.get(), 1);
        let (prefix, counters) = message.split_once("; snapshot=").unwrap();
        let (cause, origin) = prefix.split_once("; detail=").unwrap();
        assert_eq!(cause, "encoder output Failed: cause=Stalled");
        assert_eq!(
            serde_json::from_str::<Value>(origin).unwrap(),
            json!({"error":"Stalled","site":"SelectionAge","lane":"Video"})
        );
        assert_eq!(
            serde_json::from_str::<Value>(counters).unwrap(),
            snapshot_json(&snapshot(EncoderState::Failed))
        );
        let retained =
            retain_failure_observation(Some("commit source: Stopped".to_owned()), || {
                Err(message.clone())
            })
            .unwrap();
        assert_eq!(
            retained,
            format!("commit source: Stopped; final output observation: {message}")
        );
    }
}
