//! Normal-server-binary protocol qualification for the first protected media
//! adapter. This uses private HTTPS control/HLS and an owned HTTP MPEG-TS origin; it is not a native
//! player, UI, television, or visual-compositor qualification.
#![cfg(unix)]

#[path = "support/hls_production.rs"]
mod hls_production;
#[path = "support/multiview_production_config.rs"]
mod production_config;
#[path = "support/multiview_production_tls.rs"]
mod production_tls;

#[path = "../src/private_media_attempt.rs"]
mod media_attempt;

use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs::{self, OpenOptions},
    io::{Read, Write},
    net::{IpAddr, SocketAddr, TcpListener, TcpStream, UdpSocket},
    os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::OnceLock,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const STARTUP_LIMIT: Duration = Duration::from_secs(12);
const RUN_LIMIT: Duration = Duration::from_secs(600);
const NORMAL_SERVER_SHUTDOWN_LIMIT: Duration = Duration::from_secs(10);
use production_config::{EXPIRING_TOKEN, TOKEN};
const PROFILE: &str = "http-mpegts-v1-640x360-10fps";
const INPUTS: &str = "OTTPLAY_MULTIVIEW_PRODUCTION_INPUTS";
use production_config::ProductionMode;

thread_local! {
    // Bounded summaries only; raw segments, URLs and ffprobe JSON are never retained.
    static SEGMENT_VIDEO_PROOFS: std::cell::RefCell<Vec<Value>> = const { std::cell::RefCell::new(Vec::new()) };
    // Three existing seed calls only; fixed-size Copy evidence, no raw stderr or URLs.
    static SEED_REFUSAL_SUMMARIES: std::cell::RefCell<[Option<SeedCallSummary>; 3]> = const { std::cell::RefCell::new([None; 3]) };
    // Bound only this test thread's owned normal-server stderr, never an arbitrary file.
    static FAILURE_STDERR_ROOT: std::cell::RefCell<Option<PathBuf>> = const { std::cell::RefCell::new(None) };
}
struct FailureStderrGuard {
    emit: fn(&str),
}
impl FailureStderrGuard {
    fn install(root: &Path) -> Self {
        FAILURE_STDERR_ROOT.with(|slot| {
            assert!(
                slot.borrow().is_none(),
                "one owned normal fixture per thread"
            );
            *slot.borrow_mut() = Some(root.to_owned());
        });
        Self {
            emit: |record| eprintln!("normal_server_unwind {record}"),
        }
    }
}
impl Drop for FailureStderrGuard {
    fn drop(&mut self) {
        // Take the owned path and release the borrow before any diagnostic I/O.
        // Server/upstream guards were declared later and have already dropped;
        // OwnedRoot was declared earlier and has not removed this file yet.
        let root = FAILURE_STDERR_ROOT
            .try_with(|slot| {
                slot.try_borrow_mut()
                    .ok()
                    .and_then(|mut value| value.take())
            })
            .ok()
            .flatten();
        if std::thread::panicking() {
            if let Some(root) = root {
                // A diagnostic failure must never replace the original panic.
                let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    (self.emit)(&fixture_stderr_diagnostic(
                        &root,
                        &root.join("server.stderr"),
                    ));
                }));
            }
        }
    }
}
fn request_stderr_diagnostic() -> String {
    FAILURE_STDERR_ROOT.with(|slot| {
        slot.borrow().as_ref().map_or_else(
            || "stderr_not_registered".to_owned(),
            |root| fixture_stderr_diagnostic(root, &root.join("server.stderr")),
        )
    })
}

fn redacted_startup_tail(bytes: &[u8], root: &Path) -> String {
    // Redact before truncating, so a boundary cannot expose part of a secret.
    let text = String::from_utf8_lossy(bytes)
        .replace(TOKEN, "[control-token]")
        .replace(EXPIRING_TOKEN, "[expiry-token]")
        .replace(
            "production_fixture_signing_key_aaaaaaaaaaaaaaaa",
            "[signing-key]",
        )
        .replace(root.to_string_lossy().as_ref(), "[owned-root]");
    let cleaned = text
        .split_whitespace()
        .map(|word| if word.contains("://") { "[url]" } else { word })
        .collect::<Vec<_>>()
        .join(" ");
    let mut start = cleaned.len().saturating_sub(8192);
    while !cleaned.is_char_boundary(start) {
        start += 1;
    }
    cleaned[start..].to_owned()
}

fn fixture_stderr_diagnostic(root: &Path, path: &Path) -> String {
    let read = || -> std::io::Result<Vec<u8>> {
        let file = OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
            .open(&path)?;
        let before = file.metadata()?;
        if !before.is_file()
            || before.nlink() != 1
            || before.uid() != unsafe { libc::geteuid() }
            || before.mode() & 0o077 != 0
            || before.len() > 65536
        {
            return Err(std::io::Error::other("stderr shape or bound"));
        }
        let mut bytes = Vec::new();
        (&file).take(65537).read_to_end(&mut bytes)?;
        let after = file.metadata()?;
        let identity = |value: &fs::Metadata| {
            (
                value.dev(),
                value.ino(),
                value.len(),
                value.mode(),
                value.nlink(),
                value.uid(),
                value.mtime(),
                value.mtime_nsec(),
                value.ctime(),
                value.ctime_nsec(),
            )
        };
        if bytes.len() > 65536
            || identity(&before) != identity(&after)
            || identity(&after) != identity(&fs::symlink_metadata(&path)?)
        {
            return Err(std::io::Error::other("stderr changed"));
        }
        Ok(bytes)
    };
    match read() {
        Ok(bytes) => format_owned_stderr(&bytes, root),
        Err(_) => "stderr_unavailable_or_outside_owned_bound".to_owned(),
    }
}

fn format_owned_stderr(bytes: &[u8], root: &Path) -> String {
    // A killed process may leave a token or URL only partly written. Never
    // expose that incomplete line; redact complete input before tail truncation.
    let complete = bytes
        .iter()
        .rposition(|byte| *byte == b'\n')
        .map_or(0, |i| i + 1);
    format!(
        "stderr_bytes={} stderr_sha256={:x} stderr_incomplete_tail_bytes={} stderr_tail={:?}",
        bytes.len(),
        Sha256::digest(bytes),
        bytes.len() - complete,
        redacted_startup_tail(&bytes[..complete], root),
    )
}

#[test]
fn unwind_stderr_capture_preserves_original_panic_and_clears_registration() {
    use std::sync::atomic::AtomicUsize;
    static REPORTS: AtomicUsize = AtomicUsize::new(0);
    fn observe(record: &str) {
        assert_eq!(request_stderr_diagnostic(), "stderr_not_registered");
        assert_eq!(record, "stderr_unavailable_or_outside_owned_bound");
        REPORTS.fetch_add(1, Ordering::SeqCst);
    }
    let before = REPORTS.load(Ordering::SeqCst);
    let original = std::panic::catch_unwind(|| {
        let mut guard = FailureStderrGuard::install(Path::new("/nonexistent-owned-unwind-fixture"));
        guard.emit = observe;
        panic!("original direct expectation failure");
    })
    .unwrap_err();
    assert_eq!(
        original.downcast_ref::<&str>(),
        Some(&"original direct expectation failure")
    );
    assert_eq!(REPORTS.load(Ordering::SeqCst), before + 1);
    assert_eq!(request_stderr_diagnostic(), "stderr_not_registered");
    let original = std::panic::catch_unwind(|| {
        let mut guard = FailureStderrGuard::install(Path::new("/nonexistent-owned-unwind-fixture"));
        guard.emit = |_| panic!("synthetic diagnostic writer failure");
        panic!("original remains authoritative");
    })
    .unwrap_err();
    assert_eq!(
        original.downcast_ref::<&str>(),
        Some(&"original remains authoritative")
    );
    assert_eq!(request_stderr_diagnostic(), "stderr_not_registered");
}

#[test]
fn owned_stderr_drops_incomplete_secret_line_before_bounded_redaction() {
    let root = Path::new("/owned/synthetic-fixture");
    let fragment = &TOKEN[..TOKEN.len() / 2];
    let bytes = format!("safe complete line\n{fragment}");
    let report = format_owned_stderr(bytes.as_bytes(), root);
    assert!(report.contains("safe complete line"));
    assert!(!report.contains(fragment));
    assert!(report.contains(&format!("stderr_incomplete_tail_bytes={}", fragment.len())));
    let complete = format!("{TOKEN} https://fixture.invalid/private?token=hidden\n");
    let report = format_owned_stderr(complete.as_bytes(), root);
    assert!(!report.contains(TOKEN) && !report.contains("token=hidden"));
    assert!(report.contains("[control-token]") && report.contains("[url]"));
    assert_eq!(redacted_startup_tail(&vec![b'x'; 65536], root).len(), 8192);
}

#[test]
fn startup_diagnostic_tail_is_bounded_and_redacts_fixture_secrets_and_urls() {
    assert_eq!(request_stderr_diagnostic(), "stderr_not_registered");
    {
        let _guard = FailureStderrGuard::install(Path::new("/nonexistent-owned-fixture"));
        FAILURE_STDERR_ROOT.with(|slot| {
            assert_eq!(
                slot.borrow().as_deref(),
                Some(Path::new("/nonexistent-owned-fixture"))
            );
        });
    }
    assert_eq!(request_stderr_diagnostic(), "stderr_not_registered");
    let root = Path::new("/owned/synthetic-fixture");
    let text=format!("{} {} production_fixture_signing_key_aaaaaaaaaaaaaaaa /owned/synthetic-fixture/operator.json http://fixture.invalid/path?token=hidden \u{1b}[31m invalid source credential policy",TOKEN,EXPIRING_TOKEN);
    let redacted = redacted_startup_tail(text.as_bytes(), root);
    for secret in [
        TOKEN,
        EXPIRING_TOKEN,
        "production_fixture_signing_key_aaaaaaaaaaaaaaaa",
        "/owned/synthetic-fixture",
        "fixture.invalid",
        "token=hidden",
    ] {
        assert!(!redacted.contains(secret));
    }
    assert!(redacted.contains("invalid source credential policy"));
    assert!(!format!("{redacted:?}").contains('\u{1b}'));
    let long = vec![b'x'; 65536];
    assert_eq!(redacted_startup_tail(&long, root).len(), 8192);

    let line = b"multiview_clock version=1 now_ms=1100\n";
    assert_eq!(startup_clock_sample(line), Some(1100));
    assert_eq!(
        startup_clock_sample(b"other closed event\nmultiview_clock version=1 now_ms=1100\n"),
        Some(1100)
    );
    for invalid in [
        b"".as_slice(),
        b"other closed event\n",
        b"multiview_clock version=1 now_ms=1100",
        b"multiview_clock version=1 now_ms=1100\npartial tail",
        b"multiview_clock version=1 now_ms=1100\nmultiview_clock version=1 now_ms=1100\n",
        b"multiview_clock version=2 now_ms=1100\n",
        b"multiview_clock version=1 now_ms=\n",
        b"multiview_clock version=1 now_ms=0\n",
        b"multiview_clock version=1 now_ms=01100\n",
        b"multiview_clock version=1 now_ms=+1100\n",
        b"multiview_clock version=1 now_ms=-1\n",
        b"multiview_clock version=1 now_ms=1100 extra=1\n",
        b"multiview_clock version=1 now_ms=1100\r\n",
        b"multiview_clock version=1 now_ms=18446744073709551616\n",
        b"multiview_clock version=1 now_ms=\xff\n",
    ] {
        assert_eq!(startup_clock_sample(invalid), None);
    }
    assert_eq!(startup_clock_sample(&vec![b'\n'; 65537]), None);
    assert_eq!(
        startup_clock_sample(b"multiview_clock version=1 now_ms=18446744073709551615\n"),
        Some(u64::MAX)
    );

    // A steady wall clock already at E need not imply broker Clock >= E:
    // its separate startup-wall and elapsed floors can lose a millisecond.
    let wall_anchor_us = 1_100_750_u64;
    let monotonic_anchor_us = 1_101_000_u64;
    let wall_now_us = 61_000_100_u64;
    let expiry_ms = 61_000_u64;
    let authority_now = wall_anchor_us / 1000 + (wall_now_us - monotonic_anchor_us) / 1000;
    assert!(wall_now_us / 1000 >= expiry_ms);
    assert_eq!(authority_now, expiry_ms - 1);
    assert_eq!(
        broker_clock_lower_bound(authority_now, Duration::ZERO),
        Some(expiry_ms - 1)
    );
    assert_eq!(
        broker_clock_lower_bound(authority_now, Duration::from_micros(999)),
        Some(expiry_ms - 1)
    );
    assert_eq!(
        broker_clock_lower_bound(authority_now, Duration::from_millis(1)),
        Some(expiry_ms)
    );

    // Delayed observation remains conservative across fractional floor carries.
    for delay_us in [0_u64, 250, 999, 1000, 125_750] {
        for elapsed_us in [0_u64, 1, 999, 1000, 59_999_999] {
            let sample_us = 12_750_u64;
            let sample_ms = 1100 + sample_us / 1000;
            let current_ms = 1100 + (sample_us + delay_us + elapsed_us) / 1000;
            let bound =
                broker_clock_lower_bound(sample_ms, Duration::from_micros(elapsed_us)).unwrap();
            assert!(bound <= current_ms);
        }
    }
    assert_eq!(
        broker_clock_lower_bound(u64::MAX, Duration::from_millis(1)),
        None
    );
    assert_eq!(
        broker_clock_lower_bound(1, Duration::from_secs(u64::MAX)),
        None
    );
}

struct FixtureHttp {
    runtime: tokio::runtime::Runtime,
    client: reqwest::Client,
    https_control_requests: std::sync::atomic::AtomicUsize,
    https_media_requests: std::sync::atomic::AtomicUsize,
}
static FIXTURE_HTTP: OnceLock<FixtureHttp> = OnceLock::new();

fn install_http_client(ca_pem: Option<&[u8]>) {
    let mut builder = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(3))
        .timeout(Duration::from_secs(30));
    if let Some(pem) = ca_pem {
        let certificate =
            reqwest::Certificate::from_pem(pem).expect("synthetic fixture CA certificate");
        builder = builder
            .tls_built_in_root_certs(false)
            .add_root_certificate(certificate);
    }
    let client = builder.build().expect("bounded fixture HTTP client");
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("fixture HTTP runtime");
    assert!(
        FIXTURE_HTTP
            .set(FixtureHttp {
                runtime,
                client,
                https_control_requests: std::sync::atomic::AtomicUsize::new(0),
                https_media_requests: std::sync::atomic::AtomicUsize::new(0)
            })
            .is_ok(),
        "fixture HTTP client must be installed before first request"
    );
}

fn fixture_http() -> &'static FixtureHttp {
    FIXTURE_HTTP.get_or_init(|| {
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(3))
            .timeout(Duration::from_secs(30))
            .build()
            .expect("bounded fixture HTTP client");
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("fixture HTTP runtime");
        FixtureHttp {
            runtime,
            client,
            https_control_requests: std::sync::atomic::AtomicUsize::new(0),
            https_media_requests: std::sync::atomic::AtomicUsize::new(0),
        }
    })
}

// The sample is from the same server Clock that authenticates credentials.
// Only a complete unique canonical record in the owned bounded file qualifies.
fn startup_clock_sample(bytes: &[u8]) -> Option<u64> {
    if bytes.is_empty() || bytes.len() > 65536 || bytes.last() != Some(&b'\n') {
        return None;
    }
    let mut sample = None;
    for line in bytes.split(|byte| *byte == b'\n') {
        if !line.starts_with(b"multiview_clock") {
            continue;
        }
        let value = line.strip_prefix(b"multiview_clock version=1 now_ms=")?;
        if sample.is_some()
            || value.is_empty()
            || value.len() > 20
            || value[0] == b'0'
            || !value.iter().all(u8::is_ascii_digit)
        {
            return None;
        }
        sample = Some(std::str::from_utf8(value).ok()?.parse::<u64>().ok()?);
    }
    sample
}

// Observation follows sampling on the same host's monotonic clock. Therefore
// sample + floor(elapsed_since_observation) <= current broker Clock, including
// fractional milliseconds and delayed observation. This is not a wall-clock
// expiry or exact physical cleanup-latency measurement.
fn broker_clock_lower_bound(sample_ms: u64, elapsed: Duration) -> Option<u64> {
    sample_ms.checked_add(u64::try_from(elapsed.as_millis()).ok()?)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("wall clock after epoch")
        .as_millis() as u64
}

fn private_ip() -> IpAddr {
    // UDP connect only selects the OS route; no datagram is sent. The selected
    // address must be RFC1918, so no public or loopback origin is admitted.
    let socket = UdpSocket::bind("0.0.0.0:0").expect("owned route probe socket");
    socket.connect("192.0.2.1:9").expect("route selection");
    let address = socket.local_addr().expect("selected local address").ip();
    match address {
        IpAddr::V4(value) if value.is_private() && !value.is_loopback() => IpAddr::V4(value),
        _ => panic!("hosted Unix runner did not select an RFC1918 IPv4 address"),
    }
}

fn secure_home() -> PathBuf {
    let home = PathBuf::from(std::env::var_os("HOME").expect("HOME is required"));
    assert!(home.is_absolute(), "HOME must be absolute");
    let home = fs::canonicalize(home).expect("HOME must resolve");
    let uid = unsafe { libc::geteuid() };
    for ancestor in home.ancestors() {
        let metadata = fs::symlink_metadata(ancestor).expect("HOME ancestry inspectable");
        assert!(
            metadata.is_dir()
                && (metadata.uid() == 0 || metadata.uid() == uid)
                && metadata.mode() & 0o022 == 0,
            "HOME ancestry must be private"
        );
    }
    home
}

struct OwnedRoot(PathBuf);
impl OwnedRoot {
    fn new() -> Self {
        let path = secure_home().join(format!(
            ".ottplay-multiview-production-{}",
            uuid::Uuid::new_v4()
        ));
        fs::DirBuilder::new()
            .mode(0o700)
            .create(&path)
            .expect("fresh private fixture root");
        Self(path)
    }
    fn write_private(&self, name: &str, bytes: &[u8]) -> PathBuf {
        let path = self.0.join(name);
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&path)
            .expect("fresh private fixture file");
        file.write_all(bytes).expect("write private fixture file");
        file.sync_all().expect("sync private fixture file");
        path
    }
    fn remove(&mut self) -> std::io::Result<()> {
        fs::remove_dir_all(&self.0)
    }
}
impl Drop for OwnedRoot {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

struct ChildGuard(Child);
impl Drop for ChildGuard {
    fn drop(&mut self) {
        if self.0.try_wait().ok().flatten().is_none() {
            let _ = self.0.kill();
        }
        let _ = self.0.wait();
    }
}

struct NormalServerGuard(Child);
impl Drop for NormalServerGuard {
    fn drop(&mut self) {
        // Unlike the short FFmpeg filter guard above, the owned normal server
        // supervises decoder children. Give its normal SIGTERM shutdown path
        // up to the same grace period used by the explicit success-path
        // assertion, then use the owned-child fallback. Reaping may add time;
        // the outer fixture driver remains the final total-runtime bound.
        // Never signal a PID after try_wait has reaped it, and never signal the
        // process group: both would risk affecting a reused/unowned process.
        match self.0.try_wait() {
            Ok(Some(_)) | Err(_) => return,
            Ok(None) => {}
        }
        let pid = self.0.id() as libc::pid_t;
        unsafe {
            libc::kill(pid, libc::SIGTERM);
        }
        let deadline = Instant::now() + NORMAL_SERVER_SHUTDOWN_LIMIT;
        loop {
            match self.0.try_wait() {
                Ok(Some(_)) | Err(_) => return,
                Ok(None) => {
                    let remaining = deadline.saturating_duration_since(Instant::now());
                    if !remaining.is_zero() {
                        thread::sleep(Duration::from_millis(100).min(remaining));
                        continue;
                    }
                    // The child is still owned and unreaped. Fall back through
                    // Child's handle, then reap it; no group/PID signal follows.
                    let _ = self.0.kill();
                    let _ = self.0.wait();
                    return;
                }
            }
        }
    }
}

struct Upstream {
    address: SocketAddr,
    stop: Arc<AtomicBool>,
    requests: Arc<Mutex<HashMap<String, usize>>>,
    active: Arc<std::sync::atomic::AtomicUsize>,
    accept: Option<JoinHandle<()>>,
    hls: Option<Arc<hls_production::HlsSources>>,
}
impl Upstream {
    fn start(address: IpAddr, files: HashMap<String, Arc<Vec<u8>>>) -> Self {
        Self::start_mode(address, files, None)
    }
    fn start_mode(
        address: IpAddr,
        files: HashMap<String, Arc<Vec<u8>>>,
        hls: Option<Arc<hls_production::HlsSources>>,
    ) -> Self {
        let listener =
            TcpListener::bind(SocketAddr::new(address, 0)).expect("private fixture listener");
        listener
            .set_nonblocking(true)
            .expect("nonblocking fixture listener");
        let address = listener.local_addr().unwrap();
        let stop = Arc::new(AtomicBool::new(false));
        let requests = Arc::new(Mutex::new(HashMap::new()));
        let active = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let worker_stop = stop.clone();
        let worker_requests = requests.clone();
        let worker_active = active.clone();
        let files = Arc::new(files);
        let worker_hls = hls.clone();
        let accept = thread::spawn(move || {
            let workers = Arc::new(Mutex::new(Vec::<JoinHandle<()>>::new()));
            while !worker_stop.load(Ordering::Acquire) {
                match listener.accept() {
                    Ok((stream, _)) => {
                        // On macOS, accepted sockets inherit O_NONBLOCK from
                        // the listener. The HTTP handler below is deliberately
                        // blocking with finite read/write timeouts, so normalize
                        // each accepted stream before handing it to a worker.
                        // A failed normalization closes this socket without
                        // incrementing the active-worker count.
                        if stream.set_nonblocking(false).is_err() {
                            drop(stream);
                            continue;
                        }
                        let stop = worker_stop.clone();
                        let requests = worker_requests.clone();
                        let files = files.clone();
                        let hls = worker_hls.clone();
                        let active = worker_active.clone();
                        active.fetch_add(1, Ordering::AcqRel);
                        workers.lock().unwrap().push(thread::spawn(move || {
                            if let Some(hls) = hls {
                                let _ = hls.serve(stream, &stop);
                            } else {
                                let _ = serve_source(stream, &files, &requests, &stop);
                            }
                            active.fetch_sub(1, Ordering::AcqRel);
                        }));
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(10))
                    }
                    Err(_) => break,
                }
            }
            for worker in workers.lock().unwrap().drain(..) {
                let _ = worker.join();
            }
        });
        Self {
            address,
            stop,
            requests,
            active,
            accept: Some(accept),
            hls,
        }
    }
    fn request_counts(&self) -> HashMap<String, usize> {
        self.requests.lock().unwrap().clone()
    }
    fn active_connections(&self) -> usize {
        self.active.load(Ordering::Acquire)
    }
    fn source_was_read(&self, mode: ProductionMode) -> bool {
        if mode == ProductionMode::RawMpegTs {
            return self.active_connections() > 0;
        }
        self.hls
            .as_ref()
            .unwrap()
            .audit()
            .segments
            .iter()
            .flatten()
            .any(|count| *count > 0)
    }
    fn confirm_cleanup(&self, output: &Path, stable_hls: bool) {
        let until = Instant::now() + Duration::from_secs(10);
        while fs::read_dir(output).unwrap().next().is_some() || self.active_connections() != 0 {
            assert!(
                Instant::now() < until,
                "source/output custody did not retire"
            );
            thread::sleep(Duration::from_millis(100));
        }
        if let Some(hls) = self.hls.as_ref().filter(|_| stable_hls) {
            let observation = hls.observe_retirement();
            let until = Instant::now() + Duration::from_secs(12);
            while Instant::now() < until {
                assert_eq!(self.active_connections(), 0, "retired HLS body resumed");
                assert!(fs::read_dir(output).unwrap().next().is_none());
                thread::sleep(Duration::from_millis(50));
            }
            hls.confirm_retired_scene(observation, output, self.active_connections());
        }
    }
}
impl Drop for Upstream {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(thread) = self.accept.take() {
            let _ = thread.join();
        }
    }
}

