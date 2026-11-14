//! Opt-in media and in-memory HTTP fixtures; no executable router registration.
//! Ordinary tests also exercise the closed, authenticated fixture adapter.
//! Normal tests cover planning/admission. Run the ignored fixture explicitly with
//! OTTPLAY_MULTIVIEW_FFMPEG and OTTPLAY_MULTIVIEW_FFPROBE absolute tool paths.
//! Finite-file cases do not qualify server resources or LG concurrency. The
//! separate streamed case requires both its control result and CI media analysis.

#[cfg(unix)]
#[path = "support/streamed_session.rs"]
mod streamed_session;

#[path = "../src/multiview.rs"]
mod admission;
use ottplay_core::multiview as media;

use std::{
    collections::HashSet,
    io::Read,
    path::{Path, PathBuf},
    process::{Child, Command, Output, Stdio},
    sync::atomic::AtomicBool,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

#[cfg(unix)]
#[test]
#[ignore = "explicit owned streamed HLS continuity fixture; requires bounded CI media analysis"]
fn streamed_session_two_owner_continuity() {
    streamed_session::run_from_env().expect("streamed Session control and cleanup failed");
}

#[test]
fn geometry_and_fixture_success_do_not_grant_production_admission() {
    let cap = admission::capability();
    assert_eq!(cap.geometry_slots, 9);
    assert_eq!(cap.native_concurrent_video_capacity, None);
    assert_eq!(cap.admitted_composite_inputs, 0);
    assert!(!cap.independent_source_replacement);
    assert_eq!(
        admission::admit_production_scene(),
        Err(admission::AdmissionError::Unsupported)
    );
}

#[test]
fn captured_commands_reject_every_stale_dimension_and_different_slot() {
    use admission::{check_captured_context, AdmissionError as E, Revision, SlotContext};
    let captured = SlotContext {
        slot: 2,
        revision: Revision {
            runtime: 3,
            layout: 5,
            source: 7,
            focus: 11,
            audio: 13,
        },
    };
    assert_eq!(check_captured_context(captured, captured), Ok(()));
    for (dimension, expected) in [
        (0, E::StaleRuntime),
        (1, E::StaleLayout),
        (2, E::StaleSource),
        (3, E::StaleFocus),
        (4, E::StaleAudio),
    ] {
        let mut current = captured;
        match dimension {
            0 => current.revision.runtime += 1,
            1 => current.revision.layout += 1,
            2 => current.revision.source += 1,
            3 => current.revision.focus += 1,
            _ => current.revision.audio += 1,
        }
        assert_eq!(check_captured_context(captured, current), Err(expected));
    }
    let mut other = captured;
    other.slot = 3;
    assert_eq!(check_captured_context(captured, other), Err(E::InvalidSlot));
    other.slot = 9;
    assert_eq!(check_captured_context(other, other), Err(E::InvalidSlot));
}

#[test]
fn worker_rejects_ungranted_files_modified_plans_and_pre_cancelled_work() {
    use media::{
        plan::{build, InputSpec, Layout, Limits, OutputSpec},
        worker::{run_fixture, LocalInput, WorkerConfig, WorkerError},
    };
    let scratch = Scratch::new();
    std::fs::create_dir(scratch.0.join("inputs")).unwrap();
    let outside = scratch.0.join("outside-input-grant.dat");
    std::fs::write(&outside, b"owned test data").unwrap();
    let mut sources: Vec<_> = (0..4)
        .map(|slot| LocalInput {
            slot,
            path: outside.clone(),
        })
        .collect();
    let specs: Vec<_> = (0..4)
        .map(|slot| InputSpec {
            slot,
            width: 320,
            height: 180,
            fps: 10,
        })
        .collect();
    let mut plan = build(
        Layout::Grid4,
        &specs,
        OutputSpec {
            width: 640,
            height: 360,
            fps: 10,
        },
        None,
        &Limits::default(),
    )
    .unwrap();
    let config = WorkerConfig {
        ffmpeg: scratch.0.join("must-never-execute"),
        output_root: scratch.0.clone(),
        max_disk_bytes: 1024,
        startup_timeout: Duration::from_secs(1),
        stall_timeout: Duration::from_secs(1),
        total_timeout: Duration::from_secs(1),
    };
    assert_eq!(
        run_fixture(&config, &plan, &sources, &AtomicBool::new(false)).unwrap_err(),
        WorkerError::InvalidInput
    );
    assert_eq!(
        run_fixture(&config, &plan, &sources, &AtomicBool::new(true)).unwrap_err(),
        WorkerError::Cancelled
    );
    #[cfg(unix)]
    {
        let link = scratch.0.join("inputs/escaped.dat");
        std::os::unix::fs::symlink(&outside, &link).unwrap();
        for source in &mut sources {
            source.path = link.clone();
        }
        assert_eq!(
            run_fixture(&config, &plan, &sources, &AtomicBool::new(false)).unwrap_err(),
            WorkerError::InvalidInput
        );
    }
    // Keep the inputs valid and within their grant so the modified-plan
    // assertion specifically exercises plan validation, not file admission.
    for (slot, source) in sources.iter_mut().enumerate() {
        let granted = scratch.0.join(format!("inputs/granted-{slot}.dat"));
        std::fs::write(&granted, b"granted fixture input").unwrap();
        source.path = granted;
    }
    assert_eq!(
        run_fixture(&config, &plan, &sources, &AtomicBool::new(false)).unwrap_err(),
        WorkerError::Unsupported
    );
    plan.filter_graph.push_str(";movie=forbidden");
    assert_eq!(
        run_fixture(&config, &plan, &sources, &AtomicBool::new(false)).unwrap_err(),
        WorkerError::InvalidInput
    );
    assert!(!scratch.0.join("output").exists());
}

struct Scratch(PathBuf);
impl Scratch {
    fn new() -> Self {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "ottplay-multiview-fixture-{}-{nonce}",
            std::process::id()
        ));
        std::fs::create_dir(&root).unwrap();
        Self(root)
    }
}
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn tool(name: &str) -> PathBuf {
    let path = PathBuf::from(std::env::var_os(name).expect("explicit fixture tool path required"));
    assert!(
        path.is_absolute() && path.is_file(),
        "fixture tool must be an absolute file"
    );
    path
}

