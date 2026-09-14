mod debug_api;
mod vportal_api;

use anyhow::{bail, Context};
use axum::{
    body::Bytes,
    extract::{Path, Query},
    http::{HeaderMap, HeaderValue, StatusCode},
    response::{Html, IntoResponse},
    routing::{any, get, post},
    Json, Router,
};
use chrono::Utc;
use clap::Parser;
use once_cell::sync::Lazy;
use rustls::pki_types::{CertificateDer, PrivateKeyDer};
use rustls::ServerConfig;
use rustls_pemfile::certs as pemfile_certs;
use rustls_pemfile::pkcs8_private_keys;
use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::BufReader;
use std::sync::Arc;
use std::time::SystemTime;
use tokio::net::TcpListener;
use tokio::sync::RwLock;
use tokio::task::JoinSet;
use tokio_rustls::TlsAcceptor;
use tower::Service;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::ServeDir;

use ottplay_core::xmltv::XmltvCache;

static EPG_CACHE: Lazy<Arc<RwLock<XmltvCache>>> =
    Lazy::new(|| Arc::new(RwLock::new(XmltvCache::default())));

static EPG_TO_XMLTV: Lazy<Arc<RwLock<HashMap<String, String>>>> =
    Lazy::new(|| Arc::new(RwLock::new(HashMap::new())));
static TIME_SHIFT_BY_EPG: Lazy<Arc<RwLock<HashMap<String, i64>>>> =
    Lazy::new(|| Arc::new(RwLock::new(HashMap::new())));

static TMDB_KEY: Lazy<Option<String>> = Lazy::new(ottplay_core::tmdb::api_key_from_env);

fn epg_urls() -> Vec<String> {
    // Match archive/server.py: default EPG when EPG_URLS unset/empty.
    const DEFAULT_EPG: &str = "http://epg.it999.ru/epg2.xml.gz";
    let urls: Vec<String> = std::env::var("EPG_URLS")
        .unwrap_or_default()
        .split(';')
        .filter_map(|s| {
            let s = s.trim();
            if s.is_empty() {
                None
            } else {
                Some(s.to_string())
            }
        })
        .collect();
    if urls.is_empty() {
        vec![DEFAULT_EPG.to_string()]
    } else {
        urls
    }
}

#[derive(Parser)]
struct Cli {
    #[arg(long, default_value = "0.0.0.0")]
    host: String,
    /// HTTP listen ports. Repeat --port; defaults to 8080 only when omitted.
    #[arg(long, action = clap::ArgAction::Append, default_value = "8080")]
    port: Vec<u16>,
    #[arg(long, requires = "key")]
    cert: Option<String>,
    #[arg(long, requires = "cert")]
    key: Option<String>,
    /// HTTPS listen port(s). Repeatable: `--https-port 8443 --https-port 8444`.
    /// When `--cert`/`--key` are set and no ports are given, defaults to `[8443]`.
    #[arg(long, action = clap::ArgAction::Append, requires_all = ["cert", "key"])]
    https_port: Vec<u16>,
}

impl Cli {
    fn listen_ports(&self) -> anyhow::Result<(Vec<u16>, Vec<u16>)> {
        let https = if self.cert.is_some() && self.https_port.is_empty() {
            vec![8443]
        } else {
            self.https_port.clone()
        };
        let mut used = HashSet::new();
        for (scheme, ports) in [("HTTP", &self.port), ("HTTPS", &https)] {
            for port in ports {
                if !used.insert(*port) {
                    bail!("duplicate or conflicting listen port {port} ({scheme})");
                }
            }
        }
        Ok((self.port.clone(), https))
    }
}

struct BoundListeners {
    http: Vec<TcpListener>,
    https: Vec<TcpListener>,
}

async fn bind_listeners(host: &str, http: &[u16], https: &[u16]) -> anyhow::Result<BoundListeners> {
    let mut listeners = BoundListeners {
        http: Vec::new(),
        https: Vec::new(),
    };
    // Bind everything before starting a task. A later bind failure drops all
    // earlier sockets instead of leaving a partially available service.
    for (scheme, ports, sockets) in [
        ("HTTP", http, &mut listeners.http),
        ("HTTPS", https, &mut listeners.https),
    ] {
        for port in ports {
            sockets.push(
                TcpListener::bind((host, *port))
                    .await
                    .with_context(|| format!("cannot bind {scheme} {host}:{port}"))?,
            );
        }
    }
    Ok(listeners)
}

async fn supervise_listeners(mut tasks: JoinSet<anyhow::Result<()>>) -> anyhow::Result<()> {
    let failure = match tasks.join_next().await {
        Some(Ok(Err(error))) => error,
        Some(Err(error)) => anyhow::Error::new(error).context("listener task failed"),
        Some(Ok(Ok(()))) => anyhow::anyhow!("listener stopped unexpectedly"),
        None => anyhow::anyhow!("no listeners configured"),
    };
    tasks.abort_all();
    while tasks.join_next().await.is_some() {}
    Err(failure)
}

