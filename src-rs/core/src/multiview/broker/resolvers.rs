//! Typed, server-enrolled sources. No wire Deserialize, native URL acceptance,
//! local-file reopen, decoder input URL, or production playback qualification.
//! Registry ownership/revision checks precede resolve and cancel its owner token
//! on every revocation. `finish` is the explicit retirement acknowledgement.
use super::network::{
    self, CheckedTransport, Error, Fetched, HlsManifest, HlsResource, OriginCredentials,
    ResourceKind,
};
use reqwest::{
    header::{HeaderMap, HeaderValue, ACCEPT},
    Url,
};
use serde_json::Value;
use std::{
    collections::{HashSet, VecDeque},
    sync::Arc,
    time::Duration,
};
use tokio::{sync::OwnedSemaphorePermit, task::JoinHandle};
use tokio_util::sync::CancellationToken;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Adapter {
    Http,
    PlexDirect,
    VPortal,
}
/// Configurations are accepted only from the trusted server enrollment owner.
/// An opaque registry config_index may refer to Arc<ServerSource>.
#[derive(Clone)]
pub struct ServerSource {
    kind: Source,
}
#[derive(Clone)]
enum Source {
    Http {
        url: Url,
        credentials: Option<OriginCredentials>,
    },
    Plex {
        base: Url,
        server_id: String,
        credentials: OriginCredentials,
        rating_key: String,
    },
    VPortal {
        endpoint: Url,
        key: String,
        params: Value,
    },
}
impl ServerSource {
    pub fn http(url: &str, credentials: Option<OriginCredentials>) -> Result<Self, Error> {
        Ok(Self {
            kind: Source::Http {
                url: network::address(url)?,
                credentials,
            },
        })
    }
    pub fn plex(base: &str, server_id: &str, token: &str, rating_key: &str) -> Result<Self, Error> {
        let base = network::address(base)?;
        if base.path() != "/"
            || base.query().is_some()
            || !identifier(server_id, 256)
            || !decimal(rating_key)
            || token.is_empty()
            || token.len() > 4096
        {
            return Err(Error::InvalidConfiguration);
        }
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-plex-token",
            HeaderValue::from_str(token).map_err(|_| Error::InvalidConfiguration)?,
        );
        headers.insert(ACCEPT, HeaderValue::from_static("application/json"));
        let credentials = OriginCredentials::new(base.as_str(), headers)?;
        Ok(Self {
            kind: Source::Plex {
                base,
                server_id: server_id.into(),
                credentials,
                rating_key: rating_key.into(),
            },
        })
    }
    /// `params` must be the exact server-owned typed catalog request, never JSON
    /// copied from a native grant. Mirrors the native PortalLink request grammar.
    pub fn vportal(endpoint: &str, key: &str, params: Value) -> Result<Self, Error> {
        let endpoint = network::address(endpoint)?;
        if endpoint.query().is_some()
            || key.is_empty()
            || key.len() > 1024
            || key.chars().any(|c| c.is_control())
            || !params.is_object()
            || params.to_string().len() > 60 * 1024
            || !clean_params(&params, 0)
        {
            return Err(Error::InvalidConfiguration);
        }
        Ok(Self {
            kind: Source::VPortal {
                endpoint,
                key: key.into(),
                params,
            },
        })
    }
    pub fn adapter(&self) -> Adapter {
        match self.kind {
            Source::Http { .. } => Adapter::Http,
            Source::Plex { .. } => Adapter::PlexDirect,
            Source::VPortal { .. } => Adapter::VPortal,
        }
    }
    /// These resolvers qualify bounded bytes only. No live decoder or compositor
    /// capacity may be advertised from their presence or a successful fetch.
    pub const fn qualifies_live_decoder(&self) -> bool {
        false
    }

    pub async fn resolve(
        &self,
        transport: &CheckedTransport,
        owner: &CancellationToken,
    ) -> Result<PreparedSource, Error> {
        if owner.is_cancelled() {
            return Err(Error::Cancelled);
        }
        let permit = transport.reserve_source()?;
        let cancel = owner.child_token();
        let mut abandoned = CancelOnDrop(Some(cancel.clone()));
        let source = self.clone();
        let transport = transport.clone();
        let (send, receive) = tokio::sync::oneshot::channel();
        // The worker owns POST completion even if the awaiting caller goes away.
        // A dropped result owns Drop cleanup; callers claiming retirement must
        // instead retain the result and await finish (Drop is not a receipt).
        tokio::spawn(async move {
            let result = source.resolve_owned(transport, cancel, permit).await;
            if let Err(Ok(prepared)) = send.send(result) {
                let _ = prepared.finish().await;
            }
        });
        let result = receive.await.map_err(|_| Error::CleanupUnconfirmed)?;
        if result.is_ok() {
            abandoned.0.take();
        }
        result
    }
    async fn resolve_owned(
        self,
        transport: CheckedTransport,
        cancel: CancellationToken,
        permit: Arc<OwnedSemaphorePermit>,
    ) -> Result<PreparedSource, Error> {
        let adapter = self.adapter();
        let (url, credentials, lease) = match self.kind {
            Source::Http { url, credentials } => {
                transport.validate(&url)?;
                (url, credentials, None)
            }
            Source::Plex {
                base,
                server_id,
                credentials,
                rating_key,
            } => {
                transport.validate(&base)?;
                // Prove the enrolled machine before disclosing its token. A
                // private address can be reassigned while keeping the same URL.
                let mut identity_headers = HeaderMap::new();
                identity_headers.insert(ACCEPT, HeaderValue::from_static("application/json"));
                let identity_credentials = OriginCredentials::new(base.as_str(), identity_headers)?;
                let identity = transport
                    .get(
                        base.join("identity")
                            .map_err(|_| Error::InvalidAddress)?
                            .as_str(),
                        Some(&identity_credentials),
                        &cancel,
                    )
                    .await?;
                if identity.url.origin() != base.origin() {
                    return Err(Error::DestinationDenied);
                }
                let value: Value =
                    serde_json::from_slice(identity.bytes()).map_err(|_| Error::InvalidResponse)?;
                if value
                    .pointer("/MediaContainer/machineIdentifier")
                    .and_then(Value::as_str)
                    != Some(server_id.as_str())
                {
                    return Err(Error::InvalidResponse);
                }
                let path = format!("library/metadata/{rating_key}");
                let metadata = transport
                    .get(
                        base.join(&path)
                            .map_err(|_| Error::InvalidAddress)?
                            .as_str(),
                        Some(&credentials),
                        &cancel,
                    )
                    .await?;
                if metadata.url.origin() != base.origin() {
                    return Err(Error::DestinationDenied);
                }
                let value: Value =
                    serde_json::from_slice(metadata.bytes()).map_err(|_| Error::InvalidResponse)?;
                let key = plex_part(&value, &rating_key)?;
                let url = base.join(key).map_err(|_| Error::InvalidResponse)?;
                transport.validate(&url)?;
                (url, Some(credentials), None)
            }
            Source::VPortal {
                endpoint,
                key,
                mut params,
            } => {
                transport.validate(&endpoint)?;
                let body = params.as_object_mut().ok_or(Error::InvalidConfiguration)?;
                body.insert("app".into(), Value::String("ott-play".into()));
                body.insert("key".into(), Value::String(key));
                let bytes = serde_json::to_vec(&params).map_err(|_| Error::InvalidConfiguration)?;
                let response = transport
                    .post_json_owned(endpoint.clone(), bytes, &cancel)
                    .await
                    .map_err(|error| match error {
                        Error::Cancelled
                        | Error::DestinationDenied
                        | Error::InvalidConfiguration
                        | Error::InvalidAddress
                        | Error::Busy => error,
                        // Native protocol has no caller-chosen lease ID/reconciliation
                        // API. A lost allocating response must never be blindly retried.
                        _ => Error::CleanupUnconfirmed,
                    })?;
                let value: Value = serde_json::from_slice(response.bytes())
                    .map_err(|_| Error::CleanupUnconfirmed)?;
                let selected = selected_url(&endpoint, &value);
                // Adopt the exact selected session, or a top-level failure lease,
                // before checking cancellation, malformed URL, or error state.
                let failed = value.get("type").and_then(Value::as_str) == Some("error")
                    || selected.is_none();
                let hints = match session_hints(&endpoint, &value, selected.as_ref())? {
                    Some(hints) => Some(hints),
                    None if failed => session_hints(&endpoint, &value, None)?,
                    None => None,
                };
                let lease = hints.map(|(stop, heartbeat)| {
                    SessionLease::start(
                        transport.clone(),
                        stop,
                        heartbeat,
                        cancel.clone(),
                        permit.clone(),
                    )
                });
                if cancel.is_cancelled() || failed {
                    if let Some(lease) = lease {
                        lease.finish().await?;
                    }
                    return Err(if cancel.is_cancelled() {
                        Error::Cancelled
                    } else {
                        Error::InvalidResponse
                    });
                }
                let url = selected.ok_or(Error::InvalidResponse)?.1;
                if let Err(error) = transport.validate(&url) {
                    if let Some(lease) = lease {
                        lease.finish().await?;
                    }
                    return Err(error);
                }
                (url, None, lease)
            }
        };
        let prepared = PreparedSource {
            transport,
            url,
            credentials,
            lease,
            cancel,
            provenance: Arc::new(()),
            _permit: permit,
            adapter,
        };
        if prepared.cancel.is_cancelled() {
            prepared.finish().await?;
            return Err(Error::Cancelled);
        }
        Ok(prepared)
    }
}
struct CancelOnDrop(Option<CancellationToken>);
impl Drop for CancelOnDrop {
    fn drop(&mut self) {
        if let Some(token) = &self.0 {
            token.cancel();
        }
    }
}

