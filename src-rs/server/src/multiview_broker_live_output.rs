//! Test-only custody for actual encoder output, not a production route or fake
//! fixture body. The parent checks signed authority before/after reads and on
//! every response chunk. No session/control mutex is needed during filesystem IO.
use super::BoundaryError;
use axum::body::Bytes;
use std::{
    fs::File,
    io::Read,
    path::PathBuf,
    sync::{Arc, LazyLock},
    time::Duration,
};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

const PLAYLIST_BYTES: usize = 65_536;
const SEGMENT_BYTES: usize = 8 * 1024 * 1024;
const MAX_SEGMENTS: usize = 8;
const READ_TIMEOUT: Duration = Duration::from_secs(3);
static READERS: LazyLock<Arc<Semaphore>> = LazyLock::new(|| Arc::new(Semaphore::new(8)));

/// Construct from Session::output_directory(), which the encoder canonicalizes.
/// This retains the directory inode, not a path to reopen after a rename/swap.
pub(super) struct LiveOutput {
    directory: Arc<File>,
    byte_budget: Arc<Semaphore>,
    prefix: Arc<str>,
    minimum_sequence: u64,
    #[cfg(test)]
    before_read: Option<Arc<dyn Fn() + Send + Sync>>,
}
impl LiveOutput {
    pub(super) fn new(
        directory: PathBuf,
        byte_budget: Arc<Semaphore>,
        prefix: String,
        minimum_sequence: u64,
    ) -> Result<Self, BoundaryError> {
        validate_prefix(&prefix)?;
        if minimum_sequence > 999_999 {
            return Err(BoundaryError::Invalid);
        }
        Ok(Self {
            directory: Arc::new(open_directory(&directory)?),
            byte_budget,
            prefix: prefix.into(),
            minimum_sequence,
            #[cfg(test)]
            before_read: None,
        })
    }

    pub(super) async fn read(&self, file: &str) -> Result<Bytes, BoundaryError> {
        self.read_with_minimum(file, self.minimum_sequence).await
    }

    /// The parent obtains a fresh clean-window proof before every refresh. This
    /// request may raise, but cannot lower, the publication-time watermark.
    pub(super) async fn read_with_minimum(
        &self,
        file: &str,
        minimum_sequence: u64,
    ) -> Result<Bytes, BoundaryError> {
        let minimum_sequence = self.minimum_sequence.max(minimum_sequence);
        if minimum_sequence > 999_999 {
            return Err(BoundaryError::Invalid);
        }
        if file != "index.m3u8" && !segment_name(file) {
            return Err(BoundaryError::Invalid);
        }
        // Both permits move into the blocking worker. A dropped/timed-out await
        // cannot release admission while a filesystem operation remains blocked.
        let reader = READERS
            .clone()
            .try_acquire_owned()
            .map_err(|_| BoundaryError::Limit)?;
        let index_permit = self
            .byte_budget
            .clone()
            .try_acquire_many_owned(PLAYLIST_BYTES as u32)
            .map_err(|_| BoundaryError::Limit)?;
        let directory = self.directory.clone();
        let budget = self.byte_budget.clone();
        let prefix = self.prefix.clone();
        let name = file.to_owned();
        #[cfg(test)]
        let before_read = self.before_read.clone();
        let task = tokio::task::spawn_blocking(move || {
            let _reader = reader;
            let _index_permit = index_permit;
            #[cfg(test)]
            if let Some(before_read) = before_read {
                before_read();
            }
            read_owned(&directory, &budget, &prefix, minimum_sequence, &name)
        });
        tokio::time::timeout(READ_TIMEOUT, task)
            .await
            .map_err(|_| BoundaryError::Unavailable)?
            .map_err(|_| BoundaryError::Unavailable)?
    }
}

/// Bytes and every clone/slice retain the actual allocation's budget permit.
/// Neither a response permit nor a parent/encoder mutex is captured here.
struct BudgetBytes {
    bytes: Vec<u8>,
    _permit: OwnedSemaphorePermit,
}
impl AsRef<[u8]> for BudgetBytes {
    fn as_ref(&self) -> &[u8] {
        &self.bytes
    }
}

