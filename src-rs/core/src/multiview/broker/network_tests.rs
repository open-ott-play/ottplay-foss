use super::super::resolvers::{Adapter, ServerSource};
use super::*;
use reqwest::header::HeaderValue;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
};

fn transport(origins: &[&str]) -> CheckedTransport {
    CheckedTransport::new(
        NetworkPolicy::new(
            origins
                .iter()
                .map(|o| OriginRule::new(o, &[]).unwrap())
                .collect(),
        )
        .unwrap(),
        Limits::default(),
    )
    .unwrap()
}
fn manifest(url: &str, body: &str) -> Fetched {
    Fetched {
        url: address(url).unwrap(),
        bytes: body.as_bytes().to_vec(),
        content_type: "application/vnd.apple.mpegurl".into(),
        peer: None,
        provenance: None,
    }
}
#[test]
fn private_approval_is_exact_origin_and_all_dns_answers_must_pass() {
    let private: IpAddr = "192.168.2.4".parse().unwrap();
    let policy = NetworkPolicy::new(vec![OriginRule::new(
        "https://media.example:8443",
        &[private],
    )
    .unwrap()])
    .unwrap();
    let url = address("https://media.example:8443/video").unwrap();
    assert!(policy
        .approve(&url, &[SocketAddr::new(private, 8443)])
        .is_ok());
    assert_eq!(
        policy.approve(&url, &["192.168.2.5:8443".parse().unwrap()]),
        Err(Error::DestinationDenied)
    );
    assert_eq!(
        policy.approve(
            &url,
            &[
                "8.8.8.8:8443".parse().unwrap(),
                "127.0.0.1:8443".parse().unwrap()
            ]
        ),
        Err(Error::DestinationDenied)
    );
    assert_eq!(
        policy.approve(
            &address("https://other.example:8443/video").unwrap(),
            &[SocketAddr::new(private, 8443)]
        ),
        Err(Error::DestinationDenied)
    );
    for ip in [
        "127.0.0.1",
        "169.254.169.254",
        "::1",
        "fe80::1",
        "::ffff:192.168.2.4",
    ] {
        assert!(OriginRule::new("https://media.example", &[ip.parse().unwrap()]).is_err());
    }
}
#[test]
fn headers_and_addresses_cannot_override_transport_policy() {
    for url in [
        "file:///tmp/video",
        "https://u:p@media.example/video",
        "https://media.example/video#secret",
        "https://media.example/vi deo",
    ] {
        assert!(address(url).is_err());
    }
    let mut headers = HeaderMap::new();
    headers.insert(reqwest::header::HOST, HeaderValue::from_static("127.0.0.1"));
    assert!(OriginCredentials::new("https://media.example", headers).is_err());
    let mut headers = HeaderMap::new();
    headers.insert(ACCEPT, HeaderValue::from_static("text/html"));
    assert!(OriginCredentials::new("https://media.example", headers).is_err());
    let mut headers = HeaderMap::new();
    headers.insert(AUTHORIZATION, HeaderValue::from_static("Bearer private"));
    let credentials = OriginCredentials::new("https://media.example", headers).unwrap();
    assert!(!credentials
        .for_url(&address("https://media.example/path").unwrap())
        .is_empty());
    assert!(credentials
        .for_url(&address("https://cdn.example/path").unwrap())
        .is_empty());
    assert!(credentials
        .for_url(&address("http://media.example/path").unwrap())
        .is_empty());
}
#[test]
fn realistic_master_and_media_tags_preserve_every_resource_check() {
    let transport = transport(&["https://media.example", "https://cdn.example"]);
    let master = manifest("https://media.example/master.m3u8", "#EXTM3U\n#EXT-X-VERSION:6\n#EXT-X-INDEPENDENT-SEGMENTS\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"audio\",NAME=\"English\",URI=\"audio/list.m3u8\"\n#EXT-X-STREAM-INF:BANDWIDTH=1000000,AUDIO=\"audio\"\nhttps://cdn.example/video.m3u8\n");
    let parsed = HlsManifest::parse(&master, &transport).unwrap();
    assert_eq!(parsed.resources.len(), 2);
    assert!(parsed
        .resources
        .iter()
        .all(|r| r.kind == ResourceKind::Playlist));
    let media = manifest("https://media.example/media.m3u8", "#EXTM3U\n#EXT-X-VERSION:6\n#EXT-X-TARGETDURATION:10\n#EXT-X-MEDIA-SEQUENCE:4\n#EXT-X-KEY:METHOD=AES-128,URI=\"key.bin\"\n#EXT-X-MAP:URI=\"init.mp4\"\n#EXTINF:10,\nsegment.ts\n#EXT-X-ENDLIST\n");
    let parsed = HlsManifest::parse(&media, &transport).unwrap();
    assert_eq!(
        parsed.resources.iter().map(|r| r.kind).collect::<Vec<_>>(),
        vec![ResourceKind::Key, ResourceKind::Map, ResourceKind::Segment]
    );
    assert!(parsed.ended);
}
#[test]
fn private_hls_children_unknown_features_and_resource_budgets_fail_closed() {
    let transport = transport(&["https://media.example"]);
    for body in [
        "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"http://media.example/key\"\n",
        "#EXTM3U\n#EXT-X-MAP:URI=\"https://other.example/init\"\n",
        "#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,URI=\"file:///tmp/private\"\n",
        "#EXTM3U\n#EXT-X-SESSION-DATA:DATA-ID=\"x\",URI=\"https://media.example/private\"\n",
        "#EXTM3U\n#EXT-X-DEFINE:NAME=\"x\",VALUE=\"secret\"\n",
        "#EXTM3U\n#EXT-X-MAP:URI=\"a\",URI=\"b\"\n",
        "#EXTM3U\n#EXT-X-BYTERANGE:10@0\nsegment.ts\n",
        "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\n",
    ] {
        assert!(
            HlsManifest::parse(&manifest("https://media.example/a.m3u8", body), &transport)
                .is_err()
        );
    }
    let body = format!("#EXTM3U\n{}", "#EXTINF:1,\nsegment.ts\n".repeat(129));
    assert!(matches!(
        HlsManifest::parse(&manifest("https://media.example/a.m3u8", &body), &transport),
        Err(Error::TooLarge)
    ));
    let both = self::transport(&["https://media.example", "https://cdn.example"]);
    assert!(matches!(
        HlsManifest::parse(
            &manifest(
                "https://media.example/a.m3u8?token=secret",
                "#EXTM3U\n#EXTINF:1,\nhttps://cdn.example/segment.ts\n"
            ),
            &both
        ),
        Err(Error::DestinationDenied)
    ));
}
#[tokio::test]
async fn cancellation_and_enrollment_denial_happen_without_io() {
    let transport = transport(&["https://media.example"]);
    let cancel = CancellationToken::new();
    cancel.cancel();
    assert!(matches!(
        transport
            .get("https://media.example/video", None, &cancel)
            .await,
        Err(Error::Cancelled)
    ));
    assert!(matches!(
        transport
            .get("http://127.0.0.1/video", None, &CancellationToken::new())
            .await,
        Err(Error::DestinationDenied)
    ));
    assert!(ServerSource::vportal(
        "https://media.example/nas/api",
        "key",
        serde_json::json!({"request":{"app":"other"}})
    )
    .is_err());
    let source = ServerSource::http("https://media.example/video", None).unwrap();
    assert_eq!(source.adapter(), Adapter::Http);
    assert!(!source.qualifies_live_decoder());
}

