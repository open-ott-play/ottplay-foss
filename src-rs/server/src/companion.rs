//! Operator-enabled media service on its own listener, loopback by default.
//! The capability URL is never exposed by discovery or the main player listener.
use anyhow::Context;
use std::{net::SocketAddr, path::PathBuf, sync::Arc};
use tokio::net::TcpListener;

const DEFAULT_HOST: &str = "127.0.0.1";
const DEFAULT_PORT: u16 = 8793;

struct ListenerConfiguration {
    address: SocketAddr,
    tls: Option<(String, String)>,
}

fn parse_listener(
    host: Option<String>,
    port: Option<String>,
    cert: Option<String>,
    key: Option<String>,
) -> anyhow::Result<ListenerConfiguration> {
    let host = host
        .as_deref()
        .unwrap_or(DEFAULT_HOST)
        .parse()
        .context("OTT_COMPANION_HOST must be an IP address")?;
    let port = port
        .map(|value| value.parse::<u16>())
        .transpose()
        .context("OTT_COMPANION_PORT must be a port from 1 to 65535")?
        .unwrap_or(DEFAULT_PORT);
    anyhow::ensure!(
        port > 0,
        "OTT_COMPANION_PORT must be a port from 1 to 65535"
    );
    let tls = match (cert, key) {
        (None, None) => None,
        (Some(cert), Some(key)) if !cert.is_empty() && !key.is_empty() => Some((cert, key)),
        _ => anyhow::bail!("OTT_COMPANION_CERT and OTT_COMPANION_KEY must be set together"),
    };
    Ok(ListenerConfiguration {
        address: SocketAddr::new(host, port),
        tls,
    })
}

struct Configuration {
    directory: PathBuf,
    token: String,
    plugins: Option<PathBuf>,
}

fn parse(
    host: &str,
    directory: Option<std::ffi::OsString>,
    token: Option<String>,
    plugins: Option<std::ffi::OsString>,
    remote: bool,
) -> anyhow::Result<Option<Configuration>> {
    if directory.is_none() && token.is_none() && plugins.is_none() && !remote {
        return Ok(None);
    }
    let directory =
        PathBuf::from(directory.ok_or_else(|| anyhow::anyhow!("OTT_COMPANION_DIR is required"))?);
    anyhow::ensure!(
        directory.is_absolute(),
        "OTT_COMPANION_DIR must be absolute"
    );
    let token = token.ok_or_else(|| anyhow::anyhow!("OTT_COMPANION_TOKEN is required"))?;
    anyhow::ensure!(
        token.len() >= 32
            && token.len() <= 128
            && token
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-')),
        "OTT_COMPANION_TOKEN must contain 32–128 URL-safe characters"
    );
    let loopback = host
        .parse::<std::net::IpAddr>()
        .is_ok_and(|ip| ip.is_loopback());
    anyhow::ensure!(
        loopback || remote,
        "Remote media service requires OTT_COMPANION_ALLOW_REMOTE=1"
    );
    let plugins = plugins.map(PathBuf::from);
    anyhow::ensure!(
        plugins.as_ref().is_none_or(|path| path.is_absolute()),
        "OTT_COMPANION_PLUGIN_DIR must be absolute"
    );
    Ok(Some(Configuration {
        directory,
        token,
        plugins,
    }))
}

pub fn configured() -> bool {
    [
        "OTT_COMPANION_DIR",
        "OTT_COMPANION_TOKEN",
        "OTT_COMPANION_PLUGIN_DIR",
        "OTT_COMPANION_ALLOW_REMOTE",
        "OTT_COMPANION_HOST",
        "OTT_COMPANION_PORT",
        "OTT_COMPANION_CERT",
        "OTT_COMPANION_KEY",
    ]
    .iter()
    .any(|name| std::env::var_os(name).is_some())
}

fn remote_enabled(value: Option<std::ffi::OsString>) -> anyhow::Result<bool> {
    match value.as_deref().and_then(|value| value.to_str()) {
        None if value.is_none() => Ok(false),
        Some("0") => Ok(false),
        Some("1") => Ok(true),
        _ => anyhow::bail!("OTT_COMPANION_ALLOW_REMOTE must be 0 or 1"),
    }
}

