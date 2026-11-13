//! Real owned loopback/socket custody fixtures. TS framing is synthetic; these
//! tests do not establish video decoding, sealed probe metadata or TV capacity.
use super::super::{
    network::{CheckedTransport, Limits, NetworkPolicy},
    registry::{EnrolledInput, Enrollment, ItemEnrollment, Registry, SourcePrincipal},
    resolvers::ServerSource,
    runtime::{SourceConfig, SourceService},
    wire::{
        BackendExpected, Binding, Descriptor, GrantRequest, NativeExpected, NativeRevisions,
        Permission, Principal, Protection, SourcesRequest,
    },
};
use super::*;
use std::{
    collections::{BTreeMap, BTreeSet},
    future::Future,
    sync::atomic::{AtomicUsize, Ordering},
    task::Poll,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::oneshot,
};
use uuid::Uuid;

fn player() -> Principal {
    Principal {
        subject: "stream_owner".into(),
        installation_id: "stream_native".into(),
        permissions: BTreeSet::from([Permission::MultiviewControl]),
    }
}
fn operator() -> Principal {
    Principal {
        subject: "stream_operator".into(),
        installation_id: "stream_server".into(),
        permissions: BTreeSet::from([Permission::SourcesManage]),
    }
}
fn binding() -> Binding {
    Binding {
        server_epoch: "stream_epoch".into(),
        session_id: "stream_session".into(),
        backend_expected: BackendExpected {
            runtime: 1,
            scene: "backend_scene".into(),
            geometry_revision: 1,
            focus_revision: 1,
            audio_revision: 1,
        },
        native_expected: NativeExpected {
            runtime: "native_runtime".into(),
            expected: NativeRevisions {
                scene: "native_scene".into(),
                layout_revision: "layout".into(),
                focus_revision: "focus".into(),
                audio_revision: "audio".into(),
            },
            slot_id: 0,
            slot_generation: "slot".into(),
            source_revision: "source".into(),
        },
        backend_slot_revision: 1,
    }
}
fn packets(count: usize, marker: u8) -> Vec<u8> {
    let mut bytes = vec![marker; count * 188];
    for (index, packet) in bytes.chunks_exact_mut(188).enumerate() {
        packet[0] = 0x47;
        packet[1] = 0x01;
        packet[2] = 0x00;
        packet[3] = 0x10 | (index as u8 & 15);
    }
    bytes
}
async fn listener() -> (TcpListener, String) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    (listener, base)
}
async fn request(socket: &mut TcpStream) -> String {
    let mut bytes = Vec::new();
    let mut buffer = [0u8; 2048];
    loop {
        if let Some(end) = bytes.windows(4).position(|part| part == b"\r\n\r\n") {
            let headers = std::str::from_utf8(&bytes[..end + 4]).unwrap();
            let length = headers
                .lines()
                .find_map(|line| {
                    line.split_once(':')
                        .filter(|(name, _)| name.eq_ignore_ascii_case("content-length"))
                        .map(|(_, value)| value.trim().parse::<usize>().unwrap())
                })
                .unwrap_or(0);
            assert!(length < 16_384);
            if bytes.len() >= end + 4 + length {
                return String::from_utf8(bytes).unwrap();
            }
        }
        let count = tokio::time::timeout(Duration::from_secs(2), socket.read(&mut buffer))
            .await
            .unwrap()
            .unwrap();
        assert_ne!(count, 0);
        bytes.extend_from_slice(&buffer[..count]);
        assert!(bytes.len() < 32_768);
    }
}
async fn response(socket: &mut TcpStream, content_type: &str, body: &[u8]) {
    socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len()).as_bytes()).await.unwrap();
    socket.write_all(body).await.unwrap();
    socket.shutdown().await.unwrap();
}
async fn make_source(base: &str, source: ServerSource) -> (AuthorizedSource, Arc<Registry>) {
    let registry = Arc::new(Registry::new("stream_server".into(), "stream_epoch".into()).unwrap());
    let service = SourceService::new(registry.clone());
    service
        .enroll(
            &operator(),
            Enrollment {
                source_ref: "owned_stream".into(),
                profile_uuid: Uuid::from_u128(7),
                config_revision: "configuration".into(),
                policy_revision: "policy".into(),
                allowed: BTreeSet::from([SourcePrincipal::from(&player())]),
                items: vec![ItemEnrollment {
                    item_ref: "item".into(),
                    identity_version: 1,
                    favorite_sha256: "a".repeat(64),
                    kind: "live".into(),
                    input_adapter: "mpegts_fixture".into(),
                    protection: Protection {
                        known: true,
                        restricted: false,
                    },
                    descriptor: Descriptor {
                        title: "Synthetic TS fixture".into(),
                        provider: "m3u".into(),
                    },
                    input: EnrolledInput { config_index: 0 },
                }],
            },
            BTreeMap::from([(
                "item".into(),
                SourceConfig {
                    source,
                    transport: CheckedTransport::new(
                        NetworkPolicy::fixture(&[base]),
                        Limits {
                            timeout: Duration::from_secs(2),
                            ..Limits::default()
                        },
                    )
                    .unwrap(),
                },
            )]),
            None,
        )
        .unwrap();
    registry.create_session(&player(), &binding()).unwrap();
    let catalog = registry
        .sources(
            &player(),
            &SourcesRequest {
                version: 1,
                context: binding(),
                cursor: None,
            },
        )
        .unwrap();
    let item = &catalog.items[0];
    let grant = registry
        .mint(
            &player(),
            &GrantRequest {
                version: 1,
                context: binding(),
                source_ref: item.source_ref.clone(),
                item_ref: item.item_ref.clone(),
                item_revision: item.item_revision.clone(),
                identity_version: 1,
                favorite_sha256: item.favorite_sha256.clone(),
                catalog_revision: catalog.catalog_revision,
                remaining_budget_ms: 30_000,
            },
        )
        .unwrap();
    let resolved = service
        .resolve(
            &player(),
            &binding(),
            &grant.input_grant,
            &CancellationToken::new(),
        )
        .await
        .ok()
        .expect("server-owned source resolves");
    (resolved, registry)
}
async fn make_factory(
    base: &str,
    source: ServerSource,
    hard_end: Instant,
) -> (StreamFactory, Arc<Registry>) {
    let (resolved, registry) = make_source(base, source).await;
    (StreamFactory::new(resolved, hard_end).unwrap(), registry)
}
async fn http_factory(base: &str, duration: Duration) -> (StreamFactory, Arc<Registry>) {
    make_factory(
        base,
        ServerSource::http(&format!("{base}/stream"), None).unwrap(),
        Instant::now() + duration,
    )
    .await
}
async fn read_all(file: File) -> Vec<u8> {
    let mut reader = tokio::fs::File::from_std(file);
    let mut bytes = Vec::new();
    tokio::time::timeout(Duration::from_secs(3), reader.read_to_end(&mut bytes))
        .await
        .expect("producer closes reader at EOF")
        .unwrap();
    bytes
}