fn checked(command: &mut Command) -> Output {
    struct Reap(Child);
    impl Drop for Reap {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
    let mut child = Reap(
        command
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("fixture process could not start"),
    );
    fn capture(reader: impl Read + Send + 'static) -> std::thread::JoinHandle<Vec<u8>> {
        std::thread::spawn(move || {
            let mut bytes = Vec::new();
            reader
                .take(1_048_577)
                .read_to_end(&mut bytes)
                .expect("fixture capture failed");
            bytes
        })
    }
    let stdout = capture(child.0.stdout.take().unwrap());
    let stderr = capture(child.0.stderr.take().unwrap());
    let began = Instant::now();
    let status = loop {
        if let Some(status) = child.0.try_wait().expect("fixture wait failed") {
            break status;
        }
        if began.elapsed() > Duration::from_secs(15) {
            let _ = child.0.kill();
            let _ = child.0.wait();
            panic!("fixture subprocess deadline exceeded");
        }
        std::thread::sleep(Duration::from_millis(10));
    };
    let output = Output {
        status,
        stdout: stdout.join().unwrap(),
        stderr: stderr.join().unwrap(),
    };
    assert!(
        output.stdout.len() <= 1_048_576 && output.stderr.len() <= 1_048_576,
        "fixture capture budget exceeded"
    );
    assert!(
        output.status.success(),
        "fixture media command failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    output
}

fn make_input(ffmpeg: &Path, path: &Path, slot: u8) {
    let tint = [
        "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF", "FF8000", "8000FF", "008080",
    ][usize::from(slot)];
    checked(
        Command::new(ffmpeg)
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-nostdin",
                "-y",
                "-f",
                "lavfi",
                "-i",
                &format!(
                    "testsrc2=size=320x180:rate=10,drawbox=x=0:y=0:w=iw:h=ih:color=0x{tint}@0.7:t=fill"
                ),
                "-f",
                "lavfi",
                "-i",
                &format!(
                    "sine=frequency={}:sample_rate=48000",
                    400 + u32::from(slot) * 100
                ),
                "-t",
                "1.2",
                "-threads",
                "1",
                "-c:v",
                "libx264",
                "-preset",
                "ultrafast",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-shortest",
            ])
            .arg(path),
    );
}

fn normalized_rgb(bytes: &[u8]) -> [f64; 3] {
    let mut sum = [0.0; 3];
    for pixel in bytes.chunks_exact(3) {
        for index in 0..3 {
            sum[index] += f64::from(pixel[index]);
        }
    }
    let total: f64 = sum.iter().sum();
    assert!(total > 0.0);
    sum.map(|channel| channel / total)
}