fn serve_source(
    mut stream: TcpStream,
    files: &HashMap<String, Arc<Vec<u8>>>,
    requests: &Mutex<HashMap<String, usize>>,
    stop: &AtomicBool,
) -> std::io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(3)))?;
    stream.set_write_timeout(Some(Duration::from_secs(5)))?;
    let mut request = Vec::with_capacity(1024);
    let mut one = [0u8; 1];
    while request.len() < 16 * 1024 {
        if stream.read(&mut one)? == 0 {
            return Ok(());
        }
        request.push(one[0]);
        if request.ends_with(b"\r\n\r\n") {
            break;
        }
    }
    let first = request
        .split(|byte| *byte == b'\n')
        .next()
        .unwrap_or_default();
    let fields: Vec<_> = first.split(|byte| *byte == b' ').collect();
    if fields.len() < 2 || fields[0] != b"GET" {
        return write_not_found(&mut stream);
    }
    let path = std::str::from_utf8(fields[1]).unwrap_or("");
    let Some(name) = path.strip_prefix('/') else {
        return write_not_found(&mut stream);
    };
    let Some(bytes) = files.get(name) else {
        return write_not_found(&mut stream);
    };
    {
        let mut requests = requests.lock().unwrap();
        let count = requests.entry(name.to_owned()).or_default();
        *count += 1;
    }
    write!(stream, "HTTP/1.1 200 OK\r\ncontent-type: video/mp2t\r\ncontent-length: {}\r\nconnection: close\r\n\r\n", bytes.len())?;
    // Every probe or decode subscription receives the same small fast bootstrap
    // prefix, then the remaining original-PTS stream is paced against wall time.
    // Subscription order is deliberately not used to infer the runtime role.
    let started = Instant::now();
    let total = bytes.len();
    let bootstrap = total.saturating_mul(2) / 210;
    for (index, chunk) in bytes.chunks(16 * 1024).enumerate() {
        if stop.load(Ordering::Acquire) {
            break;
        }
        let offset = (index + 1) * 16 * 1024;
        if offset > bootstrap {
            let target = Duration::from_secs(210).mul_f64(offset.min(total) as f64 / total as f64);
            if target > started.elapsed() {
                thread::sleep(target - started.elapsed());
            }
        }
        if stream.write_all(chunk).is_err() {
            break;
        }
    }
    Ok(())
}
fn write_not_found(stream: &mut TcpStream) -> std::io::Result<()> {
    stream.write_all(b"HTTP/1.1 404 Not Found\r\ncontent-length: 0\r\nconnection: close\r\n\r\n")
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum FixtureReadStage {
    HttpSend,
    HttpBody,
    HttpDeadline,
    HttpStatus,
    PlaylistUrl,
    BaseUrl,
    Utf8,
    MissingSequence,
    InvalidSequence,
    SegmentJoin,
    SegmentUrl,
}
impl FixtureReadStage {
    fn code(self) -> &'static str {
        match self {
            Self::HttpSend => "transport_send",
            Self::HttpBody => "transport_body",
            Self::HttpDeadline => "transport_deadline",
            Self::HttpStatus => "http_status",
            Self::PlaylistUrl => "playlist_url",
            Self::BaseUrl => "base_url",
            Self::Utf8 => "utf8",
            Self::MissingSequence => "missing_sequence",
            Self::InvalidSequence => "invalid_sequence",
            Self::SegmentJoin => "segment_join",
            Self::SegmentUrl => "segment_url",
        }
    }
}
#[derive(Clone, Copy, Debug)]
struct TransportErrorFlags {
    timeout: bool,
    connect: bool,
    request: bool,
    body: bool,
    decode: bool,
    builder: bool,
}
impl TransportErrorFlags {
    fn capture(error: &reqwest::Error) -> Self {
        Self {
            timeout: error.is_timeout(),
            connect: error.is_connect(),
            request: error.is_request(),
            body: error.is_body(),
            decode: error.is_decode(),
            builder: error.is_builder(),
        }
    }
}
#[derive(Clone, Copy, Debug)]
struct FixtureReadFailure {
    stage: FixtureReadStage,
    status: Option<u16>,
    response_bytes: Option<usize>,
    response_sha256: Option<[u8; 32]>,
    temporary_busy: bool,
    transport_error: Option<TransportErrorFlags>,
    elapsed_ms: Option<u64>,
    seed_refusal: Option<SeedRefusal>,
    seed_evaluation: Option<SeedEvaluation>,
}
impl FixtureReadFailure {
    fn without_body(
        stage: FixtureReadStage,
        status: Option<u16>,
        response_bytes: Option<usize>,
    ) -> Self {
        Self {
            stage,
            status,
            response_bytes,
            response_sha256: None,
            temporary_busy: false,
            transport_error: None,
            elapsed_ms: None,
            seed_refusal: None,
            seed_evaluation: None,
        }
    }
    fn transport(
        stage: FixtureReadStage,
        error: &reqwest::Error,
        elapsed: Duration,
        status: Option<u16>,
        response_bytes: Option<usize>,
    ) -> Self {
        Self {
            stage,
            status,
            response_bytes,
            response_sha256: None,
            temporary_busy: false,
            transport_error: Some(TransportErrorFlags::capture(error)),
            elapsed_ms: Some(u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX)),
            seed_refusal: None,
            seed_evaluation: None,
        }
    }
    fn response(stage: FixtureReadStage, status: u16, bytes: &[u8]) -> Self {
        Self {
            stage,
            status: Some(status),
            response_bytes: Some(bytes.len()),
            response_sha256: Some(Sha256::digest(bytes).into()),
            // Retry only the exact closed media-admission response. Do not
            // parse or retain arbitrary server error bodies as retry signals.
            temporary_busy: stage == FixtureReadStage::HttpStatus
                && status == 503
                && bytes == br#"{"error":"temporary_busy","version":1}"#,
            transport_error: None,
            elapsed_ms: None,
            seed_refusal: None,
            seed_evaluation: None,
        }
    }
}
impl std::fmt::Display for FixtureReadFailure {
    fn fmt(&self, out: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            out,
            "stage={} status={:?} response_bytes={:?} response_sha256=",
            self.stage.code(),
            self.status,
            self.response_bytes
        )?;
        if let Some(digest) = self.response_sha256 {
            for byte in digest {
                write!(out, "{byte:02x}")?;
            }
        } else {
            write!(out, "none")?;
        }
        if let (Some(flags), Some(elapsed_ms)) = (self.transport_error, self.elapsed_ms) {
            write!(out, " elapsed_ms={elapsed_ms} transport_timeout={} transport_connect={} transport_request={} transport_body={} transport_decode={} transport_builder={}",
                flags.timeout, flags.connect, flags.request, flags.body, flags.decode, flags.builder)?;
        }
        if let Some(evaluation) = self.seed_evaluation {
            write!(
                out,
                " seed_evaluation_marker={} seed_evaluation={}",
                evaluation.marker.get(),
                evaluation.outcome.code()
            )?;
            if let Some((length, digest)) = evaluation.snapshot {
                write!(out, " checked_stderr_bytes={length} checked_stderr_sha256=")?;
                for byte in digest {
                    write!(out, "{byte:02x}")?;
                }
            } else {
                write!(out, " checked_stderr_bytes=none checked_stderr_sha256=none")?;
            }
        }
        Ok(())
    }
}

fn http(
    method: &str,
    url: &str,
    token: Option<&str>,
    request_id: Option<&str>,
    body: Option<&Value>,
    limit: usize,
) -> (u16, Vec<u8>) {
    // Existing callers keep the exact status0/empty-body failure convention.
    http_checked(method, url, token, request_id, body, limit).unwrap_or((0, Vec::new()))
}

fn http_checked(
    method: &str,
    url: &str,
    token: Option<&str>,
    request_id: Option<&str>,
    body: Option<&Value>,
    limit: usize,
) -> Result<(u16, Vec<u8>), FixtureReadFailure> {
    let timeout = if method == "POST" {
        Duration::from_secs(30)
    } else {
        Duration::from_secs(8)
    };
    http_checked_with_timeout(method, url, token, request_id, body, limit, timeout)
}

fn http_checked_with_timeout(
    method: &str,
    url: &str,
    token: Option<&str>,
    request_id: Option<&str>,
    body: Option<&Value>,
    limit: usize,
    timeout: Duration,
) -> Result<(u16, Vec<u8>), FixtureReadFailure> {
    http_checked_with_attempt(method, url, token, request_id, body, limit, timeout, None)
}

fn http_checked_with_attempt(
    method: &str,
    url: &str,
    token: Option<&str>,
    request_id: Option<&str>,
    body: Option<&Value>,
    limit: usize,
    timeout: Duration,
    attempt: Option<media_attempt::Marker>,
) -> Result<(u16, Vec<u8>), FixtureReadFailure> {
    assert!(
        attempt.is_none() || method == "GET",
        "attempt marker is GET-only"
    );
    let fixture = fixture_http();
    fixture.runtime.block_on(async {
        let operation = async {
            let mut request = fixture
                .client
                .request(
                    reqwest::Method::from_bytes(method.as_bytes()).expect("fixed HTTP method"),
                    url,
                )
                .timeout(timeout);
            if let Some(token) = token {
                request = request.bearer_auth(token);
            }
            if let Some(id) = request_id {
                request = request.header("x-request-id", id);
            }
            if let Some(value) = body {
                request = request.json(value);
            }
            if let Some(marker) = attempt {
                request = request.header(media_attempt::HEADER, marker.get().to_string());
            }
            let request_started = Instant::now();
            let mut response = request.send().await.map_err(|error| {
                FixtureReadFailure::transport(
                    FixtureReadStage::HttpSend,
                    &error,
                    request_started.elapsed(),
                    None,
                    None,
                )
            })?;
            if response
                .content_length()
                .is_some_and(|size| size > limit as u64)
            {
                panic!("fixture response exceeds byte limit");
            }
            let status = response.status().as_u16();
            let mut bytes = Vec::new();
            loop {
                let chunk = match response.chunk().await {
                    Ok(Some(chunk)) => chunk,
                    Ok(None) => break,
                    Err(error) => {
                        return Err(FixtureReadFailure::transport(
                            FixtureReadStage::HttpBody,
                            &error,
                            request_started.elapsed(),
                            Some(status),
                            Some(bytes.len()),
                        ))
                    }
                };
                if bytes.len().saturating_add(chunk.len()) > limit {
                    panic!("fixture response exceeds byte limit");
                }
                bytes.extend_from_slice(&chunk);
            }
            Ok((status, bytes))
        };
        tokio::time::timeout(timeout, operation)
            .await
            .unwrap_or_else(|_| {
                Err(FixtureReadFailure::without_body(
                    FixtureReadStage::HttpDeadline,
                    None,
                    None,
                ))
            })
    })
}

fn api_error_diagnostic(endpoint: &str, request_id: &str, bytes: &[u8]) -> String {
    // Error responses are closed; never print arbitrary response authority fields.
    let parsed = if bytes.len() <= 8192 {
        serde_json::from_slice::<Value>(bytes).ok()
    } else {
        None
    };
    let code = parsed
        .as_ref()
        .filter(|value| value["version"] == 1)
        .and_then(|value| value["error"].as_str())
        .filter(|code| {
            matches!(
                *code,
                "backend_unavailable"
                    | "unsupported_platform"
                    | "unauthorized"
                    | "forbidden"
                    | "invalid_request"
                    | "revision_conflict"
                    | "resource_limit"
                    | "authority_revoked"
            )
        })
        .unwrap_or("unrecognized_or_oversized_error");
    let projected = serde_json::to_vec(&json!({"version":1,"error":code})).unwrap();
    format!("operation={endpoint:?} request_id_sha256={:x} response_bytes={} response_sha256={:x} response={:?}",
        Sha256::digest(request_id.as_bytes()),bytes.len(),Sha256::digest(bytes),
        redacted_startup_tail(&projected,Path::new("/fixture-owned-root")))
}

#[test]
fn api_failure_diagnostics_bind_request_hash_and_closed_redacted_response() {
    let request = "secret-request-marker";
    let bytes = br#"{"version":1,"error":"invalid_request","input_grant":"secret-response-grant"}"#;
    let diagnostic = api_error_diagnostic("sessions", request, bytes);
    assert!(
        diagnostic.contains("invalid_request")
            && diagnostic.contains(&format!("{:x}", Sha256::digest(request.as_bytes())))
    );
    assert!(!diagnostic.contains(request) && !diagnostic.contains("secret-response-grant"));
    let malicious = format!("{{\"version\":1,\"error\":\"{}\"}}", TOKEN);
    assert!(!api_error_diagnostic("sessions", request, malicious.as_bytes()).contains(TOKEN));
    assert!(api_error_diagnostic("sessions", request, &vec![b'x'; 8193]).contains("oversized"));
}

fn post(base: &str, endpoint: &str, token: &str, id: &str, body: &Value) -> Value {
    let (status, bytes) = http(
        "POST",
        &format!("{base}/multiview/v1/{endpoint}"),
        Some(token),
        Some(id),
        Some(body),
        2 * 1024 * 1024,
    );
    if reqwest::Url::parse(base).is_ok_and(|url| url.scheme() == "https") {
        fixture_http()
            .https_control_requests
            .fetch_add(1, Ordering::Relaxed);
    }
    if status != 200 {
        // Preserve the closed startup record before panic unwinds OwnedRoot.
        eprintln!(
            "normal_server_request_failure {}",
            request_stderr_diagnostic()
        );
    }
    assert_eq!(
        status,
        200,
        "private API operation {endpoint} returned HTTP {status}; {}",
        api_error_diagnostic(endpoint, id, &bytes)
    );
    serde_json::from_slice(&bytes).expect("valid private API response JSON")
}
fn get_url(url: &str, token: Option<&str>, limit: usize) -> (u16, Vec<u8>) {
    get_url_checked(url, token, limit).unwrap_or((0, Vec::new()))
}
fn get_url_checked(
    url: &str,
    token: Option<&str>,
    limit: usize,
) -> Result<(u16, Vec<u8>), FixtureReadFailure> {
    get_url_checked_with_timeout(url, token, limit, Duration::from_secs(8))
}
fn get_url_checked_with_timeout(
    url: &str,
    token: Option<&str>,
    limit: usize,
    timeout: Duration,
) -> Result<(u16, Vec<u8>), FixtureReadFailure> {
    get_url_checked_with_attempt(url, token, limit, timeout, None)
}
fn get_url_checked_with_attempt(
    url: &str,
    token: Option<&str>,
    limit: usize,
    timeout: Duration,
    attempt: Option<media_attempt::Marker>,
) -> Result<(u16, Vec<u8>), FixtureReadFailure> {
    let response =
        http_checked_with_attempt("GET", url, token, None, None, limit, timeout, attempt);
    if response.as_ref().is_ok_and(|(status, _)| *status == 200)
        && reqwest::Url::parse(url).is_ok_and(|parsed| parsed.scheme() == "https")
    {
        fixture_http()
            .https_media_requests
            .fetch_add(1, Ordering::Relaxed);
    }
    response
}
fn get(base: &str, path: &str, token: Option<&str>, limit: usize) -> (u16, Vec<u8>) {
    let url = if path.starts_with("http://") || path.starts_with("https://") {
        path.to_owned()
    } else {
        format!("{base}{path}")
    };
    let response = http("GET", &url, token, None, None, limit);
    if reqwest::Url::parse(base).is_ok_and(|parsed| parsed.scheme() == "https") {
        fixture_http()
            .https_control_requests
            .fetch_add(1, Ordering::Relaxed);
    }
    response
}

fn assert_no_untrusted_cors(base: &str, path: &str) {
    let fixture = fixture_http();
    let url = format!("{base}{path}");
    let response = fixture.runtime.block_on(async {
        tokio::time::timeout(
            Duration::from_secs(5),
            fixture
                .client
                .request(reqwest::Method::OPTIONS, url)
                .header("Origin", "https://untrusted.example.test")
                .header("Access-Control-Request-Method", "GET")
                .timeout(Duration::from_secs(5))
                .send(),
        )
        .await
        .expect("bounded HTTPS CORS preflight")
        .expect("CORS preflight transport")
    });
    assert!(
        !response
            .headers()
            .contains_key("access-control-allow-origin"),
        "multiview-only reflected an untrusted CORS origin"
    );
}

fn status(base: &str, token: &str, context: &Value, id: &str) -> Value {
    post(
        base,
        "status",
        token,
        id,
        &json!({
            "version": 1,
            "server_epoch": context["server_epoch"],
            "session_id": context["session_id"],
            "native_expected": context["native_expected"],
        }),
    )
}

fn context_for_slot(status: &Value, slot_id: u64, native: &Value) -> Value {
    // Rebase each known slot identity on fresh session-level native revisions
    // from status. Cached per-slot bindings carry only that slot's generation
    // and source revision and may otherwise be stale after focus/audio changes.
    let mut current_native = status["native_expected"].clone();
    for field in ["slot_id", "slot_generation", "source_revision"] {
        current_native[field] = native[field].clone();
    }
    json!({"server_epoch":status["server_epoch"],"session_id":status["session_id"],
        "backend_expected":status["backend_expected"],"native_expected":current_native,
        "backend_slot_revision":slot(status, slot_id)["source_revision"]})
}
fn contexts(status: &Value) -> (Value, Value) {
    let first = json!({
        "server_epoch": status["server_epoch"],
        "session_id": status["session_id"],
        "backend_expected": status["backend_expected"],
        "native_expected": status["native_expected"],
        "backend_slot_revision": 0,
    });
    let mut second = first.clone();
    second["native_expected"]["slot_id"] = json!(1);
    second["native_expected"]["slot_generation"] = json!("native_slot_1");
    second["native_expected"]["source_revision"] = json!("native_source_1");
    second["backend_slot_revision"] = json!(0);
    (first, second)
}

fn catalog(base: &str, token: &str, context: &Value, id: &str) -> Value {
    post(
        base,
        "sources",
        token,
        id,
        &json!({"version":1,"context":context,"cursor":null}),
    )
}

