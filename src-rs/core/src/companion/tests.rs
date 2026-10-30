use super::*;
#[test]
fn ranges_are_single_and_bounded() {
    assert_eq!(range(None, 100), Ok((0, 100, false)));
    assert_eq!(range(Some("bytes=10-20"), 100), Ok((10, 11, true)));
    assert_eq!(range(Some("bytes=98-"), 100), Ok((98, 2, true)));
    assert_eq!(range(Some("bytes=-10"), 100), Ok((90, 10, true)));
    for invalid in [
        "bytes=100-",
        "bytes=4-2",
        "bytes=0-1,3-4",
        "bytes=-0",
        "items=0-1",
        "bytes=+1-2",
    ] {
        assert!(range(Some(invalid), 100).is_err());
    }
}

struct Temp(std::path::PathBuf);
impl Temp {
    fn new() -> Self {
        let p = std::env::temp_dir().join(format!(
            "ott-companion-test-{}",
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(&p).unwrap();
        Self(p)
    }
}
impl Drop for Temp {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
async fn serve(c: Companion) -> (String, tokio::task::JoinHandle<()>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}{}", listener.local_addr().unwrap(), c.endpoint());
    let task = tokio::spawn(async move {
        axum::serve(listener, c.routes()).await.unwrap();
    });
    (endpoint, task)
}
#[tokio::test]
async fn private_routes_validate_auth_before_parsing_and_bound_requests() {
    let dir = Temp::new();
    assert!(Companion::new(dir.0.join("bad"), "short".into(), None)
        .await
        .is_err());
    let c = Companion::new(dir.0.join("ok"), "a".repeat(48), None)
        .await
        .unwrap();
    let (base, task) = serve(c.clone()).await;
    let client = reqwest::Client::new();
    let caps: Value = client
        .get(format!("{base}/capabilities"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(caps["schema"], 1);
    assert_eq!(caps["torrent"], true);
    let wrong = base.replace(&"a".repeat(48), &"b".repeat(48));
    for (endpoint, authorized) in [(&base, true), (&wrong, false)] {
        let response = client
            .request(reqwest::Method::OPTIONS, format!("{endpoint}/sessions"))
            .header("origin", "https://player.example")
            .header("access-control-request-method", "POST")
            .header("access-control-request-private-network", "true")
            .send()
            .await
            .unwrap();
        assert_eq!(
            response
                .headers()
                .get("access-control-allow-private-network")
                .is_some(),
            authorized
        );
        assert!(response
            .headers()
            .get("access-control-allow-credentials")
            .is_none());
    }
    assert_eq!(
        client
            .post(format!("{wrong}/sessions"))
            .body("not json")
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        client
            .post(format!("{base}/sessions"))
            .json(&json!({"source":"file:///private"}))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        client
            .post(format!("{base}/sessions"))
            .json(&json!({"source":"x".repeat(70000)}))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        client
            .get(format!("{base}/sessions/absent"))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::NOT_FOUND
    );
    let plugins: Value = client
        .get(format!("{base}/plugins"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(plugins["plugins"]
        .as_array()
        .unwrap()
        .iter()
        .any(|p| p["id"] == "direct-url"));
    c.shutdown().await;
    assert_eq!(
        client
            .get(format!("{base}/capabilities"))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::SERVICE_UNAVAILABLE
    );
    task.abort();
}
async fn wait_state(lease: &torrent::Lease, expected: &str) -> torrent::View {
    tokio::time::timeout(std::time::Duration::from_secs(15), async {
        loop {
            let view = lease.view();
            assert_ne!(view.state, "error", "companion error {:?}", view.error);
            if view.state == expected {
                break view;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("companion state deadline")
}
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn real_swarm_selected_file_ranges_and_independent_cancellation() {
    use librqbit::{
        AddTorrent, AddTorrentOptions, CreateTorrentOptions, ListenerOptions, Session,
        SessionOptions,
    };
    let dir = Temp::new();
    let seed_dir = dir.0.join("seed");
    std::fs::create_dir(&seed_dir).unwrap();
    let bytes: Vec<u8> = (0..90001).map(|n| ((n * 31 + 7) % 251) as u8).collect();
    std::fs::write(seed_dir.join("00-prefix.bin"), vec![19; 30003]).unwrap();
    std::fs::write(seed_dir.join("01-choice.mp4"), &bytes).unwrap();
    std::fs::write(seed_dir.join("02-suffix.bin"), vec![23; 70007]).unwrap();
    let created = librqbit::create_torrent(
        &seed_dir,
        CreateTorrentOptions {
            piece_length: Some(16384),
            ..Default::default()
        },
        &librqbit::spawn_utils::BlockingSpawner::new(4),
    )
    .await
    .unwrap();
    let source = created.as_magnet().to_string();
    let seed = Session::new_with_opts(
        seed_dir.clone(),
        SessionOptions {
            dht: None,
            disable_trackers: true,
            disable_local_service_discovery: true,
            listen: Some(ListenerOptions {
                listen_addr: "127.0.0.1:0".parse().unwrap(),
                ..Default::default()
            }),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let seed_handle = seed
        .add_torrent(
            AddTorrent::TorrentFileBytes(created.as_bytes().unwrap()),
            Some(AddTorrentOptions {
                overwrite: true,
                output_folder: Some(seed_dir.to_str().unwrap().into()),
                ..Default::default()
            }),
        )
        .await
        .unwrap()
        .into_handle()
        .unwrap();
    seed_handle.wait_until_completed().await.unwrap();
    let c = Companion::new(dir.0.join("client"), "c".repeat(48), None)
        .await
        .unwrap();
    torrent::lock(&c.0.torrent.initial_peers).push(seed.listen_addr().unwrap());
    let first = c.0.torrent.create(source.clone(), None).unwrap();
    let lease = c.0.torrent.get(&first.id).unwrap();
    let metadata = wait_state(&lease, "select").await;
    assert_eq!(metadata.files.len(), 3);
    assert_eq!(
        std::fs::read_dir(dir.0.join("client/torrent-cache"))
            .unwrap()
            .filter(|entry| entry
                .as_ref()
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with("lease-"))
            .count(),
        0,
        "metadata must not create download files"
    );
    let index = metadata
        .files
        .iter()
        .find(|f| f.name.ends_with("01-choice.mp4"))
        .unwrap()
        .index;
    lease.choose(index).unwrap();
    wait_state(&lease, "ready").await;
    let (base, task) = serve(c.clone()).await;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .unwrap();
    let url = format!("{base}/sessions/{}/stream", first.id);
    let response = client
        .get(&url)
        .header("Range", "bytes=123-45678")
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
    assert_eq!(response.headers()["Content-Range"], "bytes 123-45678/90001");
    assert_eq!(
        response.bytes().await.unwrap().as_ref(),
        &bytes[123..=45678]
    );
    let head = client.head(&url).send().await.unwrap();
    assert_eq!(head.headers()["Content-Length"], "90001");
    assert_eq!(
        client
            .get(&url)
            .header("Range", "bytes=999999-")
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::RANGE_NOT_SATISFIABLE
    );
    let second = c.0.torrent.create(source, Some(index)).unwrap();
    let second_lease = c.0.torrent.get(&second.id).unwrap();
    wait_state(&second_lease, "ready").await;
    assert!(c.0.torrent.remove(&second.id).await);
    let response = client
        .get(&url)
        .header("Range", "bytes=-17")
        .send()
        .await
        .unwrap();
    assert_eq!(
        response.bytes().await.unwrap().as_ref(),
        &bytes[bytes.len() - 17..]
    );
    let cache_bytes: u64 = std::fs::read_dir(dir.0.join("client/torrent-cache"))
        .unwrap()
        .map(|p| p.unwrap().metadata().unwrap().len())
        .sum();
    assert!(
        cache_bytes <= 2 * (bytes.len() as u64 + 2 * 16384),
        "only selected-piece windows may be stored"
    );
    assert!(c.0.torrent.remove(&first.id).await);
    assert_eq!(
        client.get(&url).send().await.unwrap().status(),
        StatusCode::NOT_FOUND
    );
    c.shutdown().await;
    seed.stop().await;
    task.abort();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cancellation_before_metadata_releases_lease_admission() {
    let dir = Temp::new();
    let c = Companion::new(dir.0.clone(), "d".repeat(48), None)
        .await
        .unwrap();
    // No discovery peers in tests: creation still returns immediately and stops cleanly.
    let source = "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567";
    let one = c.0.torrent.create(source.into(), None).unwrap();
    let two = c.0.torrent.create(source.into(), None).unwrap();
    assert!(c.0.torrent.create(source.into(), None).is_err());
    assert!(c.0.torrent.remove(&one.id).await);
    assert!(c.0.torrent.create(source.into(), None).is_ok());
    assert!(c.0.torrent.remove(&two.id).await);
    c.shutdown().await;
}

#[tokio::test]
async fn stopped_router_does_not_keep_the_next_runtime_out_of_its_cache() {
    let dir = Temp::new();
    let first = Companion::new(dir.0.clone(), "x".repeat(48), None)
        .await
        .unwrap();
    let _old_routes = first.routes();
    assert!(Companion::new(dir.0.clone(), "y".repeat(48), None)
        .await
        .is_err());
    first.shutdown().await;
    let second = Companion::new(dir.0.clone(), "y".repeat(48), None)
        .await
        .unwrap();
    second.shutdown().await;
}