fn read_owned(
    directory: &File,
    budget: &Arc<Semaphore>,
    prefix: &str,
    minimum_sequence: u64,
    name: &str,
) -> Result<Bytes, BoundaryError> {
    // FFmpeg publishes index and segments via temp_file+atomic rename. This FD
    // captures one immutable index generation. A segment disappearing between
    // this snapshot and open is an honest stale/Invalid result, never guessed.
    let (index, index_meta) = open_regular(directory, "index.m3u8", PLAYLIST_BYTES)?;
    let raw = read_exact_snapshot(index, &index_meta)?;
    let parsed = parse_playlist(&raw, minimum_sequence)?;
    if name == "index.m3u8" {
        // Verify actual owned leaves, not synthetic placeholders. Their complete
        // MPEG-TS body is validated again when requested; this bounded prefix
        // check prevents publishing plainly wrong or missing encoder files.
        for segment in &parsed.segments {
            let (mut file, metadata) = open_regular(directory, segment, SEGMENT_BYTES)?;
            if metadata.len() % 188 != 0 {
                return Err(BoundaryError::Invalid);
            }
            let count = (metadata.len() as usize).min(5 * 188);
            let mut prefix_bytes = [0u8; 5 * 188];
            file.read_exact(&mut prefix_bytes[..count])
                .map_err(|_| BoundaryError::Invalid)?;
            validate_ts(&prefix_bytes[..count])?;
            unchanged(
                &metadata,
                &file.metadata().map_err(|_| BoundaryError::Invalid)?,
            )?;
        }
        let size = parsed
            .lines
            .iter()
            .try_fold(0usize, |sum, line| {
                sum.checked_add(
                    line.len()
                        + 1
                        + if segment_name(line) {
                            prefix.len() + 1
                        } else {
                            0
                        },
                )
            })
            .ok_or(BoundaryError::Limit)?;
        if size > PLAYLIST_BYTES {
            return Err(BoundaryError::Limit);
        }
        let permit = budget
            .clone()
            .try_acquire_many_owned(size as u32)
            .map_err(|_| BoundaryError::Limit)?;
        let mut output = Vec::with_capacity(size);
        for line in &parsed.lines {
            if segment_name(line) {
                output.extend_from_slice(prefix.as_bytes());
                output.push(b'/');
            }
            output.extend_from_slice(line.as_bytes());
            output.push(b'\n');
        }
        Ok(Bytes::from_owner(BudgetBytes {
            bytes: output,
            _permit: permit,
        }))
    } else {
        // Deliberately no historical-window cache: a removed segment is stale,
        // even if a similarly named file remains in the encoder's deletion tail.
        if !parsed.segments.contains(&name) {
            return Err(BoundaryError::Invalid);
        }
        let (file, metadata) = open_regular(directory, name, SEGMENT_BYTES)?;
        let permit = budget
            .clone()
            .try_acquire_many_owned(metadata.len() as u32)
            .map_err(|_| BoundaryError::Limit)?;
        let bytes = read_exact_snapshot(file, &metadata)?;
        validate_ts(&bytes)?;
        Ok(Bytes::from_owner(BudgetBytes {
            bytes,
            _permit: permit,
        }))
    }
}