/// Active private source owner. No raw URL accessor, Debug or Serialize. Registry
/// revocation must cancel the parent token; every byte fetch uses its child.
pub struct PreparedSource {
    transport: CheckedTransport,
    url: Url,
    credentials: Option<OriginCredentials>,
    lease: Option<SessionLease>,
    cancel: CancellationToken,
    provenance: Arc<()>,
    _permit: Arc<OwnedSemaphorePermit>,
    adapter: Adapter,
}
impl PreparedSource {
    pub fn adapter(&self) -> Adapter {
        self.adapter
    }
    pub fn cancel(&self) {
        self.cancel.cancel();
    }
    /// Fresh checked HTTP subscription for each host Probe/Decode open. This
    /// reuses the resolved source lease, never redeems or resolves it a second time.
    /// Only sniffed MPEG-TS is admitted; HLS/MP4 need a separate owned demuxer.
    pub async fn open_mpeg_ts(
        &self,
        limits: super::stream_transport::StreamLimits,
    ) -> Result<super::stream_transport::MpegTsStream, Error> {
        super::stream_transport::MpegTsStream::open(
            &self.transport,
            self.url.as_str(),
            self.credentials.as_ref(),
            &self.cancel,
            self._permit.clone(),
            limits,
        )
        .await
    }
    pub async fn fetch_root(&self) -> Result<Fetched, Error> {
        let mut fetched = self
            .transport
            .get(self.url.as_str(), self.credentials.as_ref(), &self.cancel)
            .await?;
        fetched.provenance = Some(self.provenance.clone());
        Ok(fetched)
    }
    pub fn parse_hls(&self, fetched: &Fetched) -> Result<HlsManifest, Error> {
        if self.cancel.is_cancelled() {
            return Err(Error::Cancelled);
        }
        if !fetched
            .provenance
            .as_ref()
            .is_some_and(|p| Arc::ptr_eq(p, &self.provenance))
        {
            return Err(Error::DestinationDenied);
        }
        HlsManifest::parse(fetched, &self.transport)
    }
    pub async fn fetch_hls_resource(&self, resource: &HlsResource) -> Result<Fetched, Error> {
        if !resource
            .provenance
            .as_ref()
            .is_some_and(|p| Arc::ptr_eq(p, &self.provenance))
        {
            return Err(Error::DestinationDenied);
        }
        let mut fetched = self
            .transport
            .fetch_hls_resource(resource, self.credentials.as_ref(), &self.cancel)
            .await?;
        fetched.provenance = Some(self.provenance.clone());
        Ok(fetched)
    }
    /// Finite bounded graph snapshot, not an ongoing HLS demuxer. Every resource
    /// is parsed/fetched here; raw playlists must not be handed to a decoder with
    /// its own unrestricted HTTP/file protocols enabled.
    pub async fn fetch_hls_snapshot(&self) -> Result<HlsSnapshot, Error> {
        tokio::time::timeout(Duration::from_secs(30), self.hls_snapshot_inner())
            .await
            .map_err(|_| Error::Timeout)?
    }
    async fn hls_snapshot_inner(&self) -> Result<HlsSnapshot, Error> {
        let root = self.fetch_root().await?;
        let mut total = root.bytes().len();
        let mut result = vec![root];
        let mut queue = VecDeque::new();
        let mut playlists = HashSet::new();
        playlists.insert(result[0].url.as_str().to_owned());
        for resource in self.parse_hls(&result[0])?.resources {
            queue.push_back((resource, 1usize));
        }
        while let Some((resource, depth)) = queue.pop_front() {
            if resource.kind == ResourceKind::Playlist
                && !playlists.insert(resource.url.as_str().to_owned())
            {
                // Shared playlists and cycles have already queued their children.
                continue;
            }
            if result.len() >= 128 || depth > 4 {
                return Err(Error::TooLarge);
            }
            let fetched = self.fetch_hls_resource(&resource).await?;
            total = total
                .checked_add(fetched.bytes().len())
                .ok_or(Error::TooLarge)?;
            if total > 32 * 1024 * 1024 {
                return Err(Error::TooLarge);
            }
            if resource.kind == ResourceKind::Playlist {
                for child in self.parse_hls(&fetched)?.resources {
                    if queue.len() + result.len() >= 128 {
                        return Err(Error::TooLarge);
                    }
                    queue.push_back((child, depth + 1));
                }
            } else if fetched.is_hls() {
                return Err(Error::InvalidManifest);
            }
            result.push(fetched);
        }
        Ok(HlsSnapshot {
            resources: result,
            total_bytes: total,
        })
    }
    pub async fn finish(mut self) -> Result<(), Error> {
        self.cancel.cancel();
        if let Some(lease) = self.lease.take() {
            lease.finish().await?;
        }
        Ok(())
    }
}
impl Drop for PreparedSource {
    fn drop(&mut self) {
        self.cancel.cancel();
    }
}
pub struct HlsSnapshot {
    pub resources: Vec<Fetched>,
    pub total_bytes: usize,
}

