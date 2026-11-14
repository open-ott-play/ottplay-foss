//! Isolated in-memory broker tests. No listener, network, source file or decoder.
//! Passing these tests does not qualify a compositor or increase caps above zero.
#[path = "../src/multiview_broker.rs"]
mod broker;
#[path = "../src/media_connection.rs"]
mod media_connection;

use axum::{
    body::{to_bytes, Body, Bytes},
    http::{HeaderMap, HeaderValue, Request, StatusCode, Version},
    response::Response,
};
use broker::{
    BoundaryError, Broker, Clock, CredentialConfig, Enrollment, ListenerPolicy, OperatorConfig,
};
use futures_util::StreamExt;
use ottplay_core::multiview::broker::{
    registry::{
        EnrolledInput, Enrollment as SourceEnrollment, ItemEnrollment, Registry, SourcePrincipal,
    },
    wire::*,
};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet},
    net::IpAddr,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc,
    },
    time::Duration,
};
use tokio::io::{AsyncReadExt, AsyncWriteExt, DuplexStream};
use tower::Service;
use uuid::Uuid;

const TOKEN: &str = "fixture_native_credential_aaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER_TOKEN: &str = "fixture_native_credential_bbbbbbbbbbbbbbbbbbbbbbbb";
const ORIGIN: &str = "https://native.example.test";
struct TestClock(AtomicU64);
impl Clock for TestClock {
    fn now_ms(&self) -> u64 {
        self.0.load(Ordering::SeqCst)
    }
}
fn principal() -> Principal {
    Principal {
        subject: "owner_A".into(),
        installation_id: "native_A".into(),
        permissions: BTreeSet::from([Permission::MultiviewControl]),
    }
}
fn operator() -> Principal {
    Principal {
        subject: "operator_A".into(),
        installation_id: "server_A".into(),
        permissions: BTreeSet::from([Permission::SourcesManage]),
    }
}
fn context() -> Binding {
    Binding {
        server_epoch: "epoch_A".into(),
        session_id: "session_A".into(),
        backend_expected: BackendExpected {
            runtime: 1,
            scene: "backend_scene_A".into(),
            geometry_revision: 1,
            focus_revision: 1,
            audio_revision: 1,
        },
        native_expected: NativeExpected {
            runtime: "native_runtime_A".into(),
            expected: NativeRevisions {
                scene: "native_scene_A".into(),
                layout_revision: "layout_A".into(),
                focus_revision: "focus_A".into(),
                audio_revision: "audio_A".into(),
            },
            slot_id: 0,
            slot_generation: "slot_A".into(),
            source_revision: "source_A".into(),
        },
        backend_slot_revision: 1,
    }
}
fn credential(subject: &str, installation: &str, token: &str) -> CredentialConfig {
    CredentialConfig {
        enrollment: Enrollment {
            server_id: "server_A".into(),
            origin: "http://127.0.0.1:8794".into(),
            audience: AUDIENCE.into(),
            installation_id: installation.into(),
            control_bearer: token.into(),
        },
        subject: subject.into(),
        permissions: BTreeSet::from([Permission::MultiviewControl]),
        revision: 1,
        expires_at_ms: 1_000_000,
    }
}
fn config() -> OperatorConfig {
    OperatorConfig {
        server_id: "server_A".into(),
        server_epoch: "epoch_A".into(),
        origin: "http://127.0.0.1:8794".into(),
        listener: ListenerPolicy::default(),
        allowed_origins: vec![ORIGIN.into()],
        signing_key: vec![0x31; 32],
        credentials: vec![
            credential("owner_A", "native_A", TOKEN),
            credential("owner_B", "native_B", OTHER_TOKEN),
        ],
    }
}
fn headers(token: &str) -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(
        "authorization",
        HeaderValue::from_str(&format!("Bearer {token}")).unwrap(),
    );
    headers
}
struct Fixture {
    broker: Broker,
    registry: Arc<Registry>,
    clock: Arc<TestClock>,
    binding: Binding,
    source_revision: String,
}
impl Fixture {
    fn new() -> Self {
        let registry = Arc::new(Registry::new("server_A".into(), "epoch_A".into()).unwrap());
        let binding = context();
        registry.create_session(&principal(), &binding).unwrap();
        let source_revision = registry
            .enroll(
                &operator(),
                SourceEnrollment {
                    source_ref: "source_catalog_A".into(),
                    profile_uuid: Uuid::new_v4(),
                    config_revision: "configuration_A".into(),
                    policy_revision: "policy_A".into(),
                    allowed: BTreeSet::from([SourcePrincipal::from(&principal())]),
                    items: vec![ItemEnrollment {
                        item_ref: "item_A".into(),
                        identity_version: 1,
                        favorite_sha256: "a".repeat(64),
                        kind: "file".into(),
                        input_adapter: "local_owned".into(),
                        protection: Protection {
                            known: true,
                            restricted: false,
                        },
                        descriptor: Descriptor {
                            title: "Synthetic generated item".into(),
                            provider: "local".into(),
                        },
                        input: EnrolledInput { config_index: 7 },
                    }],
                },
                None,
            )
            .unwrap();
        let clock = Arc::new(TestClock(AtomicU64::new(1_000)));
        let broker = Broker::new(config(), Some(registry.clone()), clock.clone()).unwrap();
        Self {
            broker,
            registry,
            clock,
            binding,
            source_revision,
        }
    }
    fn request(&self) -> GrantRequest {
        let sources = self
            .registry
            .sources(
                &principal(),
                &SourcesRequest {
                    version: VERSION,
                    context: self.binding.clone(),
                    cursor: None,
                },
            )
            .unwrap();
        let item = &sources.items[0];
        GrantRequest {
            version: VERSION,
            context: self.binding.clone(),
            next_native: None,
            source_ref: item.source_ref.clone(),
            item_ref: item.item_ref.clone(),
            item_revision: item.item_revision.clone(),
            identity_version: item.identity_version,
            favorite_sha256: item.favorite_sha256.clone(),
            catalog_revision: sources.catalog_revision,
            remaining_budget_ms: 30_000,
        }
    }
    fn output(&self, size: usize, ttl: u32) -> Output {
        let auth = self.broker.authenticate(&headers(TOKEN)).unwrap();
        self.broker.publish_output(&auth, &self.binding, "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:2.0,\nsegment-000000.ts\n#EXT-X-ENDLIST\n", BTreeMap::from([("segment-000000.ts".into(), Bytes::from(vec![0x47; size]))]), ttl).unwrap()
    }
    async fn post(&self, endpoint: &str, value: &impl serde::Serialize, id: &str) -> Response {
        call(
            &self.broker,
            Request::post(format!("/multiview/v1/{endpoint}"))
                .header("authorization", format!("Bearer {TOKEN}"))
                .header("content-type", "application/json")
                .header("x-request-id", id)
                .body(Body::from(serde_json::to_vec(value).unwrap()))
                .unwrap(),
        )
        .await
    }
}
async fn call(broker: &Broker, mut request: Request<Body>) -> Response {
    // Manual body tests have no socket writer. Explicit synthetic ownership
    // admits their body; connection-lifetime tests below use the real helper.
    request
        .extensions_mut()
        .insert(media_connection::ConnectionControl::new());
    broker.router().call(request).await.unwrap()
}