fn grant(
    base: &str,
    token: &str,
    context: &Value,
    item: &Value,
    catalog_revision: &Value,
    suffix: &str,
) -> Value {
    let mut next = context["native_expected"].clone();
    next["source_revision"] = json!(format!("source_{suffix}"));
    post(
        base,
        "input-grants",
        token,
        &format!("grant_{suffix}"),
        &json!({
            "version":1,"context":context,"next_native":next,
            "source_ref":item["source_ref"],"item_ref":item["item_ref"],"item_revision":item["item_revision"],
            "identity_version":item["identity_version"],"favorite_sha256":item["favorite_sha256"],
            "catalog_revision":catalog_revision,"remaining_budget_ms":30000,
        }),
    )
}

fn control(
    base: &str,
    token: &str,
    context: &Value,
    id: &str,
    op: Value,
    next: Option<Value>,
) -> Value {
    post(
        base,
        "control",
        token,
        id,
        &json!({"version":1,"context":context,"next_native":next,"op":op}),
    )
}

fn create_session(base: &str, token: &str, server_epoch: &Value, native: Value, id: &str) -> Value {
    let geometry = disjoint_geometry(2);
    post(
        base,
        "sessions",
        token,
        id,
        &json!({"version":1,"server_epoch":server_epoch,
        "native_expected":native,"output_profile_id":PROFILE,"geometry":geometry}),
    )
}

fn disjoint_geometry(slot_count: usize) -> Value {
    let rects = if slot_count == 2 {
        vec![
            json!({"slot_id":0,"x":0,"y":0,"width":320,"height":360,"z":0}),
            json!({"slot_id":1,"x":320,"y":0,"width":320,"height":360,"z":1}),
        ]
    } else {
        assert_eq!(slot_count, 9);
        (0..9)
            .map(|slot| {
                let column = slot % 3;
                let row = slot / 3;
                let x = [0, 214, 428][column];
                let width = [214, 214, 212][column];
                json!({"slot_id":slot,"x":x,"y":row * 120,"width":width,"height":120,"z":slot})
            })
            .collect()
    };
    json!({"canvas":{"width":640,"height":360,"fps":10},"revision":1,"mode":"disjoint","rects":rects})
}

fn validate_fixture_geometry(
    value: Value,
) -> Result<
    ottplay_core::multiview::geometry::ValidatedGeometry,
    ottplay_core::multiview::geometry::GeometryError,
> {
    use ottplay_core::multiview::{
        broker::wire::Geometry,
        geometry::{CanvasSpec, ImportedRect, OverlapPolicy, ValidatedGeometry},
    };
    let value: Geometry =
        serde_json::from_value(value).expect("fixture geometry uses actual production DTO");
    let rects: Vec<_> = value
        .rects
        .iter()
        .map(|r| ImportedRect {
            slot_id: r.slot_id,
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
            z: r.z,
        })
        .collect();
    ValidatedGeometry::new(
        CanvasSpec {
            width: value.canvas.width,
            height: value.canvas.height,
            fps: value.canvas.fps,
        },
        value.revision,
        &rects,
        OverlapPolicy::Disjoint,
    )
}

#[test]
fn two_slot_fixture_geometry_passes_actual_core_validation() {
    let geometry = validate_fixture_geometry(disjoint_geometry(2)).unwrap();
    assert_eq!(geometry.rects().len(), 2);
    assert_eq!(geometry.canvas().width, 640);
}

#[test]
fn nine_slot_fixture_geometry_passes_actual_core_and_old_odd_grid_is_rejected() {
    use ottplay_core::multiview::geometry::GeometryError;
    let geometry = validate_fixture_geometry(disjoint_geometry(9)).unwrap();
    assert_eq!(geometry.rects().len(), 9);
    assert_eq!(
        geometry
            .rects()
            .iter()
            .map(|r| u64::from(r.width) * u64::from(r.height))
            .sum::<u64>(),
        640 * 360
    );
    assert_eq!(
        geometry
            .rects()
            .iter()
            .map(|r| (r.slot_id, r.z))
            .collect::<Vec<_>>(),
        (0..9).map(|id| (id, id)).collect::<Vec<_>>()
    );
    let mut old = disjoint_geometry(9);
    old["rects"][1]["width"] = json!(213);
    assert_eq!(
        validate_fixture_geometry(old).err(),
        Some(GeometryError::InvalidRect)
    );
}

fn native_for_slot(slot: u64) -> Value {
    json!({"runtime":"native_runtime_shared","expected":{
        "scene":"native_scene_shared","layout_revision":"layout_shared",
        "focus_revision":"focus_shared","audio_revision":"audio_shared"},
        "slot_id":slot,"slot_generation":format!("native_slot_{slot}"),
        "source_revision":format!("native_source_{slot}")})
}

fn create_session_slots(
    base: &str,
    token: &str,
    server_epoch: &Value,
    slot_count: usize,
    id: &str,
) -> Value {
    post(
        base,
        "sessions",
        token,
        id,
        &json!({"version":1,"server_epoch":server_epoch,
        "native_expected":native_for_slot(0),"output_profile_id":PROFILE,
        "geometry":disjoint_geometry(slot_count)}),
    )
}

fn snapshot(base: &str, token: &str, binding: &Value, id: &str) -> Value {
    status(base, token, binding, id)
}

fn slot<'a>(snapshot: &'a Value, id: u64) -> &'a Value {
    snapshot["slots"]
        .as_array()
        .unwrap()
        .iter()
        .find(|slot| slot["slot_id"] == id)
        .expect("slot status")
}

fn request_source(
    base: &str,
    token: &str,
    ctx: &Value,
    selected: &Value,
    catalog_revision: &Value,
    suffix: &str,
) -> Value {
    let reply = grant(base, token, ctx, selected, catalog_revision, suffix);
    let started = control(
        base,
        token,
        &reply["context"],
        &format!("play_{suffix}"),
        json!({"name":"play","input_grant":reply["input_grant"]}),
        None,
    );
    started["context"].clone()
}

fn wait_slot(
    base: &str,
    token: &str,
    binding: &Value,
    id: u64,
    expected_item: &str,
    deadline: Instant,
) -> Value {
    loop {
        let current = snapshot(base, token, binding, "status_wait");
        let value = slot(&current, id);
        if value["state"] == "playing"
            && value["frames"].as_u64().unwrap_or(0) >= 2
            && value["source_ref"].as_str().is_some()
        {
            assert_eq!(
                value["item_ref"], expected_item,
                "slot reported a different granted source"
            );
            return current;
        }
        assert!(
            Instant::now() < deadline,
            "slot failed to reach Playing before bounded deadline"
        );
        thread::sleep(Duration::from_millis(250));
    }
}

fn renew_due(
    base: &str,
    token: &str,
    latest: &mut Value,
    slot_natives: &mut [Value],
    next_renew: &mut Instant,
    sequence: &mut u32,
) {
    if Instant::now() < *next_renew {
        return;
    }
    let current = snapshot(base, token, latest, "bounded_renew_status");
    let Some(slot_id) = current["slots"]
        .as_array()
        .unwrap()
        .iter()
        .find_map(|value| {
            let state = value["state"].as_str().unwrap_or("");
            let id = value["slot_id"].as_u64()?;
            matches!(state, "starting" | "preparing" | "playing" | "stalled").then_some(id)
        })
    else {
        *next_renew = Instant::now() + Duration::from_secs(18);
        return;
    };
    let context = context_for_slot(&current, slot_id, &slot_natives[slot_id as usize]);
    let response = control(
        base,
        token,
        &context,
        &format!("renew_{}", *sequence),
        json!({"name":"renew"}),
        None,
    );
    *sequence += 1;
    *latest = response["context"].clone();
    slot_natives[slot_id as usize] = latest["native_expected"].clone();
    *next_renew = Instant::now() + Duration::from_secs(18);
}

fn wait_all_slots(
    base: &str,
    token: &str,
    latest: &mut Value,
    slot_natives: &mut [Value],
    expected: &[String],
    next_renew: &mut Instant,
    renew_sequence: &mut u32,
    deadline: Instant,
) -> Value {
    loop {
        renew_due(
            base,
            token,
            latest,
            slot_natives,
            next_renew,
            renew_sequence,
        );
        let current = snapshot(base, token, latest, "status_wait_grid");
        let ready = expected.iter().enumerate().all(|(index, item)| {
            let value = slot(&current, index as u64);
            value["state"] == "playing"
                && value["frames"].as_u64().unwrap_or(0) >= 10
                && value["item_ref"] == item.as_str()
                && value["source_ref"].as_str().is_some()
        });
        if ready {
            return current;
        }
        assert!(
            Instant::now() < deadline,
            "all nine slots did not decode ten owned frames"
        );
        thread::sleep(Duration::from_millis(250));
    }
}

fn playlist_snapshot(base: &str, playlist_path: &str) -> Option<(u64, Vec<String>)> {
    playlist_snapshot_checked(base, playlist_path).ok()
}
fn playlist_snapshot_checked(
    base: &str,
    playlist_path: &str,
) -> Result<(u64, Vec<String>), FixtureReadFailure> {
    playlist_snapshot_checked_with_timeout(base, playlist_path, Duration::from_secs(8))
}
fn playlist_snapshot_checked_with_timeout(
    base: &str,
    playlist_path: &str,
    timeout: Duration,
) -> Result<(u64, Vec<String>), FixtureReadFailure> {
    playlist_snapshot_attempt_with_timeout(base, playlist_path, timeout, None)
}

fn playlist_snapshot_attempt_with_timeout(
    base: &str,
    playlist_path: &str,
    timeout: Duration,
    attempt: Option<media_attempt::Marker>,
) -> Result<(u64, Vec<String>), FixtureReadFailure> {
    let playlist_url =
        if playlist_path.starts_with("http://") || playlist_path.starts_with("https://") {
            reqwest::Url::parse(playlist_path).map_err(|_| {
                FixtureReadFailure::without_body(FixtureReadStage::PlaylistUrl, None, None)
            })?
        } else {
            reqwest::Url::parse(&format!("{base}{playlist_path}")).map_err(|_| {
                FixtureReadFailure::without_body(FixtureReadStage::PlaylistUrl, None, None)
            })?
        };
    let expected = reqwest::Url::parse(base)
        .map_err(|_| FixtureReadFailure::without_body(FixtureReadStage::BaseUrl, None, None))?;
    assert_eq!(
        (
            playlist_url.scheme(),
            playlist_url.host_str(),
            playlist_url.port_or_known_default()
        ),
        (
            expected.scheme(),
            expected.host_str(),
            expected.port_or_known_default()
        ),
        "HLS playlist escaped the selected API/media listener origin"
    );
    assert_eq!(
        playlist_url.scheme(),
        "https",
        "HLS media must use the selected HTTPS listener"
    );
    // Only the existing private playlist seed path carries a diagnostic marker.
    // The exact origin/HTTPS checks above remain fatal and precede the request.
    let attempt = attempt.filter(|_| {
        playlist_url.path().starts_with("/multiview/v1/media/")
            && playlist_url.path().ends_with("/index.m3u8")
            && playlist_url.query().is_none()
    });
    let (code, playlist) =
        get_url_checked_with_attempt(playlist_url.as_str(), None, 1024 * 1024, timeout, attempt)?;
    parse_playlist_snapshot_response(&playlist_url, &expected, code, &playlist)
}

// The counter is never reset between owned fixtures; exhaustion fails before a
// request, rather than wrapping to a marker whose terminal event could be old.
static NEXT_SEED_ATTEMPT: AtomicU64 = AtomicU64::new(1);
fn next_seed_attempt(counter: &AtomicU64) -> Option<media_attempt::Marker> {
    counter
        .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |value| {
            value.checked_add(1)
        })
        .ok()
        .and_then(media_attempt::Marker::new)
}

#[derive(Clone, Copy, Debug)]
struct SeedRefusal {
    marker: media_attempt::Marker,
    site: media_attempt::Site,
    stderr_bytes: usize,
    stderr_sha256: [u8; 32],
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SeedEvaluationOutcome {
    Accepted,
    IneligibleTransport,
    DeadlineElapsed,
    StartUnavailable,
    SnapshotUnavailable,
    SnapshotChanged,
    MissingRecord,
    IncompleteRecord,
    MalformedRecord,
    DuplicateMarker,
    WrongKind,
    WrongTransport,
}
impl SeedEvaluationOutcome {
    fn code(self) -> &'static str {
        match self {
            Self::Accepted => "accepted",
            Self::IneligibleTransport => "ineligible_transport",
            Self::DeadlineElapsed => "deadline_elapsed",
            Self::StartUnavailable => "start_unavailable",
            Self::SnapshotUnavailable => "snapshot_unavailable",
            Self::SnapshotChanged => "snapshot_changed",
            Self::MissingRecord => "missing_record",
            Self::IncompleteRecord => "incomplete_record",
            Self::MalformedRecord => "malformed_record",
            Self::DuplicateMarker => "duplicate_marker",
            Self::WrongKind => "wrong_kind",
            Self::WrongTransport => "wrong_transport",
        }
    }
}
#[derive(Clone, Copy, Debug)]
struct SeedEvaluation {
    marker: media_attempt::Marker,
    outcome: SeedEvaluationOutcome,
    // Fingerprint only the actual bounded snapshot checked once for this attempt.
    // Missing/unsafe files have no fingerprint; diagnostics never reread them.
    snapshot: Option<(usize, [u8; 32])>,
}
fn seed_site(site: media_attempt::Site) -> (&'static str, usize) {
    match site {
        media_attempt::Site::BodyFirst => ("body_first", 0),
        media_attempt::Site::BodyLater => ("body_later", 1),
        media_attempt::Site::Supervisor => ("supervisor", 2),
    }
}
#[derive(Clone, Copy, Default)]
struct SeedRefusalSummary {
    counts: [u64; 3],
    last: Option<SeedRefusal>,
}
impl SeedRefusalSummary {
    fn record(&mut self, proof: SeedRefusal) {
        let index = seed_site(proof.site).1;
        self.counts[index] = self.counts[index].saturating_add(1);
        self.last = Some(proof);
    }
}
#[derive(Clone, Copy)]
struct SeedCallSummary {
    summary: SeedRefusalSummary,
    completed: bool,
}
fn retain_seed_summary(summary: SeedRefusalSummary, completed: bool) {
    SEED_REFUSAL_SUMMARIES.with(|rows| {
        let mut rows = rows.borrow_mut();
        let slot = rows
            .iter_mut()
            .find(|row| row.is_none())
            .expect("only the three existing seed calls may retain summaries");
        *slot = Some(SeedCallSummary { summary, completed });
    });
}
fn seed_refusal_receipt() -> Value {
    SEED_REFUSAL_SUMMARIES.with(|rows| {
        Value::Array(rows.borrow().iter().enumerate().map(|(index, row)| {
            let call = row.expect("all three seed summaries required");
            let last = call.summary.last.map(|proof| json!({
                "site":seed_site(proof.site).0,"marker":proof.marker.get(),
                "stderr_bytes":proof.stderr_bytes,
                "stderr_sha256":proof.stderr_sha256.iter().map(|byte|format!("{byte:02x}")).collect::<String>(),
                "status":null,"response_bytes":null,
            }));
            json!({"seed":(["grid","main","replacement"][index]),
                "body_first_count":call.summary.counts[0],"body_later_count":call.summary.counts[1],
                "supervisor_count":call.summary.counts[2],"last":last,"completed":call.completed})
        }).collect())
    })
}
impl std::fmt::Display for SeedRefusalSummary {
    fn fmt(&self, out: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let Some(proof) = self.last else {
            return Ok(());
        };
        write!(out, "private_media_seed_refusal version=1 body_first_count={} body_later_count={} supervisor_count={} last_site={} last_marker={} status=None response_bytes=None checked_stderr_bytes={} checked_stderr_sha256=",
            self.counts[0], self.counts[1], self.counts[2], seed_site(proof.site).0,
            proof.marker.get(), proof.stderr_bytes)?;
        for byte in proof.stderr_sha256 {
            write!(out, "{byte:02x}")?;
        }
        Ok(())
    }
}
#[derive(Clone, Copy)]
struct StderrStart {
    dev: u64,
    ino: u64,
    length: usize,
    prefix_sha256: [u8; 32],
}
// Read exactly the registered owned file, with the same 64KiB, owner, regular,
// single-link, mode, no-follow and stable-identity checks as failure capture.
// Unlike the display redactor, classification consumes only exact closed lines.
fn owned_stderr_snapshot() -> Option<(u64, u64, Vec<u8>)> {
    let root = FAILURE_STDERR_ROOT
        .try_with(|slot| slot.try_borrow().ok()?.clone())
        .ok()??;
    let path = root.join("server.stderr");
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(&path)
        .ok()?;
    let before = file.metadata().ok()?;
    if !before.is_file()
        || before.nlink() != 1
        || before.uid() != unsafe { libc::geteuid() }
        || before.mode() & 0o077 != 0
        || before.len() > 65536
    {
        return None;
    }
    let mut bytes = Vec::new();
    (&file).take(65537).read_to_end(&mut bytes).ok()?;
    let after = file.metadata().ok()?;
    let identity = |m: &fs::Metadata| {
        (
            m.dev(),
            m.ino(),
            m.len(),
            m.mode(),
            m.nlink(),
            m.uid(),
            m.mtime(),
            m.mtime_nsec(),
            m.ctime(),
            m.ctime_nsec(),
        )
    };
    if bytes.len() > 65536
        || bytes.len() as u64 != after.len()
        || identity(&before) != identity(&after)
        || identity(&after) != identity(&fs::symlink_metadata(&path).ok()?)
    {
        return None;
    }
    Some((after.dev(), after.ino(), bytes))
}
impl StderrStart {
    fn capture() -> Option<Self> {
        let (dev, ino, bytes) = owned_stderr_snapshot()?;
        Self::from_snapshot(dev, ino, &bytes)
    }
    fn from_snapshot(dev: u64, ino: u64, bytes: &[u8]) -> Option<Self> {
        if bytes.len() > 65536 || (!bytes.is_empty() && bytes.last() != Some(&b'\n')) {
            return None;
        }
        Some(Self {
            dev,
            ino,
            length: bytes.len(),
            prefix_sha256: Sha256::digest(bytes).into(),
        })
    }
    fn appended<'a>(&self, dev: u64, ino: u64, bytes: &'a [u8]) -> Option<&'a [u8]> {
        if (dev, ino) != (self.dev, self.ino) || bytes.len() > 65536 {
            return None;
        }
        let prefix = bytes.get(..self.length)?;
        let digest: [u8; 32] = Sha256::digest(prefix).into();
        if digest != self.prefix_sha256 {
            return None;
        }
        Some(&bytes[self.length..])
    }
}
fn matching_seed_refusal(
    bytes: &[u8],
    marker: media_attempt::Marker,
) -> Result<media_attempt::Site, SeedEvaluationOutcome> {
    if bytes.is_empty() {
        return Err(SeedEvaluationOutcome::MissingRecord);
    }
    // A partial line, malformed event or ambiguous marker never qualifies.
    if bytes.last() != Some(&b'\n') {
        return Err(SeedEvaluationOutcome::IncompleteRecord);
    }
    let mut matching = None;
    for line in bytes[..bytes.len() - 1].split(|byte| *byte == b'\n') {
        if !line
            .windows(b"private_media_attempt".len())
            .any(|window| window == b"private_media_attempt")
        {
            continue;
        }
        let event = std::str::from_utf8(line)
            .ok()
            .and_then(media_attempt::Terminal::parse)
            .ok_or(SeedEvaluationOutcome::MalformedRecord)?;
        if event.marker == marker {
            if matching.is_some() {
                return Err(SeedEvaluationOutcome::DuplicateMarker);
            }
            matching = Some(event);
        }
    }
    let event = matching.ok_or(SeedEvaluationOutcome::MissingRecord)?;
    if event.kind != media_attempt::Kind::TemporaryBusy {
        return Err(SeedEvaluationOutcome::WrongKind);
    }
    if event.transport != media_attempt::Transport::Tls {
        return Err(SeedEvaluationOutcome::WrongTransport);
    }
    // These are the exhaustive known refusal sites of this immutable custody.
    // A yielded body chunk is not an application Response or a socket-write ACK.
    match event.site {
        media_attempt::Site::BodyFirst
        | media_attempt::Site::BodyLater
        | media_attempt::Site::Supervisor => Ok(event.site),
    }
}
fn is_seed_send_failure(failure: &FixtureReadFailure) -> bool {
    failure.stage == FixtureReadStage::HttpSend
        && failure.status.is_none()
        && failure.response_bytes.is_none()
        && failure.response_sha256.is_none()
        && failure.transport_error.is_some_and(|flags| {
            flags.request
                && !flags.timeout
                && !flags.connect
                && !flags.builder
                && !flags.body
                && !flags.decode
        })
}
fn classify_seed_refusal_evidence(
    mut failure: FixtureReadFailure,
    marker: media_attempt::Marker,
    start: StderrStart,
    snapshot: (u64, u64, &[u8]),
    now: Instant,
    deadline: Instant,
) -> FixtureReadFailure {
    let (dev, ino, bytes) = snapshot;
    let fingerprint =
        (bytes.len() <= 65536).then(|| (bytes.len(), <[u8; 32]>::from(Sha256::digest(bytes))));
    let matched = if !is_seed_send_failure(&failure) {
        Err(SeedEvaluationOutcome::IneligibleTransport)
    } else if now >= deadline {
        Err(SeedEvaluationOutcome::DeadlineElapsed)
    } else if fingerprint.is_none() {
        Err(SeedEvaluationOutcome::SnapshotUnavailable)
    } else {
        start
            .appended(dev, ino, bytes)
            .ok_or(SeedEvaluationOutcome::SnapshotChanged)
            .and_then(|tail| matching_seed_refusal(tail, marker))
    };
    let outcome = match matched {
        Ok(site) => {
            let (stderr_bytes, stderr_sha256) = fingerprint.expect("bounded checked snapshot");
            failure.temporary_busy = true;
            failure.seed_refusal = Some(SeedRefusal {
                marker,
                site,
                stderr_bytes,
                stderr_sha256,
            });
            SeedEvaluationOutcome::Accepted
        }
        Err(outcome) => outcome,
    };
    failure.seed_evaluation = Some(SeedEvaluation {
        marker,
        outcome,
        snapshot: fingerprint,
    });
    failure
}
fn classify_seed_refusal(
    mut failure: FixtureReadFailure,
    marker: media_attempt::Marker,
    start: Option<StderrStart>,
    deadline: Instant,
) -> FixtureReadFailure {
    if !is_seed_send_failure(&failure) {
        return failure;
    }
    let outcome = if Instant::now() >= deadline {
        SeedEvaluationOutcome::DeadlineElapsed
    } else if let Some(start) = start {
        // Exactly one immediate bounded read. Never wait for a terminal logger.
        if let Some((dev, ino, bytes)) = owned_stderr_snapshot() {
            return classify_seed_refusal_evidence(
                failure,
                marker,
                start,
                (dev, ino, &bytes),
                Instant::now(),
                deadline,
            );
        }
        SeedEvaluationOutcome::SnapshotUnavailable
    } else {
        SeedEvaluationOutcome::StartUnavailable
    };
    failure.seed_evaluation = Some(SeedEvaluation {
        marker,
        outcome,
        snapshot: None,
    });
    failure
}