fn optional_env(name: &str) -> anyhow::Result<Option<String>> {
    match std::env::var(name) {
        Ok(value) => Ok(Some(value)),
        Err(std::env::VarError::NotPresent) => Ok(None),
        Err(_) => anyhow::bail!("{name} must contain valid Unicode"),
    }
}

pub struct BoundCompanion {
    listener: TcpListener,
    service: ottplay_core::companion::Companion,
    tls: Option<Arc<rustls::ServerConfig>>,
}

impl BoundCompanion {
    async fn bind(
        configuration: Configuration,
        listener: ListenerConfiguration,
    ) -> anyhow::Result<Self> {
        let tls = listener
            .tls
            .map(|(cert, key)| crate::build_tls_config(&cert, &key))
            .transpose()
            .context("Media service TLS configuration failed")?;
        // Reserve the dedicated port before creating any service state.
        let socket = TcpListener::bind(listener.address)
            .await
            .with_context(|| format!("cannot bind media service {}", listener.address))?;
        let service = ottplay_core::companion::Companion::new(
            configuration.directory,
            configuration.token,
            configuration.plugins,
        )
        .await?;
        Ok(Self {
            listener: socket,
            service,
            tls,
        })
    }

    pub fn service(&self) -> ottplay_core::companion::Companion {
        self.service.clone()
    }

    pub async fn serve(self) -> anyhow::Result<()> {
        let address = self.listener.local_addr()?;
        let scheme = if self.tls.is_some() { "https" } else { "http" };
        // Do not log the bearer token or complete capability URL.
        println!("ottplay media service: {scheme}://{address}");
        let routes = self.service.routes();
        match self.tls {
            Some(config) => crate::serve_tls(self.listener, routes, config).await,
            None => axum::serve(self.listener, routes)
                .await
                .context("Media service listener failed"),
        }
    }
}