#[tokio::test]
async fn fresh_probe_and_decode_files_share_one_grant_and_close_at_eof() {
    let (listener, base) = listener().await;
    let expected_probe = packets(7, 0x21);
    let expected_decode = packets(9, 0x31);
    let probe = expected_probe.clone();
    let decode = expected_decode.clone();
    let fixture = tokio::spawn(async move {
        for bytes in [probe, decode] {
            let (mut socket, _) = listener.accept().await.unwrap();
            assert!(request(&mut socket).await.starts_with("GET /stream "));
            response(&mut socket, "video/mp2t", &bytes).await;
        }
    });
    let (mut factory, registry) = http_factory(&base, Duration::from_secs(15)).await;
    let reservation = factory.reservation().id().to_string();
    let mut probe = factory.open(StreamPhase::Probe).await.unwrap();
    let file = probe.take_file().unwrap();
    assert!(probe.take_file().is_err());
    assert_eq!(read_all(file).await, expected_probe);
    let report = probe.retire().await.unwrap();
    assert!(report.joined && report.eof);
    assert_eq!(report.bytes, expected_probe.len() as u64);
    assert_eq!(report.error, None);
    assert_eq!(probe.retire().await.unwrap(), report);
    assert!(factory.open(StreamPhase::Probe).await.is_err());
    assert!(registry
        .validate_reservation(&player(), &binding(), factory.reservation())
        .is_ok());
    let mut decode = factory.open(StreamPhase::Decode).await.unwrap();
    assert_eq!(read_all(decode.take_file().unwrap()).await, expected_decode);
    let report = decode.retire().await.unwrap();
    assert!(report.joined && report.eof);
    assert_eq!(report.bytes, expected_decode.len() as u64);
    assert_eq!(factory.reservation().id(), reservation);
    assert!(factory.open(StreamPhase::Decode).await.is_err());
    let finished = factory.finish().await.unwrap();
    assert!(finished.producers_joined && finished.provider_cleanup_confirmed);
    assert_eq!(factory.finish().await.unwrap(), finished);
    let retirement = registry
        .retirements(&player(), &binding().session_id)
        .unwrap();
    assert_eq!(retirement.len(), 1);
    assert!(!retirement[0].reaped && !retirement[0].output_revoked);
    fixture.await.unwrap();
}