fn validate_prefix(prefix: &str) -> Result<(), BoundaryError> {
    let token = prefix
        .strip_prefix("/multiview/v1/media/")
        .ok_or(BoundaryError::Configuration)?;
    let (nonce, signature) = token.split_once('.').ok_or(BoundaryError::Configuration)?;
    let hex = |value: &str| {
        value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    };
    if nonce.len() != 32 || signature.len() != 64 || !hex(nonce) || !hex(signature) {
        return Err(BoundaryError::Configuration);
    }
    Ok(())
}
fn segment_name(name: &str) -> bool {
    name.len() == 17
        && name.starts_with("segment-")
        && name.ends_with(".ts")
        && name.as_bytes()[8..14].iter().all(u8::is_ascii_digit)
}
struct Playlist<'a> {
    lines: Vec<&'a str>,
    segments: Vec<&'a str>,
}
fn parse_playlist(bytes: &[u8], minimum_sequence: u64) -> Result<Playlist<'_>, BoundaryError> {
    if bytes.is_empty() || bytes.len() > PLAYLIST_BYTES || bytes.contains(&b'\r') {
        return Err(BoundaryError::Invalid);
    }
    let text = std::str::from_utf8(bytes).map_err(|_| BoundaryError::Invalid)?;
    // The scratch budget includes the raw playlist; bound parser metadata too,
    // before collecting (a 64 KiB file could otherwise contain 32K tiny lines).
    let lines: Vec<_> = text.lines().take(65).collect();
    if lines.len() > 64 || lines.first() != Some(&"#EXTM3U") {
        return Err(BoundaryError::Invalid);
    }
    let (mut target, mut sequence, mut version) = (None, None, false);
    let (mut independent, mut ended, mut pending) = (false, false, None);
    let mut maximum = 0.0f64;
    let mut segments = Vec::with_capacity(MAX_SEGMENTS);
    for line in lines.iter().skip(1).copied() {
        if ended || line.is_empty() {
            return Err(BoundaryError::Invalid);
        }
        if let Some(duration) = pending.take() {
            if !segment_name(line) || segments.len() >= MAX_SEGMENTS {
                return Err(BoundaryError::Invalid);
            }
            let number = line[8..14]
                .parse::<u64>()
                .map_err(|_| BoundaryError::Invalid)?;
            if Some(number)
                != sequence.and_then(|start: u64| start.checked_add(segments.len() as u64))
            {
                return Err(BoundaryError::Invalid);
            }
            maximum = maximum.max(duration);
            segments.push(line);
            continue;
        }
        if let Some(value) = line.strip_prefix("#EXT-X-TARGETDURATION:") {
            if target.is_some() || !segments.is_empty() {
                return Err(BoundaryError::Invalid);
            }
            target = Some(number(value)?);
            if target == Some(0) {
                return Err(BoundaryError::Invalid);
            }
        } else if let Some(value) = line.strip_prefix("#EXT-X-MEDIA-SEQUENCE:") {
            if sequence.is_some() || !segments.is_empty() {
                return Err(BoundaryError::Invalid);
            }
            let value = number(value)?;
            if value < minimum_sequence || value > 999_999 {
                return Err(BoundaryError::Invalid);
            }
            sequence = Some(value);
        } else if let Some(value) = line.strip_prefix("#EXT-X-VERSION:") {
            if version || number(value)? == 0 {
                return Err(BoundaryError::Invalid);
            }
            version = true;
        } else if line == "#EXT-X-INDEPENDENT-SEGMENTS" {
            if independent {
                return Err(BoundaryError::Invalid);
            }
            independent = true;
        } else if let Some(value) = line.strip_prefix("#EXTINF:") {
            let value = value.strip_suffix(',').ok_or(BoundaryError::Invalid)?;
            if value.is_empty()
                || value.len() > 64
                || !value.bytes().all(|b| b.is_ascii_digit() || b == b'.')
            {
                return Err(BoundaryError::Invalid);
            }
            let duration = value.parse::<f64>().map_err(|_| BoundaryError::Invalid)?;
            if !duration.is_finite() || duration <= 0.0 {
                return Err(BoundaryError::Invalid);
            }
            pending = Some(duration);
        } else if line == "#EXT-X-ENDLIST" && !segments.is_empty() {
            ended = true;
        } else {
            return Err(BoundaryError::Invalid);
        }
    }
    if pending.is_some()
        || segments.is_empty()
        || sequence.is_none()
        || target.is_none_or(|v| (v as f64) < maximum.ceil())
    {
        return Err(BoundaryError::Invalid);
    }
    Ok(Playlist { lines, segments })
}
fn number(value: &str) -> Result<u64, BoundaryError> {
    if value.is_empty() || value.len() > 20 || !value.bytes().all(|b| b.is_ascii_digit()) {
        return Err(BoundaryError::Invalid);
    }
    value.parse().map_err(|_| BoundaryError::Invalid)
}
fn validate_ts(bytes: &[u8]) -> Result<(), BoundaryError> {
    if bytes.is_empty()
        || bytes.len() % 188 != 0
        || bytes
            .chunks_exact(188)
            .any(|p| p[0] != 0x47 || p[3] & 0x30 == 0)
    {
        return Err(BoundaryError::Invalid);
    }
    Ok(())
}