struct SessionLease {
    release: CancellationToken,
    task: Option<JoinHandle<Result<(), Error>>>,
}
impl SessionLease {
    fn start(
        transport: CheckedTransport,
        stop: Url,
        heartbeat: Option<Url>,
        owner: CancellationToken,
        permit: Arc<OwnedSemaphorePermit>,
    ) -> Self {
        let release = CancellationToken::new();
        let signal = release.clone();
        let task = tokio::spawn(async move {
            let _permit = permit;
            loop {
                tokio::select! { biased;
                    _ = signal.cancelled() => break,
                    _ = owner.cancelled() => break,
                    _ = tokio::time::sleep(Duration::from_secs(30)) => {
                        if let Some(url) = &heartbeat {
                            let _ = transport.get_no_redirect(url.as_str(), &owner).await;
                        }
                    }
                }
            }
            // A cancelled playback token must not cancel its mandatory stop.
            let cleanup = async {
                loop {
                    match transport
                        .get_no_redirect(stop.as_str(), &CancellationToken::new())
                        .await
                    {
                        // Busy happens before any upstream IO. A cancelled DNS
                        // worker can still hold admission: use the existing
                        // outer cleanup deadline while waiting for its release.
                        Err(Error::Busy) => {
                            tokio::time::sleep(Duration::from_millis(25)).await
                        }
                        result => return result.map(|_| ()).map_err(|_| Error::CleanupUnconfirmed),
                    }
                }
            };
            tokio::time::timeout(Duration::from_secs(10), cleanup)
                .await
                .map_err(|_| Error::CleanupUnconfirmed)?
        });
        Self {
            release,
            task: Some(task),
        }
    }
    async fn finish(mut self) -> Result<(), Error> {
        self.release.cancel();
        self.task
            .take()
            .ok_or(Error::CleanupUnconfirmed)?
            .await
            .map_err(|_| Error::CleanupUnconfirmed)?
    }
}
impl Drop for SessionLease {
    fn drop(&mut self) {
        self.release.cancel();
    }
}

