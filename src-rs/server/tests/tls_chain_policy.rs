//! Real binary startup/HTTPS checks with ephemeral, locally generated certificates.
use std::{
    fs,
    io::{Read, Write},
    net::TcpListener,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::atomic::{AtomicU64, Ordering},
    thread,
    time::{Duration, Instant},
};

static NEXT: AtomicU64 = AtomicU64::new(0);
struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "ottplay TLS chain {}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&path).unwrap();
        Self(path)
    }
    fn openssl(&self, args: &[&str]) {
        let output = Command::new("openssl")
            .args(args)
            .current_dir(&self.0)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "openssl {args:?}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    fn key(&self, name: &str, algorithm: &str) {
        let output = format!("{name}.key");
        let mut args = vec!["genpkey", "-out", &output, "-algorithm"];
        let option;
        if let Some(bits) = algorithm.strip_prefix("rsa:") {
            option = format!("rsa_keygen_bits:{bits}");
            args.extend(["RSA", "-pkeyopt", &option]);
        } else if let Some(curve) = algorithm.strip_prefix("ec:") {
            option = format!("ec_paramgen_curve:{curve}");
            args.extend(["EC", "-pkeyopt", &option]);
        } else if algorithm == "pss" {
            args.extend(["RSA-PSS", "-pkeyopt", "rsa_keygen_bits:2048"]);
        } else {
            args.push("ED25519");
        }
        self.openssl(&args);
    }
    fn sign(&self, name: &str, issuer: &str, ca: bool, serial: &str) {
        let key = format!("{name}.key");
        let csr = format!("{name}.csr");
        let cert = format!("{name}.pem");
        let issuer_cert = format!("{issuer}.pem");
        let issuer_key = format!("{issuer}.key");
        let extension = if ca {
            "basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n"
        } else {
            "basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=IP:127.0.0.1\n"
        };
        fs::write(self.0.join("sign.ext"), extension).unwrap();
        self.openssl(&[
            "req",
            "-new",
            "-key",
            &key,
            "-out",
            &csr,
            "-subj",
            &format!("/CN=Synthetic {name}"),
        ]);
        self.openssl(&[
            "x509",
            "-req",
            "-sha256",
            "-days",
            "1",
            "-in",
            &csr,
            "-CA",
            &issuer_cert,
            "-CAkey",
            &issuer_key,
            "-set_serial",
            serial,
            "-extfile",
            "sign.ext",
            "-out",
            &cert,
        ]);
    }
    fn certificates(&self, root: &str, intermediate: Option<&str>, leaf: &str) {
        self.key("root", root);
        fs::write(self.0.join("root.cnf"), "[req]\ndistinguished_name=dn\nx509_extensions=ca\nprompt=no\n[dn]\nCN=Synthetic root\n[ca]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n").unwrap();
        self.openssl(&[
            "req", "-new", "-x509", "-sha256", "-days", "1", "-key", "root.key", "-out",
            "root.pem", "-config", "root.cnf",
        ]);
        let issuer = if let Some(algorithm) = intermediate {
            self.key("intermediate", algorithm);
            self.sign("intermediate", "root", true, "2");
            "intermediate"
        } else {
            "root"
        };
        self.key("leaf", leaf);
        self.sign("leaf", issuer, false, "3");
        let mut chain = fs::read(self.0.join("leaf.pem")).unwrap();
        if intermediate.is_some() {
            chain.extend(fs::read(self.0.join("intermediate.pem")).unwrap());
        }
        // Deliberately include the root: only supplied certificates are in this policy's scope.
        chain.extend(fs::read(self.0.join("root.pem")).unwrap());
        fs::write(self.0.join("chain.pem"), chain).unwrap();
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
struct Server(Child);
impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn run_server(fixture: &Fixture, accepted: bool, case: &str) {
    let http = TcpListener::bind("127.0.0.1:0").unwrap();
    let https = TcpListener::bind("127.0.0.1:0").unwrap();
    let http_port = http.local_addr().unwrap().port();
    let tls_port = https.local_addr().unwrap().port();
    // Rejected chains must fail validation before attempting to bind either port.
    // Keep both reservations for that case: probing released ephemeral ports can
    // connect to an unrelated listener instead of the child under test.
    let _reservations = if accepted {
        drop((http, https));
        None
    } else {
        Some((http, https))
    };
    let log = fs::File::create(fixture.0.join("server.log")).unwrap();
    let mut server = Server(
        Command::new(env!("CARGO_BIN_EXE_ottplay-server"))
            .args([
                "--host",
                "127.0.0.1",
                "--port",
                &http_port.to_string(),
                "--https-port",
                &tls_port.to_string(),
                "--cert",
                "chain.pem",
                "--key",
                "leaf.key",
            ])
            .current_dir(&fixture.0)
            .env_clear()
            // Winsock loads system providers using SystemRoot on Windows.
            .envs(std::env::var_os("SystemRoot").map(|value| ("SystemRoot", value)))
            .env("EPG_URLS", "http://127.0.0.1:1/synthetic-unavailable")
            .stdout(log.try_clone().unwrap())
            .stderr(log)
            .spawn()
            .unwrap(),
    );
    let deadline = Instant::now() + Duration::from_secs(5);
    let readiness = format!("ottplay-server: https://127.0.0.1:{tls_port}");
    loop {
        if let Some(status) = server.0.try_wait().unwrap() {
            let message = fs::read_to_string(fixture.0.join("server.log")).unwrap();
            assert!(!accepted, "server rejected strong fixture: {message}");
            assert!(
                !status.success(),
                "server exited successfully for a rejected TLS fixture: {message}"
            );
            assert!(
                message.contains("TLS certificate"),
                "server must reject the certificate before binding reserved ports: {message}"
            );
            return;
        }
        // Only this child's post-bind announcement proves it owns the listener.
        // A raw TCP probe can connect to another owner of the released port.
        if accepted
            && fs::read_to_string(fixture.0.join("server.log"))
                .unwrap()
                .lines()
                .any(|line| line == readiness)
        {
            verified_health(&fixture.0, tls_port, case);
            return;
        }
        assert!(
            Instant::now() < deadline,
            "server did not {} within startup deadline: {}",
            if accepted {
                "start verified HTTPS"
            } else {
                "reject the TLS fixture before binding reserved ports"
            },
            fs::read_to_string(fixture.0.join("server.log")).unwrap()
        );
        thread::sleep(Duration::from_millis(10));
    }
}

fn read_prefix(path: &Path, limit: u64) -> std::io::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    fs::File::open(path)?.take(limit).read_to_end(&mut bytes)?;
    Ok(bytes)
}

