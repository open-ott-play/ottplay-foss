//! Local media: private server imports and native-picked, read-only source references.
//! Requests can select opaque IDs only, never filesystem paths.
use axum::{
    body::{Body, Bytes},
    extract::{DefaultBodyLimit, Path, Query, State},
    http::{HeaderMap, HeaderValue, Method, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use futures_util::{stream, StreamExt};
use serde::{Deserialize, Serialize};
use std::{
    path::{Path as FsPath, PathBuf},
    sync::Arc,
};
use tokio::{
    fs,
    io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt},
    sync::Mutex,
};

const MAX_BYTES: u64 = 16 * 1024 * 1024 * 1024;
// An abandoned upload is never catalogued. Drop its file handle before the
// best-effort removal of its partial file (including cancelled requests).
struct PendingUpload {
    file: Option<fs::File>,
    path: PathBuf,
}
impl Drop for PendingUpload {
    fn drop(&mut self) {
        drop(self.file.take());
        let _ = std::fs::remove_file(&self.path);
    }
}

#[derive(Clone)]
pub struct Library {
    root: PathBuf,
    token: String,
    storage: String,
    mutation: Arc<Mutex<()>>,
}
#[derive(Clone, Serialize, Deserialize)]
struct Record {
    id: String,
    name: String,
    size: u64,
    mime: String,
    extension: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    linked_path: Option<PathBuf>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    source_id: Option<String>,
}
#[derive(Clone, Serialize, Deserialize)]
struct SourceRecord {
    id: String,
    name: String,
    kind: String,
    path: PathBuf,
}
#[derive(Serialize)]
pub struct Source {
    id: String,
    name: String,
    kind: String,
    available: bool,
    access: &'static str,
}
#[derive(Serialize)]
pub struct Item {
    pub id: String,
    pub name: String,
    pub size: u64,
    pub mime: String,
    pub url: String,
    pub available: bool,
    pub source: &'static str,
    #[serde(rename = "sourceId")]
    pub source_id: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    pub available: bool,
    pub items: Vec<Item>,
    pub storage: String,
    pub persistent: bool,
    pub upload_url: String,
    pub direct_sources: bool,
    pub sources: Vec<Source>,
}
#[derive(Deserialize)]
struct ImportQuery {
    name: String,
}

type Failure = (StatusCode, &'static str);
impl Library {
    pub async fn new(root: PathBuf, token: String, storage: &str) -> anyhow::Result<Self> {
        anyhow::ensure!(
            token.len() >= 32
                && token
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'),
            "Offline media token must contain at least 32 URL-safe characters"
        );
        fs::create_dir_all(&root).await?;
        let root = fs::canonicalize(root).await?;
        Ok(Self {
            root,
            token,
            storage: storage.into(),
            mutation: Arc::new(Mutex::new(())),
        })
    }
    pub fn endpoint(&self) -> String {
        format!("/offline-media/{}", self.token)
    }
    pub fn routes(self) -> Router {
        Router::new()
            .route("/offline-media/:token", get(catalog).options(preflight))
            .route(
                "/offline-media/:token/import",
                post(import).options(preflight),
            )
            .route(
                "/offline-media/:token/sources/:id",
                axum::routing::delete(remove_source).options(preflight),
            )
            .route(
                "/offline-media/:token/:id",
                get(media).delete(remove).options(preflight),
            )
            .layer(DefaultBodyLimit::disable())
            .with_state(self)
    }
    fn authorize(&self, token: &str) -> Result<(), Failure> {
        // Fixed-length comparison avoids early exits on a matching prefix.
        let mut diff = self.token.len() ^ token.len();
        for (a, b) in self.token.bytes().zip(token.bytes()) {
            diff |= (a ^ b) as usize;
        }
        if diff != 0 {
            Err((StatusCode::NOT_FOUND, "Not found"))
        } else {
            Ok(())
        }
    }
    async fn records(&self) -> Result<Vec<Record>, Failure> {
        let mut directory = fs::read_dir(&self.root).await.map_err(storage_error)?;
        let mut out = Vec::new();
        while let Some(entry) = directory.next_entry().await.map_err(storage_error)? {
            let path = entry.path();
            if path.extension().and_then(|v| v.to_str()) != Some("json") {
                continue;
            }
            let kind = match entry.file_type().await {
                Ok(kind) => kind,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
                Err(e) => return Err(storage_error(e)),
            };
            if !kind.is_file() {
                continue;
            }
            let metadata = match entry.metadata().await {
                Ok(metadata) => metadata,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
                Err(e) => return Err(storage_error(e)),
            };
            if metadata.len() > 4096 {
                continue;
            }
            let bytes = match fs::read(&path).await {
                Ok(bytes) => bytes,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
                Err(e) => return Err(storage_error(e)),
            };
            if bytes.len() > 4096 {
                continue;
            }
            if let Ok(record) = serde_json::from_slice::<Record>(&bytes) {
                if valid_id(&record.id)
                    && media_type(&record.extension) == Some(record.mime.as_str())
                    && (record.linked_path.is_some() || self.path(&record).await.is_ok())
                {
                    out.push(record);
                }
            }
        }
        out.sort_by(|a, b| {
            a.name
                .to_lowercase()
                .cmp(&b.name.to_lowercase())
                .then(a.id.cmp(&b.id))
        });
        Ok(out)
    }
    async fn path(&self, record: &Record) -> Result<PathBuf, Failure> {
        let path = record.linked_path.clone().unwrap_or_else(|| {
            self.root
                .join(format!("{}.{}", record.id, record.extension))
        });
        if record.linked_path.is_some()
            && fs::canonicalize(&path).await.ok().as_ref() != Some(&path)
        {
            return Err((StatusCode::GONE, "Original source unavailable"));
        }
        let metadata = fs::symlink_metadata(&path)
            .await
            .map_err(|_| (StatusCode::NOT_FOUND, "Media not found"))?;
        if !metadata.is_file() || metadata.file_type().is_symlink() {
            return Err((StatusCode::NOT_FOUND, "Media not found"));
        }
        Ok(path)
    }
    async fn record(&self, id: &str) -> Result<Record, Failure> {
        if !valid_id(id) {
            return Err((StatusCode::NOT_FOUND, "Media not found"));
        }
        self.records()
            .await?
            .into_iter()
            .find(|r| r.id == id)
            .ok_or((StatusCode::NOT_FOUND, "Media not found"))
    }
    async fn source_records(&self) -> Result<Vec<SourceRecord>, Failure> {
        let folder = self.root.join("sources");
        fs::create_dir_all(&folder).await.map_err(storage_error)?;
        let mut entries = fs::read_dir(folder).await.map_err(storage_error)?;
        let mut sources = Vec::new();
        while let Some(entry) = entries.next_entry().await.map_err(storage_error)? {
            if !entry.file_type().await.map_err(storage_error)?.is_file()
                || entry.path().extension().and_then(|x| x.to_str()) != Some("json")
            {
                continue;
            }
            if entry.metadata().await.map_err(storage_error)?.len() > 16384 {
                continue;
            }
            if let Ok(bytes) = fs::read(entry.path()).await {
                if let Ok(source) = serde_json::from_slice::<SourceRecord>(&bytes) {
                    if valid_id(&source.id) {
                        sources.push(source);
                    }
                }
            }
        }
        Ok(sources)
    }

    /// Called only with paths returned by an OS-native picker, never HTTP input.
    /// Stores names and original paths; no source media is copied or deleted.
    pub async fn link_paths(&self, paths: Vec<PathBuf>, folder: bool) -> anyhow::Result<()> {
        anyhow::ensure!(
            self.storage == "device",
            "Native sources are unavailable on this server"
        );
        let _lock = self.mutation.lock().await;
        let records = self
            .records()
            .await
            .map_err(|_| anyhow::anyhow!("Cannot read media metadata"))?;
        let mut known_paths: std::collections::HashSet<PathBuf> = records.iter()
            .filter_map(|record| record.linked_path.clone()).collect();
        let sources = self
            .source_records()
            .await
            .map_err(|_| anyhow::anyhow!("Cannot read media sources"))?;
        for picked in paths {
            let root = fs::canonicalize(&picked).await?;
            let metadata = fs::metadata(&root).await?;
            anyhow::ensure!(
                if folder {
                    metadata.is_dir()
                } else {
                    metadata.is_file()
                },
                "Invalid selected source"
            );
            let id = sources
                .iter()
                .find(|s| s.path == root)
                .map(|s| s.id.clone())
                .unwrap_or_else(|| uuid::Uuid::new_v4().simple().to_string());
            let name = root
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("Local media")
                .to_string();
            let source = SourceRecord {
                id: id.clone(),
                name,
                kind: if folder { "folder" } else { "file" }.into(),
                path: root.clone(),
            };
            // Fail an inaccessible selected root, but keep a valid source record
            // before discovering children so a partial scan remains refreshable.
            if folder {
                drop(fs::read_dir(&root).await?);
            } else {
                fs::File::open(&root).await?;
            }
            let destination = self.root.join("sources").join(format!("{id}.json"));
            let temporary = destination.with_extension("part");
            fs::write(&temporary, serde_json::to_vec(&source)?).await?;
            fs::rename(temporary, destination).await?;
            let mut pending = vec![root.clone()];
            let mut count = 0;
            while let Some(path) = pending.pop() {
                count += 1;
                anyhow::ensure!(count <= 20000, "Selected source contains too many entries");
                let metadata = match fs::symlink_metadata(&path).await {
                    Ok(metadata) => metadata,
                    Err(error) if path == root => return Err(error.into()),
                    Err(_) => continue,
                };
                // Do not traverse symlinks out of the user's selected tree.
                if metadata.file_type().is_symlink() {
                    continue;
                }
                if metadata.is_dir() {
                    let mut children = match fs::read_dir(&path).await {
                        Ok(children) => children,
                        Err(error) if path == root => return Err(error.into()),
                        Err(_) => continue,
                    };
                    while let Ok(Some(entry)) = children.next_entry().await {
                        pending.push(entry.path());
                    }
                    continue;
                }
                if !metadata.is_file() {
                    continue;
                }
                let extension = path
                    .extension()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_ascii_lowercase();
                let Some(mime) = media_type(&extension) else {
                    continue;
                };
                if known_paths.contains(&path) {
                    continue;
                }
                if let Err(error) = fs::File::open(&path).await {
                    if path == root { return Err(error.into()); }
                    continue;
                }
                let record = Record {
                    id: uuid::Uuid::new_v4().simple().to_string(),
                    name: path
                        .file_name()
                        .and_then(|s| s.to_str())
                        .unwrap_or("Local media")
                        .into(),
                    size: metadata.len(),
                    mime: mime.into(),
                    extension,
                    linked_path: Some(path.clone()),
                    source_id: Some(id.clone()),
                };
                let destination = self.root.join(format!("{}.json", record.id));
                let temporary = destination.with_extension("part");
                fs::write(&temporary, serde_json::to_vec(&record)?).await?;
                fs::rename(temporary, destination).await?;
                known_paths.insert(path);
            }
        }
        Ok(())
    }

    /// Refresh existing folder grants without dropping missing files or changing stable IDs.
    pub async fn refresh_sources(&self) {
        if self.storage != "device" {
            return;
        }
        let Ok(sources) = self.source_records().await else {
            return;
        };
        for source in sources {
            if source.kind != "folder" {
                continue;
            }
            // Unmounted, moved or denied sources remain visible for reconnection.
            if let Err(_error) = self.link_paths(vec![source.path], true).await {
                tracing::debug!("Local source currently unavailable during refresh");
            }
        }
    }

    pub async fn disconnect_source(&self, id: &str) -> anyhow::Result<()> {
        anyhow::ensure!(valid_id(id), "Invalid source ID");
        let _lock = self.mutation.lock().await;
        for record in self
            .records()
            .await
            .map_err(|_| anyhow::anyhow!("Cannot read media metadata"))?
        {
            if record.source_id.as_deref().unwrap_or(&record.id) != id {
                continue;
            }
            if record.linked_path.is_none() {
                if let Ok(path) = self.path(&record).await {
                    fs::remove_file(path).await?;
                }
            }
            fs::remove_file(self.root.join(format!("{}.json", record.id))).await?;
        }
        let path = self.root.join("sources").join(format!("{id}.json"));
        if fs::try_exists(&path).await? {
            fs::remove_file(path).await?;
        }
        Ok(())
    }

    pub async fn catalog(&self) -> Result<Catalog, Failure> {
        let base = self.endpoint();
        let records = self.records().await?;
        let mut items = Vec::new();
        for r in records {
            let available = self.path(&r).await.is_ok();
            let size = match self.path(&r).await {
                Ok(path) => fs::metadata(path).await.map(|m| m.len()).unwrap_or(r.size),
                Err(_) => r.size,
            };
            items.push(Item {
                id: r.id.clone(),
                name: r.name,
                size,
                mime: r.mime,
                url: if available {
                    format!("{base}/{}", r.id)
                } else {
                    String::new()
                },
                available,
                source: if r.linked_path.is_some() {
                    "linked"
                } else {
                    "imported"
                },
                source_id: r.source_id.unwrap_or(r.id),
            });
        }
        let mut sources = Vec::new();
        for source in self.source_records().await? {
            let available = fs::symlink_metadata(&source.path)
                .await
                .map(|m| {
                    !m.file_type().is_symlink()
                        && if source.kind == "folder" {
                            m.is_dir()
                        } else {
                            m.is_file()
                        }
                })
                .unwrap_or(false);
            sources.push(Source {
                id: source.id,
                name: source.name,
                kind: source.kind,
                available,
                access: if available { "granted" } else { "unavailable" },
            });
        }
        for item in &items {
            if !sources.iter().any(|s| s.id == item.source_id) {
                sources.push(Source {
                    id: item.source_id.clone(),
                    name: item.name.clone(),
                    kind: "file".into(),
                    available: item.available,
                    access: if item.available {
                        "granted"
                    } else {
                        "unavailable"
                    },
                });
            }
        }
        Ok(Catalog {
            available: true,
            items,
            storage: self.storage.clone(),
            persistent: true,
            upload_url: format!("{base}/import"),
            direct_sources: self.storage == "device",
            sources,
        })
    }
}
fn valid_id(id: &str) -> bool {
    id.len() == 32 && id.bytes().all(|b| b.is_ascii_hexdigit())
}
fn storage_error<T>(_: T) -> Failure {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        "Local media storage unavailable",
    )
}
fn media_type(extension: &str) -> Option<&'static str> {
    match extension {
        "mp4" | "m4v" => Some("video/mp4"),
        "webm" => Some("video/webm"),
        "ogv" => Some("video/ogg"),
        "mp3" => Some("audio/mpeg"),
        "m4a" => Some("audio/mp4"),
        "ogg" => Some("audio/ogg"),
        _ => None,
    }
}
fn cors(response: &mut Response) {
    let h = response.headers_mut();
    h.insert("access-control-allow-origin", HeaderValue::from_static("*"));
    h.insert(
        "access-control-allow-methods",
        HeaderValue::from_static("GET, HEAD, POST, DELETE, OPTIONS"),
    );
    h.insert(
        "access-control-allow-headers",
        HeaderValue::from_static("Content-Type, Range"),
    );
    h.insert(
        "access-control-expose-headers",
        HeaderValue::from_static("Content-Length, Content-Range, Accept-Ranges"),
    );
    h.insert("cache-control", HeaderValue::from_static("no-store"));
    h.insert("referrer-policy", HeaderValue::from_static("no-referrer"));
}
async fn preflight(
    State(l): State<Library>,
    Path(params): Path<std::collections::HashMap<String, String>>,
) -> Response {
    let mut r = match l.authorize(params.get("token").map(String::as_str).unwrap_or("")) {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => e.into_response(),
    };
    cors(&mut r);
    r
}
async fn catalog(State(l): State<Library>, Path(token): Path<String>) -> Response {
    let mut r = match l.authorize(&token) {
        Ok(()) => match l.catalog().await {
            Ok(c) => Json(c).into_response(),
            Err(e) => e.into_response(),
        },
        Err(e) => e.into_response(),
    };
    cors(&mut r);
    r
}
async fn import(
    State(l): State<Library>,
    Path(token): Path<String>,
    Query(q): Query<ImportQuery>,
    body: Body,
) -> Response {
    let result = import_inner(&l, &token, &q.name, body).await;
    let mut r = match result {
        Ok(c) => Json(c).into_response(),
        Err(e) => e.into_response(),
    };
    cors(&mut r);
    r
}
async fn import_inner(
    l: &Library,
    token: &str,
    name: &str,
    body: Body,
) -> Result<Catalog, Failure> {
    l.authorize(token)?;
    if name.is_empty()
        || name.len() > 240
        || name
            .chars()
            .any(|c| c.is_control() || c == '/' || c == '\\')
    {
        return Err((StatusCode::BAD_REQUEST, "Invalid media filename"));
    }
    let extension = FsPath::new(name)
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let mime = media_type(&extension).ok_or((
        StatusCode::UNSUPPORTED_MEDIA_TYPE,
        "Use MP4, WebM, OGV, MP3, M4A or OGG",
    ))?;
    let _lock = l.mutation.lock().await;
    let id = uuid::Uuid::new_v4().simple().to_string();
    let temporary = l.root.join(format!("{id}.upload"));
    let target = l.root.join(format!("{id}.{extension}"));
    // Ownership is established inside the blocking task, so cancellation while
    // creating the file still drops a guard instead of leaving an orphan.
    let upload_path = temporary.clone();
    let mut upload = tokio::task::spawn_blocking(move || {
        let file = std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&upload_path)?;
        Ok::<_, std::io::Error>(PendingUpload {
            file: Some(fs::File::from_std(file)),
            path: upload_path,
        })
    })
    .await
    .map_err(storage_error)?
    .map_err(storage_error)?;
    let write_result: Result<u64, Failure> = async {
        let mut size = 0u64;
        let mut chunks = body.into_data_stream();
        while let Some(chunk) =
            tokio::time::timeout(std::time::Duration::from_secs(60), chunks.next())
                .await
                .map_err(|_| (StatusCode::REQUEST_TIMEOUT, "Upload stalled"))?
        {
            let chunk = chunk.map_err(|_| (StatusCode::BAD_REQUEST, "Upload interrupted"))?;
            size = size
                .checked_add(chunk.len() as u64)
                .filter(|s| *s <= MAX_BYTES)
                .ok_or((
                    StatusCode::PAYLOAD_TOO_LARGE,
                    "Maximum media size is 16 GiB",
                ))?;
            upload
                .file
                .as_mut()
                .unwrap()
                .write_all(&chunk)
                .await
                .map_err(storage_error)?;
        }
        if size == 0 {
            return Err((StatusCode::BAD_REQUEST, "Media file is empty"));
        }
        upload
            .file
            .as_mut()
            .unwrap()
            .flush()
            .await
            .map_err(storage_error)?;
        Ok(size)
    }
    .await;
    drop(upload.file.take());
    let size = match write_result {
        Ok(size) => size,
        Err(e) => {
            let _ = fs::remove_file(&temporary).await;
            return Err(e);
        }
    };
    fs::rename(&temporary, &target)
        .await
        .map_err(storage_error)?;
    let record = Record {
        id: id.clone(),
        name: name.into(),
        size,
        mime: mime.into(),
        extension,
        linked_path: None,
        source_id: None,
    };
    let encoded = serde_json::to_vec(&record).map_err(storage_error)?;
    if let Err(e) = fs::write(l.root.join(format!("{id}.json")), encoded).await {
        let _ = fs::remove_file(target).await;
        return Err(storage_error(e));
    }
    l.catalog().await
}
async fn remove(State(l): State<Library>, Path((token, id)): Path<(String, String)>) -> Response {
    let result: Result<Catalog, Failure> = async {
        l.authorize(&token)?;
        let _lock = l.mutation.lock().await;
        let record = l.record(&id).await?;
        if record.linked_path.is_none() {
            fs::remove_file(l.path(&record).await?)
                .await
                .map_err(storage_error)?;
        }
        fs::remove_file(l.root.join(format!("{id}.json")))
            .await
            .map_err(storage_error)?;
        l.catalog().await
    }
    .await;
    let mut r = match result {
        Ok(c) => Json(c).into_response(),
        Err(e) => e.into_response(),
    };
    cors(&mut r);
    r
}
async fn remove_source(
    State(l): State<Library>,
    Path((token, id)): Path<(String, String)>,
) -> Response {
    let result = async {
        l.authorize(&token)?;
        l.disconnect_source(&id).await.map_err(storage_error)?;
        l.catalog().await
    }
    .await;
    let mut response = match result {
        Ok(catalog) => Json(catalog).into_response(),
        Err(error) => error.into_response(),
    };
    cors(&mut response);
    response
}