// All sockets below are freshly owned ephemeral loopback fixtures, enabled by a
// test-only policy unavailable to production enrollment. No live source probes.
async fn fixture() -> (TcpListener, String) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    (listener, base)
}
async fn read_request(stream: &mut TcpStream) -> String {
    let mut bytes = Vec::new();
    let mut buffer = [0u8; 1024];
    loop {
        let count = tokio::time::timeout(Duration::from_secs(2), stream.read(&mut buffer))
            .await
            .unwrap()
            .unwrap();
        assert_ne!(count, 0);
        bytes.extend_from_slice(&buffer[..count]);
        assert!(bytes.len() <= 65536);
        if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
            let text = std::str::from_utf8(&bytes[..end]).unwrap();
            let length = text
                .lines()
                .find_map(|line| {
                    line.to_ascii_lowercase()
                        .strip_prefix("content-length:")
                        .map(|n| n.trim().parse::<usize>().unwrap())
                })
                .unwrap_or(0);
            if bytes.len() >= end + 4 + length {
                return String::from_utf8(bytes).unwrap();
            }
        }
    }
}
async fn respond(stream: &mut TcpStream, status: &str, headers: &str, body: &str) {
    let response = format!(
        "HTTP/1.1 {status}\r\nConnection: close\r\nContent-Length: {}\r\n{headers}\r\n{body}",
        body.len()
    );
    stream.write_all(response.as_bytes()).await.unwrap();
}
fn fixture_transport(origins: &[&str]) -> CheckedTransport {
    CheckedTransport::new(
        NetworkPolicy::fixture(origins),
        Limits {
            timeout: Duration::from_secs(2),
            ..Limits::default()
        },
    )
    .unwrap()
}
#[tokio::test]
async fn redirect_strips_provider_auth_at_other_explicitly_enrolled_origin() {
    let (first, first_base) = fixture().await;
    let (second, second_base) = fixture().await;
    let target = format!("{second_base}/video");
    let a = tokio::spawn(async move {
        let (mut socket, _) = first.accept().await.unwrap();
        let request = read_request(&mut socket).await;
        assert!(request.contains("Bearer test-secret"));
        respond(
            &mut socket,
            "302 Found",
            &format!("Location: {target}\r\n"),
            "",
        )
        .await;
    });
    let b = tokio::spawn(async move {
        let (mut socket, _) = second.accept().await.unwrap();
        let request = read_request(&mut socket).await;
        assert!(!request.to_ascii_lowercase().contains("authorization:"));
        respond(&mut socket, "200 OK", "", "data").await;
    });
    let mut headers = HeaderMap::new();
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_static("Bearer test-secret"),
    );
    let credentials = OriginCredentials::new(&first_base, headers).unwrap();
    let transport = fixture_transport(&[&first_base, &second_base]);
    let result = transport
        .get(
            &format!("{first_base}/start"),
            Some(&credentials),
            &CancellationToken::new(),
        )
        .await
        .unwrap();
    assert_eq!(result.bytes(), b"data");
    a.await.unwrap();
    b.await.unwrap();
}
#[tokio::test]
async fn bounded_body_keeps_request_admission_until_response_finishes() {
    let (listener, base) = fixture().await;
    let (ready, observed) = tokio::sync::oneshot::channel();
    let (release, released) = tokio::sync::oneshot::channel();
    let fixture = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        read_request(&mut socket).await;
        socket
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\n\r\nx")
            .await
            .unwrap();
        ready.send(()).unwrap();
        released.await.unwrap();
        socket.write_all(b"abc").await.unwrap();
    });
    let transport = CheckedTransport::new(
        NetworkPolicy::fixture(&[&base]),
        Limits {
            concurrent: 1,
            timeout: Duration::from_secs(2),
            ..Limits::default()
        },
    )
    .unwrap();
    let first = {
        let transport = transport.clone();
        let url = format!("{base}/a");
        tokio::spawn(async move { transport.get(&url, None, &CancellationToken::new()).await })
    };
    observed.await.unwrap();
    assert!(matches!(
        transport
            .get(&format!("{base}/b"), None, &CancellationToken::new())
            .await,
        Err(Error::Busy)
    ));
    release.send(()).unwrap();
    assert_eq!(first.await.unwrap().unwrap().bytes(), b"xabc");
    fixture.await.unwrap();
}
#[tokio::test]
async fn cancelled_vportal_creation_reconciles_returned_lease_before_reporting() {
    let (listener, base) = fixture().await;
    let endpoint = format!("{base}/nas/api");
    let stop = format!("{base}/nas/stream/id.secret/media.stop");
    let media = format!("{base}/media");
    let (sent, received) = tokio::sync::oneshot::channel();
    let (release, released) = tokio::sync::oneshot::channel();
    let fixture = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let request = read_request(&mut socket).await;
        assert!(request.starts_with("POST /nas/api "));
        assert!(request.contains("\"app\":\"ott-play\""));
        sent.send(()).unwrap();
        released.await.unwrap();
        respond(&mut socket, "200 OK", "Content-Type: application/json\r\n", &serde_json::json!({"url":media,"stop":stop,"heartbeat":"https://unapproved.invalid/heartbeat"}).to_string()).await;
        let (mut socket, _) = tokio::time::timeout(Duration::from_secs(2), listener.accept())
            .await
            .unwrap()
            .unwrap();
        let request = read_request(&mut socket).await;
        assert!(request.starts_with("GET /nas/stream/id.secret/media.stop "));
        respond(&mut socket, "200 OK", "", "stopped").await;
    });
    let source = ServerSource::vportal(
        &endpoint,
        "owned-fixture-key",
        serde_json::json!({"id":"7"}),
    )
    .unwrap();
    let transport = fixture_transport(&[&base]);
    let cancel = CancellationToken::new();
    let resolving = {
        let token = cancel.clone();
        tokio::spawn(async move { source.resolve(&transport, &token).await })
    };
    received.await.unwrap();
    cancel.cancel();
    release.send(()).unwrap();
    assert!(matches!(resolving.await.unwrap(), Err(Error::Cancelled)));
    fixture.await.unwrap();
}

async fn prepared_vportal_stop_fixture() -> (
    CheckedTransport,
    super::super::resolvers::PreparedSource,
    TcpListener,
) {
    let (listener, base) = fixture().await;
    let transport = CheckedTransport::new(
        NetworkPolicy::fixture(&[&base]),
        Limits {
            concurrent: 1,
            timeout: Duration::from_secs(2),
            ..Limits::default()
        },
    )
    .unwrap();
    let source = ServerSource::vportal(
        &format!("{base}/nas/api"),
        "fixture-key",
        serde_json::json!({"id":"7"}),
    )
    .unwrap();
    let cancel = CancellationToken::new();
    let provider = async {
        let (mut socket, _) = listener.accept().await.unwrap();
        assert!(read_request(&mut socket)
            .await
            .starts_with("POST /nas/api "));
        respond(
            &mut socket,
            "200 OK",
            "Content-Type: application/json\r\n",
            &serde_json::json!({
                "url": format!("{base}/media"),
                "stop": format!("{base}/nas/stream/id.secret/media.stop"),
            })
            .to_string(),
        )
        .await;
    };
    let (prepared, ()) = tokio::time::timeout(Duration::from_secs(3), async {
        tokio::join!(source.resolve(&transport, &cancel), provider)
    })
    .await
    .unwrap();
    (transport, prepared.unwrap(), listener)
}

#[tokio::test]
async fn mandatory_stop_waits_for_late_request_admission_and_is_sent_once() {
    let (transport, prepared, listener) = prepared_vportal_stop_fixture().await;
    // Model a cancelled blocking DNS worker retaining the actual request permit.
    let held = transport.permits.clone().try_acquire_owned().unwrap();
    let finish = prepared.finish();
    tokio::pin!(finish);
    assert!(
        tokio::time::timeout(Duration::from_millis(400), finish.as_mut())
            .await
            .is_err()
    );
    assert_eq!(transport.sources.available_permits(), 0);
    assert_eq!(transport.permits.available_permits(), 0);
    assert!(
        tokio::time::timeout(Duration::from_millis(50), listener.accept())
            .await
            .is_err()
    );
    drop(held);

    let provider = async {
        let (mut socket, _) = listener.accept().await.unwrap();
        assert!(read_request(&mut socket)
            .await
            .starts_with("GET /nas/stream/id.secret/media.stop "));
        assert_eq!(transport.sources.available_permits(), 0);
        respond(&mut socket, "200 OK", "", "stopped").await;
        assert!(
            tokio::time::timeout(Duration::from_millis(100), listener.accept())
                .await
                .is_err()
        );
    };
    let (result, ()) = tokio::time::timeout(Duration::from_secs(3), async {
        tokio::join!(finish.as_mut(), provider)
    })
    .await
    .unwrap();
    assert_eq!(result, Ok(()));
    assert_eq!(transport.sources.available_permits(), 1);
    assert_eq!(transport.permits.available_permits(), 1);
}

#[tokio::test]
async fn mandatory_stop_permanent_busy_uses_existing_deadline_without_io() {
    let (transport, prepared, listener) = prepared_vportal_stop_fixture().await;
    let held = transport.permits.clone().try_acquire_owned().unwrap();
    let started = tokio::time::Instant::now();
    let result = tokio::time::timeout(Duration::from_secs(12), prepared.finish())
        .await
        .expect("cleanup must retain its ten-second outer deadline");
    assert_eq!(result, Err(Error::CleanupUnconfirmed));
    assert!(started.elapsed() >= Duration::from_secs(10));
    assert_eq!(transport.permits.available_permits(), 0);
    assert_eq!(transport.sources.available_permits(), 1);
    assert!(
        tokio::time::timeout(Duration::from_millis(100), listener.accept())
            .await
            .is_err()
    );
    drop(held);
    assert_eq!(transport.permits.available_permits(), 1);
    assert!(
        tokio::time::timeout(Duration::from_millis(100), listener.accept())
            .await
            .is_err()
    );
}