/// Feed until the client closes; no real provider or unbounded fixture buffer.
async fn sustained(listener: TcpListener, started: oneshot::Sender<()>) {
    let (mut socket, _) = listener.accept().await.unwrap();
    assert!(request(&mut socket).await.starts_with("GET /stream "));
    socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: video/mp2t\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n").await.unwrap();
    let bytes = packets(348, 0x41);
    let prefix = format!("{:x}\r\n", bytes.len());
    let mut started = Some(started);
    loop {
        if socket.write_all(prefix.as_bytes()).await.is_err()
            || socket.write_all(&bytes).await.is_err()
            || socket.write_all(b"\r\n").await.is_err()
        {
            break;
        }
        if let Some(started) = started.take() {
            let _ = started.send(());
        }
        tokio::task::yield_now().await;
    }
}

#[tokio::test]
async fn nonreading_fd_backpressure_cancels_and_joins_without_reader_close() {
    let (listener, base) = listener().await;
    let (started, observed) = oneshot::channel();
    let fixture = tokio::spawn(sustained(listener, started));
    let (mut factory, _) = http_factory(&base, Duration::from_secs(15)).await;
    let mut opened = factory.open(StreamPhase::Probe).await.unwrap();
    let retained_reader = opened.take_file().unwrap();
    observed.await.unwrap();
    tokio::time::sleep(Duration::from_millis(50)).await;
    opened.cancel();
    let report = tokio::time::timeout(Duration::from_secs(2), opened.retire())
        .await
        .expect("async writer cancellation must not require closing reader")
        .unwrap();
    assert!(report.joined && report.cancelled);
    assert!(!report.eof);
    assert!(report.bytes < 8 * 1024 * 1024);
    // EOF reaches a still-open reader after the producer is joined.
    let buffered = read_all(retained_reader).await;
    assert_eq!(buffered.len() as u64, report.bytes);
    assert!(factory.finish().await.unwrap().producers_joined);
    tokio::time::timeout(Duration::from_secs(2), fixture)
        .await
        .unwrap()
        .unwrap();
}

