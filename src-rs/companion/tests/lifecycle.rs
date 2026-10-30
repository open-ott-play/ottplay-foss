#![cfg(unix)]
use std::{
    path::PathBuf,
    process::{Child, Command, Stdio},
    time::{Duration, Instant},
};

const TOKEN: &str = "standalone-smoke-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";

struct Running {
    child: Option<Child>,
    root: PathBuf,
    port: u16,
}

impl Running {
    fn start() -> Self {
        let reservation = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = reservation.local_addr().unwrap().port();
        let root = std::env::temp_dir().join(format!("ott-standalone-{}", uuid::Uuid::new_v4()));
        drop(reservation);
        let child = Command::new(env!("CARGO_BIN_EXE_ottplay-companion"))
            .env_remove("OTT_COMPANION_HOST")
            .env_remove("OTT_COMPANION_ALLOW_REMOTE")
            .env_remove("OTT_COMPANION_PLUGIN_DIR")
            .env("OTT_COMPANION_DIR", &root)
            .env("OTT_COMPANION_TOKEN", TOKEN)
            .env("OTT_COMPANION_PORT", port.to_string())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        Self {
            child: Some(child),
            root,
            port,
        }
    }

    async fn ready(&mut self, client: &reqwest::Client) {
        let start = Instant::now();
        loop {
            assert!(
                self.child.as_mut().unwrap().try_wait().unwrap().is_none(),
                "Companion exited during startup"
            );
            if let Ok(response) = client.get(self.url(TOKEN, "/capabilities")).send().await {
                assert_eq!(response.status(), reqwest::StatusCode::OK);
                return;
            }
            assert!(
                start.elapsed() < Duration::from_secs(10),
                "Companion did not start"
            );
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }

    fn url(&self, token: &str, path: &str) -> String {
        format!("http://127.0.0.1:{}/companion/{token}/v1{path}", self.port)
    }

    fn terminate(&mut self) {
        let child = self.child.as_ref().unwrap();
        assert!(Command::new("kill")
            .args(["-TERM", &child.id().to_string()])
            .status()
            .unwrap()
            .success());
        let start = Instant::now();
        while self.child.as_mut().unwrap().try_wait().unwrap().is_none() {
            assert!(
                start.elapsed() < Duration::from_secs(10),
                "Companion did not stop"
            );
            std::thread::sleep(Duration::from_millis(10));
        }
        let child = self.child.take().unwrap();
        let output = child.wait_with_output().unwrap();
        assert!(
            output.status.success(),
            "Companion must handle SIGTERM cleanly"
        );
        assert!(!String::from_utf8_lossy(&output.stdout).contains(TOKEN));
        assert!(!String::from_utf8_lossy(&output.stderr).contains(TOKEN));
        assert!(std::net::TcpListener::bind(("127.0.0.1", self.port)).is_ok());
    }
}

impl Drop for Running {
    fn drop(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

#[tokio::test]
async fn standalone_authenticates_and_exits_cleanly_on_sigterm() {
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(2))
        .build()
        .unwrap();
    let mut running = Running::start();
    running.ready(&client).await;
    assert_eq!(
        client
            .get(running.url("wrong", "/capabilities"))
            .send()
            .await
            .unwrap()
            .status(),
        reqwest::StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        client
            .get(format!("http://127.0.0.1:{}/health", running.port))
            .send()
            .await
            .unwrap()
            .status(),
        reqwest::StatusCode::UNAUTHORIZED
    );
    running.terminate();
}
