//! Operator-enabled media service. The capability URL is never exposed by discovery.
use std::path::PathBuf;

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

pub async fn from_env(host: &str) -> anyhow::Result<Option<ottplay_core::companion::Companion>> {
    let configuration = parse(
        host,
        std::env::var_os("OTT_COMPANION_DIR"),
        std::env::var("OTT_COMPANION_TOKEN").ok(),
        std::env::var_os("OTT_COMPANION_PLUGIN_DIR"),
        remote_enabled(std::env::var_os("OTT_COMPANION_ALLOW_REMOTE"))?,
    )?;
    match configuration {
        Some(configuration) => Ok(Some(
            ottplay_core::companion::Companion::new(
                configuration.directory,
                configuration.token,
                configuration.plugins,
            )
            .await?,
        )),
        None => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
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