#[tokio::test]
async fn interrupted_retire_future_preserves_the_only_join_handle() {
    let (listener, base) = listener().await;
    let (started, observed) = oneshot::channel();
    let fixture = tokio::spawn(sustained(listener, started));
    let (mut factory, _) = http_factory(&base, Duration::from_secs(15)).await;
    let mut opened = factory.open(StreamPhase::Probe).await.unwrap();
    let retained_reader = opened.take_file().unwrap();
    observed.await.unwrap();
    {
        let mut interrupted = Box::pin(opened.retire());
        futures_util::future::poll_fn(|cx| {
            assert!(
                interrupted.as_mut().poll(cx).is_pending(),
                "live producer must be joined asynchronously"
            );
            Poll::Ready(())
        })
        .await;
        // Cancellation of this *caller* must not detach the sole producer owner.
    }
    let report = tokio::time::timeout(Duration::from_secs(2), opened.retire())
        .await
        .expect("a later owner can resume joining")
        .unwrap();
    assert!(report.joined);
    drop(retained_reader);
    assert!(factory.finish().await.unwrap().producers_joined);
    tokio::time::timeout(Duration::from_secs(2), fixture)
        .await
        .unwrap()
        .unwrap();
}

#[tokio::test]
async fn decode_waits_for_observed_probe_join_and_failed_phase_is_not_replayed() {
    let (listener, base) = listener().await;
    let fixture = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        request(&mut socket).await;
        response(&mut socket, "application/vnd.apple.mpegurl", b"#EXTM3U\n").await;
    });
    let (mut factory, _) = http_factory(&base, Duration::from_secs(15)).await;
    assert!(factory.open(StreamPhase::Decode).await.is_err());
    assert!(factory.open(StreamPhase::Probe).await.is_err());
    assert!(factory.open(StreamPhase::Probe).await.is_err());
    assert!(factory.open(StreamPhase::Decode).await.is_err());
    assert!(factory.finish().await.unwrap().provider_cleanup_confirmed);
    fixture.await.unwrap();
}

#[tokio::test]
async fn factory_cancel_revokes_registry_before_provider_or_decoder_cleanup() {
    let (listener, base) = listener().await;
    let (started, observed) = oneshot::channel();
    let fixture = tokio::spawn(sustained(listener, started));
    let (mut factory, registry) = http_factory(&base, Duration::from_secs(15)).await;
    let mut opened = factory.open(StreamPhase::Probe).await.unwrap();
    let retained_reader = opened.take_file().unwrap();
    observed.await.unwrap();
    factory.cancel();
    assert!(factory.reservation().revoked().load(Ordering::Acquire));
    assert!(registry
        .validate_reservation(&player(), &binding(), factory.reservation())
        .is_err());
    assert!(factory.finish().await.unwrap().producers_joined);
    let report = opened.retire().await.unwrap();
    assert!(report.joined);
    let retirement = registry
        .retirements(&player(), &binding().session_id)
        .unwrap();
    assert!(!retirement[0].reaped && !retirement[0].output_revoked);
    drop(retained_reader);
    tokio::time::timeout(Duration::from_secs(2), fixture)
        .await
        .unwrap()
        .unwrap();
}

#[tokio::test]
async fn vportal_probe_decode_allocate_once_and_stop_only_with_factory_cleanup() {
    let (listener, base) = listener().await;
    let allocate = Arc::new(AtomicUsize::new(0));
    let streams = Arc::new(AtomicUsize::new(0));
    let stopped = Arc::new(AtomicUsize::new(0));
    let counts = (allocate.clone(), streams.clone(), stopped.clone());
    let origin = base.clone();
    let fixture = tokio::spawn(async move {
        for _ in 0..4 {
            let (mut socket, _) = listener.accept().await.unwrap();
            let req = request(&mut socket).await;
            if req.starts_with("POST /nas/api ") {
                counts.0.fetch_add(1, Ordering::SeqCst);
                let body = serde_json::json!({"url":format!("{origin}/stream"),"stop":format!("{origin}/nas/stream/id.secret/media.stop")}).to_string();
                response(&mut socket, "application/json", body.as_bytes()).await;
            } else if req.starts_with("GET /stream ") {
                let index = counts.1.fetch_add(1, Ordering::SeqCst);
                response(&mut socket, "video/mp2t", &packets(7, 0x51 + index as u8)).await;
            } else {
                assert!(req.starts_with("GET /nas/stream/id.secret/media.stop "));
                counts.2.fetch_add(1, Ordering::SeqCst);
                response(&mut socket, "application/json", b"").await;
            }
        }
    });
    let source = ServerSource::vportal(
        &format!("{base}/nas/api"),
        "fixture-key",
        serde_json::json!({"id":"7"}),
    )
    .unwrap();
    let (mut factory, _) =
        make_factory(&base, source, Instant::now() + Duration::from_secs(15)).await;
    assert_eq!(allocate.load(Ordering::SeqCst), 1);
    for (phase, marker) in [(StreamPhase::Probe, 0x51), (StreamPhase::Decode, 0x52)] {
        let mut opened = factory.open(phase).await.unwrap();
        assert_eq!(
            read_all(opened.take_file().unwrap()).await,
            packets(7, marker)
        );
        assert!(opened.retire().await.unwrap().joined);
        assert_eq!(stopped.load(Ordering::SeqCst), 0);
    }
    assert_eq!(streams.load(Ordering::SeqCst), 2);
    assert_eq!(allocate.load(Ordering::SeqCst), 1);
    let receipt = factory.finish().await.unwrap();
    assert!(receipt.producers_joined && receipt.provider_cleanup_confirmed);
    assert_eq!(stopped.load(Ordering::SeqCst), 1);
    fixture.await.unwrap();
}