async fn serve_tls(
    listener: TcpListener,
    app: Router,
    config: Arc<ServerConfig>,
) -> anyhow::Result<()> {
    let acceptor = TlsAcceptor::from(config);
    loop {
        let (stream, _) = match listener.accept().await {
            Ok(connection) => connection,
            Err(error) => {
                tracing::warn!("TLS accept error: {error}");
                continue;
            }
        };
        let acceptor = acceptor.clone();
        let app = app.clone();
        tokio::spawn(async move {
            let tls = match acceptor.accept(stream).await {
                Ok(stream) => stream,
                Err(error) => {
                    // A client's rejected handshake does not stop other listeners.
                    tracing::warn!("TLS handshake failed: {error}");
                    return;
                }
            };
            let io = hyper_util::rt::TokioIo::new(tls);
            if let Err(error) = hyper::server::conn::http1::Builder::new()
                .serve_connection(
                    io,
                    hyper::service::service_fn(move |req| {
                        let app = app.clone();
                        app.clone().call(req)
                    }),
                )
                .await
            {
                tracing::warn!("TLS serve connection error: {error}");
            }
        });
    }
}

async fn serve_listeners(
    listeners: BoundListeners,
    app: Router,
    tls_config: Option<Arc<ServerConfig>>,
) -> anyhow::Result<()> {
    if !listeners.https.is_empty() && tls_config.is_none() {
        bail!("HTTPS listeners require a certificate and key");
    }
    let mut tasks = JoinSet::new();
    for listener in listeners.http {
        let address = listener.local_addr()?;
        println!("ottplay-server: http://{address}");
        let app = app.clone();
        tasks.spawn(async move {
            axum::serve(listener, app)
                .await
                .with_context(|| format!("HTTP listener {address} failed"))
        });
    }
    for listener in listeners.https {
        let address = listener.local_addr()?;
        println!("ottplay-server: https://{address}");
        let app = app.clone();
        let config = tls_config.clone().context("missing TLS configuration")?;
        tasks.spawn(async move {
            serve_tls(listener, app, config)
                .await
                .with_context(|| format!("HTTPS listener {address} failed"))
        });
    }
    supervise_listeners(tasks).await
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    let (http_ports, https_ports) = cli.listen_ports()?;
    // rustls 0.23: both aws-lc-rs and ring end up linked (reqwest + tokio-rustls feature
    // unification). Install an explicit process default before ServerConfig::builder(),
    // otherwise HTTPS listen panics with "no process-level CryptoProvider available".
    rustls::crypto::aws_lc_rs::default_provider()
        .install_default()
        .expect("failed to install rustls CryptoProvider (aws-lc-rs)");

    let tls_config = match (&cli.cert, &cli.key) {
        (Some(cert), Some(key)) => Some(build_tls_config(cert, key)?),
        _ => None,
    };
    let listeners = bind_listeners(&cli.host, &http_ports, &https_ports).await?;
    // HTTP startup must not wait for external EPG.
    spawn_epg_refresh(epg_urls());
    Lazy::force(&TMDB_KEY);

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/", get(root))
        .route("/index.html", get(root))
        .route("/favicon.ico", get(favicon_handler))
        .route("/health", get(health))
        .route("/epg/:hash", get(epg_handler))
        .route("/tmdb/*path", get(tmdb_handler))
        .route("/logo/:id", get(logo_handler))
        .route("/version/*path", get(version_handler))
        .route("/m3u/match-channels", post(match_channels_handler))
        .route("/m3u/match-logos", post(match_logos_handler))
        .route("/m3u/cp.php", post(cp_proxy_handler))
        // Phase 2.5: Feedback/analytics endpoints
        .route("/feedback", any(feedback_handler_no_path))
        .route("/feedback/*path", any(feedback_handler))
        .route("/api", any(feedback_handler_no_path))
        .route("/api/*path", any(feedback_handler))
        .route("/report_feedb", post(feedback_handler_no_path))
        // Command queues are explicitly configured authenticated local sidecars.
        .merge(disabled_command_routes())
        .merge(debug_api::routes())
        .merge(vportal_api::routes())
        .merge(device_entry_routes())
        .nest_service("/dist", ServeDir::new("dist"))
        .nest_service("/stbPlayer", ServeDir::new("stbPlayer"))
        .nest_service("/stb", ServeDir::new("stb"))
        .nest_service("/fonts", ServeDir::new("fonts"))
        .nest_service("/js", ServeDir::new("js"))
        .nest_service("/prov", ServeDir::new("prov"))
        // Operator-local overrides (gitignored); 404 if directory missing
        .nest_service("/local", ServeDir::new("local"))
        .layer(cors);

    serve_listeners(listeners, app, tls_config).await
}

fn spawn_epg_refresh(urls: Vec<String>) {
    if urls.is_empty() {
        return;
    }
    let cache = EPG_CACHE.clone();
    let _refresh = spawn_epg_refresh_loop(
        move || {
            let urls = urls.clone();
            let cache = cache.clone();
            async move {
                println!("[EPG] Fetching {} source(s)...", urls.len());
                match ottplay_core::fetch_xmltv(&urls).await {
                    Ok(fresh) => {
                        let channels = fresh.channels.len();
                        let programmes: usize = fresh.programs.values().map(Vec::len).sum();
                        *cache.write().await = fresh;
                        println!("[EPG] Loaded {channels} channels, {programmes} programmes");
                    }
                    Err(error) => eprintln!("[EPG] Fetch error: {error}"),
                }
            }
        },
        std::time::Duration::from_secs(2 * 3600),
    );
}

