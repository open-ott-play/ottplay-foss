//! Broker-only transport. Enrollment owns the policy; a player's URL or local
//! network consent is never input to this module's authorization decisions.
use reqwest::{
    header::{HeaderMap, ACCEPT, AUTHORIZATION, CONTENT_TYPE, COOKIE, LOCATION},
    Client, Method, Url,
};
use std::{
    collections::HashSet,
    net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, ToSocketAddrs},
    sync::Arc,
    time::Duration,
};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use tokio_util::sync::CancellationToken;

/// Closed diagnostics only: reqwest, DNS and JSON errors may contain secrets.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Error {
    InvalidConfiguration,
    InvalidAddress,
    DestinationDenied,
    Busy,
    Cancelled,
    Timeout,
    Transport,
    Rejected,
    TooLarge,
    RedirectDenied,
    InvalidManifest,
    Unsupported,
    InvalidResponse,
    CleanupUnconfirmed,
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::InvalidConfiguration => "invalid_broker_configuration",
            Self::InvalidAddress => "invalid_source_address",
            Self::DestinationDenied => "source_destination_denied",
            Self::Busy => "broker_busy",
            Self::Cancelled => "source_cancelled",
            Self::Timeout => "source_timeout",
            Self::Transport => "source_transport_failed",
            Self::Rejected => "source_rejected",
            Self::TooLarge => "source_limit_exceeded",
            Self::RedirectDenied => "source_redirect_denied",
            Self::InvalidManifest => "invalid_source_manifest",
            Self::Unsupported => "source_adapter_unsupported",
            Self::InvalidResponse => "invalid_source_response",
            Self::CleanupUnconfirmed => "source_cleanup_unconfirmed",
        })
    }
}
impl std::error::Error for Error {}

pub(super) fn address(raw: &str) -> Result<Url, Error> {
    if raw.len() > 8192
        || raw
            .bytes()
            .any(|b| b.is_ascii_control() || b.is_ascii_whitespace())
        || raw.contains('\\')
    {
        return Err(Error::InvalidAddress);
    }
    let url = Url::parse(raw).map_err(|_| Error::InvalidAddress)?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err(Error::InvalidAddress);
    }
    Ok(url)
}
fn origin(url: &Url) -> String {
    url.origin().ascii_serialization()
}