#[tokio::test]
async fn hard_deadline_terminates_backpressured_subscription_without_renewal() {
    let (listener, base) = listener().await;
    let (started, observed) = oneshot::channel();
    let fixture = tokio::spawn(sustained(listener, started));
    let (mut factory, _) = http_factory(&base, Duration::from_millis(250)).await;
    let mut opened = factory.open(StreamPhase::Probe).await.unwrap();
    let retained_reader = opened.take_file().unwrap();
    observed.await.unwrap();
    tokio::time::sleep(Duration::from_millis(300)).await;
    let report = tokio::time::timeout(Duration::from_secs(2), opened.retire())
        .await
        .unwrap()
        .unwrap();
    assert!(report.joined && !report.eof);
    assert_eq!(report.error, Some(StreamError::Expired));
    assert!(factory.open(StreamPhase::Decode).await.is_err());
    drop(retained_reader);
    assert!(factory.finish().await.unwrap().provider_cleanup_confirmed);
    tokio::time::timeout(Duration::from_secs(2), fixture)
        .await
        .unwrap()
        .unwrap();
}

#[tokio::test]
async fn interrupted_factory_finish_resumes_same_provider_cleanup_without_replay() {
    let (listener, base) = listener().await;
    let origin = base.clone();
    let stops = Arc::new(AtomicUsize::new(0));
    let observed_stops = stops.clone();
    let (stopping, observed) = oneshot::channel();
    let (release, released) = oneshot::channel();
    let fixture = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        assert!(request(&mut socket).await.starts_with("POST /nas/api "));
        let body = serde_json::json!({"url":format!("{origin}/stream"),"stop":format!("{origin}/nas/stream/id.secret/media.stop")}).to_string();
        response(&mut socket, "application/json", body.as_bytes()).await;
        let (mut socket, _) = listener.accept().await.unwrap();
        assert!(request(&mut socket)
            .await
            .starts_with("GET /nas/stream/id.secret/media.stop "));
        stops.fetch_add(1, Ordering::SeqCst);
        stopping.send(()).unwrap();
        released.await.unwrap();
        response(&mut socket, "application/json", b"").await;
    });
    let source = ServerSource::vportal(
        &format!("{base}/nas/api"),
        "fixture-key",
        serde_json::json!({"id":"7"}),
    )
    .unwrap();
    let (mut factory, registry) =
        make_factory(&base, source, Instant::now() + Duration::from_secs(15)).await;
    {
        let mut interrupted = Box::pin(factory.finish());
        tokio::select! {
            result = &mut interrupted => panic!("provider cleanup cannot be confirmed before stop ACK: {result:?}"),
            result = observed => result.unwrap(),
        }
        // Drop this awaiter while the real provider stop is still pending.
    }
    assert_eq!(observed_stops.load(Ordering::SeqCst), 1);
    let retired = registry
        .retirements(&player(), &binding().session_id)
        .unwrap();
    assert_eq!(retired.len(), 1);
    assert!(!retired[0].reaped && !retired[0].output_revoked);
    release.send(()).unwrap();
    let receipt = tokio::time::timeout(Duration::from_secs(2), factory.finish())
        .await
        .expect("cleanup custody survives awaiter cancellation")
        .unwrap();
    assert!(receipt.producers_joined && receipt.provider_cleanup_confirmed);
    assert_eq!(factory.finish().await.unwrap(), receipt);
    assert_eq!(observed_stops.load(Ordering::SeqCst), 1);
    fixture.await.unwrap();
}

