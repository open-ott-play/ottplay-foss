//! Isolated in-memory broker tests. No listener, network, source file or decoder.
//! Passing these tests does not qualify a compositor or increase caps above zero.
#[path = "../src/multiview_broker.rs"]
mod broker;

use axum::{
    body::{to_bytes, Body, Bytes},
    http::{HeaderMap, HeaderValue, Request, StatusCode},
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
        atomic::{AtomicU64, Ordering},
        Arc,
    },
};
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
async fn call(broker: &Broker, request: Request<Body>) -> Response {
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
