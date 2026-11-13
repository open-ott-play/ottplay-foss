//! Real in-process source service with freshly-owned loopback HTTP fixtures.
//! No decoder subprocess, configured provider, or private network is contacted.
use super::super::{
    network::{Limits, NetworkPolicy},
    registry::{EnrolledInput, ItemEnrollment, SourcePrincipal},
    wire::{
        BackendExpected, Descriptor, GrantRequest, NativeExpected, NativeRevisions, Protection,
        SourcesRequest,
    },
};
use super::*;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};
use uuid::Uuid;

fn player() -> Principal {
    Principal {
        subject: "owner".into(),
        installation_id: "tv".into(),
        permissions: BTreeSet::from([Permission::MultiviewControl]),
    }
}
fn manager() -> Principal {
    Principal {
        permissions: BTreeSet::from([Permission::SourcesManage]),
        ..player()
    }
}
fn binding() -> Binding {
    Binding {
        server_epoch: "epoch".into(),
        session_id: "session".into(),
        backend_expected: BackendExpected {
            runtime: 1,
            scene: "scene".into(),
            geometry_revision: 1,
            focus_revision: 1,
            audio_revision: 1,
        },
        native_expected: NativeExpected {
            runtime: "native".into(),
            expected: NativeRevisions {
                scene: "native-scene".into(),
                layout_revision: "layout".into(),
                focus_revision: "focus".into(),
                audio_revision: "audio".into(),
            },
            slot_id: 0,
            slot_generation: "slot-generation".into(),
            source_revision: "source-revision".into(),
        },
        backend_slot_revision: 1,
    }
}
fn enrollment() -> Enrollment {
    Enrollment {
        source_ref: "owned-source".into(),
        profile_uuid: Uuid::from_u128(1),
        config_revision: "config".into(),
        policy_revision: "policy".into(),
        allowed: BTreeSet::from([SourcePrincipal::from(&player())]),
        items: vec![ItemEnrollment {
            item_ref: "item".into(),
            identity_version: 1,
            favorite_sha256: "a".repeat(64),
            kind: "vod".into(),
            input_adapter: "http-finite".into(),
            protection: Protection {
                known: true,
                restricted: false,
            },
            descriptor: Descriptor {
                title: "Synthetic".into(),
                provider: "m3u".into(),
            },
            input: EnrolledInput { config_index: 0 },
        }],
    }
}
fn config(base: &str) -> BTreeMap<String, SourceConfig> {
    BTreeMap::from([(
        "item".into(),
        SourceConfig {
            source: ServerSource::http(&format!("{base}/video"), None).unwrap(),
            transport: CheckedTransport::new(
                NetworkPolicy::fixture(&[base]),
                Limits {
                    timeout: Duration::from_secs(2),
                    ..Limits::default()
                },
            )
            .unwrap(),
        },
    )])
}
fn service(base: &str) -> (Arc<Registry>, SourceService, String) {
    let registry = Arc::new(Registry::new("server".into(), "epoch".into()).unwrap());
    let service = SourceService::new(registry.clone());
    let revision = service
        .enroll(&manager(), enrollment(), config(base), None)
        .unwrap();
    registry.create_session(&player(), &binding()).unwrap();
    (registry, service, revision)
}
fn grant(registry: &Registry) -> String {
    let page = registry
        .sources(
            &player(),
            &SourcesRequest {
                version: 1,
                context: binding(),
                cursor: None,
            },
        )
        .unwrap();
    let item = &page.items[0];
    registry
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
                catalog_revision: page.catalog_revision,
                remaining_budget_ms: 30_000,
            },
        )
        .unwrap()
        .input_grant
}
async fn listener() -> (TcpListener, String) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    (listener, base)
}
async fn request(socket: &mut tokio::net::TcpStream) {
    assert!(read_request(socket)
        .await
        .starts_with("GET /video HTTP/1.1"));
}
async fn read_request(socket: &mut tokio::net::TcpStream) -> String {
    let mut bytes = Vec::new();
    let mut buffer = [0u8; 1024];
    loop {
        let count = tokio::time::timeout(Duration::from_secs(2), socket.read(&mut buffer))
            .await
            .unwrap()
            .unwrap();
        assert_ne!(count, 0);
        bytes.extend_from_slice(&buffer[..count]);
        assert!(bytes.len() < 8192);
        if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
            let header = std::str::from_utf8(&bytes[..end]).unwrap();
            let length = header
                .lines()
                .find_map(|line| {
                    line.to_ascii_lowercase()
                        .strip_prefix("content-length:")
                        .map(|value| value.trim().parse::<usize>().unwrap())
                })
                .unwrap_or(0);
            if bytes.len() >= end + 4 + length {
                return String::from_utf8(bytes).unwrap();
            }
        }
    }
}

