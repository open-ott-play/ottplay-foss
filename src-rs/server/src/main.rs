use axum::{
    body::Bytes,
    extract::{Path, Query},
    http::{HeaderMap, HeaderValue, StatusCode},
    response::{Html, IntoResponse},
    routing::{get, post, any},
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
use std::collections::HashMap;
use std::fs::File;
use std::io::BufReader;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::SystemTime;
use tokio::sync::RwLock;
use tokio::net::TcpListener;
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
    std::env::var("EPG_URLS")
        .unwrap_or_default()
        .split(';')
        .filter_map(|s| {
            let s = s.trim();
            if s.is_empty() { None } else { Some(s.to_string()) }
        })
        .collect()
}

#[derive(Parser)]
struct Cli {
    #[arg(long, default_value = "0.0.0.0")]
    host: String,
    #[arg(long, default_value_t = 8080)]
    port: u16,
    #[arg(long)]
    cert: Option<String>,
    #[arg(long)]
    key: Option<String>,
    #[arg(long)]
    https_port: Option<u16>,
}

#[tokio::main]
async fn main() {
    let urls = epg_urls();
    if !urls.is_empty() {
        println!("[EPG] Fetching {} source(s)...", urls.len());
        match ottplay_core::fetch_xmltv(&urls).await {
            Ok(cache) => {
                let n_ch = cache.channels.len();
                let n_pr: usize = cache.programs.values().map(|v| v.len()).sum();
                println!("[EPG] Loaded {n_ch} channels, {n_pr} programmes");
                *EPG_CACHE.write().await = cache;
            }
            Err(e) => eprintln!("[EPG] Fetch error: {e}"),
        }
        let cache = EPG_CACHE.clone();
        let refresh_urls = urls.clone();
        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(std::time::Duration::from_secs(2 * 3600));
            loop {
                ticker.tick().await;
                tracing::info!("[EPG] Background refresh");
                match ottplay_core::fetch_xmltv(&refresh_urls).await {
                    Ok(fresh) => {
                        *cache.write().await = fresh;
                        tracing::info!("[EPG] Cache refreshed");
                    }
                    Err(e) => tracing::warn!("[EPG] Refresh failed: {e}"),
                }
            }
        });
    } else {
        println!("[EPG] No EPG_URLS set — EPG disabled");
    }

    let cli = Cli::parse();
    Lazy::force(&TMDB_KEY);

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/", get(root))
        .route("/health", get(health))
        .route("/epg/:hash", get(epg_handler))
        .route("/tmdb/*path", get(tmdb_handler))
        .route("/logo/:id", get(logo_handler))
        .route("/version/:path", get(version_handler))
        .route("/m3u/match-channels", post(match_channels_handler))
        .route("/m3u/match-logos", post(match_logos_handler))
        .route("/m3u/cp.php", post(cp_proxy_handler))
        // Phase 2.5: Feedback/analytics endpoints
        .route("/feedback", any(feedback_handler_no_path))
        .route("/feedback/*path", any(feedback_handler))
        .route("/api", any(feedback_handler_no_path))
        .route("/api/*path", any(feedback_handler))
        .route("/report_feedb", post(feedback_handler_no_path))
        // Phase 2.6: Webhook stubs (return 403)
        .route("/webhook/poll", get(webhook_stub))
        .route("/webhook/notify", get(webhook_stub))
        .nest_service("/f", ServeDir::new("."))
        .layer(cors);

    let addr: SocketAddr = ([0, 0, 0, 0], cli.port).into();
    println!("ottplay-server: http://{}:{}", cli.host, cli.port);

    // Phase 2.1: TLS sidecar on https_port (default 8443)
    if let (Some(cert_path), Some(key_path)) = (&cli.cert, &cli.key) {
        let https_port = cli.https_port.unwrap_or(8443);
        let tls_config = build_tls_config(cert_path, key_path);
        let host_str = cli.host.clone();
        let listener = TcpListener::bind((host_str.as_str(), https_port))
            .await
            .expect("cannot bind HTTPS port");
        println!("ottplay-server: https://{}:{}", host_str, https_port);
        let app_clone = app.clone();
        tokio::spawn(async move {
            let acceptor = TlsAcceptor::from(tls_config);
            loop {
                match listener.accept().await {
                    Ok((stream, _)) => {
                        let acceptor = acceptor.clone();
                        let app = app_clone.clone();
                        tokio::spawn(async move {
                            let tls = acceptor.accept(stream).await.expect("tls handshake");
                            let io = hyper_util::rt::TokioIo::new(tls);
                            hyper::server::conn::http1::Builder::new()
                                .serve_connection(io, hyper::service::service_fn(move |req| {
                                    let app = app.clone();
                                    app.clone().call(req)
                                }))
                                .await
                                .expect("serve connection");
                        });
                    }
                    Err(e) => {
                        tracing::warn!("TLS accept error: {e}");
                    }
                }
            }
        });
    }

    let listener = TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

