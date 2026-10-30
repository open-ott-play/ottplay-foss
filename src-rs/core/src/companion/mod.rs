//! Optional native media companion. Every route requires the private endpoint token.
//! This API contains no host-path commands and no dynamically downloaded code.
use axum::{
    body::Body,
    extract::{rejection::JsonRejection, DefaultBodyLimit, Path, State},
    http::{header, HeaderMap, Method, Request, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{path::PathBuf, sync::Arc};
use tokio_util::sync::CancellationToken;
pub mod plugins;
mod source;
mod storage;
#[cfg(test)]
mod tests;
mod torrent;

#[derive(Clone)]
pub struct Companion(Arc<Inner>);
struct Inner {
    token: String,
    torrent: Arc<torrent::TorrentManager>,
    plugins: plugins::PluginService,
    cancel: CancellationToken,
}
impl Companion {
    pub async fn new(
        root: PathBuf,
        token: String,
        plugin_dir: Option<PathBuf>,
    ) -> anyhow::Result<Self> {
        anyhow::ensure!(
            (32..=128).contains(&token.len())
                && token
                    .bytes()
                    .all(|v| v.is_ascii_alphanumeric() || v == b'_' || v == b'-'),
            "Invalid companion access token"
        );
        let cancel = CancellationToken::new();
        let plugins = plugins::PluginService::load(plugin_dir.as_deref())
            .map_err(|error| anyhow::anyhow!(error.code()))?;
        let torrent =
            torrent::TorrentManager::new(root.join("torrent-cache"), cancel.clone()).await?;
        Ok(Self(Arc::new(Inner {
            token,
            torrent,
            plugins,
            cancel,
        })))
    }
    pub fn endpoint(&self) -> String {
        format!("/companion/{}/v1", self.0.token)
    }
    pub fn routes(&self) -> Router {
        Router::new()
            .route(
                "/companion/:token/v1/capabilities",
                get(capabilities).options(preflight),
            )
            .route(
                "/companion/:token/v1/sessions",
                post(create).options(preflight),
            )
            .route(
                "/companion/:token/v1/sessions/:id",
                get(status).delete(remove).options(preflight),
            )
            .route(
                "/companion/:token/v1/sessions/:id/select",
                post(select).options(preflight),
            )
            .route(
                "/companion/:token/v1/sessions/:id/stream",
                get(stream).head(stream).options(preflight),
            )
            .route(
                "/companion/:token/v1/plugins",
                get(plugin_list).options(preflight),
            )
            .route(
                "/companion/:token/v1/plugins/:id/resolve",
                post(plugin_resolve).options(preflight),
            )
            .layer(DefaultBodyLimit::max(64 * 1024))
            .layer(middleware::from_fn_with_state(self.clone(), authenticate))
            .with_state(self.clone())
    }
    pub async fn shutdown(&self) {
        self.0.cancel.cancel();
        self.0.torrent.shutdown().await;
    }
}
impl Drop for Inner {
    fn drop(&mut self) {
        self.cancel.cancel();
    }
}
async fn authenticate(State(c): State<Companion>, request: Request<Body>, next: Next) -> Response {
    let token = request
        .uri()
        .path()
        .strip_prefix("/companion/")
        .and_then(|v| v.split('/').next())
        .unwrap_or("");
    // Constant work for correctly-sized tokens. There are no cookie credentials.
    let valid = token.len() == c.0.token.len()
        && token
            .bytes()
            .zip(c.0.token.bytes())
            .fold(0u8, |diff, (a, b)| diff | (a ^ b))
            == 0;
    if !valid {
        return failure("unauthorized");
    }
    if c.0.cancel.is_cancelled() {
        return failure("service_stopped");
    }
    let private_network_preflight = request.method() == Method::OPTIONS
        && request
            .headers()
            .get("access-control-request-private-network")
            .is_some_and(|value| value == "true");
    let mut response = next.run(request).await;
    let headers = response.headers_mut();
    headers.insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
    headers.insert(header::REFERRER_POLICY, "no-referrer".parse().unwrap());
    headers.insert(header::X_CONTENT_TYPE_OPTIONS, "nosniff".parse().unwrap());
    // The private URL is the sole bearer credential. Allow uncredentialed web/TV
    // clients explicitly, never ambient cookies or Access-Control-Allow-Credentials.
    headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*".parse().unwrap());
    if private_network_preflight {
        headers.insert(
            "access-control-allow-private-network",
            "true".parse().unwrap(),
        );
    }
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        "GET, HEAD, POST, DELETE, OPTIONS".parse().unwrap(),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        "Content-Type, Range".parse().unwrap(),
    );
    headers.insert(
        header::ACCESS_CONTROL_EXPOSE_HEADERS,
        "Accept-Ranges, Content-Range, Content-Length"
            .parse()
            .unwrap(),
    );
    response
}
fn failure(code: &'static str) -> Response {
    let status = match code {
        "unauthorized" => StatusCode::UNAUTHORIZED,
        "session_missing" | "plugin_not_found" => StatusCode::NOT_FOUND,
        "service_stopped" | "session_stopped" | "plugin_cancelled" => {
            StatusCode::SERVICE_UNAVAILABLE
        }
        "session_busy" | "session_limit" | "stream_limit" | "cache_limit" | "busy"
        | "cleanup_pending" | "plugin_busy" => StatusCode::CONFLICT,
        "stream_timeout" | "plugin_timed_out" => StatusCode::GATEWAY_TIMEOUT,
        "plugin_execution_failed" | "plugin_network_failed" => StatusCode::BAD_GATEWAY,
        _ => StatusCode::BAD_REQUEST,
    };
    (status, Json(json!({"schema":1,"error":code}))).into_response()
}
async fn preflight() -> StatusCode {
    StatusCode::NO_CONTENT
}
async fn capabilities() -> Json<Value> {
    Json(
        json!({"schema":1,"torrent":true,"plugins":true,"torrentSources":["magnet","http","https"],"fileSelection":true,"maxSessions":torrent::MAX_SESSIONS,"cacheBytes":torrent::CACHE_LIMIT,"inboundPeerListener":false,"pluginNetwork":true,"pluginNetworkDefault":false}),
    )
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Create {
    source: String,
    file_index: Option<usize>,
}
async fn create(State(c): State<Companion>, body: Result<Json<Create>, JsonRejection>) -> Response {
    let Ok(Json(body)) = body else {
        return failure("invalid_request");
    };
    match c.0.torrent.create(body.source, body.file_index) {
        Ok(view) => (StatusCode::ACCEPTED, Json(view)).into_response(),
        Err(code) => failure(code),
    }
}
async fn status(State(c): State<Companion>, Path((_, id)): Path<(String, String)>) -> Response {
    match c.0.torrent.get(&id) {
        Some(lease) => Json(lease.view()).into_response(),
        None => failure("session_missing"),
    }
}
async fn remove(State(c): State<Companion>, Path((_, id)): Path<(String, String)>) -> Response {
    if c.0.torrent.remove(&id).await {
        StatusCode::NO_CONTENT.into_response()
    } else if c.0.torrent.get(&id).is_some() {
        failure("cleanup_pending")
    } else {
        failure("session_missing")
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Select {
    file_index: usize,
}
async fn select(
    State(c): State<Companion>,
    Path((_, id)): Path<(String, String)>,
    body: Result<Json<Select>, JsonRejection>,
) -> Response {
    let Ok(Json(body)) = body else {
        return failure("invalid_request");
    };
    let Some(lease) = c.0.torrent.get(&id) else {
        return failure("session_missing");
    };
    match lease.choose(body.file_index) {
        Ok(view) => (StatusCode::ACCEPTED, Json(view)).into_response(),
        Err(code) => failure(code),
    }
}
fn range(value: Option<&str>, size: u64) -> Result<(u64, u64, bool), ()> {
    let Some(value) = value else {
        return Ok((0, size, false));
    };
    let value = value.strip_prefix("bytes=").ok_or(())?;
    let (start, end) = value.split_once('-').ok_or(())?;
    fn number(value: &str) -> Result<u64, ()> {
        if value.is_empty() || !value.bytes().all(|v| v.is_ascii_digit()) {
            return Err(());
        }
        value.parse().map_err(|_| ())
    }
    if start.is_empty() {
        let length = number(end)?.min(size);
        if length == 0 {
            return Err(());
        }
        return Ok((size - length, length, true));
    }
    let start = number(start)?;
    if start >= size {
        return Err(());
    }
    let end = if end.is_empty() {
        size - 1
    } else {
        number(end)?.min(size - 1)
    };
    if end < start {
        return Err(());
    }
    Ok((start, end - start + 1, true))
}
async fn stream(
    State(c): State<Companion>,
    Path((_, id)): Path<(String, String)>,
    method: Method,
    headers: HeaderMap,
) -> Response {
    let Some(lease) = c.0.torrent.get(&id) else {
        return failure("session_missing");
    };
    let view = lease.view();
    if view.state != "ready" {
        return failure("session_busy");
    }
    let Some(file) = view
        .files
        .iter()
        .find(|file| Some(file.index) == view.selected)
    else {
        return failure("invalid_file");
    };
    let ranges: Vec<_> = headers.get_all(header::RANGE).iter().collect();
    let parsed = match ranges.as_slice() {
        [] => range(None, file.length),
        [value] => value
            .to_str()
            .map_err(|_| ())
            .and_then(|value| range(Some(value), file.length)),
        _ => Err(()),
    };
    let (start, length, partial) = match parsed {
        Ok(v) => v,
        Err(()) => {
            return (
                StatusCode::RANGE_NOT_SATISFIABLE,
                [(header::CONTENT_RANGE, format!("bytes */{}", file.length))],
            )
                .into_response()
        }
    };
    let body = if method == Method::HEAD {
        Body::empty()
    } else {
        match c.0.torrent.stream(lease, start, length).await {
            Ok(body) => body,
            Err(code) => return failure(code),
        }
    };
    let mime = match file
        .name
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "mkv" => "video/x-matroska",
        "avi" => "video/x-msvideo",
        "ts" => "video/mp2t",
        "mp3" => "audio/mpeg",
        "m4a" => "audio/mp4",
        _ => "application/octet-stream",
    };
    let mut response = Response::builder()
        .status(if partial {
            StatusCode::PARTIAL_CONTENT
        } else {
            StatusCode::OK
        })
        .header(header::CONTENT_TYPE, mime)
        .header(header::CONTENT_LENGTH, length.to_string())
        .header(header::ACCEPT_RANGES, "bytes");
    if partial {
        response = response.header(
            header::CONTENT_RANGE,
            format!("bytes {}-{}/{}", start, start + length - 1, file.length),
        );
    }
    response.body(body).unwrap()
}
async fn plugin_list(State(c): State<Companion>) -> Json<Value> {
    Json(json!({"schema":1,"plugins":c.0.plugins.list()}))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Resolve {
    input: Value,
}
async fn plugin_resolve(
    State(c): State<Companion>,
    Path((_, id)): Path<(String, String)>,
    body: Result<Json<Resolve>, JsonRejection>,
) -> Response {
    let Ok(Json(body)) = body else {
        return failure("invalid_request");
    };
    let cancel = c.0.cancel.child_token();
    let _guard = cancel.clone().drop_guard();
    match c.0.plugins.resolve(&id, body.input, cancel).await {
        Ok(output) => Json(output).into_response(),
        Err(error) => failure(error.code()),
    }
}
