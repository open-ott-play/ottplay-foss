//! Native Mode B command queue — `localhost:18081` HTTP server.
//!
//! Mirrors the contract of `local_proxy.py` so external clients (HA, Node-RED,
//! curl, SWOP-style injectors) keep working unchanged when the Tauri app is
//! the active backend.
//!
//! Endpoints (under `localhost:18081`):
//!   POST /api/webhook/commands (alias /webhook/notify)
//!       body: arbitrary JSON object; `ts` is attached on enqueue.
//!       query: `?device_id=<id>` for per-device routing (else broadcast).
//!       response: `{"status":"ok","queued":N}`
//!   GET /api/webhook/commands (alias /webhook/poll)
//!       query: `?device_id=<id>` (else broadcast).
//!       response: JSON array of pending commands, dropped after 60s.
//!
//! Storage: in-memory. Expire > 60s. Cap: per-device 50 (trim to 25 on overflow),
//! broadcast 100 (trim to 50). Identical to `local_proxy.py`.

use std::collections::HashMap;
use std::sync::Arc;
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Value as JsonValue};
use tiny_http::{Header, Method, Response, Server, StatusCode};
use tokio::sync::RwLock;

const EXPIRE_SECS: f64 = 60.0;
const DEVICE_CAP: usize = 50;
const DEVICE_TRIM: usize = 25;
const BROADCAST_CAP: usize = 100;
const BROADCAST_TRIM: usize = 50;

/// In-memory queues shared with the HTTP server thread.
#[derive(Default)]
pub struct CommandQueues {
    /// Per-device queues.
    pub devices: HashMap<String, Vec<JsonValue>>,
    /// Broadcast queue.
    pub broadcast: Vec<JsonValue>,
}

pub type SharedQueues = Arc<RwLock<CommandQueues>>;

pub fn new_shared() -> SharedQueues {
    Arc::new(RwLock::new(CommandQueues::default()))
}

fn now_ts() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

fn cors_headers() -> Vec<Header> {
    vec![
        Header::from_bytes(&b"Access-Control-Allow-Origin"[..], b"*").unwrap(),
        Header::from_bytes(&b"Access-Control-Allow-Methods"[..], b"GET, POST, OPTIONS").unwrap(),
        Header::from_bytes(&b"Access-Control-Allow-Headers"[..], b"*").unwrap(),
        Header::from_bytes(&b"Access-Control-Max-Age"[..], b"86400").unwrap(),
    ]
}

fn json_response(status: u16, body: JsonValue) -> Response<std::io::Cursor<Vec<u8>>> {
    let bytes = serde_json::to_vec(&body).unwrap_or_else(|_| b"{}".to_vec());
    let mut resp = Response::from_data(bytes).with_status_code(StatusCode(status));
    resp.add_header(
        Header::from_bytes(&b"Content-Type"[..], b"application/json; charset=utf-8").unwrap(),
    );
    for h in cors_headers() {
        resp.add_header(h);
    }
    resp
}

fn empty_response(status: u16) -> Response<std::io::Cursor<Vec<u8>>> {
    let mut resp = Response::from_data(Vec::<u8>::new()).with_status_code(StatusCode(status));
    for h in cors_headers() {
        resp.add_header(h);
    }
    resp
}

fn path_matches(path: &str, candidates: &[&str]) -> bool {
    candidates.iter().any(|c| path == *c)
}

fn read_body(req: &mut tiny_http::Request) -> String {
    let mut s = String::new();
    let _ = std::io::Read::read_to_string(req.as_reader(), &mut s);
    s
}

fn extract_device_id(url: &str) -> String {
    let query = url.splitn(2, '?').nth(1).unwrap_or("");
    for (k, v) in url::form_urlencoded::parse(query.as_bytes()) {
        if k == "device_id" {
            return v.trim().to_string();
        }
    }
    String::new()
}

/// Start the HTTP server on a background thread. Non-blocking.
///
/// Binds to `127.0.0.1:18081` (loopback only) per `docs/port-native-apps.md` § Tier 6.
pub fn spawn_http_server(queues: SharedQueues) {
    thread::spawn(move || {
        let server = match Server::http("127.0.0.1:18081") {
            Ok(s) => s,
            Err(e) => {
                tracing::error!("command queue: failed to bind 127.0.0.1:18081: {e}");
                return;
            }
        };
        tracing::info!("command queue listening on http://127.0.0.1:18081");
        for req in server.incoming_requests() {
            let url = req.url().to_string();
            handle_request(req, &url, queues.clone());
        }
    });
}