fn seed_busy_retry_delay(
    failure: &FixtureReadFailure,
    now: Instant,
    deadline: Instant,
) -> Option<Duration> {
    let remaining = deadline.checked_duration_since(now)?;
    (failure.temporary_busy && !remaining.is_zero())
        .then_some(remaining.min(Duration::from_millis(250)))
}

fn seed_request_timeout(now: Instant, deadline: Instant) -> Option<Duration> {
    let remaining = deadline.checked_duration_since(now)?;
    (!remaining.is_zero()).then_some(remaining.min(Duration::from_secs(8)))
}

fn seed_deadline_failure(last_busy: Option<FixtureReadFailure>) -> FixtureReadFailure {
    last_busy.unwrap_or_else(|| {
        FixtureReadFailure::without_body(FixtureReadStage::HttpDeadline, None, None)
    })
}

fn playlist_snapshot_seed_until(
    base: &str,
    playlist_path: &str,
    deadline: Instant,
) -> Result<(u64, Vec<String>), FixtureReadFailure> {
    let mut last_busy = None;
    let mut summary = SeedRefusalSummary::default();
    let result = loop {
        let now = Instant::now();
        let Some(_) = seed_request_timeout(now, deadline) else {
            break Err(seed_deadline_failure(last_busy));
        };
        let marker =
            next_seed_attempt(&NEXT_SEED_ATTEMPT).expect("private media attempt counter exhausted");
        let stderr_start = StderrStart::capture();
        // Snapshot work consumes this SAME deadline; do not restore its time.
        let Some(timeout) = seed_request_timeout(Instant::now(), deadline) else {
            break Err(seed_deadline_failure(last_busy));
        };
        match playlist_snapshot_attempt_with_timeout(base, playlist_path, timeout, Some(marker)) {
            Ok(snapshot) => break Ok(snapshot),
            Err(failure) => {
                let failure = classify_seed_refusal(failure, marker, stderr_start, deadline);
                if let Some(proof) = failure.seed_refusal {
                    summary.record(proof);
                }
                let Some(delay) = seed_busy_retry_delay(&failure, Instant::now(), deadline) else {
                    break Err(failure);
                };
                last_busy = Some(failure);
                thread::sleep(delay);
            }
        }
    };
    // Persist classifications (not necessarily retries) even when libtest hides successful stderr.
    retain_seed_summary(summary, result.is_ok());
    // One closed summary per seed call, only after its requests have completed.
    // Preserve the original status=None: this is not a fabricated HTTP 503.
    if summary.last.is_some() {
        eprintln!("{summary} completed={}", result.is_ok());
    }
    result
}
fn parse_playlist_snapshot_response(
    playlist_url: &reqwest::Url,
    expected: &reqwest::Url,
    code: u16,
    playlist: &[u8],
) -> Result<(u64, Vec<String>), FixtureReadFailure> {
    let failure = |stage| FixtureReadFailure::response(stage, code, playlist);
    if code != 200 {
        return Err(failure(FixtureReadStage::HttpStatus));
    }
    let text = std::str::from_utf8(playlist).map_err(|_| failure(FixtureReadStage::Utf8))?;
    let sequence = text
        .lines()
        .find_map(|line| line.strip_prefix("#EXT-X-MEDIA-SEQUENCE:"))
        .ok_or_else(|| failure(FixtureReadStage::MissingSequence))?
        .parse()
        .map_err(|_| failure(FixtureReadStage::InvalidSequence))?;
    let segments = text
        .lines()
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .map(|line| {
            playlist_url
                .join(line)
                .map(|url| url.to_string())
                .map_err(|_| failure(FixtureReadStage::SegmentJoin))
        })
        .collect::<Result<Vec<_>, _>>()?;
    for url in &segments {
        let parsed = reqwest::Url::parse(url).map_err(|_| failure(FixtureReadStage::SegmentUrl))?;
        assert_eq!(
            (
                parsed.scheme(),
                parsed.host_str(),
                parsed.port_or_known_default()
            ),
            (
                expected.scheme(),
                expected.host_str(),
                expected.port_or_known_default()
            ),
            "HLS segment escaped the selected API/media listener origin"
        );
    }
    Ok((sequence, segments))
}