fn build_tls_config(cert_path: &str, key_path: &str) -> Arc<ServerConfig> {
    // Load certificate
    let mut cert_file = BufReader::new(File::open(cert_path).expect("cannot open cert"));
    let certs: Vec<CertificateDer> = pemfile_certs(&mut cert_file)
        .collect::<Result<Vec<_>, _>>()
        .expect("invalid cert");

    // Load private key
    let mut key_file = BufReader::new(File::open(key_path).expect("cannot open key"));
    let keys: Vec<PrivateKeyDer> = pkcs8_private_keys(&mut key_file)
        .map(|k| k.map(PrivateKeyDer::from))
        .collect::<Result<Vec<_>, _>>()
        .expect("invalid key");
    let key = keys.into_iter().next().expect("no private key found");

    let mut config = ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(certs, key)
        .expect("bad certificate/key");

    // Configure ALPN for HTTP/1.1
    config.alpn_protocols = vec![b"http/1.1".to_vec()];

    Arc::new(config)
}

async fn root() -> impl IntoResponse {
    match std::fs::read_to_string("index.html") {
        Ok(html) => Html(html),
        Err(_) => Html(PLACEHOLDER_HTML.to_string()),
    }
}

async fn health() -> &'static str {
    "OK"
}

async fn tmdb_handler(
    Path(path): Path<String>,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> Result<(StatusCode, HeaderMap, Vec<u8>), StatusCode> {
    let query = params
        .iter()
        .map(|(k, v)| format!("{}={}", k, urlencoding::encode(v)))
        .collect::<Vec<_>>()
        .join("&");
    match ottplay_core::tmdb::proxy(&path, &query, TMDB_KEY.as_deref().unwrap_or("")).await {
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
    let cache = EPG_CACHE.read().await;
    let channel_id = params
        .ch
        .as_ref()
        .and_then(|ch| {
            ottplay_core::match_channel(ch, &cache.channels)
                .map(|(id, _score)| id)
        })
        .unwrap_or_else(|| hash.clone());
    let time_shift: i64 = params
        .ts
        .map(|ts| ts as i64)
        .unwrap_or(0);
    let result = ottplay_core::get_epg_slice(&cache, &hash, &channel_id, time_shift).await;
    Json(result)
}

#[derive(Debug, Deserialize)]
struct EpgParams {
    #[serde(rename = "ch")]
    ch: Option<String>,
    ts: Option<i32>,
}

async fn match_channels_handler(
    body: Bytes,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let channels: Vec<ottplay_core::m3u::M3uChannel> =
        serde_json::from_slice(&body).map_err(|_| StatusCode::BAD_REQUEST)?;
    let cache = EPG_CACHE.read().await;
    let mut epg_to_xmltv = EPG_TO_XMLTV.write().await;
    let mut time_shift_by_epg = TIME_SHIFT_BY_EPG.write().await;
    let results =
        ottplay_core::m3u::match_channels(channels, &cache.channels, &mut epg_to_xmltv, &mut time_shift_by_epg);
    Ok(Json(serde_json::to_value(results).unwrap()))
}

async fn match_logos_handler(
    body: Bytes,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let channels: Vec<ottplay_core::m3u::LogoChannel> =
        serde_json::from_slice(&body).map_err(|_| StatusCode::BAD_REQUEST)?;
    let cache = EPG_CACHE.read().await;
    let results = ottplay_core::m3u::match_logos(channels, &cache.channels);
    Ok(Json(serde_json::to_value(results).unwrap()))
}

async fn cp_proxy_handler(
    body: Bytes,
) -> Result<(StatusCode, HeaderMap, Vec<u8>), StatusCode> {
    let params: ottplay_core::m3u::ProxyParams =
        serde_json::from_slice(&body).map_err(|_| StatusCode::BAD_REQUEST)?;
    match ottplay_core::m3u::proxy_stream(params).await {
        Ok((mut headers, body)) => {
            headers.insert("access-control-allow-origin", HeaderValue::from_static("*"));
            headers.insert("access-control-allow-methods", HeaderValue::from_static("GET, POST, OPTIONS"));
            headers.insert("access-control-allow-headers", HeaderValue::from_static("*"));
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
        "#e74c3c", "#3498db", "#2ecc71", "#f39c12", "#9b59b6",
        "#1abc9c", "#e67e22", "#34495e", "#16a085", "#c0392b",
        "#2980b9", "#27ae60", "#d35400", "#8e44ad", "#f1c40f",
    ];
    let hash: u32 = logo_id.bytes().fold(5381u32, |acc, b| acc.wrapping_mul(33).wrapping_add(b as u32));
    let color = COLORS[(hash as usize) % COLORS.len()];
    let letter: String = if !ch_name.trim().is_empty() {
        ch_name.trim().chars().next().unwrap().to_uppercase().to_string()
    } else {
        let n = (hash as usize) % 26;
        ((b'A' + n as u8) as char).to_string()
    };
    format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="120" height="90" viewBox="0 0 120 90"><rect width="120" height="90" rx="8" fill="{color}"/><text x="60" y="58" text-anchor="middle" font-family="Arial,sans-serif" font-size="36" font-weight="bold" fill="white">{letter}</text></svg>"#
    )
}

/// /version/:path — return JSON with file metadata + md5(prefix).
async fn version_handler(
    Path(rel): Path<String>,
) -> Json<serde_json::Value> {
    use std::fs;
    let stripped = rel.strip_prefix('/').unwrap_or(&rel);
    let filename = stripped.rsplit('/').next().unwrap_or("").to_string();
    let filepath = format!("./{stripped}");
    match fs::metadata(&filepath) {
        Ok(meta) => {
            let bytes = fs::read(&filepath).unwrap_or_default();
            let digest = format!("{:x}", md5_like_hash(&bytes));
            let modified = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);
            Json(serde_json::json!({
                "file": filename,
                "hash": digest,
                "modified": modified,
                "size": meta.len(),
            }))
        }
        Err(_) => Json(serde_json::json!({"error": "not found"})),
    }
}

// md5-like stable digest (FNV-1a 64-bit)
fn md5_like_hash(bytes: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in bytes {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

const PLACEHOLDER_HTML: &str =
    "<!doctype html><html><body><h1>ottplay-server</h1></body></html>";

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

/// Webhook stubs - return 403 (real queue still served by local_proxy.py)
async fn webhook_stub() -> impl axum::response::IntoResponse {
    (
        StatusCode::FORBIDDEN,
        [(axum::http::header::CONTENT_TYPE, "text/plain; charset=utf-8")],
        "Webhook disabled for security. Use local_proxy.py.",
    )
}