fn spawn_epg_refresh_loop<F, Work>(
    mut refresh: F,
    interval: std::time::Duration,
) -> tokio::task::JoinHandle<()>
where
    F: FnMut() -> Work + Send + 'static,
    Work: std::future::Future<Output = ()> + Send + 'static,
{
    tokio::spawn(async move {
        loop {
            refresh().await;
            // Unlike interval().tick(), the first sleep is not immediate:
            // initial fetch and periodic refresh never overlap or run twice.
            tokio::time::sleep(interval).await;
        }
    })
}

fn build_tls_config(cert_path: &str, key_path: &str) -> anyhow::Result<Arc<ServerConfig>> {
    // Load certificate
    let mut cert_file = BufReader::new(File::open(cert_path).context("cannot open certificate")?);
    let certs: Vec<CertificateDer> = pemfile_certs(&mut cert_file)
        .collect::<Result<Vec<_>, _>>()
        .context("invalid certificate")?;

    // Load private key
    let mut key_file = BufReader::new(File::open(key_path).context("cannot open private key")?);
    let keys: Vec<PrivateKeyDer> = pkcs8_private_keys(&mut key_file)
        .map(|k| k.map(PrivateKeyDer::from))
        .collect::<Result<Vec<_>, _>>()
        .context("invalid private key")?;
    let key = keys
        .into_iter()
        .next()
        .context("no PKCS#8 private key found")?;

    let mut config = ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(certs, key)
        .context("bad certificate/key")?;

    // Configure ALPN for HTTP/1.1
    config.alpn_protocols = vec![b"http/1.1".to_vec()];

    Ok(Arc::new(config))
}

fn device_entry_routes() -> Router {
    // Device paths select an adapter in index.html; they are not filesystem paths.
    Router::new()
        .route("/f", get(root))
        .route("/f/", get(root))
        .route("/f/*device", get(root))
}

#[cfg(test)]
mod listener_tests {
    use super::*;

    #[test]
    fn repeated_http_ports_replace_the_default_and_https_remains_explicit() {
        let defaults = Cli::try_parse_from(["ottplay-server"]).unwrap();
        assert_eq!(defaults.host, "0.0.0.0");
        assert_eq!(defaults.listen_ports().unwrap(), (vec![8080], vec![]));

        let http = Cli::try_parse_from([
            "ottplay-server",
            "--host",
            "127.0.0.1",
            "--port",
            "8443",
            "--port",
            "8444",
            "--port",
            "8445",
            "--port",
            "8446",
        ])
        .unwrap();
        assert_eq!(
            http.listen_ports().unwrap(),
            (vec![8443, 8444, 8445, 8446], vec![])
        );
        let tls = Cli::try_parse_from(["ottplay-server", "--cert", "cert.pem", "--key", "key.pem"])
            .unwrap();
        assert_eq!(tls.listen_ports().unwrap(), (vec![8080], vec![8443]));
        let tls = Cli::try_parse_from([
            "ottplay-server",
            "--port",
            "8090",
            "--cert",
            "cert.pem",
            "--key",
            "key.pem",
            "--https-port",
            "9443",
            "--https-port",
            "9444",
        ])
        .unwrap();
        assert_eq!(tls.listen_ports().unwrap(), (vec![8090], vec![9443, 9444]));
    }

    #[test]
    fn ambiguous_ports_and_incomplete_tls_options_are_rejected() {
        for args in [
            vec!["ottplay-server", "--port", "8443", "--port", "8443"],
            vec![
                "ottplay-server",
                "--port",
                "8443",
                "--cert",
                "cert.pem",
                "--key",
                "key.pem",
            ],
            vec![
                "ottplay-server",
                "--cert",
                "cert.pem",
                "--key",
                "key.pem",
                "--https-port",
                "9443",
                "--https-port",
                "9443",
            ],
        ] {
            let cli = Cli::try_parse_from(args).unwrap();
            assert!(cli
                .listen_ports()
                .unwrap_err()
                .to_string()
                .contains("duplicate or conflicting"));
        }
        for args in [
            vec!["ottplay-server", "--cert", "cert.pem"],
            vec!["ottplay-server", "--key", "key.pem"],
            vec!["ottplay-server", "--https-port", "8443"],
            vec!["ottplay-server", "--port", "65536"],
        ] {
            assert!(Cli::try_parse_from(args).is_err());
        }
    }