#[tokio::test]
async fn rejected_factory_creation_returns_source_and_observable_provider_cleanup() {
    // Expired, excessive, and revoked-before-construction requests all retain
    // the same reservation and the original provider's one cleanup operation.
    for variation in 0..3 {
        let (listener, base) = listener().await;
        let origin = base.clone();
        let stops = Arc::new(AtomicUsize::new(0));
        let observed_stops = stops.clone();
        let (stopping, mut observed) = oneshot::channel();
        let (release, released) = oneshot::channel();
        let fixture = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            assert!(request(&mut socket).await.starts_with("POST /nas/api "));
            let body = serde_json::json!({"url":format!("{origin}/stream"),"stop":format!("{origin}/nas/stream/id.secret/media.stop")}).to_string();
            response(&mut socket, "application/json", body.as_bytes()).await;
            let (mut socket, _) = listener.accept().await.unwrap();
            assert!(request(&mut socket)
                .await
                .starts_with("GET /nas/stream/id.secret/media.stop "));
            stops.fetch_add(1, Ordering::SeqCst);
            stopping.send(()).unwrap();
            released.await.unwrap();
            response(&mut socket, "application/json", b"").await;
        });
        let source = ServerSource::vportal(
            &format!("{base}/nas/api"),
            "fixture-key",
            serde_json::json!({"id":"7"}),
        )
        .unwrap();
        let (resolved, registry) = make_source(&base, source).await;
        let reservation_id = resolved.reservation().id().to_string();
        let hard_end = match variation {
            0 => Instant::now() - Duration::from_secs(1),
            1 => Instant::now() + Duration::from_secs(24 * 60 * 60 + 60),
            _ => {
                resolved.cancel();
                Instant::now() + Duration::from_secs(15)
            }
        };
        let failure = match StreamFactory::new(resolved, hard_end) {
            Ok(_) => panic!("invalid factory construction must reject variation {variation}"),
            Err(failure) => failure,
        };
        if variation < 2 {
            assert_eq!(failure.error, StreamError::Expired);
            // Returning an error must not implicitly drop the provider owner.
            assert!(
                tokio::time::timeout(Duration::from_millis(25), &mut observed)
                    .await
                    .is_err()
            );
            assert_eq!(observed_stops.load(Ordering::SeqCst), 0);
        } else {
            assert!(matches!(failure.error, StreamError::Source(_)));
        }
        let recovered = failure.into_source();
        assert_eq!(recovered.reservation().id(), reservation_id);
        let mut cleanup = Box::pin(recovered.finish());
        tokio::select! {
            result = &mut cleanup => panic!("cleanup cannot confirm before owned stop ACK: {result:?}"),
            result = &mut observed => result.unwrap(),
        }
        assert_eq!(observed_stops.load(Ordering::SeqCst), 1);
        let retired = registry
            .retirements(&player(), &binding().session_id)
            .unwrap();
        assert_eq!(retired.len(), 1);
        assert_eq!(retired[0].reservation_id, reservation_id);
        assert!(!retired[0].reaped && !retired[0].output_revoked);
        release.send(()).unwrap();
        tokio::time::timeout(Duration::from_secs(2), cleanup)
            .await
            .expect("recovered source retains cleanup result")
            .unwrap();
        assert_eq!(observed_stops.load(Ordering::SeqCst), 1);
        fixture.await.unwrap();
    }
}