#[tokio::test]
async fn mandatory_stop_unconfirmed_response_is_never_repeated() {
    for rejected in [false, true] {
        let (transport, prepared, listener) = prepared_vportal_stop_fixture().await;
        let provider = async {
            let (mut socket, _) = listener.accept().await.unwrap();
            assert!(read_request(&mut socket)
                .await
                .starts_with("GET /nas/stream/id.secret/media.stop "));
            assert_eq!(transport.sources.available_permits(), 0);
            if rejected {
                respond(&mut socket, "500 Error", "", "").await;
            } else {
                // The command reached the provider, but its response is incomplete.
                socket
                    .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 8\r\n\r\nx")
                    .await
                    .unwrap();
            }
            drop(socket);
            assert!(
                tokio::time::timeout(Duration::from_millis(100), listener.accept())
                    .await
                    .is_err()
            );
        };
        let (result, ()) = tokio::time::timeout(Duration::from_secs(3), async {
            tokio::join!(prepared.finish(), provider)
        })
        .await
        .unwrap();
        assert_eq!(result, Err(Error::CleanupUnconfirmed));
        assert_eq!(transport.sources.available_permits(), 1);
        assert_eq!(transport.permits.available_permits(), 1);
        assert!(
            tokio::time::timeout(Duration::from_millis(100), listener.accept())
                .await
                .is_err()
        );
    }
}

#[tokio::test]
async fn plex_resolves_only_enrolled_machine_and_exact_part_with_private_headers() {
    let (listener, base) = fixture().await;
    let fixture = tokio::spawn(async move {
        for (path, body) in [
            ("/identity", serde_json::json!({"MediaContainer":{"machineIdentifier":"machineA"}}).to_string()),
            ("/library/metadata/7", serde_json::json!({"MediaContainer":{"Metadata":[{"ratingKey":"7","type":"movie","Media":[{"Part":[{"key":"/library/parts/12/1/file.mp4"}]}]}]}}).to_string()),
            ("/library/parts/12/1/file.mp4", "finite-media".to_owned()),
        ] {
            let (mut socket, _) = listener.accept().await.unwrap();
            let request = read_request(&mut socket).await;
            assert!(request.starts_with(&format!("GET {path} HTTP/1.1")));
            let lower = request.to_ascii_lowercase();
            if path == "/identity" { assert!(!lower.contains("x-plex-token:")); }
            else { assert!(lower.contains("x-plex-token: owned-fixture-token")); }
            assert!(lower.contains("accept: application/json"));
            assert!(!request.lines().next().unwrap().contains("token"));
            respond(&mut socket, "200 OK", "Content-Type: application/json\r\n", &body).await;
        }
    });
    let source = ServerSource::plex(&base, "machineA", "owned-fixture-token", "7").unwrap();
    let transport = fixture_transport(&[&base]);
    let prepared = source
        .resolve(&transport, &CancellationToken::new())
        .await
        .unwrap();
    assert_eq!(prepared.adapter(), Adapter::PlexDirect);
    assert_eq!(
        prepared.fetch_root().await.unwrap().bytes(),
        b"finite-media"
    );
    prepared.finish().await.unwrap();
    fixture.await.unwrap();
}

#[tokio::test]
async fn plex_wrong_machine_and_ambiguous_or_malformed_parts_never_reach_media() {
    for case in 0..4 {
        let (listener, base) = fixture().await;
        let fixture = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            read_request(&mut socket).await;
            respond(&mut socket, "200 OK", "", &serde_json::json!({"MediaContainer":{"machineIdentifier":if case == 0 {"otherMachine"} else {"machineA"}}}).to_string()).await;
            if case == 0 {
                return;
            }
            let (mut socket, _) = listener.accept().await.unwrap();
            read_request(&mut socket).await;
            let parts = match case {
                1 => {
                    serde_json::json!([{"key":"/library/parts/12/1/file.mp4"},{"key":"/library/parts/13/1/file.mp4"}])
                }
                2 => serde_json::json!([{"key":"/library/parts/12//file.mp4"}]),
                _ => serde_json::json!([{"key":"/library/parts/12/1/file.mp4?token=foreign"}]),
            };
            let body = serde_json::json!({"MediaContainer":{"Metadata":[{"ratingKey":"7","type":"movie","Media":[{"Part":parts}]}]}});
            respond(&mut socket, "200 OK", "", &body.to_string()).await;
        });
        let source = ServerSource::plex(&base, "machineA", "owned-fixture-token", "7").unwrap();
        let result = source
            .resolve(&fixture_transport(&[&base]), &CancellationToken::new())
            .await;
        assert!(matches!(
            result,
            Err(Error::InvalidResponse | Error::Unsupported)
        ));
        fixture.await.unwrap();
    }
}

#[tokio::test]
async fn provider_error_still_closes_allocated_session_and_reports_failed_stop_honestly() {
    for stop_succeeds in [true, false] {
        let (listener, base) = fixture().await;
        let stop = format!("{base}/nas/stream/id.secret/media.stop");
        let fixture = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            read_request(&mut socket).await;
            respond(
                &mut socket,
                "200 OK",
                "",
                &serde_json::json!({"type":"error","stop":stop}).to_string(),
            )
            .await;
            let (mut socket, _) = listener.accept().await.unwrap();
            assert!(read_request(&mut socket)
                .await
                .starts_with("GET /nas/stream/id.secret/media.stop "));
            respond(
                &mut socket,
                if stop_succeeds { "200 OK" } else { "500 Error" },
                "",
                "",
            )
            .await;
        });
        let source = ServerSource::vportal(
            &format!("{base}/nas/api"),
            "fixture-key",
            serde_json::json!({"id":"7"}),
        )
        .unwrap();
        let result = source
            .resolve(&fixture_transport(&[&base]), &CancellationToken::new())
            .await;
        assert!(
            matches!(result, Err(error) if error == if stop_succeeds { Error::InvalidResponse } else { Error::CleanupUnconfirmed })
        );
        fixture.await.unwrap();
    }
}

#[tokio::test]
async fn malformed_allocating_response_never_claims_cleanup_or_retries() {
    let (listener, base) = fixture().await;
    let fixture = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        read_request(&mut socket).await;
        respond(&mut socket, "200 OK", "", "{truncated-provider-response").await;
    });
    let source = ServerSource::vportal(
        &format!("{base}/nas/api"),
        "fixture-key",
        serde_json::json!({"id":"7"}),
    )
    .unwrap();
    assert!(matches!(
        source
            .resolve(&fixture_transport(&[&base]), &CancellationToken::new())
            .await,
        Err(Error::CleanupUnconfirmed)
    ));
    fixture.await.unwrap();
}

#[tokio::test]
async fn oversized_response_drops_body_and_releases_request_permit() {
    let (listener, base) = fixture().await;
    let fixture = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        read_request(&mut socket).await;
        respond(&mut socket, "200 OK", "", "oversized").await;
    });
    let transport = CheckedTransport::new(
        NetworkPolicy::fixture(&[&base]),
        Limits {
            body_bytes: 4,
            concurrent: 1,
            ..Limits::default()
        },
    )
    .unwrap();
    assert!(matches!(
        transport
            .get(&format!("{base}/a"), None, &CancellationToken::new())
            .await,
        Err(Error::TooLarge)
    ));
    assert_eq!(transport.permits.available_permits(), 1);
    fixture.await.unwrap();
}

#[tokio::test]
async fn plex_attestation_cannot_move_to_other_enrolled_origin() {
    for redirect_metadata in [false, true] {
        let (primary, base) = fixture().await;
        let (foreign, foreign_base) = fixture().await;
        let target = format!("{foreign_base}/forged");
        let a = tokio::spawn(async move {
            let (mut socket, _) = primary.accept().await.unwrap();
            read_request(&mut socket).await;
            if redirect_metadata {
                respond(
                    &mut socket,
                    "200 OK",
                    "",
                    &serde_json::json!({"MediaContainer":{"machineIdentifier":"machineA"}})
                        .to_string(),
                )
                .await;
                let (next, _) = primary.accept().await.unwrap();
                socket = next;
                read_request(&mut socket).await;
            }
            respond(
                &mut socket,
                "302 Found",
                &format!("Location: {target}\r\n"),
                "",
            )
            .await;
        });
        let b = tokio::spawn(async move {
            let (mut socket, _) = foreign.accept().await.unwrap();
            let request = read_request(&mut socket).await;
            assert!(!request.to_ascii_lowercase().contains("x-plex-token:"));
            let body = if redirect_metadata {
                serde_json::json!({"MediaContainer":{"Metadata":[{"ratingKey":"7","type":"movie","Media":[{"Part":[{"key":"/library/parts/12/1/file.mp4"}]}]}]}})
            } else {
                serde_json::json!({"MediaContainer":{"machineIdentifier":"machineA"}})
            };
            respond(&mut socket, "200 OK", "", &body.to_string()).await;
        });
        let source = ServerSource::plex(&base, "machineA", "owned-fixture-token", "7").unwrap();
        assert!(matches!(
            source
                .resolve(
                    &fixture_transport(&[&base, &foreign_base]),
                    &CancellationToken::new()
                )
                .await,
            Err(Error::DestinationDenied)
        ));
        a.await.unwrap();
        b.await.unwrap();
    }
}

