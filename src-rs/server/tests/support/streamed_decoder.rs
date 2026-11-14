//! Explicit Unix fixture for the actual streamed Decoder and presentation clock.
//! These path modules compile the literal core sources with their test observers;
//! they do not copy source, replace media proof, or expose a production API.
//! Run the single ignored entry with an external process-group deadline. Blocking
//! filesystem operations and Decoder::stop joins remain externally supervised.

#[path = "../../../core/src/multiview/decoder.rs"]
mod decoder;
#[path = "../../../core/src/multiview/frames.rs"]
mod frames;
#[path = "../../../core/src/multiview/geometry.rs"]
mod geometry;
#[path = "streamed_transport.rs"]
mod pump;
#[path = "../../../core/src/multiview/timing.rs"]
mod timing;

use decoder::{
    AudioQueue, BoundContext, Decoder, DecoderConfig, DecoderError, GrantedStream,
    PresentationClock, PublicationAuthority, TimedAudioObservation,
};
use frames::{FrameSpec, FrameStatus, FrameView, LatestFrame};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt},
    path::{Component, Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

const GENERATION: u64 = 1;
const STEP: Duration = Duration::from_millis(20);
const POLL: Duration = Duration::from_millis(2);
const CASE_LIMIT: Duration = Duration::from_secs(12);
const INPUT_LIMIT: u64 = 1024 * 1024;

fn require(ok: bool, message: &str) -> Result<(), String> {
    if ok {
        Ok(())
    } else {
        Err(message.to_owned())
    }
}
fn failure(stage: &str, error: impl std::fmt::Debug) -> String {
    format!("{stage}: {error:?}")
}
fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn env_path(name: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(std::env::var_os(name).ok_or_else(|| format!("missing {name}"))?);
    require(
        path.is_absolute()
            && path
                .components()
                .all(|c| matches!(c, Component::RootDir | Component::Normal(_))),
        "absolute normalized path required",
    )?;
    Ok(path)
}
fn tool(name: &str) -> Result<PathBuf, String> {
    let path = env_path(name)?
        .canonicalize()
        .map_err(|e| failure("tool path", e))?;
    require(path.is_file(), "explicit tool must be a file")?;
    Ok(path)
}
fn read_regular(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    require(path.is_absolute(), "input must be absolute")?;
    let mut file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)
        .map_err(|e| failure("open immutable fixture input", e))?;
    let metadata = file.metadata().map_err(|e| failure("input metadata", e))?;
    require(
        metadata.is_file() && metadata.len() > 0 && metadata.len() <= limit,
        "input must be a bounded regular file",
    )?;
    let mut bytes = Vec::new();
    (&mut file)
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| failure("input read", e))?;
    require(
        bytes.len() as u64 == metadata.len(),
        "input changed while reading",
    )?;
    Ok(bytes)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Manifest {
    schema: String,
    width: u32,
    height: u32,
    fps: u32,
    inputs: Vec<Entry>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Entry {
    id: String,
    path: PathBuf,
    bytes: u64,
    sha256: String,
}
struct Input {
    id: String,
    bytes: Arc<[u8]>,
    sha256: String,
    audio_frames: i128,
    video_frames: u64,
}
fn inputs() -> Result<(String, Vec<Input>), String> {
    let bytes = read_regular(&env_path("OTTPLAY_MULTIVIEW_PENDING_INPUTS")?, 16 * 1024)?;
    let mut manifest: Manifest =
        serde_json::from_slice(&bytes).map_err(|e| failure("input manifest", e))?;
    require(
        manifest.schema == "ottplay.multiview.pending-inputs.v1"
            && manifest.width == 96
            && manifest.height == 64
            && manifest.fps == 10
            && manifest.inputs.len() == 2,
        "unsupported pending fixture manifest",
    )?;
    manifest.inputs.sort_by(|a, b| a.id.cmp(&b.id));
    let mut inputs = Vec::new();
    for (entry, (id, audio_frames, video_frames)) in manifest
        .inputs
        .into_iter()
        .zip([("a1-v3", 49_152, 30), ("a3-v1", 145_408, 10)])
    {
        require(
            entry.id == id && entry.bytes <= INPUT_LIMIT,
            "unexpected input id/size",
        )?;
        let payload = read_regular(&entry.path, INPUT_LIMIT)?;
        require(
            payload.len() as u64 == entry.bytes && sha256(&payload) == entry.sha256,
            "input byte count or hash mismatch",
        )?;
        inputs.push(Input {
            id: entry.id,
            bytes: payload.into(),
            sha256: entry.sha256,
            audio_frames,
            video_frames,
        });
    }
    Ok((sha256(&bytes), inputs))
}

struct Authority {
    context: BoundContext,
    active: Mutex<bool>,
    revoked: Arc<AtomicBool>,
}
impl Authority {
    fn revoke(&self, video: &LatestFrame) -> Result<u64, String> {
        let _guard = self
            .active
            .lock()
            .map_err(|e| failure("revoke barrier", e))?;
        self.revoked.store(true, Ordering::Release);
        // Sample after linearizing revocation while publication is excluded.
        Ok(video.sequence())
    }
}
impl PublicationAuthority for Authority {
    fn attach(
        &self,
        context: &BoundContext,
        operation: &mut dyn FnMut() -> Result<(), DecoderError>,
    ) -> Result<(), DecoderError> {
        let mut active = self.active.lock().map_err(|_| DecoderError::Io)?;
        if context != &self.context || *active || self.revoked.load(Ordering::Acquire) {
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
        if context != &self.context || !*active || self.revoked.load(Ordering::Acquire) {
            return Err(DecoderError::PublicationDenied);
        }
        operation()
    }
}

// Every producer remains owned until an explicit joined receipt; Drop is only
// a failure cleanup attempt, never a successful qualification receipt.
struct PumpOwner(Option<pump::Producer>);
impl PumpOwner {
    fn finish(&mut self, cancel: bool) -> Result<pump::Outcome, String> {
        let producer = self
            .0
            .as_mut()
            .ok_or_else(|| "producer already joined".to_owned())?;
        let result = if cancel {
            producer.stop_and_join(Duration::from_secs(1))
        } else {
            producer.join_until(Duration::from_secs(1))
        }
        .map_err(|e| failure("producer join", e))?;
        require(
            result.joined && producer.is_joined(),
            "producer retirement not confirmed",
        )?;
        self.0.take();
        Ok(result)
    }
}
impl Drop for PumpOwner {
    fn drop(&mut self) {
        if let Some(producer) = &mut self.0 {
            let _ = producer.stop_and_join(Duration::from_secs(1));
        }
    }
}

struct Running {
    decoder: Option<Decoder>,
    pump: PumpOwner,
    source: GrantedStream,
    authority: Arc<Authority>,
    video: Arc<LatestFrame>,
    audio: Arc<AudioQueue>,
    clock: Arc<PresentationClock>,
    start: Instant,
    deadline: Instant,
    probe_receipt: pump::Outcome,
}
impl Running {
    fn new(config: &DecoderConfig, input: &Input) -> Result<Self, String> {
        let deadline = Instant::now() + CASE_LIMIT;
        let context = BoundContext {
            runtime: 1,
            slot_id: 0,
            source_revision: 0,
            geometry_revision: 1,
            focus_revision: 0,
            audio_revision: 0,
        };
        let revoked = Arc::new(AtomicBool::new(false));
        let authority = Arc::new(Authority {
            context,
            active: Mutex::new(false),
            revoked: revoked.clone(),
        });
        let source = GrantedStream::from_authorized_stream(
            context,
            deadline + Duration::from_secs(3),
            revoked,
            authority.clone(),
        )
        .map_err(|e| failure("stream grant", e))?;
        let (reader, producer) = pump::pair(input.bytes.clone(), Duration::from_secs(6))
            .map_err(|e| failure("probe producer", e))?;
        let mut probe_owner = PumpOwner(Some(producer));
        let probe_input = source
            .wrap_probe(reader)
            .map_err(|e| failure("probe descriptor", e))?;
        let prepared = decoder::probe_stream(
            config,
            &source,
            probe_input,
            &AtomicBool::new(false),
            Instant::now() + Duration::from_secs(5),
        );
        // Successful FFprobe may close its input early: producer completion is
        // cleanup evidence, never a substitute for the genuine sealed proof.
        let probe_receipt = probe_owner.finish(true)?;
        let prepared = prepared.map_err(|e| failure("actual stream probe", e))?;
        let info = prepared.info();
        require(
            info.width == 96
                && info.height == 64
                && info.has_audio
                && (info.fps - 10.0).abs() < 0.01,
            "unexpected probed fixture geometry/audio",
        )?;
        let (reader, producer) = pump::pair(input.bytes.clone(), CASE_LIMIT)
            .map_err(|e| failure("fresh decode producer", e))?;
        let pump = PumpOwner(Some(producer));
        let decode_input = source
            .wrap_decode(reader)
            .map_err(|e| failure("decode descriptor", e))?;
        let video = Arc::new(
            LatestFrame::new(config.frame_spec, GENERATION)
                .map_err(|e| failure("frame mailbox", e))?,
        );
        let audio = Arc::new(AudioQueue::new(GENERATION));
        audio
            .set_selected(GENERATION, true)
            .map_err(|e| failure("selected audio", e))?;
        let clock = Arc::new(PresentationClock::new());
        let start = Instant::now();
        clock
            .publish(start)
            .map_err(|e| failure("initial presentation clock", e))?;
        let decoder = Decoder::start_stream_with_clock(
            config,
            &source,
            prepared,
            decode_input,
            GENERATION,
            video.clone(),
            audio.clone(),
            clock.clone(),
        )
        .map_err(|e| failure("actual streamed decoder", e))?;
        let running = Self {
            decoder: Some(decoder),
            pump,
            source,
            authority,
            video,
            audio,
            clock,
            start,
            deadline,
            probe_receipt,
        };
        running
            .source
            .attach(&context, &mut || Ok(()))
            .map_err(|e| failure("actual attach", e))?;
        Ok(running)
    }
    fn decoder(&self) -> &Decoder {
        self.decoder.as_ref().expect("owned decoder")
    }
    fn observation(&self, tick: Instant) -> Result<Option<TimedAudioObservation>, String> {
        self.audio
            .timed_observation_for_test(GENERATION, tick)
            .map_err(|e| failure("timed observation", e))
    }
    fn wait_for(&self, mut condition: impl FnMut() -> Result<bool, String>) -> Result<(), String> {
        let until = (Instant::now() + Duration::from_secs(2)).min(self.deadline);
        loop {
            if condition()? {
                return Ok(());
            }
            require(
                Instant::now() < until,
                "bounded decoder observation wait expired",
            )?;
            thread::sleep(POLL);
        }
    }
    fn tick(&self, step: u32) -> Result<(TimedAudioObservation, Vec<i16>), String> {
        require(
            Instant::now() < self.deadline,
            "fixture case deadline exceeded",
        )?;
        let tick = self.start + STEP * step;
        self.clock
            .publish(tick)
            .map_err(|e| failure("continuous presentation tick", e))?;
        self.wait_for(|| {
            let Some(observed) = self.observation(tick)? else {
                return Ok(false);
            };
            require(
                observed.has_audio && !observed.fault,
                "audio unavailable/fault before mixer tick",
            )?;
            let Some(target) = observed.target_frames else {
                return Ok(false);
            };
            let required = (target + 960).max(0);
            Ok(observed.committed_frames >= required
                || observed
                    .pending_end_frames
                    .is_some_and(|end| observed.committed_frames == end))
        })?;
        let observed = self
            .observation(tick)?
            .ok_or_else(|| "timed state disappeared".to_owned())?;
        let samples = self.audio.take_at(GENERATION, tick);
        let stats = self.audio.stats(GENERATION);
        require(
            samples.len() == 1920
                && self.audio.has_audio(GENERATION)
                && stats.underflow_missing_samples == 0
                && stats.selected_underflow_samples == 0
                && stats.selected_dropped_samples == 0
                && stats.dropped_old_samples == 0
                && stats.unresolved_timing_samples == 0,
            "clock tick lost/trimmed/underran real PCM",
        )?;
        // Let the video reader observe every advanced clock without waiting for
        // arbitrary wall-clock playback or treating an empty queue as EOF.
        thread::sleep(POLL);
        Ok((observed, samples))
    }
    fn close(&mut self, complete_bytes: Option<usize>) -> Result<Value, String> {
        if let Some(mut decoder) = self.decoder.take() {
            decoder.stop();
        }
        let producer = self.pump.finish(complete_bytes.is_none())?;
        if let Some(expected) = complete_bytes {
            require(producer.end_reason == pump::StopReason::Complete
                && producer.bytes_written == expected,
                &format!("positive producer incomplete: expected {expected} bytes, observed {producer:?}"))?;
        }
        Ok(
            json!({"decoder_stop_returned":true,"producer_joined":producer.joined,
            "producer_reason":format!("{:?}",producer.end_reason),"producer_bytes":producer.bytes_written,
            "probe_producer_joined":self.probe_receipt.joined,
            "probe_producer_reason":format!("{:?}",self.probe_receipt.end_reason)}),
        )
    }
}
impl Drop for Running {
    fn drop(&mut self) {
        if let Some(mut decoder) = self.decoder.take() {
            decoder.stop();
        }
        // PumpOwner drops after Decoder::stop has closed the owned reader.
    }
}

#[derive(Clone, Copy, Debug)]
enum Scenario {
    AudioTail,
    VideoTail,
    LateFailure,
    Revoke,
    Cancel,
}
fn is_slate(video: &LatestFrame, status: FrameStatus, now: Instant) -> bool {
    matches!(video.snapshot(now, Duration::from_millis(600)), FrameView::Slate(actual) if actual == status)
}

fn exercise(running: &mut Running, input: &Input, scenario: Scenario) -> Result<Value, String> {
    let mut previous_target = None;
    let mut real_frames = 0usize;
    let mut nonzero_samples = 0usize;
    let mut zero_tail_frames = 0usize;
    let mut partial_tail = false;
    let mut first_pending_sequence = None;
    let mut inverse_checkpoint = None;
    let mut tick_count = 0u32;
    // 12 seconds of logical presentation, in contiguous20ms steps, fits within
    // the separately bounded real-time case. No seeking/retiming masks holes.
    let positive = matches!(scenario, Scenario::AudioTail | Scenario::VideoTail);
    for step in 0..=600u32 {
        let (observed, samples) = running.tick(step)?;
        tick_count += 1;
        let target = observed
            .target_frames
            .ok_or_else(|| "missing target".to_owned())?;
        if let Some(previous) = previous_target {
            require(
                target == previous + 960,
                "mixer targets are not exactly contiguous",
            )?;
        }
        previous_target = Some(target);
        let real_begin = target.max(0).min(input.audio_frames);
        let real_end = (target + 960).max(0).min(input.audio_frames);
        for (frame, pair) in samples.chunks_exact(2).enumerate() {
            let ordinal = target + frame as i128;
            if ordinal < 0 || ordinal >= input.audio_frames {
                require(
                    pair == [0, 0],
                    "leading or terminal PCM is not exact silence",
                )?;
                if ordinal >= input.audio_frames {
                    zero_tail_frames += 1;
                }
            } else {
                real_frames += 1;
                nonzero_samples += pair.iter().filter(|v| **v != 0).count();
            }
        }
        if real_end > real_begin && real_end - real_begin < 960 && target >= 0 {
            partial_tail = true;
        }
        if let Some(frontier) = observed.pending_end_frames {
            require(
                frontier == input.audio_frames && observed.committed_frames == frontier,
                "pending frontier differs from the exact decoded sample count",
            )?;
            if first_pending_sequence.is_none() {
                let sequence = running.video.sequence();
                first_pending_sequence = Some(sequence);
                if !matches!(scenario, Scenario::VideoTail) {
                    require(
                        sequence > 0
                            && sequence < input.video_frames
                            && running
                                .decoder()
                                .child_running_for_test()
                                .map_err(|e| failure("live sibling at pending", e))?,
                        "audio pending must be observed while owned producer/video remains live",
                    )?;
                }
            }
            if !positive {
                let mut revoked_sequence = None;
                match scenario {
                    Scenario::LateFailure => {
                        running
                            .decoder()
                            .fail_owned_child_for_test()
                            .map_err(|e| failure("owned late producer failure", e))?;
                    }
                    Scenario::Revoke => {
                        revoked_sequence = Some(running.authority.revoke(&running.video)?);
                    }
                    Scenario::Cancel => {
                        running.decoder.as_mut().unwrap().stop();
                    }
                    _ => unreachable!(),
                }
                if !matches!(scenario, Scenario::Cancel) {
                    running.wait_for(|| {
                        Ok(
                            is_slate(&running.video, FrameStatus::Failed, Instant::now())
                                && !running.audio.has_audio(GENERATION),
                        )
                    })?;
                }
                require(
                    !running.audio.has_audio(GENERATION),
                    "terminal action retained playable audio",
                )?;
                let after = running.observation(running.start + STEP * step)?;
                require(
                    after.is_some_and(|value| value.pending_end_frames.is_none()),
                    "terminal action retained a pending frontier",
                )?;
                let stopped_sequence = running.video.sequence();
                thread::sleep(Duration::from_millis(30));
                require(
                    running.video.sequence() == stopped_sequence,
                    "publication continued after observed terminal action",
                )?;
                if matches!(scenario, Scenario::Revoke) {
                    require(
                        Some(stopped_sequence) == revoked_sequence,
                        "publication crossed the revoke barrier",
                    )?;
                }
                return Ok(
                    json!({"scenario":format!("{scenario:?}"),"tick_count":tick_count,
                    "pending_frames":frontier,"pending_video_sequence":first_pending_sequence,
                    "terminal_video_sequence":stopped_sequence,"audio_unavailable":true,
                    "pending_cleared":true,"owned_live_failure_injected":matches!(scenario,Scenario::LateFailure)}),
                );
            }
        }
        if matches!(scenario, Scenario::VideoTail)
            && inverse_checkpoint.is_none()
            && is_slate(&running.video, FrameStatus::Ended, Instant::now())
        {
            require(
                running.video.sequence() == input.video_frames
                    && observed.pending_end_frames.is_none()
                    && running
                        .decoder()
                        .child_running_for_test()
                        .map_err(|e| failure("live audio after video pending", e))?,
                "video Ended must precede actual audio frontier/producer termination",
            )?;
            inverse_checkpoint = Some((target, observed.committed_frames));
        }
    }
    require(
        first_pending_sequence.is_some()
            && real_frames as i128 == input.audio_frames
            && nonzero_samples > 1000
            && partial_tail
            && zero_tail_frames > 48_000,
        "real samples/partial tail/long terminal silence were not all observed",
    )?;
    running.wait_for(|| {
        Ok(running.video.sequence() == input.video_frames
            && is_slate(
                &running.video,
                FrameStatus::Ended,
                running.start + Duration::from_secs(30),
            ))
    })?;
    running.wait_for(|| Ok(running.decoder().readers_finished_for_test()))?;
    // Do not call stop while late raw/witness validation is still running:
    // cancellation could otherwise hide a malformed or extra buffered tail.
    running.wait_for(|| {
        Ok(running
            .decoder()
            .child_exit_success_for_test()
            .map_err(|e| failure("completed producer status", e))?
            .is_some())
    })?;
    require(
        running
            .decoder()
            .child_exit_success_for_test()
            .map_err(|e| failure("actual positive exit status", e))?
            == Some(true),
        "positive producer did not exit successfully after both genuine frontiers",
    )?;
    let drained = running
        .observation(running.start + STEP * 600)?
        .ok_or_else(|| "timed state disappeared after reader retirement".to_owned())?;
    require(
        drained.has_audio
            && !drained.fault
            && drained.pending_end_frames == Some(input.audio_frames)
            && drained.committed_frames == input.audio_frames
            && is_slate(&running.video, FrameStatus::Ended, Instant::now()),
        "late raw/witness validation invalidated the pending presentation",
    )?;
    if matches!(scenario, Scenario::AudioTail) {
        require(
            running.video.sequence() > first_pending_sequence.unwrap(),
            "video did not continue after the shorter audio frontier",
        )?;
    } else {
        let (_, earlier) =
            inverse_checkpoint.ok_or_else(|| "no independent short-video checkpoint".to_owned())?;
        require(
            input.audio_frames > earlier,
            "audio did not continue after video slate",
        )?;
    }
    let stats = running.audio.stats(GENERATION);
    require(
        stats.pushed_samples == input.audio_frames as u64 * 2 && stats.buffered_samples == 0,
        "not all real PCM was consumed exactly once",
    )?;
    Ok(
        json!({"scenario":format!("{scenario:?}"),"tick_count":tick_count,
        "logical_horizon_ms":12_000,"real_audio_frames":real_frames,"nonzero_samples":nonzero_samples,
        "partial_tail":partial_tail,"zero_tail_frames":zero_tail_frames,
        "pending_video_sequence":first_pending_sequence,"final_video_sequence":running.video.sequence(),
        "video_ended_at_long_horizon":true,"audio_underflow":stats.underflow_missing_samples,
        "selected_underflow":stats.selected_underflow_samples,"pushed_samples":stats.pushed_samples,
        "all_owned_readers_finished_before_stop":true,"pending_valid_after_reader_retirement":true,
        "clean_terminal_cause_inferred":false}),
    )
}

fn metadata_dirs() -> Result<Vec<String>, String> {
    let prefix = format!("ottplay-decode-{}-", std::process::id());
    let mut names = Vec::new();
    for entry in fs::read_dir(std::env::temp_dir())
        .map_err(|e| failure("temporary directory inventory", e))?
    {
        let name = entry
            .map_err(|e| failure("temporary entry", e))?
            .file_name()
            .to_string_lossy()
            .into_owned();
        if name.starts_with(&prefix) {
            names.push(name);
        }
        require(
            names.len() <= 32,
            "metadata directory inventory exceeds bound",
        )?;
    }
    names.sort();
    Ok(names)
}

pub fn run_from_env() -> Result<(), String> {
    let ffmpeg = tool("OTTPLAY_MULTIVIEW_FFMPEG")?;
    let ffprobe = tool("OTTPLAY_MULTIVIEW_FFPROBE")?;
    let (manifest_hash, inputs) = inputs()?;
    let temp = std::env::temp_dir();
    let temporary_name = temp.to_string_lossy();
    require([' ', '\'', ':', '\\'].into_iter().all(|c| temporary_name.contains(c)),
        "runner must set a private TMPDIR containing space, apostrophe, colon and backslash before process start")?;
    require(
        fs::metadata(&temp)
            .map_err(|e| failure("TMPDIR metadata", e))?
            .permissions()
            .mode()
            & 0o077
            == 0,
        "fixture TMPDIR must be private",
    )?;
    let root = env_path("OTTPLAY_MULTIVIEW_PENDING_CASE_DIR")?;
    fs::DirBuilder::new()
        .mode(0o700)
        .create(&root)
        .map_err(|e| failure("fresh fixture evidence directory", e))?;
    let config = DecoderConfig {
        ffmpeg,
        ffprobe,
        frame_spec: FrameSpec {
            width: 96,
            height: 64,
        },
        fps: 10,
    };
    let mut cases = Vec::new();
    let mut error = None;
    for (index, scenario) in [
        (0, Scenario::AudioTail),
        (1, Scenario::VideoTail),
        (0, Scenario::LateFailure),
        (0, Scenario::Revoke),
        (0, Scenario::Cancel),
    ] {
        let before = metadata_dirs()?;
        let began = Instant::now();
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(
            || -> Result<(Result<Value, String>, Result<Value, String>), String> {
                let mut running = Running::new(&config, &inputs[index])?;
                let exercised = exercise(&mut running, &inputs[index], scenario);
                // Always close and join before propagating the scenario failure.
                let closed = running.close(
                    matches!(scenario, Scenario::AudioTail | Scenario::VideoTail)
                        .then_some(inputs[index].bytes.len()),
                );
                Ok((exercised, closed))
            },
        ));
        let (detail, failure) = match outcome {
            Ok(Ok((observed, closed))) => {
                let error = observed.as_ref().err().or(closed.as_ref().err()).cloned();
                (
                    json!({"observation":observed.as_ref().ok(),"scenario_error":observed.as_ref().err(),
                    "cleanup":closed.as_ref().ok(),"cleanup_error":closed.as_ref().err()}),
                    error,
                )
            }
            Ok(Err(error)) => (
                json!({"setup_error":error,"cleanup_proof_complete":false}),
                Some(error),
            ),
            Err(_) => (
                json!({"panicked":true,"cleanup_proof_complete":false}),
                Some("fixture panicked; cleanup attempted".into()),
            ),
        };
        let after = metadata_dirs()?;
        let clean = before == after;
        let pass = failure.is_none() && clean;
        cases.push(json!({"scenario":format!("{scenario:?}"),"input":inputs[index].id,
            "input_sha256":inputs[index].sha256,"pass":pass,"elapsed_ms":began.elapsed().as_millis(),
            "metadata_before":before,"metadata_after":after,"metadata_clean":clean,
            "detail":detail,"error":failure}));
        if !pass {
            error = Some(failure.unwrap_or_else(|| "metadata cleanup not confirmed".into()));
            break;
        }
    }
    let pass = error.is_none() && cases.len() == 5;
    let receipt = json!({"schema":"ottplay.multiview.pending-clock-fixture.v1","pass":pass,
        "scope":"actual Decoder, genuine stream probe, fresh decode FD, clock and owned Child failure; no player admission",
        "input_manifest_sha256":manifest_hash,"case_count":cases.len(),"cases":cases,"error":error,
        "external_process_group_supervisor_required":true,"clean_eof_from_pending_claimed":false});
    let bytes = serde_json::to_vec_pretty(&receipt).map_err(|e| failure("receipt encoding", e))?;
    require(bytes.len() <= 128 * 1024, "receipt exceeds byte limit")?;
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(root.join("CONTROL.json"))
        .and_then(|mut file| file.write_all(&bytes))
        .map_err(|e| failure("receipt write", e))?;
    require(
        pass,
        "actual pending/clock fixture failed; inspect owned CONTROL.json",
    )
}