fn client_diagnostics(path: &Path, case: &str) -> String {
    let stdout_path = path.join("client.stdout.log");
    let stdout = match (fs::metadata(&stdout_path), read_prefix(&stdout_path, 12)) {
        (Ok(metadata), Ok(prefix)) => format!(
            "{} bytes; HTTP 200 prefix: {}",
            metadata.len(),
            prefix.starts_with(b"HTTP/1.1 200")
        ),
        (Err(error), _) | (_, Err(error)) => format!("unavailable: {error}"),
    };
    let excerpt = |name: &str, limit: u64| match read_prefix(&path.join(name), limit) {
        Ok(bytes) => {
            let text = String::from_utf8_lossy(&bytes);
            // Starting at byte zero prevents exposing a PEM block's middle.
            text.split("-----BEGIN ").next().unwrap_or("").to_owned()
        }
        Err(error) => format!("unavailable: {error}"),
    };
    format!(
        "fixture: {case}\nclient stdout: {stdout}\nclient stderr (up to 2048 bytes, before any PEM):\n{}\nserver log (up to 8192 bytes, before any PEM):\n{}",
        excerpt("client.stderr.log", 2048),
        excerpt("server.log", 8192)
    )
}

fn verified_health(path: &Path, port: u16, case: &str) {
    // Files cannot back up an unread pipe while the parent waits for exit.
    let stdout = fs::File::create(path.join("client.stdout.log")).unwrap();
    let stderr = fs::File::create(path.join("client.stderr.log")).unwrap();
    let mut client = Command::new("openssl")
        .args([
            "s_client",
            "-quiet",
            "-connect",
            &format!("127.0.0.1:{port}"),
            "-CAfile",
            "root.pem",
            "-verify_ip",
            "127.0.0.1",
            "-verify_return_error",
        ])
        .current_dir(path)
        .stdin(Stdio::piped())
        .stdout(stdout)
        .stderr(stderr)
        .spawn()
        .unwrap();
    client
        .stdin
        .take()
        .unwrap()
        .write_all(b"GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    while client.try_wait().unwrap().is_none() {
        if Instant::now() >= deadline {
            let _ = client.kill();
            let _ = client.wait();
            panic!("HTTPS client timeout; {}", client_diagnostics(path, case));
        }
        thread::sleep(Duration::from_millis(10));
    }
    let status = client.wait().unwrap();
    let stdout = read_prefix(&path.join("client.stdout.log"), 12).unwrap();
    assert!(
        status.success(),
        "HTTPS verification failed: {status}\n{}",
        client_diagnostics(path, case)
    );
    assert!(
        stdout.starts_with(b"HTTP/1.1 200"),
        "Unexpected HTTPS response: {}",
        client_diagnostics(path, case)
    );
}

