//! Explicit operator activation of the private, zero-capacity broker shell.
//! Endpoint selection uses trusted listener metadata, never request headers.
//! This service creates no media backend, source service, task or listener.
use crate::multiview_broker::{Broker, OperatorConfig, SystemClock};
use anyhow::{ensure, Result};
use axum::{
    extract::Request,
    http::StatusCode,
    middleware::{from_fn, Next},
    response::IntoResponse,
    Router,
};
use std::{
    net::{IpAddr, SocketAddr},
    sync::Arc,
};
use tower::Service as _;

/// Construct from the parsed CLI plan before binding, and from local_addr() and
/// the actual HTTP/TLS serving branch afterwards. This is not a wire type.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct ListenerEndpoint {
    pub local_addr: SocketAddr,
    pub tls: bool,
}

pub(crate) struct Service {
    selected: ListenerEndpoint,
    broker: Broker,
}

/// Dispatch the entire private namespace outside public CORS, including unknown
/// private paths. CorsLayer answers OPTIONS without calling its inner service,
/// including a fallback, so merging only known private routes is insufficient.
pub(crate) fn route_for_listener(
    app: Router,
    private: Option<&Service>,
    actual: ListenerEndpoint,
) -> Router {
    let router = private.and_then(|service| service.router_for(actual));
    app.layer(from_fn(move |request: Request, next: Next| {
        let mut private = router.clone();
        async move {
            let path = request.uri().path();
            if path == "/multiview/v1" || path.starts_with("/multiview/v1/") {
                return match private.as_mut() {
                    Some(router) => match router.call(request).await {
                        Ok(response) => response,
                        Err(never) => match never {},
                    },
                    None => {
                        (StatusCode::NOT_FOUND, [("cache-control", "no-store")]).into_response()
                    }
                };
            }
            next.run(request).await
        }
    }))
}

fn explicit_private_or_loopback(ip: IpAddr) -> bool {
    ip.is_loopback()
        || match ip {
            IpAddr::V4(ip) => ip.is_private() && !ip.is_unspecified(),
            IpAddr::V6(ip) => ip.segments()[0] & 0xfe00 == 0xfc00,
        }
}

impl Service {
    /// Validate the complete operator configuration before any socket is bound.
    /// A DNS origin is allowed for TLS identity; its address is not resolved or
    /// used to replace the explicitly configured listener IP.
    pub(crate) fn new(config: OperatorConfig, planned: &[ListenerEndpoint]) -> Result<Self> {
        let origin = reqwest::Url::parse(&config.origin)
            .map_err(|_| anyhow::anyhow!("Invalid private multiview origin"))?;
        let tls = match origin.scheme() {
            "http" => false,
            "https" => true,
            _ => anyhow::bail!("Invalid private multiview transport"),
        };
        let port = origin
            .port_or_known_default()
            .ok_or_else(|| anyhow::anyhow!("Invalid private multiview port"))?;
        ensure!(
            port != 0
                && planned
                    .iter()
                    .all(|endpoint| endpoint.local_addr.port() != 0),
            "Private multiview requires fixed listener ports"
        );
        ensure!(
            explicit_private_or_loopback(config.listener.bind_ip),
            "Private multiview requires an explicit loopback or private listener IP"
        );
        ensure!(
            tls == config.listener.https,
            "Private multiview origin and listener transport must match"
        );
        let selected = ListenerEndpoint {
            local_addr: SocketAddr::new(config.listener.bind_ip, port),
            tls,
        };
        ensure!(
            planned
                .iter()
                .filter(|endpoint| **endpoint == selected)
                .count()
                == 1,
            "Private multiview must match exactly one configured listener"
        );
        // Dedicated credentials and origin policy are validated by the broker.
        // None deliberately preserves zero capacity and unavailable controls.
        let broker = Broker::new(config, None, Arc::new(SystemClock::default()))
            .map_err(|_| anyhow::anyhow!("Invalid private multiview configuration"))?;
        Ok(Self { selected, broker })
    }

    /// Call after all existing listeners are bound and before starting any of
    /// them. A mismatch aborts startup rather than exposing a partial service.
    pub(crate) fn validate_bound(&self, bound: &[ListenerEndpoint]) -> Result<()> {
        ensure!(
            bound
                .iter()
                .filter(|endpoint| **endpoint == self.selected)
                .count()
                == 1,
            "Private multiview does not match the bound listener"
        );
        Ok(())
    }

