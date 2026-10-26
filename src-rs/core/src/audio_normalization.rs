//! Bounded, opt-in remuxing for hosts that authorize the input source.
//!
//! This module is not a URL proxy: callers must authenticate requests and authorize
//! the source before calling `start`. Output capabilities must not appear in logs.
use anyhow::{bail, Context, Result};
use serde::Deserialize;
use std::{
    collections::{HashMap, VecDeque},
    path::{Path, PathBuf},
    process::Stdio,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tokio::{
    io::AsyncReadExt,
    process::Command,
    sync::{watch, OwnedSemaphorePermit, Semaphore},
};

#[derive(Clone)]
pub struct Config {
    pub ffmpeg: PathBuf,
    pub ffprobe: PathBuf,
    pub directory: PathBuf,
    pub sessions: usize,
    pub disk_limit: u64,
    pub startup_timeout: Duration,
    pub idle_timeout: Duration,
    pub lease_duration: Duration,
}

#[derive(Clone, Debug, Deserialize)]
pub struct AudioTrack {
    pub index: usize,
    #[serde(default)]
    pub codec_name: String,
    #[serde(default)]
    pub tags: HashMap<String, String>,
}
#[derive(Deserialize)]
struct Probe {
    streams: Vec<AudioTrack>,
}

struct Session {
    cancel: watch::Sender<bool>,
    touched: Mutex<Instant>,
    renewed: Mutex<Instant>,
    directory: PathBuf,
    producing: AtomicBool,
    retained_until: Mutex<Option<Instant>>,
    retain_seconds: AtomicU64,
}
struct Job {
    id: String,
    session: Arc<Session>,
    source: String,
    tracks: Vec<AudioTrack>,
    cancel: watch::Receiver<bool>,
    _permit: OwnedSemaphorePermit,
    _directory_permit: OwnedSemaphorePermit,
    ready: tokio::sync::oneshot::Sender<Result<()>>,
}
struct Inner {
    config: Config,
    slots: Arc<Semaphore>,
    directory_slots: Arc<Semaphore>,
    sessions: Mutex<HashMap<String, Arc<Session>>>,
    retired: Mutex<VecDeque<String>>,
    #[cfg(test)]
    cleanup_gate: Mutex<Option<(Arc<tokio::sync::Notify>, Arc<tokio::sync::Notify>)>>,
}
#[derive(Clone)]
pub struct Manager(Arc<Inner>);

impl Manager {
    /// Executables are supplied by the host, never fetched or installed here.
    pub async fn new(mut config: Config) -> Result<Self> {
        if config.sessions == 0
            || config.sessions > 8
            || config.disk_limit < 1024 * 1024
            || config.startup_timeout.is_zero()
            || config.idle_timeout.is_zero()
            || config.lease_duration.is_zero()
        {
            bail!("invalid normalization limits");
        }
        config.ffmpeg = tokio::fs::canonicalize(&config.ffmpeg)
            .await
            .context("ffmpeg unavailable")?;
        config.ffprobe = tokio::fs::canonicalize(&config.ffprobe)
            .await
            .context("ffprobe unavailable")?;
        for (path, name) in [(&config.ffmpeg, "ffmpeg"), (&config.ffprobe, "ffprobe")] {
            let mut cmd = Command::new(path);
            cmd.arg("-version");
            let version = capture(cmd, Duration::from_secs(3), 16384)
                .await
                .context("media executable unavailable")?;
            if !version.starts_with(format!("{name} version ").as_bytes()) {
                bail!("unexpected media executable");
            }
        }
        tokio::fs::create_dir_all(&config.directory).await?;
        config.directory = tokio::fs::canonicalize(&config.directory).await?;
        Ok(Self(Arc::new(Inner {
            slots: Arc::new(Semaphore::new(config.sessions)),
            directory_slots: Arc::new(Semaphore::new(config.sessions * 2)),
            config,
            sessions: Mutex::new(HashMap::new()),
            retired: Mutex::new(VecDeque::new()),
            #[cfg(test)]
            cleanup_gate: Mutex::new(None),
        })))
    }

    /// The route/host must validate ownership and destination authorization first.
    pub async fn probe(&self, authorized_source: &str) -> Result<Vec<AudioTrack>> {
        validate_source(authorized_source)?;
        let _slot = self
            .0
            .slots
            .clone()
            .try_acquire_owned()
            .context("normalization capacity reached")?;
        let mut command = Command::new(&self.0.config.ffprobe);
        command.args([
            "-v",
            "error",
            "-rw_timeout",
            "10000000",
            "-protocol_whitelist",
            "http,https,tcp,tls,crypto",
            "-format_whitelist",
            "hls,mpegts,mov,aac,mp3,ac3,eac3,webvtt",
            "-max_streams",
            "32",
            "-probesize",
            "2097152",
            "-analyzeduration",
            "3000000",
            "-select_streams",
            "a",
            "-show_entries",
            "stream=index,codec_name:stream_tags=language,title",
            "-of",
            "json",
            authorized_source,
        ]);
        let bytes = capture(command, Duration::from_secs(8), 65536).await?;
        let probe: Probe = serde_json::from_slice(&bytes).context("invalid media inventory")?;
        if probe.streams.len() > 16 {
            bail!("too many audio streams");
        }
        Ok(probe.streams)
    }

    /// Start only after the host confirmed a muxed source requires normalization.
    /// Dropping the start future cancels startup. A successful session must be closed
    /// by its playback lease; idle/lease_duration limits provide an additional bound.
    pub async fn start(&self, authorized_source: &str, tracks: &[AudioTrack]) -> Result<String> {
        self.start_named(
            uuid::Uuid::new_v4().simple().to_string(),
            authorized_source,
            tracks,
        )
        .await
    }
    pub async fn start_named(
        &self,
        id: String,
        authorized_source: &str,
        tracks: &[AudioTrack],
    ) -> Result<String> {
        if id.len() != 32 || !id.bytes().all(|b| b.is_ascii_hexdigit()) {
            bail!("invalid session identifier");
        }
        validate_source(authorized_source)?;
        if !(2..=16).contains(&tracks.len()) {
            bail!("normalization requires multiple audio streams");
        }
        let permit = self
            .0
            .slots
            .clone()
            .try_acquire_owned()
            .context("normalization capacity reached")?;
        let directory_permit = self
            .0
            .directory_slots
            .clone()
            .try_acquire_owned()
            .context("normalization retained-media capacity reached")?;
        let directory = self.0.config.directory.join(&id);
        tokio::fs::create_dir(&directory).await?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            tokio::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700)).await?;
        }
        let (cancel, receiver) = watch::channel(false);
        let session = Arc::new(Session {
            cancel,
            touched: Mutex::new(Instant::now()),
            renewed: Mutex::new(Instant::now()),
            directory,
            producing: AtomicBool::new(true),
            retained_until: Mutex::new(None),
            retain_seconds: AtomicU64::new(40),
        });
        self.0
            .sessions
            .lock()
            .unwrap()
            .insert(id.clone(), session.clone());
        let mut guard = StartupGuard(Some(session.clone()));
        let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
        let manager = self.clone();
        let source = authorized_source.to_owned();
        let tracks = tracks.to_vec();
        let task_id = id.clone();
        tokio::spawn(async move {
            manager
                .run(Job {
                    id: task_id,
                    session,
                    source,
                    tracks,
                    cancel: receiver,
                    _permit: permit,
                    _directory_permit: directory_permit,
                    ready: ready_tx,
                })
                .await;
        });
        let started = ready_rx
            .await
            .context("normalization startup stopped")
            .and_then(|result| result);
        if let Err(error) = started {
            self.close_and_wait(&id)
                .await
                .context("normalization startup cleanup failed")?;
            return Err(error);
        }
        guard.0 = None;
        Ok(id)
    }

    pub fn is_active(&self, id: &str) -> bool {
        self.0
            .sessions
            .lock()
            .unwrap()
            .get(id)
            .is_some_and(|session| {
                !*session.cancel.borrow()
                    && session
                        .retained_until
                        .lock()
                        .unwrap()
                        .is_none_or(|until| until > Instant::now())
            })
    }

    pub fn is_producing(&self, id: &str) -> bool {
        self.0
            .sessions
            .lock()
            .unwrap()
            .get(id)
            .is_some_and(|session| session.producing.load(Ordering::Acquire))
    }
    pub fn close(&self, id: &str) {
        if let Some(session) = self.0.sessions.lock().unwrap().get(id) {
            let _ = session.cancel.send(true);
        }
    }

    /// Release the producer and wait for process termination and file removal.
    pub async fn close_and_wait(&self, id: &str) -> Result<()> {
        self.close(id);
        tokio::time::timeout(Duration::from_secs(5), async {
            while self.0.sessions.lock().unwrap().contains_key(id) {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .context("normalization shutdown timed out")
    }

    /// Exact generated names only; never expose an arbitrary filesystem path.
    pub async fn read(&self, id: &str, name: &str) -> Result<Vec<u8>> {
        if !valid_name(name) {
            bail!("invalid media resource");
        }
        let session = self
            .0
            .sessions
            .lock()
            .unwrap()
            .get(id)
            .cloned()
            .context("media session unavailable")?;
        let retained_until = *session.retained_until.lock().unwrap();
        if *session.cancel.borrow()
            || retained_until.is_some_and(|until| until <= Instant::now())
            || (retained_until.is_none()
                && (session.renewed.lock().unwrap().elapsed() >= self.0.config.lease_duration
                    || session.touched.lock().unwrap().elapsed() >= self.0.config.idle_timeout))
        {
            bail!("media session expired");
        }
        *session.touched.lock().unwrap() = Instant::now();
        *session.renewed.lock().unwrap() = Instant::now();
        let path = session.directory.join(name);
        let metadata = tokio::fs::symlink_metadata(&path)
            .await
            .context("media resource unavailable")?;
        if !metadata.is_file() || metadata.len() > self.0.config.disk_limit {
            bail!("invalid media resource");
        }
        let file = tokio::fs::File::open(path)
            .await
            .context("media resource unavailable")?;
        let limit = self.0.config.disk_limit.min(16 * 1024 * 1024);
        let mut bytes = Vec::new();
        file.take(limit + 1)
            .read_to_end(&mut bytes)
            .await
            .context("media resource unavailable")?;
        if bytes.len() as u64 > limit {
            bail!("media resource limit reached");
        }
        if name.ends_with(".m3u8") {
            let playlist = std::str::from_utf8(&bytes).context("invalid media playlist")?;
            if playlist.contains("#EXT-X-TARGETDURATION:") {
                session.retain_seconds.fetch_max(
                    retention_seconds(playlist).context("media window exceeds retention budget")?,
                    Ordering::Relaxed,
                );
            }
        }
        Ok(bytes)
    }

    async fn run(&self, job: Job) {
        let Job {
            id,
            session,
            source,
            tracks,
            mut cancel,
            _permit,
            _directory_permit,
            ready,
        } = job;
        let config = &self.0.config;
        let mut permit = Some(_permit);
        let mut ready = Some(ready);
        let mut retain = false;
        let result: Result<()> = async {
            let mut command = Command::new(&config.ffmpeg);
            // Bound probing; live HLS already supplies pacing, so -re would lag behind its window.
            command.args(["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-rw_timeout", "10000000", "-protocol_whitelist", "http,https,tcp,tls,crypto", "-format_whitelist", "hls,mpegts,mov,aac,mp3,ac3,eac3,webvtt", "-max_streams", "32", "-probesize", "2097152", "-analyzeduration", "3000000", "-live_start_index", "-3", "-i", &source, "-map", "0:v:0"]);
            for (index,track) in tracks.iter().enumerate() {
                command.args(["-map", &format!("0:a:{index}")]);
                if track.codec_name=="aac" { command.args([&format!("-bsf:a:{index}"),"aac_adtstoasc"]); }
            }
            command.args(["-c", "copy", "-b:v", "8000000", "-master_pl_publish_rate", "1", "-f", "hls", "-hls_segment_type", "fmp4", "-hls_fmp4_init_filename", "track_%v_init.mp4", "-hls_time", "2", "-hls_list_size", "6", "-hls_delete_threshold", "2", "-hls_flags", "delete_segments+temp_file", "-hls_segment_filename", "track_%v_%09d.m4s", "-master_pl_name", "master.m3u8", "-var_stream_map", &stream_map(&tracks), "track_%v.m3u8"]);
            let mut child = command.current_dir(&session.directory).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).kill_on_drop(true).spawn().context("normalization process unavailable")?;
            let start = Instant::now();
            let mut interval = tokio::time::interval(Duration::from_millis(200));
            let result = loop {
                tokio::select! {
                    _ = cancel.changed() => break Ok(()),
                    status = child.wait() => {
                        retain = ready.is_none();
                        break match status { Ok(status) if status.success() && ready.is_none() => Ok(()), _ => Err(anyhow::anyhow!("normalization process stopped")) };
                    },
                    _ = interval.tick() => {
                        if *cancel.borrow() { break Ok(()); }
                        if ready.is_none() && (session.renewed.lock().unwrap().elapsed() > config.lease_duration || session.touched.lock().unwrap().elapsed() > config.idle_timeout) { break Ok(()); }
                        if directory_size(&session.directory).await? > config.disk_limit { break Err(anyhow::anyhow!("normalization disk limit reached")); }
                        if ready.is_some() {
                            if output_ready(&session.directory, tracks.len() + 1).await {
                                if let Some(sender) = ready.take() { *session.renewed.lock().unwrap()=Instant::now(); *session.touched.lock().unwrap()=Instant::now(); let _ = sender.send(Ok(())); }
                            } else if start.elapsed() > config.startup_timeout { break Err(anyhow::anyhow!("normalization startup timed out")); }
                        }
                    }
                }
            };
            let _ = child.kill().await;
            let _ = child.wait().await;
            result
        }.await;
        if let Some(sender) = ready {
            let _ = sender.send(Err(anyhow::anyhow!("normalization unavailable")));
        }
        if result.is_err() {
            tracing::debug!("audio normalization session ended");
        }
        session.producing.store(false, Ordering::Release);
        if retain && !*cancel.borrow() {
            let deadline = Instant::now()
                + Duration::from_secs(session.retain_seconds.load(Ordering::Relaxed));
            *session.retained_until.lock().unwrap() = Some(deadline);
            let oldest = {
                let mut retired = self.0.retired.lock().unwrap();
                retired.push_back(id.clone());
                if retired.len() > self.0.config.sessions {
                    retired.pop_front()
                } else {
                    None
                }
            };
            if let Some(oldest) = oldest {
                let _ = self.close_and_wait(&oldest).await;
            }
            drop(permit.take());
            if !*cancel.borrow() {
                tokio::select! { _ = cancel.changed() => {}, _ = tokio::time::sleep_until(deadline.into()) => {} }
            }
        }
        #[cfg(test)]
        {
            let gate = self.0.cleanup_gate.lock().unwrap().take();
            if let Some((entered, release)) = gate {
                entered.notify_one();
                release.notified().await;
            }
        }
        let _ = tokio::fs::remove_dir_all(&session.directory).await;
        drop(permit.take());
        drop(_directory_permit);
        self.0.sessions.lock().unwrap().remove(&id);
        self.0
            .retired
            .lock()
            .unwrap()
            .retain(|retired| retired != &id);
    }
}
struct StartupGuard(Option<Arc<Session>>);
impl Drop for StartupGuard {
    fn drop(&mut self) {
        if let Some(session) = &self.0 {
            let _ = session.cancel.send(true);
        }
    }
}

fn validate_source(source: &str) -> Result<()> {
    let url = reqwest::Url::parse(source).context("invalid authorized source")?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        bail!("unsupported authorized source");
    }
    Ok(())
}
fn valid_name(name: &str) -> bool {
    name == "master.m3u8"
        || name.strip_prefix("track_").is_some_and(|rest| {
            let (stem, suffix) = if let Some(stem) = rest.strip_suffix(".m3u8") {
                (stem, false)
            } else if let Some(stem) = rest.strip_suffix("_init.mp4") {
                (stem, false)
            } else if let Some(stem) = rest
                .strip_suffix(".m4s")
                .or_else(|| rest.strip_suffix(".ts"))
            {
                (stem, true)
            } else {
                return false;
            };
            let parts: Vec<_> = stem.split('_').collect();
            parts.len() == if suffix { 2 } else { 1 }
                && parts
                    .iter()
                    .all(|part| !part.is_empty() && part.bytes().all(|b| b.is_ascii_digit()))
        })
}
fn stream_map(tracks: &[AudioTrack]) -> String {
    let mut result = String::from("v:0,agroup:sound");
    for (index, track) in tracks.iter().enumerate() {
        let language = track
            .tags
            .get("language")
            .filter(|language| {
                (2..=3).contains(&language.len())
                    && language.bytes().all(|b| b.is_ascii_alphabetic())
            })
            .map(String::as_str)
            .unwrap_or("und");
        result.push_str(&format!(
            " a:{index},agroup:sound,language:{language},default:{}",
            if index == 0 { "yes" } else { "no" }
        ));
    }
    result
}
fn retention_seconds(playlist: &str) -> Option<u64> {
    let durations = playlist
        .lines()
        .filter_map(|line| line.strip_prefix("#EXTINF:"))
        .map(|value| value.split(',').next()?.parse::<f64>().ok())
        .collect::<Option<Vec<_>>>()?;
    if durations.is_empty()
        || durations
            .iter()
            .any(|value| !value.is_finite() || *value <= 0.0)
    {
        return None;
    }
    let longest = durations.iter().copied().fold(0.0, f64::max);
    // Retain removed segments for their duration plus the longest advertised
    // window, and allow the bounded replacement startup to finish first.
    let seconds = (durations.iter().sum::<f64>() + longest + 35.0).ceil();
    (seconds <= 180.0).then_some(seconds as u64)
}
async fn output_ready(directory: &Path, tracks: usize) -> bool {
    if !tokio::fs::read_to_string(directory.join("master.m3u8"))
        .await
        .is_ok_and(|master| master.contains("#EXT-X-STREAM-INF:") && master.contains("AUDIO="))
    {
        return false;
    }
    for index in 0..tracks {
        if !tokio::fs::metadata(directory.join(format!("track_{index}_init.mp4")))
            .await
            .is_ok_and(|metadata| metadata.is_file() && metadata.len() > 8)
        {
            return false;
        }
        let Ok(playlist) =
            tokio::fs::read_to_string(directory.join(format!("track_{index}.m3u8"))).await
        else {
            return false;
        };
        if retention_seconds(&playlist).is_none() {
            return false;
        }
        let target = playlist
            .lines()
            .find_map(|line| {
                line.strip_prefix("#EXT-X-TARGETDURATION:")
                    .and_then(|value| value.parse::<f64>().ok())
            })
            .unwrap_or(0.0);
        let duration = playlist
            .lines()
            .filter_map(|line| {
                line.strip_prefix("#EXTINF:")
                    .and_then(|value| value.split(',').next())
                    .and_then(|value| value.parse::<f64>().ok())
            })
            .sum::<f64>();
        if !target.is_finite() || target <= 0.0 || !duration.is_finite() || duration < target * 3.0
        {
            return false;
        }
        let segments: Vec<_> = playlist
            .lines()
            .filter(|line| !line.starts_with('#') && valid_name(line))
            .collect();
        if segments.len() < 3 {
            return false;
        }
        for segment in segments {
            if tokio::fs::metadata(directory.join(segment)).await.is_err() {
                return false;
            }
        }
    }
    true
}
async fn directory_size(directory: &Path) -> Result<u64> {
    let mut entries = tokio::fs::read_dir(directory).await?;
    let mut size = 0u64;
    while let Some(entry) = entries.next_entry().await? {
        size = size.saturating_add(directory_entry_size(entry.metadata().await)?);
    }
    Ok(size)
}
fn directory_entry_size(metadata: std::io::Result<std::fs::Metadata>) -> Result<u64> {
    match metadata {
        Ok(metadata) => Ok(metadata.len()),
        // FFmpeg may delete a segment or rename a temporary playlist during the scan.
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(0),
        Err(error) => Err(error.into()),
    }
}
async fn capture(mut command: Command, timeout: Duration, limit: usize) -> Result<Vec<u8>> {
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .context("media executable unavailable")?;
    let mut stdout = child.stdout.take().context("media inventory unavailable")?;
    let result = tokio::time::timeout(timeout, async {
        let mut bytes = Vec::new();
        (&mut stdout)
            .take(limit as u64 + 1)
            .read_to_end(&mut bytes)
            .await?;
        if bytes.len() > limit {
            bail!("media inventory limit reached");
        }
        if !child.wait().await?.success() {
            bail!("media inspection failed");
        }
        Ok(bytes)
    })
    .await;
    let _ = child.kill().await;
    let _ = child.wait().await;
    result.context("media inspection timed out")?
}