#[tokio::test]
async fn fixture_injection_is_explicit_loopback_only_and_keeps_ordinary_caps_zero() {
    let fixture = || {
        let mut media = ottplay_core::multiview::persistent::Config::new(
            "/not-executed/ffmpeg".into(),
            "/not-executed/ffprobe".into(),
            "/not-created/multiview-boundary-test".into(),
        );
        media.max_duration = std::time::Duration::from_secs(10);
        broker::FixtureConfig {
            media,
            profile: OutputProfile {
                profile_id: "fixture-profile".into(),
                canvas: Canvas {
                    width: 320,
                    height: 180,
                    fps: 5,
                },
                max_inputs: 2,
                geometry_modes: vec![GeometryMode::Disjoint, GeometryMode::Pip],
            },
            input_adapters: vec!["http_mpegts".into()],
        }
    };
    let registry = Arc::new(Registry::new("server_A".into(), "epoch_A".into()).unwrap());
    let clock = Arc::new(TestClock(AtomicU64::new(0)));
    let approved_lan = || {
        let mut configured = config();
        configured.listener = ListenerPolicy {
            bind_ip: "192.168.4.2".parse().unwrap(),
            https: true,
            lan_approved: true,
        };
        configured.origin = "https://compositor.example.test".into();
        for credential in &mut configured.credentials {
            credential.enrollment.origin = configured.origin.clone();
        }
        configured
    };
    assert!(Broker::new(approved_lan(), Some(registry.clone()), clock.clone()).is_ok());
    assert!(matches!(
        Broker::new_fixture(approved_lan(), registry.clone(), clock.clone(), fixture()),
        Err(BoundaryError::Configuration)
    ));
    let ordinary = Broker::new(config(), Some(registry.clone()), clock.clone()).unwrap();
    let (injected, _sources) = Broker::new_fixture(config(), registry, clock, fixture()).unwrap();
    for (server, expected) in [(&ordinary, 0), (&injected, 2)] {
        let response = call(
            server,
            Request::get("/multiview/v1/capabilities")
                .header("authorization", format!("Bearer {TOKEN}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        let value: Value =
            serde_json::from_slice(&to_bytes(response.into_body(), 65_536).await.unwrap()).unwrap();
        assert_eq!(value["max_inputs"], expected);
        assert_eq!(
            value["output_profiles"].as_array().unwrap().len(),
            usize::from(expected != 0)
        );
    }
}
async fn json_body(response: Response) -> Value {
    serde_json::from_slice(
        &to_bytes(response.into_body(), MAX_RESULT_BYTES)
            .await
            .unwrap(),
    )
    .unwrap()
}
async fn get(broker: &Broker, path: &str) -> Response {
    call(broker, Request::get(path).body(Body::empty()).unwrap()).await
}

#[tokio::test]
async fn catalog_cursor_expiration_is_distinct_from_stale_revisions() {
    let fixture = Fixture::new();
    let mut request = SourcesRequest {
        version: VERSION,
        context: fixture.binding.clone(),
        cursor: None,
    };
    let response = fixture.post("sources", &request, "catalog_current").await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        json_body(response).await["items"].as_array().unwrap().len(),
        1
    );

    // Missing/evicted cursors use the same Expired result as a swept cursor;
    // no wall-clock sleeps or private registry state are needed here.
    request.cursor = Some("expired_cursor_A".into());
    let response = fixture.post("sources", &request, "catalog_expired").await;
    assert_eq!(response.status(), StatusCode::GONE);
    assert_eq!(
        json_body(response).await,
        json!({"version": 1, "error": "authority_revoked"})
    );

    request.cursor = None;
    request.context.backend_expected.focus_revision += 1;
    let response = fixture.post("sources", &request, "catalog_stale").await;
    assert_eq!(response.status(), StatusCode::CONFLICT);
    assert_eq!(
        json_body(response).await,
        json!({"version": 1, "error": "revision_conflict"})
    );
}

#[tokio::test]
async fn native_transition_replays_committed_grant_without_reapplying_prior_cas() {
    let fixture = Fixture::new();
    let mut request = fixture.request();
    let mut next = request.context.native_expected.clone();
    next.slot_generation = "slot_B".into();
    next.source_revision = "source_B".into();
    request.next_native = Some(next.clone());
    let body = serde_json::to_value(&request).unwrap();
    let response = fixture.post("input-grants", &body, "transition_A").await;
    assert_eq!(response.status(), StatusCode::OK);
    let grant: GrantResponse = serde_json::from_value(json_body(response).await).unwrap();
    assert_eq!(grant.context.native_expected, next);
    assert_eq!(
        fixture
            .registry
            .current_binding(&principal(), "session_A", 0)
            .unwrap(),
        grant.context
    );
    let replay = fixture.post("input-grants", &body, "transition_A").await;
    assert_eq!(replay.status(), StatusCode::OK);
    let replay: GrantResponse = serde_json::from_value(json_body(replay).await).unwrap();
    assert_eq!(replay.input_grant, grant.input_grant);
    assert_eq!(replay.context, grant.context);
    let mut changed = body.clone();
    changed["next_native"]["source_revision"] = json!("different_intent");
    assert_eq!(
        fixture
            .post("input-grants", &changed, "transition_A")
            .await
            .status(),
        StatusCode::CONFLICT
    );
    assert!(fixture
        .registry
        .redeem(&principal(), &request.context, &grant.input_grant)
        .is_err());
    fixture
        .registry
        .redeem(&principal(), &grant.context, &grant.input_grant)
        .unwrap();
    assert!(!fixture
        .post("input-grants", &body, "transition_A")
        .await
        .status()
        .is_success());
}

#[tokio::test]
async fn native_transition_rejects_occupied_target_before_revoking_existing_work() {
    let fixture = Fixture::new();
    let mut request = fixture.request();
    let grant = fixture.registry.mint(&principal(), &request).unwrap();
    let reservation = fixture
        .registry
        .redeem(&principal(), &request.context, &grant.input_grant)
        .unwrap();
    let mut next = request.context.native_expected.clone();
    next.source_revision = "new_source_intent".into();
    request.next_native = Some(next);
    let response = fixture
        .post(
            "input-grants",
            &serde_json::to_value(request).unwrap(),
            "occupied_A",
        )
        .await;
    assert_eq!(response.status(), StatusCode::CONFLICT);
    assert_eq!(
        fixture
            .registry
            .current_binding(&principal(), "session_A", 0)
            .unwrap(),
        fixture.binding
    );
    assert!(!reservation.revoked().load(Ordering::Acquire));
    assert!(fixture
        .registry
        .validate_reservation(&principal(), &fixture.binding, &reservation)
        .is_ok());
}

#[test]
fn exact_loopback_origins_support_ipv4_and_ipv6_without_relaxing_policy() {
    for (bind_ip, origin) in [
        ("127.0.0.1", "http://127.0.0.1:8794"),
        ("127.0.0.1", "http://127.2.3.4:8794"),
        ("::1", "http://[::1]:8794"),
    ] {
        let mut c = config();
        c.listener.bind_ip = bind_ip.parse().unwrap();
        c.origin = origin.into();
        c.allowed_origins.push(origin.into());
        for credential in &mut c.credentials {
            credential.enrollment.origin = c.origin.clone();
        }
        assert!(
            Broker::new(c, None, Arc::new(TestClock(AtomicU64::new(1_000)))).is_ok(),
            "origin {origin}"
        );
    }

    for origin in [
        "http://localhost:8794",
        "http://192.0.2.1:8794",
        "http://[2001:db8::1]:8794",
        "http://[::]:8794",
        "http://[::ffff:7f00:1]:8794",
        "http://[fe80::1%25en0]:8794",
        "http://[0:0:0:0:0:0:0:1]:8794",
        "http://[::1]:8794/",
        "http://user@[::1]:8794",
        "http://[::1]:8794?query=1",
        "http://[::1]:8794#fragment",
    ] {
        for allowed_only in [false, true] {
            let mut c = config();
            if allowed_only {
                c.allowed_origins.push(origin.into());
            } else {
                c.origin = origin.into();
                for credential in &mut c.credentials {
                    credential.enrollment.origin = c.origin.clone();
                }
            }
            assert!(
                matches!(
                    Broker::new(c, None, Arc::new(TestClock(AtomicU64::new(1_000)))),
                    Err(BoundaryError::Configuration)
                ),
                "origin {origin}, allowed_only {allowed_only}"
            );
        }
    }
}

#[test]
fn pairing_requires_separate_native_authority_and_explicit_lan_tls() {
    for variation in 0..10 {
        let mut c = config();
        match variation {
            0 => c.credentials[0]
                .permissions
                .insert(Permission::SourcesManage),
            1 => {
                c.credentials[0].enrollment.audience = "controller".into();
                false
            }
            2 => {
                c.credentials[0].enrollment.server_id = "other".into();
                false
            }
            3 => {
                c.credentials[0].enrollment.control_bearer = OTHER_TOKEN.into();
                false
            }
            4 => {
                c.listener.bind_ip = "0.0.0.0".parse().unwrap();
                false
            }
            5 => {
                c.listener.bind_ip = "192.168.4.2".parse().unwrap();
                false
            }
            6 => {
                c.allowed_origins = vec!["null".into()];
                false
            }
            7 => {
                c.allowed_origins = vec!["https://*.example.test".into()];
                false
            }
            8 => {
                c.credentials[0].expires_at_ms = 1;
                false
            }
            _ => {
                c.signing_key = TOKEN.as_bytes().to_vec();
                false
            }
        };
        assert!(
            matches!(
                Broker::new(c, None, Arc::new(TestClock(AtomicU64::new(1_000)))),
                Err(BoundaryError::Configuration)
            ),
            "variation {variation}"
        );
    }
    let mut c = config();
    c.listener = ListenerPolicy {
        bind_ip: "192.168.4.2".parse::<IpAddr>().unwrap(),
        https: true,
        lan_approved: true,
    };
    c.origin = "https://compositor.example.test".into();
    for credential in &mut c.credentials {
        credential.enrollment.origin = c.origin.clone();
    }
    assert!(Broker::new(c, None, Arc::new(TestClock(AtomicU64::new(1_000)))).is_ok());
}

#[tokio::test]
async fn native_auth_does_not_trust_origin_host_forwarding_or_loopback() {
    let fixture = Fixture::new();
    for supplied in [None, Some("Bearer wrong"), Some("Basic abc"), Some(TOKEN)] {
        let mut request = Request::get("/multiview/v1/capabilities")
            .header("origin", ORIGIN)
            .header("host", "127.0.0.1")
            .header("x-forwarded-for", "127.0.0.1");
        if let Some(value) = supplied {
            request = request.header("authorization", value);
        }
        assert_eq!(
            call(&fixture.broker, request.body(Body::empty()).unwrap())
                .await
                .status(),
            StatusCode::UNAUTHORIZED
        );
    }
    for origin in [
        "null",
        "https://native.example.test.evil",
        "https://native.example.test/",
    ] {
        assert_eq!(
            call(
                &fixture.broker,
                Request::get("/multiview/v1/capabilities")
                    .header("authorization", format!("Bearer {TOKEN}"))
                    .header("origin", origin)
                    .body(Body::empty())
                    .unwrap()
            )
            .await
            .status(),
            StatusCode::FORBIDDEN
        );
    }
    let response = call(
        &fixture.broker,
        Request::get("/multiview/v1/capabilities")
            .header("authorization", format!("Bearer {TOKEN}"))
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["cache-control"], "no-store");
    let value = json_body(response).await;
    assert_eq!(value["max_inputs"], 0);
    assert_eq!(value["server_epoch"], "epoch_A");
    assert_eq!(value["qualified_input_adapters"], json!([]));
    let mut duplicate = Request::get("/multiview/v1/capabilities")
        .header("authorization", format!("Bearer {TOKEN}"))
        .body(Body::empty())
        .unwrap();
    duplicate.headers_mut().append(
        "authorization",
        HeaderValue::from_str(&format!("Bearer {OTHER_TOKEN}")).unwrap(),
    );
    assert_eq!(
        call(&fixture.broker, duplicate).await.status(),
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn strict_json_limits_and_unqualified_control_never_report_accepted_play() {
    let fixture = Fixture::new();
    for body in [
        "{".to_owned(),
        "{}".into(),
        " ".repeat(MAX_CONTROL_BYTES + 1),
    ] {
        let response = call(
            &fixture.broker,
            Request::post("/multiview/v1/control")
                .header("authorization", format!("Bearer {TOKEN}"))
                .header("content-type", "application/json")
                .header("x-request-id", "request_A")
                .body(Body::from(body))
                .unwrap(),
        )
        .await;
        assert!(response.status().is_client_error());
        assert_eq!(response.headers()["cache-control"], "no-store");
    }
    for op in [
        json!({"name":"play","input_grant":"fixture"}),
        json!({"name":"renew"}),
        json!({"name":"off"}),
    ] {
        let value = json!({"version":1,"context":fixture.binding,"op":op});
        let response = fixture.post("control", &value, "request_A").await;
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(json_body(response).await["error"], "backend_unavailable");
        let mut invalid = value;
        invalid["op"]["url"] = json!("https://unowned.example.test/");
        assert_eq!(
            fixture
                .post("control", &invalid, "request_A")
                .await
                .status(),
            StatusCode::BAD_REQUEST
        );
    }
    let session = json!({"version":1,"server_epoch":"epoch_A","native_expected":fixture.binding.native_expected,"output_profile_id":"fixture_only","geometry":{"canvas":{"width":640,"height":360,"fps":25},"revision":1,"mode":"disjoint","rects":[{"slot_id":0,"x":0,"y":0,"width":640,"height":360,"z":0}]}});
    assert_eq!(
        fixture
            .post("sessions", &session, "create_A")
            .await
            .status(),
        StatusCode::SERVICE_UNAVAILABLE
    );
    let status = json!({"version":1,"server_epoch":"epoch_A","session_id":"session_A","native_expected":fixture.binding.native_expected});
    assert_eq!(
        fixture.post("status", &status, "status_A").await.status(),
        StatusCode::SERVICE_UNAVAILABLE
    );
    assert_eq!(
        fixture
            .post("enroll", &json!({}), "no_enroll")
            .await
            .status(),
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn input_grant_replay_is_scoped_exact_and_reauthorizes_the_source() {
    let fixture = Fixture::new();
    let request = fixture.request();
    let first = fixture.post("input-grants", &request, "request_A").await;
    assert_eq!(first.status(), StatusCode::OK);
    let first = json_body(first).await;
    let again = fixture.post("input-grants", &request, "request_A").await;
    assert_eq!(again.status(), StatusCode::OK);
    let again = json_body(again).await;
    assert_eq!(first["input_grant"], again["input_grant"]);
    assert!(again["expires_in_ms"].as_u64().unwrap() <= first["expires_in_ms"].as_u64().unwrap());
    let mut changed = request.clone();
    changed.remaining_budget_ms -= 1;
    assert_eq!(
        fixture
            .post("input-grants", &changed, "request_A")
            .await
            .status(),
        StatusCode::CONFLICT
    );
    fixture
        .registry
        .remove_source(&operator(), &request.source_ref, &fixture.source_revision)
        .unwrap();
    assert!(!fixture
        .post("input-grants", &request, "request_A")
        .await
        .status()
        .is_success());
}

#[tokio::test]
async fn cached_grants_are_not_returned_after_redemption_credential_revoke_or_expiry() {
    for variation in 0..3 {
        let fixture = Fixture::new();
        let request = fixture.request();
        let first: GrantResponse = serde_json::from_value(
            json_body(fixture.post("input-grants", &request, "request_A").await).await,
        )
        .unwrap();
        match variation {
            0 => {
                fixture
                    .registry
                    .redeem(&principal(), &fixture.binding, &first.input_grant)
                    .unwrap();
            }
            1 => fixture.broker.revoke_credential("owner_A").unwrap(),
            _ => fixture.clock.0.store(1_000_001, Ordering::SeqCst),
        }
        assert!(!fixture
            .post("input-grants", &request, "request_A")
            .await
            .status()
            .is_success());
    }
}

#[tokio::test]
async fn session_and_installation_boundaries_do_not_share_idempotency_or_authority() {
    let fixture = Fixture::new();
    let request = fixture.request();
    let first = json_body(fixture.post("input-grants", &request, "request_A").await).await;
    let other = call(
        &fixture.broker,
        Request::post("/multiview/v1/input-grants")
            .header("authorization", format!("Bearer {OTHER_TOKEN}"))
            .header("content-type", "application/json")
            .header("x-request-id", "request_A")
            .body(Body::from(serde_json::to_vec(&request).unwrap()))
            .unwrap(),
    )
    .await;
    assert!(!other.status().is_success());
    let mut second_context = fixture.binding.clone();
    second_context.session_id = "session_B".into();
    fixture
        .registry
        .create_session(&principal(), &second_context)
        .unwrap();
    let mut second_request = request.clone();
    second_request.context = second_context;
    let second = fixture
        .post("input-grants", &second_request, "request_A")
        .await;
    assert_eq!(second.status(), StatusCode::OK);
    assert_ne!(first["input_grant"], json_body(second).await["input_grant"]);
}

#[tokio::test]
async fn signed_manifest_and_every_segment_require_same_private_prefix() {
    let fixture = Fixture::new();
    let output = fixture.output(188, 10_000);
    assert!(!output.playlist_path.contains(TOKEN));
    let prefix = output.playlist_path.strip_suffix("/index.m3u8").unwrap();
    let response = get(&fixture.broker, &output.playlist_path).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["referrer-policy"], "no-referrer");
    let body = to_bytes(response.into_body(), 65_536).await.unwrap();
    let playlist = std::str::from_utf8(&body).unwrap();
    assert!(playlist.contains(&format!("{prefix}/segment-000000.ts")));
    assert!(!playlist.contains("source_catalog_A"));
    assert_eq!(
        get(&fixture.broker, &format!("{prefix}/segment-000000.ts"))
            .await
            .status(),
        StatusCode::OK
    );
    let mut tampered = prefix.to_string();
    let last = tampered.pop().unwrap();
    tampered.push(if last == 'a' { 'b' } else { 'a' });
    for path in [
        format!("{tampered}/index.m3u8"),
        format!("{tampered}/segment-000000.ts"),
        format!("{prefix}/other.ts"),
        format!("{prefix}/segment-0.ts"),
        format!("{prefix}/segment-%30%30%30%30%30%30.ts"),
        format!("{prefix}/index.m3u8?renew=1"),
    ] {
        assert!(
            !get(&fixture.broker, &path).await.status().is_success(),
            "{path}"
        );
    }
    assert_eq!(
        call(
            &fixture.broker,
            Request::head(&output.playlist_path)
                .body(Body::empty())
                .unwrap()
        )
        .await
        .status(),
        StatusCode::METHOD_NOT_ALLOWED
    );
    assert!(!call(
        &fixture.broker,
        Request::get(&output.playlist_path)
            .header("range", "bytes=0-1")
            .body(Body::empty())
            .unwrap()
    )
    .await
    .status()
    .is_success());
}

#[tokio::test]
async fn body_lifetime_checks_expiry_credential_session_and_replacement() {
    for variation in 0..5 {
        let fixture = Fixture::new();
        let output = fixture.output(131_072, 1_000);
        let segment = output
            .playlist_path
            .replace("index.m3u8", "segment-000000.ts");
        let response = get(&fixture.broker, &segment).await;
        assert_eq!(response.status(), StatusCode::OK);
        let mut body = response.into_body().into_data_stream();
        assert_eq!(body.next().await.unwrap().unwrap().len(), 65_536);
        match variation {
            0 => fixture.clock.0.store(2_001, Ordering::SeqCst),
            1 => fixture.broker.revoke_credential("owner_A").unwrap(),
            2 => {
                fixture
                    .registry
                    .revoke_session(&principal(), &fixture.binding.session_id)
                    .unwrap();
            }
            3 => fixture
                .broker
                .revoke_output(&fixture.binding.session_id)
                .unwrap(),
            _ => {
                fixture.output(188, 1_000);
            }
        }
        assert!(body.next().await.unwrap().is_err(), "variation {variation}");
        assert!(!get(&fixture.broker, &segment).await.status().is_success());
    }
}

#[tokio::test]
async fn unchanged_output_survives_focus_cas_but_new_publication_requires_fresh_binding() {
    let fixture = Fixture::new();
    let output = fixture.output(131_072, 10_000);
    let segment = output
        .playlist_path
        .replace("index.m3u8", "segment-000000.ts");
    let mut body = get(&fixture.broker, &segment)
        .await
        .into_body()
        .into_data_stream();
    assert_eq!(body.next().await.unwrap().unwrap().len(), 65_536);
    let mut next = fixture.binding.clone();
    next.backend_expected.focus_revision += 1;
    fixture
        .registry
        .update_binding(&principal(), &fixture.binding, &next)
        .unwrap();
    assert_eq!(body.next().await.unwrap().unwrap().len(), 65_536);
    let owner = fixture.broker.authenticate(&headers(TOKEN)).unwrap();
    assert!(fixture
        .broker
        .publish_output(
            &owner,
            &fixture.binding,
            "#EXTM3U\nsegment-000000.ts\n",
            BTreeMap::from([("segment-000000.ts".into(), Bytes::from_static(b"fixture"))]),
            1_000
        )
        .is_err());
}

#[tokio::test]
async fn media_reads_do_not_renew_and_custody_requires_separate_reaping() {
    let fixture = Fixture::new();
    let output = fixture.output(188, 1_000);
    assert_eq!(
        fixture
            .broker
            .acknowledge_reaped(&output.session_id, &output.output_generation),
        Err(BoundaryError::Conflict)
    );
    fixture.clock.0.store(1_999, Ordering::SeqCst);
    assert_eq!(
        get(&fixture.broker, &output.playlist_path).await.status(),
        StatusCode::OK
    );
    fixture.clock.0.store(2_000, Ordering::SeqCst);
    assert!(!get(&fixture.broker, &output.playlist_path)
        .await
        .status()
        .is_success());
    fixture.broker.revoke_output(&output.session_id).unwrap();
    fixture
        .broker
        .acknowledge_reaped(&output.session_id, &output.output_generation)
        .unwrap();
    assert!(!get(&fixture.broker, &output.playlist_path)
        .await
        .status()
        .is_success());
}

// Real Hyper owns the writer and is supervised by the same helper as main.
// The tiny duplex buffer deliberately stalls the transport after headers, not
// a fake body's poll_next. Each connection gets a separate control owner.
struct TestConnection {
    client: Option<DuplexStream>,
    task: Option<
        tokio::task::JoinHandle<Result<Result<(), hyper::Error>, media_connection::MediaStop>>,
    >,
    control: media_connection::ConnectionControl,
}
impl TestConnection {
    fn new(app: axum::Router, write_idle: Duration) -> Self {
        let (client, server) = tokio::io::duplex(1_024);
        let control = media_connection::ConnectionControl::with_test_budgets(
            write_idle,
            Duration::from_millis(10),
        );
        let owner = control.clone();
        let requests = control.clone();
        let task = tokio::spawn(async move {
            let io = hyper_util::rt::TokioIo::new(owner.watch_io(server));
            owner
                .supervise(hyper::server::conn::http1::Builder::new().serve_connection(
                    io,
                    hyper::service::service_fn(
                        move |mut request: Request<hyper::body::Incoming>| {
                            let mut app = app.clone();
                            let requests = requests.clone();
                            let version = request.version();
                            request.extensions_mut().insert(requests.clone());
                            async move {
                                let response = app.call(request).await.unwrap();
                                let response = requests
                                    .prepare_response(response, version)
                                    .unwrap_or_else(|_| {
                                        Response::builder()
                                            .status(StatusCode::SERVICE_UNAVAILABLE)
                                            .header("content-type", "application/json")
                                            .body(Body::from(
                                                r#"{"version":1,"error":"backend_unavailable"}"#,
                                            ))
                                            .unwrap()
                                    });
                                Ok::<_, std::convert::Infallible>(response)
                            }
                        },
                    ),
                ))
                .await
        });
        Self {
            client: Some(client),
            task: Some(task),
            control,
        }
    }

    async fn begin(&mut self, path: &str) -> String {
        self.begin_with_close(path, false).await
    }

    async fn begin_with_close(&mut self, path: &str, close: bool) -> String {
        let client = self.client.as_mut().unwrap();
        let connection_header = if close { "Connection: close\r\n" } else { "" };
        tokio::time::timeout(Duration::from_secs(2), async {
            client
                .write_all(
                    format!(
                        "GET {path} HTTP/1.1\r\nHost: fixture.invalid\r\n{connection_header}\r\n"
                    )
                    .as_bytes(),
                )
                .await
                .unwrap();
            let mut head = Vec::new();
            while !head.ends_with(b"\r\n\r\n") {
                assert!(
                    head.len() < 8_192,
                    "response headers exceeded fixture bound"
                );
                head.push(client.read_u8().await.unwrap());
            }
            String::from_utf8(head).unwrap()
        })
        .await
        .expect("Hyper response headers did not arrive")
    }

    async fn finished(&mut self) -> Result<Result<(), hyper::Error>, media_connection::MediaStop> {
        let task = self.task.as_mut().unwrap();
        match tokio::time::timeout(Duration::from_secs(2), &mut *task).await {
            Ok(result) => {
                self.task.take();
                result.expect("owned connection task panicked")
            }
            Err(_) => {
                task.abort();
                let _ = task.await;
                self.task.take();
                panic!("owned connection did not terminate within fixture bound");
            }
        }
    }

    async fn close(mut self) {
        self.client.take();
        let _ = self.finished().await;
    }
}
impl Drop for TestConnection {
    fn drop(&mut self) {
        // Abort also drops the actual Hyper future and socket on a failed test.
        // Successful paths explicitly join; no detached watchdog is spawned.
        if let Some(task) = self.task.take() {
            task.abort();
        }
    }
}

#[tokio::test]
async fn media_missing_connection_and_http2_fail_before_stream_admission() {
    let fixture = Fixture::new();
    let output = fixture.output(188, 10_000);
    let response = fixture
        .broker
        .router()
        .call(
            Request::get(&output.playlist_path)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert!(response
        .extensions()
        .get::<media_connection::MediaLease>()
        .is_none());
    assert_eq!(
        json_body(response).await,
        json!({"version": 1, "error": "backend_unavailable"})
    );

    let control = media_connection::ConnectionControl::new();
    let mut request = Request::get(&output.playlist_path)
        .version(Version::HTTP_2)
        .body(Body::empty())
        .unwrap();
    request.extensions_mut().insert(control.clone());
    let response = fixture.broker.router().call(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert!(response
        .extensions()
        .get::<media_connection::MediaLease>()
        .is_none());
    assert!(!response.headers().contains_key("connection"));
    assert!(!control.is_armed_for_test());
    assert_eq!(
        json_body(response).await,
        json!({"version": 1, "error": "backend_unavailable"})
    );

    let mut held = Vec::new();
    for _ in 0..8 {
        let response = get(&fixture.broker, &output.playlist_path).await;
        assert_eq!(response.status(), StatusCode::OK);
        held.push(response);
    }
}

#[tokio::test]
async fn eight_stalled_hyper_connections_hold_permits_until_transport_drop() {
    let fixture = Fixture::new();
    let output = fixture.output(131_072, 10_000);
    let segment = output
        .playlist_path
        .replace("index.m3u8", "segment-000000.ts");
    let mut held = Vec::new();
    for _ in 0..8 {
        let mut connection = TestConnection::new(fixture.broker.router(), Duration::from_secs(5));
        let head = connection.begin(&segment).await;
        assert!(head.starts_with("HTTP/1.1 200 "));
        assert!(head.to_ascii_lowercase().contains("connection: close\r\n"));
        assert!(connection.control.is_armed_for_test());
        held.push(connection);
    }
    assert_eq!(
        get(&fixture.broker, &segment).await.status(),
        StatusCode::TOO_MANY_REQUESTS
    );
    held.pop().unwrap().close().await;
    assert_eq!(
        get(&fixture.broker, &segment).await.status(),
        StatusCode::OK
    );
    for connection in held {
        connection.close().await;
    }
}

#[tokio::test]
async fn unpolled_media_connections_end_on_current_authority_without_fake_reaping() {
    for variation in 0..5 {
        let fixture = Fixture::new();
        let output = fixture.output(131_072, 1_000);
        let segment = output
            .playlist_path
            .replace("index.m3u8", "segment-000000.ts");
        let mut connection = TestConnection::new(fixture.broker.router(), Duration::from_secs(5));
        assert!(connection
            .begin(&segment)
            .await
            .starts_with("HTTP/1.1 200 "));
        // Let Hyper fill the tiny writer after headers; no body bytes are read.
        tokio::time::sleep(Duration::from_millis(30)).await;
        assert_eq!(
            fixture
                .broker
                .acknowledge_reaped(&output.session_id, &output.output_generation),
            Err(BoundaryError::Conflict)
        );
        match variation {
            0 => fixture.clock.0.store(2_001, Ordering::SeqCst),
            1 => fixture.broker.revoke_credential("owner_A").unwrap(),
            2 => {
                fixture
                    .registry
                    .revoke_session(&principal(), &fixture.binding.session_id)
                    .unwrap();
            }
            3 => fixture
                .broker
                .revoke_output(&fixture.binding.session_id)
                .unwrap(),
            _ => {
                fixture.output(188, 1_000);
            }
        }
        assert!(
            matches!(
                connection.finished().await,
                Err(media_connection::MediaStop::AuthorityRevoked)
            ),
            "variation {variation}"
        );
        assert!(!connection.control.is_armed_for_test());
        // Network termination releases custody only; owner acknowledgment still
        // requires an explicit output tombstone and remains a separate action.
        if variation < 3 {
            assert_eq!(
                fixture
                    .broker
                    .acknowledge_reaped(&output.session_id, &output.output_generation),
                Err(BoundaryError::Conflict)
            );
            fixture
                .broker
                .revoke_output(&fixture.binding.session_id)
                .unwrap();
        }
        fixture
            .broker
            .acknowledge_reaped(&output.session_id, &output.output_generation)
            .unwrap();
    }
}

#[tokio::test]
async fn stalled_media_write_deadline_drops_real_connection_and_releases_admission() {
    let fixture = Fixture::new();
    let output = fixture.output(131_072, 10_000);
    let segment = output
        .playlist_path
        .replace("index.m3u8", "segment-000000.ts");
    let mut connection = TestConnection::new(fixture.broker.router(), Duration::from_millis(100));
    assert!(connection
        .begin(&segment)
        .await
        .starts_with("HTTP/1.1 200 "));
    assert!(matches!(
        connection.finished().await,
        Err(media_connection::MediaStop::WriteIdle)
    ));
    assert!(!connection.control.is_armed_for_test());
    // Timeout is transport cleanup, not fabricated revocation/worker proof.
    assert_eq!(
        fixture
            .broker
            .acknowledge_reaped(&output.session_id, &output.output_generation),
        Err(BoundaryError::Conflict)
    );
    let mut held = Vec::new();
    for _ in 0..8 {
        let response = get(&fixture.broker, &segment).await;
        assert_eq!(response.status(), StatusCode::OK);
        held.push(response);
    }
}

#[tokio::test]
async fn healthy_hyper_progress_and_unchanged_focus_keep_media_authorized() {
    let fixture = Fixture::new();
    let output = fixture.output(131_072, 10_000);
    let segment = output
        .playlist_path
        .replace("index.m3u8", "segment-000000.ts");
    let mut connection = TestConnection::new(fixture.broker.router(), Duration::from_secs(5));
    assert!(connection
        .begin(&segment)
        .await
        .starts_with("HTTP/1.1 200 "));
    let mut next = fixture.binding.clone();
    next.backend_expected.focus_revision += 1;
    fixture
        .registry
        .update_binding(&principal(), &fixture.binding, &next)
        .unwrap();
    // Give independent authority checks time to run while the socket is full.
    // Use a generous write budget: helper clock-state tests qualify deadline
    // refresh, while this test qualifies real writes and unchanged-source CAS.
    tokio::time::sleep(Duration::from_millis(30)).await;
    assert!(!connection.task.as_ref().unwrap().is_finished());
    let mut body = Vec::new();
    let mut chunk = [0u8; 1_024];
    for _ in 0..12 {
        let count = tokio::time::timeout(
            Duration::from_secs(2),
            connection.client.as_mut().unwrap().read(&mut chunk),
        )
        .await
        .unwrap()
        .unwrap();
        assert_ne!(count, 0);
        body.extend_from_slice(&chunk[..count]);
        assert!(!connection.task.as_ref().unwrap().is_finished());
    }
    tokio::time::timeout(
        Duration::from_secs(2),
        connection.client.as_mut().unwrap().read_to_end(&mut body),
    )
    .await
    .unwrap()
    .unwrap();
    assert!(body.len() >= 131_072);
    assert!(matches!(connection.finished().await, Ok(Ok(()))));
    assert!(!connection.control.is_armed_for_test());
}

#[tokio::test]
async fn private_media_revocation_and_timeout_do_not_arm_or_cancel_public_connection() {
    for revoke in [false, true] {
        let fixture = Fixture::new();
        let output = fixture.output(131_072, 10_000);
        let segment = output
            .playlist_path
            .replace("index.m3u8", "segment-000000.ts");
        let private_idle = if revoke {
            Duration::from_secs(5)
        } else {
            Duration::from_millis(100)
        };
        let mut private = TestConnection::new(fixture.broker.router(), private_idle);
        assert!(private.begin(&segment).await.starts_with("HTTP/1.1 200 "));
        let public_app = axum::Router::new().route(
            "/public",
            axum::routing::get(|| async { Bytes::from(vec![0x55; 131_072]) }),
        );
        let mut public = TestConnection::new(public_app, Duration::from_millis(100));
        assert!(public
            .begin_with_close("/public", true)
            .await
            .starts_with("HTTP/1.1 200 "));
        assert!(!public.control.is_armed_for_test());
        if revoke {
            fixture
                .broker
                .revoke_output(&fixture.binding.session_id)
                .unwrap();
        }
        let result = private.finished().await;
        assert!(matches!(
            (revoke, result),
            (true, Err(media_connection::MediaStop::AuthorityRevoked))
                | (false, Err(media_connection::MediaStop::WriteIdle))
        ));
        tokio::time::sleep(Duration::from_millis(150)).await;
        assert!(!public.task.as_ref().unwrap().is_finished());
        assert!(!public.control.is_armed_for_test());
        let mut bytes = Vec::new();
        tokio::time::timeout(
            Duration::from_secs(2),
            public.client.as_mut().unwrap().read_to_end(&mut bytes),
        )
        .await
        .unwrap()
        .unwrap();
        assert!(bytes.len() >= 131_072);
        assert!(matches!(public.finished().await, Ok(Ok(()))));
    }
}

#[tokio::test]
async fn streaming_permits_remain_owned_until_body_drop() {
    let fixture = Fixture::new();
    let output = fixture.output(188, 10_000);
    let mut held = Vec::new();
    for _ in 0..8 {
        let response = get(&fixture.broker, &output.playlist_path).await;
        assert_eq!(response.status(), StatusCode::OK);
        held.push(response);
    }
    assert_eq!(
        get(&fixture.broker, &output.playlist_path).await.status(),
        StatusCode::TOO_MANY_REQUESTS
    );
    held.pop();
    assert_eq!(
        get(&fixture.broker, &output.playlist_path).await.status(),
        StatusCode::OK
    );
}

#[tokio::test]
async fn revoked_body_custody_is_not_removed_from_the_global_output_budget() {
    let fixture = Fixture::new();
    let output = fixture.output(188, 10_000);
    let held = get(&fixture.broker, &output.playlist_path).await;
    assert_eq!(held.status(), StatusCode::OK);
    fixture.broker.revoke_output(&output.session_id).unwrap();
    assert_eq!(
        fixture
            .broker
            .acknowledge_reaped(&output.session_id, &output.output_generation),
        Err(BoundaryError::Conflict)
    );
    drop(held);
    fixture
        .broker
        .acknowledge_reaped(&output.session_id, &output.output_generation)
        .unwrap();
}

#[tokio::test]
async fn removing_and_readding_an_active_source_blocks_output_before_worker_reaping() {
    let mut fixture = Fixture::new();
    let request = fixture.request();
    let grant = fixture.registry.mint(&principal(), &request).unwrap();
    let reservation = fixture
        .registry
        .redeem(&principal(), &fixture.binding, &grant.input_grant)
        .unwrap();
    let mut next = fixture.binding.clone();
    next.backend_slot_revision += 1;
    fixture
        .registry
        .prepare_attachment(&principal(), &fixture.binding, &next, &reservation)
        .unwrap();
    // This bounded no-op exercises the real registry attachment transaction,
    // not a decoder or compositor. No source is opened and caps remains zero.
    reservation
        .publication_authority()
        .attach(&reservation.decoder_context(), &mut || Ok(()))
        .unwrap();
    fixture.registry.authorize(&principal(), &next).unwrap();
    fixture.binding = next;
    let output = fixture.output(131_072, 10_000);
    let segment = output
        .playlist_path
        .replace("index.m3u8", "segment-000000.ts");
    let mut body = get(&fixture.broker, &segment)
        .await
        .into_body()
        .into_data_stream();
    assert_eq!(body.next().await.unwrap().unwrap().len(), 65_536);
    let retirements = fixture
        .registry
        .remove_source(&operator(), &request.source_ref, &fixture.source_revision)
        .unwrap();
    assert_eq!(retirements.len(), 1);
    assert!(retirements[0].cancellation_requested);
    assert!(!retirements[0].output_revoked && !retirements[0].reaped);
    assert!(body.next().await.unwrap().is_err());
    assert!(!get(&fixture.broker, &segment).await.status().is_success());
    fixture
        .registry
        .enroll(
            &operator(),
            SourceEnrollment {
                source_ref: request.source_ref.clone(),
                profile_uuid: Uuid::new_v4(),
                config_revision: "configuration_B".into(),
                policy_revision: "policy_B".into(),
                allowed: BTreeSet::from([SourcePrincipal::from(&principal())]),
                items: vec![ItemEnrollment {
                    item_ref: request.item_ref.clone(),
                    identity_version: 1,
                    favorite_sha256: request.favorite_sha256.clone(),
                    kind: "file".into(),
                    input_adapter: "local_owned".into(),
                    protection: Protection {
                        known: true,
                        restricted: false,
                    },
                    descriptor: Descriptor {
                        title: "Replacement fixture".into(),
                        provider: "local".into(),
                    },
                    input: EnrolledInput { config_index: 8 },
                }],
            },
            None,
        )
        .unwrap();
    assert!(!get(&fixture.broker, &segment).await.status().is_success());
    assert!(fixture
        .registry
        .rearm_output(&principal(), &fixture.binding)
        .is_err());
}

#[test]
fn credential_revocation_cancels_active_source_authority_before_cleanup() {
    let fixture = Fixture::new();
    let request = fixture.request();
    let grant = fixture.registry.mint(&principal(), &request).unwrap();
    let reservation = fixture
        .registry
        .redeem(&principal(), &fixture.binding, &grant.input_grant)
        .unwrap();
    let mut next = fixture.binding.clone();
    next.backend_slot_revision += 1;
    fixture
        .registry
        .prepare_attachment(&principal(), &fixture.binding, &next, &reservation)
        .unwrap();
    reservation
        .publication_authority()
        .attach(&reservation.decoder_context(), &mut || Ok(()))
        .unwrap();
    assert!(!reservation.revoked().load(Ordering::Acquire));
    fixture.broker.revoke_credential("owner_A").unwrap();
    assert!(reservation.revoked().load(Ordering::Acquire));
    assert!(fixture.registry.authorize(&principal(), &next).is_err());
    // Cancel requested does not manufacture a worker-reaped receipt.
    let retirements = fixture
        .registry
        .retirements(&principal(), &next.session_id)
        .unwrap();
    assert_eq!(retirements.len(), 1);
    assert!(!retirements[0].reaped);
}

#[test]
fn generated_output_rejects_external_child_key_uri_and_unlisted_resource() {
    let fixture = Fixture::new();
    let owner = fixture.broker.authenticate(&headers(TOKEN)).unwrap();
    for playlist in ["#EXTM3U\nhttps://unowned.example.test/a.ts\n", "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"https://unowned.example.test/key\"\nsegment-000000.ts\n", "#EXTM3U\n../segment-000000.ts\n", "#EXTM3U\nsegment-000001.ts\n"] {
        assert_eq!(fixture.broker.publish_output(&owner, &fixture.binding, playlist, BTreeMap::from([("segment-000000.ts".into(), Bytes::from_static(b"fixture"))]), 1_000), Err(BoundaryError::Invalid));
    }
}

// The owner thread has its own finite hold deadline. Even the old blocking
// media implementation cannot hang a current-thread runtime forever: it wakes
// after five seconds, then fails the two-second elapsed/held assertions below.
struct HeldMediaMutex {
    release: Option<std::sync::mpsc::Sender<()>>,
    thread: Option<std::thread::JoinHandle<()>>,
    held: Arc<AtomicBool>,
}
impl HeldMediaMutex {
    fn new(fixture: &Fixture, registry_lock: bool) -> Self {
        let (entered_tx, entered_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let held = Arc::new(AtomicBool::new(false));
        let worker_held = held.clone();
        let broker = fixture.broker.clone();
        let registry = fixture.registry.clone();
        let session = fixture.binding.session_id.clone();
        let thread = std::thread::spawn(move || {
            let wait = || {
                worker_held.store(true, Ordering::SeqCst);
                entered_tx.send(()).expect("held-lock receiver disappeared");
                let _ = release_rx.recv_timeout(Duration::from_secs(5));
                worker_held.store(false, Ordering::SeqCst);
            };
            if registry_lock {
                registry
                    .with_session_authority(&principal(), &session, &mut || {
                        wait();
                        Ok(())
                    })
                    .expect("fixture session must authorize the lock holder");
            } else {
                broker.with_mutable_lock_for_test(wait);
            }
        });
        let owner = Self {
            release: Some(release_tx),
            thread: Some(thread),
            held,
        };
        // Construct the RAII owner first so an assertion failure still releases
        // and joins the worker. No sleep is used to guess mutex acquisition.
        entered_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("fixture mutex was not acquired within its bound");
        assert!(owner.is_held());
        owner
    }

    fn is_held(&self) -> bool {
        self.held.load(Ordering::SeqCst)
    }

    fn release(mut self) {
        let _ = self.release.take().unwrap().send(());
        self.thread
            .take()
            .unwrap()
            .join()
            .expect("held-lock worker panicked");
        assert!(!self.is_held());
    }
}
impl Drop for HeldMediaMutex {
    fn drop(&mut self) {
        if let Some(release) = self.release.take() {
            let _ = release.send(());
        }
        if let Some(thread) = self.thread.take() {
            // Do not double-panic during test unwinding. The finite worker
            // deadline also bounds this join if an assertion failed elsewhere.
            let _ = thread.join();
        }
    }
}

async fn media_mutex_contention_fails_closed_then_recovers(registry_lock: bool) {
    // Fixture and router retain their broker while the worker holds its mutex;
    // this test never asks a last-owner shutdown to run under that lock.
    let fixture = Fixture::new();
    let output = fixture.output(131_072, 10_000);
    let segment = output
        .playlist_path
        .replace("index.m3u8", "segment-000000.ts");
    let response = get(&fixture.broker, &segment).await;
    assert_eq!(response.status(), StatusCode::OK);
    let mut body = response.into_body().into_data_stream();
    let mut connection = TestConnection::new(fixture.broker.router(), Duration::from_secs(30));
    assert!(connection
        .begin(&segment)
        .await
        .starts_with("HTTP/1.1 200 "));
    assert!(connection.control.is_armed_for_test());

    let held = HeldMediaMutex::new(&fixture, registry_lock);
    let started = std::time::Instant::now();
    let chunk = tokio::time::timeout(Duration::from_secs(2), body.next())
        .await
        .expect("body authority check waited for a contended mutex");
    assert!(matches!(chunk, Some(Err(_))), "no new chunk may escape");
    // A Tokio timeout cannot preempt a blocking first poll; elapsed and held
    // checks catch that old behavior after the worker's independent deadline.
    assert!(started.elapsed() < Duration::from_secs(2));
    assert!(held.is_held());
    assert!(
        body.next().await.is_none(),
        "denied body must stay terminal"
    );

    let started = std::time::Instant::now();
    let denied = tokio::time::timeout(Duration::from_secs(2), get(&fixture.broker, &segment))
        .await
        .expect("media admission waited for a contended mutex");
    assert!(started.elapsed() < Duration::from_secs(2));
    assert!(held.is_held());
    assert_eq!(denied.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert!(denied
        .extensions()
        .get::<media_connection::MediaLease>()
        .is_none());
    assert_eq!(
        json_body(denied).await,
        json!({"version": 1, "error": "backend_unavailable"})
    );

    tokio::time::timeout(
        Duration::from_secs(2),
        tokio::time::sleep(Duration::from_millis(10)),
    )
    .await
    .expect("current-thread timer could not progress under media contention");
    assert!(held.is_held());
    // Either per-chunk authority or the independent connection check can win.
    // Both must terminate the real Hyper future while the lock is still held;
    // an idle timeout (30s here), manual body drop, or lock release cannot pass.
    assert!(matches!(
        connection.finished().await,
        Err(media_connection::MediaStop::AuthorityRevoked) | Ok(Err(_))
    ));
    assert!(held.is_held());
    assert!(!connection.control.is_armed_for_test());
    held.release();

    // Busy/poison is a transport refusal, not persisted authority revocation.
    // The failed manual body still owns exactly one permit; the real Hyper
    // connection released its own permit on completion, not merely body EOF.
    assert_eq!(
        fixture
            .broker
            .acknowledge_reaped(&output.session_id, &output.output_generation),
        Err(BoundaryError::Conflict)
    );
    let mut admitted = Vec::new();
    for _ in 0..7 {
        let response = get(&fixture.broker, &segment).await;
        assert_eq!(response.status(), StatusCode::OK);
        admitted.push(response);
    }
    assert_eq!(
        get(&fixture.broker, &segment).await.status(),
        StatusCode::TOO_MANY_REQUESTS
    );
    drop(body);
    let response = get(&fixture.broker, &segment).await;
    assert_eq!(response.status(), StatusCode::OK);
    admitted.push(response);
    assert_eq!(
        get(&fixture.broker, &segment).await.status(),
        StatusCode::TOO_MANY_REQUESTS
    );
    fixture.broker.revoke_output(&output.session_id).unwrap();
    assert_eq!(
        fixture
            .broker
            .acknowledge_reaped(&output.session_id, &output.output_generation),
        Err(BoundaryError::Conflict)
    );
    drop(admitted);
    fixture
        .broker
        .acknowledge_reaped(&output.session_id, &output.output_generation)
        .unwrap();
}

#[tokio::test(flavor = "current_thread")]
async fn registry_mutex_contention_denies_media_without_blocking_executor_and_recovers() {
    media_mutex_contention_fails_closed_then_recovers(true).await;
}

#[tokio::test(flavor = "current_thread")]
async fn broker_mutex_contention_denies_media_without_blocking_executor_and_recovers() {
    media_mutex_contention_fails_closed_then_recovers(false).await;
}