#[tokio::test]
async fn lifecycle_redirect_never_follows_or_claims_confirmed_cleanup() {
    let (listener, base) = fixture().await;
    let stop = format!("{base}/nas/stream/id.secret/media.stop");
    let fixture = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        read_request(&mut socket).await;
        respond(
            &mut socket,
            "200 OK",
            "",
            &serde_json::json!({"type":"error","stop":stop}).to_string(),
        )
        .await;
        let (mut socket, _) = listener.accept().await.unwrap();
        assert!(read_request(&mut socket)
            .await
            .starts_with("GET /nas/stream/id.secret/media.stop "));
        respond(
            &mut socket,
            "302 Found",
            "Location: /unrelated-success\r\n",
            "",
        )
        .await;
        assert!(
            tokio::time::timeout(Duration::from_millis(100), listener.accept())
                .await
                .is_err()
        );
    });
    let source = ServerSource::vportal(
        &format!("{base}/nas/api"),
        "fixture-key",
        serde_json::json!({"id":"7"}),
    )
    .unwrap();
    assert!(matches!(
        source
            .resolve(&fixture_transport(&[&base]), &CancellationToken::new())
            .await,
        Err(Error::CleanupUnconfirmed)
    ));
    fixture.await.unwrap();
}

async fn vportal_reply_then_finish(
    reply: impl FnOnce(&str) -> serde_json::Value,
    expected_stop: Option<&str>,
) -> Result<(), Error> {
    let (listener, base) = fixture().await;
    let body = reply(&base).to_string();
    let source = ServerSource::vportal(
        &format!("{base}/nas/api"),
        "fixture-key",
        serde_json::json!({"id":"7"}),
    )
    .unwrap();
    let transport = fixture_transport(&[&base]);
    let cancel = CancellationToken::new();
    let provider = async {
        let (mut socket, _) = listener.accept().await.unwrap();
        assert!(read_request(&mut socket)
            .await
            .starts_with("POST /nas/api "));
        respond(
            &mut socket,
            "200 OK",
            "Content-Type: application/json\r\n",
            &body,
        )
        .await;
        drop(socket);
        if let Some(path) = expected_stop {
            let (mut socket, _) = listener.accept().await.unwrap();
            assert!(read_request(&mut socket)
                .await
                .starts_with(&format!("GET {path} ")));
            respond(&mut socket, "200 OK", "", "stopped").await;
        }
        assert!(
            tokio::time::timeout(Duration::from_millis(100), listener.accept())
                .await
                .is_err()
        );
    };
    let finish = async { source.resolve(&transport, &cancel).await?.finish().await };
    let (result, ()) = tokio::time::timeout(Duration::from_secs(4), async {
        tokio::join!(finish, provider)
    })
    .await
    .unwrap();
    result
}

#[tokio::test]
async fn provider_error_prefers_matching_session_stop_over_top_level_failure() {
    for variant in [false, true] {
        for absolute_key in [false, true] {
            let result = vportal_reply_then_finish(|base| {
                let mut value = serde_json::json!({
                    "type":"error",
                    "stop":format!("{base}/nas/stream/fallback.secret/media.stop"),
                });
                if variant {
                    value["variants"] = serde_json::json!({"main":"/selected.m3u8"});
                } else {
                    value["url"] = serde_json::json!("/selected.m3u8");
                }
                let key = if absolute_key { format!("{base}/selected.m3u8") } else { "/selected.m3u8".into() };
                let mut sessions = serde_json::Map::new();
                sessions.insert(key, serde_json::json!({"stop":format!("{base}/nas/stream/selected.secret/media.stop")}));
                value["sessions"] = serde_json::Value::Object(sessions);
                value
            }, Some("/nas/stream/selected.secret/media.stop")).await;
            assert_eq!(result, Err(Error::InvalidResponse));
        }
    }
}

#[tokio::test]
async fn unmatched_variant_uses_top_level_cleanup_only_for_provider_failure() {
    for failed in [false, true] {
        let result = vportal_reply_then_finish(|base| {
            serde_json::json!({
                "type":if failed { "error" } else { "ok" },
                "variants":{"main":"/selected.m3u8"},
                "stop":format!("{base}/nas/stream/fallback.secret/media.stop"),
                "sessions":{"/other.m3u8":{"stop":format!("{base}/nas/stream/other.secret/media.stop")}},
            })
        }, failed.then_some("/nas/stream/fallback.secret/media.stop")).await;
        assert_eq!(
            result,
            if failed {
                Err(Error::InvalidResponse)
            } else {
                Ok(())
            }
        );
    }
}

#[tokio::test]
async fn invalid_selected_stop_never_fetches_media_or_falls_back_to_another_lease() {
    for failed in [false, true] {
        for operation in ["m3u8", "mp4", "ping"] {
            let result = vportal_reply_then_finish(|base| {
                serde_json::json!({
                    "type":if failed { "error" } else { "ok" },
                    "url":"/selected.m3u8",
                    "stop":format!("{base}/nas/stream/fallback.secret/media.stop"),
                    "sessions":{"/selected.m3u8":{"stop":format!("{base}/nas/stream/selected.secret/media.{operation}")}},
                })
            }, None).await;
            assert_eq!(result, Err(Error::CleanupUnconfirmed));
        }
    }
}

async fn finite_hls_fixture(
    responses: Vec<(String, String)>,
) -> Result<super::super::resolvers::HlsSnapshot, Error> {
    let (listener, base) = fixture().await;
    let transport = fixture_transport(&[&base]);
    let prepared = ServerSource::http(&format!("{base}/root.m3u8"), None)
        .unwrap()
        .resolve(&transport, &CancellationToken::new())
        .await
        .unwrap();
    let expected_requests = responses.len();
    let (finished, mut completed) = tokio::sync::oneshot::channel();
    let provider = async {
        let mut served = 0;
        for (path, body) in responses {
            let accepted = tokio::select! {
                biased;
                accepted = listener.accept() => Some(accepted.unwrap()),
                _ = &mut completed => None,
            };
            let Some((mut socket, _)) = accepted else {
                break;
            };
            assert!(read_request(&mut socket)
                .await
                .starts_with(&format!("GET {path} ")));
            let content_type = if path.ends_with(".m3u8") {
                "Content-Type: application/vnd.apple.mpegurl\r\n"
            } else {
                "Content-Type: application/octet-stream\r\n"
            };
            respond(&mut socket, "200 OK", content_type, &body).await;
            served += 1;
        }
        assert!(
            tokio::time::timeout(Duration::from_millis(100), listener.accept())
                .await
                .is_err()
        );
        served
    };
    let fetch = async {
        let result = prepared.fetch_hls_snapshot().await;
        prepared.finish().await.unwrap();
        let _ = finished.send(());
        result
    };
    let (result, served) = tokio::time::timeout(Duration::from_secs(15), async {
        tokio::join!(fetch, provider)
    })
    .await
    .unwrap();
    assert_eq!(served, expected_requests);
    result
}

#[tokio::test]
async fn hls_snapshot_fetches_shared_playlist_and_its_children_once() {
    let responses = vec![
        ("/root.m3u8".into(), "#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"a\",NAME=\"English\",URI=\"shared.m3u8\"\n#EXT-X-STREAM-INF:BANDWIDTH=1000,AUDIO=\"a\"\nshared.m3u8\n".into()),
        ("/shared.m3u8".into(), "#EXTM3U\n#EXTINF:1,\nsegment.bin\n#EXT-X-ENDLIST\n".into()),
        ("/segment.bin".into(), "owned fixture segment".into()),
    ];
    let expected_bytes: usize = responses
        .iter()
        .map(|(_, body): &(String, String)| body.len())
        .sum();
    let snapshot = finite_hls_fixture(responses).await.unwrap();
    assert_eq!(snapshot.resources.len(), 3);
    assert_eq!(snapshot.total_bytes, expected_bytes);
}

#[tokio::test]
async fn hls_snapshot_skips_cycles_but_preserves_new_playlist_depth_limit() {
    for cycle in [false, true] {
        let mut responses = vec![(
            "/root.m3u8".into(),
            "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\np1.m3u8\n".into(),
        )];
        for depth in 1..=4 {
            let next = if cycle && depth == 4 {
                "root.m3u8".into()
            } else {
                format!("p{}.m3u8", depth + 1)
            };
            responses.push((
                format!("/p{depth}.m3u8"),
                format!("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\n{next}\n"),
            ));
        }
        let result = finite_hls_fixture(responses).await;
        if cycle {
            assert_eq!(result.unwrap().resources.len(), 5);
        } else {
            assert!(matches!(result, Err(Error::TooLarge)));
        }
    }
}

