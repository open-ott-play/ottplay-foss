use axum::{
    extract::{rejection::JsonRejection, DefaultBodyLimit, OriginalUri, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use hmac::{Hmac, Mac};
use reqwest::Url;
use serde::Deserialize;
use sha2::Sha256;
use std::{collections::HashSet, io::Read, path::Path, sync::Arc};

const MAX_CONFIG_BYTES: u64 = 64 * 1024;
const RELAY_HEADER: &str = "x-ott-stalker-relay";

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RelayConfig {
    version: u8,
    routes: Vec<RouteConfig>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RouteConfig {
    name: String,
    upstream: String,
    credential: String,
}

struct RelayRoute {
    upstream: Url,
    credential: String,
}

/// Dedicated hosted relay: no assets, generic URL relay, control or media routes.
/// Read through an open handle so projected Kubernetes Secret symlinks work.
pub fn relay_routes(path: &Path) -> anyhow::Result<Router> {
    let read = || -> std::io::Result<Vec<u8>> {
        // Reject an accidentally configured FIFO before its blocking open.
        // This follows projected Secret symlinks; the operator owns this path.
        let before = std::fs::metadata(path)?;
        if !before.is_file() || before.len() > MAX_CONFIG_BYTES {
            return Err(std::io::ErrorKind::InvalidData.into());
        }
        let file = std::fs::File::open(path)?;
        let metadata = file.metadata()?;
        if !metadata.is_file() || metadata.len() > MAX_CONFIG_BYTES {
            return Err(std::io::ErrorKind::InvalidData.into());
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            // A read-only Secret group is allowed for an unprivileged container.
            if metadata.permissions().mode() & 0o037 != 0 {
                return Err(std::io::ErrorKind::PermissionDenied.into());
            }
        }
        let mut bytes = Vec::new();
        file.take(MAX_CONFIG_BYTES + 1).read_to_end(&mut bytes)?;
        Ok(bytes)
    };
    anyhow::ensure!(
        path.is_absolute(),
        "Stalker relay config path must be absolute"
    );
    // File paths, credentials and malformed JSON values must not enter diagnostics.
    let bytes = read().map_err(|_| anyhow::anyhow!("Cannot read private Stalker relay config"))?;
    configured_relay(&bytes).map_err(|_| anyhow::anyhow!("Invalid Stalker relay config"))
}

fn configured_relay(bytes: &[u8]) -> Result<Router, ()> {
    if bytes.len() > MAX_CONFIG_BYTES as usize {
        return Err(());
    }
    let config: RelayConfig = serde_json::from_slice(bytes).map_err(|_| ())?;
    if config.version != 1 || config.routes.is_empty() || config.routes.len() > 32 {
        return Err(());
    }
    let mut names = HashSet::new();
    let mut upstreams = HashSet::new();
    let mut credentials = HashSet::new();
    let mut app = Router::new().route("/health", get(|| async { "OK" }));
    for entry in config.routes {
        let valid_name = !entry.name.is_empty()
            && entry.name.len() <= 64
            && entry.name != "api"
            && entry.name.split('-').all(|part| {
                !part.is_empty()
                    && part
                        .bytes()
                        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
            });
        let valid_credential = (32..=256).contains(&entry.credential.len())
            && entry
                .credential
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-');
        let upstream = Url::parse(&entry.upstream).map_err(|_| ())?;
        if !valid_name
            || !valid_credential
            || entry.upstream.len() > 2048
            || upstream.as_str() != entry.upstream
            || !matches!(upstream.scheme(), "http" | "https")
            || upstream.host_str().is_none()
            || !upstream.username().is_empty()
            || upstream.password().is_some()
            || upstream.query().is_some()
            || upstream.fragment().is_some()
            || !["/load.php", "/portal.php"]
                .iter()
                .any(|end| upstream.path().ends_with(end))
            || !names.insert(entry.name.clone())
            || !upstreams.insert(entry.upstream)
            || !credentials.insert(entry.credential.clone())
        {
            return Err(());
        }
        app = app.route(
            &format!("/stalker/{}", entry.name),
            post(handle_named)
                .with_state(Arc::new(RelayRoute {
                    upstream,
                    credential: entry.credential,
                }))
                .layer(DefaultBodyLimit::max(
                    ottplay_core::stalker::MAX_REQUEST_BYTES,
                )),
        );
    }
    Ok(app)
}

impl RelayRoute {
    fn authorizes(&self, headers: &HeaderMap) -> bool {
        let mut values = headers.get_all(RELAY_HEADER).iter();
        let Some(supplied) = values.next().and_then(|value| value.to_str().ok()) else {
            return false;
        };
        if values.next().is_some() || !(32..=256).contains(&supplied.len()) {
            return false;
        }
        // Same constant-time HMAC verification pattern as normalization auth.
        let mut expected =
            Hmac::<Sha256>::new_from_slice(self.credential.as_bytes()).expect("HMAC key");
        expected.update(b"Stalker relay authorization");
        let mut actual = Hmac::<Sha256>::new_from_slice(supplied.as_bytes()).expect("HMAC key");
        actual.update(b"Stalker relay authorization");
        actual
            .verify_slice(&expected.finalize().into_bytes())
            .is_ok()
    }

    fn accepts(&self, request: &ottplay_core::stalker::Request) -> bool {
        let Ok(url) = Url::parse(&request.url) else {
            return false;
        };
        url.username().is_empty()
            && url.password().is_none()
            && url.fragment().is_none()
            && url.origin() == self.upstream.origin()
            && url.path() == self.upstream.path()
            && request.validate().is_ok()
    }
}

async fn handle_named(
    State(route): State<Arc<RelayRoute>>,
    headers: HeaderMap,
    OriginalUri(uri): OriginalUri,
    request: Result<Json<ottplay_core::stalker::Request>, JsonRejection>,
) -> Response {
    if !route.authorizes(&headers) {
        return no_store((StatusCode::FORBIDDEN, "Stalker relay access denied").into_response());
    }
    let request = match request {
        Ok(Json(request)) => request,
        Err(error) => return no_store((error.status(), "Invalid Stalker request").into_response()),
    };
    if uri.query().is_some() || !route.accepts(&request) {
        return no_store((StatusCode::BAD_REQUEST, "Invalid Stalker request").into_response());
    }
    // Only the validated inner provider headers reach its fixed upstream.
    // The outer operator credential is never forwarded to the provider.
    handle(Json(request)).await
}

pub fn routes() -> Router {
    Router::new().route(
        "/stalker/api",
        post(handle).layer(DefaultBodyLimit::max(
            ottplay_core::stalker::MAX_REQUEST_BYTES,
        )),
    )
}

async fn handle(Json(request): Json<ottplay_core::stalker::Request>) -> Response {
    let response = if request.validate().is_err() {
        (StatusCode::BAD_REQUEST, "Invalid Stalker request").into_response()
    } else {
        match ottplay_core::stalker::request(request).await {
            Ok((status, body)) => (
                status,
                [
                    ("content-type", "application/json; charset=utf-8"),
                    ("x-content-type-options", "nosniff"),
                ],
                body,
            )
                .into_response(),
            Err(error) => {
                let status = match error.as_str() {
                    "Proxy destination is not allowed" => StatusCode::FORBIDDEN,
                    "Proxy request timed out" => StatusCode::GATEWAY_TIMEOUT,
                    "Proxy is busy; retry later" | "Proxy DNS is busy; retry later" => {
                        StatusCode::SERVICE_UNAVAILABLE
                    }
                    _ => StatusCode::BAD_GATEWAY,
                };
                // Credentials and upstream response details never enter logs/errors.
                (status, "Stalker request failed").into_response()
            }
        }
    };
    no_store(response)
}

fn no_store(response: Response) -> Response {
    let (mut parts, body) = response.into_parts();
    parts
        .headers
        .insert("cache-control", "no-store".parse().unwrap());
    Response::from_parts(parts, body)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::{to_bytes, Body},
        http::Request,
    };
    use tower::Service;

    fn config() -> serde_json::Value {
        serde_json::json!({"version": 1, "routes": [{
            "name": "provider-1",
            "upstream": "https://portal.example/server/load.php",
            "credential": "a".repeat(43)
        }]})
    }

    fn configured(value: &serde_json::Value) -> Result<Router, ()> {
        configured_relay(&serde_json::to_vec(value).unwrap())
    }

    fn provider_request(url: &str) -> ottplay_core::stalker::Request {
        serde_json::from_value(serde_json::json!({
            "url": url,
            "headers": {"Cookie": "mac=fixture-provider-secret"}
        }))
        .unwrap()
    }

    #[test]
    fn relay_config_is_bounded_unambiguous_and_opt_in() {
        let good = config();
        assert!(configured(&good).is_ok());
        let mut cases = vec![
            serde_json::json!({}),
            serde_json::json!({"version": 1, "routes": []}),
            serde_json::json!({"version": 1, "routes": vec![good["routes"][0].clone(); 33]}),
        ];
        for version in [0, 2] {
            let mut value = good.clone();
            value["version"] = version.into();
            cases.push(value);
        }
        let mut unknown = good.clone();
        unknown["secret"] = "fixture-secret".into();
        cases.push(unknown);
        let mut unknown = good.clone();
        unknown["routes"][0]["headers"] = serde_json::json!({});
        cases.push(unknown);
        for name in [
            "",
            "api",
            "Provider",
            "-a",
            "a-",
            "a--b",
            "../api",
            "a/b",
            "a?x",
            "a_b",
            &"a".repeat(65),
        ] {
            let mut value = good.clone();
            value["routes"][0]["name"] = name.into();
            cases.push(value);
        }
        for secret in [
            "short".to_string(),
            "a".repeat(257),
            "a ".repeat(30),
            "a\n".repeat(30),
        ] {
            let mut value = good.clone();
            value["routes"][0]["credential"] = secret.into();
            cases.push(value);
        }
        for upstream in [
            "file:///server/load.php",
            "https://portal.example/c/",
            "https://portal.example/server/load.php?x=1",
            "https://portal.example/server/load.php#x",
            "https://user:secret@portal.example/server/load.php",
            "https://PORTAL.example/server/load.php",
            "https://portal.example/a/../server/load.php",
            " https://portal.example/server/load.php",
        ] {
            let mut value = good.clone();
            value["routes"][0]["upstream"] = upstream.into();
            cases.push(value);
        }
        let mut oversized_url = good.clone();
        oversized_url["routes"][0]["upstream"] =
            format!("https://portal.example/{}/load.php", "x".repeat(2048)).into();
        cases.push(oversized_url);
        for duplicate in ["name", "upstream", "credential"] {
            let mut value = good.clone();
            let mut second = serde_json::json!({"name":"provider-2", "upstream":"https://other.example/load.php", "credential":"b".repeat(43)});
            second[duplicate] = value["routes"][0][duplicate].clone();
            value["routes"].as_array_mut().unwrap().push(second);
            cases.push(value);
        }
        for value in cases {
            assert!(configured(&value).is_err());
        }
        assert!(configured_relay(&vec![b' '; MAX_CONFIG_BYTES as usize + 1]).is_err());
        assert!(configured_relay(br#"{"version":1,"version":1,"routes":[]}"#).is_err());
        let duplicate = serde_json::to_string(&good)
            .unwrap()
            .replace("\"name\":", "\"name\":\"extra\",\"name\":");
        assert!(configured_relay(duplicate.as_bytes()).is_err());
    }

    #[test]
    fn relay_accepts_only_fixed_endpoint_and_core_protocol() {
        let route = RelayRoute {
            upstream: Url::parse("https://portal.example/server/load.php").unwrap(),
            credential: "a".repeat(43),
        };
        for kind_action in [
            "type=stb&action=handshake",
            "type=stb&action=get_profile",
            "type=itv&action=get_all_channels",
            "type=vod&action=get_categories",
            "type=vod&action=get_ordered_list",
            "type=vod&action=create_link",
        ] {
            for endpoint in [
                "https://portal.example/server/load.php",
                "https://portal.example:443/server/load.php",
            ] {
                let request =
                    provider_request(&format!("{endpoint}?{kind_action}&JsHttpRequest=1-xml"));
                assert!(route.accepts(&request));
            }
        }
        for url in [
            "http://portal.example/server/load.php?type=vod&action=get_categories&JsHttpRequest=1-xml",
            "https://portal.example:8443/server/load.php?type=vod&action=get_categories&JsHttpRequest=1-xml",
            "https://other.example/server/load.php?type=vod&action=get_categories&JsHttpRequest=1-xml",
            "https://portal.example/other/load.php?type=vod&action=get_categories&JsHttpRequest=1-xml",
            "https://secret@portal.example/server/load.php?type=vod&action=get_categories&JsHttpRequest=1-xml",
            "https://portal.example/server/load.php?type=vod&action=get_categories&JsHttpRequest=1-xml#secret",
            "https://portal.example/server/load.php?type=series&action=get_categories&JsHttpRequest=1-xml",
            "https://portal.example/server/load.php?type=vod&action=delete&JsHttpRequest=1-xml",
            "https://portal.example/server/load.php?type=vod&type=itv&action=get_categories&JsHttpRequest=1-xml",
        ] { assert!(!route.accepts(&provider_request(url))); }
        let mut request = provider_request("https://portal.example/server/load.php?type=vod&action=get_categories&JsHttpRequest=1-xml");
        request
            .headers
            .insert("Referer".into(), "https://other.example/c/".into());
        assert!(!route.accepts(&request));
        request
            .headers
            .insert("Referer".into(), "https://portal.example/c/".into());
        request.headers.insert(
            "Authorization".into(),
            "Bearer fixture-provider-secret".into(),
        );
        assert!(route.accepts(&request));
        request
            .headers
            .insert("X-OTT-Stalker-Relay".into(), "a".repeat(43));
        assert!(
            !route.accepts(&request),
            "Operator auth cannot enter provider headers"
        );
    }

    #[tokio::test]
    async fn named_relay_keeps_auth_body_and_destination_boundaries() {
        let mut value = config();
        value["routes"][0]["upstream"] = "http://127.0.0.1/server/load.php".into();
        let app = configured(&value).unwrap();
        let body = serde_json::json!({"url":"http://127.0.0.1/server/load.php?type=vod&action=get_categories&JsHttpRequest=1-xml", "headers":{"Cookie":"mac=fixture-provider-secret", "Authorization":"Bearer fixture-provider-secret"}}).to_string();
        for (secret, path, payload, status, expected) in [
            (
                None,
                "/stalker/provider-1",
                body.clone(),
                StatusCode::FORBIDDEN,
                "Stalker relay access denied",
            ),
            (
                Some("b".repeat(43)),
                "/stalker/provider-1",
                body.clone(),
                StatusCode::FORBIDDEN,
                "Stalker relay access denied",
            ),
            (
                Some("a".repeat(43)),
                "/stalker/provider-1",
                body.clone(),
                StatusCode::FORBIDDEN,
                "Stalker request failed",
            ),
            (
                Some("a".repeat(43)),
                "/stalker/provider-1?url=other",
                body.clone(),
                StatusCode::BAD_REQUEST,
                "Invalid Stalker request",
            ),
            (
                Some("a".repeat(43)),
                "/stalker/provider-1",
                "{fixture-provider-secret".into(),
                StatusCode::BAD_REQUEST,
                "Invalid Stalker request",
            ),
            (
                Some("a".repeat(43)),
                "/stalker/provider-1",
                " ".repeat(ottplay_core::stalker::MAX_REQUEST_BYTES + 1),
                StatusCode::PAYLOAD_TOO_LARGE,
                "Invalid Stalker request",
            ),
        ] {
            let mut request = Request::post(path).header("content-type", "application/json");
            if let Some(secret) = secret {
                request = request.header(RELAY_HEADER, secret);
            }
            let response = app
                .clone()
                .call(request.body(Body::from(payload)).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), status);
            assert_eq!(response.headers()["cache-control"], "no-store");
            assert_eq!(
                to_bytes(response.into_body(), 4096).await.unwrap(),
                expected
            );
        }
        let mut request = Request::post("/stalker/provider-1")
            .header("content-type", "application/json")
            .header(RELAY_HEADER, "a".repeat(43))
            .body(Body::from(body))
            .unwrap();
        request
            .headers_mut()
            .append(RELAY_HEADER, "a".repeat(43).parse().unwrap());
        assert_eq!(
            app.clone().call(request).await.unwrap().status(),
            StatusCode::FORBIDDEN
        );
    }

    #[tokio::test]
    async fn relay_router_has_only_health_and_named_post_routes() {
        let app = configured(&config()).unwrap();
        for path in [
            "/",
            "/stalker/api",
            "/stalker/missing",
            "/vportal/api",
            "/m3u/cp.php",
            "/api",
            "/local/config.json",
        ] {
            for method in ["GET", "POST"] {
                let response = app
                    .clone()
                    .call(
                        Request::builder()
                            .method(method)
                            .uri(path)
                            .body(Body::empty())
                            .unwrap(),
                    )
                    .await
                    .unwrap();
                assert_eq!(response.status(), StatusCode::NOT_FOUND, "{method} {path}");
            }
        }
        let health = app
            .clone()
            .call(Request::get("/health").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(health.status(), StatusCode::OK);
        assert_eq!(to_bytes(health.into_body(), 8).await.unwrap(), "OK");
        for method in ["GET", "OPTIONS", "PUT", "DELETE"] {
            let response = app
                .clone()
                .call(
                    Request::builder()
                        .method(method)
                        .uri("/stalker/provider-1")
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::METHOD_NOT_ALLOWED);
            assert!(response
                .headers()
                .get("access-control-allow-origin")
                .is_none());
        }
    }

    #[cfg(unix)]
    #[test]
    fn relay_rejects_an_accidental_fifo_without_waiting_for_a_writer() {
        let directory =
            std::env::temp_dir().join(format!("ott-stalker-fifo-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&directory).unwrap();
        let fifo = directory.join("config.json");
        assert!(std::process::Command::new("mkfifo")
            .arg(&fifo)
            .status()
            .expect("POSIX mkfifo")
            .success());
        let (send, receive) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let _ = send.send(relay_routes(&fifo).is_err());
        });
        let result = receive.recv_timeout(std::time::Duration::from_secs(2));
        std::fs::remove_dir_all(directory).unwrap();
        assert!(result.expect("FIFO config must not block opening"));
    }

    #[test]
    fn relay_file_errors_are_redacted_and_files_are_bounded() {
        let directory = std::env::temp_dir().join(format!("ott-stalker-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&directory).unwrap();
        let file = directory.join("fixture-secret.json");
        assert!(relay_routes(Path::new("relative.json")).is_err());
        assert!(relay_routes(&directory).is_err());
        assert!(relay_routes(&file).is_err());
        std::fs::write(&file, serde_json::to_vec(&config()).unwrap()).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o600)).unwrap();
        }
        assert!(relay_routes(&file).is_ok());
        #[cfg(unix)]
        {
            use std::os::unix::fs::{symlink, PermissionsExt};
            let link = directory.join("projected-secret.json");
            symlink(&file, &link).unwrap();
            assert!(
                relay_routes(&link).is_ok(),
                "Projected Secret symlinks remain usable"
            );
            for mode in [0o440, 0o640] {
                std::fs::set_permissions(&file, std::fs::Permissions::from_mode(mode)).unwrap();
                assert!(
                    relay_routes(&link).is_ok(),
                    "Read-only Secret group: {mode:o}"
                );
            }
            for mode in [0o660, 0o610, 0o604] {
                std::fs::set_permissions(&file, std::fs::Permissions::from_mode(mode)).unwrap();
                assert!(relay_routes(&file).is_err(), "Unsafe Secret mode: {mode:o}");
            }
            std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o644)).unwrap();
            assert!(relay_routes(&file).is_err());
            std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o600)).unwrap();
        }
        for payload in [
            b"fixture-secret".to_vec(),
            vec![b' '; MAX_CONFIG_BYTES as usize + 1],
        ] {
            std::fs::write(&file, payload).unwrap();
            let error = match relay_routes(&file) {
                Ok(_) => panic!("Invalid file accepted"),
                Err(error) => error.to_string(),
            };
            assert!(!error.contains("fixture-secret"));
            assert!(!error.contains(&directory.to_string_lossy().to_string()));
        }
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[tokio::test]
    async fn bounds_and_validates_requests_without_exposing_credentials() {
        let response = routes()
            .call(
                Request::post("/stalker/provider-1")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            response.status(),
            StatusCode::NOT_FOUND,
            "Ordinary relay never enables named routes"
        );
        for (body, expected) in [
            ("{".to_string(), StatusCode::BAD_REQUEST),
            (
                " ".repeat(ottplay_core::stalker::MAX_REQUEST_BYTES + 1),
                StatusCode::PAYLOAD_TOO_LARGE,
            ),
            (
                r#"{"url":"http://127.0.0.1/server/load.php?type=stb&action=handshake&JsHttpRequest=1-xml","headers":{"Cookie":"mac=fixture-secret"}}"#.into(),
                StatusCode::FORBIDDEN,
            ),
        ] {
            let response = routes()
                .call(
                    Request::post("/stalker/api")
                        .header("content-type", "application/json")
                        .body(Body::from(body))
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), expected);
            let body = to_bytes(response.into_body(), 4096).await.unwrap();
            assert!(!String::from_utf8_lossy(&body).contains("fixture-secret"));
        }
    }
}