#[tokio::test]
async fn enrolled_grant_resolves_fetches_once_and_finish_does_not_claim_decoder_reaping() {
    let (listener, base) = listener().await;
    let fixture = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        request(&mut socket).await;
        socket
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\nConnection: close\r\n\r\ndata")
            .await
            .unwrap();
    });
    let (registry, service, _) = service(&base);
    let grant = grant(&registry);
    let source = service
        .resolve(&player(), &binding(), &grant, &CancellationToken::new())
        .await
        .ok()
        .expect("owned grant resolves");
    let reservation = source.reservation().clone();
    assert_eq!(source.fetch_root().await.unwrap().bytes(), b"data");
    assert!(service
        .resolve(&player(), &binding(), &grant, &CancellationToken::new())
        .await
        .is_err());
    source.finish().await.unwrap();
    let retired = registry.retirements(&player(), "session").unwrap();
    assert_eq!(retired.len(), 1);
    assert_eq!(retired[0].reservation_id, reservation.id());
    assert!(retired[0].cancellation_requested);
    assert!(!retired[0].output_revoked);
    assert!(!retired[0].reaped);
    fixture.await.unwrap();
}

#[tokio::test]
async fn source_policy_change_cancels_inflight_body_and_never_returns_stale_bytes() {
    let (listener, base) = listener().await;
    let (ready, observed) = tokio::sync::oneshot::channel();
    let (release, released) = tokio::sync::oneshot::channel();
    let fixture = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        request(&mut socket).await;
        socket
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\nConnection: close\r\n\r\nx")
            .await
            .unwrap();
        ready.send(()).unwrap();
        released.await.unwrap();
        let _ = socket.write_all(b"abc").await;
    });
    let (registry, service, revision) = service(&base);
    let source = Arc::new(
        service
            .resolve(
                &player(),
                &binding(),
                &grant(&registry),
                &CancellationToken::new(),
            )
            .await
            .ok()
            .expect("owned grant resolves"),
    );
    let fetching = {
        let source = source.clone();
        tokio::spawn(async move { source.fetch_root().await })
    };
    observed.await.unwrap();
    let mut changed = enrollment();
    changed.policy_revision = "policy-new".into();
    service
        .enroll(&manager(), changed, config(&base), Some(&revision))
        .unwrap();
    let result = tokio::time::timeout(Duration::from_secs(1), fetching)
        .await
        .unwrap()
        .unwrap();
    assert!(result.is_err());
    release.send(()).unwrap();
    fixture.await.unwrap();
    Arc::try_unwrap(source)
        .ok()
        .expect("fetch released source")
        .finish()
        .await
        .unwrap();
    assert_eq!(registry.retirements(&player(), "session").unwrap().len(), 1);
}

#[tokio::test]
async fn dropping_source_after_promotion_and_focus_retires_exact_reservation() {
    // Resolution of server-enrolled HTTP is metadata-only; this test makes no IO.
    let (registry, service, _) = service("https://fixture.invalid");
    let source = service
        .resolve(
            &player(),
            &binding(),
            &grant(&registry),
            &CancellationToken::new(),
        )
        .await
        .ok()
        .expect("owned grant resolves");
    let reservation = source.reservation().clone();
    let old = binding();
    let mut promoted = old.clone();
    promoted.backend_slot_revision += 1;
    registry
        .prepare_attachment(&player(), &old, &promoted, &reservation)
        .unwrap();
    reservation
        .publication_authority()
        .attach(&reservation.decoder_context(), &mut || Ok(()))
        .unwrap();
    let mut focused = promoted.clone();
    focused.backend_expected.focus_revision += 1;
    focused.native_expected.expected.focus_revision = "focus-next".into();
    registry
        .update_binding(&player(), &promoted, &focused)
        .unwrap();
    assert!(registry
        .validate_reservation(&player(), &old, &reservation)
        .is_ok());
    drop(source);
    let retired = registry.retirements(&player(), "session").unwrap();
    assert_eq!(retired.len(), 1);
    assert_eq!(retired[0].reservation_id, reservation.id());
    assert!(!retired[0].output_revoked);
    assert!(!retired[0].reaped);
}