#[tokio::test]
async fn hls_snapshot_revisit_does_not_spend_the_unique_resource_budget() {
    for repeated in [false, true] {
        let mut root = "#EXTM3U\n".to_owned();
        for index in 0..128 {
            let selected = if repeated && index == 127 { 0 } else { index };
            root.push_str(&format!(
                "#EXT-X-STREAM-INF:BANDWIDTH=1\np{selected}.m3u8\n"
            ));
        }
        let mut responses = vec![("/root.m3u8".into(), root)];
        for index in 0..127 {
            responses.push((
                format!("/p{index}.m3u8"),
                "#EXTM3U\n#EXT-X-ENDLIST\n".into(),
            ));
        }
        let result = finite_hls_fixture(responses).await;
        if repeated {
            assert_eq!(result.unwrap().resources.len(), 128);
        } else {
            assert!(matches!(result, Err(Error::TooLarge)));
        }
    }
}

#[tokio::test]
async fn hls_snapshot_dense_root_playlist_duplicates_do_not_exhaust_pending_budget() {
    let root = format!(
        "#EXTM3U\n{}",
        "#EXT-X-STREAM-INF:BANDWIDTH=1\nshared.m3u8\n".repeat(128)
    );
    let responses = vec![
        ("/root.m3u8".into(), root),
        (
            "/shared.m3u8".into(),
            "#EXTM3U\n#EXTINF:1,\nsegment.bin\n#EXT-X-ENDLIST\n".into(),
        ),
        ("/segment.bin".into(), "owned fixture segment".into()),
    ];
    let expected_bytes: usize = responses
        .iter()
        .map(|(_, body): &(String, String)| body.len())
        .sum();
    let snapshot = finite_hls_fixture(responses).await.unwrap();
    assert_eq!(snapshot.resources.len(), 3);
    assert_eq!(snapshot.total_bytes, expected_bytes);
}

#[tokio::test]
async fn hls_snapshot_dense_child_playlist_duplicates_do_not_exhaust_pending_budget() {
    let wrapper = format!(
        "#EXTM3U\n{}",
        "#EXT-X-STREAM-INF:BANDWIDTH=1\nshared.m3u8\n".repeat(128)
    );
    let responses = vec![
        (
            "/root.m3u8".into(),
            "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nwrapper.m3u8\n".into(),
        ),
        ("/wrapper.m3u8".into(), wrapper),
        (
            "/shared.m3u8".into(),
            "#EXTM3U\n#EXTINF:1,\nsegment.bin\n#EXT-X-ENDLIST\n".into(),
        ),
        ("/segment.bin".into(), "owned fixture segment".into()),
    ];
    let expected_bytes: usize = responses
        .iter()
        .map(|(_, body): &(String, String)| body.len())
        .sum();
    let snapshot = finite_hls_fixture(responses).await.unwrap();
    assert_eq!(snapshot.resources.len(), 4);
    assert_eq!(snapshot.total_bytes, expected_bytes);
}