#[cfg(test)]
mod tests {
    #[test]
    fn retention_covers_the_advertised_window_and_bounded_replacement() {
        assert_eq!(
            super::retention_seconds("#EXTINF:10,\na\n#EXTINF:10,\nb\n#EXTINF:10,\nc\n"),
            Some(75)
        );
        assert_eq!(
            super::retention_seconds("#EXTINF:80,\na\n#EXTINF:80,\nb\n"),
            None
        );
        assert_eq!(super::retention_seconds("#EXTINF:NaN,\na\n"), None);
    }

    use super::*;
    #[test]
    fn output_paths_are_not_filesystem_paths() {
        for name in ["master.m3u8", "track_0.m3u8", "track_6_000000001.ts"] {
            assert!(valid_name(name));
        }
        for name in [
            "../master.m3u8",
            "track_0/1.ts",
            "track_0.ts",
            "track_.m3u8",
            "track_0.m3u8?x",
            "/master.m3u8",
        ] {
            assert!(!valid_name(name));
        }
    }
    #[test]
    fn language_metadata_cannot_inject_ffmpeg_map_options() {
        let tracks = vec![
            AudioTrack {
                index: 2,
                codec_name: "aac".into(),
                tags: HashMap::from([("language".into(), "en,default:yes".into())]),
            },
            AudioTrack {
                index: 3,
                codec_name: "aac".into(),
                tags: HashMap::from([("language".into(), "rus".into())]),
            },
        ];
        assert_eq!(stream_map(&tracks), "v:0,agroup:sound a:0,agroup:sound,language:und,default:yes a:1,agroup:sound,language:rus,default:no");
    }
    #[test]
    fn source_is_network_only_and_cannot_include_userinfo() {
        assert!(validate_source("https://example.com/live.m3u8").is_ok());
        for source in [
            "file:///etc/passwd",
            "concat:http://example.com",
            "https://user:secret@example.com/live",
        ] {
            assert!(validate_source(source).is_err());
        }
    }
    #[tokio::test]
    async fn disk_scan_tolerates_a_segment_removed_after_enumeration() {
        let directory =
            std::env::temp_dir().join(format!("ott-disk-scan-{}", uuid::Uuid::new_v4()));
        tokio::fs::create_dir(&directory).await.unwrap();
        let file = directory.join("track_0_1.m4s");
        tokio::fs::write(&file, b"segment").await.unwrap();
        let mut entries = tokio::fs::read_dir(&directory).await.unwrap();
        let entry = entries.next_entry().await.unwrap().unwrap();
        assert_eq!(directory_entry_size(entry.metadata().await).unwrap(), 7);
        tokio::fs::remove_file(file).await.unwrap();
        // Windows DirEntry metadata is cached by enumeration; Unix reads it afresh.
        #[cfg(unix)]
        assert_eq!(directory_entry_size(entry.metadata().await).unwrap(), 0);
        assert_eq!(directory_size(&directory).await.unwrap(), 0);
        tokio::fs::remove_dir_all(directory).await.unwrap();
    }

