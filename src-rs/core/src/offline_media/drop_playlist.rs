//! Native-picked playlists only. HTTP entries are returned to the player, except
//! a public channel-list URL that is fetched once, bounded and in place, so a
//! dropped playlist link becomes its channels instead of a single stream.
//! A reference that stays a stream because it could not be expanded reports a
//! bounded reason, so the player can say why its playlist link did not open.
//! Proxying, recursion and persistence stay out of this module.
use super::*;
use std::time::Duration;

/// Why a dropped playlist reference stayed a single stream instead of its
/// channel entries. The catalog carries the first reason of a batch.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum ExpansionIssue {
    /// The reference, or one of its redirects, left public address space.
    Blocked,
    /// The server was unreachable, declined, or returned no document.
    Unavailable,
}
impl ExpansionIssue {
    /// A closed diagnostic code; the UI owns its translated message.
    pub(super) fn code(self) -> &'static str {
        match self {
            Self::Blocked => "playlist_link_blocked",
            Self::Unavailable => "playlist_link_unavailable",
        }
    }
}
pub(super) const MAX_PLAYLIST_BYTES: usize = 8 * 1024 * 1024;
const MAX_TOTAL_TEXT: usize = 16 * 1024 * 1024;
const MAX_LINE: usize = 8192;
const MAX_TITLE: usize = 1024;
pub(super) const TOO_LARGE: &str = "Dropped playlist exceeds the 8 MiB file or 16 MiB batch limit";
pub(super) const EMPTY: &str = "Dropped playlist contains no playable entries";
const INVALID: &str = "Dropped playlist contains an invalid entry";
const HLS: &str =
    "Local HLS manifests are not supported; add the HTTP(S) manifest URL as a playlist entry";
const NESTED: &str = "Nested local playlists are not supported";
const ITEMS: &str = "Dropped playlists exceed 20000 entries or 128 local files";
const MANIFEST_TIMEOUT: Duration = Duration::from_secs(20);
/// A dropped playlist may reference a handful of remote channel lists; fetching
/// more than this from one gesture would turn a drop into a crawl.
const MAX_REMOTE_MANIFESTS: usize = 32;
const MAX_REDIRECTS: usize = 3;