#[tokio::test]
async fn explicit_cancel_retires_active_publication_before_source_is_dropped() {
    let (registry, service, _) = service("https://fixture.invalid");
    let source = service
        .resolve(
            &player(),
            &binding(),
            &grant(&registry),
            &CancellationToken::new(),
        )
        .await
        .ok()
        .expect("owned grant resolves");
    let reservation = source.reservation().clone();
    let old = binding();
    let mut promoted = old.clone();
    promoted.backend_slot_revision += 1;
    registry
        .prepare_attachment(&player(), &old, &promoted, &reservation)
        .unwrap();
    reservation
        .publication_authority()
        .attach(&reservation.decoder_context(), &mut || Ok(()))
        .unwrap();
    source.cancel();
    assert!(registry
        .validate_reservation(&player(), &old, &reservation)
        .is_err());
    let mut published = false;
    assert!(reservation
        .publication_authority()
        .publish(&reservation.decoder_context(), &mut || {
            published = true;
            Ok(())
        })
        .is_err());
    assert!(!published);
    let retired = registry.retirements(&player(), "session").unwrap();
    assert_eq!(retired.len(), 1);
    assert!(!retired[0].output_revoked);
    assert!(!retired[0].reaped);
    source.finish().await.unwrap();
}

#[tokio::test]
async fn parent_cancellation_monitor_retires_retained_source_within_bound() {
    let (registry, service, _) = service("https://fixture.invalid");
    let owner = CancellationToken::new();
    let source = service
        .resolve(&player(), &binding(), &grant(&registry), &owner)
        .await
        .ok()
        .expect("owned grant resolves");
    let reservation = source.reservation().clone();
    owner.cancel();
    tokio::time::timeout(Duration::from_secs(1), async {
        while registry
            .retirements(&player(), "session")
            .unwrap()
            .is_empty()
        {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .expect("monitor retires even with no next command");
    let mut next = binding();
    next.backend_slot_revision += 1;
    assert!(registry
        .prepare_attachment(&player(), &binding(), &next, &reservation)
        .is_err());
    let retired = registry.retirements(&player(), "session").unwrap();
    assert_eq!(retired[0].reservation_id, reservation.id());
    assert!(!retired[0].output_revoked);
    assert!(!retired[0].reaped);
    source.finish().await.unwrap();
}

#[tokio::test]
async fn finish_retires_before_provider_stop_acknowledgement() {
    let (listener, base) = listener().await;
    let stop = format!("{base}/nas/stream/id.secret/media.stop");
    let media = format!("{base}/video");
    let (stopping, observed) = tokio::sync::oneshot::channel();
    let (release, released) = tokio::sync::oneshot::channel();
    let fixture = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        assert!(read_request(&mut socket)
            .await
            .starts_with("POST /nas/api "));
        let body = serde_json::json!({"url":media,"stop":stop}).to_string();
        socket
            .write_all(
                format!(
                    "HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}",
                    body.len(),
                    body
                )
                .as_bytes(),
            )
            .await
            .unwrap();
        let (mut socket, _) = listener.accept().await.unwrap();
        assert!(read_request(&mut socket)
            .await
            .starts_with("GET /nas/stream/id.secret/media.stop "));
        stopping.send(()).unwrap();
        released.await.unwrap();
        socket
            .write_all(b"HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Length: 0\r\n\r\n")
            .await
            .unwrap();
    });
    let registry = Arc::new(Registry::new("server".into(), "epoch".into()).unwrap());
    let service = SourceService::new(registry.clone());
    let mut enrolled = enrollment();
    enrolled.items[0].input_adapter = "vportal".into();
    service
        .enroll(
            &manager(),
            enrolled,
            BTreeMap::from([(
                "item".into(),
                SourceConfig {
                    source: ServerSource::vportal(
                        &format!("{base}/nas/api"),
                        "fixture-key",
                        serde_json::json!({"id":"7"}),
                    )
                    .unwrap(),
                    transport: CheckedTransport::new(
                        NetworkPolicy::fixture(&[&base]),
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
    let source = service
        .resolve(
            &player(),
            &binding(),
            &grant(&registry),
            &CancellationToken::new(),
        )
        .await
        .ok()
        .expect("owned VPortal resolves");
    let reservation = source.reservation().clone();
    let finishing = tokio::spawn(async move { source.finish().await });
    tokio::time::timeout(Duration::from_secs(1), observed)
        .await
        .unwrap()
        .unwrap();
    assert!(!finishing.is_finished());
    let retired = registry.retirements(&player(), "session").unwrap();
    assert_eq!(retired.len(), 1);
    assert_eq!(retired[0].reservation_id, reservation.id());
    assert!(!retired[0].output_revoked);
    assert!(!retired[0].reaped);
    release.send(()).unwrap();
    finishing.await.unwrap().unwrap();
    fixture.await.unwrap();
}