// The DNS seam replaces only lookup inside the production blocking worker.
// Real reqwest connections still pass through the ordinary policy and permits.
struct PeerDns {
    answers: std::collections::HashMap<String, Vec<SocketAddr>>,
    calls: Vec<String>,
}
fn peer_transport(
    origins: &[&str],
    answers: &[(&str, Vec<SocketAddr>)],
) -> (CheckedTransport, Arc<std::sync::Mutex<PeerDns>>) {
    let dns = Arc::new(std::sync::Mutex::new(PeerDns {
        answers: answers
            .iter()
            .map(|(host, addresses)| ((*host).into(), addresses.clone()))
            .collect(),
        calls: Vec::new(),
    }));
    let worker = dns.clone();
    let mut transport = fixture_transport(origins);
    transport.fixture_dns = Some(Arc::new(move |host, port| {
        let mut state = worker.lock().unwrap();
        state.calls.push(host.into());
        let addresses = state.answers.get(host).cloned().ok_or(Error::Transport)?;
        assert!(addresses.iter().all(|address| address.port() == port));
        Ok(addresses)
    }));
    (transport, dns)
}
async fn peer_listeners() -> (TcpListener, TcpListener, SocketAddr, SocketAddr, String) {
    let a = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let a_address = a.local_addr().unwrap();
    // Darwin does not guarantee arbitrary 127/8 aliases. Both standard loopback
    // families must be available; an unsupported fixture fails, never skips.
    let b = TcpListener::bind(SocketAddr::new(
        Ipv6Addr::LOCALHOST.into(),
        a_address.port(),
    ))
    .await
    .expect("peer-binding qualification requires IPv4 and IPv6 loopback at the same port");
    let b_address = b.local_addr().unwrap();
    assert_ne!(a_address.ip(), b_address.ip());
    assert_eq!(a_address.port(), b_address.port());
    let base = format!("http://plex.fixture:{}", a_address.port());
    (a, b, a_address, b_address, base)
}
struct PeerReply {
    status: &'static str,
    headers: String,
    body: Vec<u8>,
}
fn peer_reply(body: impl AsRef<[u8]>) -> PeerReply {
    PeerReply {
        status: "200 OK",
        headers: String::new(),
        body: body.as_ref().to_vec(),
    }
}
fn peer_redirect(target: &str) -> PeerReply {
    PeerReply {
        status: "302 Found",
        headers: format!("Location: {target}\r\n"),
        body: Vec::new(),
    }
}
fn peer_identity() -> PeerReply {
    peer_reply(br#"{"MediaContainer":{"machineIdentifier":"machineA"}}"#)
}
fn peer_metadata(part: &str) -> PeerReply {
    peer_reply(
        serde_json::json!({"MediaContainer":{"Metadata":[{
            "ratingKey":"7","type":"movie","Media":[{"Part":[{"key":part}]}]
        }]}})
        .to_string(),
    )
}
fn peer_path(request: &str) -> &str {
    request
        .lines()
        .next()
        .unwrap()
        .split_whitespace()
        .nth(1)
        .unwrap()
}
fn assert_no_peer_secrets(request: &str) {
    let lower = request.to_ascii_lowercase();
    for name in ["x-plex-token:", "authorization:", "cookie:"] {
        assert!(
            !lower.contains(name),
            "fixture received a forbidden credential header"
        );
    }
}
fn assert_plex_request(request: &str, base: &str) {
    let expected_host = base.strip_prefix("http://").unwrap();
    assert!(request
        .to_ascii_lowercase()
        .contains(&format!("host: {expected_host}\r\n")));
    if peer_path(request) == "/identity" {
        assert_no_peer_secrets(request);
    } else {
        assert!(request
            .to_ascii_lowercase()
            .contains("x-plex-token: owned-peer-token\r\n"));
    }
}
async fn serve_peer(
    listener: TcpListener,
    stop: &CancellationToken,
    mut reply: impl FnMut(&str) -> PeerReply,
) -> Vec<String> {
    let mut requests = Vec::new();
    loop {
        let accepted = tokio::select! {
            biased;
            accepted = listener.accept() => accepted.unwrap(),
            _ = stop.cancelled() => break,
        };
        let (mut socket, _) = accepted;
        let request = read_request(&mut socket).await;
        let response = reply(&request);
        requests.push(request);
        let headers = format!(
            "HTTP/1.1 {}\r\nConnection: close\r\nContent-Length: {}\r\n{}\r\n",
            response.status,
            response.body.len(),
            response.headers,
        );
        socket.write_all(headers.as_bytes()).await.unwrap();
        socket.write_all(&response.body).await.unwrap();
    }
    requests
}
fn peer_source(base: &str) -> ServerSource {
    ServerSource::plex(base, "machineA", "owned-peer-token", "7").unwrap()
}

#[tokio::test]
async fn plex_dns_rebind_keeps_metadata_and_finite_media_on_attested_peer() {
    let (a, b, a_address, b_address, base) = peer_listeners().await;
    let (transport, dns) = peer_transport(&[&base], &[("plex.fixture", vec![a_address])]);
    let cancel = CancellationToken::new();
    let stop = CancellationToken::new();
    let a_server = serve_peer(a, &stop, |request| {
        assert_plex_request(request, &base);
        match peer_path(request) {
            "/identity" => {
                dns.lock()
                    .unwrap()
                    .answers
                    .insert("plex.fixture".into(), vec![b_address]);
                peer_identity()
            }
            "/library/metadata/7" => peer_metadata("/library/parts/12/1/file.mp4"),
            "/library/parts/12/1/file.mp4" => peer_reply("attested media"),
            _ => panic!("unexpected fixture path"),
        }
    });
    let b_server = serve_peer(b, &stop, |request| {
        assert_eq!(peer_path(request), "/reachable");
        assert_no_peer_secrets(request);
        peer_reply("rebound peer reachable")
    });
    let client = async {
        // Prove B is accepted and reachable through the real checked connector,
        // independently of the subsequent protected scenario.
        let (probe, _) = peer_transport(&[&base], &[("plex.fixture", vec![b_address])]);
        assert_eq!(
            probe
                .get(&format!("{base}/reachable"), None, &cancel)
                .await
                .unwrap()
                .bytes(),
            b"rebound peer reachable"
        );
        let prepared = peer_source(&base)
            .resolve(&transport, &cancel)
            .await
            .unwrap();
        for _ in 0..2 {
            assert_eq!(
                prepared.fetch_root().await.unwrap().bytes(),
                b"attested media"
            );
        }
        prepared.finish().await.unwrap();
        stop.cancel();
    };
    let (_, a_requests, b_requests) = tokio::time::timeout(Duration::from_secs(10), async {
        tokio::join!(client, a_server, b_server)
    })
    .await
    .unwrap();
    assert_eq!(a_requests.len(), 4);
    assert_eq!(b_requests.len(), 1); // Only the explicitly tokenless reachability probe.
    assert_eq!(dns.lock().unwrap().calls, ["plex.fixture"]);
    assert_eq!(
        transport.permits.available_permits(),
        transport.limits.concurrent
    );
    assert_eq!(
        transport.sources.available_permits(),
        transport.limits.concurrent
    );
}

#[tokio::test]
async fn plex_binding_uses_actual_peer_not_first_dns_candidate() {
    let (inactive_a, b, a_address, b_address, base) = peer_listeners().await;
    drop(inactive_a);
    let (transport, dns) =
        peer_transport(&[&base], &[("plex.fixture", vec![a_address, b_address])]);
    let stop = CancellationToken::new();
    let (activated, receive_a) = tokio::sync::oneshot::channel();
    let mut activated = Some(activated);
    let b_server = serve_peer(b, &stop, |request| {
        assert_plex_request(request, &base);
        match peer_path(request) {
            "/identity" => {
                // B has actually received identity. Only now can A become live.
                let listener = std::net::TcpListener::bind(a_address).unwrap();
                listener.set_nonblocking(true).unwrap();
                let listener = TcpListener::from_std(listener).unwrap();
                activated.take().unwrap().send(listener).unwrap();
                dns.lock()
                    .unwrap()
                    .answers
                    .insert("plex.fixture".into(), vec![a_address]);
                peer_identity()
            }
            "/library/metadata/7" => peer_metadata("/library/parts/12/1/file.mp4"),
            "/library/parts/12/1/file.mp4" => peer_reply("actual selected peer B"),
            _ => panic!("unexpected fixture path"),
        }
    });
    let a_server = async {
        let a = receive_a.await.unwrap();
        serve_peer(a, &stop, |request| {
            assert_eq!(peer_path(request), "/reachable");
            assert_no_peer_secrets(request);
            peer_reply("new peer A reachable")
        })
        .await
    };
    let client = async {
        let prepared = peer_source(&base)
            .resolve(&transport, &CancellationToken::new())
            .await
            .unwrap();
        assert_eq!(
            prepared.fetch_root().await.unwrap().bytes(),
            b"actual selected peer B"
        );
        let (probe, _) = peer_transport(&[&base], &[("plex.fixture", vec![a_address])]);
        assert_eq!(
            probe
                .get(
                    &format!("{base}/reachable"),
                    None,
                    &CancellationToken::new()
                )
                .await
                .unwrap()
                .bytes(),
            b"new peer A reachable"
        );
        prepared.finish().await.unwrap();
        stop.cancel();
    };
    let (_, a_requests, b_requests) = tokio::time::timeout(Duration::from_secs(10), async {
        tokio::join!(client, a_server, b_server)
    })
    .await
    .unwrap();
    assert_eq!(a_requests.len(), 1);
    assert_eq!(b_requests.len(), 3);
    assert_eq!(dns.lock().unwrap().calls, ["plex.fixture"]);
}

#[tokio::test]
async fn bound_redirects_strip_foreign_credentials_and_repin_on_return() {
    let (a, b, a_address, b_address, base) = peer_listeners().await;
    let foreign = format!("http://foreign.fixture:{}", b_address.port());
    let (transport, dns) = peer_transport(
        &[&base, &foreign],
        &[
            ("plex.fixture", vec![a_address]),
            ("foreign.fixture", vec![b_address]),
        ],
    );
    let stop = CancellationToken::new();
    let a_server = serve_peer(a, &stop, |request| {
        let path = peer_path(request);
        if path == "/identity" {
            assert_no_peer_secrets(request);
            dns.lock()
                .unwrap()
                .answers
                .insert("plex.fixture".into(), vec![b_address]);
            return peer_identity();
        }
        let lower = request.to_ascii_lowercase();
        assert!(lower.contains("x-plex-token: owned-peer-token\r\n"));
        assert!(lower.contains("authorization: bearer owned-peer-token\r\n"));
        assert!(lower.contains("cookie: owned=fixture\r\n"));
        match path {
            "/start" => peer_redirect("/same-origin"),
            "/same-origin" => peer_redirect(&format!("{foreign}/relay")),
            "/finish" => peer_reply("returned to attested peer"),
            _ => panic!("unexpected fixture path"),
        }
    });
    let b_server = serve_peer(b, &stop, |request| {
        assert_no_peer_secrets(request);
        assert_eq!(peer_path(request), "/relay");
        peer_redirect(&format!("{base}/finish"))
    });
    let client = async {
        let cancel = CancellationToken::new();
        let identity = transport
            .get(&format!("{base}/identity"), None, &cancel)
            .await
            .unwrap();
        let value: serde_json::Value = serde_json::from_slice(identity.bytes()).unwrap();
        assert_eq!(value["MediaContainer"]["machineIdentifier"], "machineA");
        let mut headers = HeaderMap::new();
        headers.insert("x-plex-token", HeaderValue::from_static("owned-peer-token"));
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_static("Bearer owned-peer-token"),
        );
        headers.insert(COOKIE, HeaderValue::from_static("owned=fixture"));
        let credentials = transport
            .bind_credentials(OriginCredentials::new(&base, headers).unwrap(), &identity)
            .unwrap();
        assert_eq!(
            transport
                .get(&format!("{base}/start"), Some(&credentials), &cancel)
                .await
                .unwrap()
                .bytes(),
            b"returned to attested peer"
        );
        stop.cancel();
    };
    let (_, a_requests, b_requests) = tokio::time::timeout(Duration::from_secs(10), async {
        tokio::join!(client, a_server, b_server)
    })
    .await
    .unwrap();
    assert_eq!(a_requests.len(), 4);
    assert_eq!(b_requests.len(), 1);
    assert_eq!(
        dns.lock().unwrap().calls,
        ["plex.fixture", "foreign.fixture"]
    );
}

#[tokio::test]
async fn plex_peer_binding_covers_nested_hls_children() {
    let (a, b, a_address, b_address, base) = peer_listeners().await;
    let (transport, dns) = peer_transport(&[&base], &[("plex.fixture", vec![a_address])]);
    transport
        .policy
        .approve(&address(&base).unwrap(), &[b_address])
        .unwrap();
    let stop = CancellationToken::new();
    let a_server = serve_peer(a, &stop, |request| {
        assert_plex_request(request, &base);
        let path = peer_path(request);
        let mut reply = match path {
            "/identity" => {
                dns.lock().unwrap().answers.insert("plex.fixture".into(), vec![b_address]);
                peer_identity()
            }
            "/library/metadata/7" => peer_metadata("/library/parts/12/1/file.m3u8"),
            "/library/parts/12/1/file.m3u8" => peer_reply("#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"a\",NAME=\"English\",URI=\"audio.m3u8\"\n#EXT-X-STREAM-INF:BANDWIDTH=1000,AUDIO=\"a\"\nvideo.m3u8\n"),
            "/library/parts/12/1/audio.m3u8" => peer_reply("#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:1\n#EXT-X-KEY:METHOD=AES-128,URI=\"key.bin\"\n#EXT-X-MAP:URI=\"init.bin\"\n#EXTINF:1,\naudio.ts\n#EXT-X-ENDLIST\n"),
            "/library/parts/12/1/video.m3u8" => peer_reply("#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nvideo.ts\n#EXT-X-ENDLIST\n"),
            "/library/parts/12/1/key.bin" => peer_reply(b"0123456789abcdef"),
            "/library/parts/12/1/init.bin" => peer_reply(b"finite map fixture"),
            "/library/parts/12/1/audio.ts" | "/library/parts/12/1/video.ts" => peer_reply(b"finite segment fixture"),
            _ => panic!("unexpected HLS fixture path"),
        };
        if path.ends_with(".m3u8") {
            reply.headers = "Content-Type: application/vnd.apple.mpegurl\r\n".into();
        }
        reply
    });
    let b_server = serve_peer(b, &stop, |_| panic!("HLS request reached unattested peer"));
    let client = async {
        let prepared = peer_source(&base)
            .resolve(&transport, &CancellationToken::new())
            .await
            .unwrap();
        let snapshot = prepared.fetch_hls_snapshot().await.unwrap();
        assert_eq!(snapshot.resources.len(), 7);
        assert!(snapshot.total_bytes > 16);
        prepared.finish().await.unwrap();
        stop.cancel();
    };
    let (_, a_requests, b_requests) = tokio::time::timeout(Duration::from_secs(10), async {
        tokio::join!(client, a_server, b_server)
    })
    .await
    .unwrap();
    assert!(b_requests.is_empty());
    for suffix in [
        "file.m3u8",
        "audio.m3u8",
        "video.m3u8",
        "key.bin",
        "init.bin",
        "audio.ts",
        "video.ts",
    ] {
        assert!(a_requests
            .iter()
            .any(|request| peer_path(request).ends_with(suffix)));
    }
    assert_eq!(dns.lock().unwrap().calls, ["plex.fixture"]);
}