fn byte_range(value: Option<&str>, size: u64) -> Result<Option<(u64, u64)>, Failure> {
    let Some(value) = value else { return Ok(None) };
    let fail = || (StatusCode::RANGE_NOT_SATISFIABLE, "Invalid byte range");
    let raw = value.strip_prefix("bytes=").ok_or_else(fail)?;
    if raw.contains(',') || size == 0 {
        return Err(fail());
    }
    let (a, b) = raw.split_once('-').ok_or_else(fail)?;
    let range = if a.is_empty() {
        let length = b.parse::<u64>().map_err(|_| fail())?;
        if length == 0 {
            return Err(fail());
        }
        (size.saturating_sub(length), size - 1)
    } else {
        let start = a.parse::<u64>().map_err(|_| fail())?;
        let end = if b.is_empty() {
            size - 1
        } else {
            b.parse::<u64>().map_err(|_| fail())?.min(size - 1)
        };
        if start >= size || end < start {
            return Err(fail());
        }
        (start, end)
    };
    Ok(Some(range))
}
async fn media(
    State(l): State<Library>,
    Path((token, id)): Path<(String, String)>,
    headers: HeaderMap,
    method: Method,
) -> Response {
    let result: Result<Response, Failure> = async {
        l.authorize(&token)?;
        let record = l.record(&id).await?;
        let mut file = fs::File::open(l.path(&record).await?)
            .await
            .map_err(storage_error)?;
        let size = file.metadata().await.map_err(storage_error)?.len();
        let range = match byte_range(headers.get("range").and_then(|v| v.to_str().ok()), size) {
            Ok(r) => r,
            Err(e) => {
                let mut r = e.into_response();
                r.headers_mut()
                    .insert("content-range", format!("bytes */{size}").parse().unwrap());
                return Ok(r);
            }
        };
        let (start, end) = range.unwrap_or((0, size.saturating_sub(1)));
        let length = if size == 0 { 0 } else { end - start + 1 };
        file.seek(std::io::SeekFrom::Start(start))
            .await
            .map_err(storage_error)?;
        let body = if method == Method::HEAD {
            Body::empty()
        } else {
            Body::from_stream(stream::try_unfold(
                (file, length),
                |(mut file, left)| async move {
                    if left == 0 {
                        return Ok::<_, std::io::Error>(None);
                    }
                    let mut bytes = vec![0; left.min(64 * 1024) as usize];
                    let read = file.read(&mut bytes).await?;
                    if read == 0 {
                        return Err(std::io::Error::new(
                            std::io::ErrorKind::UnexpectedEof,
                            "Local media truncated",
                        ));
                    }
                    bytes.truncate(read);
                    Ok(Some((Bytes::from(bytes), (file, left - read as u64))))
                },
            ))
        };
        let mut r = Response::new(body);
        *r.status_mut() = if range.is_some() {
            StatusCode::PARTIAL_CONTENT
        } else {
            StatusCode::OK
        };
        let h = r.headers_mut();
        h.insert("content-type", record.mime.parse().unwrap());
        h.insert("content-length", length.into());
        h.insert("accept-ranges", HeaderValue::from_static("bytes"));
        if range.is_some() {
            h.insert(
                "content-range",
                format!("bytes {start}-{end}/{size}").parse().unwrap(),
            );
        }
        Ok(r)
    }
    .await;
    let mut r = match result {
        Ok(r) => r,
        Err(e) => e.into_response(),
    };
    cors(&mut r);
    r
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn native_sources_stream_originals_persist_and_disconnect_without_deleting() {
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        let originals = root.with_extension("originals");
        fs::create_dir_all(originals.join("subfolder"))
            .await
            .unwrap();
        let movie = originals.join("subfolder").join("movie.mp4");
        fs::write(&movie, "0123456789").await.unwrap();
        fs::write(originals.join("notes.txt"), "keep this")
            .await
            .unwrap();
        let library = Library::new(root.clone(), "g".repeat(32), "device")
            .await
            .unwrap();
        library
            .link_paths(vec![originals.clone()], true)
            .await
            .unwrap();
        let catalog = library.catalog().await.unwrap();
        assert_eq!(catalog.items.len(), 1);
        assert_eq!(catalog.sources.len(), 1);
        assert_eq!(catalog.items[0].source, "linked");
        assert_eq!(catalog.items[0].source_id, catalog.sources[0].id);
        // App data contains metadata only, never an mp4 copy.
        assert!(!root.join(format!("{}.mp4", catalog.items[0].id)).exists());
        let original_id = catalog.items[0].id.clone();
        fs::write(originals.join("new.mp4"), "new content")
            .await
            .unwrap();
        library.refresh_sources().await;
        let refreshed = library.catalog().await.unwrap();
        assert_eq!(refreshed.items.len(), 2);
        assert!(refreshed.items.iter().any(|item| item.id == original_id));
        library.refresh_sources().await;
        assert_eq!(library.catalog().await.unwrap().items.len(), 2);
        let reopened = Library::new(root.clone(), "h".repeat(32), "device")
            .await
            .unwrap();
        assert_eq!(reopened.catalog().await.unwrap().items.len(), 2);
        let mut headers = HeaderMap::new();
        headers.insert("range", "bytes=2-5".parse().unwrap());
        let response = media(
            State(reopened.clone()),
            Path(("h".repeat(32), catalog.items[0].id.clone())),
            headers,
            Method::GET,
        )
        .await;
        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(
            axum::body::to_bytes(response.into_body(), 1024)
                .await
                .unwrap(),
            "2345"
        );
        // Missing original stays visible but cannot be played.
        fs::rename(&movie, movie.with_extension("moved"))
            .await
            .unwrap();
        reopened.refresh_sources().await;
        let missing = reopened.catalog().await.unwrap();
        let missing_original = missing
            .items
            .iter()
            .find(|item| item.id == original_id)
            .unwrap();
        assert!(!missing_original.available);
        assert!(missing_original.url.is_empty());
        reopened
            .disconnect_source(&catalog.sources[0].id)
            .await
            .unwrap();
        assert!(reopened.catalog().await.unwrap().items.is_empty());
        assert_eq!(
            fs::read(movie.with_extension("moved")).await.unwrap(),
            b"0123456789"
        );
        assert_eq!(
            fs::read(originals.join("notes.txt")).await.unwrap(),
            b"keep this"
        );
        fs::remove_dir_all(root).await.unwrap();
        fs::remove_dir_all(originals).await.unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn native_folder_does_not_follow_external_symlinks() {
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        let originals = root.with_extension("originals");
        let secret = root.with_extension("secret.mp4");
        fs::create_dir_all(&originals).await.unwrap();
        fs::write(&secret, "private").await.unwrap();
        std::os::unix::fs::symlink(&secret, originals.join("escape.mp4")).unwrap();
        let library = Library::new(root.clone(), "i".repeat(32), "device")
            .await
            .unwrap();
        library
            .link_paths(vec![originals.clone()], true)
            .await
            .unwrap();
        assert!(library.catalog().await.unwrap().items.is_empty());
        fs::remove_dir_all(root).await.unwrap();
        fs::remove_dir_all(originals).await.unwrap();
        fs::remove_file(secret).await.unwrap();
    }

    #[test]
    fn ranges() {
        assert_eq!(byte_range(Some("bytes=2-4"), 10).unwrap(), Some((2, 4)));
        assert_eq!(byte_range(Some("bytes=-3"), 10).unwrap(), Some((7, 9)));
        assert_eq!(byte_range(Some("bytes=8-"), 10).unwrap(), Some((8, 9)));
        assert!(byte_range(Some("bytes=10-"), 10).is_err());
        assert!(byte_range(Some("bytes=1-2,4-5"), 10).is_err());
    }
    #[tokio::test]
    async fn imports_persist_and_reject_paths() {
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        let l = Library::new(root.clone(), "a".repeat(32), "device")
            .await
            .unwrap();
        assert!(
            import_inner(&l, &"b".repeat(32), "a.mp4", Body::from("123"))
                .await
                .is_err()
        );
        assert!(
            import_inner(&l, &"a".repeat(32), "../a.mp4", Body::from("123"))
                .await
                .is_err()
        );
        let catalog = import_inner(&l, &"a".repeat(32), "cartoon.mp4", Body::from("12345"))
            .await
            .unwrap();
        assert_eq!(catalog.items.len(), 1);
        assert_eq!(catalog.items[0].size, 5);
        let reopened = Library::new(root.clone(), "a".repeat(32), "device")
            .await
            .unwrap();
        assert_eq!(reopened.catalog().await.unwrap().items.len(), 1);
        fs::remove_dir_all(root).await.unwrap();
    }
    #[tokio::test]
    async fn http_upload_range_head_delete_and_preflight() {
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        let l = Library::new(root.clone(), "c".repeat(32), "device")
            .await
            .unwrap();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let base = format!("{origin}{}", l.endpoint());
        let task = tokio::spawn(async move { axum::serve(listener, l.routes()).await.unwrap() });
        let client = reqwest::Client::new();
        assert_eq!(
            client
                .get(format!("{origin}/offline-media/{}", "x".repeat(32)))
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::NOT_FOUND
        );
        let upload = client
            .post(format!("{base}/import?name=test.mp4"))
            .body("0123456789")
            .send()
            .await
            .unwrap();
        assert_eq!(upload.status(), StatusCode::OK);
        let catalog: serde_json::Value = upload.json().await.unwrap();
        let url = format!("{origin}{}", catalog["items"][0]["url"].as_str().unwrap());
        let range = client
            .get(&url)
            .header("Range", "bytes=2-5")
            .send()
            .await
            .unwrap();
        assert_eq!(range.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(range.headers()["content-range"], "bytes 2-5/10");
        assert_eq!(range.bytes().await.unwrap(), "2345");
        let invalid = client
            .get(&url)
            .header("Range", "bytes=20-")
            .send()
            .await
            .unwrap();
        assert_eq!(invalid.status(), StatusCode::RANGE_NOT_SATISFIABLE);
        assert_eq!(invalid.headers()["content-range"], "bytes */10");
        let head = client.head(&url).send().await.unwrap();
        assert_eq!(head.headers()["content-length"], "10");
        assert!(head.bytes().await.unwrap().is_empty());
        let options = client
            .request(reqwest::Method::OPTIONS, &url)
            .send()
            .await
            .unwrap();
        assert_eq!(options.status(), StatusCode::NO_CONTENT);
        assert_eq!(
            client.delete(&url).send().await.unwrap().status(),
            StatusCode::OK
        );
        assert_eq!(
            client.get(&url).send().await.unwrap().status(),
            StatusCode::NOT_FOUND
        );
        task.abort();
        fs::remove_dir_all(root).await.unwrap();
    }
    #[tokio::test]
    async fn cancelled_upload_removes_partial_file() {
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        let l = Library::new(root.clone(), "d".repeat(32), "device")
            .await
            .unwrap();
        let body = Body::from_stream(
            stream::iter(vec![Ok::<_, std::io::Error>(Bytes::from_static(
                b"partial",
            ))])
            .chain(stream::pending()),
        );
        let task =
            tokio::spawn(async move { import_inner(&l, &"d".repeat(32), "test.mp4", body).await });
        let mut started = false;
        for _ in 0..100 {
            if fs::read_dir(&root)
                .await
                .unwrap()
                .next_entry()
                .await
                .unwrap()
                .is_some()
            {
                started = true;
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
        assert!(started);
        task.abort();
        let _ = task.await;
        let mut clean = false;
        for _ in 0..100 {
            if fs::read_dir(&root)
                .await
                .unwrap()
                .next_entry()
                .await
                .unwrap()
                .is_none()
            {
                clean = true;
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
        assert!(clean);
        fs::remove_dir_all(root).await.unwrap();
    }
    #[tokio::test]
    async fn rejects_unsafe_tokens_and_path_ids() {
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        assert!(Library::new(root.clone(), "short".into(), "device")
            .await
            .is_err());
        assert!(Library::new(root.clone(), "a/".repeat(32), "device")
            .await
            .is_err());
        let l = Library::new(root.clone(), "e".repeat(32), "device")
            .await
            .unwrap();
        assert!(l.authorize(&"e".repeat(31)).is_err());
        assert!(l.authorize(&format!("{}x", "e".repeat(32))).is_err());
        let result = media(
            State(l),
            Path(("e".repeat(32), "../private".into())),
            HeaderMap::new(),
            Method::GET,
        )
        .await;
        assert_eq!(result.status(), StatusCode::NOT_FOUND);
        fs::remove_dir_all(root).await.unwrap();
    }

    #[tokio::test]
    async fn request_ids_cannot_escape_library_or_delete_originals() {
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        let outside = root.with_extension("mp4");
        fs::write(&outside, "original outside library")
            .await
            .unwrap();
        let token = "j".repeat(32);
        let library = Library::new(root.clone(), token.clone(), "device")
            .await
            .unwrap();
        let saved = import_inner(&library, &token, "saved.mp4", Body::from("saved media"))
            .await
            .unwrap();
        let saved_id = saved.items[0].id.clone();
        for id in [
            "../outside",
            "..\\outside",
            "/tmp/outside",
            "C:\\outside",
            "%2e%2e%2foutside",
            "0123456789abcdef0123456789abcde/..",
            "gggggggggggggggggggggggggggggggg",
            "",
        ] {
            let response =
                remove(State(library.clone()), Path((token.clone(), id.to_owned()))).await;
            assert_eq!(response.status(), StatusCode::NOT_FOUND, "id={id}");
            assert!(library.disconnect_source(id).await.is_err(), "id={id}");
        }
        assert_eq!(
            fs::read(&outside).await.unwrap(),
            b"original outside library"
        );
        assert_eq!(library.catalog().await.unwrap().items[0].id, saved_id);
        fs::remove_dir_all(root).await.unwrap();
        fs::remove_file(outside).await.unwrap();
    }

    #[tokio::test]
    async fn malformed_metadata_cannot_introduce_path_components() {
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        let library = Library::new(root.clone(), "k".repeat(32), "device")
            .await
            .unwrap();
        for (index, (id, extension)) in [
            ("../outside", "mp4"),
            ("0123456789abcdef0123456789abcdef", "../../outside.mp4"),
            ("0123456789abcdef0123456789abcdef", "mp4/../../outside"),
        ]
        .into_iter()
        .enumerate()
        {
            let record = Record {
                id: id.into(),
                name: "Untrusted metadata".into(),
                size: 1,
                mime: "video/mp4".into(),
                extension: extension.into(),
                linked_path: None,
                source_id: None,
            };
            fs::write(
                root.join(format!("malformed-{index}.json")),
                serde_json::to_vec(&record).unwrap(),
            )
            .await
            .unwrap();
        }
        assert!(library.catalog().await.unwrap().items.is_empty());
        fs::remove_dir_all(root).await.unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn folder_scan_skips_unreadable_children_and_retains_refreshable_source() {
        use std::os::unix::fs::PermissionsExt;
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        let originals = root.join("originals");
        let denied = originals.join("denied");
        fs::create_dir_all(&denied).await.unwrap();
        fs::write(originals.join("good.mp4"), b"movie").await.unwrap();
        fs::write(denied.join("hidden.mp4"), b"movie").await.unwrap();
        fs::set_permissions(&denied, std::fs::Permissions::from_mode(0o000)).await.unwrap();
        let permission_is_enforced = fs::read_dir(&denied).await.is_err();
        let library = Library::new(root.join("library"), "k".repeat(32), "device").await.unwrap();
        let result = library.link_paths(vec![originals.clone()], true).await;
        fs::set_permissions(&denied, std::fs::Permissions::from_mode(0o700)).await.unwrap();
        result.unwrap();
        let sources = library.source_records().await.unwrap();
        assert_eq!(sources.len(), 1);
        assert_eq!(sources[0].kind, "folder");
        let records = library.records().await.unwrap();
        assert!(records.iter().any(|record| record.name == "good.mp4"));
        if permission_is_enforced {
            assert!(!records.iter().any(|record| record.name == "hidden.mp4"));
        }
        library.refresh_sources().await;
        assert!(library.records().await.unwrap().iter().any(|record| record.name == "hidden.mp4"));
        fs::remove_dir_all(root).await.unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn unreadable_selected_root_fails_without_creating_source() {
        use std::os::unix::fs::PermissionsExt;
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        let originals = root.join("originals");
        fs::create_dir_all(&originals).await.unwrap();
        let library = Library::new(root.join("library"), "k".repeat(32), "device").await.unwrap();
        fs::set_permissions(&originals, std::fs::Permissions::from_mode(0o000)).await.unwrap();
        let permission_is_enforced = fs::read_dir(&originals).await.is_err();
        let result = library.link_paths(vec![originals.clone()], true).await;
        fs::set_permissions(&originals, std::fs::Permissions::from_mode(0o700)).await.unwrap();
        if permission_is_enforced {
            assert!(result.is_err());
            assert!(library.source_records().await.unwrap().is_empty());
        }
        fs::remove_dir_all(root).await.unwrap();
    }

    #[tokio::test]
    async fn server_cannot_link_a_filesystem_source() {
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        let library = Library::new(root.clone(), "l".repeat(32), "server")
            .await
            .unwrap();
        assert!(library.link_paths(vec![root.clone()], true).await.is_err());
        assert!(!library.catalog().await.unwrap().direct_sources);
        assert!(library.catalog().await.unwrap().items.is_empty());
        fs::remove_dir_all(root).await.unwrap();
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn never_serves_symlinked_media_or_metadata() {
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        let outside = root.with_extension("private");
        let l = Library::new(root.clone(), "f".repeat(32), "device")
            .await
            .unwrap();
        let catalog = import_inner(&l, &"f".repeat(32), "movie.mp4", Body::from("movie"))
            .await
            .unwrap();
        let id = catalog.items[0].id.clone();
        let path = root.join(format!("{id}.mp4"));
        fs::write(&outside, "private data").await.unwrap();
        fs::remove_file(&path).await.unwrap();
        std::os::unix::fs::symlink(&outside, &path).unwrap();
        assert!(l.catalog().await.unwrap().items.is_empty());
        let result = media(
            State(l.clone()),
            Path(("f".repeat(32), id.clone())),
            HeaderMap::new(),
            Method::GET,
        )
        .await;
        assert_eq!(result.status(), StatusCode::NOT_FOUND);
        fs::remove_file(&path).await.unwrap();
        fs::write(&path, "movie").await.unwrap();
        let metadata = root.join(format!("{id}.json"));
        let saved = fs::read(&metadata).await.unwrap();
        fs::write(&outside, saved).await.unwrap();
        fs::remove_file(&metadata).await.unwrap();
        std::os::unix::fs::symlink(&outside, &metadata).unwrap();
        assert!(l.catalog().await.unwrap().items.is_empty());
        fs::remove_dir_all(root).await.unwrap();
        fs::remove_file(outside).await.unwrap();
    }
}
