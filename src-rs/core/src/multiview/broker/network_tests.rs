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