pub async fn from_env() -> anyhow::Result<Option<BoundCompanion>> {
    if !configured() {
        return Ok(None);
    }
    let listener = parse_listener(
        optional_env("OTT_COMPANION_HOST")?,
        optional_env("OTT_COMPANION_PORT")?,
        optional_env("OTT_COMPANION_CERT")?,
        optional_env("OTT_COMPANION_KEY")?,
    )?;
    let configuration = parse(
        &listener.address.ip().to_string(),
        std::env::var_os("OTT_COMPANION_DIR"),
        optional_env("OTT_COMPANION_TOKEN")?,
        std::env::var_os("OTT_COMPANION_PLUGIN_DIR"),
        remote_enabled(std::env::var_os("OTT_COMPANION_ALLOW_REMOTE"))?,
    )?;
    let configuration =
        configuration.context("OTT_COMPANION_DIR and OTT_COMPANION_TOKEN are required")?;
    Ok(Some(BoundCompanion::bind(configuration, listener).await?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn listener_defaults_and_explicit_settings_are_independent() {
        let defaults = parse_listener(None, None, None, None).unwrap();
        assert_eq!(
            defaults.address,
            SocketAddr::from(([127, 0, 0, 1], DEFAULT_PORT))
        );
        assert!(defaults.tls.is_none());
        let explicit = parse_listener(
            Some("::1".into()),
            Some("8794".into()),
            Some("cert.pem".into()),
            Some("key.pem".into()),
        )
        .unwrap();
        assert!(explicit.address.ip().is_loopback());
        assert_eq!(explicit.address.port(), 8794);
        assert!(explicit.tls.is_some());
        assert!(parse_listener(Some("hostname.invalid".into()), None, None, None).is_err());
        for port in ["0", "65536", "-1", "", "invalid"] {
            assert!(parse_listener(None, Some(port.into()), None, None).is_err());
        }
        for (cert, key) in [
            (Some("cert.pem"), None),
            (None, Some("key.pem")),
            (Some(""), Some("")),
        ] {
            assert!(parse_listener(
                None,
                None,
                cert.map(str::to_string),
                key.map(str::to_string)
            )
            .is_err());
        }
    }

    fn service_configuration(root: PathBuf) -> Configuration {
        parse(
            DEFAULT_HOST,
            Some(root.into_os_string()),
            Some("x".repeat(32)),
            None,
            false,
        )
        .unwrap()
        .unwrap()
    }

    #[tokio::test]
    async fn dedicated_loopback_listener_authenticates_without_exposing_main_routes() {
        use axum::{http::StatusCode, routing::get, Router};
        let root =
            std::env::temp_dir().join(format!("ott-companion-listener-{}", uuid::Uuid::new_v4()));
        let mut listener = parse_listener(None, None, None, None).unwrap();
        listener.address.set_port(0);
        let companion = BoundCompanion::bind(service_configuration(root.clone()), listener)
            .await
            .unwrap();
        let address = companion.listener.local_addr().unwrap();
        assert!(address.ip().is_loopback());
        let service = companion.service();
        let path = format!("{}/capabilities", service.endpoint());
        let main = crate::bind_listeners("0.0.0.0", &[0], &[]).await.unwrap();
        let main_port = main.http[0].local_addr().unwrap().port();
        let main_task = tokio::spawn(crate::serve_listeners(
            main,
            Router::new().route("/health", get(crate::health)),
            None,
        ));
        let companion_task = tokio::spawn(companion.serve());
        let client = reqwest::Client::builder()
            .no_proxy()
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .unwrap();
        assert_eq!(
            client
                .get(format!("http://127.0.0.1:{main_port}{path}"))
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            client
                .get(format!("http://{address}{path}"))
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::OK
        );
        let wrong_path = path.replace(&"x".repeat(32), &"y".repeat(32));
        assert_eq!(
            client
                .get(format!("http://{address}{wrong_path}"))
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            client
                .get(format!("http://{address}/health"))
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            client
                .get(format!("http://127.0.0.1:{main_port}/health"))
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::OK
        );
        service.shutdown().await;
        companion_task.abort();
        main_task.abort();
        let _ = tokio::join!(companion_task, main_task);
        tokio::fs::remove_dir_all(root).await.unwrap();
    }

    #[tokio::test]
    async fn occupied_companion_port_fails_before_creating_storage() {
        let occupied = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let root =
            std::env::temp_dir().join(format!("ott-companion-bind-{}", uuid::Uuid::new_v4()));
        let listener = ListenerConfiguration {
            address: occupied.local_addr().unwrap(),
            tls: None,
        };
        assert!(
            BoundCompanion::bind(service_configuration(root.clone()), listener)
                .await
                .is_err()
        );
        assert!(!root.exists());
    }

    #[test]
    fn remote_flag_rejects_ambiguous_values() {
        assert!(!remote_enabled(None).unwrap());
        assert!(!remote_enabled(Some("0".into())).unwrap());
        assert!(remote_enabled(Some("1".into())).unwrap());
        assert!(remote_enabled(Some("true".into())).is_err());
        assert!(remote_enabled(Some("".into())).is_err());
    }
    #[test]
    fn optional_and_partial_configuration() {
        assert!(parse("127.0.0.1", None, None, None, false)
            .unwrap()
            .is_none());
        assert!(parse(
            "127.0.0.1",
            Some(std::env::temp_dir().join("companion-test").into_os_string()),
            None,
            None,
            false
        )
        .is_err());
        assert!(parse("127.0.0.1", None, Some("x".repeat(32)), None, false).is_err());
    }
    #[test]
    fn remote_exposure_is_explicit() {
        let token = Some("x".repeat(32));
        assert!(parse(
            "0.0.0.0",
            Some(std::env::temp_dir().join("companion-test").into_os_string()),
            token.clone(),
            None,
            false
        )
        .is_err());
        assert!(parse(
            "0.0.0.0",
            Some(std::env::temp_dir().join("companion-test").into_os_string()),
            token.clone(),
            None,
            true
        )
        .is_ok());
        assert!(parse(
            "::1",
            Some(std::env::temp_dir().join("companion-test").into_os_string()),
            token,
            None,
            false
        )
        .is_ok());
    }
    #[test]
    fn credentials_and_paths_are_validated_without_echoing() {
        assert!(parse(
            "127.0.0.1",
            Some("relative".into()),
            Some("x".repeat(32)),
            None,
            false
        )
        .is_err());
        let error = parse(
            "127.0.0.1",
            Some(std::env::temp_dir().join("companion-test").into_os_string()),
            Some("invalid/token".repeat(4)),
            None,
            false,
        )
        .err()
        .expect("invalid credential must fail");
        assert!(!error.to_string().contains("invalid/token"));
        assert!(parse(
            "127.0.0.1",
            Some(std::env::temp_dir().join("companion-test").into_os_string()),
            Some("x".repeat(32)),
            Some("relative".into()),
            false
        )
        .is_err());
    }
}