    #[tokio::test]
    async fn four_http_listeners_serve_the_same_router_and_stop_together() {
        let listeners = bind_listeners("127.0.0.1", &[0, 0, 0, 0], &[])
            .await
            .unwrap();
        let addresses: Vec<_> = listeners
            .http
            .iter()
            .map(|s| s.local_addr().unwrap())
            .collect();
        assert_eq!(addresses.iter().collect::<HashSet<_>>().len(), 4);
        let app = Router::new().route("/health", get(health));
        let task = tokio::spawn(serve_listeners(listeners, app, None));
        let client = reqwest::Client::builder()
            .no_proxy()
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .unwrap();
        for address in &addresses {
            let response = client
                .get(format!("http://{address}/health"))
                .send()
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK);
            assert_eq!(response.text().await.unwrap(), "OK");
        }
        task.abort();
        assert!(task.await.unwrap_err().is_cancelled());
        tokio::task::yield_now().await;
        for address in addresses {
            let rebound = TcpListener::bind(address).await.unwrap();
            drop(rebound);
        }
    }

    #[tokio::test]
    async fn a_later_bind_failure_releases_all_earlier_http_and_tls_sockets() {
        let occupied = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let occupied_port = occupied.local_addr().unwrap().port();
        let available = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let available_port = available.local_addr().unwrap().port();
        drop(available);
        for (http, https) in [
            (vec![available_port, occupied_port], vec![]),
            (vec![available_port], vec![occupied_port]),
            (vec![], vec![available_port, occupied_port]),
        ] {
            let error = match bind_listeners("127.0.0.1", &http, &https).await {
                Ok(_) => panic!("an occupied port must prevent startup"),
                Err(error) => error,
            };
            assert!(error
                .to_string()
                .contains(&format!("127.0.0.1:{occupied_port}")));
            let rebound = TcpListener::bind(("127.0.0.1", available_port))
                .await
                .unwrap();
            drop(rebound);
        }
    }

    #[tokio::test]
    async fn a_failed_listener_propagates_its_error_and_cancels_its_peers() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let mut tasks = JoinSet::new();
        tasks.spawn(async move {
            let _listener = listener;
            std::future::pending::<anyhow::Result<()>>().await
        });
        tasks.spawn(async { anyhow::bail!("synthetic listener failure") });
        assert_eq!(
            supervise_listeners(tasks).await.unwrap_err().to_string(),
            "synthetic listener failure"
        );
        let rebound = TcpListener::bind(address).await.unwrap();
        drop(rebound);

        let mut tasks = JoinSet::new();
        tasks.spawn(async { Ok(()) });
        assert!(supervise_listeners(tasks)
            .await
            .unwrap_err()
            .to_string()
            .contains("stopped unexpectedly"));

        let mut tasks: JoinSet<anyhow::Result<()>> = JoinSet::new();
        tasks.spawn(async { panic!("synthetic listener panic") });
        assert!(supervise_listeners(tasks)
            .await
            .unwrap_err()
            .to_string()
            .contains("listener task failed"));
    }
}

#[cfg(test)]
mod epg_startup_tests {
    use super::*;
    use axum::body::{to_bytes, Body};
    use axum::http::Request;

    #[tokio::test]
    async fn http_startup_does_not_wait_for_initial_epg_or_duplicate_its_refresh() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use tokio::sync::Notify;
        let started = Arc::new(Notify::new());
        let finish_fetch = Arc::new(Notify::new());
        let finished = Arc::new(Notify::new());
        let requests = Arc::new(AtomicUsize::new(0));
        let task = spawn_epg_refresh_loop(
            {
                let started = started.clone();
                let finish_fetch = finish_fetch.clone();
                let finished = finished.clone();
                let requests = requests.clone();
                move || {
                    let started = started.clone();
                    let finish_fetch = finish_fetch.clone();
                    let finished = finished.clone();
                    let requests = requests.clone();
                    async move {
                        requests.fetch_add(1, Ordering::SeqCst);
                        started.notify_one();
                        // Represents an offline EPG request with no response yet.
                        finish_fetch.notified().await;
                        finished.notify_one();
                    }
                }
            },
            std::time::Duration::from_secs(2 * 3600),
        );
        let deadline = std::time::Duration::from_secs(5);
        tokio::time::timeout(deadline, started.notified())
            .await
            .unwrap();
        let mut app = Router::new().route("/health", get(health));
        let response = tokio::time::timeout(
            deadline,
            app.call(
                Request::builder()
                    .uri("/health")
                    .body(Body::empty())
                    .unwrap(),
            ),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            to_bytes(response.into_body(), 1024).await.unwrap().as_ref(),
            b"OK"
        );
        assert_eq!(requests.load(Ordering::SeqCst), 1);
        finish_fetch.notify_one();
        tokio::time::timeout(deadline, finished.notified())
            .await
            .unwrap();
        tokio::task::yield_now().await;
        assert_eq!(
            requests.load(Ordering::SeqCst),
            1,
            "Completing the initial fetch must not trigger an immediate periodic fetch"
        );
        task.abort();
    }
}

async fn root() -> impl IntoResponse {
    // Prefer dist/index.html: vite substitutes __OTTP_VERSION__ there.
    // Source index.html keeps the placeholder for local/dev editing.
    for candidate in ["dist/index.html", "index.html"] {
        if let Ok(html) = std::fs::read_to_string(candidate) {
            return Html(html);
        }
    }
    Html(PLACEHOLDER_HTML.to_string())
}