    /// Called by the outer namespace dispatcher for this concrete endpoint.
    /// An HTTP listener cannot inherit a private router selected for HTTPS.
    pub(crate) fn router_for(&self, actual: ListenerEndpoint) -> Option<Router> {
        (actual == self.selected).then(|| self.broker.router())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::multiview_broker::{CredentialConfig, Enrollment, ListenerPolicy};
    use axum::{
        body::{to_bytes, Body},
        http::{Method, Request as HttpRequest},
        routing::get,
    };
    use ottplay_core::multiview::broker::wire::{self, Permission};
    use tower::Service as _;
    use tower_http::cors::{Any, CorsLayer};

    const ORIGIN: &str = "https://fixture.example.test";
    const TOKEN: &str = "synthetic-private-route-token-0000000001";

    fn endpoint(port: u16, tls: bool) -> ListenerEndpoint {
        ListenerEndpoint {
            local_addr: ([127, 0, 0, 1], port).into(),
            tls,
        }
    }

    fn public_routes() -> Router {
        Router::new()
            .route("/health", get(|| async { "OK" }))
            .layer(
                CorsLayer::new()
                    .allow_origin(Any)
                    .allow_methods(Any)
                    .allow_headers(Any),
            )
    }

    fn configured() -> Service {
        Service::new(
            OperatorConfig {
                server_id: "fixture-server".into(),
                server_epoch: "fixture-epoch".into(),
                origin: "http://127.0.0.1:8080".into(),
                listener: ListenerPolicy::default(),
                allowed_origins: vec![ORIGIN.into()],
                signing_key: vec![0x31; 32],
                credentials: vec![CredentialConfig {
                    enrollment: Enrollment {
                        server_id: "fixture-server".into(),
                        origin: "http://127.0.0.1:8080".into(),
                        audience: wire::AUDIENCE.into(),
                        installation_id: "fixture-installation".into(),
                        control_bearer: TOKEN.into(),
                    },
                    subject: "fixture-owner".into(),
                    permissions: [Permission::MultiviewControl].into_iter().collect(),
                    revision: 1,
                    expires_at_ms: u64::MAX,
                }],
            },
            &[endpoint(8080, false)],
        )
        .unwrap()
    }

    fn request(method: Method, path: &str) -> HttpRequest<Body> {
        HttpRequest::builder()
            .method(method)
            .uri(path)
            .header("origin", ORIGIN)
            .header("access-control-request-method", "GET")
            .header("access-control-request-headers", "authorization")
            .body(Body::empty())
            .unwrap()
    }

    #[tokio::test]
    async fn disabled_namespace_precedes_public_cors_for_every_method() {
        let service = configured();
        for (private, actual) in [
            (None, endpoint(8080, false)),
            (Some(&service), endpoint(8081, false)),
            (Some(&service), endpoint(8080, true)),
        ] {
            let mut app = route_for_listener(public_routes(), private, actual);
            for path in [
                "/multiview/v1",
                "/multiview/v1/",
                "/multiview/v1/capabilities",
                "/multiview/v1/media/unknown/index.m3u8",
            ] {
                for method in [Method::GET, Method::POST, Method::OPTIONS, Method::HEAD] {
                    let response = app.call(request(method, path)).await.unwrap();
                    assert_eq!(response.status(), StatusCode::NOT_FOUND);
                    assert!(response
                        .headers()
                        .keys()
                        .all(|h| !h.as_str().starts_with("access-control-")));
                }
            }
            for path in ["/health", "/multiview/v10/capabilities", "/unrelated"] {
                let response = app.call(request(Method::OPTIONS, path)).await.unwrap();
                assert_eq!(response.status(), StatusCode::OK);
                assert_eq!(response.headers()["access-control-allow-origin"], "*");
            }
            let response = app.call(request(Method::GET, "/health")).await.unwrap();
            assert_eq!(response.status(), StatusCode::OK);
            assert_eq!(
                to_bytes(response.into_body(), 16).await.unwrap().as_ref(),
                b"OK"
            );
        }
    }

    #[tokio::test]
    async fn selected_endpoint_uses_dedicated_auth_cors_and_zero_capacity() {
        let service = configured();
        let mut app = route_for_listener(public_routes(), Some(&service), endpoint(8080, false));
        // Unknown private paths must remain private too: public fallback CORS
        // must not synthesize a successful preflight on the selected endpoint.
        for path in ["/multiview/v1", "/multiview/v1/", "/multiview/v1/unknown"] {
            for origin in [ORIGIN, "https://untrusted.example.test"] {
                let mut unknown = request(Method::OPTIONS, path);
                unknown
                    .headers_mut()
                    .insert("origin", origin.parse().unwrap());
                let response = app.call(unknown).await.unwrap();
                assert_eq!(response.status(), StatusCode::NOT_FOUND);
                assert!(response
                    .headers()
                    .keys()
                    .all(|h| !h.as_str().starts_with("access-control-")));
            }
        }
        let preflight = app
            .call(request(Method::OPTIONS, "/multiview/v1/capabilities"))
            .await
            .unwrap();
        assert_eq!(preflight.status(), StatusCode::NO_CONTENT);
        assert_eq!(preflight.headers()["access-control-allow-origin"], ORIGIN);

        let mut foreign = request(Method::OPTIONS, "/multiview/v1/capabilities");
        foreign
            .headers_mut()
            .insert("origin", "https://untrusted.example.test".parse().unwrap());
        let response = app.call(foreign).await.unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        assert!(response
            .headers()
            .get("access-control-allow-origin")
            .is_none());

        let denied = app
            .call(request(Method::GET, "/multiview/v1/capabilities"))
            .await
            .unwrap();
        assert_eq!(denied.status(), StatusCode::UNAUTHORIZED);
        assert_ne!(
            denied.headers().get("access-control-allow-origin").unwrap(),
            "*"
        );
        let mut authorized = request(Method::GET, "/multiview/v1/capabilities");
        authorized
            .headers_mut()
            .insert("authorization", format!("Bearer {TOKEN}").parse().unwrap());
        let response = app.call(authorized).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()["access-control-allow-origin"], ORIGIN);
        let body: serde_json::Value =
            serde_json::from_slice(&to_bytes(response.into_body(), 4096).await.unwrap()).unwrap();
        assert_eq!(body["max_inputs"], 0);
        assert_eq!(body["qualified_input_adapters"], serde_json::json!([]));
        assert_eq!(body["output_profiles"], serde_json::json!([]));
    }
}