fn decimal(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 20
        && !value.starts_with('0')
        && value.bytes().all(|b| b.is_ascii_digit())
}
fn identifier(value: &str, limit: usize) -> bool {
    !value.is_empty()
        && value.len() <= limit
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
}
fn clean_params(value: &Value, depth: usize) -> bool {
    if depth > 16 {
        return false;
    }
    match value {
        Value::Object(map) => map.iter().all(|(k, v)| {
            !matches!(
                k.as_str(),
                "app" | "key" | "__proto__" | "constructor" | "prototype"
            ) && clean_params(v, depth + 1)
        }),
        Value::Array(values) => values.iter().all(|v| clean_params(v, depth + 1)),
        _ => true,
    }
}
fn plex_part<'a>(value: &'a Value, key: &str) -> Result<&'a str, Error> {
    let rows = value
        .pointer("/MediaContainer/Metadata")
        .and_then(Value::as_array)
        .filter(|v| v.len() == 1)
        .ok_or(Error::InvalidResponse)?;
    let row = &rows[0];
    if row.get("ratingKey").and_then(Value::as_str) != Some(key)
        || !matches!(
            row.get("type").and_then(Value::as_str),
            Some("movie" | "episode" | "clip")
        )
    {
        return Err(Error::InvalidResponse);
    }
    let parts = row
        .get("Media")
        .and_then(Value::as_array)
        .and_then(|m| m.first())
        .and_then(|m| m.get("Part"))
        .and_then(Value::as_array)
        .filter(|p| p.len() == 1)
        .ok_or(Error::Unsupported)?;
    let path = parts[0]
        .get("key")
        .and_then(Value::as_str)
        .ok_or(Error::InvalidResponse)?;
    if path.len() > 4096 {
        return Err(Error::InvalidResponse);
    }
    let components: Vec<_> = path
        .strip_prefix("/library/parts/")
        .ok_or(Error::InvalidResponse)?
        .split('/')
        .collect();
    if !(2..=3).contains(&components.len())
        || !decimal(components[0])
        || components.len() == 3
            && (components[1].is_empty()
                || components[1].len() > 20
                || !components[1].bytes().all(|b| b.is_ascii_digit()))
    {
        return Err(Error::InvalidResponse);
    }
    let file = components[components.len() - 1];
    if !(file == "file" || file.starts_with("file."))
        || !file
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
    {
        return Err(Error::InvalidResponse);
    }
    Ok(path)
}
fn selected_url(endpoint: &Url, value: &Value) -> Option<(String, Url)> {
    let parse = |v: &Value| {
        let raw = v.as_str()?;
        if raw.trim().is_empty() {
            return None;
        }
        let url = network::address(endpoint.join(raw).ok()?.as_str()).ok()?;
        Some((raw.to_owned(), url))
    };
    value.get("url").and_then(parse).or_else(|| {
        value
            .get("variants")
            .and_then(Value::as_object)
            .and_then(|v| v.values().find_map(parse))
    })
}
fn session_hints(
    endpoint: &Url,
    value: &Value,
    selected: Option<&(String, Url)>,
) -> Result<Option<(Url, Option<Url>)>, Error> {
    let hints = if let Some((raw, url)) = selected {
        value
            .get("sessions")
            .and_then(Value::as_object)
            .and_then(|s| s.get(raw).or_else(|| s.get(url.as_str())))
            .or_else(|| {
                value
                    .get("url")
                    .and_then(Value::as_str)
                    .and_then(|v| endpoint.join(v).ok())
                    .filter(|v| v == url)
                    .map(|_| value)
            })
    } else {
        Some(value)
    };
    let Some(hints) = hints else {
        return Ok(None);
    };
    let Some(stop) = hints.get("stop") else {
        return Ok(None);
    };
    let stop = stop
        .as_str()
        .and_then(|v| session_url(endpoint, v, SessionOperation::Stop))
        .ok_or(Error::CleanupUnconfirmed)?;
    // An invalid optional heartbeat must not discard a valid mandatory stop.
    let heartbeat = hints
        .get("heartbeat")
        .and_then(Value::as_str)
        .and_then(|v| session_url(endpoint, v, SessionOperation::Heartbeat));
    Ok(Some((stop, heartbeat)))
}
enum SessionOperation {
    Stop,
    Heartbeat,
}
fn session_url(endpoint: &Url, raw: &str, operation: SessionOperation) -> Option<Url> {
    if !endpoint.path().eq_ignore_ascii_case("/nas/api") || endpoint.query().is_some() {
        return None;
    }
    let url = network::address(raw).ok()?;
    if url.origin() != endpoint.origin() || url.query().is_some() {
        return None;
    }
    let rest = url.path().strip_prefix("/nas/stream/")?;
    let (token, file) = rest.split_once('/')?;
    let (id, secret) = token.split_once('.')?;
    let component = |s: &str| {
        !s.is_empty()
            && s.len() <= 256
            && s.bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
    };
    let expected = match operation {
        SessionOperation::Stop => "media.stop",
        SessionOperation::Heartbeat => "media.ping",
    };
    if !component(id) || !component(secret) || file != expected {
        return None;
    }
    Some(url)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lifecycle_hints_require_the_expected_operation_without_losing_valid_stop() {
        let endpoint = network::address("https://provider.invalid/nas/api").unwrap();
        let stop = "https://provider.invalid/nas/stream/id.secret/media.stop";
        let ping = "https://provider.invalid/nas/stream/id.secret/media.ping";
        for heartbeat in [
            ping,
            stop,
            "https://provider.invalid/nas/stream/id.secret/media.m3u8",
        ] {
            let value = serde_json::json!({"stop": stop, "heartbeat": heartbeat});
            let (actual_stop, actual_heartbeat) =
                session_hints(&endpoint, &value, None).unwrap().unwrap();
            assert_eq!(actual_stop.as_str(), stop);
            assert_eq!(
                actual_heartbeat.as_ref().map(Url::as_str),
                (heartbeat == ping).then_some(ping)
            );
        }
        for invalid in [
            ping,
            "https://provider.invalid/nas/stream/id.secret/media.m3u8",
            "https://provider.invalid/nas/stream/id.secret/media.mp4",
            "https://provider.invalid/nas/stream/id.secret/media.stop?token=x",
            "https://other.invalid/nas/stream/id.secret/media.stop",
            "https://provider.invalid/nas/stream/id.secret/media.stop/extra",
        ] {
            assert_eq!(
                session_hints(&endpoint, &serde_json::json!({"stop": invalid}), None),
                Err(Error::CleanupUnconfirmed)
            );
        }
    }
}