async fn favicon_handler() -> impl IntoResponse {
    match std::fs::read("favicon.ico") {
        Ok(bytes) => (
            StatusCode::OK,
            [
                ("content-type", "image/x-icon"),
                ("cache-control", "max-age=86400"),
            ],
            bytes,
        )
            .into_response(),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn health() -> &'static str {
    "OK"
}

async fn tmdb_handler(
    Path(path): Path<String>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> Result<(StatusCode, HeaderMap, Vec<u8>), StatusCode> {
    let api_key = ottplay_core::tmdb::require_api_key().map_err(|_| {
        tracing::warn!("[TMDB] TMDB_API_KEY not set");
        StatusCode::SERVICE_UNAVAILABLE
    })?;
    let query = params
        .iter()
        .map(|(k, v)| format!("{}={}", k, urlencoding::encode(v)))
        .collect::<Vec<_>>()
        .join("&");
    match ottplay_core::tmdb::proxy(&path, &query, &api_key).await {
        Ok((status, mut headers, body)) => {
            headers.insert("access-control-allow-origin", HeaderValue::from_static("*"));
            Ok((
                StatusCode::from_u16(status).unwrap_or(StatusCode::BAD_GATEWAY),
                headers,
                body,
            ))
        }
        Err(e) => {
            tracing::warn!("[TMDB] FAIL: {e}");
            Err(StatusCode::BAD_GATEWAY)
        }
    }
}

async fn epg_handler(
    Path(hash): Path<String>,
    Query(params): Query<EpgParams>,
) -> Json<serde_json::Value> {
    // Client requests /epg/{hash}.json — strip optional .json suffix.
    let hash = hash.strip_suffix(".json").unwrap_or(&hash).to_string();
    let cache = EPG_CACHE.read().await;
    let map = EPG_TO_XMLTV.read().await;
    let shifts = TIME_SHIFT_BY_EPG.read().await;
    let channel_id = params
        .ch
        .as_ref()
        .and_then(|ch| ottplay_core::match_channel(ch, &cache.channels).map(|(id, _score)| id))
        .or_else(|| map.get(&hash).cloned())
        .unwrap_or_else(|| hash.clone());
    let time_shift: i64 = params
        .ts
        .map(|ts| ts as i64)
        .or_else(|| shifts.get(&hash).copied())
        .unwrap_or(0);
    let archive_hours: i64 = params.hours.map(|h| h as i64).unwrap_or(0);
    let result =
        ottplay_core::get_epg_slice(&cache, &hash, &channel_id, time_shift, archive_hours).await;
    Json(result)
}

#[derive(Debug, Deserialize)]
struct EpgParams {
    #[serde(rename = "ch")]
    ch: Option<String>,
    ts: Option<i32>,
    /// Configured catchup/history hours (M3U rechours). Not timezone.
    hours: Option<i32>,
}

async fn match_channels_handler(body: Bytes) -> impl IntoResponse {
    // Legacy FOSS posts text (`{}\n\t\n...`), not JSON. Keep JSON array as a
    // fallback for native/app clients that already speak the typed API.
    // Matching is CPU-heavy — run off the async runtime so /epg and UI stay responsive.
    let body_owned = String::from_utf8_lossy(&body).into_owned();
    let is_text = body_owned.contains("\n\t\n");
    let channels_map = EPG_CACHE.read().await.channels.clone();

    if is_text {
        let result = tokio::task::spawn_blocking(move || {
            let mut epg_to_xmltv = std::collections::HashMap::new();
            let mut time_shift_by_epg = std::collections::HashMap::new();
            let text = ottplay_core::m3u::match_channels_text(
                &body_owned,
                &channels_map,
                &mut epg_to_xmltv,
                &mut time_shift_by_epg,
            );
            (text, epg_to_xmltv, time_shift_by_epg)
        })
        .await;
        return match result {
            Ok((text, epg_map, shift_map)) => {
                {
                    let mut m = EPG_TO_XMLTV.write().await;
                    m.extend(epg_map);
                    let mut s = TIME_SHIFT_BY_EPG.write().await;
                    s.extend(shift_map);
                }
                tracing::info!(
                    "[EPG] match-channels text: {} bytes in → {} bytes out",
                    body.len(),
                    text.len()
                );
                (
                    [(
                        axum::http::header::CONTENT_TYPE,
                        "text/plain; charset=utf-8",
                    )],
                    text,
                )
                    .into_response()
            }
            Err(e) => {
                tracing::error!("[EPG] match-channels join error: {e}");
                StatusCode::INTERNAL_SERVER_ERROR.into_response()
            }
        };
    }

    let parsed: Result<Vec<ottplay_core::m3u::M3uChannel>, _> = serde_json::from_slice(&body);
    match parsed {
        Ok(channels) => {
            let result = tokio::task::spawn_blocking(move || {
                let mut epg_to_xmltv = std::collections::HashMap::new();
                let mut time_shift_by_epg = std::collections::HashMap::new();
                let results = ottplay_core::m3u::match_channels(
                    channels,
                    &channels_map,
                    &mut epg_to_xmltv,
                    &mut time_shift_by_epg,
                );
                (results, epg_to_xmltv, time_shift_by_epg)
            })
            .await;
            match result {
                Ok((results, epg_map, shift_map)) => {
                    {
                        let mut m = EPG_TO_XMLTV.write().await;
                        m.extend(epg_map);
                        let mut s = TIME_SHIFT_BY_EPG.write().await;
                        s.extend(shift_map);
                    }
                    Json(serde_json::to_value(results).unwrap()).into_response()
                }
                Err(e) => {
                    tracing::error!("[EPG] match-channels join error: {e}");
                    StatusCode::INTERNAL_SERVER_ERROR.into_response()
                }
            }
        }
        Err(_) => StatusCode::BAD_REQUEST.into_response(),
    }
}

async fn match_logos_handler(body: Bytes) -> impl IntoResponse {
    let body_owned = String::from_utf8_lossy(&body).into_owned();
    let is_text = body_owned.contains("\n\t\n");
    let channels_map = EPG_CACHE.read().await.channels.clone();

    if is_text {
        let result = tokio::task::spawn_blocking(move || {
            ottplay_core::m3u::match_logos_text(&body_owned, &channels_map)
        })
        .await;
        return match result {
            Ok(text) => {
                tracing::info!(
                    "[EPG] match-logos text: {} bytes in → {} bytes out",
                    body.len(),
                    text.len()
                );
                (
                    [(
                        axum::http::header::CONTENT_TYPE,
                        "text/plain; charset=utf-8",
                    )],
                    text,
                )
                    .into_response()
            }
            Err(e) => {
                tracing::error!("[EPG] match-logos join error: {e}");
                StatusCode::INTERNAL_SERVER_ERROR.into_response()
            }
        };
    }

    match serde_json::from_slice::<Vec<ottplay_core::m3u::LogoChannel>>(&body) {
        Ok(channels) => {
            let result = tokio::task::spawn_blocking(move || {
                ottplay_core::m3u::match_logos(channels, &channels_map)
            })
            .await;
            match result {
                Ok(results) => Json(serde_json::to_value(results).unwrap()).into_response(),
                Err(e) => {
                    tracing::error!("[EPG] match-logos join error: {e}");
                    StatusCode::INTERNAL_SERVER_ERROR.into_response()
                }
            }
        }
        Err(_) => StatusCode::BAD_REQUEST.into_response(),
    }
}

fn form_decode_value(raw: &str) -> String {
    let plus_as_space = raw.replace('+', "%20");
    urlencoding::decode(&plus_as_space)
        .map(|c| c.into_owned())
        .unwrap_or_else(|_| raw.replace('+', " "))
}

/// Accept JSON `{url, ua?}` or `application/x-www-form-urlencoded` (`url=` / `ua=`).
/// Providers POST jQuery form bodies (`{url: "@"+cpurl}`), not JSON.
fn parse_cp_proxy_params(body: &[u8]) -> Option<ottplay_core::m3u::ProxyParams> {
    if let Ok(params) = serde_json::from_slice::<ottplay_core::m3u::ProxyParams>(body) {
        if !params.url.is_empty() {
            return Some(params);
        }
    }
    let s = String::from_utf8_lossy(body);
    let mut url = String::new();
    let mut ua = String::new();
    for pair in s.split('&') {
        if pair.is_empty() {
            continue;
        }
        let mut parts = pair.splitn(2, '=');
        let key = parts.next().unwrap_or("");
        let val = parts.next().unwrap_or("");
        match key {
            "url" => url = form_decode_value(val),
            "ua" => ua = form_decode_value(val),
            _ => {}
        }
    }
    if url.is_empty() {
        None
    } else {
        Some(ottplay_core::m3u::ProxyParams { url, ua })
    }
}

async fn cp_proxy_handler(body: Bytes) -> Result<(StatusCode, HeaderMap, Vec<u8>), StatusCode> {
    let params = parse_cp_proxy_params(&body).ok_or(StatusCode::BAD_REQUEST)?;
    match ottplay_core::m3u::proxy_stream(params).await {
        Ok((mut headers, body)) => {
            headers.insert("access-control-allow-origin", HeaderValue::from_static("*"));
            headers.insert(
                "access-control-allow-methods",
                HeaderValue::from_static("GET, POST, OPTIONS"),
            );
            headers.insert(
                "access-control-allow-headers",
                HeaderValue::from_static("*"),
            );
            Ok((StatusCode::OK, headers, body))
        }
        Err(e) => {
            tracing::warn!("[PROXY] FAIL: {e}");
            Err(StatusCode::BAD_GATEWAY)
        }
    }
}

/// /logo/:id?ch=<name> — generate a stable coloured SVG badge per channel id.
async fn logo_handler(
    Path(id): Path<String>,
    Query(params): Query<HashMap<String, String>>,
) -> impl IntoResponse {
    let logo_id = id.split('.').next().unwrap_or("0").to_string();
    let ch_name = params.get("ch").cloned().unwrap_or_default();
    let svg = generate_logo_svg(&logo_id, &ch_name);
    (
        [
            ("content-type", "image/svg+xml"),
            ("cache-control", "max-age=86400"),
        ],
        svg,
    )
}

fn generate_logo_svg(logo_id: &str, ch_name: &str) -> String {
    const COLORS: &[&str] = &[
        "#e74c3c", "#3498db", "#2ecc71", "#f39c12", "#9b59b6", "#1abc9c", "#e67e22", "#34495e",
        "#16a085", "#c0392b", "#2980b9", "#27ae60", "#d35400", "#8e44ad", "#f1c40f",
    ];
    let hash: u32 = logo_id.bytes().fold(5381u32, |acc, b| {
        acc.wrapping_mul(33).wrapping_add(b as u32)
    });
    let color = COLORS[(hash as usize) % COLORS.len()];
    let letter: String = if !ch_name.trim().is_empty() {
        ch_name
            .trim()
            .chars()
            .next()
            .unwrap()
            .to_uppercase()
            .to_string()
    } else {
        let n = (hash as usize) % 26;
        ((b'A' + n as u8) as char).to_string()
    };
    format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="120" height="90" viewBox="0 0 120 90"><rect width="120" height="90" rx="8" fill="{color}"/><text x="60" y="58" text-anchor="middle" font-family="Arial,sans-serif" font-size="36" font-weight="bold" fill="white">{letter}</text></svg>"#
    )
}

/// /version/*path — return JSON with file metadata + md5 hex prefix (Python parity).
async fn version_handler(Path(rel): Path<String>) -> Result<Json<serde_json::Value>, StatusCode> {
    use md5::{Digest, Md5};
    use std::fs;
    let stripped = rel.strip_prefix('/').unwrap_or(&rel);
    // Reject path traversal; only serve real files under cwd.
    if stripped.is_empty() || stripped.contains("..") {
        return Err(StatusCode::NOT_FOUND);
    }
    let filename = stripped.rsplit('/').next().unwrap_or("").to_string();
    let filepath = format!("./{stripped}");
    match fs::metadata(&filepath) {
        Ok(meta) if meta.is_file() => {
            let bytes = fs::read(&filepath).unwrap_or_default();
            let digest = format!("{:x}", Md5::digest(&bytes))
                .chars()
                .take(16)
                .collect::<String>();
            let modified = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);
            Ok(Json(serde_json::json!({
                "file": filename,
                "hash": digest,
                "modified": modified,
                "size": meta.len(),
            })))
        }
        _ => Err(StatusCode::NOT_FOUND),
    }
}