    #[test]
    fn disk_scan_ignores_only_missing_entry_metadata() {
        assert_eq!(
            directory_entry_size(Err(std::io::Error::from(std::io::ErrorKind::NotFound)))
                .unwrap(),
            0
        );
        let error = directory_entry_size(Err(std::io::Error::from(
            std::io::ErrorKind::PermissionDenied,
        )))
        .unwrap_err();
        assert_eq!(
            error.downcast_ref::<std::io::Error>().unwrap().kind(),
            std::io::ErrorKind::PermissionDenied
        );
    }

    #[tokio::test]
    async fn disk_scan_preserves_invalid_directory_errors() {
        let file = std::env::temp_dir().join(format!("ott-disk-error-{}", uuid::Uuid::new_v4()));
        tokio::fs::write(&file, b"not a directory").await.unwrap();
        assert!(directory_size(&file).await.is_err());
        tokio::fs::remove_file(file).await.unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn failed_start_waits_for_cleanup_before_same_id_retry() {
        use std::os::unix::fs::PermissionsExt;
        let directory = std::env::temp_dir().join(format!("ott-retry-{}", uuid::Uuid::new_v4()));
        tokio::fs::create_dir(&directory).await.unwrap();
        for name in ["ffmpeg", "ffprobe"] {
            let file = directory.join(name);
            let capture = if name == "ffmpeg" {
                "printf '%s\\n' \"$@\" > ../args.txt\n"
            } else {
                ""
            };
            tokio::fs::write(&file, format!("#!/bin/sh\nif [ \"$1\" = \"-version\" ]; then echo '{name} version test'; exit 0; fi\n{capture}exit 1\n")).await.unwrap();
            std::fs::set_permissions(file, std::fs::Permissions::from_mode(0o700)).unwrap();
        }
        let manager = Manager::new(Config {
            ffmpeg: directory.join("ffmpeg"),
            ffprobe: directory.join("ffprobe"),
            directory: directory.join("sessions"),
            sessions: 1,
            disk_limit: 1024 * 1024,
            startup_timeout: Duration::from_secs(1),
            idle_timeout: Duration::from_secs(1),
            lease_duration: Duration::from_secs(1),
        })
        .await
        .unwrap();
        let tracks = vec![
            AudioTrack {
                index: 0,
                codec_name: "aac".into(),
                tags: HashMap::new()
            };
            2
        ];
        let id = "a".repeat(32);
        let entered = Arc::new(tokio::sync::Notify::new());
        let release = Arc::new(tokio::sync::Notify::new());
        *manager.0.cleanup_gate.lock().unwrap() = Some((entered.clone(), release.clone()));
        let worker = manager.clone();
        let worker_id = id.clone();
        let worker_tracks = tracks.clone();
        let mut first = tokio::spawn(async move {
            worker
                .start_named(worker_id, "http://localhost/live.m3u8", &worker_tracks)
                .await
        });
        tokio::time::timeout(Duration::from_secs(2), entered.notified())
            .await
            .unwrap();
        let premature = tokio::time::timeout(Duration::from_millis(50), &mut first).await;
        release.notify_one();
        assert!(
            premature.is_err(),
            "failed startup returned while old cleanup could still erase a retry"
        );
        assert!(tokio::time::timeout(Duration::from_secs(2), first)
            .await
            .unwrap()
            .unwrap()
            .is_err());
        assert!(!manager.0.sessions.lock().unwrap().contains_key(&id));
        assert!(!directory.join("sessions").join(&id).exists());
        assert_eq!(manager.0.slots.available_permits(), 1);
        assert_eq!(manager.0.directory_slots.available_permits(), 2);
        let arguments = tokio::fs::read_to_string(directory.join("sessions/args.txt"))
            .await
            .unwrap();
        let arguments: Vec<_> = arguments.lines().collect();
        assert!(
            !arguments.contains(&"-re") && !arguments.contains(&"-readrate"),
            "live HLS must not receive file-input pacing"
        );
        assert!(arguments
            .windows(2)
            .any(|pair| pair == ["-probesize", "2097152"]));
        assert!(arguments
            .windows(2)
            .any(|pair| pair == ["-analyzeduration", "3000000"]));
        assert!(tokio::time::timeout(
            Duration::from_secs(2),
            manager.start_named(id.clone(), "http://localhost/live.m3u8", &tracks),
        )
        .await
        .unwrap()
        .is_err());
        assert!(!manager.0.sessions.lock().unwrap().contains_key(&id));
        assert!(!directory.join("sessions").join(&id).exists());
        tokio::fs::remove_dir_all(directory).await.unwrap();
    }

    #[tokio::test]
    async fn readiness_requires_complete_three_target_duration_window() {
        let directory =
            std::env::temp_dir().join(format!("ott-window-test-{}", uuid::Uuid::new_v4()));
        tokio::fs::create_dir(&directory).await.unwrap();
        tokio::fs::write(
            directory.join("master.m3u8"),
            "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,AUDIO=\"sound\"\ntrack_0.m3u8\n",
        )
        .await
        .unwrap();
        tokio::fs::write(directory.join("track_0_init.mp4"), b"0123456789")
            .await
            .unwrap();
        for index in 0..3 {
            tokio::fs::write(directory.join(format!("track_0_{index}.m4s")), b"media")
                .await
                .unwrap();
        }
        let playlist = |duration| {
            format!("#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:{duration},\ntrack_0_0.m4s\n#EXTINF:{duration},\ntrack_0_1.m4s\n#EXTINF:{duration},\ntrack_0_2.m4s\n")
        };
        tokio::fs::write(directory.join("track_0.m3u8"), playlist(1))
            .await
            .unwrap();
        assert!(!output_ready(&directory, 1).await);
        tokio::fs::write(directory.join("track_0.m3u8"), playlist(2))
            .await
            .unwrap();
        assert!(output_ready(&directory, 1).await);
        tokio::fs::remove_file(directory.join("track_0_init.mp4"))
            .await
            .unwrap();
        assert!(!output_ready(&directory, 1).await);
        tokio::fs::remove_dir_all(directory).await.unwrap();
    }
    #[tokio::test]
    #[ignore = "requires explicitly configured installed ffmpeg and ffprobe"]
    async fn real_six_audio_renditions_and_close_cleanup() {
        let ffmpeg = PathBuf::from(std::env::var_os("OTT_TEST_FFMPEG").expect("OTT_TEST_FFMPEG"));
        let ffprobe =
            PathBuf::from(std::env::var_os("OTT_TEST_FFPROBE").expect("OTT_TEST_FFPROBE"));
        let directory =
            std::env::temp_dir().join(format!("ott-normalization-test-{}", uuid::Uuid::new_v4()));
        tokio::fs::create_dir(&directory).await.unwrap();
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../tests/fixtures/media-runtime/segment00.ts");
        let fixture = if fixture.exists() {
            fixture
        } else {
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../../tests/fixtures/media-runtime/segment00.ts")
        };
        let input = directory.join("six.ts");
        let mut generate = Command::new(&ffmpeg);
        generate
            .args([
                "-nostdin",
                "-hide_banner",
                "-loglevel",
                "error",
                "-stream_loop",
                "5",
                "-i",
            ])
            .arg(&fixture)
            .args(["-map", "0:v:0"]);
        for _ in 0..6 {
            generate.args(["-map", "0:a:0"]);
        }
        generate.args(["-c", "copy", "-f", "mpegts"]).arg(&input);
        assert!(generate.status().await.unwrap().success());
        let bytes = tokio::fs::read(&input).await.unwrap();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let app = axum::Router::new()
            .route("/live.m3u8", axum::routing::get(|| async { "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:10\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:10,\n/six.ts\n" }))
            .route("/six.ts", axum::routing::get(move || { let bytes = bytes.clone(); async move { bytes } }));
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        let output = directory.join("sessions");
        let manager = Manager::new(Config {
            ffmpeg,
            ffprobe,
            directory: output.clone(),
            sessions: 1,
            disk_limit: 32 * 1024 * 1024,
            startup_timeout: Duration::from_secs(20),
            idle_timeout: Duration::from_secs(30),
            lease_duration: Duration::from_millis(800),
        })
        .await
        .unwrap();
        let source = format!("http://{address}/live.m3u8");
        let tracks = manager.probe(&source).await.unwrap();
        assert_eq!(tracks.len(), 6);
        let id = manager.start(&source, &tracks).await.unwrap();
        let master = String::from_utf8(manager.read(&id, "master.m3u8").await.unwrap()).unwrap();
        assert_eq!(master.matches("TYPE=AUDIO").count(), 6);
        assert!(master.contains("AUDIO=\"group_sound\""));
        for index in 0..7 {
            assert!(manager
                .read(&id, &format!("track_{index}.m3u8"))
                .await
                .is_ok());
        }
        for _ in 0..4 {
            tokio::time::sleep(Duration::from_millis(300)).await;
            assert!(
                manager.read(&id, "master.m3u8").await.is_ok(),
                "active reads renew the lease beyond its initial deadline"
            );
        }
        assert!(manager.start(&source, &tracks).await.is_err());
        manager.close(&id);
        assert!(manager.read(&id, "master.m3u8").await.is_err());
        tokio::time::timeout(Duration::from_secs(3), async {
            while output.join(&id).exists() {
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .unwrap();
        assert!(manager.0.sessions.lock().unwrap().is_empty());
        server.abort();
        tokio::fs::remove_dir_all(directory).await.unwrap();
    }
}
