//! Loopback-only TLS tests. Each test generates an ephemeral certificate/key.
use reqwest::ClientBuilder;
use std::{
    error::Error as _,
    io::{Read, Write},
    net::TcpListener,
    sync::Arc,
    thread,
    time::{Duration, Instant},
};

include!(concat!(env!("OUT_DIR"), "/tls_policy.rs"));

struct Server {
    port: u16,
    certificate: reqwest::Certificate,
    #[cfg(feature = "rustls-tls")]
    certificate_der: rustls::pki_types::CertificateDer<'static>,
    handle: thread::JoinHandle<bool>,
}

fn server() -> Server {
    let certificate = rcgen::generate_simple_self_signed(vec!["localhost".into()]).unwrap();
    let trusted = reqwest::Certificate::from_der(certificate.cert.der()).unwrap();
    let config = rustls::ServerConfig::builder_with_provider(Arc::new(
        rustls::crypto::ring::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .unwrap()
    .with_no_client_auth()
    .with_single_cert(
        vec![certificate.cert.der().clone()],
        rustls::pki_types::PrivatePkcs8KeyDer::from(certificate.signing_key.serialize_der()).into(),
    )
    .unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let port = listener.local_addr().unwrap().port();
    let handle = thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(8);
        let socket = loop {
            match listener.accept() {
                Ok((socket, _)) => break socket,
                Err(e)
                    if e.kind() == std::io::ErrorKind::WouldBlock && Instant::now() < deadline =>
                {
                    thread::sleep(Duration::from_millis(10));
                }
                Err(_) => return false,
            }
        };
        socket.set_nonblocking(false).unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        socket
            .set_write_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let session = rustls::ServerConnection::new(Arc::new(config)).unwrap();
        let mut stream = rustls::StreamOwned::new(session, socket);
        let mut request = [0; 4096];
        match stream.read(&mut request) {
            Ok(count) if count > 0 => stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok")
                .is_ok(),
            _ => false,
        }
    });
    Server {
        port,
        certificate: trusted,
        #[cfg(feature = "rustls-tls")]
        certificate_der: certificate.cert.der().clone(),
        handle,
    }
}

fn client() -> ClientBuilder {
    let _ = rustls::crypto::ring::default_provider().install_default();
    reqwest::Client::builder()
        .resolve("localhost", ([127, 0, 0, 1], 0).into())
        .no_proxy()
        .timeout(Duration::from_secs(6))
}

fn error_chain(error: &reqwest::Error) -> String {
    let mut text = error.to_string();
    let mut source = error.source();
    while let Some(error) = source {
        text.push_str(&format!(": {error}"));
        source = error.source();
    }
    text
}

#[tokio::test]
async fn accepts_a_trusted_certificate_for_its_valid_hostname() {
    let fixture = server();
    let client = enforce_tls_verification(client().add_root_certificate(fixture.certificate))
        .build()
        .unwrap();
    let response = client
        .get(format!("https://localhost:{}/", fixture.port))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    assert_eq!(response.text().await.unwrap(), "ok");
    assert!(fixture.handle.join().unwrap());
}

#[tokio::test]
async fn rejects_an_untrusted_certificate() {
    let fixture = server();
    let client = enforce_tls_verification(client()).build().unwrap();
    let error = client
        .get(format!("https://localhost:{}/", fixture.port))
        .send()
        .await
        .unwrap_err();
    let detail = error_chain(&error);
    assert!(
        detail.contains("invalid peer certificate"),
        "unexpected failure: {detail}"
    );
    assert!(!fixture.handle.join().unwrap());
}

#[tokio::test]
async fn rejects_a_trusted_certificate_for_the_wrong_hostname() {
    let fixture = server();
    let client = enforce_tls_verification(client().add_root_certificate(fixture.certificate))
        .build()
        .unwrap();
    let error = client
        .get(format!("https://127.0.0.1:{}/", fixture.port))
        .send()
        .await
        .unwrap_err();
    let detail = error_chain(&error);
    assert!(
        detail.contains("invalid peer certificate"),
        "unexpected failure: {detail}"
    );
    assert!(!fixture.handle.join().unwrap());
}

#[cfg(feature = "rustls-tls")]
#[tokio::test]
async fn rejects_a_callback_preconfigured_tls_connector() {
    let fixture = server();
    let mut roots = rustls::RootCertStore::empty();
    roots.add(fixture.certificate_der.clone()).unwrap();
    let custom = rustls::ClientConfig::builder_with_provider(Arc::new(
        rustls::crypto::ring::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .unwrap()
    .with_root_certificates(roots)
    .with_no_client_auth();
    // This callback connector trusts the fixture, but the regular client does not.
    // The hardened policy must restore the regular verifier, not this connector.
    let client = enforce_tls_verification(client().tls_backend_preconfigured(custom))
        .build()
        .unwrap();
    let error = client
        .get(format!("https://localhost:{}/", fixture.port))
        .send()
        .await
        .unwrap_err();
    let detail = error_chain(&error);
    assert!(
        detail.contains("invalid peer certificate"),
        "unexpected failure: {detail}"
    );
    assert!(!fixture.handle.join().unwrap());
}
