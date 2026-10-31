//! Instance-owned torrent leases with bounded, selected-piece storage.
use super::storage::{CacheOwner, Reservation, WindowFactory, WindowInner};
use axum::body::Bytes;
use librqbit::storage::StorageFactoryExt;
use librqbit::{
    AddTorrent, AddTorrentOptions, AddTorrentResponse, ManagedTorrent, Session, SessionOptions,
};
use serde::Serialize;
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{atomic::AtomicU64, Arc, Mutex},
    time::{Duration, Instant},
};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncSeekExt},
    sync::{watch, Semaphore},
};
use tokio_util::sync::CancellationToken;

pub const MAX_SESSIONS: usize = 2;
pub const CACHE_LIMIT: u64 = 2 * 1024 * 1024 * 1024;
enum Source {
    Url(String),
    Metainfo(Vec<u8>),
}
const MAX_FILES: usize = 4096;
const METADATA_LIMIT: usize = 1024 * 1024;
const IDLE: Duration = Duration::from_secs(120);
pub(super) fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

#[derive(Clone, Serialize)]
pub struct MediaFile {
    pub index: usize,
    pub name: String,
    pub length: u64,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    pub id: String,
    pub state: &'static str,
    pub files: Vec<MediaFile>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub downloaded: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<&'static str>,
}
struct LeaseData {
    view: View,
    handle: Option<Arc<ManagedTorrent>>,
}
pub struct Lease {
    data: Mutex<LeaseData>,
    pub cancel: CancellationToken,
    select: watch::Sender<Option<usize>>,
    touched: Mutex<Instant>,
    created: Instant,
    done: watch::Sender<bool>,
}
impl Lease {
    pub fn view(&self) -> View {
        *lock(&self.touched) = Instant::now();
        let data = lock(&self.data);
        let mut view = data.view.clone();
        if let (Some(handle), Some(index)) = (&data.handle, view.selected) {
            let stats = handle.stats();
            view.downloaded = stats
                .file_progress
                .get(index)
                .copied()
                .map(|v| v.min(view.total.unwrap_or(v)));
            if stats.error.is_some() {
                view.state = "error";
                view.error = Some("torrent_failed");
                view.stream_path = None;
            }
        }
        view
    }
    pub fn choose(&self, index: usize) -> Result<View, &'static str> {
        let data = lock(&self.data);
        if self.cancel.is_cancelled() {
            return Err("session_stopped");
        }
        if data.view.state == "ready" && data.view.selected == Some(index) {
            drop(data);
            return Ok(self.view());
        }
        if data.view.state != "select" {
            return Err("session_busy");
        }
        if !data
            .view
            .files
            .iter()
            .any(|file| file.index == index && file.length > 0)
        {
            return Err("invalid_file");
        }
        if self.select.borrow().is_some() {
            return Err("session_busy");
        }
        self.select.send_replace(Some(index));
        drop(data);
        Ok(self.view())
    }
    fn fail(&self, code: &'static str) {
        let mut data = lock(&self.data);
        data.view.state = "error";
        data.view.error = Some(code);
        data.view.stream_path = None;
        data.handle = None;
    }
    pub async fn stop(&self) -> bool {
        self.cancel.cancel();
        let mut done = self.done.subscribe();
        let _ = tokio::time::timeout(Duration::from_secs(5), async {
            while !*done.borrow_and_update() {
                if done.changed().await.is_err() {
                    break;
                }
            }
        })
        .await;
        *self.done.borrow()
    }
    fn expired(&self) -> bool {
        lock(&self.touched).elapsed() > IDLE || self.created.elapsed() > Duration::from_secs(21600)
    }
}
pub struct TorrentManager {
    owner: Mutex<Option<Arc<CacheOwner>>>,
    root: PathBuf,
    sessions: Mutex<HashMap<String, Arc<Lease>>>,
    pub(super) reserved: Arc<AtomicU64>,
    pub cancel: CancellationToken,
    streams: Arc<Semaphore>,
    #[cfg(test)]
    pub initial_peers: Mutex<Vec<std::net::SocketAddr>>,
}
impl TorrentManager {
    pub async fn new(root: PathBuf, cancel: CancellationToken) -> anyhow::Result<Arc<Self>> {
        let owner = super::storage::prepare_root(&root).await?;
        let manager = Arc::new(Self {
            owner: Mutex::new(Some(owner)),
            root,
            sessions: Mutex::new(HashMap::new()),
            reserved: Arc::new(AtomicU64::new(0)),
            cancel,
            streams: Arc::new(Semaphore::new(4)),
            #[cfg(test)]
            initial_peers: Mutex::new(Vec::new()),
        });
        let weak = Arc::downgrade(&manager);
        let cancelled = manager.cancel.clone();
        tokio::spawn(async move {
            loop {
                tokio::select! { _ = cancelled.cancelled() => break, _ = tokio::time::sleep(Duration::from_secs(5)) => {} }
                let Some(manager) = weak.upgrade() else {
                    break;
                };
                let expired: Vec<_> = lock(&manager.sessions)
                    .iter()
                    .filter(|(_, lease)| lease.expired())
                    .map(|(id, _)| id.clone())
                    .collect();
                for id in expired {
                    manager.remove(&id).await;
                }
            }
        });
        Ok(manager)
    }
    pub fn create(
        self: &Arc<Self>,
        source: String,
        selected: Option<usize>,
    ) -> Result<View, &'static str> {
        super::source::validate(&source)?;
        self.create_source(Source::Url(source), selected)
    }
    pub fn create_metainfo(
        self: &Arc<Self>,
        bytes: Vec<u8>,
        selected: Option<usize>,
    ) -> Result<View, &'static str> {
        super::source::validate_metainfo(&bytes)?;
        self.create_source(Source::Metainfo(bytes), selected)
    }
    fn create_source(
        self: &Arc<Self>,
        source: Source,
        selected: Option<usize>,
    ) -> Result<View, &'static str> {
        if self.cancel.is_cancelled() {
            return Err("service_stopped");
        }
        let id = uuid::Uuid::new_v4().simple().to_string();
        let (select, _) = watch::channel(selected);
        let (done, _) = watch::channel(false);
        let view = View {
            id: id.clone(),
            state: "metadata",
            files: vec![],
            selected: None,
            stream_path: None,
            downloaded: None,
            total: None,
            error: None,
        };
        let lease = Arc::new(Lease {
            data: Mutex::new(LeaseData {
                view: view.clone(),
                handle: None,
            }),
            cancel: self.cancel.child_token(),
            select,
            touched: Mutex::new(Instant::now()),
            created: Instant::now(),
            done,
        });
        {
            let mut sessions = lock(&self.sessions);
            if self.cancel.is_cancelled() {
                return Err("service_stopped");
            }
            if sessions.len() >= MAX_SESSIONS {
                return Err("session_limit");
            }
            sessions.insert(id, lease.clone());
        }
        let manager = self.clone();
        tokio::spawn(async move {
            manager.run(lease.clone(), source).await;
            lease.done.send_replace(true);
        });
        Ok(view)
    }
    pub fn get(&self, id: &str) -> Option<Arc<Lease>> {
        lock(&self.sessions).get(id).cloned()
    }
    pub async fn remove(&self, id: &str) -> bool {
        let lease = self.get(id);
        if let Some(lease) = lease {
            if !lease.stop().await {
                return false;
            }
            let mut sessions = lock(&self.sessions);
            if sessions
                .get(id)
                .is_some_and(|current| Arc::ptr_eq(current, &lease))
            {
                sessions.remove(id);
            }
            true
        } else {
            false
        }
    }
    pub async fn shutdown(&self) {
        self.cancel.cancel();
        let leases: Vec<_> = lock(&self.sessions)
            .drain()
            .map(|(_, lease)| lease)
            .collect();
        futures_util::future::join_all(leases.iter().map(|lease| lease.stop())).await;
        // Router clones may outlive graceful HTTP shutdown; only surviving
        // storage workers need to retain the exclusive disk ownership now.
        lock(&self.owner).take();
    }
    async fn run(self: Arc<Self>, lease: Arc<Lease>, source: Source) {
        let token = lease.cancel.clone();
        let options = SessionOptions {
            cancellation_token: Some(token.clone()),
            persistence: None,
            dht: if cfg!(test) {
                None
            } else {
                Some(librqbit::DhtSessionConfig {
                    persistence: None,
                    ..Default::default()
                })
            },
            disable_trackers: cfg!(test),
            listen: None,
            disable_local_service_discovery: true,
            peer_limit: Some(16),
            concurrent_init_limit: Some(1),
            runtime_worker_threads: Some(2),
            ..Default::default()
        };
        // No incoming TCP listener, UPnP or service discovery is enabled.
        let engine = tokio::select! {
            _ = token.cancelled() => return,
            result = Session::new_with_opts(self.root.clone(), options) => match result { Ok(v) => v, Err(_) => { lease.fail("engine_unavailable"); return; } }
        };
        let result = tokio::select! { _ = token.cancelled() => Err("session_stopped"), result = self.prepare(&lease, &engine, source) => result };
        if let Err(code) = result {
            if !token.is_cancelled() {
                lease.fail(code);
            }
        } else {
            token.cancelled().await;
        }
        token.cancel();
        // Storage checks the same token under its I/O lock. Even a library task
        // finishing after stop cannot publish more bytes into a retired lease.
        engine.stop().await;
        lock(&lease.data).handle = None;
    }
    async fn prepare(
        &self,
        lease: &Arc<Lease>,
        engine: &Arc<Session>,
        source: Source,
    ) -> Result<(), &'static str> {
        let list = async {
            let add = match source {
                Source::Metainfo(bytes) => AddTorrent::from_bytes(bytes),
                Source::Url(source) if source.starts_with("magnet:") => {
                    AddTorrent::from_url(source)
                }
                Source::Url(source) => {
                    let bytes = super::source::fetch(&source).await?;
                    super::source::validate_metainfo(&bytes)?;
                    AddTorrent::from_bytes(bytes)
                }
            };
            #[allow(unused_mut)]
            let mut options = AddTorrentOptions {
                list_only: true,
                peer_limit: Some(16),
                ..Default::default()
            };
            #[cfg(test)]
            {
                options.initial_peers = Some(lock(&self.initial_peers).clone());
            }
            match engine
                .add_torrent(add, Some(options))
                .await
                .map_err(|_| "metadata_failed")?
            {
                AddTorrentResponse::ListOnly(list) => Ok(list),
                _ => Err("metadata_failed"),
            }
        };
        let list = tokio::time::timeout(Duration::from_secs(45), list)
            .await
            .map_err(|_| "metadata_timeout")??;
        if list.torrent_bytes.len() > METADATA_LIMIT {
            return Err("metadata_limit");
        }
        super::source::validate_metainfo(&list.torrent_bytes)?;
        let mut files = Vec::new();
        let mut total = 0u64;
        for (index, file) in list.info.iter_file_details().enumerate() {
            if index >= MAX_FILES {
                return Err("file_limit");
            }
            let name = file
                .filename
                .to_pathbuf()
                .to_string_lossy()
                .replace('\\', "/");
            if name.len() > 1024 || name.chars().any(char::is_control) {
                return Err("invalid_metadata");
            }
            total = total.checked_add(file.len).ok_or("metadata_limit")?;
            files.push(MediaFile {
                index,
                name,
                length: file.len,
            });
        }
        if files.is_empty() || total == 0 {
            return Err("no_files");
        }
        {
            let mut data = lock(&lease.data);
            data.view.files = files.clone();
            data.view.state = "select";
        }
        let mut receiver = lease.select.subscribe();
        let index = loop {
            if let Some(index) = *receiver.borrow_and_update() {
                break index;
            }
            receiver.changed().await.map_err(|_| "session_stopped")?;
        };
        let file = files
            .get(index)
            .filter(|f| f.length > 0)
            .ok_or("invalid_file")?;
        let piece = u64::from(list.info.lengths().default_piece_length());
        if piece == 0 || piece > 16 * 1024 * 1024 {
            return Err("metadata_limit");
        }
        let offset = files[..index]
            .iter()
            .try_fold(0u64, |a, f| a.checked_add(f.length))
            .ok_or("metadata_limit")?;
        let start = offset / piece * piece;
        let end = (offset + file.length)
            .div_ceil(piece)
            .checked_mul(piece)
            .ok_or("metadata_limit")?
            .min(total);
        let reservation = Reservation::new(self.reserved.clone(), end - start)?;
        let path = self
            .root
            .join(format!("lease-{}.bin", lock(&lease.data).view.id));
        let store = Arc::new(WindowInner::new(
            path,
            reservation,
            lease.cancel.clone(),
            start,
            end,
            &files,
            Some(lock(&self.owner).clone().ok_or("session_stopped")?),
        )?);
        {
            let mut data = lock(&lease.data);
            data.view.selected = Some(index);
            data.view.total = Some(file.length);
            data.view.state = "preparing";
        }
        let mut options = AddTorrentOptions {
            only_files: Some(vec![index]),
            storage_factory: Some(WindowFactory(store).boxed()),
            peer_limit: Some(16),
            overwrite: false,
            ..Default::default()
        };
        options.initial_peers = Some(list.seen_peers);
        #[cfg(test)]
        {
            options
                .initial_peers
                .as_mut()
                .unwrap()
                .extend(lock(&self.initial_peers).iter().copied());
        }
        let handle = engine
            .add_torrent(
                AddTorrent::TorrentFileBytes(list.torrent_bytes),
                Some(options),
            )
            .await
            .map_err(|_| "torrent_failed")?
            .into_handle()
            .ok_or("torrent_failed")?;
        tokio::time::timeout(Duration::from_secs(30), handle.wait_until_initialized())
            .await
            .map_err(|_| "initialization_timeout")?
            .map_err(|_| "torrent_failed")?;
        if lease.cancel.is_cancelled() {
            return Err("session_stopped");
        }
        let mut data = lock(&lease.data);
        data.view.state = "ready";
        data.view.stream_path = Some(format!("sessions/{}/stream", data.view.id));
        data.view.downloaded = Some(0);
        data.handle = Some(handle);
        Ok(())
    }
    pub async fn stream(
        &self,
        lease: Arc<Lease>,
        start: u64,
        length: u64,
    ) -> Result<axum::body::Body, &'static str> {
        let permit = self
            .streams
            .clone()
            .try_acquire_owned()
            .map_err(|_| "stream_limit")?;
        let (handle, selected) = {
            let data = lock(&lease.data);
            (
                data.handle.clone().ok_or("session_busy")?,
                data.view.selected.ok_or("session_busy")?,
            )
        };
        let mut file = tokio::select! { _ = lease.cancel.cancelled() => return Err("session_stopped"), result = tokio::time::timeout(Duration::from_secs(15), handle.stream(selected)) => result.map_err(|_| "stream_timeout")?.map_err(|_| "torrent_failed")? };
        file.seek(std::io::SeekFrom::Start(start))
            .await
            .map_err(|_| "range_failed")?;
        let reader: Box<dyn AsyncRead + Send + Unpin> = Box::new(file);
        let stream = futures_util::stream::unfold(
            (reader, length, lease, permit),
            |(mut reader, left, lease, permit)| async move {
                if left == 0 || lease.cancel.is_cancelled() {
                    return None;
                }
                let mut bytes = vec![0u8; left.min(64 * 1024) as usize];
                let n = tokio::select! {
                    _ = lease.cancel.cancelled() => return None,
                    result = tokio::time::timeout(Duration::from_secs(30), reader.read(&mut bytes)) => match result { Ok(Ok(0)) => return None, Ok(Ok(n)) => n, _ => return Some((Err(std::io::Error::new(std::io::ErrorKind::TimedOut, "Torrent stream unavailable")), (reader, 0, lease, permit))) }
                };
                bytes.truncate(n);
                *lock(&lease.touched) = Instant::now();
                Some((
                    Ok(Bytes::from(bytes)),
                    (reader, left - n as u64, lease, permit),
                ))
            },
        );
        Ok(axum::body::Body::from_stream(stream))
    }
}