fn peer_ts_packets() -> Vec<u8> {
    let mut bytes = vec![0xff; 188 * 6];
    for packet in bytes.chunks_exact_mut(188) {
        packet[..4].copy_from_slice(&[0x47, 0x1f, 0xff, 0x10]);
    }
    bytes
}
#[tokio::test]
async fn plex_peer_binding_covers_fresh_mpeg_ts_opens_and_chunk_custody() {
    use super::super::stream_transport::StreamLimits;
    let (a, b, a_address, b_address, base) = peer_listeners().await;
    let (transport, dns) = peer_transport(&[&base], &[("plex.fixture", vec![a_address])]);
    let stop = CancellationToken::new();
    let packets = peer_ts_packets();
    let a_server = serve_peer(a, &stop, |request| {
        assert_plex_request(request, &base);
        match peer_path(request) {
            "/identity" => {
                dns.lock()
                    .unwrap()
                    .answers
                    .insert("plex.fixture".into(), vec![b_address]);
                peer_identity()
            }
            "/library/metadata/7" => peer_metadata("/library/parts/12/1/file.ts"),
            "/library/parts/12/1/file.ts" => peer_redirect("/stream.ts"),
            "/stream.ts" => {
                let mut reply = peer_reply(&packets);
                reply.headers = "Content-Type: video/mp2t\r\n".into();
                reply
            }
            _ => panic!("unexpected TS fixture path"),
        }
    });
    let b_server = serve_peer(b, &stop, |_| {
        panic!("continuous request reached unattested peer")
    });
    let client = async {
        let prepared = peer_source(&base)
            .resolve(&transport, &CancellationToken::new())
            .await
            .unwrap();
        // Both fresh subscriptions share one already-resolved source authority.
        for _ in 0..2 {
            let mut stream = prepared
                .open_mpeg_ts(StreamLimits::new(
                    tokio::time::Instant::now() + Duration::from_secs(5),
                ))
                .await
                .unwrap();
            let prefix = stream.next_chunk().await.unwrap().unwrap();
            assert!(matches!(stream.next_chunk().await, Err(Error::Busy)));
            let mut bytes = prefix.to_vec();
            drop(prefix);
            while let Some(chunk) = stream.next_chunk().await.unwrap() {
                bytes.extend_from_slice(&chunk);
            }
            assert_eq!(bytes, packets);
        }
        assert_eq!(
            transport.sources.available_permits(),
            transport.limits.concurrent - 1
        );
        assert_eq!(
            transport.permits.available_permits(),
            transport.limits.concurrent
        );
        prepared.finish().await.unwrap();
        stop.cancel();
    };
    let (_, a_requests, b_requests) = tokio::time::timeout(Duration::from_secs(10), async {
        tokio::join!(client, a_server, b_server)
    })
    .await
    .unwrap();
    assert!(b_requests.is_empty());
    assert_eq!(
        a_requests
            .iter()
            .filter(|request| peer_path(request) == "/identity")
            .count(),
        1
    );
    assert_eq!(
        a_requests
            .iter()
            .filter(|request| peer_path(request) == "/library/metadata/7")
            .count(),
        1
    );
    assert_eq!(
        a_requests
            .iter()
            .filter(|request| peer_path(request) == "/stream.ts")
            .count(),
        2
    );
    assert_eq!(dns.lock().unwrap().calls, ["plex.fixture"]);
    assert_eq!(
        transport.sources.available_permits(),
        transport.limits.concurrent
    );
}

#[tokio::test]
async fn peer_binding_rejects_missing_foreign_or_replaced_evidence() {
    let (a, b, a_address, b_address, base) = peer_listeners().await;
    let (transport, _) = peer_transport(&[&base], &[("plex.fixture", vec![a_address])]);
    let stop = CancellationToken::new();
    let a_server = serve_peer(a, &stop, |request| {
        assert_no_peer_secrets(request);
        peer_identity()
    });
    let b_server = serve_peer(b, &stop, |_| {
        panic!("negative evidence test sent credentials")
    });
    let client = async {
        let url = address(&format!("{base}/identity")).unwrap();
        let mut identity = transport
            .get(url.as_str(), None, &CancellationToken::new())
            .await
            .unwrap();
        let actual = identity.peer.clone().unwrap();
        assert_eq!(actual.address, a_address);
        let mut headers = HeaderMap::new();
        headers.insert("x-plex-token", HeaderValue::from_static("owned-peer-token"));
        let credentials = OriginCredentials::new(&base, headers).unwrap();
        let bound = transport
            .bind_credentials(credentials.clone(), &identity)
            .unwrap();
        assert!(transport
            .clone()
            .bind_credentials(bound.clone(), &identity)
            .is_ok());
        let independent = fixture_transport(&[&base]);
        assert!(matches!(
            independent.bind_credentials(credentials.clone(), &identity),
            Err(Error::DestinationDenied)
        ));
        let permit = Arc::new(transport.permits.clone().try_acquire_owned().unwrap());
        let checked = transport
            .checked_client(&url, Some(&bound), permit.clone(), false)
            .await
            .unwrap();
        assert!(matches!(
            checked.peer(&url, None),
            Err(Error::DestinationDenied)
        ));
        assert!(matches!(
            checked.peer(&url, Some(b_address)),
            Err(Error::DestinationDenied)
        ));
        let mut wrong_port = a_address;
        wrong_port.set_port(if a_address.port() == 65535 {
            65534
        } else {
            a_address.port() + 1
        });
        assert!(matches!(
            checked.peer(&url, Some(wrong_port)),
            Err(Error::DestinationDenied)
        ));
        assert!(matches!(
            independent
                .checked_client(&url, Some(&bound), permit.clone(), true)
                .await,
            Err(Error::DestinationDenied)
        ));
        let unbound = transport
            .checked_client(&url, None, permit.clone(), false)
            .await
            .unwrap();
        assert!(unbound.peer(&url, None).unwrap().is_none());
        identity.peer = None;
        assert!(matches!(
            transport.bind_credentials(credentials.clone(), &identity),
            Err(Error::DestinationDenied)
        ));
        identity.peer = Some(PeerEvidence {
            address: wrong_port,
            ..actual.clone()
        });
        assert!(matches!(
            transport.bind_credentials(credentials.clone(), &identity),
            Err(Error::DestinationDenied)
        ));
        identity.peer = Some(PeerEvidence {
            origin: "http://other.fixture".into(),
            ..actual.clone()
        });
        assert!(matches!(
            transport.bind_credentials(credentials.clone(), &identity),
            Err(Error::DestinationDenied)
        ));
        identity.peer = Some(PeerEvidence {
            transport: Arc::new(()),
            ..actual.clone()
        });
        assert!(matches!(
            transport.bind_credentials(credentials.clone(), &identity),
            Err(Error::DestinationDenied)
        ));
        // B is an allowed same-origin candidate; an existing binding must still
        // refuse replacement rather than treating policy approval as identity.
        identity.peer = Some(PeerEvidence {
            address: b_address,
            ..actual.clone()
        });
        assert!(matches!(
            transport.bind_credentials(bound, &identity),
            Err(Error::DestinationDenied)
        ));
        identity.peer = Some(actual);
        identity.url = address("http://foreign.fixture/identity").unwrap();
        assert!(matches!(
            transport.bind_credentials(credentials, &identity),
            Err(Error::DestinationDenied)
        ));
        drop(permit);
        stop.cancel();
    };
    let (_, a_requests, b_requests) = tokio::time::timeout(Duration::from_secs(10), async {
        tokio::join!(client, a_server, b_server)
    })
    .await
    .unwrap();
    assert_eq!(a_requests.len(), 1);
    assert!(b_requests.is_empty());
    assert_eq!(
        transport.permits.available_permits(),
        transport.limits.concurrent
    );
}