fn goertzel(samples: &[f64], frequency: f64) -> f64 {
    let coefficient = 2.0 * (std::f64::consts::TAU * frequency / 8000.0).cos();
    let (mut last, mut before) = (0.0, 0.0);
    for sample in samples {
        let next = sample + coefficient * last - before;
        before = last;
        last = next;
    }
    last * last + before * before - coefficient * last * before
}

#[test]
#[ignore = "explicit isolated FFmpeg/FFprobe fixture only; never launches a user player"]
fn real_four_nine_and_perimeter_frames_and_selected_audio() {
    use media::{
        plan::{build, InputSpec, Layout, Limits, OutputSpec},
        worker::{run_fixture, LocalInput, WorkerConfig},
    };
    let ffmpeg = tool("OTTPLAY_MULTIVIEW_FFMPEG");
    let ffprobe = tool("OTTPLAY_MULTIVIEW_FFPROBE");
    for (case, count, layout) in [
        ("four", 4, Layout::Grid4),
        ("nine", 9, Layout::Grid9),
        ("perimeter", 9, Layout::MainWithPerimeter { main_slot: 3 }),
    ] {
        let scratch = Scratch::new();
        let input_dir = scratch.0.join("inputs");
        std::fs::create_dir(&input_dir).unwrap();
        let mut sources = Vec::new();
        let mut specs = Vec::new();
        let mut expected_colors = Vec::new();
        for slot in 0..count {
            let path = input_dir.join(format!("input-{slot}.mp4"));
            make_input(&ffmpeg, &path, slot);
            let reference = checked(
                Command::new(&ffmpeg)
                    .args(["-hide_banner", "-loglevel", "error", "-i"])
                    .arg(&path)
                    .args([
                        "-an",
                        "-vf",
                        "scale=64:36,format=rgb24",
                        "-frames:v",
                        "1",
                        "-f",
                        "rawvideo",
                        "-",
                    ]),
            );
            assert_eq!(reference.stdout.len(), 64 * 36 * 3);
            expected_colors.push(normalized_rgb(&reference.stdout));
            sources.push(LocalInput { slot, path });
            specs.push(InputSpec {
                slot,
                width: 320,
                height: 180,
                fps: 10,
            });
        }
        // The public slot identity must survive an arbitrary input-vector order.
        sources.reverse();
        let plan = build(
            layout,
            &specs,
            OutputSpec {
                width: 960,
                height: 540,
                fps: 10,
            },
            Some(2),
            &Limits::default(),
        )
        .unwrap();
        let config = WorkerConfig {
            ffmpeg: ffmpeg.clone(),
            output_root: scratch.0.clone(),
            max_disk_bytes: 32 * 1024 * 1024,
            startup_timeout: Duration::from_secs(10),
            stall_timeout: Duration::from_secs(5),
            total_timeout: Duration::from_secs(20),
        };
        let rendered = run_fixture(&config, &plan, &sources, &AtomicBool::new(false)).unwrap();
        assert!(rendered.frames >= 10, "{case}: actual frame progress");
        let probe = checked(
            Command::new(&ffprobe)
                .args([
                    "-v",
                    "error",
                    "-select_streams",
                    "v:0",
                    "-show_entries",
                    "stream=codec_name,width,height",
                    "-of",
                    "default=noprint_wrappers=1",
                ])
                .arg(&rendered.output_file),
        );
        let metadata = String::from_utf8(probe.stdout).unwrap();
        assert!(
            metadata.contains("codec_name=h264")
                && metadata.contains("width=960")
                && metadata.contains("height=540")
        );
        let mut first_frames = HashSet::new();
        for rect in &plan.rects {
            let output = checked(
                Command::new(&ffmpeg)
                    .args(["-hide_banner", "-loglevel", "error", "-i"])
                    .arg(&rendered.output_file)
                    .args([
                        "-an",
                        "-vf",
                        &format!(
                            "crop={}:{}:{}:{},scale=64:36,format=rgb24",
                            rect.width, rect.height, rect.x, rect.y
                        ),
                        "-frames:v",
                        "3",
                        "-f",
                        "rawvideo",
                        "-",
                    ]),
            );
            let frames: Vec<&[u8]> = output.stdout.chunks_exact(64 * 36 * 3).collect();
            assert_eq!(
                frames.len(),
                3,
                "{case}: decoded frames for slot {}",
                rect.slot
            );
            assert!(
                frames.windows(2).any(|pair| pair[0] != pair[1]),
                "{case}: slot {} must move",
                rect.slot
            );
            let actual = normalized_rgb(frames[0]);
            let nearest = expected_colors
                .iter()
                .enumerate()
                .map(|(slot, expected)| {
                    let distance: f64 = actual
                        .iter()
                        .zip(expected)
                        .map(|(a, b)| (a - b).powi(2))
                        .sum();
                    (slot, distance)
                })
                .min_by(|a, b| a.1.total_cmp(&b.1))
                .unwrap()
                .0;
            assert_eq!(
                nearest,
                usize::from(rect.slot),
                "{case}: decoded color identifies the correct slot"
            );
            first_frames.insert(frames[0].to_vec());
        }
        assert_eq!(
            first_frames.len(),
            usize::from(count),
            "{case}: all independent source regions differ"
        );
        let pcm = checked(
            Command::new(&ffmpeg)
                .args(["-hide_banner", "-loglevel", "error", "-i"])
                .arg(&rendered.output_file)
                .args([
                    "-vn", "-ss", "0.1", "-t", "0.4", "-ar", "8000", "-ac", "1", "-f", "s16le", "-",
                ]),
        );
        let samples: Vec<f64> = pcm
            .stdout
            .chunks_exact(2)
            .map(|pair| f64::from(i16::from_le_bytes([pair[0], pair[1]])) / 32768.0)
            .collect();
        assert!(samples.len() >= 3000);
        let selected_power = goertzel(&samples, 600.0);
        assert!(selected_power > 1.0);
        for slot in 0..count {
            if slot != 2 {
                assert!(
                    selected_power
                        > goertzel(&samples, f64::from(400 + u32::from(slot) * 100)) * 5.0,
                    "{case}: only audio owner is audible"
                );
            }
        }
        if count == 4 {
            use media::worker::WorkerError;
            // Delete only this fixture's successfully retained output, then prove
            // failures clean their own output and release admission for a retry.
            std::fs::remove_dir_all(scratch.0.join("output")).unwrap();
            let tiny = WorkerConfig {
                max_disk_bytes: 1,
                ..config
            };
            assert_eq!(
                run_fixture(&tiny, &plan, &sources, &AtomicBool::new(false)).unwrap_err(),
                WorkerError::DiskLimit
            );
            assert!(!scratch.0.join("output").exists());
            let normal = WorkerConfig {
                max_disk_bytes: 32 * 1024 * 1024,
                ..tiny
            };
            let owner = sources.iter_mut().find(|source| source.slot == 2).unwrap();
            let silent = input_dir.join("silent-owner.mp4");
            checked(
                Command::new(&ffmpeg)
                    .args(["-hide_banner", "-loglevel", "error", "-nostdin", "-i"])
                    .arg(&owner.path)
                    .args(["-map", "0:v:0", "-c:v", "copy", "-an"])
                    .arg(&silent),
            );
            owner.path = silent;
            assert_eq!(
                run_fixture(&normal, &plan, &sources, &AtomicBool::new(false)).unwrap_err(),
                WorkerError::SourceFailed
            );
            assert!(!scratch.0.join("output").exists());
            let silent_plan =
                build(Layout::Grid4, &specs, plan.output, None, &Limits::default()).unwrap();
            let silent_output =
                run_fixture(&normal, &silent_plan, &sources, &AtomicBool::new(false)).unwrap();
            let audio = checked(
                Command::new(&ffprobe)
                    .args([
                        "-v",
                        "error",
                        "-select_streams",
                        "a",
                        "-show_entries",
                        "stream=codec_name",
                        "-of",
                        "csv=p=0",
                    ])
                    .arg(&silent_output.output_file),
            );
            assert!(
                audio.stdout.is_empty(),
                "explicit no-audio output is distinct from a missing selected audio owner"
            );
        }
    }
}