const PLACEHOLDER_HTML: &str = "<!doctype html><html><body><h1>ottplay-server</h1></body></html>";

/// Append feedback line to feedback.log (format: `ts\npath\nbody\n---\n`)
fn append_feedback_log(path: &str, body: &str) {
    use std::io::Write;
    let ts = Utc::now().format("%Y-%m-%d %H:%M:%S");
    let _ = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open("feedback.log")
        .and_then(|mut f| writeln!(f, "{ts} {path}\n{body}\n---"));
}

/// Feedback/analytics handler - handles GET/POST /feedback/*, GET/POST /api/*, POST /report_feedb
async fn feedback_handler(
    Path(path): Path<String>,
    body: Option<axum::body::Bytes>,
) -> impl axum::response::IntoResponse {
    let body_str = body
        .map(|b| String::from_utf8_lossy(&b).into_owned())
        .unwrap_or_default();
    let ts = Utc::now().format("%Y-%m-%d %H:%M:%S");
    tracing::info!("[FEEDBACK] {ts} {path}: {body_str}");
    append_feedback_log(&path, &body_str);
    (
        StatusCode::OK,
        [(axum::http::header::CONTENT_TYPE, "application/json")],
        r#"{"status":"ok"}"#,
    )
}

/// Feedback handler for paths with no tail (e.g. /report_feedb, /feedback, /api)
async fn feedback_handler_no_path(
    body: Option<axum::body::Bytes>,
) -> impl axum::response::IntoResponse {
    feedback_handler(Path("".to_string()), body).await
}