#[tokio::test]
async fn plex_attested_peer_failure_never_falls_back_to_rebound_dns() {
    let (a, b, a_address, b_address, base) = peer_listeners().await;
    let (transport, dns) = peer_transport(&[&base], &[("plex.fixture", vec![a_address])]);
    let stop = CancellationToken::new();
    let (closed, wait_closed) = tokio::sync::oneshot::channel();
    let a_server = async {
        for path in ["/identity", "/library/metadata/7"] {
            let (mut socket, _) = a.accept().await.unwrap();
            let request = read_request(&mut socket).await;
            assert_plex_request(&request, &base);
            assert_eq!(peer_path(&request), path);
            let response = if path == "/identity" {
                dns.lock()
                    .unwrap()
                    .answers
                    .insert("plex.fixture".into(), vec![b_address]);
                peer_identity()
            } else {
                peer_metadata("/library/parts/12/1/file.mp4")
            };
            respond(
                &mut socket,
                response.status,
                &response.headers,
                std::str::from_utf8(&response.body).unwrap(),
            )
            .await;
        }
        drop(a);
        closed.send(()).unwrap();
    };
    let b_server = serve_peer(b, &stop, |request| {
        assert_no_peer_secrets(request);
        assert_eq!(peer_path(request), "/reachable");
        peer_reply("B reachable after A closed")
    });
    let client = async {
        let prepared = peer_source(&base)
            .resolve(&transport, &CancellationToken::new())
            .await
            .unwrap();
        wait_closed.await.unwrap();
        let (probe, _) = peer_transport(&[&base], &[("plex.fixture", vec![b_address])]);
        assert_eq!(
            probe
                .get(
                    &format!("{base}/reachable"),
                    None,
                    &CancellationToken::new()
                )
                .await
                .unwrap()
                .bytes(),
            b"B reachable after A closed"
        );
        assert!(matches!(
            prepared.fetch_root().await,
            Err(Error::Transport | Error::Timeout)
        ));
        prepared.finish().await.unwrap();
        stop.cancel();
    };
    let (_, _, b_requests) = tokio::time::timeout(Duration::from_secs(10), async {
        tokio::join!(client, a_server, b_server)
    })
    .await
    .unwrap();
    assert_eq!(b_requests.len(), 1);
    assert_eq!(dns.lock().unwrap().calls, ["plex.fixture"]);
    assert_eq!(
        transport.permits.available_permits(),
        transport.limits.concurrent
    );
    assert_eq!(
        transport.sources.available_permits(),
        transport.limits.concurrent
    );
}

#[tokio::test]
async fn plex_cancelled_calls_and_retained_stream_slice_preserve_custody() {
    use super::super::stream_transport::StreamLimits;
    let (a, b, a_address, b_address, base) = peer_listeners().await;
    let (transport, dns) = peer_transport(&[&base], &[("plex.fixture", vec![a_address])]);
    let stop = CancellationToken::new();
    let (sent_body, body_complete) = tokio::sync::oneshot::channel();
    let a_server = async {
        let mut requests = Vec::new();
        for path in [
            "/identity",
            "/library/metadata/7",
            "/library/parts/12/1/file.ts",
        ] {
            let (mut socket, _) = a.accept().await.unwrap();
            let request = read_request(&mut socket).await;
            assert_plex_request(&request, &base);
            assert_eq!(peer_path(&request), path);
            let response = match path {
                "/identity" => {
                    dns.lock()
                        .unwrap()
                        .answers
                        .insert("plex.fixture".into(), vec![b_address]);
                    peer_identity()
                }
                "/library/metadata/7" => peer_metadata("/library/parts/12/1/file.ts"),
                _ => {
                    let mut reply = peer_reply(peer_ts_packets());
                    reply.headers = "Content-Type: video/mp2t\r\n".into();
                    reply
                }
            };
            let headers = format!(
                "HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Length: {}\r\n{}\r\n",
                response.body.len(),
                response.headers
            );
            socket.write_all(headers.as_bytes()).await.unwrap();
            socket.write_all(&response.body).await.unwrap();
            requests.push(request);
        }
        // Cancellation below starts after the fixture completed its writes;
        // unexpected BrokenPipe remains a failure, rather than being swallowed.
        sent_body.send(()).unwrap();
        stop.cancelled().await;
        assert!(tokio::time::timeout(Duration::from_millis(50), a.accept())
            .await
            .is_err());
        requests
    };
    let b_server = serve_peer(b, &stop, |_| {
        panic!("cancelled request reached rebound peer")
    });
    let client = async {
        let cancelled = CancellationToken::new();
        cancelled.cancel();
        assert!(matches!(
            peer_source(&base).resolve(&transport, &cancelled).await,
            Err(Error::Cancelled)
        ));
        let mut headers = HeaderMap::new();
        headers.insert("x-plex-token", HeaderValue::from_static("owned-peer-token"));
        let credentials = OriginCredentials::new(&base, headers).unwrap();
        assert!(matches!(
            transport
                .get(
                    &format!("{base}/library/metadata/7"),
                    Some(&credentials),
                    &cancelled
                )
                .await,
            Err(Error::Cancelled)
        ));
        assert!(dns.lock().unwrap().calls.is_empty());
        let owner = CancellationToken::new();
        let prepared = peer_source(&base)
            .resolve(&transport, &owner)
            .await
            .unwrap();
        let mut stream = prepared
            .open_mpeg_ts(StreamLimits::new(
                tokio::time::Instant::now() + Duration::from_secs(5),
            ))
            .await
            .unwrap();
        body_complete.await.unwrap();
        let bytes = stream.next_chunk().await.unwrap().unwrap();
        let retained = bytes.slice(..1);
        drop(bytes);
        owner.cancel();
        assert!(matches!(stream.next_chunk().await, Err(Error::Cancelled)));
        assert!(matches!(prepared.fetch_root().await, Err(Error::Cancelled)));
        assert!(matches!(
            prepared
                .open_mpeg_ts(StreamLimits::new(
                    tokio::time::Instant::now() + Duration::from_secs(5),
                ))
                .await,
            Err(Error::Cancelled)
        ));
        drop(stream);
        prepared.finish().await.unwrap();
        assert_eq!(
            transport.permits.available_permits(),
            transport.limits.concurrent - 1
        );
        assert_eq!(
            transport.sources.available_permits(),
            transport.limits.concurrent - 1
        );
        drop(retained);
        assert_eq!(
            transport.permits.available_permits(),
            transport.limits.concurrent
        );
        assert_eq!(
            transport.sources.available_permits(),
            transport.limits.concurrent
        );
        stop.cancel();
    };
    let (_, a_requests, b_requests) = tokio::time::timeout(Duration::from_secs(10), async {
        tokio::join!(client, a_server, b_server)
    })
    .await
    .unwrap();
    assert_eq!(a_requests.len(), 3);
    assert!(b_requests.is_empty());
    assert_eq!(dns.lock().unwrap().calls, ["plex.fixture"]);
}

#[tokio::test]
async fn peer_dns_cancellation_retains_admission_until_the_actual_worker_finishes() {
    struct ReleaseDns(Arc<(std::sync::Mutex<bool>, std::sync::Condvar)>);
    impl Drop for ReleaseDns {
        fn drop(&mut self) {
            let (lock, changed) = &*self.0;
            *lock.lock().unwrap() = true;
            changed.notify_all();
        }
    }
    let (listener, _) = fixture().await;
    let peer = listener.local_addr().unwrap();
    let base = format!("http://blocked-dns.fixture:{}", peer.port());
    let mut transport = CheckedTransport::new(
        NetworkPolicy::fixture(&[&base]),
        Limits {
            concurrent: 1,
            timeout: Duration::from_secs(2),
            ..Limits::default()
        },
    )
    .unwrap();
    let gate = Arc::new((std::sync::Mutex::new(false), std::sync::Condvar::new()));
    let release = ReleaseDns(gate.clone());
    let (entered, wait_entered) = tokio::sync::oneshot::channel();
    let entered = std::sync::Mutex::new(Some(entered));
    transport.fixture_dns = Some(Arc::new(move |host, port| {
        assert_eq!(host, "blocked-dns.fixture");
        assert_eq!(port, peer.port());
        entered.lock().unwrap().take().unwrap().send(()).unwrap();
        let (lock, changed) = &*gate;
        let (released, _) = changed
            .wait_timeout_while(lock.lock().unwrap(), Duration::from_secs(5), |released| {
                !*released
            })
            .unwrap();
        if !*released {
            return Err(Error::Timeout);
        }
        Ok(vec![peer])
    }));
    let cancel = CancellationToken::new();
    let fetch = transport.get(&base, None, &cancel);
    let cancellation = async {
        wait_entered.await.unwrap();
        cancel.cancel();
    };
    let (result, _) = tokio::time::timeout(Duration::from_secs(3), async {
        tokio::join!(fetch, cancellation)
    })
    .await
    .unwrap();
    assert!(matches!(result, Err(Error::Cancelled)));
    assert_eq!(transport.permits.available_permits(), 0);
    assert!(matches!(
        transport.get(&base, None, &CancellationToken::new()).await,
        Err(Error::Busy)
    ));
    drop(release);
    tokio::time::timeout(Duration::from_secs(2), async {
        while transport.permits.available_permits() != 1 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert!(
        tokio::time::timeout(Duration::from_millis(50), listener.accept())
            .await
            .is_err()
    );
}
