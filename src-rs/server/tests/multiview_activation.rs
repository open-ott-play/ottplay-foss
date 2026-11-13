//! Production-binary activation checks for the capacity-zero private shell.
//! Synthetic loopback listeners/configuration only; no media, decoder, or TV.
#![cfg(unix)]

use reqwest::{header::HeaderMap, Client, Method, StatusCode};
use serde_json::{json, Value};
use std::{
    fs,
    io::Read,
    net::TcpListener,
    os::unix::fs::{symlink, DirBuilderExt, MetadataExt, PermissionsExt},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const TOKEN: &str = "synthetic_multiview_token_aaaaaaaaaaaaaaaaaaaaaaaa";
const SIGNING: &str = "synthetic_signing_key_bbbbbbbbbbbb";
const NATIVE_ORIGIN: &str = "https://native.example.test";
const CAPS: &str = "/multiview/v1/capabilities";
const STARTUP_LIMIT: Duration = Duration::from_secs(8);

struct Fixture {
    root: PathBuf,
    public: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        // Shared runner scratch directories may have writable ancestors. Use
        // only a verified physical HOME, never /tmp or a permissive fallback.
        let supplied_home = PathBuf::from(std::env::var_os("HOME").expect("HOME is required"));
        assert!(supplied_home.is_absolute(), "HOME must be absolute");
        let home = fs::canonicalize(supplied_home).expect("HOME must resolve to a directory");
        let uid = unsafe { libc::geteuid() };
        for ancestor in home.ancestors() {
            let metadata =
                fs::symlink_metadata(ancestor).expect("HOME ancestry must be inspectable");
            assert!(
                metadata.is_dir()
                    && (metadata.uid() == 0 || metadata.uid() == uid)
                    && metadata.mode() & 0o022 == 0,
                "HOME ancestry must be directories owned by root or the effective user and not group/world writable"
            );
        }
        let root = home.join(format!(
            ".ottplay-multiview-activation-{}",
            uuid::Uuid::new_v4()
        ));
        fs::DirBuilder::new().mode(0o700).create(&root).unwrap();
        let public = root.join("public");
        let fixture = Self { root, public };
        fs::create_dir(&fixture.public).unwrap();
        fixture
    }

    fn document(&self, port: u16, tls: bool) -> Value {
        let expires = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64
            + 3_600_000;
        json!({
            "version": 1,
            "server_id": "activation_server_A",
            "origin": format!("{}://127.0.0.1:{port}", if tls { "https" } else { "http" }),
            "listener": {"bind_ip": "127.0.0.1", "https": tls, "lan_approved": false},
            "allowed_origins": [NATIVE_ORIGIN],
            "signing_key": SIGNING,
            "credentials": [{
                "installation_id": "activation_native_A",
                "control_bearer": TOKEN,
                "subject": "activation_owner_A",
                "revision": 1,
                "expires_at_ms": expires
            }]
        })
    }

    fn write(&self, name: &str, bytes: &[u8]) -> PathBuf {
        let path = self.root.join(name);
        fs::write(&path, bytes).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        path
    }

    fn config(&self, port: u16, tls: bool) -> PathBuf {
        self.write(
            "operator.json",
            &serde_json::to_vec(&self.document(port, tls)).unwrap(),
        )
    }

    fn command(&self, http: &[u16], https: &[u16], config: Option<&Path>) -> Command {
        let mut command = Command::new(env!("CARGO_BIN_EXE_ottplay-server"));
        command.current_dir(&self.public).env_clear();
        // No external EPG or inherited sidecar/private-profile configuration.
        command.env("EPG_URLS", "http://127.0.0.1:1/synthetic-unavailable");
        command.args(["--host", "127.0.0.1"]);
        for port in http {
            command.arg("--port").arg(port.to_string());
        }
        if !https.is_empty() {
            command.arg("--cert").arg(self.root.join("leaf.pem"));
            command.arg("--key").arg(self.root.join("leaf.key"));
            for port in https {
                command.arg("--https-port").arg(port.to_string());
            }
        }
        if let Some(path) = config {
            command.arg("--multiview-config").arg(path);
        }
        command
    }

    fn certificates(&self) {
        self.write("root.cnf", b"[req]\ndistinguished_name=dn\nx509_extensions=ca\nprompt=no\n[dn]\nCN=Synthetic activation root\n[ca]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n");
        self.openssl(&[
            "req",
            "-new",
            "-x509",
            "-newkey",
            "ec",
            "-pkeyopt",
            "ec_paramgen_curve:P-256",
            "-nodes",
            "-days",
            "1",
            "-sha256",
            "-config",
            "root.cnf",
            "-keyout",
            "root.key",
            "-out",
            "root.pem",
        ]);
        self.openssl(&[
            "req",
            "-new",
            "-newkey",
            "ec",
            "-pkeyopt",
            "ec_paramgen_curve:P-256",
            "-nodes",
            "-sha256",
            "-subj",
            "/CN=Synthetic activation listener",
            "-keyout",
            "leaf.key",
            "-out",
            "leaf.csr",
        ]);
        self.write("leaf.ext", b"basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\nsubjectAltName=IP:127.0.0.1\n");
        self.openssl(&[
            "x509",
            "-req",
            "-sha256",
            "-days",
            "1",
            "-in",
            "leaf.csr",
            "-CA",
            "root.pem",
            "-CAkey",
            "root.key",
            "-set_serial",
            "2",
            "-extfile",
            "leaf.ext",
            "-out",
            "leaf.pem",
        ]);
    }

    fn openssl(&self, args: &[&str]) {
        let output = fs::File::create(self.root.join("openssl.log")).unwrap();
        let mut child = OwnedChild(
            Command::new("openssl")
                .args(args)
                .current_dir(&self.root)
                .stdin(Stdio::null())
                .stdout(output.try_clone().unwrap())
                .stderr(output)
                .spawn()
                .expect("openssl is required for the synthetic TLS fixture"),
        );
        let deadline = Instant::now() + STARTUP_LIMIT;
        loop {
            if let Some(status) = child.0.try_wait().unwrap() {
                assert!(status.success(), "synthetic certificate generation failed");
                return;
            }
            assert!(
                Instant::now() < deadline,
                "synthetic certificate generation timed out"
            );
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    fn client(&self, tls: bool) -> Client {
        let mut builder = Client::builder()
            .no_proxy()
            .http1_only()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(3));
        if tls {
            builder = builder.tls_built_in_root_certs(false).add_root_certificate(
                reqwest::Certificate::from_pem(&fs::read(self.root.join("root.pem")).unwrap())
                    .unwrap(),
            );
        }
        builder.build().unwrap()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

struct OwnedChild(Child);
impl Drop for OwnedChild {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

struct Server {
    child: OwnedChild,
    log: PathBuf,
}

impl Server {
    fn spawn(fixture: &Fixture, mut command: Command) -> Self {
        let log = fixture
            .root
            .join(format!("server-{}.log", uuid::Uuid::new_v4()));
        let file = fs::File::create(&log).unwrap();
        let child = command
            .stdin(Stdio::null())
            .stdout(file.try_clone().unwrap())
            .stderr(file)
            .spawn()
            .unwrap();
        Self {
            child: OwnedChild(child),
            log,
        }
    }

    fn text(&self) -> String {
        let mut bytes = Vec::new();
        fs::File::open(&self.log)
            .unwrap()
            .take(16_384)
            .read_to_end(&mut bytes)
            .unwrap();
        String::from_utf8_lossy(&bytes).into_owned()
    }

    async fn ready(&mut self, http: &[u16], https: &[u16]) {
        let expected: Vec<_> = http
            .iter()
            .map(|p| format!("ottplay-server: http://127.0.0.1:{p}"))
            .chain(
                https
                    .iter()
                    .map(|p| format!("ottplay-server: https://127.0.0.1:{p}")),
            )
            .collect();
        let deadline = Instant::now() + STARTUP_LIMIT;
        loop {
            assert!(
                self.child.0.try_wait().unwrap().is_none(),
                "child exited before ready: {}",
                self.text()
            );
            let log = self.text();
            // A successful connection alone could be an unrelated process that
            // claimed a released reserved port. Require this child's announcement.
            if expected
                .iter()
                .all(|line| log.lines().any(|actual| actual == line))
            {
                return;
            }
            assert!(Instant::now() < deadline, "child startup timed out: {log}");
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }

    async fn rejected(&mut self) {
        let deadline = Instant::now() + STARTUP_LIMIT;
        loop {
            if let Some(status) = self.child.0.try_wait().unwrap() {
                let log = self.text();
                assert!(!status.success(), "invalid activation must fail startup");
                assert!(
                    log.to_lowercase().contains("multiview"),
                    "wrong rejection: {log}"
                );
                assert!(
                    !log.contains("cannot bind"),
                    "configuration must fail before binding: {log}"
                );
                assert!(
                    !log.contains("ottplay-server: http"),
                    "invalid configuration started a listener"
                );
                assert!(
                    !log.contains(TOKEN) && !log.contains(SIGNING),
                    "configuration leaked a secret"
                );
                return;
            }
            assert!(
                Instant::now() < deadline,
                "invalid activation did not terminate: {}",
                self.text()
            );
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }
}

fn reserve(count: usize) -> (Vec<TcpListener>, Vec<u16>) {
    let listeners: Vec<_> = (0..count)
        .map(|_| TcpListener::bind("127.0.0.1:0").unwrap())
        .collect();
    let ports = listeners
        .iter()
        .map(|s| s.local_addr().unwrap().port())
        .collect();
    (listeners, ports)
}

async fn absent(client: &Client, base: &str) {
    for (method, path) in [
        (Method::GET, CAPS),
        (Method::OPTIONS, CAPS),
        (Method::POST, "/multiview/v1/control"),
        (Method::GET, "/multiview/v1/media/untrusted/index.m3u8"),
        (Method::GET, "/multiview/v1/unknown"),
        (Method::OPTIONS, "/multiview/v1/unknown"),
    ] {
        let response = client
            .request(method, format!("{base}{path}"))
            .bearer_auth(TOKEN)
            .header("origin", NATIVE_ORIGIN)
            .header("x-forwarded-proto", "https")
            .header("forwarded", "proto=https;host=127.0.0.1")
            .header("access-control-request-method", "GET")
            .send()
            .await
            .unwrap();
        assert_eq!(
            response.status(),
            StatusCode::NOT_FOUND,
            "unexpected private path on {base}{path}"
        );
        assert_no_cors(&response);
    }
}

fn assert_no_cors(response: &reqwest::Response) {
    assert!(
        response
            .headers()
            .keys()
            .all(|name| !name.as_str().starts_with("access-control-")),
        "absent private paths must not inherit public asset CORS"
    );
}

async fn unknown_private_paths_absent(client: &Client, base: &str) {
    for method in [Method::GET, Method::POST, Method::OPTIONS] {
        let response = client
            .request(method, format!("{base}/multiview/v1/unknown"))
            .bearer_auth(TOKEN)
            .header("origin", NATIVE_ORIGIN)
            .header("access-control-request-method", "GET")
            .header("access-control-request-headers", "authorization")
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        assert_no_cors(&response);
    }
}

async fn capabilities(client: &Client, base: &str) -> Value {
    let response = client
        .get(format!("{base}{CAPS}"))
        .bearer_auth(TOKEN)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert!(response
        .headers()
        .get("access-control-allow-origin")
        .is_none());
    let value: Value = response.json().await.unwrap();
    assert_eq!(value["max_inputs"], 0);
    assert_eq!(value["qualified_input_adapters"], json!([]));
    assert_eq!(value["output_profiles"], json!([]));
    assert_eq!(value["server_id"], "activation_server_A");
    let text = value.to_string();
    assert!(!text.contains(TOKEN) && !text.contains(SIGNING));
    value
}

fn native_expected() -> Value {
    json!({"runtime":"native_runtime_A","expected":{"scene":"native_scene_A","layout_revision":"layout_A","focus_revision":"focus_A","audio_revision":"audio_A"},"slot_id":0,"slot_generation":"slot_A","source_revision":"source_A"})
}

fn context(epoch: &Value) -> Value {
    json!({"server_epoch":epoch,"session_id":"session_A","backend_expected":{"runtime":1,"scene":"backend_scene_A","geometry_revision":1,"focus_revision":1,"audio_revision":1},"native_expected":native_expected(),"backend_slot_revision":1})
}

#[tokio::test]
async fn no_flag_keeps_private_paths_absent_and_health_available() {
    let fixture = Fixture::new();
    let (held, ports) = reserve(1);
    let command = fixture.command(&ports, &[], None);
    drop(held);
    let mut server = Server::spawn(&fixture, command);
    server.ready(&ports, &[]).await;
    let client = fixture.client(false);
    let base = format!("http://127.0.0.1:{}", ports[0]);
    assert_eq!(
        client
            .get(format!("{base}/health"))
            .send()
            .await
            .unwrap()
            .text()
            .await
            .unwrap(),
        "OK"
    );
    absent(&client, &base).await;
}

#[tokio::test]
async fn valid_loopback_activation_is_authenticated_zero_capacity_and_cannot_play() {
    let fixture = Fixture::new();
    let (held, ports) = reserve(1);
    let config = fixture.config(ports[0], false);
    let command = fixture.command(&ports, &[], Some(&config));
    drop(held);
    let mut server = Server::spawn(&fixture, command);
    server.ready(&ports, &[]).await;
    let client = fixture.client(false);
    let base = format!("http://127.0.0.1:{}", ports[0]);
    let caps = capabilities(&client, &base).await;
    for bearer in [
        None,
        Some("unrelated_controller_bearer_aaaaaaaaaaaaaaaaaaaa"),
    ] {
        let mut request = client.get(format!("{base}{CAPS}"));
        if let Some(token) = bearer {
            request = request.bearer_auth(token);
        }
        assert_eq!(
            request.send().await.unwrap().status(),
            StatusCode::UNAUTHORIZED
        );
    }
    let mut duplicate = HeaderMap::new();
    duplicate.append("authorization", format!("Bearer {TOKEN}").parse().unwrap());
    duplicate.append("authorization", format!("Bearer {TOKEN}").parse().unwrap());
    assert_eq!(
        client
            .get(format!("{base}{CAPS}"))
            .headers(duplicate)
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::UNAUTHORIZED
    );
    let wrong = client
        .get(format!("{base}{CAPS}"))
        .bearer_auth(TOKEN)
        .header("origin", "https://unpaired.example.test")
        .send()
        .await
        .unwrap();
    assert_eq!(wrong.status(), StatusCode::FORBIDDEN);
    assert!(wrong.headers().get("access-control-allow-origin").is_none());
    let allowed = client
        .get(format!("{base}{CAPS}"))
        .bearer_auth(TOKEN)
        .header("origin", NATIVE_ORIGIN)
        .send()
        .await
        .unwrap();
    assert_eq!(allowed.status(), StatusCode::OK);
    assert_eq!(
        allowed.headers()["access-control-allow-origin"],
        NATIVE_ORIGIN
    );
    let binding = context(&caps["server_epoch"]);
    for (path, request) in [
        (
            "sources",
            json!({"version":1,"context":binding,"cursor":null}),
        ),
        (
            "control",
            json!({"version":1,"context":binding,"op":{"name":"play","input_grant":"synthetic_unissued_grant"}}),
        ),
        (
            "sessions",
            json!({"version":1,"server_epoch":caps["server_epoch"],"native_expected":native_expected(),"output_profile_id":"unqualified_profile","geometry":{"canvas":{"width":320,"height":180,"fps":5},"revision":1,"mode":"disjoint","rects":[{"slot_id":0,"x":0,"y":0,"width":320,"height":180,"z":0}]}}),
        ),
    ] {
        let response = client
            .post(format!("{base}/multiview/v1/{path}"))
            .bearer_auth(TOKEN)
            .header("x-request-id", format!("request_{path}"))
            .json(&request)
            .send()
            .await
            .unwrap();
        assert_eq!(
            response.status(),
            StatusCode::SERVICE_UNAVAILABLE,
            "capacity-zero {path}"
        );
    }
    let media = client
        .get(format!("{base}/multiview/v1/media/unissued/index.m3u8"))
        .bearer_auth(TOKEN)
        .send()
        .await
        .unwrap();
    assert!(!media.status().is_success());
    assert_eq!(capabilities(&client, &base).await["max_inputs"], 0);
}

#[tokio::test]
async fn selected_tls_listener_isolated_from_http_and_other_tls_ports() {
    let fixture = Fixture::new();
    fixture.certificates();
    let (held, ports) = reserve(3);
    let config = fixture.config(ports[1], true);
    let command = fixture.command(&ports[..1], &ports[1..], Some(&config));
    drop(held);
    let mut server = Server::spawn(&fixture, command);
    server.ready(&ports[..1], &ports[1..]).await;
    let client = fixture.client(true);
    capabilities(&client, &format!("https://127.0.0.1:{}", ports[1])).await;
    unknown_private_paths_absent(&client, &format!("https://127.0.0.1:{}", ports[1])).await;
    absent(&client, &format!("http://127.0.0.1:{}", ports[0])).await;
    absent(&client, &format!("https://127.0.0.1:{}", ports[2])).await;
    // A client without the synthetic root must reject the actual TLS handshake.
    assert!(fixture
        .client(false)
        .get(format!("https://127.0.0.1:{}/health", ports[1]))
        .send()
        .await
        .is_err());
}

#[tokio::test]
async fn explicit_loopback_http_selects_only_one_port() {
    let fixture = Fixture::new();
    let (held, ports) = reserve(2);
    let config = fixture.config(ports[0], false);
    let command = fixture.command(&ports, &[], Some(&config));
    drop(held);
    let mut server = Server::spawn(&fixture, command);
    server.ready(&ports, &[]).await;
    let client = fixture.client(false);
    capabilities(&client, &format!("http://127.0.0.1:{}", ports[0])).await;
    unknown_private_paths_absent(&client, &format!("http://127.0.0.1:{}", ports[0])).await;
    absent(&client, &format!("http://127.0.0.1:{}", ports[1])).await;
}

#[tokio::test]
async fn unsafe_configuration_rejected_before_reserved_port_bind() {
    let fixture = Fixture::new();
    let (_held, ports) = reserve(1);
    for case in [
        "malformed",
        "oversized",
        "unknown_source",
        "unknown_credential",
        "wrong_mode",
        "symlink",
        "relative",
        "public_tree",
        "missing",
    ] {
        let mut document = fixture.document(ports[0], false);
        if case == "unknown_source" {
            document["sources"] = json!([{"url":"http://127.0.0.1/private"}]);
        }
        if case == "unknown_credential" {
            document["credentials"][0]["permissions"] = json!(["sources_manage"]);
        }
        let path = match case {
            "malformed" => fixture.write("invalid.json", b"{ invalid private document"),
            "oversized" => fixture.write("oversized.json", &vec![b' '; 65_537]),
            "missing" => fixture.root.join("does-not-exist.json"),
            _ => fixture.write("operator.json", &serde_json::to_vec(&document).unwrap()),
        };
        let path = match case {
            "wrong_mode" => {
                fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
                path
            }
            "symlink" => {
                let alias = fixture.root.join("alias.json");
                symlink(&path, &alias).unwrap();
                alias
            }
            "relative" => PathBuf::from("../operator.json"),
            "public_tree" => {
                let exposed = fixture.public.join("exposed.json");
                fs::copy(&path, &exposed).unwrap();
                exposed
            }
            _ => path,
        };
        let mut server = Server::spawn(&fixture, fixture.command(&ports, &[], Some(&path)));
        server.rejected().await;
    }
}

#[tokio::test]
async fn invalid_listener_selection_rejected_before_bind() {
    let fixture = Fixture::new();
    let (_held, ports) = reserve(2);
    for case in [
        "missing_port",
        "wrong_scheme",
        "wildcard",
        "public_ip",
        "cleartext_lan",
    ] {
        let mut document = fixture.document(ports[0], false);
        match case {
            "missing_port" => document["origin"] = json!(format!("http://127.0.0.1:{}", ports[1])),
            "wrong_scheme" => document["listener"]["https"] = json!(true),
            "wildcard" => document["listener"]["bind_ip"] = json!("0.0.0.0"),
            "public_ip" => document["listener"]["bind_ip"] = json!("192.0.2.1"),
            "cleartext_lan" => {
                document["listener"]["bind_ip"] = json!("192.168.20.1");
                document["listener"]["lan_approved"] = json!(true);
            }
            _ => unreachable!(),
        }
        let path = fixture.write("operator.json", &serde_json::to_vec(&document).unwrap());
        let mut server = Server::spawn(&fixture, fixture.command(&ports[..1], &[], Some(&path)));
        server.rejected().await;
    }
}

#[tokio::test]
async fn incompatible_dedicated_modes_reject_opt_in_before_binding() {
    let fixture = Fixture::new();
    let (_held, ports) = reserve(1);
    let path = fixture.config(ports[0], false);
    for (key, value) in [
        ("OTT_OFFLINE_MEDIA_READONLY_PATHS", "/synthetic"),
        ("OTT_NORMALIZATION_ONLY", "1"),
        ("EPG_ONLY", "1"),
    ] {
        let mut command = fixture.command(&ports, &[], Some(&path));
        command.env(key, value);
        let mut server = Server::spawn(&fixture, command);
        server.rejected().await;
    }
    let mut command = fixture.command(&ports, &[], Some(&path));
    command
        .arg("--stalker-relay-only")
        .arg("--stalker-relay-config")
        .arg(fixture.root.join("unread-relay.json"));
    let mut server = Server::spawn(&fixture, command);
    server.rejected().await;
}

#[tokio::test]
async fn restart_issues_fresh_epoch_without_promoting_capacity() {
    let fixture = Fixture::new();
    let (held, ports) = reserve(2);
    drop(held);
    let client = fixture.client(false);
    let mut epochs = Vec::new();
    for port in ports {
        let path = fixture.config(port, false);
        let mut server = Server::spawn(&fixture, fixture.command(&[port], &[], Some(&path)));
        server.ready(&[port], &[]).await;
        let caps = capabilities(&client, &format!("http://127.0.0.1:{port}")).await;
        epochs.push(caps["server_epoch"].as_str().unwrap().to_owned());
        drop(server);
    }
    assert_ne!(epochs[0], epochs[1]);
}