/// Reserve command paths before the generic /api feedback sink. No HTTP method
/// or alias may look like successful command acceptance on the central server.
fn disabled_command_routes() -> Router {
    let mut routes = Router::new();
    for path in [
        "/api/webhook/commands",
        "/api/webhook/health",
        "/webhook/poll",
        "/webhook/notify",
        "/webhook/health",
    ] {
        routes = routes.route(path, any(webhook_stub));
        routes = routes.route(&format!("{path}/"), any(webhook_stub));
    }
    routes
}

/// The central server never provisions or accepts device command credentials.
async fn webhook_stub() -> impl axum::response::IntoResponse {
    (
        StatusCode::FORBIDDEN,
        [(axum::http::header::CONTENT_TYPE, "text/plain; charset=utf-8")],
        "HTTP remote disabled on the central server. Configure the authenticated local_proxy.py separately.",
    )
}

#[cfg(test)]
mod disabled_command_tests {
    use super::*;
    use axum::body::Body;
    use axum::http::Request;

    #[tokio::test]
    async fn central_webhook_aliases_never_accept_commands_or_drain_a_queue() {
        let mut app = Router::new()
            .route("/api/*path", any(feedback_handler))
            .merge(disabled_command_routes());
        for path in [
            "/api/webhook/commands",
            "/api/webhook/health",
            "/webhook/poll",
            "/webhook/notify",
            "/webhook/health",
        ] {
            for suffix in ["", "/", "?device_id=known-id"] {
                for method in ["GET", "POST", "PUT", "DELETE", "OPTIONS"] {
                    let request = Request::builder()
                        .method(method)
                        .uri(format!("{path}{suffix}"))
                        .header("Authorization", "Bearer aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
                        .body(Body::from(r#"{"command":"exit_player"}"#))
                        .unwrap();
                    let response = app.call(request).await.unwrap();
                    assert_eq!(
                        response.status(),
                        StatusCode::FORBIDDEN,
                        "{method} {path}{suffix}"
                    );
                }
            }
        }
    }
}

#[cfg(test)]
mod device_entry_tests {
    use super::*;
    use axum::body::{to_bytes, Body};
    use axum::http::Request;
    use std::path::PathBuf;

    // root() reads the web root from the process working directory. This server
    // test binary has one filesystem test; always restore its directory on panic.
    struct WebRootFixture {
        previous: PathBuf,
        directory: PathBuf,
    }

    impl Drop for WebRootFixture {
        fn drop(&mut self) {
            std::env::set_current_dir(&self.previous).unwrap();
            std::fs::remove_dir_all(&self.directory).unwrap();
        }
    }

    async fn request(app: &mut Router, path: &str) -> (StatusCode, String, Bytes) {
        let response = app
            .call(Request::builder().uri(path).body(Body::empty()).unwrap())
            .await
            .unwrap();
        let status = response.status();
        let content_type = response
            .headers()
            .get("content-type")
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
            .to_string();
        let body = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
        (status, content_type, body)
    }

    #[tokio::test]
    async fn mode_a_device_entries_serve_html_without_exposing_web_root() {
        let previous = std::env::current_dir().unwrap();
        let stamp = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory = std::env::temp_dir().join(format!(
            "ottplay-device-routes-{}-{stamp}",
            std::process::id()
        ));
        std::fs::create_dir_all(directory.join("dist")).unwrap();
        std::fs::create_dir_all(directory.join("stb/lg/webos")).unwrap();
        std::fs::create_dir_all(directory.join("src-rs/server/src")).unwrap();
        std::fs::create_dir_all(directory.join(".git")).unwrap();
        let built_html = "<!doctype html><html><body>built player</body></html>";
        let source_html = "<!doctype html><html><body>source player</body></html>";
        let private_source = "[workspace]\nmembers = [\"private-source\"]\n";
        let adapter = "var adapter = 'lg/webos';";
        std::fs::write(directory.join("dist/index.html"), built_html).unwrap();
        std::fs::write(directory.join("index.html"), source_html).unwrap();
        std::fs::write(directory.join("Cargo.toml"), private_source).unwrap();
        std::fs::write(
            directory.join("src-rs/server/src/main.rs"),
            "private source",
        )
        .unwrap();
        std::fs::write(directory.join(".env"), "PRIVATE=value").unwrap();
        std::fs::write(directory.join(".git/config"), "private git config").unwrap();
        std::fs::write(directory.join("stb/lg/webos/stb.js"), adapter).unwrap();
        std::env::set_current_dir(&directory).unwrap();
        let _fixture = WebRootFixture {
            previous,
            directory,
        };

        // Reproduce both failures in the former production route.
        let mut old = Router::new().nest_service("/f", ServeDir::new("."));
        for path in ["/f/dune/", "/f/lg/webos/"] {
            assert_eq!(request(&mut old, path).await.0, StatusCode::NOT_FOUND);
        }
        let exposed = request(&mut old, "/f/Cargo.toml").await;
        assert_eq!(exposed.0, StatusCode::OK);
        assert_eq!(exposed.2.as_ref(), private_source.as_bytes());

        let mut app = Router::new()
            .merge(device_entry_routes())
            .nest_service("/stb", ServeDir::new("stb"));
        for path in [
            "/f",
            "/f/",
            "/f/dune/",
            "/f/mag/",
            "/f/hisense/",
            "/f/lg/webos/",
            "/f/lg/netcast/",
            "/f/samsung/tizen/",
            "/f/samsung/maple/",
            "/f/Cargo.toml",
            "/f/src-rs/server/src/main.rs",
            "/f/.env",
            "/f/.git/config",
            "/f/stb/lg/webos/stb.js",
        ] {
            let response = request(&mut app, path).await;
            assert_eq!(response.0, StatusCode::OK, "{path}");
            assert!(response.1.starts_with("text/html"), "{path}");
            assert_eq!(response.2.as_ref(), built_html.as_bytes(), "{path}");
        }
        let asset = request(&mut app, "/stb/lg/webos/stb.js").await;
        assert_eq!(asset.0, StatusCode::OK);
        assert_eq!(asset.2.as_ref(), adapter.as_bytes());
        assert_eq!(
            request(&mut app, "/Cargo.toml").await.0,
            StatusCode::NOT_FOUND
        );

        std::fs::remove_file("dist/index.html").unwrap();
        let fallback = request(&mut app, "/f/lg/webos/").await;
        assert_eq!(fallback.0, StatusCode::OK);
        assert_eq!(fallback.2.as_ref(), source_html.as_bytes());
    }
}