#[test]
fn playlist_failure_evidence_preserves_http_parse_and_fatal_origin_contracts() {
    let marker = media_attempt::Marker::new(41).unwrap();
    let event = media_attempt::Terminal {
        marker,
        site: media_attempt::Site::BodyFirst,
        kind: media_attempt::Kind::TemporaryBusy,
        transport: media_attempt::Transport::Tls,
    };
    let line = format!("{event}\n");
    assert!(matching_seed_refusal(line.as_bytes(), marker).is_ok());
    for bytes in [
        Vec::new(),
        line.trim_end().as_bytes().to_vec(),
        format!("{line}{line}").into_bytes(),
        line.replace("marker=41", "marker=42").into_bytes(),
        line.replace("marker=41", "marker=041").into_bytes(),
        line.replace("reason=temporary_busy", "reason=secret-canary")
            .into_bytes(),
        line.replace(" terminal=closed", " extra=true terminal=closed")
            .into_bytes(),
        line.replace(" terminal=closed", " terminal=open")
            .into_bytes(),
        line.replace("site=body_first", "site=unknown").into_bytes(),
        line.replace("reason=temporary_busy", "reason=unavailable")
            .into_bytes(),
        line.replace("reason=temporary_busy", "reason=denied")
            .into_bytes(),
        line.replace("transport=tls", "transport=http").into_bytes(),
    ] {
        assert!(matching_seed_refusal(&bytes, marker).is_err());
    }
    let old = b"previous complete event\n";
    let start = StderrStart::from_snapshot(7, 8, old).unwrap();
    assert!(StderrStart::from_snapshot(7, 8, b"incomplete old tail").is_none());
    assert!(StderrStart::from_snapshot(7, 8, &vec![0; 65537]).is_none());
    let stale = StderrStart::from_snapshot(7, 8, line.as_bytes()).unwrap();
    assert!(matching_seed_refusal(stale.appended(7, 8, line.as_bytes()).unwrap(), marker).is_err());
    assert!(matching_seed_refusal(
        format!("{line}private_media_attempt broken\n").as_bytes(),
        marker
    )
    .is_err());
    assert!(matching_seed_refusal(format!("{line} {line}").as_bytes(), marker).is_err());
    let unrelated = media_attempt::Terminal {
        marker: media_attempt::Marker::new(42).unwrap(),
        ..event
    };
    assert!(matching_seed_refusal(format!("{unrelated}\n{line}").as_bytes(), marker).is_ok());
    let bytes = [old.as_slice(), line.as_bytes()].concat();
    let now = Instant::now();
    let deadline = now + Duration::from_millis(100);
    let send = FixtureReadFailure {
        stage: FixtureReadStage::HttpSend,
        status: None,
        response_bytes: None,
        response_sha256: None,
        temporary_busy: false,
        transport_error: Some(TransportErrorFlags {
            request: true,
            timeout: false,
            connect: false,
            builder: false,
            body: false,
            decode: false,
        }),
        elapsed_ms: Some(2),
        seed_refusal: None,
        seed_evaluation: None,
    };
    let recognized =
        classify_seed_refusal_evidence(send, marker, start, (7, 8, &bytes), now, deadline);
    assert!(recognized.temporary_busy && recognized.seed_refusal.is_some());
    assert_eq!(recognized.status, None);
    assert_eq!(recognized.response_bytes, None);
    assert_eq!(recognized.response_sha256, None);
    assert_eq!(recognized.elapsed_ms, Some(2));
    assert!(recognized.transport_error.unwrap().request);
    assert_eq!(
        seed_busy_retry_delay(&recognized, now, deadline),
        Some(Duration::from_millis(100))
    );
    let retained = seed_deadline_failure(Some(recognized));
    assert!(retained.seed_refusal.is_some() && retained.status.is_none());
    for (dev, ino, snapshot, at) in [
        (7, 9, bytes.as_slice(), now),
        (9, 8, bytes.as_slice(), now),
        (7, 8, old.as_slice(), now),
        (7, 8, bytes.as_slice(), deadline),
    ] {
        assert!(
            !classify_seed_refusal_evidence(
                send,
                marker,
                start,
                (dev, ino, snapshot),
                at,
                deadline
            )
            .temporary_busy
        );
    }
    let mut rewritten = bytes.clone();
    rewritten[0] = b'X';
    assert!(start.appended(7, 8, &rewritten).is_none());
    assert!(start.appended(7, 8, &vec![0; 65537]).is_none());
    for stage in [
        FixtureReadStage::HttpBody,
        FixtureReadStage::HttpStatus,
        FixtureReadStage::HttpDeadline,
    ] {
        let mut failure = send;
        failure.stage = stage;
        assert!(
            !classify_seed_refusal_evidence(failure, marker, start, (7, 8, &bytes), now, deadline)
                .temporary_busy
        );
    }
    for field in 0..6 {
        let mut failure = send;
        let flags = failure.transport_error.as_mut().unwrap();
        match field {
            0 => flags.timeout = true,
            1 => flags.connect = true,
            2 => flags.builder = true,
            3 => flags.body = true,
            4 => flags.decode = true,
            _ => flags.request = false,
        }
        assert!(
            !classify_seed_refusal_evidence(failure, marker, start, (7, 8, &bytes), now, deadline)
                .temporary_busy
        );
    }
    let mut got_headers = send;
    got_headers.status = Some(200);
    assert!(!is_seed_send_failure(&got_headers));
    let mut got_bytes = send;
    got_bytes.response_bytes = Some(0);
    assert!(!is_seed_send_failure(&got_bytes));
    // All known sites describe the same refusal, but only before the client
    // obtains a Response. Server body offset is not an application/wire boundary.
    let mut summary = SeedRefusalSummary::default();
    for site in [
        media_attempt::Site::BodyFirst,
        media_attempt::Site::BodyLater,
        media_attempt::Site::Supervisor,
    ] {
        let line = format!("{}\n", media_attempt::Terminal { site, ..event });
        let snapshot = [old.as_slice(), line.as_bytes()].concat();
        let accepted =
            classify_seed_refusal_evidence(send, marker, start, (7, 8, &snapshot), now, deadline);
        assert!(accepted.temporary_busy);
        assert_eq!(accepted.seed_refusal.unwrap().site, site);
        assert_eq!(
            accepted.seed_evaluation.unwrap().outcome,
            SeedEvaluationOutcome::Accepted
        );
        assert_eq!(accepted.status, None);
        assert_eq!(accepted.response_bytes, None);
        assert_eq!(accepted.response_sha256, None);
        assert!(accepted.transport_error.unwrap().request);
        summary.record(accepted.seed_refusal.unwrap());
        for field in 0..12 {
            let mut fatal = send;
            match field {
                0 => fatal.stage = FixtureReadStage::HttpBody,
                1 => {
                    fatal.stage = FixtureReadStage::HttpBody;
                    fatal.status = Some(200);
                    fatal.response_bytes = Some(0);
                }
                2 => fatal.status = Some(200),
                3 => fatal.response_bytes = Some(0),
                4 => fatal.response_bytes = Some(1),
                5 => fatal.response_sha256 = Some([0; 32]),
                6 => fatal.transport_error.as_mut().unwrap().timeout = true,
                7 => fatal.transport_error.as_mut().unwrap().connect = true,
                8 => fatal.transport_error.as_mut().unwrap().builder = true,
                9 => fatal.transport_error.as_mut().unwrap().body = true,
                10 => fatal.transport_error.as_mut().unwrap().decode = true,
                _ => fatal.transport_error.as_mut().unwrap().request = false,
            }
            let rejected = classify_seed_refusal_evidence(
                fatal,
                marker,
                start,
                (7, 8, &snapshot),
                now,
                deadline,
            );
            assert!(!rejected.temporary_busy);
            assert!(rejected.seed_refusal.is_none());
            assert_eq!(
                rejected.seed_evaluation.unwrap().outcome,
                SeedEvaluationOutcome::IneligibleTransport
            );
            assert!(seed_busy_retry_delay(&rejected, now, deadline).is_none());
        }
        let expired = classify_seed_refusal_evidence(
            send,
            marker,
            start,
            (7, 8, &snapshot),
            deadline,
            deadline,
        );
        assert!(!expired.temporary_busy);
        assert_eq!(
            expired.seed_evaluation.unwrap().outcome,
            SeedEvaluationOutcome::DeadlineElapsed
        );
    }
    assert_eq!(summary.counts, [1, 1, 1]);
    let printed = summary.to_string();
    assert!(printed.contains("body_first_count=1 body_later_count=1 supervisor_count=1"));
    assert!(printed.contains("last_site=supervisor last_marker=41 status=None response_bytes=None"));
    SEED_REFUSAL_SUMMARIES.with(|rows| *rows.borrow_mut() = [None; 3]);
    retain_seed_summary(SeedRefusalSummary::default(), true);
    retain_seed_summary(summary, true);
    retain_seed_summary(SeedRefusalSummary::default(), false);
    let retained = seed_refusal_receipt();
    let last_line = format!(
        "{}\n",
        media_attempt::Terminal {
            site: media_attempt::Site::Supervisor,
            ..event
        }
    );
    let last_snapshot = [old.as_slice(), last_line.as_bytes()].concat();
    assert_eq!(retained.as_array().unwrap().len(), 3);
    assert_eq!(retained[0]["seed"], "grid");
    assert_eq!(retained[0]["body_first_count"], 0);
    assert_eq!(retained[0]["body_later_count"], 0);
    assert_eq!(retained[0]["supervisor_count"], 0);
    assert!(retained[0]["last"].is_null());
    assert_eq!(retained[0]["completed"], true);
    assert_eq!(retained[1]["seed"], "main");
    assert_eq!(retained[1]["body_first_count"], 1);
    assert_eq!(retained[1]["body_later_count"], 1);
    assert_eq!(retained[1]["supervisor_count"], 1);
    assert_eq!(retained[1]["last"]["site"], "supervisor");
    assert_eq!(retained[1]["last"]["marker"], 41);
    assert_eq!(retained[1]["last"]["stderr_bytes"], last_snapshot.len());
    assert_eq!(
        retained[1]["last"]["stderr_sha256"],
        format!("{:x}", Sha256::digest(&last_snapshot))
    );
    assert!(retained[1]["last"]["status"].is_null());
    assert!(retained[1]["last"]["response_bytes"].is_null());
    assert_eq!(retained[2]["seed"], "replacement");
    assert_eq!(retained[2]["completed"], false);
    assert!(std::panic::catch_unwind(|| retain_seed_summary(summary, true)).is_err());
    assert_eq!(seed_refusal_receipt(), retained);
    SEED_REFUSAL_SUMMARIES.with(|rows| *rows.borrow_mut() = [None; 3]);
    assert!(std::panic::catch_unwind(seed_refusal_receipt).is_err());
    let checked_hash: [u8; 32] = Sha256::digest(&bytes).into();
    for (tail, outcome) in [
        (Vec::new(), SeedEvaluationOutcome::MissingRecord),
        (
            line.trim_end().as_bytes().to_vec(),
            SeedEvaluationOutcome::IncompleteRecord,
        ),
        (
            format!("{line}{line}").into_bytes(),
            SeedEvaluationOutcome::DuplicateMarker,
        ),
        (
            line.replace("reason=temporary_busy", "secret-canary")
                .into_bytes(),
            SeedEvaluationOutcome::MalformedRecord,
        ),
        (
            line.replace("reason=temporary_busy", "reason=denied")
                .into_bytes(),
            SeedEvaluationOutcome::WrongKind,
        ),
        (
            line.replace("transport=tls", "transport=http").into_bytes(),
            SeedEvaluationOutcome::WrongTransport,
        ),
    ] {
        let snapshot = [old.as_slice(), &tail].concat();
        let rejected =
            classify_seed_refusal_evidence(send, marker, start, (7, 8, &snapshot), now, deadline);
        assert_eq!(rejected.seed_evaluation.unwrap().outcome, outcome);
        assert_eq!(
            rejected.seed_evaluation.unwrap().snapshot,
            Some((snapshot.len(), Sha256::digest(&snapshot).into()))
        );
        assert!(!rejected.temporary_busy);
        assert!(!rejected.to_string().contains("secret-canary"));
    }
    assert_eq!(
        recognized.seed_evaluation.unwrap().snapshot,
        Some((bytes.len(), checked_hash))
    );
    let counter = AtomicU64::new(1);
    assert_eq!(next_seed_attempt(&counter).unwrap().get(), 1);
    assert_eq!(next_seed_attempt(&counter).unwrap().get(), 2);
    counter.store(u64::MAX - 1, Ordering::Relaxed);
    assert_eq!(next_seed_attempt(&counter).unwrap().get(), u64::MAX - 1);
    assert!(next_seed_attempt(&counter).is_none());
    assert!(next_seed_attempt(&counter).is_none());

    let base = reqwest::Url::parse("https://fixture.invalid").unwrap();
    let path = base.join("/owned/index.m3u8").unwrap();
    let now = Instant::now();
    let deadline = now + Duration::from_millis(100);
    let busy_body = br#"{"error":"temporary_busy","version":1}"#;
    let busy = FixtureReadFailure::response(FixtureReadStage::HttpStatus, 503, busy_body);
    assert!(busy.temporary_busy);
    assert!(!FixtureReadFailure::response(FixtureReadStage::Utf8, 503, busy_body).temporary_busy);
    let retained_busy = seed_deadline_failure(Some(busy));
    assert_eq!(retained_busy.stage, FixtureReadStage::HttpStatus);
    assert_eq!(retained_busy.status, Some(503));
    assert_eq!(retained_busy.response_bytes, Some(busy_body.len()));
    assert_eq!(
        retained_busy.response_sha256,
        Some(Sha256::digest(busy_body).into())
    );
    let no_attempt = seed_deadline_failure(None);
    assert_eq!(no_attempt.stage, FixtureReadStage::HttpDeadline);
    assert_eq!(no_attempt.status, None);
    assert_eq!(
        seed_busy_retry_delay(&busy, now, deadline),
        Some(Duration::from_millis(100))
    );
    assert_eq!(seed_busy_retry_delay(&busy, deadline, deadline), None);
    assert_eq!(
        seed_request_timeout(now, deadline),
        Some(Duration::from_millis(100))
    );
    assert_eq!(seed_request_timeout(deadline, deadline), None);
    assert_eq!(
        seed_request_timeout(now, now + Duration::from_secs(20)),
        Some(Duration::from_secs(8))
    );
    for (status, bytes) in [
        (200, busy_body.as_slice()),
        (401, busy_body.as_slice()),
        (
            503,
            br#"{"error":"backend_unavailable","version":1}"#.as_slice(),
        ),
        (
            503,
            br#"{"error":"temporary_busy","version":1,"extra":true}"#.as_slice(),
        ),
        (503, br#"{"error":"temporary_busy","version":2}"#.as_slice()),
        (
            503,
            br#"{ "error":"temporary_busy","version":1}"#.as_slice(),
        ),
    ] {
        let failure = FixtureReadFailure::response(FixtureReadStage::HttpStatus, status, bytes);
        assert!(!failure.temporary_busy);
        assert_eq!(seed_busy_retry_delay(&failure, now, deadline), None);
    }
    for (status, bytes, stage) in [
        (503, b"closed body".as_slice(), FixtureReadStage::HttpStatus),
        (200, b"\xff".as_slice(), FixtureReadStage::Utf8),
        (
            200,
            b"#EXTM3U\n".as_slice(),
            FixtureReadStage::MissingSequence,
        ),
        (
            200,
            b"#EXT-X-MEDIA-SEQUENCE:bad\n".as_slice(),
            FixtureReadStage::InvalidSequence,
        ),
        (
            200,
            b"#EXT-X-MEDIA-SEQUENCE:5\nhttp://[invalid\n".as_slice(),
            FixtureReadStage::SegmentJoin,
        ),
    ] {
        let error = parse_playlist_snapshot_response(&path, &base, status, bytes).unwrap_err();
        assert_eq!(error.stage, stage);
        assert_eq!(error.status, Some(status));
        assert_eq!(error.response_bytes, Some(bytes.len()));
        assert_eq!(error.response_sha256, Some(Sha256::digest(bytes).into()));
        let record = error.to_string();
        assert!(record.len() < 256 && !record.contains("closed body") && !record.contains("://"));
    }
    let good = b"#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:5\nsegment-000005.ts\n";
    assert_eq!(
        parse_playlist_snapshot_response(&path, &base, 200, good).unwrap(),
        (
            5,
            vec!["https://fixture.invalid/owned/segment-000005.ts".to_owned()]
        )
    );
    // Preserve the former parser's empty-list behavior, rather than inventing a retry oracle.
    assert!(
        parse_playlist_snapshot_response(&path, &base, 200, b"#EXT-X-MEDIA-SEQUENCE:5\n")
            .unwrap()
            .1
            .is_empty()
    );
    for stage in [
        FixtureReadStage::HttpSend,
        FixtureReadStage::HttpBody,
        FixtureReadStage::HttpDeadline,
    ] {
        let error = FixtureReadFailure::without_body(stage, None, None);
        let record = error.to_string();
        assert!(record.contains(stage.code()) && record.ends_with("response_sha256=none"));
    }
    // Construct a builder error locally so this privacy check never initializes
    // the shared fixture client or performs network/TLS work.
    let reqwest_error = reqwest::Client::builder()
        .user_agent("transport-secret-canary\n")
        .build()
        .unwrap_err()
        .with_url(
            reqwest::Url::parse(
                "https://transport-secret-canary:secret@example.invalid/path?token=transport-secret-canary",
            )
            .unwrap(),
        );
    let error = FixtureReadFailure::transport(
        FixtureReadStage::HttpSend,
        &reqwest_error,
        Duration::from_millis(7),
        None,
        None,
    );
    let flags = error.transport_error.expect("builder classification");
    assert!(flags.builder);
    assert_eq!(error.elapsed_ms, Some(7));
    let record = error.to_string();
    assert!(record.contains("transport_builder=true"));
    assert!(!record.contains("transport-secret-canary"));
    assert!(!record.contains("http://") && !record.contains("https://"));
    let escaped = std::panic::catch_unwind(|| {
        parse_playlist_snapshot_response(
            &path,
            &base,
            200,
            b"#EXT-X-MEDIA-SEQUENCE:5\nhttps://other.invalid/secret\n",
        )
    })
    .unwrap_err();
    let message = escaped.downcast_ref::<String>().unwrap();
    assert!(message.contains("HLS segment escaped the selected API/media listener origin"));
    for (base, path, expected) in [
        (
            "https://fixture.invalid",
            "https://other.invalid/list",
            "HLS playlist escaped",
        ),
        (
            "http://fixture.invalid",
            "/list",
            "HLS media must use the selected HTTPS listener",
        ),
    ] {
        let escaped =
            std::panic::catch_unwind(|| playlist_snapshot_checked(base, path)).unwrap_err();
        assert!(escaped.downcast_ref::<String>().unwrap().contains(expected));
    }
}

fn fetch_segment(base: &str, url: &str) -> Option<Vec<u8>> {
    let expected = reqwest::Url::parse(base).ok()?;
    let parsed = reqwest::Url::parse(url).ok()?;
    if (
        parsed.scheme(),
        parsed.host_str(),
        parsed.port_or_known_default(),
    ) != (
        expected.scheme(),
        expected.host_str(),
        expected.port_or_known_default(),
    ) {
        return None;
    }
    let (status, bytes) = get_url(url, None, 8 * 1024 * 1024);
    (status == 200 && bytes.len() >= 188).then_some(bytes)
}

#[test]
fn segment_video_proof_checks_count_timing_and_sampling_domain() {
    fn report(count: usize) -> (Value, Vec<Value>) {
        (json!({"nb_read_frames":count.to_string(),"time_base":"1/90000"}),
         (0..count).map(|n| json!({"media_type":"video","best_effort_timestamp":n*9000,"pkt_duration":9000})).collect())
    }
    let one_video = json!({"codec_type":"video"});
    let one_audio = json!({"codec_type":"audio"});
    assert!(single_av_streams(&[]).is_none());
    assert!(single_av_streams(&[one_video.clone(), one_audio.clone()]).is_some());
    assert!(single_av_streams(std::slice::from_ref(&one_video)).is_none());
    assert!(
        single_av_streams(&[one_video.clone(), one_video.clone(), one_audio.clone()]).is_none()
    );
    assert!(single_av_streams(&[one_video, one_audio.clone(), one_audio]).is_none());

    for (count, expected) in [(1, 0), (10, 9), (11, 10), (12, 10)] {
        let (video, frames) = report(count);
        let proof = segment_video_proof(&video, &frames).unwrap();
        assert_eq!(proof.count, count as u64);
        assert_eq!(proof.time_base, "1/90000");
        assert_eq!(proof.sample_index, expected);
        assert_eq!(proof.duration_ticks, count as i64 * 9000);
        assert_eq!(proof.first_pts, 0);
        assert_eq!(proof.end_pts, count as i64 * 9000);
    }
    let (mut video, mut frames) = report(10);
    video["nb_read_frames"] = json!("0");
    assert!(segment_video_proof(&video, &frames).is_none());
    for bad in ["N/A", "-1", "+10", "1.0", "301", "18446744073709551616"] {
        video["nb_read_frames"] = json!(bad);
        assert!(segment_video_proof(&video, &frames).is_none());
    }
    video["nb_read_frames"] = json!("10");
    for bad in ["0/90000", "1/0", "bad"] {
        video["time_base"] = json!(bad);
        assert!(segment_video_proof(&video, &frames).is_none());
    }
    video["time_base"] = json!("1/90000");
    frames[1]["best_effort_timestamp"] = json!(0);
    assert!(segment_video_proof(&video, &frames).is_none());
    let (video, mut frames) = report(10);
    frames[9]["pkt_duration"] = json!(0);
    assert!(segment_video_proof(&video, &frames).is_none());
    frames.pop();
    assert!(segment_video_proof(&video, &frames).is_none());
    let (video, mut frames) = report(10);
    frames[9]["best_effort_timestamp"] = json!(i64::MAX);
    assert!(segment_video_proof(&video, &frames).is_none());
    let (video, mut frames) = report(10);
    frames[9]["pkt_duration"] = json!(31 * 90000);
    assert!(segment_video_proof(&video, &frames).is_none());

    let audio = json!({
        "sample_rate":"48000",
        "channels":2,
        "time_base":"1/90000"
    });
    let audio_frames = vec![
        json!({"media_type":"audio","best_effort_timestamp":0,"pkt_duration":1920,"nb_samples":1024}),
        json!({"media_type":"audio","best_effort_timestamp":1920,"duration":1920,"nb_samples":1024}),
    ];
    let audio_proof = segment_audio_diagnostic(&audio, &audio_frames);
    assert_eq!(audio_proof["audio_decoded_frames"], 2);
    assert_eq!(audio_proof["audio_nb_samples_total"], 2048);
    assert_eq!(audio_proof["audio_first_pts"], 0);
    assert_eq!(audio_proof["audio_last_end_pts"], 3840);
    assert_eq!(audio_proof["audio_packet_duration_ticks_total"], 3840);
    assert_eq!(audio_proof["audio_sample_rate"], 48000);
    assert_eq!(audio_proof["audio_channels"], 2);
    assert_eq!(audio_proof["audio_time_base_num"], 1);
    assert_eq!(audio_proof["audio_time_base_den"], 90000);

    let malformed = segment_audio_diagnostic(
        &json!({"sample_rate":"N/A","channels":0,"time_base":"1/0"}),
        &[
            json!({"media_type":"audio","best_effort_timestamp":"bad","pkt_duration":-1,"nb_samples":"bad"}),
        ],
    );
    assert!(malformed["audio_nb_samples_total"].is_null());
    assert!(malformed["audio_first_pts"].is_null());
    assert!(malformed["audio_last_end_pts"].is_null());
    assert!(malformed["audio_packet_duration_ticks_total"].is_null());
    assert!(malformed["audio_sample_rate"].is_null());
    assert!(malformed["audio_channels"].is_null());
    assert!(malformed["audio_time_base_num"].is_null());
    assert!(malformed["audio_time_base_den"].is_null());

    let overflow = segment_audio_diagnostic(
        &audio,
        &[
            json!({"media_type":"audio","best_effort_timestamp":0,"pkt_duration":i64::MAX,"nb_samples":i64::MAX}),
            json!({"media_type":"audio","best_effort_timestamp":1,"pkt_duration":i64::MAX,"nb_samples":i64::MAX}),
            json!({"media_type":"audio","best_effort_timestamp":2,"pkt_duration":i64::MAX,"nb_samples":i64::MAX}),
        ],
    );
    assert!(overflow["audio_nb_samples_total"].is_null());
    assert!(overflow["audio_packet_duration_ticks_total"].is_null());

    fn audio_packets(count: usize, first_pts: i64) -> (Value, Vec<Value>) {
        let audio = json!({
            "codec_name":"aac",
            "sample_rate":"48000",
            "channels":2,
            "time_base":"1/90000"
        });
        let frames = (0..count)
            .map(|index| {
                json!({"media_type":"audio",
                    "best_effort_timestamp":first_pts + index as i64 * 1920,
                    "pkt_duration":1920,"nb_samples":1024})
            })
            .collect();
        (audio, frames)
    }

    let (video, video_frames) = report(10);
    let video = segment_video_proof(&video, &video_frames).unwrap();
    for (count, first_pts, floor, ceil) in [
        (46, 1680, 15_701, 15_702),
        (47, 240, 16_042, 16_043),
        (48, -1920, 16_384, 16_384),
    ] {
        let (audio, frames) = audio_packets(count, first_pts);
        let proof = segment_audio_proof(&audio, &frames).unwrap();
        assert!(audio_matches_video_window(&video, &proof));
        assert_eq!(
            resampled_pcm_sample_range(proof.sample_count),
            Some((floor, ceil))
        );
        assert!(pcm_matches_audio_sample_count(&proof, (floor * 2) as usize));
        assert!(pcm_matches_audio_sample_count(&proof, (ceil * 2) as usize));
    }

    // The endpoint contract is relative: a common negative MPEG-TS timestamp
    // origin is valid, while shifting only audio by half a second is not.
    let (shifted_video, mut shifted_video_frames) = report(10);
    for frame in &mut shifted_video_frames {
        let timestamp = frame["best_effort_timestamp"].as_i64().unwrap() - 90_000;
        frame["best_effort_timestamp"] = json!(timestamp);
    }
    let shifted_video = segment_video_proof(&shifted_video, &shifted_video_frames).unwrap();
    let (audio, frames) = audio_packets(48, -90_000 - 1920);
    let proof = segment_audio_proof(&audio, &frames).unwrap();
    assert!(audio_matches_video_window(&shifted_video, &proof));
    for shift in [-45_000, 45_000] {
        let (audio, frames) = audio_packets(46, shift);
        let proof = segment_audio_proof(&audio, &frames).unwrap();
        assert!(!audio_matches_video_window(&video, &proof));
    }

    let (audio, frames) = audio_packets(1, 0);
    let proof = segment_audio_proof(&audio, &frames).unwrap();
    assert!(
        !audio_matches_video_window(&video, &proof),
        "tiny audio span must fail"
    );
    let (short_video, short_video_frames) = report(1);
    let short_video = segment_video_proof(&short_video, &short_video_frames).unwrap();
    let (audio, frames) = audio_packets(5, 0);
    let proof = segment_audio_proof(&audio, &frames).unwrap();
    assert!(
        !audio_matches_video_window(&short_video, &proof),
        "short paired A/V startup fragment must fail the fixed live-window oracle"
    );

    let (audio, mut frames) = audio_packets(46, 0);
    frames[1]["best_effort_timestamp"] = json!(1921);
    assert!(
        segment_audio_proof(&audio, &frames).is_none(),
        "audio PTS gap must fail"
    );
    frames[1]["best_effort_timestamp"] = json!(1919);
    assert!(
        segment_audio_proof(&audio, &frames).is_none(),
        "audio PTS overlap must fail"
    );
    frames[1]["best_effort_timestamp"] = json!(1920);
    frames[0]["nb_samples"] = json!(1023);
    assert!(
        segment_audio_proof(&audio, &frames).is_none(),
        "wrong AAC frame size must fail"
    );
    frames[0]["nb_samples"] = json!(1024);
    frames[0]["pkt_duration"] = json!(1919);
    assert!(
        segment_audio_proof(&audio, &frames).is_none(),
        "sample duration mismatch must fail"
    );

    let (mut audio, frames) = audio_packets(46, 0);
    audio["codec_name"] = json!("mp3");
    assert!(
        segment_audio_proof(&audio, &frames).is_none(),
        "wrong codec must fail"
    );
    audio["codec_name"] = json!("aac");
    audio["sample_rate"] = json!(44100);
    assert!(
        segment_audio_proof(&audio, &frames).is_none(),
        "wrong sample rate must fail"
    );
    audio["sample_rate"] = json!(48000);
    audio["channels"] = json!(1);
    assert!(
        segment_audio_proof(&audio, &frames).is_none(),
        "wrong channel count must fail"
    );
    audio["channels"] = json!(2);
    audio["time_base"] = json!("1/0");
    assert!(
        segment_audio_proof(&audio, &frames).is_none(),
        "invalid time base must fail"
    );
    audio["time_base"] = json!("1/90000");
    assert!(
        segment_audio_proof(&audio, &[]).is_none(),
        "missing audio frames must fail"
    );
    let (audio, frames) = audio_packets(1, i64::MAX - 1000);
    assert!(
        segment_audio_proof(&audio, &frames).is_none(),
        "PTS overflow must fail"
    );

    let (audio, frames) = audio_packets(46, 0);
    let proof = segment_audio_proof(&audio, &frames).unwrap();
    assert!(pcm_matches_audio_sample_count(&proof, 31_402));
    assert!(pcm_matches_audio_sample_count(&proof, 31_404));
    assert!(
        !pcm_matches_audio_sample_count(&proof, 31_400),
        "material PCM truncation must fail"
    );
    assert!(
        !pcm_matches_audio_sample_count(&proof, 31_403),
        "odd PCM byte count must fail"
    );
    assert!(
        !pcm_matches_audio_sample_count(&proof, 0),
        "empty PCM must fail"
    );
    assert!(
        !pcm_matches_audio_sample_count(&proof, (MAX_PCM_SAMPLES as usize + 1) * 2),
        "PCM cap must remain"
    );
    let exact_cap = SegmentAudioProof {
        sample_count: AAC_SAMPLE_RATE * 8,
        sample_rate: AAC_SAMPLE_RATE,
        channels: 2,
        first_pts: 0,
        end_pts: 8 * 90_000,
        time_base_num: 1,
        time_base_den: 90_000,
    };
    assert!(pcm_matches_audio_sample_count(
        &exact_cap,
        (MAX_PCM_SAMPLES * 2) as usize
    ));
    assert_eq!(resampled_pcm_sample_range(u64::MAX), None);
}

fn try_new_segment(
    base: &str,
    playlist: &str,
    seen: &mut HashSet<String>,
) -> Option<(u64, String, Vec<u8>)> {
    let (sequence, segments) = playlist_snapshot(base, playlist)?;
    for (index, url) in segments.iter().enumerate() {
        if !seen.contains(url) {
            if let Some(bytes) = fetch_segment(base, url) {
                seen.insert(url.clone());
                return Some((sequence.saturating_add(index as u64), url.clone(), bytes));
            }
        }
    }
    None
}

fn wait_new_segment(
    base: &str,
    playlist: &str,
    seen: &mut HashSet<String>,
    deadline: Instant,
) -> (u64, String, Vec<u8>) {
    loop {
        if let Some(segment) = try_new_segment(base, playlist, seen) {
            return segment;
        }
        assert!(
            Instant::now() < deadline,
            "new private HLS segment did not become readable"
        );
        thread::sleep(Duration::from_millis(250));
    }
}

fn run_bounded_filter(
    tool: &Path,
    args: &[&str],
    input: &[u8],
    output_limit: usize,
    allow_early_input_close: bool,
) -> (std::process::ExitStatus, Vec<u8>) {
    assert!(
        input.len() <= 8 * 1024 * 1024 && output_limit <= 2 * 1024 * 1024,
        "bounded media filter inputs required"
    );
    let child = Command::new(tool)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .expect("configured media inspection tool");
    let mut child = ChildGuard(child);
    let mut stdin = child.0.stdin.take().expect("filter stdin pipe");
    let stdout = child.0.stdout.take().expect("filter stdout pipe");
    let input = input.to_vec();
    let writer = thread::spawn(move || stdin.write_all(&input));
    let reader = thread::spawn(move || {
        let mut stdout = stdout;
        let mut output = Vec::with_capacity(output_limit.min(256 * 1024));
        let mut overflow = false;
        let mut chunk = [0u8; 16 * 1024];
        loop {
            let read = stdout.read(&mut chunk)?;
            if read == 0 {
                break;
            }
            let available = output_limit.saturating_add(1).saturating_sub(output.len());
            let keep = read.min(available);
            output.extend_from_slice(&chunk[..keep]);
            overflow |= keep != read;
        }
        Ok::<_, std::io::Error>((output, overflow))
    });
    let deadline = Instant::now() + Duration::from_secs(10);
    let status = loop {
        if let Some(status) = child.0.try_wait().expect("media filter child status") {
            break status;
        }
        if Instant::now() >= deadline {
            let _ = child.0.kill();
            let _ = child.0.wait();
            panic!("bounded media filter timed out");
        }
        thread::sleep(Duration::from_millis(10));
    };
    let write_result = writer.join().expect("media filter input writer thread");
    let (output, overflow) = reader
        .join()
        .expect("media filter output reader thread")
        .expect("read bounded media filter output");
    assert!(
        status.success(),
        "configured media filter rejected owned HLS bytes"
    );
    assert!(
        !overflow && output.len() <= output_limit,
        "media filter output exceeded byte limit"
    );
    if let Err(error) = write_result {
        assert!(
            allow_early_input_close && error.kind() == std::io::ErrorKind::BrokenPipe,
            "media filter closed its input unexpectedly"
        );
    }
    (status, output)
}

struct SegmentVideoProof {
    count: u64,
    sample_index: u64,
    first_pts: i64,
    end_pts: i64,
    duration_ticks: i64,
    time_base_num: u64,
    time_base_den: u64,
    time_base: String,
}

struct SegmentAudioProof {
    sample_count: u64,
    sample_rate: u64,
    channels: u64,
    first_pts: i64,
    end_pts: i64,
    time_base_num: u64,
    time_base_den: u64,
}

struct SegmentMediaProof {
    video: SegmentVideoProof,
    audio: SegmentAudioProof,
    segment_sha256: String,
}

const AAC_SAMPLES_PER_FRAME: u64 = 1024;
const AAC_SAMPLE_RATE: u64 = 48_000;
const PCM_SAMPLE_RATE: u64 = 16_000;
const MAX_PCM_SAMPLES: u64 = PCM_SAMPLE_RATE * 8;

fn stream_time_base(stream: &Value) -> Option<(u64, u64)> {
    let value = stream["time_base"].as_str()?;
    let (numerator, denominator) = value.split_once('/')?;
    if numerator.is_empty()
        || denominator.is_empty()
        || !numerator.bytes().all(|byte| byte.is_ascii_digit())
        || !denominator.bytes().all(|byte| byte.is_ascii_digit())
    {
        return None;
    }
    let numerator = numerator.parse::<u64>().ok()?;
    let denominator = denominator.parse::<u64>().ok()?;
    (numerator > 0 && denominator > 0).then_some((numerator, denominator))
}

fn frame_duration_ticks(frame: &Value) -> Option<i64> {
    diagnostic_integer(&frame["pkt_duration"])
        .or_else(|| diagnostic_integer(&frame["duration"]))
        .filter(|duration| *duration > 0)
}

fn single_av_streams(streams: &[Value]) -> Option<(&Value, &Value)> {
    let mut video: Option<&Value> = None;
    let mut audio: Option<&Value> = None;
    for stream in streams {
        match stream.get("codec_type").and_then(Value::as_str) {
            Some("video") if video.is_none() => video = Some(stream),
            Some("audio") if audio.is_none() => audio = Some(stream),
            Some("video" | "audio") => return None,
            _ => {}
        }
    }
    Some((video?, audio?))
}

fn segment_audio_proof(audio: &Value, frames: &[Value]) -> Option<SegmentAudioProof> {
    if audio["codec_name"] != "aac"
        || diagnostic_integer(&audio["sample_rate"]) != Some(AAC_SAMPLE_RATE as i64)
        || diagnostic_integer(&audio["channels"]) != Some(2)
    {
        return None;
    }
    let (time_base_num, time_base_den) = stream_time_base(audio)?;
    let audio_frames: Vec<_> = frames
        .iter()
        .filter(|frame| frame["media_type"] == "audio")
        .collect();
    if audio_frames.is_empty() {
        return None;
    }
    let mut sample_count = 0u64;
    let mut previous_end = None;
    let mut first_pts = None;
    let mut end_pts = None;
    for frame in audio_frames {
        let timestamp = diagnostic_integer(&frame["best_effort_timestamp"])?;
        let duration = frame_duration_ticks(frame)?;
        let samples = diagnostic_integer(&frame["nb_samples"])?;
        if samples != AAC_SAMPLES_PER_FRAME as i64
            || previous_end.is_some_and(|end| end != timestamp)
        {
            return None;
        }
        // In the selected 48 kHz AAC profile each coded frame must occupy
        // exactly its reported sample duration in the stream time base.
        let duration_scaled = i128::from(duration)
            .checked_mul(i128::from(time_base_num))?
            .checked_mul(i128::from(AAC_SAMPLE_RATE))?;
        let samples_scaled = i128::from(samples).checked_mul(i128::from(time_base_den))?;
        if duration_scaled != samples_scaled {
            return None;
        }
        let frame_end = timestamp.checked_add(duration)?;
        first_pts.get_or_insert(timestamp);
        end_pts = Some(frame_end);
        previous_end = Some(frame_end);
        sample_count = sample_count.checked_add(u64::try_from(samples).ok()?)?;
    }
    Some(SegmentAudioProof {
        sample_count,
        sample_rate: AAC_SAMPLE_RATE,
        channels: 2,
        first_pts: first_pts?,
        end_pts: end_pts?,
        time_base_num,
        time_base_den,
    })
}

fn endpoint_within_aac_frame(
    audio_pts: i64,
    audio_time_base: (u64, u64),
    video_pts: i64,
    video_time_base: (u64, u64),
) -> bool {
    let Some(audio_scaled) = i128::from(audio_pts)
        .checked_mul(i128::from(audio_time_base.0))
        .and_then(|value| value.checked_mul(i128::from(video_time_base.1)))
    else {
        return false;
    };
    let Some(video_scaled) = i128::from(video_pts)
        .checked_mul(i128::from(video_time_base.0))
        .and_then(|value| value.checked_mul(i128::from(audio_time_base.1)))
    else {
        return false;
    };
    let Some(difference) = audio_scaled
        .checked_sub(video_scaled)
        .and_then(|value| value.checked_abs())
    else {
        return false;
    };
    let Some(actual_scaled) = difference.checked_mul(i128::from(AAC_SAMPLE_RATE)) else {
        return false;
    };
    let Some(allowed_scaled) = i128::from(AAC_SAMPLES_PER_FRAME)
        .checked_mul(i128::from(audio_time_base.1))
        .and_then(|value| value.checked_mul(i128::from(video_time_base.1)))
    else {
        return false;
    };
    actual_scaled <= allowed_scaled
}

fn audio_matches_video_window(video: &SegmentVideoProof, audio: &SegmentAudioProof) -> bool {
    // Fixed live profile only: HLS targets 1s and the 10fps GOP is 10 frames.
    // Requiring a complete video window avoids treating a short startup/EOF
    // fragment as a healthy sample. One AAC access unit at each endpoint
    // covers packet-boundary quantization and AAC priming; this is not a universal HLS
    // continuity or loss-free guarantee.
    let Some(video_duration_scaled) = u128::try_from(video.duration_ticks)
        .ok()
        .and_then(|ticks| ticks.checked_mul(u128::from(video.time_base_num)))
    else {
        return false;
    };
    if video.count < 10 || video_duration_scaled < u128::from(video.time_base_den) {
        return false;
    }
    endpoint_within_aac_frame(
        audio.first_pts,
        (audio.time_base_num, audio.time_base_den),
        video.first_pts,
        (video.time_base_num, video.time_base_den),
    ) && endpoint_within_aac_frame(
        audio.end_pts,
        (audio.time_base_num, audio.time_base_den),
        video.end_pts,
        (video.time_base_num, video.time_base_den),
    )
}

fn resampled_pcm_sample_range(aac_samples: u64) -> Option<(u64, u64)> {
    // Mono 16 kHz output from this 48 kHz AAC profile is exactly N/3 samples;
    // only integer resampler rounding permits either adjacent sample count.
    let scaled = aac_samples.checked_mul(PCM_SAMPLE_RATE)?;
    let floor = scaled / AAC_SAMPLE_RATE;
    let ceil = floor.checked_add(if scaled % AAC_SAMPLE_RATE != 0 { 1 } else { 0 })?;
    Some((floor, ceil))
}

fn pcm_matches_audio_sample_count(audio: &SegmentAudioProof, pcm_bytes: usize) -> bool {
    if audio.sample_rate != AAC_SAMPLE_RATE
        || audio.channels != 2
        || pcm_bytes == 0
        || pcm_bytes % 2 != 0
        || pcm_bytes > (MAX_PCM_SAMPLES * 2) as usize
    {
        return false;
    }
    let Some((floor, ceil)) = resampled_pcm_sample_range(audio.sample_count) else {
        return false;
    };
    let Ok(actual) = u64::try_from(pcm_bytes / 2) else {
        return false;
    };
    (actual == floor || actual == ceil) && actual <= MAX_PCM_SAMPLES
}

fn diagnostic_integer(value: &Value) -> Option<i64> {
    value
        .as_i64()
        .or_else(|| value.as_u64().and_then(|number| i64::try_from(number).ok()))
        .or_else(|| value.as_str()?.parse::<i64>().ok())
}

fn segment_audio_diagnostic(audio: &Value, frames: &[Value]) -> Value {
    let audio_frames: Vec<_> = frames
        .iter()
        .filter(|frame| frame["media_type"] == "audio")
        .collect();
    let sample_rate = diagnostic_integer(&audio["sample_rate"])
        .filter(|value| *value > 0)
        .and_then(|value| u64::try_from(value).ok());
    let channels = diagnostic_integer(&audio["channels"])
        .filter(|value| *value > 0)
        .and_then(|value| u64::try_from(value).ok());
    let sample_count = audio_frames.iter().try_fold(0u64, |sum, frame| {
        let samples = diagnostic_integer(&frame["nb_samples"])?;
        if samples < 0 {
            return None;
        }
        sum.checked_add(u64::try_from(samples).ok()?)
    });
    let packet_duration_ticks = audio_frames.iter().try_fold(0i64, |sum, frame| {
        let duration = diagnostic_integer(&frame["pkt_duration"])
            .or_else(|| diagnostic_integer(&frame["duration"]))?;
        if duration <= 0 {
            return None;
        }
        sum.checked_add(duration)
    });
    let timestamps: Option<Vec<i64>> = audio_frames
        .iter()
        .map(|frame| diagnostic_integer(&frame["best_effort_timestamp"]))
        .collect();
    let timestamps = timestamps.filter(|values| values.windows(2).all(|pair| pair[0] < pair[1]));
    let first_pts = timestamps
        .as_ref()
        .and_then(|values| values.first().copied());
    let last_end_pts = audio_frames.last().and_then(|frame| {
        let duration = diagnostic_integer(&frame["pkt_duration"])
            .or_else(|| diagnostic_integer(&frame["duration"]))?;
        if duration <= 0 {
            return None;
        }
        diagnostic_integer(&frame["best_effort_timestamp"])?.checked_add(duration)
    });
    let (time_base_num, time_base_den) = audio["time_base"]
        .as_str()
        .and_then(|value| value.split_once('/'))
        .and_then(|(numerator, denominator)| {
            let numerator = numerator.parse::<u64>().ok()?;
            let denominator = denominator.parse::<u64>().ok()?;
            (numerator > 0 && denominator > 0).then_some((numerator, denominator))
        })
        .map_or((None, None), |(numerator, denominator)| {
            (Some(numerator), Some(denominator))
        });
    json!({
        "audio_channels": channels,
        "audio_decoded_frames": audio_frames.len(),
        "audio_first_pts": first_pts,
        "audio_last_end_pts": last_end_pts,
        "audio_nb_samples_total": sample_count,
        "audio_packet_duration_ticks_total": packet_duration_ticks,
        "audio_sample_rate": sample_rate,
        "audio_time_base_den": time_base_den,
        "audio_time_base_num": time_base_num,
    })
}

#[derive(Clone, Copy)]
enum PcmProofRole {
    Grid,
    InitialSustained,
    Replacement,
    LateSustained,
}

impl PcmProofRole {
    fn label(self) -> &'static str {
        match self {
            Self::Grid => "grid",
            Self::InitialSustained => "initial_sustained",
            Self::Replacement => "replacement",
            Self::LateSustained => "late_sustained",
        }
    }
}