/// Trusted enrollment only. No Deserialize and no Debug; exact origin, not a
/// suffix/CIDR match. Private addresses require explicit RFC1918/ULA entries.
#[derive(Clone)]
pub struct OriginRule {
    origin: String,
    private_addresses: HashSet<IpAddr>,
}
impl OriginRule {
    pub fn new(base: &str, private_addresses: &[IpAddr]) -> Result<Self, Error> {
        let url = address(base)?;
        if url.path() != "/"
            || url.query().is_some()
            || private_addresses.len() > 64
            || private_addresses.iter().any(|ip| !private_ip(*ip))
        {
            return Err(Error::InvalidConfiguration);
        }
        Ok(Self {
            origin: origin(&url),
            private_addresses: private_addresses.iter().copied().collect(),
        })
    }
}
#[derive(Clone)]
pub struct NetworkPolicy {
    rules: Vec<OriginRule>,
    #[cfg(test)]
    fixture_loopback: bool,
}
impl NetworkPolicy {
    pub fn new(rules: Vec<OriginRule>) -> Result<Self, Error> {
        let mut seen = HashSet::new();
        if rules.is_empty() || rules.len() > 32 || rules.iter().any(|r| !seen.insert(&r.origin)) {
            return Err(Error::InvalidConfiguration);
        }
        Ok(Self {
            rules,
            #[cfg(test)]
            fixture_loopback: false,
        })
    }
    pub(super) fn check_origin(&self, url: &Url) -> Result<(), Error> {
        self.rule(url).map(|_| ())
    }
    fn rule(&self, url: &Url) -> Result<&OriginRule, Error> {
        self.rules
            .iter()
            .find(|r| r.origin == origin(url))
            .ok_or(Error::DestinationDenied)
    }
    fn approve(&self, url: &Url, addresses: &[SocketAddr]) -> Result<(), Error> {
        let rule = self.rule(url)?;
        if addresses.is_empty()
            || addresses.len() > 64
            || addresses.iter().any(|a| {
                let allowed = public_ip(a.ip())
                    || private_ip(a.ip()) && rule.private_addresses.contains(&a.ip());
                #[cfg(test)]
                let allowed = allowed || self.fixture_loopback && a.ip().is_loopback();
                a.port() != url.port_or_known_default().unwrap_or(0) || !allowed
            })
        {
            return Err(Error::DestinationDenied);
        }
        Ok(())
    }
    #[cfg(test)]
    pub(super) fn fixture(origins: &[&str]) -> Self {
        let mut policy = Self::new(
            origins
                .iter()
                .map(|o| OriginRule::new(o, &[]).unwrap())
                .collect(),
        )
        .unwrap();
        policy.fixture_loopback = true;
        policy
    }
}
fn private_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v) => v.is_private(),
        IpAddr::V6(v) => v.to_ipv4_mapped().is_none() && v.segments()[0] & 0xfe00 == 0xfc00,
    }
}
fn public_v4(ip: Ipv4Addr) -> bool {
    let [a, b, c, _] = ip.octets();
    !(a == 0
        || a == 10
        || a == 127
        || a >= 224
        || a == 100 && (64..=127).contains(&b)
        || a == 169 && b == 254
        || a == 172 && (16..=31).contains(&b)
        || a == 192 && (b == 168 || b == 0 && (c == 0 || c == 2) || b == 88 && c == 99)
        || a == 198 && (b == 18 || b == 19 || b == 51 && c == 100)
        || a == 203 && b == 0 && c == 113)
}
fn public_v6(ip: Ipv6Addr) -> bool {
    if ip.to_ipv4_mapped().is_some() {
        return false;
    }
    let s = ip.segments();
    s[0] & 0xe000 == 0x2000
        && !(s[0] == 0x2001 && s[1] < 0x0200)
        && !(s[0] == 0x2001 && s[1] == 0x0db8)
        && s[0] != 0x2002
        && !(s[0] == 0x3fff && s[1] < 0x1000)
}
fn public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v) => public_v4(v),
        IpAddr::V6(v) => public_v6(v),
    }
}