pub(super) enum Member {
    Local(usize),
    Remote {
        id: String,
        name: String,
        url: String,
        mime: String,
    },
}
pub(super) enum Requested {
    Local {
        path: PathBuf,
        name: String,
        extension: String,
    },
    Remote {
        name: String,
        url: String,
        mime: String,
    },
}
impl Requested {
    pub(super) fn name(&self) -> &str {
        match self {
            Self::Local { name, .. } | Self::Remote { name, .. } => name,
        }
    }
}
fn bad(reason: &'static str) -> Failure {
    (StatusCode::BAD_REQUEST, reason)
}
fn extension(path: &FsPath) -> String {
    path.extension()
        .and_then(|v| v.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
}
pub(super) fn is_playlist(path: &FsPath) -> bool {
    matches!(extension(path).as_str(), "m3u" | "m3u8")
}
fn video_extension(value: &str) -> bool {
    matches!(value, "mp4" | "m4v" | "webm" | "avi" | "mkv" | "ogv")
}
fn local_path_allowed(path: &FsPath) -> bool {
    #[cfg(windows)]
    {
        use std::path::{Component, Prefix};
        if !matches!(path.components().next(), Some(Component::Prefix(prefix))
            if matches!(prefix.kind(), Prefix::Disk(_) | Prefix::VerbatimDisk(_)))
        {
            return false;
        }
        for component in path.components() {
            if let Component::Normal(name) = component {
                let Some(name) = name.to_str() else {
                    return false;
                };
                if name.contains(':') || name.ends_with(' ') || name.ends_with('.') {
                    return false;
                }
                let stem = name
                    .split('.')
                    .next()
                    .unwrap_or("")
                    .trim_end()
                    .to_ascii_uppercase();
                if matches!(
                    stem.as_str(),
                    "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
                ) || ["COM", "LPT"].iter().any(|prefix| {
                    stem.strip_prefix(*prefix).is_some_and(|tail| {
                        matches!(
                            tail,
                            "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
                        )
                    })
                }) {
                    return false;
                }
            }
        }
    }
    path.is_absolute()
}
pub(super) fn validate_input(path: &FsPath) -> Result<(), &'static str> {
    if !local_path_allowed(path)
        || path.as_os_str().len() > 4096
        || path
            .file_name()
            .and_then(|v| v.to_str())
            .is_none_or(|v| v.is_empty() || v.chars().any(char::is_control))
    {
        return Err("Invalid dropped video or playlist");
    }
    if !is_playlist(path) && !video_extension(&extension(path)) {
        return Err("Unsupported dropped video or playlist");
    }
    Ok(())
}
pub(super) struct Opened {
    pub path: PathBuf,
    pub file: fs::File,
    pub metadata: std::fs::Metadata,
    #[cfg(windows)]
    pub windows_identity: WindowsFileIdentity,
}
fn regular(metadata: &std::fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return false;
        }
    }
    metadata.is_file() && !metadata.file_type().is_symlink() && metadata.len() != 0
}
async fn open_nofollow(owner: &ReadWork, path: &FsPath) -> Result<fs::File, Failure> {
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC);
    #[cfg(windows)]
    options.custom_flags(windows_sys::Win32::Storage::FileSystem::FILE_FLAG_OPEN_REPARSE_POINT);
    checked(Some(owner), options.open(path))
        .await?
        .map_err(|_| bad("Dropped file unavailable"))
}
/// Keep both original-name and canonical opens long enough to compare their
/// actual identity. No symlink/reparse leaf is admitted; parent-relative input
/// is an explicit file selection, not a new directory capability.
pub(super) async fn open_original(owner: &ReadWork, path: &FsPath) -> Result<Opened, Failure> {
    if !local_path_allowed(path) {
        return Err(bad(INVALID));
    }
    let before = checked(Some(owner), fs::symlink_metadata(path))
        .await?
        .map_err(|_| bad("Dropped file unavailable"))?;
    if !regular(&before) {
        return Err(bad("Drop regular video or playlist files"));
    }
    let selected = open_nofollow(owner, path).await?;
    let selected_metadata = checked(Some(owner), selected.metadata())
        .await?
        .map_err(storage_error)?;
    if !regular(&selected_metadata) || FileStamp::new(&before) != FileStamp::new(&selected_metadata)
    {
        return Err(bad("Dropped file changed"));
    }
    #[cfg(windows)]
    let selected_identity = read_windows_file_identity(&selected, Some(owner)).await?;
    let canonical = checked(Some(owner), fs::canonicalize(path))
        .await?
        .map_err(|_| bad("Dropped file unavailable"))?;
    if !local_path_allowed(&canonical) {
        return Err(bad(INVALID));
    }
    let file = open_nofollow(owner, &canonical).await?;
    let metadata = checked(Some(owner), file.metadata())
        .await?
        .map_err(storage_error)?;
    let after = checked(Some(owner), fs::symlink_metadata(path))
        .await?
        .map_err(|_| bad("Dropped file changed"))?;
    if !regular(&metadata)
        || !regular(&after)
        || FileStamp::new(&before) != FileStamp::new(&metadata)
        || FileStamp::new(&before) != FileStamp::new(&after)
    {
        return Err(bad("Dropped file changed"));
    }
    #[cfg(windows)]
    let windows_identity = read_windows_file_identity(&file, Some(owner)).await?;
    #[cfg(windows)]
    if windows_identity != selected_identity {
        return Err(bad("Dropped file changed"));
    }
    drop(selected);
    Ok(Opened {
        path: canonical,
        file,
        metadata,
        #[cfg(windows)]
        windows_identity,
    })
}
async fn read_manifest(
    owner: &ReadWork,
    path: &FsPath,
    remaining: usize,
) -> Result<(String, PathBuf), Failure> {
    let mut opened = open_original(owner, path).await?;
    // Resolve relative members against the verified manifest's canonical
    // location, never the original picker alias which can be rebound later.
    let parent = opened.path.parent().ok_or(bad(INVALID))?.to_path_buf();
    let limit = MAX_PLAYLIST_BYTES.min(remaining);
    if opened.metadata.len() > limit as u64 {
        return Err(bad(TOO_LARGE));
    }
    let mut bytes = Vec::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let take = buffer.len().min(limit.saturating_sub(bytes.len()) + 1);
        let count = checked(Some(owner), opened.file.read(&mut buffer[..take]))
            .await?
            .map_err(|_| bad("Dropped playlist could not be read"))?;
        if count == 0 {
            break;
        }
        if count > limit.saturating_sub(bytes.len()) {
            return Err(bad(TOO_LARGE));
        }
        bytes.extend_from_slice(&buffer[..count]);
    }
    let after = checked(Some(owner), opened.file.metadata())
        .await?
        .map_err(storage_error)?;
    if FileStamp::new(&opened.metadata) != FileStamp::new(&after) {
        return Err(bad("Dropped file changed"));
    }
    let text = String::from_utf8(bytes).map_err(|_| bad("Dropped playlist must be UTF-8"))?;
    Ok((text, parent))
}
fn local(path: PathBuf, title: Option<String>) -> Result<Requested, &'static str> {
    if path.to_string_lossy().chars().any(char::is_control) {
        return Err(INVALID);
    }
    if is_playlist(&path) {
        return Err(NESTED);
    }
    validate_input(&path)?;
    let extension = extension(&path);
    let name = title.unwrap_or_else(|| path.file_name().unwrap().to_string_lossy().into_owned());
    Ok(Requested::Local {
        path,
        name,
        extension,
    })
}
fn remote(line: &str, title: Option<String>) -> Result<Requested, &'static str> {
    // Url validates syntax only; retain the exact signed URL bytes for playback.
    let url = reqwest::Url::parse(line).map_err(|_| INVALID)?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || line.contains('\\')
        || line.chars().any(char::is_whitespace)
        || !line
            .split_once(':')
            .is_some_and(|(_, tail)| tail.starts_with("//"))
    {
        return Err(INVALID);
    }
    let ext = extension(FsPath::new(url.path()));
    let mime = match ext.as_str() {
        "m3u" | "m3u8" => "application/vnd.apple.mpegurl",
        "ts" => "video/mp2t",
        _ => media_type(&ext).unwrap_or(""),
    }
    .to_owned();
    // A fallback label must not leak credentials or signed query parameters.
    let name = title.unwrap_or_else(|| "Playlist stream".into());
    Ok(Requested::Remote {
        name,
        url: line.into(),
        mime,
    })
}
fn entry(line: &str, parent: &FsPath, title: Option<String>) -> Result<Requested, &'static str> {
    if line.len() > MAX_LINE || line.chars().any(char::is_control) {
        return Err(INVALID);
    }
    if line
        .get(..7)
        .is_some_and(|s| s.eq_ignore_ascii_case("http://"))
        || line
            .get(..8)
            .is_some_and(|s| s.eq_ignore_ascii_case("https://"))
    {
        return remote(line, title);
    }
    if line
        .get(..5)
        .is_some_and(|s| s.eq_ignore_ascii_case("file:"))
    {
        if line[5..]
            .strip_prefix("//")
            .is_some_and(|tail| !tail.starts_with('/'))
        {
            return Err(INVALID);
        }
        let url = reqwest::Url::parse(line).map_err(|_| INVALID)?;
        if url.host_str().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return Err(INVALID);
        }
        let path = url.to_file_path().map_err(|_| INVALID)?;
        // Network shares are not native file-URL grants.
        if path.to_string_lossy().starts_with("//") || path.to_string_lossy().starts_with("\\\\") {
            return Err(INVALID);
        }
        return local(path, title);
    }
    let path = PathBuf::from(line);
    let drive = cfg!(windows)
        && line.as_bytes().get(1) == Some(&b':')
        && line.as_bytes()[0].is_ascii_alphabetic()
        && matches!(line.as_bytes().get(2), Some(b'/' | b'\\'));
    if (line.contains(':') && !drive) || line.starts_with("//") || line.starts_with("\\\\") {
        return Err(INVALID);
    }
    local(
        if path.is_absolute() {
            path
        } else {
            parent.join(path)
        },
        title,
    )
}
fn extinf_title(line: &str) -> Result<Option<String>, &'static str> {
    let mut quoted = false;
    let mut escaped = false;
    for (index, ch) in line.char_indices() {
        if quoted && escaped {
            escaped = false;
            continue;
        }
        if quoted && ch == '\\' {
            escaped = true;
            continue;
        }
        if ch == '"' {
            quoted = !quoted;
        }
        if ch == ',' && !quoted {
            let label = line[index + 1..].trim();
            if label.len() > MAX_TITLE || label.chars().any(char::is_control) {
                return Err(INVALID);
            }
            return Ok((!label.is_empty()).then(|| label.to_owned()));
        }
    }
    Err(INVALID)
}
fn parse(
    text: &str,
    parent: &FsPath,
    out: &mut Vec<Requested>,
    local_count: &mut usize,
) -> Result<(), &'static str> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let mut title = None;
    let before = out.len();
    for raw in text.lines() {
        if raw.len() > MAX_LINE || raw.chars().any(|c| c.is_control() && c != '\t') {
            return Err(INVALID);
        }
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        if line.chars().any(|c| c.is_control() && c != '\t') {
            return Err(INVALID);
        }
        if line.starts_with("#EXT-X-") {
            return Err(HLS);
        }
        if line.starts_with("#EXTINF:") {
            title = extinf_title(line)?;
            continue;
        }
        if line.starts_with('#') {
            continue;
        }
        if out.len() >= MAX_DROPPED_ITEMS {
            return Err(ITEMS);
        }
        let item = entry(line, parent, title.take())?;
        if matches!(item, Requested::Local { .. }) {
            if *local_count >= MAX_DROPPED_VIDEOS {
                return Err(ITEMS);
            }
            *local_count += 1;
        }
        out.push(item);
    }
    if out.len() == before {
        return Err(EMPTY);
    }
    Ok(())
}
/// HLS media and master playlists are streams, not channel lists: their
/// `#EXT-X-` tags must never be read as channel entries.
fn looks_like_hls(text: &str) -> bool {
    text.lines()
        .any(|line| line.trim_start().starts_with("#EXT-X-"))
}
/// Remote entries stay absolute; a relative entry resolves against its manifest.
fn remote_entry(
    line: &str,
    base: &reqwest::Url,
    title: Option<String>,
) -> Result<Requested, &'static str> {
    let joined = base.join(line.trim()).map_err(|_| INVALID)?;
    remote(joined.as_str(), title)
}
fn parse_remote(
    text: &str,
    base: &reqwest::Url,
    out: &mut Vec<Requested>,
) -> Result<(), &'static str> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let before = out.len();
    let mut title = None;
    for raw in text.lines() {
        if raw.len() > MAX_LINE || raw.chars().any(|c| c.is_control() && c != '\t') {
            return Err(INVALID);
        }
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        if line.starts_with("#EXTINF:") {
            title = extinf_title(line)?;
            continue;
        }
        if line.starts_with('#') {
            continue;
        }
        if out.len() >= MAX_DROPPED_ITEMS {
            return Err(ITEMS);
        }
        out.push(remote_entry(line, base, title.take())?);
    }
    if out.len() == before {
        return Err(EMPTY);
    }
    Ok(())
}
/// A dropped playlist may only make the player read a public document:
/// loopback, private, link-local and local-only names would turn a link into a
/// probe of the machine or its network.
fn public_address(ip: std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(v4) => {
            !(v4.is_private()
                || v4.is_loopback()
                || v4.is_link_local()
                || v4.is_broadcast()
                || v4.is_documentation()
                || v4.is_unspecified()
                || v4.is_multicast())
        }
        std::net::IpAddr::V6(v6) => {
            if let Some(v4) = v6.to_ipv4_mapped() {
                return public_address(std::net::IpAddr::V4(v4));
            }
            !(v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                || v6.is_unique_local()
                || v6.is_unicast_link_local())
        }
    }
}
/// `Url::host_str` keeps the brackets of an IPv6 literal.
fn literal_address(host: &str) -> Option<std::net::IpAddr> {
    host.strip_prefix('[')
        .and_then(|rest| rest.strip_suffix(']'))
        .unwrap_or(host)
        .parse()
        .ok()
}
fn public_host_name(host: &str) -> bool {
    let name = host.trim_end_matches('.').to_ascii_lowercase();
    !(name == "localhost"
        || name.ends_with(".localhost")
        || name.ends_with(".local")
        || name.ends_with(".internal")
        || name.ends_with(".home.arpa"))
}
/// Scheme and host shape without DNS; a literal address must already be public.
fn public_reference(url: &reqwest::Url) -> bool {
    if !matches!(url.scheme(), "http" | "https") {
        return false;
    }
    let Some(host) = url.host_str() else {
        return false;
    };
    match literal_address(host) {
        Some(ip) => public_address(ip),
        None => public_host_name(host),
    }
}
/// Every address the name resolves to must be public, so a rebinding name is
/// refused before the request is made.
async fn public_target(url: &reqwest::Url) -> bool {
    if !public_reference(url) {
        return false;
    }
    let Some(host) = url.host_str() else {
        return false;
    };
    if literal_address(host).is_some() {
        return true;
    }
    let port = url.port_or_known_default().unwrap_or(443);
    let Ok(mut addresses) = tokio::net::lookup_host((host, port)).await else {
        return false;
    };
    let mut resolved = false;
    for address in addresses.by_ref() {
        resolved = true;
        if !public_address(address.ip()) {
            return false;
        }
    }
    resolved
}
/// Where a redirect points, if that stays a public reference. Relative locations
/// resolve against the document that asked for them.
fn redirect_target(current: &reqwest::Url, location: &str) -> Option<reqwest::Url> {
    let location = location.trim();
    if location.is_empty() {
        return None;
    }
    let next = current.join(location).ok()?;
    public_reference(&next).then_some(next)
}
/// Where one dropped channel-list reference ends up. A reference that stays a
/// stream keeps its bounded reason, never a URL or an error string.
enum Fetched {
    /// The document that arrived, with the URL it came from, so relative
    /// entries resolve against the document that actually answered.
    Document(String, reqwest::Url),
    /// The reference, or one of its redirects, left public address space.
    Blocked,
    /// The server was unreachable, declined, or returned no document.
    Unavailable,
}
/// One bounded, non-recursive read of a dropped channel-list URL, following at
/// most `MAX_REDIRECTS` hops that each stay public. Anything else keeps the
/// reference as a stream.
async fn fetch_manifest(owner: &ReadWork, url: &str, limit: usize) -> Result<Fetched, Failure> {
    let Ok(parsed) = reqwest::Url::parse(url) else {
        return Ok(Fetched::Unavailable);
    };
    let client = reqwest::Client::builder()
        .timeout(MANIFEST_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| bad(INVALID))?;
    let mut current = parsed;
    for _ in 0..=MAX_REDIRECTS {
        owner.check()?;
        if !public_target(&current).await {
            return Ok(Fetched::Blocked);
        }
        let Ok(response) = client.get(current.clone()).send().await else {
            return Ok(Fetched::Unavailable);
        };
        let status = response.status();
        if status.is_redirection() {
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|value| value.to_str().ok());
            let Some(location) = location else {
                return Ok(Fetched::Unavailable);
            };
            let Some(next) = redirect_target(&current, location) else {
                return Ok(Fetched::Blocked);
            };
            current = next;
            continue;
        }
        if !status.is_success() {
            return Ok(Fetched::Unavailable);
        }
        return Ok(read_manifest_body(owner, response, limit, current)
            .await?
            .map_or(Fetched::Unavailable, |(text, url)| {
                Fetched::Document(text, url)
            }));
    }
    Ok(Fetched::Unavailable)
}
/// Reads the accepted response up to `limit`, keeping the URL it came from.
async fn read_manifest_body(
    owner: &ReadWork,
    response: reqwest::Response,
    limit: usize,
    url: reqwest::Url,
) -> Result<Option<(String, reqwest::Url)>, Failure> {
    if response
        .content_length()
        .is_some_and(|length| length > limit as u64)
    {
        return Err(bad(TOO_LARGE));
    }
    let mut body = Vec::new();
    let mut response = response;
    loop {
        owner.check()?;
        let Some(chunk) = response.chunk().await.map_err(|_| bad(INVALID))? else {
            break;
        };
        if body.len() + chunk.len() > limit {
            return Err(bad(TOO_LARGE));
        }
        body.extend_from_slice(&chunk);
    }
    let text = String::from_utf8(body).map_err(|_| bad("Dropped playlist must be UTF-8"))?;
    Ok(Some((text, url)))
}
/// Keeps the first bounded reason a reference could not become its channels.
async fn expand_remote_references(
    owner: &ReadWork,
    items: Vec<Requested>,
    total_text: &mut usize,
) -> Result<(Vec<Requested>, Option<ExpansionIssue>), Failure> {
    let mut out = Vec::with_capacity(items.len());
    let mut fetched = 0usize;
    let mut issue: Option<ExpansionIssue> = None;
    for item in items {
        let Requested::Remote { url, mime, .. } = &item else {
            out.push(item);
            continue;
        };
        if mime != "application/vnd.apple.mpegurl" || fetched >= MAX_REMOTE_MANIFESTS {
            out.push(item);
            continue;
        }
        owner.check()?;
        let (text, base) = match fetch_manifest(owner, url, MAX_TOTAL_TEXT - *total_text).await? {
            Fetched::Document(text, base) => (text, base),
            Fetched::Blocked => {
                issue.get_or_insert(ExpansionIssue::Blocked);
                out.push(item);
                continue;
            }
            Fetched::Unavailable => {
                issue.get_or_insert(ExpansionIssue::Unavailable);
                out.push(item);
                continue;
            }
        };
        fetched += 1;
        let mut expanded = Vec::new();
        if looks_like_hls(&text) || parse_remote(&text, &base, &mut expanded).is_err() {
            out.push(item);
            continue;
        }
        if out.len() + expanded.len() > MAX_DROPPED_ITEMS {
            return Err(bad(ITEMS));
        }
        *total_text += text.len();
        out.extend(expanded);
    }
    Ok((out, issue))
}
/// The batch and the first reason one of its references stayed a stream.
pub(super) async fn expand(
    owner: &ReadWork,
    paths: Vec<PathBuf>,
) -> Result<(Vec<Requested>, Option<ExpansionIssue>), Failure> {
    let mut out = Vec::new();
    let mut total_text = 0usize;
    let mut local_count = 0usize;
    for path in paths {
        owner.check()?;
        if is_playlist(&path) {
            let (text, parent) = read_manifest(owner, &path, MAX_TOTAL_TEXT - total_text).await?;
            total_text += text.len();
            parse(&text, &parent, &mut out, &mut local_count).map_err(bad)?;
        } else {
            if out.len() >= MAX_DROPPED_ITEMS || local_count >= MAX_DROPPED_VIDEOS {
                return Err(bad(ITEMS));
            }
            local_count += 1;
            out.push(local(path, None).map_err(bad)?);
        }
    }
    expand_remote_references(owner, out, &mut total_text).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parsed(text: &str) -> Result<Vec<Requested>, &'static str> {
        let mut rows = Vec::new();
        parse(text, &std::env::temp_dir(), &mut rows, &mut 0)?;
        Ok(rows)
    }
    struct Fixture {
        root: PathBuf,
        library: Library,
    }
    impl Fixture {
        async fn new() -> Self {
            let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
            fs::create_dir_all(&root).await.unwrap();
            let library = Library::new(root.join("private"), "b".repeat(64), "device")
                .await
                .unwrap();
            Self { root, library }
        }
        async fn manifest(&self, text: impl AsRef<[u8]>) -> PathBuf {
            let path = self.root.join("channels.m3u8");
            fs::write(&path, text).await.unwrap();
            path
        }
        fn endpoint(&self) -> String {
            format!("http://127.0.0.1:12345{}", self.library.endpoint())
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }
    async fn response(library: &Library, id: &str) -> Response {
        media(
            State(library.clone()),
            Path((library.token.clone(), id.into())),
            HeaderMap::new(),
            Method::GET,
        )
        .await
    }

    #[test]
    fn remote_channel_list_entries_resolve_against_manifest_and_keep_titles() {
        let base = reqwest::Url::parse("https://example.invalid/playlists/ru/live.m3u").unwrap();
        let text = "#EXTM3U\n#EXTINF:-1 tvg-id=\"a\",Первый\nlive/1.m3u8\n#EXTINF:-1,Второй\nhttps://cdn.example.invalid/2.ts\n";
        let mut rows = Vec::new();
        parse_remote(text, &base, &mut rows).unwrap();
        assert_eq!(rows.len(), 2);
        assert!(matches!(&rows[0], Requested::Remote { name, url, mime }
            if name == "Первый"
                && url == "https://example.invalid/playlists/ru/live/1.m3u8"
                && mime == "application/vnd.apple.mpegurl"));
        assert!(matches!(&rows[1], Requested::Remote { name, url, mime }
            if name == "Второй" && url == "https://cdn.example.invalid/2.ts" && mime == "video/mp2t"));
    }

    #[test]
    fn dropped_playlist_references_stay_on_public_hosts() {
        let public = |value: &str| public_reference(&reqwest::Url::parse(value).unwrap());
        for allowed in [
            "https://raw.githubusercontent.com/o/r/main/ru.m3u",
            "http://93.184.216.34/list.m3u",
            "https://[2606:4700:4700::1111]/list.m3u",
        ] {
            assert!(public(allowed), "{allowed} is a public target");
        }
        for refused in [
            "http://127.0.0.1:8765/playlist.m3u",
            "http://localhost/list.m3u",
            "http://player.localhost/list.m3u",
            "http://[::1]/list.m3u",
            "http://[::ffff:127.0.0.1]/list.m3u",
            "http://10.1.2.3/list.m3u",
            "http://172.16.0.9/list.m3u",
            "http://192.168.1.5/list.m3u",
            "http://169.254.10.1/list.m3u",
            "http://0.0.0.0/list.m3u",
            "http://[fd00::1]/list.m3u",
            "http://[fe80::1]/list.m3u",
            "http://printer.local/list.m3u",
            "http://media.internal/list.m3u",
            "ftp://example.invalid/list.m3u",
        ] {
            assert!(!public(refused), "{refused} must stay a single stream");
        }
    }

    #[test]
    fn redirects_follow_only_public_references() {
        let base = reqwest::Url::parse("http://example.org/list/channels.m3u").unwrap();
        assert_eq!(
            redirect_target(&base, "https://example.org/list/channels.m3u")
                .map(|url| url.to_string())
                .as_deref(),
            Some("https://example.org/list/channels.m3u")
        );
        assert_eq!(
            redirect_target(&base, "  ../other.m3u  ")
                .map(|url| url.to_string())
                .as_deref(),
            Some("http://example.org/other.m3u")
        );
        for refused in [
            "http://127.0.0.1:8765/playlist.m3u",
            "http://localhost/playlist.m3u",
            "http://[::1]/playlist.m3u",
            "http://192.168.0.10/list.m3u",
            "file:///etc/passwd",
            "   ",
        ] {
            assert!(
                redirect_target(&base, refused).is_none(),
                "{refused} must not be followed"
            );
        }
    }

    #[test]
    fn hls_media_and_master_playlists_stay_streams() {
        assert!(looks_like_hls(
            "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:6\n"
        ));
        assert!(looks_like_hls(
            "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nlow.m3u8\n"
        ));
        assert!(!looks_like_hls(
            "#EXTM3U\n#EXTINF:-1,Channel\nhttps://example.invalid/s.m3u8\n"
        ));
        let base = reqwest::Url::parse("https://example.invalid/x.m3u").unwrap();
        assert_eq!(
            parse_remote("#EXTM3U\n#EXT-X-VERSION:3\n", &base, &mut Vec::new()).err(),
            Some(EMPTY),
            "an HLS manifest has no channel entries to expand"
        );
    }

    #[test]
    fn playlist_bom_headerless_quoted_extinf_and_signed_urls_preserve_order() {
        let signed = "https://user:pass@example.invalid/live/main.m3u8?token=a%2Bb&x=1#fragment";
        let text = format!("\u{feff}#EXTM3U\r\n#EXTINF:-1 tvg-name=\"News, local\" group-title=\"A,B\",News, live\r\n{signed}\r\nhttp://example.invalid/movie.mp4\n");
        let rows = parsed(&text).unwrap();
        assert_eq!(rows.len(), 2);
        assert!(matches!(&rows[0], Requested::Remote { name, url, mime }
            if name == "News, live" && url == signed && mime == "application/vnd.apple.mpegurl"));
        assert!(matches!(&rows[1], Requested::Remote { name, mime, .. }
            if name == "Playlist stream" && mime == "video/mp4"));
        let rows = parsed("https://example.invalid/no-extension?sig=secret\nhttps://example.invalid/no-extension?sig=secret").unwrap();
        assert_eq!(rows.len(), 2, "duplicates remain ordered distinct entries");
        assert!(
            matches!(&rows[0], Requested::Remote { name, mime, .. } if name == "Playlist stream" && mime.is_empty())
        );
        assert!(parsed("#EXTINF:-1 tvg-name=\"unclosed,Title\nhttps://example.invalid/a").is_err());
    }

    #[test]
    fn playlist_explicit_local_paths_and_file_urls_resolve_without_expansion() {
        let parent = std::env::temp_dir().join("playlist-parent");
        let absolute = std::env::temp_dir().join("elsewhere.mp4");
        let file_url = reqwest::Url::from_file_path(&absolute).unwrap().to_string();
        for (line, expected) in [
            (
                "../relative movie.mp4".to_string(),
                parent.join("../relative movie.mp4"),
            ),
            (absolute.to_str().unwrap().to_string(), absolute.clone()),
            (file_url, absolute),
        ] {
            assert!(
                matches!(entry(&line, &parent, Some("Named".into())).unwrap(),
                Requested::Local { path, name, .. } if path == expected && name == "Named")
            );
        }
        assert!(
            matches!(entry("$HOME/movie.mp4", &parent, None).unwrap(), Requested::Local { path, .. }
            if path == parent.join("$HOME/movie.mp4")),
            "no environment expansion"
        );
        #[cfg(windows)]
        {
            for path in [
                r"\\server\share\movie.mp4",
                r"\\?\UNC\server\share\movie.mp4",
                r"\\.\NUL.mp4",
                r"C:\NUL.mp4",
                r"C:\folder\COM1.mp4",
                r"C:\folder\file.mp4:stream",
                r"C:\folder\movie.mp4.",
            ] {
                assert!(
                    !local_path_allowed(FsPath::new(path)),
                    "network/device aliases must not become local file grants"
                );
            }
            assert!(local_path_allowed(FsPath::new(r"C:\folder\movie.mp4")));
            assert!(local_path_allowed(FsPath::new(r"\\?\C:\folder\movie.mp4")));
        }
    }

    #[test]
    fn playlist_rejects_nested_hls_unsupported_schemes_network_files_and_controls() {
        for tag in [
            "#EXT-X-TARGETDURATION:10",
            "#EXT-X-STREAM-INF:BANDWIDTH=1000",
            "#EXT-X-KEY:METHOD=AES-128",
        ] {
            assert_eq!(
                parsed(&format!(
                    "https://example.invalid/valid.mp4\n{tag}\nsegment.ts"
                ))
                .err(),
                Some(HLS)
            );
        }
        assert_eq!(parsed("nested.m3u8").err(), Some(NESTED));
        for line in [
            "ftp://example.invalid/a.mp4",
            "data:video/mp4,AAAA",
            "javascript:run()",
            "//server/share/a.mp4",
            "\\\\server\\share\\a.mp4",
            "file://server/share/a.mp4",
            "file://localhost/a.mp4",
            "https://example.invalid/a b.mp4",
            "https://example.invalid/a\t.mp4",
            "file:///a%00.mp4",
        ] {
            assert!(
                parsed(line).is_err(),
                "unsupported entry must fail atomically"
            );
        }
        assert_eq!(parsed("#EXTM3U\n# comment").err(), Some(EMPTY));
    }

    #[test]
    fn playlist_caps_remote_entries_local_handles_line_and_title_independently() {
        let remote = "https://example.invalid/live\n";
        assert_eq!(
            parsed(&remote.repeat(MAX_DROPPED_ITEMS)).unwrap().len(),
            MAX_DROPPED_ITEMS
        );
        assert_eq!(
            parsed(&remote.repeat(MAX_DROPPED_ITEMS + 1)).err(),
            Some(ITEMS)
        );
        assert_eq!(
            parsed(&"movie.mp4\n".repeat(MAX_DROPPED_VIDEOS))
                .unwrap()
                .len(),
            MAX_DROPPED_VIDEOS
        );
        assert_eq!(
            parsed(&format!(
                "{remote}{}",
                "movie.mp4\n".repeat(MAX_DROPPED_VIDEOS + 1)
            ))
            .err(),
            Some(ITEMS)
        );
        assert!(parsed(&format!("https://example.invalid/{}", "x".repeat(MAX_LINE))).is_err());
        assert!(parsed(&format!(
            "#EXTINF:-1,{}\n{remote}",
            "x".repeat(MAX_TITLE + 1)
        ))
        .is_err());
    }

    #[tokio::test]
    async fn playlist_with_15_000_long_remote_links_builds_ordered_catalog_without_local_grants() {
        use std::fmt::Write;

        let f = Fixture::new().await;
        let count = 15_000;
        let url = format!(
            "https://example.invalid/movie.mp4?token={}&i=",
            "a".repeat(153)
        );
        let mut text = "#EXTM3U\n".to_owned();
        for index in 0..count {
            writeln!(text, "#EXTINF:-1,Movie {index}\n{url}{index}").unwrap();
        }
        assert!(text.len() > 2 * 1024 * 1024);
        let manifest = f.manifest(text).await;
        let batch = f.library.transient_videos(vec![manifest]).await.unwrap();
        let catalog = batch.catalog(&f.endpoint()).unwrap();
        assert_eq!(catalog.items.len(), count);
        assert_eq!(catalog.items[0].url, format!("{url}0"));
        assert_eq!(catalog.items[count - 1].url, format!("{url}{}", count - 1));
        assert_eq!(catalog.items[count - 1].name, "Movie 14999");
        assert!(f.library.transient.lock().unwrap().entries.is_empty());
    }

    #[tokio::test]
    async fn playlist_mixed_local_remote_catalog_and_drop_revoke_only_owned_files() {
        let f = Fixture::new().await;
        let outside = f.root.join("movie.mp4");
        fs::write(&outside, b"0123456789").await.unwrap();
        fs::create_dir(f.root.join("lists")).await.unwrap();
        let manifest = f.root.join("lists/mixed.m3u");
        fs::write(&manifest, "#EXTINF:-1,Remote\nhttps://example.invalid/live.m3u8?token=a%2Bb\n#EXTINF:10,Local title\n../movie.mp4\n").await.unwrap();
        let batch = f.library.transient_videos(vec![manifest]).await.unwrap();
        let catalog = batch.catalog(&f.endpoint()).unwrap();
        assert_eq!(catalog.items.len(), 2);
        assert_eq!(catalog.sources.len(), 1);
        assert_eq!(
            catalog.items[0].url,
            "https://example.invalid/live.m3u8?token=a%2Bb"
        );
        assert_eq!(catalog.items[0].mime, "application/vnd.apple.mpegurl");
        assert_eq!(catalog.items[1].name, "Local title");
        assert!(catalog.items[1].url.starts_with(&f.endpoint()));
        assert_eq!(catalog.items[0].source_id, catalog.items[1].source_id);
        assert_ne!(catalog.items[0].id, catalog.items[1].id);
        assert!(!serde_json::to_string(&catalog)
            .unwrap()
            .contains(f.root.to_str().unwrap()));
        assert_eq!(
            f.library.transient.lock().unwrap().entries.len(),
            1,
            "remote input creates no proxy or file grant"
        );
        let response = response(&f.library, &catalog.items[1].id).await;
        assert_eq!(response.status(), StatusCode::OK);
        drop(batch);
        assert!(axum::body::to_bytes(response.into_body(), 64)
            .await
            .is_err());
        assert!(f.library.transient.lock().unwrap().entries.is_empty());
        assert!(f.library.transient.lock().unwrap().groups.is_empty());
        assert_eq!(fs::read(outside).await.unwrap(), b"0123456789");
    }

    #[tokio::test]
    async fn playlist_remote_only_batches_release_reservations_and_remain_memory_only() {
        let f = Fixture::new().await;
        let manifest = f.manifest("https://example.invalid/live\n").await;
        let first = f
            .library
            .transient_videos(vec![manifest.clone()])
            .await
            .unwrap();
        let second = f
            .library
            .transient_videos(vec![manifest.clone()])
            .await
            .unwrap();
        assert!(f
            .library
            .transient_videos(vec![manifest.clone()])
            .await
            .is_err());
        assert!(f.library.transient.lock().unwrap().entries.is_empty());
        assert_eq!(f.library.transient.lock().unwrap().groups.len(), 2);
        assert!(first.catalog("https://example.invalid").is_err());
        drop(first);
        let next = f.library.transient_videos(vec![manifest]).await.unwrap();
        assert_eq!(next.catalog(&f.endpoint()).unwrap().total, Some(1));
        drop(second);
        drop(next);
        assert!(f.library.transient.lock().unwrap().groups.is_empty());
        assert!(fs::read_dir(&f.library.root)
            .await
            .unwrap()
            .next_entry()
            .await
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    async fn playlist_take_failure_keeps_old_grants_and_offer_does_not_parse_semantics() {
        let f = Fixture::new().await;
        let path = f.root.join("old.mp4");
        fs::write(&path, b"old bytes").await.unwrap();
        let active = f.library.transient_videos(vec![path]).await.unwrap();
        let id = active.catalog(&f.endpoint()).unwrap().items[0].id.clone();
        for (text, reason) in [
            (
                "https://example.invalid/ok\nmissing.mp4",
                "Dropped file unavailable",
            ),
            ("#EXTM3U\n#EXT-X-TARGETDURATION:10\nsegment.ts", HLS),
            ("nested.m3u", NESTED),
        ] {
            let manifest = f.manifest(text).await;
            let lease = f.library.background.enter().unwrap();
            validate_dropped_files(vec![manifest.clone()], &lease)
                .await
                .unwrap();
            assert_eq!(
                f.library.transient_videos(vec![manifest]).await.err(),
                Some(reason)
            );
            assert_eq!(f.library.transient.lock().unwrap().groups.len(), 1);
            assert_eq!(f.library.transient.lock().unwrap().entries.len(), 1);
            assert_eq!(response(&f.library, &id).await.status(), StatusCode::OK);
        }
    }

    #[tokio::test]
    async fn playlist_reader_enforces_utf8_file_and_aggregate_text_limits() {
        let f = Fixture::new().await;
        let invalid = f.manifest([0xff, 0xfe, 0]).await;
        assert_eq!(
            f.library.transient_videos(vec![invalid]).await.err(),
            Some("Dropped playlist must be UTF-8")
        );
        let oversized = f.manifest(vec![b' '; MAX_PLAYLIST_BYTES + 1]).await;
        assert_eq!(
            f.library.transient_videos(vec![oversized]).await.err(),
            Some(TOO_LARGE)
        );
        let entry = "https://example.invalid/live\n";
        let line = format!("#{}\n", "x".repeat(4094));
        let comment_bytes = MAX_PLAYLIST_BYTES - entry.len();
        let mut text = line.repeat((comment_bytes - 2) / line.len());
        let padding = comment_bytes - text.len();
        text.push('#');
        text.push_str(&"x".repeat(padding - 2));
        text.push('\n');
        text.push_str(entry);
        assert_eq!(text.len(), MAX_PLAYLIST_BYTES);
        let large = f.manifest(text).await;
        let exact = f
            .library
            .transient_videos(vec![large.clone(), large.clone()])
            .await
            .unwrap();
        assert_eq!(exact.catalog(&f.endpoint()).unwrap().items.len(), 2);
        drop(exact);
        assert_eq!(
            f.library.transient_videos(vec![large; 3]).await.err(),
            Some(TOO_LARGE)
        );
        assert!(f.library.transient.lock().unwrap().groups.is_empty());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn playlist_relative_members_keep_verified_canonical_parent_after_alias_rebind() {
        let f = Fixture::new().await;
        let first = f.root.join("original");
        let replacement = f.root.join("replacement");
        fs::create_dir(&first).await.unwrap();
        fs::create_dir(&replacement).await.unwrap();
        fs::write(first.join("list.m3u"), "movie.mp4\n")
            .await
            .unwrap();
        fs::write(first.join("movie.mp4"), b"original bytes")
            .await
            .unwrap();
        fs::write(replacement.join("movie.mp4"), b"replacement bytes")
            .await
            .unwrap();
        let alias = f.root.join("selected");
        std::os::unix::fs::symlink(&first, &alias).unwrap();
        let lease = f.library.background.enter().unwrap();
        owned_read(&lease, move |owner| async move {
            let (text, parent) =
                read_manifest(&owner, &alias.join("list.m3u"), MAX_TOTAL_TEXT).await?;
            let canonical = fs::canonicalize(&first).await.unwrap();
            assert_eq!(parent, canonical);
            fs::remove_file(&alias).await.unwrap();
            std::os::unix::fs::symlink(&replacement, &alias).unwrap();
            let mut rows = Vec::new();
            parse(&text, &parent, &mut rows, &mut 0).unwrap();
            let Requested::Local { path, .. } = rows.pop().unwrap() else {
                panic!("local member")
            };
            assert_eq!(path, canonical.join("movie.mp4"));
            let mut opened = open_original(&owner, &path).await?;
            let mut bytes = Vec::new();
            checked(Some(&owner), opened.file.read_to_end(&mut bytes))
                .await?
                .unwrap();
            assert_eq!(bytes, b"original bytes");
            Ok(())
        })
        .await
        .unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn playlist_and_referenced_file_symlinks_are_rejected_without_retained_grants() {
        let f = Fixture::new().await;
        let manifest = f.manifest("https://example.invalid/live").await;
        let alias = f.root.join("alias.m3u");
        std::os::unix::fs::symlink(&manifest, &alias).unwrap();
        assert!(f.library.transient_videos(vec![alias]).await.is_err());
        let video = f.root.join("video.mp4");
        fs::write(&video, b"video").await.unwrap();
        std::os::unix::fs::symlink(&video, f.root.join("alias.mp4")).unwrap();
        let manifest = f.manifest("alias.mp4").await;
        assert!(f.library.transient_videos(vec![manifest]).await.is_err());
        assert!(f.library.transient.lock().unwrap().entries.is_empty());
        assert!(f.library.transient.lock().unwrap().groups.is_empty());
    }

    #[tokio::test]
    async fn playlist_reference_outside_public_space_keeps_its_reason() {
        let f = Fixture::new().await;
        let manifest = f
            .manifest("https://example.invalid/live.ts\nhttp://127.0.0.1:9/list.m3u\n")
            .await;
        let lease = f.library.background.enter().unwrap();
        let (rows, issue) = owned_read(&lease, move |owner| async move {
            expand(&owner, vec![manifest]).await
        })
        .await
        .unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(
            rows[1].name(),
            "Playlist stream",
            "a refused reference still plays as one stream"
        );
        assert_eq!(
            issue.map(ExpansionIssue::code),
            Some("playlist_link_blocked")
        );
        assert!(f.library.transient.lock().unwrap().groups.is_empty());
    }
}