fn handle_request(mut req: tiny_http::Request, url: &str, queues: SharedQueues) {
    let path = url.splitn(2, '?').next().unwrap_or(url).trim_end_matches('/');
    let method = req.method().clone();

    if method == Method::Options {
        let _ = req.respond(empty_response(200));
        return;
    }

    let is_post = path_matches(path, &["/api/webhook/commands", "/webhook/notify"])
        && method == Method::Post;
    let is_get = path_matches(path, &["/api/webhook/commands", "/webhook/poll"])
        && method == Method::Get;

    if !is_post && !is_get {
        let _ = req.respond(json_response(
            404,
            json!({"error": "Not Found", "path": path}),
        ));
        return;
    }

    let device_id = extract_device_id(url);

    if is_post {
        let body = read_body(&mut req);
        let mut data: JsonValue = match serde_json::from_str(&body) {
            Ok(v) => v,
            Err(_) => {
                let _ = req.respond(json_response(400, json!({"error": "Invalid JSON"})));
                return;
            }
        };
        if let Some(obj) = data.as_object_mut() {
            obj.insert("ts".to_string(), json!(now_ts()));
        } else {
            // wrap non-object payloads so downstream `cmd.command` lookups still work
            data = json!({ "value": data, "ts": now_ts() });
        }

        let queued: usize = {
            let mut w = queues.blocking_write();
            if device_id.is_empty() {
                w.broadcast.push(data);
                if w.broadcast.len() > BROADCAST_CAP {
                    let drop = w.broadcast.len() - BROADCAST_TRIM;
                    w.broadcast.drain(0..drop);
                }
                w.broadcast.len()
            } else {
                let entry = w.devices.entry(device_id.clone()).or_default();
                entry.push(data);
                if entry.len() > DEVICE_CAP {
                    let drop = entry.len() - DEVICE_TRIM;
                    entry.drain(0..drop);
                }
                entry.len()
            }
        };

        let _ = req.respond(json_response(200, json!({"status": "ok", "queued": queued})));
        return;
    }

    // GET: drain & filter by 60s cutoff.
    let cutoff = now_ts() - EXPIRE_SECS;
    let result: Vec<JsonValue> = {
        let mut w = queues.blocking_write();
        if device_id.is_empty() {
            let recent: Vec<JsonValue> = w
                .broadcast
                .iter()
                .filter(|n| n.get("ts").and_then(|v| v.as_f64()).unwrap_or(0.0) > cutoff)
                .cloned()
                .collect();
            w.broadcast.clear();
            recent
        } else {
            let entry = w.devices.entry(device_id.clone()).or_default();
            let recent: Vec<JsonValue> = entry
                .iter()
                .filter(|n| n.get("ts").and_then(|v| v.as_f64()).unwrap_or(0.0) > cutoff)
                .cloned()
                .collect();
            entry.clear();
            recent
        }
    };

    let _ = req.respond(json_response(200, JsonValue::Array(result)));
}

// ─── Tauri IPC surface (for direct JS invoke) ───────────────────────────────

/// `invoke('queue_poll', {device_id})` → JSON array of pending commands.
#[tauri::command]
pub async fn queue_poll(
    state: tauri::State<'_, crate::commands::tauri_commands::TauriState>,
    device_id: Option<String>,
) -> Result<JsonValue, String> {
    let device_id = device_id.unwrap_or_default();
    let cutoff = now_ts() - EXPIRE_SECS;
    let mut w = state.command_queues.write().await;
    if device_id.is_empty() {
        let recent: Vec<JsonValue> = w
            .broadcast
            .iter()
            .filter(|n| n.get("ts").and_then(|v| v.as_f64()).unwrap_or(0.0) > cutoff)
            .cloned()
            .collect();
        w.broadcast.clear();
        Ok(JsonValue::Array(recent))
    } else {
        let entry = w.devices.entry(device_id).or_default();
        let recent: Vec<JsonValue> = entry
            .iter()
            .filter(|n| n.get("ts").and_then(|v| v.as_f64()).unwrap_or(0.0) > cutoff)
            .cloned()
            .collect();
        entry.clear();
        Ok(JsonValue::Array(recent))
    }
}

/// `invoke('queue_enqueue', {device_id, command})` → `{"status":"ok","queued":N}`.
///
/// `command` is the JSON object to enqueue (must be a map). `ts` is attached.
#[tauri::command]
pub async fn queue_enqueue(
    state: tauri::State<'_, crate::commands::tauri_commands::TauriState>,
    device_id: Option<String>,
    command: JsonValue,
) -> Result<JsonValue, String> {
    let device_id = device_id.unwrap_or_default();
    let mut data = command;
    if let Some(obj) = data.as_object_mut() {
        obj.insert("ts".to_string(), json!(now_ts()));
    } else {
        data = json!({ "value": data, "ts": now_ts() });
    }
    let mut w = state.command_queues.write().await;
    let queued = if device_id.is_empty() {
        w.broadcast.push(data);
        if w.broadcast.len() > BROADCAST_CAP {
            let drop = w.broadcast.len() - BROADCAST_TRIM;
            w.broadcast.drain(0..drop);
        }
        w.broadcast.len()
    } else {
        let entry = w.devices.entry(device_id).or_default();
        entry.push(data);
        if entry.len() > DEVICE_CAP {
            let drop = entry.len() - DEVICE_TRIM;
            entry.drain(0..drop);
        }
        entry.len()
    };
    Ok(json!({ "status": "ok", "queued": queued }))
}