fn segment_video_proof(video: &Value, frames: &[Value]) -> Option<SegmentVideoProof> {
    let raw_count = video["nb_read_frames"].as_str()?;
    if raw_count.is_empty() || !raw_count.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let count = raw_count.parse::<u64>().ok()?;
    if !(1..=300).contains(&count) {
        return None;
    }
    let time_base = video["time_base"].as_str()?;
    let (numerator, denominator) = time_base.split_once('/')?;
    let numerator = numerator.parse::<u64>().ok()?;
    let denominator = denominator.parse::<u64>().ok()?;
    if numerator == 0 || denominator == 0 {
        return None;
    }
    let video_frames: Vec<_> = frames
        .iter()
        .filter(|v| v["media_type"] == "video")
        .collect();
    if video_frames.len() as u64 != count {
        return None;
    }
    let mut previous = None;
    for frame in &video_frames {
        let timestamp = frame["best_effort_timestamp"].as_i64()?;
        if previous.is_some_and(|old| timestamp <= old) {
            return None;
        }
        previous = Some(timestamp);
    }
    let first = video_frames.first()?["best_effort_timestamp"].as_i64()?;
    let last = video_frames.last()?;
    let last_duration = last["duration"]
        .as_i64()
        .or_else(|| last["pkt_duration"].as_i64())?;
    if last_duration <= 0 {
        return None;
    }
    let end_pts = last["best_effort_timestamp"]
        .as_i64()?
        .checked_add(last_duration)?;
    let duration_ticks = end_pts.checked_sub(first)?;
    let scaled = u128::try_from(duration_ticks)
        .ok()?
        .checked_mul(u128::from(numerator))?;
    if scaled == 0 || scaled > 30 * u128::from(denominator) {
        return None;
    }
    Some(SegmentVideoProof {
        count,
        sample_index: 10.min(count - 1),
        first_pts: first,
        end_pts,
        duration_ticks,
        time_base_num: numerator,
        time_base_den: denominator,
        time_base: time_base.to_owned(),
    })
}

fn ffprobe_segment(ffprobe: &Path, bytes: &[u8]) -> SegmentMediaProof {
    assert!(
        bytes.len() >= 188 && bytes.len() <= 8 * 1024 * 1024,
        "bounded TS output segment required"
    );
    let (_, output) = run_bounded_filter(
        ffprobe,
        &[
            "-v",
            "error",
            "-count_frames",
            "-show_frames",
            "-show_entries",
            "stream=codec_type,codec_name,width,height,r_frame_rate,avg_frame_rate,nb_read_frames,time_base,sample_rate,channels:frame=media_type,best_effort_timestamp,pkt_duration,duration,nb_samples",
            "-of",
            "json",
            "-i",
            "pipe:0",
        ],
        bytes,
        256 * 1024,
        false,
    );
    let report: Value = serde_json::from_slice(&output).expect("ffprobe JSON");
    let streams = report["streams"].as_array().expect("ffprobe streams");
    let video = streams
        .iter()
        .find(|row| row["codec_type"] == "video")
        .expect("HLS video track");
    let audio = streams
        .iter()
        .find(|row| row["codec_type"] == "audio")
        .expect("HLS audio track");
    assert_eq!(
        video["codec_name"], "h264",
        "selected profile video codec differs"
    );
    assert_eq!(
        (video["width"].as_u64(), video["height"].as_u64()),
        (Some(640), Some(360)),
        "selected profile video dimensions differ"
    );
    assert!(
        video["r_frame_rate"] == "10/1" || video["avg_frame_rate"] == "10/1",
        "selected profile frame rate differs"
    );
    assert_eq!(
        audio["codec_name"], "aac",
        "selected profile audio codec differs"
    );
    let frames = report["frames"].as_array().expect("decoded frame proof");
    let video_proof = segment_video_proof(video, frames)
        .expect("positive bounded decoded frame count, timestamps and duration required");
    // The segment is a borrowed immutable byte slice throughout probe and decode;
    // retain content identity, not an API URL or an output capability.
    eprintln!(
        "normal_segment_video_proof sha256={:x} bytes={} frames={} sample_index={} duration_ticks={} time_base={}",
        Sha256::digest(bytes),
        bytes.len(),
        video_proof.count,
        video_proof.sample_index,
        video_proof.duration_ticks,
        video_proof.time_base
    );
    let audio_diagnostic = segment_audio_diagnostic(audio, frames);
    eprintln!(
        "normal_segment_audio_probe {}",
        json!({
            "input_bytes": bytes.len(),
            "segment_sha256": format!("{:x}", Sha256::digest(bytes)),
            "video_decoded_frames": video_proof.count,
            "video_duration_ticks": video_proof.duration_ticks,
            "video_time_base_den": Some(video_proof.time_base_den),
            "video_time_base_num": Some(video_proof.time_base_num),
            "audio": audio_diagnostic,
        })
    );
    // Emit the bounded metadata above before new AAC timing assertions so a
    // failed proof retains useful numeric evidence without exception strings.
    let (_, audio) = single_av_streams(streams)
        .expect("exactly one video and one audio stream required by fixed live profile");
    let audio_proof =
        segment_audio_proof(audio, frames).expect("selected profile AAC packet proof required");
    assert!(
        audio_matches_video_window(&video_proof, &audio_proof),
        "AAC audio endpoints do not match the video window within one AAC frame"
    );
    SEGMENT_VIDEO_PROOFS.with(|rows| {
        let mut rows = rows.borrow_mut();
        assert!(rows.len() < 64, "bounded segment proof summary required");
        rows.push(
            json!({"sha256":format!("{:x}", Sha256::digest(bytes)), "bytes":bytes.len(),
            "decoded_video_frames":video_proof.count,"sample_index":video_proof.sample_index,
            "duration_ticks":video_proof.duration_ticks,"time_base":video_proof.time_base}),
        );
    });
    SegmentMediaProof {
        video: video_proof,
        audio: audio_proof,
        segment_sha256: format!("{:x}", Sha256::digest(bytes)),
    }
}

fn decode_segment_rgb(ffmpeg: &Path, bytes: &[u8]) -> (Vec<u8>, SegmentMediaProof) {
    let identity = Sha256::digest(bytes);
    let ffprobe = PathBuf::from(std::env::var("OTTPLAY_MULTIVIEW_FFPROBE").unwrap());
    let proof = ffprobe_segment(&ffprobe, bytes);
    let select = format!(r"select=eq(n\,{})", proof.video.sample_index);
    assert!(
        bytes.len() >= 188 && bytes.len() <= 8 * 1024 * 1024,
        "bounded TS output segment required"
    );
    let (_, output) = run_bounded_filter(
        ffmpeg,
        &[
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            "pipe:0",
            "-vf",
            &select,
            "-frames:v",
            "1",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "pipe:1",
        ],
        bytes,
        2 * 1024 * 1024,
        true,
    );
    assert_eq!(
        output.len(),
        640 * 360 * 3,
        "HLS frame dimensions differ from selected profile"
    );
    assert_eq!(
        Sha256::digest(bytes),
        identity,
        "segment content changed during probe/decode"
    );
    SEGMENT_VIDEO_PROOFS.with(|rows| {
        rows.borrow_mut().last_mut().expect("owned segment proof")["source_identity_unchanged"] =
            json!(true);
    });
    (output, proof)
}

fn decode_segment_pcm(
    ffmpeg: &Path,
    bytes: &[u8],
    role: PcmProofRole,
    proof: &SegmentMediaProof,
) -> Vec<i16> {
    assert!(
        bytes.len() >= 188 && bytes.len() <= 8 * 1024 * 1024,
        "bounded TS output segment required"
    );
    assert_eq!(
        format!("{:x}", Sha256::digest(bytes)),
        proof.segment_sha256,
        "PCM decode must use the segment bytes covered by the A/V proof"
    );
    let (_, output) = run_bounded_filter(
        ffmpeg,
        &[
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            "pipe:0",
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-f",
            "s16le",
            "pipe:1",
        ],
        bytes,
        512 * 1024,
        false,
    );
    let pcm_range = resampled_pcm_sample_range(proof.audio.sample_count)
        .expect("bounded selected-profile AAC sample count");
    eprintln!(
        "normal_segment_pcm_probe {}",
        json!({
            "max_pcm_bytes": 16_000 * 2 * 8,
            "resampled_pcm_samples_floor": pcm_range.0,
            "resampled_pcm_samples_ceil": pcm_range.1,
            "pcm_bytes": output.len(),
            "pcm_even_bytes": output.len() % 2 == 0,
            "pcm_samples": output.len() / 2,
            "role": role.label(),
            "segment_input_bytes": bytes.len(),
            "segment_sha256": proof.segment_sha256,
            "video_time_base_den": proof.video.time_base_den,
            "video_time_base_num": proof.video.time_base_num,
            "audio_sample_count": proof.audio.sample_count,
        })
    );
    assert!(
        pcm_matches_audio_sample_count(&proof.audio, output.len()),
        "decoded HLS PCM does not match bounded AAC samples after resampling"
    );
    output
        .chunks_exact(2)
        .map(|bytes| i16::from_le_bytes([bytes[0], bytes[1]]))
        .collect()
}

fn tone_power(samples: &[i16], frequency: f64) -> f64 {
    let (mut sin, mut cos) = (0.0, 0.0);
    for (index, sample) in samples.iter().take(16_000).enumerate() {
        let phase = std::f64::consts::TAU * frequency * index as f64 / 16_000.0;
        sin += f64::from(*sample) * phase.sin();
        cos += f64::from(*sample) * phase.cos();
    }
    sin * sin + cos * cos
}

fn assert_audio_tone(samples: &[i16], expected: f64) {
    assert!(
        audio_tone_matches(samples, expected),
        "selected output audio does not contain the granted source tone"
    );
}

fn audio_tone_matches(samples: &[i16], expected: f64) -> bool {
    let selected = tone_power(samples, expected);
    let alternatives = [330.0, 440.0, 550.0]
        .into_iter()
        .filter(|value| *value != expected)
        .map(|value| tone_power(samples, value))
        .fold(0.0, f64::max);
    selected > alternatives * 4.0 && selected > 1.0e10
}

fn assert_cell_color(rgb: &[u8], x: usize, y: usize, color_id: u8) {
    assert!(
        cell_matches_color(rgb, x, y, color_id),
        "slot cell center does not match its authorized source color"
    );
}

fn cell_matches_color(rgb: &[u8], x: usize, y: usize, color_id: u8) -> bool {
    let offset = (y * 640 + x) * 3;
    let (r, g, b) = (rgb[offset], rgb[offset + 1], rgb[offset + 2]);
    match color_id {
        1 => r > 140 && g < 90 && b < 90,
        2 => g > 140 && r < 90 && b < 90,
        3 => b > 140 && r < 90 && g < 90,
        _ => false,
    }
}

fn source_input_manifest(path: &Path) -> Vec<(u8, PathBuf, String, u64)> {
    let metadata = fs::symlink_metadata(path).expect("input manifest");
    assert!(
        metadata.is_file()
            && !metadata.file_type().is_symlink()
            && metadata.mode() & 0o222 == 0
            && metadata.len() <= 16 * 1024
    );
    let manifest: Value = serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
    assert_eq!(manifest["schema"], "ottplay.multiview.production-inputs.v1");
    assert_eq!(manifest["seconds"], 210);
    assert_eq!(manifest["fps"], 10);
    assert_eq!(manifest["width"], 96);
    assert_eq!(manifest["height"], 64);
    let entries = manifest["inputs"].as_array().unwrap();
    assert_eq!(entries.len(), 3);
    let colors = ["red", "lime", "blue"];
    let frequencies = [330, 440, 550];
    let mut result = Vec::new();
    for (index, item) in entries.iter().enumerate() {
        assert_eq!(item["id"], index as u64 + 1);
        assert_eq!(item["color"], colors[index]);
        assert_eq!(item["audio_frequency_hz"], frequencies[index]);
        let path = PathBuf::from(item["path"].as_str().unwrap());
        let metadata = fs::symlink_metadata(&path).expect("source file");
        assert!(
            metadata.is_file()
                && !metadata.file_type().is_symlink()
                && metadata.mode() & 0o222 == 0
                && metadata.len() > 0
                && metadata.len() <= 16 * 1024 * 1024
        );
        let bytes = fs::read(&path).expect("owned source file");
        let digest = format!("{:x}", Sha256::digest(&bytes));
        assert_eq!(digest, item["sha256"].as_str().unwrap());
        assert_eq!(metadata.len(), item["bytes"].as_u64().unwrap());
        result.push((index as u8 + 1, path, digest, metadata.len()));
    }
    result
}