#[test]
fn client_diagnostics_are_useful_bounded_and_do_not_disclose_payloads() {
    let fixture = Fixture::new();
    let stdout = b"HTTP/1.1 200 OK\r\n\r\nPRIVATE_RESPONSE_BODY";
    fs::write(fixture.0.join("client.stdout.log"), stdout).unwrap();
    for (redacted_log, long_log) in [
        ("client.stderr.log", "server.log"),
        ("server.log", "client.stderr.log"),
    ] {
        fs::write(
            fixture.0.join(redacted_log),
            "before-pem\n-----BEGIN SYNTHETIC DATA-----\nPEM_PAYLOAD_SENTINEL\n-----END SYNTHETIC DATA-----\n",
        )
        .unwrap();
        fs::write(
            fixture.0.join(long_log),
            format!(
                "ordinary diagnostic\n{}LOG_TAIL_SENTINEL",
                "x".repeat(32768)
            ),
        )
        .unwrap();
        let report = client_diagnostics(&fixture.0, "synthetic formatter case");
        assert!(report.contains("synthetic formatter case"));
        assert!(report.contains(&format!("{} bytes", stdout.len())));
        assert!(report.contains("HTTP 200 prefix: true"));
        assert!(report.contains("before-pem"));
        assert!(report.contains("ordinary diagnostic"));
        for hidden in [
            "PRIVATE_RESPONSE_BODY",
            "PEM_PAYLOAD_SENTINEL",
            "LOG_TAIL_SENTINEL",
        ] {
            assert!(!report.contains(hidden), "diagnostic disclosed {hidden}");
        }
        assert!(
            report.len() < 16384,
            "failure diagnostics must stay bounded"
        );
    }
}

#[test]
fn weak_supplied_intermediate_and_root_fail_before_any_listener() {
    for (root, intermediate) in [
        ("rsa:2048", Some("rsa:1024")),
        ("rsa:1024", None),
        ("rsa:2048", Some("ec:prime192v1")),
        ("rsa:2048", Some("rsa:2047")),
    ] {
        let fixture = Fixture::new();
        fixture.certificates(root, intermediate, "rsa:2048");
        run_server(&fixture, false, "rejected fixture");
    }
}
#[test]
fn supported_strong_chains_still_serve_verified_https() {
    for intermediate in [None, Some("rsa:2048"), Some("ec:secp224r1"), Some("pss")] {
        let fixture = Fixture::new();
        fixture.certificates("rsa:2048", intermediate, "rsa:2048");
        run_server(
            &fixture,
            true,
            &format!("supported chain: intermediate={intermediate:?}"),
        );
    }
}
#[test]
fn supported_ec_and_ed25519_leaf_keys_still_serve_verified_https() {
    for leaf in ["ec:prime256v1", "ec:secp384r1", "ec:secp521r1", "ed25519"] {
        let fixture = Fixture::new();
        fixture.certificates("rsa:2048", None, leaf);
        run_server(&fixture, true, &format!("supported leaf: {leaf}"));
    }
}

#[test]
fn malformed_certificate_and_nested_key_structures_fail_before_listening() {
    use base64::{engine::general_purpose::STANDARD, Engine};
    use x509_cert::{
        der::{
            asn1::{Any, BitString},
            Decode, Encode,
        },
        Certificate,
    };
    let fixture = Fixture::new();
    fixture.certificates("rsa:2048", Some("rsa:2048"), "rsa:2048");
    fixture.openssl(&[
        "x509",
        "-in",
        "intermediate.pem",
        "-outform",
        "DER",
        "-out",
        "intermediate.der",
    ]);
    let original = fs::read(fixture.0.join("intermediate.der")).unwrap();
    let null = Any::from_der(&[5, 0]).unwrap();
    let mut cases = Vec::new();
    let mut trailing = original.clone();
    trailing.extend([5, 0]);
    cases.push(trailing);
    let mut fields = Vec::<Any>::from_der(&original).unwrap();
    fields.push(null.clone());
    cases.push(fields.to_der().unwrap());
    let mut fields = Vec::<Any>::from_der(&original).unwrap();
    let mut tbs = fields[0].decode_as::<Vec<Any>>().unwrap();
    // The generated v3 certificate has explicit version followed by its six required fields.
    let mut spki = tbs[6].decode_as::<Vec<Any>>().unwrap();
    spki.push(null.clone());
    tbs[6] = Any::encode_from(&spki).unwrap();
    fields[0] = Any::encode_from(&tbs).unwrap();
    cases.push(fields.to_der().unwrap());
    let mut certificate = Certificate::from_der(&original).unwrap();
    let key = &mut certificate
        .tbs_certificate
        .subject_public_key_info
        .subject_public_key;
    let mut rsa = Vec::<Any>::from_der(key.as_bytes().unwrap()).unwrap();
    rsa.push(null.clone());
    *key = BitString::from_bytes(&rsa.to_der().unwrap()).unwrap();
    cases.push(certificate.to_der().unwrap());
    let mut certificate = Certificate::from_der(&original).unwrap();
    certificate
        .tbs_certificate
        .subject_public_key_info
        .algorithm
        .parameters = Some(Any::encode_from(&1u8).unwrap());
    cases.push(certificate.to_der().unwrap());
    for certificate in cases {
        let pem = format!(
            "-----BEGIN CERTIFICATE-----\n{}\n-----END CERTIFICATE-----\n",
            STANDARD.encode(certificate)
        );
        let mut chain = fs::read(fixture.0.join("leaf.pem")).unwrap();
        chain.extend(pem.as_bytes());
        chain.extend(fs::read(fixture.0.join("root.pem")).unwrap());
        fs::write(fixture.0.join("chain.pem"), chain).unwrap();
        run_server(&fixture, false, "rejected fixture");
    }
}