/// Separate provider credentials, sent only to this exact enrolled origin.
#[derive(Clone)]
pub struct OriginCredentials {
    origin: String,
    headers: HeaderMap,
}
impl OriginCredentials {
    pub fn new(base: &str, headers: HeaderMap) -> Result<Self, Error> {
        let url = address(base)?;
        if headers.len() > 8
            || headers.iter().any(|(name, value)| {
                value.as_bytes().len() > 8192
                    || !(name == AUTHORIZATION
                        || name == COOKIE
                        || name == ACCEPT && value == "application/json"
                        || name.as_str() == "x-plex-token")
            })
        {
            return Err(Error::InvalidConfiguration);
        }
        Ok(Self {
            origin: origin(&url),
            headers,
        })
    }
    fn for_url(&self, url: &Url) -> HeaderMap {
        if self.origin == origin(url) {
            self.headers.clone()
        } else {
            HeaderMap::new()
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Limits {
    pub body_bytes: usize,
    pub request_bytes: usize,
    pub timeout: Duration,
    pub concurrent: usize,
    pub redirects: usize,
}
impl Default for Limits {
    fn default() -> Self {
        Self {
            body_bytes: 8 * 1024 * 1024,
            request_bytes: 64 * 1024,
            timeout: Duration::from_secs(8),
            concurrent: 8,
            redirects: 3,
        }
    }
}
#[derive(Clone)]
pub struct CheckedTransport {
    policy: NetworkPolicy,
    limits: Limits,
    permits: Arc<Semaphore>,
    sources: Arc<Semaphore>,
}
/// Private response custody for a checked continuous-byte subscription.
pub(super) struct OpenResponse {
    pub response: reqwest::Response,
    pub permit: Arc<OwnedSemaphorePermit>,
}
/// Bounded owned bytes, not a decoder grant. Intentionally not Debug/Serialize.
pub struct Fetched {
    pub(super) url: Url,
    bytes: Vec<u8>,
    content_type: String,
    pub(super) provenance: Option<Arc<()>>,
}
impl Fetched {
    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }
    pub fn content_type(&self) -> &str {
        &self.content_type
    }
    pub fn is_hls(&self) -> bool {
        self.bytes.starts_with(b"#EXTM3U") || self.content_type.contains("mpegurl")
    }
}
impl CheckedTransport {
    pub fn new(policy: NetworkPolicy, limits: Limits) -> Result<Self, Error> {
        if limits.body_bytes == 0
            || limits.body_bytes > 16 * 1024 * 1024
            || limits.request_bytes == 0
            || limits.request_bytes > 64 * 1024
            || limits.timeout.is_zero()
            || limits.timeout > Duration::from_secs(30)
            || limits.concurrent == 0
            || limits.concurrent > 16
            || limits.redirects > 3
        {
            return Err(Error::InvalidConfiguration);
        }
        Ok(Self {
            policy,
            limits,
            permits: Arc::new(Semaphore::new(limits.concurrent)),
            sources: Arc::new(Semaphore::new(limits.concurrent)),
        })
    }
    pub(super) fn reserve_source(&self) -> Result<Arc<OwnedSemaphorePermit>, Error> {
        self.sources
            .clone()
            .try_acquire_owned()
            .map(Arc::new)
            .map_err(|_| Error::Busy)
    }
    pub(super) fn validate(&self, url: &Url) -> Result<(), Error> {
        self.policy.check_origin(url)
    }
    pub async fn get(
        &self,
        raw: &str,
        credentials: Option<&OriginCredentials>,
        cancel: &CancellationToken,
    ) -> Result<Fetched, Error> {
        let url = address(raw)?;
        self.run(url, Method::GET, None, credentials, cancel, false)
            .await
    }
    /// Lifecycle URLs are exact commands, not media discovery. Following a
    /// redirect could falsely confirm teardown from an unrelated successful GET.
    pub(super) async fn get_no_redirect(
        &self,
        raw: &str,
        cancel: &CancellationToken,
    ) -> Result<Fetched, Error> {
        let mut direct = self.clone();
        direct.limits.redirects = 0;
        direct.get(raw, None, cancel).await
    }
    /// A provider POST can allocate a lease. After admission, settle its bounded
    /// response even if cancelled so the resolver can adopt a returned stop URL.
    /// Caller must not abort/drop this future; own its task until reconciliation.
    pub(super) async fn post_json_owned(
        &self,
        url: Url,
        body: Vec<u8>,
        cancel: &CancellationToken,
    ) -> Result<Fetched, Error> {
        self.run(url, Method::POST, Some(body), None, cancel, true)
            .await
    }
    async fn run(
        &self,
        url: Url,
        method: Method,
        body: Option<Vec<u8>>,
        credentials: Option<&OriginCredentials>,
        cancel: &CancellationToken,
        settle: bool,
    ) -> Result<Fetched, Error> {
        if cancel.is_cancelled() {
            return Err(Error::Cancelled);
        }
        self.policy.check_origin(&url)?;
        if body
            .as_ref()
            .is_some_and(|b| b.len() > self.limits.request_bytes)
        {
            return Err(Error::TooLarge);
        }
        let permit = Arc::new(
            self.permits
                .clone()
                .try_acquire_owned()
                .map_err(|_| Error::Busy)?,
        );
        let operation = tokio::time::timeout(
            self.limits.timeout,
            self.fetch(url, method, body, credentials, permit),
        );
        if settle {
            operation.await.map_err(|_| Error::Timeout)?
        } else {
            tokio::select! { biased; _ = cancel.cancelled() => Err(Error::Cancelled), result = operation => result.map_err(|_| Error::Timeout)? }
        }
    }
    async fn fetch(
        &self,
        mut url: Url,
        method: Method,
        body: Option<Vec<u8>>,
        credentials: Option<&OriginCredentials>,
        permit: Arc<OwnedSemaphorePermit>,
    ) -> Result<Fetched, Error> {
        for hop in 0..=self.limits.redirects {
            let client = self.checked_client(&url, permit.clone(), false).await?;
            let mut request = client
                .request(method.clone(), url.clone())
                .header(reqwest::header::ACCEPT_ENCODING, "identity");
            if let Some(credentials) = credentials {
                request = request.headers(credentials.for_url(&url));
            }
            if let Some(body) = &body {
                request = request
                    .header(CONTENT_TYPE, "application/json")
                    .body(body.clone());
            }
            let mut response = request.send().await.map_err(|_| Error::Transport)?;
            if response.status().is_redirection() {
                // Never replay a mutation or its provider key across a redirect.
                if method != Method::GET || hop == self.limits.redirects {
                    return Err(Error::RedirectDenied);
                }
                let location = response
                    .headers()
                    .get(LOCATION)
                    .and_then(|v| v.to_str().ok())
                    .ok_or(Error::RedirectDenied)?;
                let next = address(
                    url.join(location)
                        .map_err(|_| Error::RedirectDenied)?
                        .as_str(),
                )?;
                if url.scheme() == "https" && next.scheme() != "https"
                    || origin(&url) != origin(&next) && url.query().is_some()
                {
                    return Err(Error::RedirectDenied);
                }
                self.policy.check_origin(&next)?;
                url = next;
                continue;
            }
            if !response.status().is_success() {
                return Err(Error::Rejected);
            }
            if response
                .content_length()
                .is_some_and(|n| n > self.limits.body_bytes as u64)
            {
                return Err(Error::TooLarge);
            }
            if response
                .headers()
                .get(reqwest::header::CONTENT_ENCODING)
                .is_some_and(|v| v != "identity")
            {
                return Err(Error::Unsupported);
            }
            let content_type = response
                .headers()
                .get(CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .unwrap_or("");
            if content_type.len() > 128 {
                return Err(Error::InvalidResponse);
            }
            let content_type = content_type.to_ascii_lowercase();
            let mut bytes = Vec::new();
            while let Some(chunk) = response.chunk().await.map_err(|_| Error::Transport)? {
                if chunk.len() > self.limits.body_bytes.saturating_sub(bytes.len()) {
                    return Err(Error::TooLarge);
                }
                bytes.extend_from_slice(&chunk);
            }
            // The admission permit lives through complete response/body consumption.
            drop(permit);
            return Ok(Fetched {
                url,
                bytes,
                content_type,
                provenance: None,
            });
        }
        Err(Error::RedirectDenied)
    }

    async fn checked_client(
        &self,
        url: &Url,
        permit: Arc<OwnedSemaphorePermit>,
        continuous: bool,
    ) -> Result<Client, Error> {
        self.policy.check_origin(url)?;
        let host = url
            .host_str()
            .ok_or(Error::InvalidAddress)?
            .trim_start_matches('[')
            .trim_end_matches(']')
            .to_owned();
        let port = url.port_or_known_default().ok_or(Error::InvalidAddress)?;
        let addresses = if let Ok(ip) = host.parse::<IpAddr>() {
            vec![SocketAddr::new(ip, port)]
        } else {
            let dns_host = host.clone();
            // System DNS can outlive cancellation: keep the shared admission in
            // its actual blocking worker, not merely in its abandoned awaiter.
            tokio::task::spawn_blocking(move || {
                let _permit = permit;
                (dns_host.as_str(), port)
                    .to_socket_addrs()
                    .map(|a| a.take(65).collect::<Vec<_>>())
                    .map_err(|_| Error::Transport)
            })
            .await
            .map_err(|_| Error::Transport)??
        };
        self.policy.approve(url, &addresses)?;
        let builder = Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(4))
            .resolve_to_addrs(&host, &addresses);
        // HTTP/1 gives a bounded parser even before our stricter header check.
        // Do not install a whole-response timeout on a continuous media body.
        let builder = if continuous {
            builder.http1_only()
        } else {
            builder.timeout(self.limits.timeout)
        };
        builder.build().map_err(|_| Error::Transport)
    }

    pub(super) async fn open_continuous(
        &self,
        raw: &str,
        credentials: Option<&OriginCredentials>,
        cancel: &CancellationToken,
        deadline: tokio::time::Instant,
    ) -> Result<OpenResponse, Error> {
        if cancel.is_cancelled() {
            return Err(Error::Cancelled);
        }
        let mut url = address(raw)?;
        self.policy.check_origin(&url)?;
        let permit = Arc::new(
            self.permits
                .clone()
                .try_acquire_owned()
                .map_err(|_| Error::Busy)?,
        );
        let operation = async {
            for hop in 0..=self.limits.redirects {
                let client = self.checked_client(&url, permit.clone(), true).await?;
                let mut request = client
                    .get(url.clone())
                    .header(reqwest::header::ACCEPT_ENCODING, "identity");
                if let Some(credentials) = credentials {
                    request = request.headers(credentials.for_url(&url));
                }
                let response = request.send().await.map_err(|_| Error::Transport)?;
                let headers = response.headers();
                let header_bytes = headers
                    .iter()
                    .try_fold(0usize, |sum, (name, value)| {
                        sum.checked_add(name.as_str().len() + value.as_bytes().len() + 4)
                    })
                    .ok_or(Error::TooLarge)?;
                if headers.len() > 64 || header_bytes > 32 * 1024 {
                    return Err(Error::TooLarge);
                }
                if response.status().is_redirection() {
                    if hop == self.limits.redirects {
                        return Err(Error::RedirectDenied);
                    }
                    let location = headers
                        .get(LOCATION)
                        .and_then(|v| v.to_str().ok())
                        .ok_or(Error::RedirectDenied)?;
                    let next = address(
                        url.join(location)
                            .map_err(|_| Error::RedirectDenied)?
                            .as_str(),
                    )?;
                    if url.scheme() == "https" && next.scheme() != "https"
                        || origin(&url) != origin(&next) && url.query().is_some()
                    {
                        return Err(Error::RedirectDenied);
                    }
                    self.policy.check_origin(&next)?;
                    url = next;
                    continue;
                }
                if response.status() != reqwest::StatusCode::OK {
                    return Err(Error::Rejected);
                }
                if headers
                    .get(reqwest::header::CONTENT_ENCODING)
                    .is_some_and(|v| v != "identity")
                {
                    return Err(Error::Unsupported);
                }
                // Content type can reject a known unsupported container. It can
                // never qualify a body: stream_transport sniffs actual packets.
                let content = headers
                    .get(CONTENT_TYPE)
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or("");
                if content.len() > 128 {
                    return Err(Error::InvalidResponse);
                }
                let content = content.to_ascii_lowercase();
                if content.contains("mpegurl")
                    || content.contains("mp4")
                    || content.contains("matroska")
                    || content.contains("text/html")
                    || content.contains("json")
                {
                    return Err(Error::Unsupported);
                }
                return Ok(OpenResponse {
                    response,
                    permit: permit.clone(),
                });
            }
            Err(Error::RedirectDenied)
        };
        tokio::select! { biased;
            _ = cancel.cancelled() => Err(Error::Cancelled),
            result = tokio::time::timeout_at(deadline, operation) => result.map_err(|_| Error::Timeout)?,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ResourceKind {
    Playlist,
    Segment,
    Key,
    Map,
}
/// Only the checked parser can create children; not accepted from native wire.
pub struct HlsResource {
    pub(super) url: Url,
    pub kind: ResourceKind,
    pub(super) provenance: Option<Arc<()>>,
}
pub struct HlsManifest {
    pub resources: Vec<HlsResource>,
    pub ended: bool,
}
impl HlsManifest {
    pub fn parse(fetched: &Fetched, transport: &CheckedTransport) -> Result<Self, Error> {
        if fetched.bytes.len() > 65536 {
            return Err(Error::TooLarge);
        }
        let text = std::str::from_utf8(&fetched.bytes).map_err(|_| Error::InvalidManifest)?;
        if text.lines().next().map(str::trim) != Some("#EXTM3U") {
            return Err(Error::InvalidManifest);
        }
        let mut resources = Vec::new();
        let mut variant = false;
        let mut ended = false;
        for line in text
            .lines()
            .skip(1)
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            if line.len() > 8192 || line.contains("{$") {
                return Err(Error::InvalidManifest);
            }
            let child = if !line.starts_with('#') {
                let kind = if variant {
                    ResourceKind::Playlist
                } else {
                    ResourceKind::Segment
                };
                variant = false;
                Some((line.to_owned(), kind))
            } else if line.starts_with("#EXT-X-STREAM-INF:") {
                if variant {
                    return Err(Error::InvalidManifest);
                }
                variant = true;
                None
            } else if line == "#EXT-X-ENDLIST" {
                ended = true;
                None
            } else if line.starts_with("#EXT-X-BYTERANGE:") || line.contains("BYTERANGE=") {
                return Err(Error::Unsupported);
            } else if let Some((tag, attrs)) = line.split_once(':') {
                let kind = match tag {
                    "#EXT-X-MEDIA" | "#EXT-X-I-FRAME-STREAM-INF" => Some(ResourceKind::Playlist),
                    "#EXT-X-KEY" | "#EXT-X-SESSION-KEY" => Some(ResourceKind::Key),
                    "#EXT-X-MAP" => Some(ResourceKind::Map),
                    _ => None,
                };
                let scalar = matches!(
                    tag,
                    "#EXT-X-VERSION"
                        | "#EXT-X-TARGETDURATION"
                        | "#EXT-X-MEDIA-SEQUENCE"
                        | "#EXT-X-DISCONTINUITY-SEQUENCE"
                        | "#EXT-X-PLAYLIST-TYPE"
                        | "#EXTINF"
                        | "#EXT-X-PROGRAM-DATE-TIME"
                        | "#EXT-X-ALLOW-CACHE"
                );
                if kind.is_none() && !scalar {
                    return Err(Error::Unsupported);
                }
                if scalar && attrs.contains("URI=") {
                    return Err(Error::Unsupported);
                }
                let uri = if kind.is_some() {
                    attribute_uri(attrs)?
                } else {
                    None
                };
                match (kind, uri) {
                    (Some(kind), Some(uri)) => Some((uri, kind)),
                    (None, Some(_)) => return Err(Error::Unsupported),
                    (Some(ResourceKind::Key), None)
                        if !attrs.split(',').any(|v| v == "METHOD=NONE") =>
                    {
                        return Err(Error::InvalidManifest)
                    }
                    (Some(ResourceKind::Map), None) => return Err(Error::InvalidManifest),
                    _ => None,
                }
            } else if matches!(
                line,
                "#EXT-X-DISCONTINUITY" | "#EXT-X-INDEPENDENT-SEGMENTS" | "#EXT-X-GAP"
            ) || !line.starts_with("#EXT")
            {
                None
            } else {
                return Err(Error::Unsupported);
            };
            if let Some((value, kind)) = child {
                if resources.len() >= 128 {
                    return Err(Error::TooLarge);
                }
                let url = address(
                    fetched
                        .url
                        .join(&value)
                        .map_err(|_| Error::InvalidManifest)?
                        .as_str(),
                )?;
                if fetched.url.scheme() == "https" && url.scheme() != "https" {
                    return Err(Error::DestinationDenied);
                }
                // Query strings can carry an enrolled source secret. Do not
                // let a manifest delegate that authority to another origin.
                if origin(&fetched.url) != origin(&url) && fetched.url.query().is_some() {
                    return Err(Error::DestinationDenied);
                }
                transport.validate(&url)?;
                resources.push(HlsResource {
                    url,
                    kind,
                    provenance: fetched.provenance.clone(),
                });
            }
        }
        if variant {
            return Err(Error::InvalidManifest);
        }
        Ok(Self { resources, ended })
    }
}
fn attribute_uri(mut attrs: &str) -> Result<Option<String>, Error> {
    let mut uri = None;
    let mut names = HashSet::new();
    while !attrs.is_empty() {
        let (key, rest) = attrs.split_once('=').ok_or(Error::InvalidManifest)?;
        if key.is_empty()
            || !key
                .bytes()
                .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'-')
            || !names.insert(key)
        {
            return Err(Error::InvalidManifest);
        }
        let (value, remaining) = if let Some(quoted) = rest.strip_prefix('"') {
            let end = quoted.find('"').ok_or(Error::InvalidManifest)?;
            (&quoted[..end], &quoted[end + 1..])
        } else {
            rest.find(',')
                .map_or((rest, ""), |at| (&rest[..at], &rest[at..]))
        };
        if key == "URI" {
            if value.is_empty() {
                return Err(Error::InvalidManifest);
            }
            uri = Some(value.to_owned());
        }
        attrs = if remaining.is_empty() {
            ""
        } else {
            remaining.strip_prefix(',').ok_or(Error::InvalidManifest)?
        };
        if attrs.ends_with(',') {
            return Err(Error::InvalidManifest);
        }
    }
    Ok(uri)
}
impl CheckedTransport {
    pub async fn fetch_hls_resource(
        &self,
        resource: &HlsResource,
        credentials: Option<&OriginCredentials>,
        cancel: &CancellationToken,
    ) -> Result<Fetched, Error> {
        self.get(resource.url.as_str(), credentials, cancel).await
    }
}

#[cfg(test)]
#[path = "network_tests.rs"]
mod tests;