fn start_single_playing_context(
    base: &str,
    epoch: &Value,
    label: &str,
) -> (Value, String, String, String) {
    let mut native = native_for_slot(0);
    native["runtime"] = json!("native_runtime_sequential");
    native["expected"]["scene"] = json!(format!("scene_{label}"));
    native["slot_generation"] = json!(format!("slot_{label}"));
    native["source_revision"] = json!(format!("source_{label}"));
    let created = create_session(base, TOKEN, epoch, native, &format!("create_{label}"));
    let (ctx, _) = contexts(&created);
    let list = catalog(base, TOKEN, &ctx, &format!("catalog_{label}"));
    let ctx = request_source(
        base,
        TOKEN,
        &list["context"],
        &list["items"][0],
        &list["catalog_revision"],
        label,
    );
    let end = Instant::now() + Duration::from_secs(12);
    let mut current = wait_slot(base, TOKEN, &ctx, 0, "production_item_1", end);
    loop {
        if let (Some(path), Some(generation)) = (
            current["output"]["playlist_path"].as_str(),
            current["output"]["output_generation"].as_str(),
        ) {
            let path = path.to_owned();
            let generation = generation.to_owned();
            let (_, _, bytes) = wait_new_segment(base, &path, &mut HashSet::new(), end);
            assert!(
                bytes.len() >= 188 * 3
                    && [0, 188, 376]
                        .into_iter()
                        .all(|offset| bytes[offset] == 0x47)
            );
            let binding = context_for_slot(&current, 0, &ctx["native_expected"]);
            return (
                binding,
                path,
                current["session_id"]
                    .as_str()
                    .expect("owned session")
                    .to_owned(),
                generation,
            );
        }
        assert!(
            Instant::now() < end,
            "context never minted actual readable output"
        );
        thread::sleep(Duration::from_millis(100));
        current = snapshot(base, TOKEN, &ctx, &format!("output_{label}"));
    }
}