#[cfg(unix)]
fn open_directory(path: &std::path::Path) -> Result<File, BoundaryError> {
    use std::{
        ffi::CString,
        os::{
            fd::{AsRawFd, FromRawFd},
            unix::{ffi::OsStrExt, fs::MetadataExt},
        },
        path::Component,
    };
    if !path.is_absolute() {
        return Err(BoundaryError::Configuration);
    }
    let flags =
        libc::O_RDONLY | libc::O_CLOEXEC | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_NONBLOCK;
    let fd = unsafe { libc::open(c"/".as_ptr(), flags) };
    if fd < 0 {
        return Err(BoundaryError::Configuration);
    }
    let mut directory = unsafe { File::from_raw_fd(fd) };
    let mut normals = 0usize;
    for component in path.components() {
        match component {
            Component::RootDir => {}
            Component::Normal(name) => {
                normals += 1;
                let name =
                    CString::new(name.as_bytes()).map_err(|_| BoundaryError::Configuration)?;
                let fd = unsafe { libc::openat(directory.as_raw_fd(), name.as_ptr(), flags) };
                if fd < 0 {
                    return Err(BoundaryError::Configuration);
                }
                directory = unsafe { File::from_raw_fd(fd) };
            }
            _ => return Err(BoundaryError::Configuration),
        }
    }
    let metadata = directory
        .metadata()
        .map_err(|_| BoundaryError::Configuration)?;
    if normals == 0
        || !metadata.is_dir()
        || metadata.uid() != unsafe { libc::geteuid() }
        || metadata.mode() & 0o022 != 0
    {
        return Err(BoundaryError::Configuration);
    }
    Ok(directory)
}
#[cfg(not(unix))]
fn open_directory(_: &std::path::Path) -> Result<File, BoundaryError> {
    Err(BoundaryError::Unavailable)
}

#[cfg(unix)]
fn open_regular(
    directory: &File,
    name: &str,
    limit: usize,
) -> Result<(File, std::fs::Metadata), BoundaryError> {
    use std::{
        ffi::CString,
        os::{
            fd::{AsRawFd, FromRawFd},
            unix::fs::MetadataExt,
        },
    };
    if name != "index.m3u8" && !segment_name(name) {
        return Err(BoundaryError::Invalid);
    }
    let name = CString::new(name).map_err(|_| BoundaryError::Invalid)?;
    let fd = unsafe {
        libc::openat(
            directory.as_raw_fd(),
            name.as_ptr(),
            libc::O_RDONLY | libc::O_CLOEXEC | libc::O_NOFOLLOW | libc::O_NONBLOCK,
        )
    };
    if fd < 0 {
        return Err(BoundaryError::Invalid);
    }
    let file = unsafe { File::from_raw_fd(fd) };
    let metadata = file.metadata().map_err(|_| BoundaryError::Invalid)?;
    if !metadata.is_file()
        || metadata.len() == 0
        || metadata.len() > limit as u64
        || metadata.uid() != unsafe { libc::geteuid() }
        || metadata.nlink() != 1
        || metadata.mode() & 0o022 != 0
    {
        return Err(BoundaryError::Invalid);
    }
    Ok((file, metadata))
}
#[cfg(not(unix))]
fn open_regular(_: &File, _: &str, _: usize) -> Result<(File, std::fs::Metadata), BoundaryError> {
    Err(BoundaryError::Unavailable)
}

fn read_exact_snapshot(
    mut file: File,
    metadata: &std::fs::Metadata,
) -> Result<Vec<u8>, BoundaryError> {
    let mut bytes = vec![0u8; metadata.len() as usize];
    file.read_exact(&mut bytes)
        .map_err(|_| BoundaryError::Invalid)?;
    let mut extra = [0u8; 1];
    if file.read(&mut extra).map_err(|_| BoundaryError::Invalid)? != 0 {
        return Err(BoundaryError::Invalid);
    }
    unchanged(
        metadata,
        &file.metadata().map_err(|_| BoundaryError::Invalid)?,
    )?;
    Ok(bytes)
}
#[cfg(unix)]
fn unchanged(before: &std::fs::Metadata, after: &std::fs::Metadata) -> Result<(), BoundaryError> {
    use std::os::unix::fs::MetadataExt;
    if before.dev() != after.dev()
        || before.ino() != after.ino()
        || before.len() != after.len()
        || before.mtime() != after.mtime()
        || before.mtime_nsec() != after.mtime_nsec()
        || before.ctime() != after.ctime()
        || before.ctime_nsec() != after.ctime_nsec()
    {
        Err(BoundaryError::Invalid)
    } else {
        Ok(())
    }
}
#[cfg(not(unix))]
fn unchanged(_: &std::fs::Metadata, _: &std::fs::Metadata) -> Result<(), BoundaryError> {
    Err(BoundaryError::Unavailable)
}

#[cfg(all(test, unix))]
#[path = "multiview_broker_live_output_tests.rs"]
mod tests;