#[cfg(unix)]
#[test]
#[ignore = "isolated owned subprocess lifecycle fixture; no user processes"]
fn owned_worker_cancellation_deadlines_busy_and_cleanup() {
    use media::{
        plan::{build, InputSpec, Layout, Limits, OutputSpec},
        worker::{run_fixture, LocalInput, WorkerConfig, WorkerError},
    };
    use std::{
        os::unix::fs::PermissionsExt,
        sync::{atomic::Ordering, Arc},
    };
    let scratch = Scratch::new();
    let input_dir = scratch.0.join("inputs");
    std::fs::create_dir(&input_dir).unwrap();
    let input = input_dir.join("owned-fixture.dat");
    std::fs::write(&input, b"lifecycle fixture, not decoded media").unwrap();
    let sources: Vec<_> = (0..4)
        .map(|slot| LocalInput {
            slot,
            path: input.clone(),
        })
        .collect();
    let specs: Vec<_> = (0..4)
        .map(|slot| InputSpec {
            slot,
            width: 320,
            height: 180,
            fps: 10,
        })
        .collect();
    let plan = build(
        Layout::Grid4,
        &specs,
        OutputSpec {
            width: 640,
            height: 360,
            fps: 10,
        },
        None,
        &Limits::default(),
    )
    .unwrap();
    let helper = scratch.0.join("owned-helper");
    let pid_file = scratch.0.join("owned-helper.pid");
    let config = |startup_timeout, stall_timeout, total_timeout| WorkerConfig {
        ffmpeg: helper.clone(),
        output_root: scratch.0.clone(),
        max_disk_bytes: 1024 * 1024,
        startup_timeout,
        stall_timeout,
        total_timeout,
    };
    let write_helper = |with_progress: bool| {
        let mut script = "#!/bin/sh\nprintf '%s' \"$$\" > \"$0.pid\"\n".to_string();
        if with_progress {
            script.push_str("while [ \"$#\" -gt 0 ]; do\nif [ \"$1\" = '-progress' ]; then shift; printf 'frame=1\\n' > \"$1\"; break; fi\nshift\ndone\n");
        }
        script.push_str("exec /bin/sleep 10\n");
        std::fs::write(&helper, script).unwrap();
        std::fs::set_permissions(&helper, std::fs::Permissions::from_mode(0o700)).unwrap();
        let _ = std::fs::remove_file(&pid_file);
    };
    let assert_reaped = || {
        let pid = std::fs::read_to_string(&pid_file)
            .unwrap()
            .parse::<u32>()
            .unwrap();
        let status = Command::new("/bin/kill")
            .args(["-0", &pid.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .unwrap();
        assert!(
            !status.success(),
            "the owned helper must be killed and reaped"
        );
        assert!(
            !scratch.0.join("output").exists(),
            "failed output must be removed"
        );
    };
    let short = Duration::from_millis(500);
    let long = Duration::from_secs(3);
    for (progress, startup, stall, deadline, expected) in [
        (false, short, long, long, WorkerError::StartupTimeout),
        (true, long, short, long, WorkerError::Stalled),
        (false, long, long, short, WorkerError::Deadline),
    ] {
        write_helper(progress);
        let result = run_fixture(
            &config(startup, stall, deadline),
            &plan,
            &sources,
            &AtomicBool::new(false),
        );
        assert_eq!(result.unwrap_err(), expected);
        assert_reaped();
    }
    write_helper(false);
    let cancel = Arc::new(AtomicBool::new(false));
    let running_config = config(long, long, Duration::from_secs(5));
    std::thread::scope(|scope| {
        let pending = scope.spawn(|| run_fixture(&running_config, &plan, &sources, &cancel));
        let started = Instant::now();
        while !pid_file.exists() && started.elapsed() < long {
            std::thread::sleep(Duration::from_millis(2));
        }
        assert!(pid_file.exists());
        assert_eq!(
            run_fixture(&running_config, &plan, &sources, &AtomicBool::new(false)).unwrap_err(),
            WorkerError::Busy
        );
        cancel.store(true, Ordering::Release);
        assert_eq!(pending.join().unwrap().unwrap_err(), WorkerError::Cancelled);
    });
    assert_reaped();
    let mut failed = config(long, long, long);
    failed.ffmpeg = PathBuf::from("/usr/bin/false");
    assert_eq!(
        run_fixture(&failed, &plan, &sources, &AtomicBool::new(false)).unwrap_err(),
        WorkerError::SourceFailed
    );
    assert!(!scratch.0.join("output").exists());
    // Returning SourceFailed, rather than Busy, also proves the cancelled worker
    // released its global permit before the next process attempt.
}

const FIXTURE_BEARER: &str = "synthetic-multiview-fixture-bearer-0001";
const FIXTURE_ORIGIN: &str = "http://fixture.invalid";

fn http_fixture(
    config: media::persistent::Config,
    sources: Vec<admission::FixtureSource>,
) -> axum::Router {
    admission::fixture_router(admission::FixtureConfig {
        bearer: FIXTURE_BEARER.to_string(),
        origin: FIXTURE_ORIGIN.to_string(),
        session_config: config,
        sources,
    })
}

async fn http_call(
    router: &axum::Router,
    body: &str,
    id: Option<&str>,
    authenticated: bool,
) -> axum::response::Response {
    use tower::ServiceExt;
    let mut request =
        axum::http::Request::post("/control").header("content-type", "application/json");
    if authenticated {
        request = request
            .header("authorization", format!("Bearer {FIXTURE_BEARER}"))
            .header("origin", FIXTURE_ORIGIN);
    }
    if let Some(id) = id {
        request = request.header("x-request-id", id);
    }
    router
        .clone()
        .oneshot(
            request
                .body(axum::body::Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap()
}

async fn http_json(response: axum::response::Response) -> serde_json::Value {
    let bytes = axum::body::to_bytes(response.into_body(), 256 * 1024)
        .await
        .unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

#[tokio::test]
async fn fixture_http_rejects_lease_shorter_than_startup_before_session_start() {
    use axum::http::StatusCode as S;
    let scratch = Scratch::new();
    let config = media::persistent::Config::new(
        scratch.0.join("missing-ffmpeg"),
        scratch.0.join("missing-ffprobe"),
        scratch.0.clone(),
    );
    let router = http_fixture(config, vec![]);
    let create = |lease_secs| {
        format!(
            r#"{{"op":"create","lease_secs":{lease_secs},"geometry":{{"canvas":{{"width":320,"height":180,"fps":10}},"revision":1,"rects":[{{"slot_id":0,"x":0,"y":0,"width":320,"height":180,"z":0}}],"overlap":"disjoint"}}}}"#
        )
    };

    let short = http_call(&router, &create(5), Some("short-lease"), true).await;
    assert_eq!(short.status(), S::BAD_REQUEST);
    assert_eq!(http_json(short).await["error"], "invalid_lease");
    assert_eq!(std::fs::read_dir(&scratch.0).unwrap().count(), 0);

    // The exact startup-timeout boundary passes lease validation and reaches
    // the deliberately missing tool, which fails closed before any process runs.
    let boundary = http_call(&router, &create(10), Some("startup-boundary"), true).await;
    assert_eq!(boundary.status(), S::SERVICE_UNAVAILABLE);
    assert_eq!(http_json(boundary).await["error"], "output_failed");
    assert_eq!(std::fs::read_dir(&scratch.0).unwrap().count(), 0);
}

#[tokio::test]
async fn fixture_http_fails_closed_without_credentials_and_closed_bounded_input() {
    use axum::http::StatusCode as S;
    let config = media::persistent::Config::new(
        "unused-tool".into(),
        "unused-probe".into(),
        "unused-output".into(),
    );
    let router = http_fixture(config, vec![]);
    assert_eq!(
        http_call(&router, r#"{"op":"status"}"#, None, false)
            .await
            .status(),
        S::UNAUTHORIZED
    );
    let response = http_call(&router, r#"{"op":"status"}"#, None, true).await;
    assert_eq!(response.status(), S::OK);
    assert_eq!(
        http_json(response).await["public_capabilities"]["admitted_composite_inputs"],
        0
    );
    for body in [
        r#"{"op":"status","path":"/private/forbidden"}"#,
        r#"{"op":"status","op":"create"}"#,
        r#"{"op":"unknown"}"#,
    ] {
        let response = http_call(&router, body, Some("closed-input"), true).await;
        assert_eq!(response.status(), S::BAD_REQUEST);
        assert!(!http_json(response)
            .await
            .to_string()
            .contains("/private/forbidden"));
    }
    assert_eq!(
        http_call(
            &router,
            &"x".repeat(16 * 1024 + 1),
            Some("over-limit"),
            true
        )
        .await
        .status(),
        S::PAYLOAD_TOO_LARGE
    );
}

#[tokio::test]
async fn fixture_http_origin_and_request_identity_are_not_optional() {
    use axum::{
        body::Body,
        http::{Request, StatusCode as S},
    };
    use tower::ServiceExt;
    let config = media::persistent::Config::new(
        "unused-tool".into(),
        "unused-probe".into(),
        "unused-output".into(),
    );
    let router = http_fixture(config, vec![]);
    let wrong_origin = Request::post("/control")
        .header("authorization", format!("Bearer {FIXTURE_BEARER}"))
        .header("origin", "http://wrong.invalid")
        .body(Body::from(r#"{"op":"status"}"#))
        .unwrap();
    assert_eq!(
        router.clone().oneshot(wrong_origin).await.unwrap().status(),
        S::UNAUTHORIZED
    );
    assert_eq!(http_call(&router, r#"{"op":"off","expected":{"runtime":1,"scene":"absent","geometry_revision":1,"focus_revision":0,"audio_revision":0}}"#, None, true).await.status(), S::BAD_REQUEST);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "explicit real local HLS + in-memory authenticated fixture router; no service registration"]
async fn fixture_http_source_cas_dedupe_media_custody_and_retirement() {
    use axum::{
        body::Body,
        http::{Request, StatusCode as S},
    };
    use serde_json::json;
    use tower::ServiceExt;
    let ffmpeg = tool("OTTPLAY_MULTIVIEW_FFMPEG");
    let ffprobe = tool("OTTPLAY_MULTIVIEW_FFPROBE");
    let scratch = Scratch::new();
    let inputs = scratch.0.join("inputs");
    std::fs::create_dir(&inputs).unwrap();
    make_input(&ffmpeg, &inputs.join("source.mp4"), 0);
    let mut config = media::persistent::Config::new(ffmpeg, ffprobe, scratch.0.clone());
    config.frame_spec = media::frames::FrameSpec {
        width: 96,
        height: 64,
    };
    let router = http_fixture(
        config,
        vec![admission::FixtureSource {
            source_id: "owned-source".into(),
            root: inputs,
            relative: "source.mp4".into(),
        }],
    );
    let geometry = json!({"canvas":{"width":384,"height":256,"fps":10},"revision":1,"rects":[
        {"slot_id":0,"x":0,"y":0,"width":192,"height":128,"z":0},
        {"slot_id":1,"x":192,"y":0,"width":192,"height":128,"z":1},
        {"slot_id":2,"x":0,"y":128,"width":192,"height":128,"z":2},
        {"slot_id":3,"x":192,"y":128,"width":192,"height":128,"z":3}],"overlap":"disjoint"});
    let created = http_call(
        &router,
        &json!({"op":"create","geometry":geometry,"lease_secs":10}).to_string(),
        Some("create-scene"),
        true,
    )
    .await;
    assert_eq!(created.status(), S::OK);
    let created = http_json(created).await;
    let context = created["context"].clone();
    let lease = created["lease_id"].as_str().unwrap().to_string();
    let issued = http_call(
        &router,
        &json!({"op":"sources","expected":context,"slot":0,"source_rev":0}).to_string(),
        Some("issue-ticket"),
        true,
    )
    .await;
    assert_eq!(issued.status(), S::OK);
    let ticket = http_json(issued).await["sources"][0]["ticket"].clone();
    let play =
        json!({"op":"play","expected":context,"slot":0,"source_rev":0,"ticket":ticket}).to_string();
    let applied = http_call(&router, &play, Some("play-once"), true).await;
    assert_eq!(applied.status(), S::OK);
    let receipt = http_json(applied).await;
    assert_eq!(receipt["source_rev"], 1);
    let retry = http_call(&router, &play, Some("play-once"), true).await;
    assert_eq!(retry.status(), S::OK);
    assert_eq!(http_json(retry).await, receipt);
    let changed = play.replace("\"slot\":0", "\"slot\":1");
    assert_eq!(
        http_call(&router, &changed, Some("play-once"), true)
            .await
            .status(),
        S::CONFLICT
    );
    assert_eq!(
        http_call(&router, &play, Some("stale-source"), true)
            .await
            .status(),
        S::CONFLICT
    );
    // A second newly issued ticket for the same catalog source gets an
    // independent file capability; a used descriptor is never rewound.
    let sources = http_call(
        &router,
        &json!({"op":"sources","expected":context,"slot":1,"source_rev":0}).to_string(),
        Some("second-ticket"),
        true,
    )
    .await;
    let second = http_json(sources).await["sources"][0]["ticket"].clone();
    assert_eq!(
        http_call(
            &router,
            &json!({"op":"play","expected":context,"slot":1,"source_rev":0,"ticket":second})
                .to_string(),
            Some("second-play"),
            true
        )
        .await
        .status(),
        S::OK
    );
    let focus = http_call(
        &router,
        &json!({"op":"focus","expected":context,"slot":1}).to_string(),
        Some("change-focus"),
        true,
    )
    .await;
    assert_eq!(focus.status(), S::OK);
    let current = http_json(focus).await["context"].clone();
    assert_eq!(
        http_call(
            &router,
            &json!({"op":"focus","expected":context,"slot":0}).to_string(),
            Some("old-focus"),
            true
        )
        .await
        .status(),
        S::CONFLICT
    );
    let media_request = || {
        Request::get(format!("/media/{lease}/index.m3u8"))
            .header("authorization", format!("Bearer {FIXTURE_BEARER}"))
            .header("origin", FIXTURE_ORIGIN)
            .body(Body::empty())
            .unwrap()
    };
    let began = Instant::now();
    loop {
        let response = router.clone().oneshot(media_request()).await.unwrap();
        if response.status() == S::OK {
            let playlist = axum::body::to_bytes(response.into_body(), 64 * 1024)
                .await
                .unwrap();
            let playlist = std::str::from_utf8(&playlist).unwrap();
            let target = playlist
                .lines()
                .find_map(|line| line.strip_prefix("#EXT-X-TARGETDURATION:"))
                .unwrap()
                .parse::<u32>()
                .unwrap();
            assert!(target >= 1, "raw HLS target duration must never be zero");
            for duration in playlist
                .lines()
                .filter_map(|line| line.strip_prefix("#EXTINF:"))
                .filter_map(|line| line.split(',').next())
            {
                let duration = duration.parse::<f64>().unwrap();
                assert!(
                    duration > 0.0 && duration.ceil() <= f64::from(target),
                    "raw HLS target duration must cover every segment"
                );
            }
            break;
        }
        assert!(
            began.elapsed() < Duration::from_secs(5),
            "actual HLS playlist not ready"
        );
        tokio::time::sleep(Duration::from_millis(30)).await;
    }
    let mut held = Vec::new();
    for _ in 0..8 {
        let response = router.clone().oneshot(media_request()).await.unwrap();
        assert_eq!(response.status(), S::OK);
        held.push(response);
    }
    assert_eq!(
        router
            .clone()
            .oneshot(media_request())
            .await
            .unwrap()
            .status(),
        S::TOO_MANY_REQUESTS
    );
    drop(held.pop());
    let response = router.clone().oneshot(media_request()).await.unwrap();
    assert_eq!(response.status(), S::OK);
    drop(response);
    let forbidden = Request::get(format!("/media/{lease}/%2e%2e%2fsecret"))
        .header("authorization", format!("Bearer {FIXTURE_BEARER}"))
        .header("origin", FIXTURE_ORIGIN)
        .body(Body::empty())
        .unwrap();
    assert_ne!(
        router.clone().oneshot(forbidden).await.unwrap().status(),
        S::OK
    );
    let off = json!({"op":"off","expected":current}).to_string();
    let stopped = http_call(&router, &off, Some("off-once"), true).await;
    assert_eq!(stopped.status(), S::OK);
    let terminal = http_json(stopped).await;
    assert_eq!(
        http_json(http_call(&router, &off, Some("off-once"), true).await).await,
        terminal
    );
    assert_ne!(
        router
            .clone()
            .oneshot(media_request())
            .await
            .unwrap()
            .status(),
        S::OK
    );
    assert!(
        axum::body::to_bytes(held.pop().unwrap().into_body(), 64 * 1024)
            .await
            .is_err(),
        "revocation must apply while a response body is held"
    );
    assert!(std::fs::read_dir(&scratch.0).unwrap().all(|entry| !entry
        .unwrap()
        .file_name()
        .to_string_lossy()
        .starts_with("scene-")));
}

#[cfg(unix)]
#[path = "support/streamed_decoder.rs"]
mod streamed_decoder;

#[cfg(unix)]
#[test]
#[ignore = "explicit real streamed Decoder clock/pending fixture; requires owned inputs and tools"]
fn streamed_decoder_short_track_pending_and_failure() {
    streamed_decoder::run_from_env().expect("streamed Decoder pending/clock/cleanup failed");
}