#[test]
#[ignore = "hosted production binary; private HTTP MPEG-TS, 210-second decode and normal HLS output qualification"]
fn normal_server_private_http_mpegts_renew_replace_and_cleanup() {
    run_normal_production(ProductionMode::RawMpegTs);
}
#[test]
#[ignore = "hosted production binary; private live HLS MPEG-TS input, real HTTPS, 185s strict sustained decode and owned cleanup"]
fn normal_server_private_http_hls_renew_replace_and_cleanup() {
    run_normal_production(ProductionMode::LiveHlsTs);
}
fn run_normal_production(mode: ProductionMode) {
    let started = Instant::now();
    SEED_REFUSAL_SUMMARIES.with(|rows| *rows.borrow_mut() = [None; 3]);
    let mut root = OwnedRoot::new();
    let _failure_stderr = FailureStderrGuard::install(&root.0);
    let mut tls = production_tls::SyntheticTls::generate(&root.0);
    install_http_client(Some(tls.ca_pem()));
    let public = root.0.join("public");
    fs::DirBuilder::new().mode(0o700).create(&public).unwrap();
    let inputs_path = PathBuf::from(std::env::var_os(INPUTS).expect("sealed source manifest"));
    let hls_sources = if mode == ProductionMode::LiveHlsTs {
        let path = PathBuf::from(
            std::env::var_os("OTTPLAY_MULTIVIEW_PRODUCTION_HLS_INPUTS")
                .expect("sealed HLS source manifest"),
        );
        Some(Arc::new(hls_production::HlsSources::load(&path)))
    } else {
        None
    };
    let inputs = if let Some(hls) = &hls_sources {
        hls.original_inputs()
    } else {
        source_input_manifest(&inputs_path)
    };
    let files: HashMap<String, Arc<Vec<u8>>> = inputs
        .iter()
        .map(|(id, path, _, _)| {
            let bytes = fs::read(path).expect("owned source bytes");
            (format!("source-{id}.ts"), Arc::new(bytes))
        })
        .collect();
    let private_peer = private_ip();
    let upstream = if mode == ProductionMode::RawMpegTs {
        Upstream::start(private_peer, files)
    } else {
        Upstream::start_mode(private_peer, files, hls_sources)
    };
    let source_origin = format!("http://{}:{}", private_peer, upstream.address.port());
    let api_listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let decoy_listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let api_port = api_listener.local_addr().unwrap().port();
    let decoy_port = decoy_listener.local_addr().unwrap().port();
    let api_port_text = api_port.to_string();
    let decoy_port_text = decoy_port.to_string();
    let api_origin = format!("https://127.0.0.1:{api_port}");
    let expires = now_ms() + 1_200_000;
    let short_expires = now_ms() + 60_000;
    let ffmpeg = std::env::var("OTTPLAY_MULTIVIEW_FFMPEG").expect("configured ffmpeg");
    let ffprobe = std::env::var("OTTPLAY_MULTIVIEW_FFPROBE").expect("configured ffprobe");
    let mkfifo = std::env::var("OTTPLAY_MULTIVIEW_MKFIFO").expect("configured mkfifo");
    let output = root.0.join("media-output");
    fs::DirBuilder::new().mode(0o700).create(&output).unwrap();
    let config = production_config::Config {
        mode,
        source_origin: &source_origin,
        private_peer,
        inputs: &inputs,
        api_origin: &api_origin,
        expires,
        short_expires,
        output: &output,
        ffmpeg: &ffmpeg,
        ffprobe: &ffprobe,
        mkfifo: &mkfifo,
    }
    .document();
    let config_path = root.write_private("operator.json", &serde_json::to_vec(&config).unwrap());
    drop((api_listener, decoy_listener));
    let mut server = NormalServerGuard(
        Command::new(env!("CARGO_BIN_EXE_ottplay-server"))
            .current_dir(&public)
            .env_clear()
            .env("HOME", secure_home())
            .env("EPG_URLS", "http://127.0.0.1:1/fixture-unavailable")
            .args([
                "--host",
                "127.0.0.1",
                "--port",
                &decoy_port_text,
                "--https-port",
                &api_port_text,
                "--multiview-only",
                "--multiview-config",
            ])
            .arg(&config_path)
            .arg("--cert")
            .arg(tls.cert_path())
            .arg("--key")
            .arg(tls.key_path())
            .stdout(
                OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .mode(0o600)
                    .open(root.0.join("server.stdout"))
                    .unwrap(),
            )
            .stderr(
                OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .mode(0o600)
                    .open(root.0.join("server.stderr"))
                    .unwrap(),
            )
            .spawn()
            .expect("normal production server binary"),
    );
    let startup_deadline = Instant::now() + STARTUP_LIMIT;
    let server_epoch;
    let clock_sample_ms;
    let clock_observed;
    loop {
        if let Some(status) = server.0.try_wait().expect("server process status") {
            panic!(
                "normal server exited before capabilities response: {status}; {}",
                fixture_stderr_diagnostic(&root.0, &root.0.join("server.stderr"))
            );
        }
        let (code, bytes) = get(
            &api_origin,
            "/multiview/v1/capabilities",
            Some(TOKEN),
            256 * 1024,
        );
        if code == 200 {
            let (_, _, startup_bytes) =
                owned_stderr_snapshot().expect("owned bounded startup clock snapshot");
            clock_sample_ms =
                startup_clock_sample(&startup_bytes).expect("unique complete startup clock sample");
            // Capture only AFTER the complete record was observed, before the
            // potentially expensive TLS rejection probes below.
            clock_observed = Instant::now();
            assert!(
                clock_observed < startup_deadline,
                "startup clock observation exceeded unchanged startup bound"
            );
            let capabilities: Value = serde_json::from_slice(&bytes).unwrap();
            assert_eq!(capabilities["max_inputs"], 9);
            assert_eq!(
                capabilities["qualified_input_adapters"],
                json!([mode.adapter()])
            );
            assert_eq!(capabilities["output_profiles"][0]["profile_id"], PROFILE);
            server_epoch = capabilities["server_epoch"].clone();
            fixture_http()
                .runtime
                .block_on(tls.assert_rejections(&api_origin));
            assert_eq!(
                get(
                    &format!("http://127.0.0.1:{decoy_port}"),
                    "/multiview/v1/capabilities",
                    Some(TOKEN),
                    64 * 1024
                )
                .0,
                404,
                "private production API must be absent from the unselected HTTP listener"
            );
            for path in ["/", "/index.html", "/proxy/fixture"] {
                let (route_status, _) = get(&api_origin, path, None, 256 * 1024);
                assert_eq!(
                    route_status, 404,
                    "--multiview-only unexpectedly served {path}"
                );
                assert_no_untrusted_cors(&api_origin, path);
            }
            assert_no_untrusted_cors(&api_origin, "/multiview/v1/capabilities");
            assert_eq!(get(&api_origin, "/health", None, 64 * 1024).0, 200);
            break;
        }
        assert!(
            Instant::now() < startup_deadline,
            "normal server did not bind selected private listener"
        );
        thread::sleep(Duration::from_millis(100));
    }

    // Exercise expiry with a real active decode/output. Renew only the active
    // session/output lease every 18s; the one-use 30s input grant is consumed
    // once and is never replayed. The 60s credential expiry remains the shorter
    // authority and must retire the active source and its output.
    let expiry_native = json!({"runtime":"native_runtime_expiry","expected":{"scene":"native_scene_expiry",
        "layout_revision":"layout_expiry","focus_revision":"focus_expiry","audio_revision":"audio_expiry"},
        "slot_id":0,"slot_generation":"slot_expiry","source_revision":"source_expiry"});
    let expiry_created = create_session(
        &api_origin,
        EXPIRING_TOKEN,
        &server_epoch,
        expiry_native,
        "create_expiry",
    );
    let (mut expiry_ctx, _) = contexts(&expiry_created);
    let expiry_list = catalog(&api_origin, EXPIRING_TOKEN, &expiry_ctx, "expiry_sources");
    expiry_ctx = expiry_list["context"].clone();
    expiry_ctx = request_source(
        &api_origin,
        EXPIRING_TOKEN,
        &expiry_ctx,
        &expiry_list["items"][0],
        &expiry_list["catalog_revision"],
        "expiry",
    );
    let expiry_deadline =
        Instant::now() + Duration::from_millis(short_expires.saturating_sub(now_ms()));
    let _ = wait_slot(
        &api_origin,
        EXPIRING_TOKEN,
        &expiry_ctx,
        0,
        "production_item_1",
        expiry_deadline,
    );
    for _ in 0..50 {
        if fs::read_dir(&output).unwrap().next().is_some() && upstream.source_was_read(mode) {
            break;
        }
        assert!(
            Instant::now() < expiry_deadline,
            "expiring credential never created active media output"
        );
        thread::sleep(Duration::from_millis(100));
    }
    assert!(
        fs::read_dir(&output).unwrap().next().is_some(),
        "credential expiry case had no active output to retire"
    );
    assert!(
        upstream.source_was_read(mode),
        "credential expiry case had no actual source read (raw requires active connection)"
    );
    let mut next_renewal = Instant::now() + Duration::from_secs(18);
    while Instant::now() + Duration::from_secs(2) < expiry_deadline {
        if Instant::now() >= next_renewal {
            let current = snapshot(
                &api_origin,
                EXPIRING_TOKEN,
                &expiry_ctx,
                "expiry_renew_status",
            );
            expiry_ctx = context_for_slot(&current, 0, &current["native_expected"]);
            let renewed = control(
                &api_origin,
                EXPIRING_TOKEN,
                &expiry_ctx,
                &format!("expiry_renew_{}", started.elapsed().as_secs()),
                json!({"name":"renew"}),
                None,
            );
            expiry_ctx = renewed["context"].clone();
            next_renewal = Instant::now() + Duration::from_secs(18);
        }
        thread::sleep(Duration::from_millis(100));
    }
    // Keep the one-shot 401 oracle, but wait on a conservative lower bound of
    // its authority clock. Cleanup below is measured after observed expiry,
    // not from an inferred physical wall-clock boundary.
    let credential_clock = loop {
        let probe_observed = Instant::now();
        assert!(
            probe_observed.duration_since(started) < RUN_LIMIT,
            "credential expiry observation exceeded unchanged run bound"
        );
        let probe_elapsed = probe_observed.duration_since(clock_observed);
        let lower_bound = broker_clock_lower_bound(clock_sample_ms, probe_elapsed)
            .expect("startup clock lower bound overflow");
        if lower_bound >= short_expires {
            break json!({
                "startup_sample_ms":clock_sample_ms,
                "observation_elapsed_ms":u64::try_from(clock_observed.duration_since(started).as_millis()).expect("clock observation duration bound"),
                "probe_elapsed_ms":u64::try_from(probe_elapsed.as_millis()).expect("clock probe duration bound"),
                "lower_bound_ms":lower_bound,"short_expires_ms":short_expires,
            });
        }
        thread::sleep(Duration::from_millis(50));
    };
    let (expired_code, _) = get(
        &api_origin,
        "/multiview/v1/capabilities",
        Some(EXPIRING_TOKEN),
        256 * 1024,
    );
    assert_eq!(
        expired_code, 401,
        "expired control credential remained usable; credential_clock={credential_clock}"
    );
    let mut expired = false;
    for _ in 0..30 {
        let (code, _) = http(
            "POST",
            &format!("{api_origin}/multiview/v1/status"),
            Some(EXPIRING_TOKEN),
            Some("expiry_status"),
            Some(
                &json!({"version":1,"server_epoch":expiry_ctx["server_epoch"],"session_id":expiry_ctx["session_id"],"native_expected":expiry_ctx["native_expected"]}),
            ),
            256 * 1024,
        );
        if code == 401 {
            expired = true;
            break;
        }
        thread::sleep(Duration::from_millis(100));
    }
    assert!(expired, "expired session did not reject status");
    let cleanup_deadline = Instant::now() + Duration::from_secs(8);
    while Instant::now() < cleanup_deadline
        && (fs::read_dir(&output).unwrap().next().is_some() || upstream.active_connections() != 0)
    {
        thread::sleep(Duration::from_millis(100));
    }
    assert!(
        fs::read_dir(&output).unwrap().next().is_none(),
        "expired active session output was not retired"
    );
    assert_eq!(
        upstream.active_connections(),
        0,
        "expired source decode connection was not closed"
    );
    upstream.confirm_cleanup(&output, true);

    // Fill all nine advertised slots in one disjoint 3x3 geometry. The three
    // sealed sources have distinct solid colors and tones so the encoded HLS
    // segment proves source-to-cell composition and selected audio ownership.
    let grid_created = create_session_slots(
        &api_origin,
        TOKEN,
        &server_epoch,
        9,
        "create_nine_slot_grid",
    );
    let mut latest = contexts(&grid_created).0;
    let mut slot_natives: Vec<Value> = (0..9).map(|slot| native_for_slot(slot as u64)).collect();
    let expected_items: Vec<String> = (0..9)
        .map(|index| format!("production_item_{}", index % 3 + 1))
        .collect();
    let mut source_refs = HashMap::new();
    let mut grid_next_renew = Instant::now() + Duration::from_secs(18);
    let mut grid_renew_sequence = 0;
    for slot_id in 0..9usize {
        renew_due(
            &api_origin,
            TOKEN,
            &mut latest,
            &mut slot_natives,
            &mut grid_next_renew,
            &mut grid_renew_sequence,
        );
        let current = snapshot(&api_origin, TOKEN, &latest, "grid_slot_status");
        let context = context_for_slot(&current, slot_id as u64, &slot_natives[slot_id]);
        let listing = catalog(&api_origin, TOKEN, &context, "grid_catalog");
        let selected = listing["items"]
            .as_array()
            .unwrap()
            .iter()
            .find(|item| item["item_ref"] == expected_items[slot_id])
            .unwrap()
            .clone();
        if slot_id < 3 {
            source_refs.insert(
                expected_items[slot_id].clone(),
                selected["source_ref"].clone(),
            );
        } else {
            assert_eq!(
                selected["source_ref"], source_refs[&expected_items[slot_id]],
                "reused catalog item changed source authority between slots"
            );
        }
        let context = listing["context"].clone();
        latest = request_source(
            &api_origin,
            TOKEN,
            &context,
            &selected,
            &listing["catalog_revision"],
            &format!("grid_{slot_id}"),
        );
        slot_natives[slot_id] = latest["native_expected"].clone();
    }
    let grid_status = snapshot(&api_origin, TOKEN, &latest, "grid_all_playing");
    let mut audio_context = context_for_slot(&grid_status, 0, &slot_natives[0]);
    let mut audio_native = audio_context["native_expected"].clone();
    audio_native["expected"]["audio_revision"] = json!("audio_grid_slot_zero");
    audio_context = control(
        &api_origin,
        TOKEN,
        &audio_context,
        "select_grid_audio",
        json!({"name":"audio","policy":"slot"}),
        Some(audio_native),
    )["context"]
        .clone();
    latest = audio_context;
    for native in &mut slot_natives {
        native["expected"]["audio_revision"] = json!("audio_grid_slot_zero");
    }
    slot_natives[0] = latest["native_expected"].clone();
    let grid_end = Instant::now() + Duration::from_secs(45);
    let grid_status = wait_all_slots(
        &api_origin,
        TOKEN,
        &mut latest,
        &mut slot_natives,
        &expected_items,
        &mut grid_next_renew,
        &mut grid_renew_sequence,
        grid_end,
    );
    let playlist = grid_status["output"]["playlist_path"]
        .as_str()
        .expect("private grid HLS playlist");
    let mut grid_seen = playlist_snapshot_seed_until(&api_origin, playlist, grid_end)
        .unwrap_or_else(|failure| panic!("grid HLS playlist before freshness barrier: {failure}"))
        .1
        .into_iter()
        .collect::<HashSet<_>>();
    // Ignore the first newly completed segment: it may contain frames queued
    // before the final slot reached its ten-frame readiness barrier.
    let _ = wait_new_segment(&api_origin, playlist, &mut grid_seen, grid_end);
    let (_, _, grid_segment) = wait_new_segment(&api_origin, playlist, &mut grid_seen, grid_end);
    let ffmpeg = PathBuf::from(std::env::var("OTTPLAY_MULTIVIEW_FFMPEG").unwrap());
    let (rgb, grid_proof) = decode_segment_rgb(&ffmpeg, &grid_segment);
    for slot_id in 0..9usize {
        let x = [107, 320, 533][slot_id % 3];
        let y = [60, 180, 300][slot_id / 3];
        assert_cell_color(&rgb, x, y, (slot_id % 3 + 1) as u8);
    }
    let pcm = decode_segment_pcm(&ffmpeg, &grid_segment, PcmProofRole::Grid, &grid_proof);
    assert_audio_tone(&pcm, 330.0);

    // Stop and close every real slot before the separate sustained replacement
    // scenario; verify source processes and private output are actually retired.
    for slot_id in 0..9usize {
        renew_due(
            &api_origin,
            TOKEN,
            &mut latest,
            &mut slot_natives,
            &mut grid_next_renew,
            &mut grid_renew_sequence,
        );
        let current = snapshot(&api_origin, TOKEN, &latest, "grid_stop_status");
        let context = context_for_slot(&current, slot_id as u64, &slot_natives[slot_id]);
        let mut next = context["native_expected"].clone();
        next["slot_generation"] = json!(format!("grid_stopped_{slot_id}"));
        next["source_revision"] = json!(format!("grid_stop_source_{slot_id}"));
        latest = control(
            &api_origin,
            TOKEN,
            &context,
            &format!("grid_stop_{slot_id}"),
            json!({"name":"stop"}),
            Some(next),
        )["context"]
            .clone();
        slot_natives[slot_id] = latest["native_expected"].clone();
    }
    let current = snapshot(&api_origin, TOKEN, &latest, "grid_close_status");
    let close_context = context_for_slot(&current, 0, &slot_natives[0]);
    let closed = control(
        &api_origin,
        TOKEN,
        &close_context,
        "grid_close",
        json!({"name":"off"}),
        None,
    );
    assert_eq!(closed["accepted"], true);
    let grid_cleanup = Instant::now() + Duration::from_secs(8);
    while Instant::now() < grid_cleanup
        && (fs::read_dir(&output).unwrap().next().is_some() || upstream.active_connections() != 0)
    {
        thread::sleep(Duration::from_millis(100));
    }
    assert!(
        fs::read_dir(&output).unwrap().next().is_none(),
        "nine-slot grid output was not retired after Off"
    );
    assert_eq!(
        upstream.active_connections(),
        0,
        "nine-slot source connections survived Off"
    );
    upstream.confirm_cleanup(&output, true);

    let native = json!({"runtime":"native_runtime_main","expected":{"scene":"native_scene_main",
        "layout_revision":"layout_main","focus_revision":"focus_main","audio_revision":"audio_main"},
        "slot_id":0,"slot_generation":"slot_main_0","source_revision":"source_main_0"});
    let created = create_session(&api_origin, TOKEN, &server_epoch, native, "create_main");
    let (ctx0, ctx1) = contexts(&created);
    let list0 = catalog(&api_origin, TOKEN, &ctx0, "sources_main_0");
    let ctx0 = list0["context"].clone();
    let mut item_map = HashMap::new();
    for row in list0["items"].as_array().unwrap() {
        item_map.insert(row["item_ref"].as_str().unwrap().to_owned(), row.clone());
    }
    let source_ref = list0["items"][0]["source_ref"].clone();
    assert_eq!(list0["items"].as_array().unwrap().len(), 3);
    let initial = snapshot(&api_origin, TOKEN, &ctx0, "status_before_slot_1");
    let ctx1 = context_for_slot(&initial, 1, &ctx1["native_expected"]);
    let ctx1_catalog = catalog(&api_origin, TOKEN, &ctx1, "sources_main_1");
    let ctx1 = ctx1_catalog["context"].clone();
    assert_eq!(ctx1_catalog["items"].as_array().unwrap().len(), 3);
    let source_a = item_map.get("production_item_1").unwrap();
    let source_b = item_map.get("production_item_2").unwrap();
    let source_c = item_map.get("production_item_3").unwrap();
    assert_eq!(source_a["source_ref"], source_ref);
    let revision = list0["catalog_revision"].clone();
    let mut ctx0 = request_source(&api_origin, TOKEN, &ctx0, source_a, &revision, "main_a");
    let initial = snapshot(&api_origin, TOKEN, &ctx0, "status_before_slot_1_play");
    let mut ctx1 = context_for_slot(&initial, 1, &ctx1["native_expected"]);
    let list1 = catalog(&api_origin, TOKEN, &ctx1, "sources_refresh_slot_1");
    ctx1 = list1["context"].clone();
    let mut ctx1 = request_source(
        &api_origin,
        TOKEN,
        &ctx1,
        source_b,
        &list1["catalog_revision"],
        "main_b",
    );
    let audio_status = snapshot(&api_origin, TOKEN, &ctx1, "main_audio_status");
    ctx0 = context_for_slot(&audio_status, 0, &ctx0["native_expected"]);
    let mut audio_native = ctx0["native_expected"].clone();
    audio_native["expected"]["audio_revision"] = json!("audio_main_slot_zero");
    ctx0 = control(
        &api_origin,
        TOKEN,
        &ctx0,
        "select_main_audio",
        json!({"name":"audio","policy":"slot"}),
        Some(audio_native),
    )["context"]
        .clone();
    let audio_status = snapshot(&api_origin, TOKEN, &ctx0, "main_audio_selected_status");
    ctx1 = context_for_slot(&audio_status, 1, &ctx1["native_expected"]);
    let end = Instant::now() + RUN_LIMIT;
    let _ = wait_slot(&api_origin, TOKEN, &ctx0, 0, "production_item_1", end);
    let first_b = wait_slot(&api_origin, TOKEN, &ctx1, 1, "production_item_2", end);
    let sustained_started = Instant::now();
    let mut output_checked = false;
    let mut initial_probe_deadline: Option<Instant> = None;
    let mut replacement_output_checked = false;
    let mut next_renew = Instant::now() + Duration::from_secs(18);
    let replace_at = sustained_started + Duration::from_secs(92);
    let mut replaced = false;
    let mut replacement_seen = HashSet::new();
    let mut replacement_b_baseline = None;
    let mut first_replacement_sequence = None;
    let mut last_b_frames = slot(&first_b, 1)["frames"].as_u64().unwrap();
    let mut main_seen = playlist_snapshot_seed_until(
        &api_origin,
        first_b["output"]["playlist_path"]
            .as_str()
            .expect("initial HLS playlist"),
        end,
    )
    .unwrap_or_else(|failure| panic!("initial HLS playlist snapshot: {failure}"))
    .1
    .into_iter()
    .collect::<HashSet<_>>();
    let mut late_progress_baseline = None;
    let mut last_b_progress = Instant::now();
    let mut sibling_absent = 0u8;
    let mut sibling_last_seen = Instant::now();
    while Instant::now() < end && started.elapsed() < RUN_LIMIT {
        let last_status = snapshot(&api_origin, TOKEN, &ctx0, "long_status");
        let b_now = slot(&last_status, 1)["frames"].as_u64().unwrap();
        assert!(
            b_now >= last_b_frames,
            "sibling stream frame counter moved backwards"
        );
        if b_now > last_b_frames {
            last_b_frames = b_now;
            last_b_progress = Instant::now();
        }
        if late_progress_baseline.is_none()
            && sustained_started.elapsed() >= Duration::from_secs(170)
        {
            late_progress_baseline = Some(b_now);
        }
        let sibling = slot(&last_status, 1);
        if sibling["source_ref"].as_str().is_some() {
            sibling_absent = 0;
            sibling_last_seen = Instant::now();
        } else {
            // Authority is derived per status sample, so a single sample may
            // legitimately straddle a session or lease transition. Name the
            // cause and hold the strict bound to three consecutive samples.
            sibling_absent = sibling_absent.saturating_add(1);
            let sibling_state = sibling["state"].as_str().unwrap_or("unknown");
            let cause = if sibling_state.eq_ignore_ascii_case("playing") {
                "authority_lost"
            } else {
                "slot_state"
            };
            assert!(
                sibling_absent < 3,
                "sibling source authority disappeared for {sibling_absent} consecutive samples \
                 cause={cause} sibling_state={sibling_state} absent_before={:?} \
                 session={} session_state={} slot0={} slot1={}",
                sibling_last_seen.elapsed(),
                last_status["session_id"],
                last_status["state"],
                slot(&last_status, 0),
                sibling
            );
        }
        if !output_checked {
            if let Some(path) = last_status["output"]["playlist_path"].as_str() {
                if let Some((_, _, bytes)) = try_new_segment(&api_origin, path, &mut main_seen) {
                    let ffmpeg = PathBuf::from(std::env::var("OTTPLAY_MULTIVIEW_FFMPEG").unwrap());
                    let (rgb, proof) = decode_segment_rgb(&ffmpeg, &bytes);
                    if cell_matches_color(&rgb, 160, 180, 1)
                        && cell_matches_color(&rgb, 480, 180, 2)
                    {
                        assert_audio_tone(
                            &decode_segment_pcm(
                                &ffmpeg,
                                &bytes,
                                PcmProofRole::InitialSustained,
                                &proof,
                            ),
                            330.0,
                        );
                        output_checked = true;
                    } else {
                        // A segment published across the automatic credential-boundary
                        // session restart can still carry the previous grid, so keep
                        // probing new segments until the sampling window closes.
                        let deadline = *initial_probe_deadline
                            .get_or_insert_with(|| Instant::now() + Duration::from_secs(12));
                        assert!(
                            Instant::now() < deadline,
                            "normal HLS output did not show both sustained slot colours \
                             within the bounded probe window"
                        );
                    }
                }
            }
        }
        if !replaced && Instant::now() >= replace_at {
            let current = snapshot(&api_origin, TOKEN, &ctx0, "pre_stop");
            let before_playlist = current["output"]["playlist_path"]
                .as_str()
                .expect("pre-replacement HLS playlist");
            replacement_seen = playlist_snapshot_seed_until(&api_origin, before_playlist, end)
                .unwrap_or_else(|failure| {
                    panic!("pre-replacement HLS playlist snapshot: {failure}")
                })
                .1
                .into_iter()
                .collect();
            replacement_b_baseline = Some(slot(&current, 1)["frames"].as_u64().unwrap());
            ctx0 = context_for_slot(&current, 0, &current["native_expected"]);
            let mut next = current["native_expected"].clone();
            next["slot_generation"] = json!("slot_main_0_replaced");
            next["source_revision"] = json!("source_main_0_replaced");
            let stopped = control(
                &api_origin,
                TOKEN,
                &ctx0,
                "stop_old_source",
                json!({"name":"stop"}),
                Some(next),
            );
            ctx0 = stopped["context"].clone();
            let list = catalog(&api_origin, TOKEN, &ctx0, "sources_after_stop");
            ctx0 = list["context"].clone();
            let current_c = list["items"]
                .as_array()
                .unwrap()
                .iter()
                .find(|item| item["item_ref"] == "production_item_3")
                .unwrap()
                .clone();
            ctx0 = request_source(
                &api_origin,
                TOKEN,
                &ctx0,
                &current_c,
                &list["catalog_revision"],
                "main_c",
            );
            replaced = true;
        }
        if replaced && !replacement_output_checked {
            let current = snapshot(&api_origin, TOKEN, &ctx0, "replacement_output_status");
            if slot(&current, 0)["item_ref"] == "production_item_3" {
                if let Some(path) = current["output"]["playlist_path"].as_str() {
                    if let Some((sequence, _, bytes)) =
                        try_new_segment(&api_origin, path, &mut replacement_seen)
                    {
                        let ffmpeg =
                            PathBuf::from(std::env::var("OTTPLAY_MULTIVIEW_FFMPEG").unwrap());
                        let (rgb, proof) = decode_segment_rgb(&ffmpeg, &bytes);
                        let pcm =
                            decode_segment_pcm(&ffmpeg, &bytes, PcmProofRole::Replacement, &proof);
                        assert!(
                            !cell_matches_color(&rgb, 160, 180, 1),
                            "old source A appeared in a newly published post-replacement segment"
                        );
                        assert!(!audio_tone_matches(&pcm, 330.0),
                            "old source A audio appeared in a newly published post-replacement segment");
                        replacement_output_checked = cell_matches_color(&rgb, 160, 180, 3)
                            && cell_matches_color(&rgb, 480, 180, 2)
                            && audio_tone_matches(&pcm, 550.0);
                        if replacement_output_checked {
                            first_replacement_sequence = Some(sequence);
                        }
                    }
                }
            }
        }
        if Instant::now() >= next_renew {
            let current = snapshot(&api_origin, TOKEN, &ctx0, "renew_status");
            ctx0 = context_for_slot(&current, 0, &current["native_expected"]);
            let renewed = control(
                &api_origin,
                TOKEN,
                &ctx0,
                &format!("renew_{}", sustained_started.elapsed().as_secs()),
                json!({"name":"renew"}),
                None,
            );
            ctx0 = renewed["context"].clone();
            next_renew = Instant::now() + Duration::from_secs(18);
        }
        if replaced && sustained_started.elapsed() >= Duration::from_secs(185) {
            assert!(
                last_b_progress.elapsed() <= Duration::from_secs(8),
                "sibling frame counter stopped advancing during the late sustained interval"
            );
            break;
        }
        thread::sleep(Duration::from_millis(500));
    }
    assert!(
        replaced,
        "source replacement did not run within sustained test"
    );
    assert!(
        sustained_started.elapsed() >= Duration::from_secs(185),
        "main media session did not remain active for the qualified duration"
    );
    assert!(
        output_checked,
        "normal HLS output did not contain a probeable A/V segment"
    );
    assert!(
        replacement_output_checked,
        "replacement HLS output did not show the new source/audio without the stopped source"
    );
    assert!(
        last_b_frames > 2,
        "sibling did not continue producing frames during source replacement"
    );
    let after_replace = snapshot(&api_origin, TOKEN, &ctx0, "post_replace_status");
    assert!(
        slot(&after_replace, 1)["frames"].as_u64().unwrap() > replacement_b_baseline.unwrap_or(0),
        "sibling frame counter did not advance after source replacement"
    );
    let current = snapshot(&api_origin, TOKEN, &ctx0, "final_status");
    assert_eq!(slot(&current, 0)["source_ref"], source_c["source_ref"]);
    assert_eq!(slot(&current, 0)["item_ref"], source_c["item_ref"]);
    assert_eq!(slot(&current, 1)["item_ref"], source_b["item_ref"]);
    let late_playlist = current["output"]["playlist_path"]
        .as_str()
        .expect("late replacement HLS playlist");
    let late_ffmpeg = PathBuf::from(std::env::var("OTTPLAY_MULTIVIEW_FFMPEG").unwrap());
    let late_deadline = Instant::now() + Duration::from_secs(12);
    let (late_rgb, late_pcm) = loop {
        let (late_sequence, _, late_segment) = wait_new_segment(
            &api_origin,
            late_playlist,
            &mut replacement_seen,
            late_deadline,
        );
        assert!(
            late_sequence > first_replacement_sequence.unwrap_or(0),
            "late replacement output did not advance beyond the first confirmed new-source segment"
        );
        let (rgb, proof) = decode_segment_rgb(&late_ffmpeg, &late_segment);
        let pcm = decode_segment_pcm(
            &late_ffmpeg,
            &late_segment,
            PcmProofRole::LateSustained,
            &proof,
        );
        assert!(
            !cell_matches_color(&rgb, 160, 180, 1),
            "old video source returned in late HLS output"
        );
        assert!(
            !audio_tone_matches(&pcm, 330.0),
            "old audio source returned in late HLS output"
        );
        // The first segment after a credential-boundary restart may still show the
        // pre-restart grid; require a coherent segment inside the bounded window.
        if cell_matches_color(&rgb, 160, 180, 3)
            && cell_matches_color(&rgb, 480, 180, 2)
            && audio_tone_matches(&pcm, 550.0)
        {
            break (rgb, pcm);
        }
    };
    assert_cell_color(&late_rgb, 160, 180, 3);
    assert_cell_color(&late_rgb, 480, 180, 2);
    assert_audio_tone(&late_pcm, 550.0);
    let final_status = snapshot(&api_origin, TOKEN, &ctx0, "final_progress_status");
    let final_b_frames = slot(&final_status, 1)["frames"].as_u64().unwrap();
    assert!(
        final_b_frames > slot(&after_replace, 1)["frames"].as_u64().unwrap(),
        "sibling frame counter did not advance during the final HLS sample window"
    );
    assert!(
        final_b_frames > late_progress_baseline.unwrap_or(0),
        "sibling source did not continue advancing through the late sustained interval"
    );
    let counts = upstream.request_counts();
    if mode == ProductionMode::RawMpegTs {
        for source in 1..=3 {
            assert!(
                counts
                    .get(&format!("source-{source}.ts"))
                    .copied()
                    .unwrap_or(0)
                    >= 2
            );
        }
    } else {
        let audit = upstream.hls.as_ref().unwrap().audit();
        assert!(audit.master.iter().all(|count| *count >= 2));
        assert!(audit.media.iter().all(|count| *count >= 2));
        assert!(audit.segments.iter().all(|source| source
            .iter()
            .filter(|count| **count > 0)
            .count()
            >= 8));
        assert_eq!(
            audit.future_denied, 0,
            "runtime requested unpublished or expired source window"
        );
    }
    let client = fixture_http();
    let https_control_requests = client.https_control_requests.load(Ordering::Relaxed);
    let https_media_requests = client.https_media_requests.load(Ordering::Relaxed);
    assert!(
        https_control_requests > 0,
        "private control API was not exercised over HTTPS"
    );
    assert!(
        https_media_requests > 0,
        "private HLS media was not exercised over HTTPS"
    );
    // Stop both active slots, close the session, and wait for the owned binary
    // and process tree to retire its private output directory before deletion.
    let mut latest_context = ctx0.clone();
    let mut slot_native = [
        ctx0["native_expected"].clone(),
        ctx1["native_expected"].clone(),
    ];
    for id in [0u8, 1u8] {
        let current = snapshot(&api_origin, TOKEN, &latest_context, "stop_final_status");
        let fresh = context_for_slot(&current, u64::from(id), &slot_native[usize::from(id)]);
        let mut next = fresh["native_expected"].clone();
        next["slot_generation"] = json!(format!("slot_final_{id}"));
        next["source_revision"] = json!(format!("source_final_{id}"));
        let response = control(
            &api_origin,
            TOKEN,
            &fresh,
            &format!("stop_final_{id}"),
            json!({"name":"stop"}),
            Some(next),
        );
        latest_context = response["context"].clone();
        slot_native[usize::from(id)] = latest_context["native_expected"].clone();
    }
    let current = snapshot(&api_origin, TOKEN, &latest_context, "close_status");
    let close_context = context_for_slot(&current, 0, &slot_native[0]);
    let close = control(
        &api_origin,
        TOKEN,
        &close_context,
        "close_main",
        json!({"name":"off"}),
        None,
    );
    assert_eq!(close["accepted"], true);
    upstream.confirm_cleanup(&output, true);
    let mut sequential_sessions = HashSet::new();
    let mut sequential_outputs = HashSet::new();
    for index in 0..17 {
        assert!(
            started.elapsed() < RUN_LIMIT,
            "17-context qualification exceeded budget"
        );
        let (ctx, output_path, session_id, generation) = start_single_playing_context(
            &api_origin,
            &server_epoch,
            &format!("sequential_{index}"),
        );
        assert!(sequential_sessions.insert(session_id));
        assert!(sequential_outputs.insert(generation));
        let closed = control(
            &api_origin,
            TOKEN,
            &ctx,
            &format!("sequential_off_{index}"),
            json!({"name":"off"}),
            None,
        );
        assert_eq!(closed["accepted"], true);
        upstream.confirm_cleanup(&output, false);
        let stale = get(&api_origin, &output_path, None, 256 * 1024).0;
        assert!(
            matches!(stale, 401 | 403 | 404 | 410),
            "retired output remained readable or failed unexpectedly"
        );
    }
    assert_eq!(sequential_sessions.len(), 17);
    assert_eq!(sequential_outputs.len(), 17);
    // A NEW actual Playing/output context must be alive at SIGTERM. There is
    // intentionally no Off between this observation and the owned signal.
    let (_active_ctx, _active_path, active_session, active_generation) =
        start_single_playing_context(&api_origin, &server_epoch, "active_sigterm");
    assert!(!sequential_sessions.contains(&active_session));
    assert!(!sequential_outputs.contains(&active_generation));
    assert!(fs::read_dir(&output).unwrap().next().is_some());
    assert!(upstream.source_was_read(mode));
    let signal = unsafe { libc::kill(server.0.id() as i32, libc::SIGTERM) };
    assert_eq!(signal, 0, "send daemon SIGTERM to owned normal server");
    let shutdown_deadline = Instant::now() + NORMAL_SERVER_SHUTDOWN_LIMIT;
    let exit = loop {
        if let Some(exit) = server.0.try_wait().expect("owned server status") {
            break exit;
        }
        assert!(
            Instant::now() < shutdown_deadline,
            "normal server did not finish graceful backend shutdown"
        );
        thread::sleep(Duration::from_millis(100));
    };
    assert!(
        exit.success(),
        "normal server shutdown failed after backend cleanup"
    );
    for _ in 0..50 {
        if fs::read_dir(&output).unwrap().next().is_none() {
            break;
        }
        thread::sleep(Duration::from_millis(100));
    }
    assert!(
        fs::read_dir(&output).unwrap().next().is_none(),
        "normal binary output files were not retired"
    );
    upstream.confirm_cleanup(&output, true);
    assert!(
        started.elapsed() < RUN_LIMIT,
        "production fixture exceeded unchanged600-second work bound"
    );
    let hls_source_evidence = upstream.hls.as_ref().map(|hls| json!({"audit":hls.audit(),"inputs":hls.input_receipt(),"stable_retirement_interval_seconds":12}));
    drop(upstream);
    root.remove()
        .expect("remove owned private normal-binary fixture directory");
    assert!(
        !root.0.exists(),
        "owned production fixture directory survived cleanup"
    );
    let receipt_path = PathBuf::from(
        std::env::var_os("OTTPLAY_MULTIVIEW_PRODUCTION_RECEIPT").expect("owned receipt path"),
    );
    let receipt = json!({
        "schema":"ottplay.multiview.production-binary.v1","pass":true,
        "output_segment_video_proofs":SEGMENT_VIDEO_PROOFS.with(|rows| rows.borrow().clone()),
        "seed_refusal_summaries":seed_refusal_receipt(),
        "input_adapter":mode.adapter(),"sequential_contexts":sequential_sessions.len(),
        "sequential_output_generations":sequential_outputs.len(),"active_sigterm":true,"hls_source":hls_source_evidence,
        "tls":tls.receipt(),
        "https_control_requests":https_control_requests,"https_media_requests":https_media_requests,
        "scope":if mode == ProductionMode::RawMpegTs { "Normal production HTTPS control/HLS with a private RFC1918 HTTP MPEG-TS adapter, all nine advertised slots and private HLS output; no native-player or physical-television qualification" } else { "Normal production HTTPS control/HLS with a private RFC1918 live HLS MPEG-TS adapter, one master level and sliding media windows; no native-player or physical-television qualification" },
        "elapsed_seconds":started.elapsed().as_secs(),"sustained_seconds":sustained_started.elapsed().as_secs(),
        "credential_expiry_rejected":expired,
        "credential_clock":credential_clock,
        "expiry_output_was_active":true,"expired_source_connections_closed":true,
        "expired_output_cleanup":true,"graceful_shutdown":true,"shutdown_signal":"SIGTERM",
        "output_directory_empty":true,
        "owned_fixture_root_removed":true,
        "source_replacement":true,"nine_slot_grid_rgb":true,"selected_audio_tone":true,
        "replacement_audio_tone":replacement_output_checked,"sibling_frames_before_replace":replacement_b_baseline,
        "sibling_frames_after_replace":slot(&after_replace,1)["frames"],"hls_segment_audio_video":true,
        "replacement_late_segment":true,"sibling_frames_recent_at_end":true,
        "upstream_request_counts":counts,
        "inputs":inputs.iter().map(|(id,_,sha,bytes)|json!({"id":id,"sha256":sha,"bytes":bytes})).collect::<Vec<_>>(),
    });
    let raw = serde_json::to_vec(&receipt).unwrap();
    let mut receipt_file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&receipt_path)
        .expect("fresh fixture receipt");
    receipt_file.write_all(&raw).unwrap();
    receipt_file.sync_all().unwrap();
}
