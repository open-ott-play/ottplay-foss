//! Explicitly opt-in local player fixture. No external peers, trackers, or media.
use super::*;
use librqbit::{
    AddTorrent, AddTorrentOptions, CreateTorrentOptions, ListenerOptions, Session, SessionOptions,
};
use std::{path::Path, time::Duration};

const KEY: &str = "local-fixture-only";
#[derive(Clone)]
struct FixtureData {
    metainfo: Vec<u8>,
    hash: [u8; 20],
    peer: [u8; 6],
    base: String,
    size: u64,
}
struct Fixture {
    base: String,
    server: tokio::task::JoinHandle<()>,
    seed: Arc<Session>,
    metainfo: Vec<u8>,
}
async fn route(State(data): State<FixtureData>, uri: axum::http::Uri) -> Response {
    let raw = uri.query().unwrap_or("");
    if uri.path() == "/announce" {
        let hash = raw
            .split('&')
            .find_map(|p| p.strip_prefix("info_hash="))
            .map(|v| urlencoding::decode_binary(v.as_bytes()));
        if !hash.is_some_and(|h| h.as_ref() == data.hash) {
            return StatusCode::BAD_REQUEST.into_response();
        }
        let mut body = b"d8:completei1e10:incompletei0e8:intervali30e5:peers6:".to_vec();
        body.extend_from_slice(&data.peer);
        body.push(b'e');
        return body.into_response();
    }
    let pairs: std::collections::HashMap<_, _> =
        reqwest::Url::parse(&format!("{}{}", data.base, uri))
            .unwrap()
            .query_pairs()
            .into_owned()
            .collect();
    if pairs.get("apikey").map(String::as_str) != Some(KEY) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    if uri.path() == "/download" {
        return data.metainfo.into_response();
    }
    if uri.path() != "/api" {
        return StatusCode::NOT_FOUND.into_response();
    }
    match pairs.get("t").map(String::as_str) {
        Some("caps") => "<caps><limits max='100'/><searching><search available='yes' supportedParams='q'/></searching><categories><category id='2000' name='Local test video'/></categories></caps>".into_response(),
        Some("search") => {
            let offset = pairs.get("offset").map(String::as_str).unwrap_or("0");
            let item = if offset == "0" { format!("<item><title>Synthetic local video</title><enclosure type='application/x-bittorrent' url='{}/download?apikey={KEY}' length='{}'/><torznab:attr name='seeders' value='1'/><torznab:attr name='category' value='2000'/></item>", data.base, data.size) } else { String::new() };
            format!("<rss xmlns:torznab='urn:torznab'><channel><torznab:response offset='{offset}' total='1'/>{item}</channel></rss>").into_response()
        }
        _ => StatusCode::BAD_REQUEST.into_response(),
    }
}
impl Fixture {
    async fn start(video: &Path) -> Self {
        assert!(video.is_absolute(), "fixture video path must be absolute");
        let metadata = std::fs::symlink_metadata(video).expect("fixture video must exist");
        assert!(
            metadata.is_file()
                && !metadata.file_type().is_symlink()
                && metadata.len() > 0
                && metadata.len() <= 16 * 1024 * 1024,
            "fixture video must be a regular file of 1..16 MiB"
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let mut created = librqbit::create_torrent(
            video,
            CreateTorrentOptions {
                trackers: vec![format!("{base}/announce")],
                piece_length: Some(16384),
                ..Default::default()
            },
            &librqbit::spawn_utils::BlockingSpawner::new(2),
        )
        .await
        .unwrap();
        created.meta.info.data.private = true;
        let metainfo = created.as_bytes().unwrap().to_vec();
        let parsed = librqbit::torrent_from_bytes(&metainfo).unwrap();
        assert!(parsed.info.data.private);
        let hash = parsed.info_hash.0;
        let seed = Session::new_with_opts(
            video.parent().unwrap().to_owned(),
            SessionOptions {
                dht: None,
                disable_trackers: true,
                disable_local_service_discovery: true,
                peer_limit: Some(8),
                listen: Some(ListenerOptions {
                    listen_addr: "127.0.0.1:0".parse().unwrap(),
                    ..Default::default()
                }),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        let handle = seed
            .add_torrent(
                AddTorrent::from_bytes(metainfo.clone()),
                Some(AddTorrentOptions {
                    overwrite: true,
                    output_folder: Some(video.parent().unwrap().to_str().unwrap().into()),
                    ..Default::default()
                }),
            )
            .await
            .unwrap()
            .into_handle()
            .unwrap();
        tokio::time::timeout(Duration::from_secs(20), handle.wait_until_completed())
            .await
            .unwrap()
            .unwrap();
        let port = seed.listen_addr().unwrap().port().to_be_bytes();
        let data = FixtureData {
            metainfo: metainfo.clone(),
            hash,
            peer: [127, 0, 0, 1, port[0], port[1]],
            base: base.clone(),
            size: metadata.len(),
        };
        let server = tokio::spawn(async move {
            axum::serve(listener, Router::new().fallback(route).with_state(data))
                .await
                .unwrap();
        });
        Self {
            base,
            server,
            seed,
            metainfo,
        }
    }
    async fn stop(self) {
        self.server.abort();
        self.seed.stop().await;
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "requires an explicitly supplied synthetic video; serves loopback only for a bounded duration"]
async fn serve_local_video_fixture() {
    let video = std::env::var_os("OTT_TORZNAB_FIXTURE_VIDEO")
        .expect("set OTT_TORZNAB_FIXTURE_VIDEO to a synthetic local MP4");
    let seconds = std::env::var("OTT_TORZNAB_FIXTURE_SECONDS")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(600)
        .clamp(1, 1800);
    let fixture = Fixture::start(Path::new(&video)).await;
    println!(
        "TORZNAB_FIXTURE endpoint={}/api apiKey={KEY} lifetimeSeconds={seconds}",
        fixture.base
    );
    tokio::time::sleep(Duration::from_secs(seconds)).await;
    fixture.stop().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn fixture_advertises_only_its_private_local_seed() {
    let root = std::env::temp_dir().join(format!("ott-fixture-{}", uuid::Uuid::new_v4().simple()));
    std::fs::create_dir(&root).unwrap();
    let path = root.join("synthetic.mp4");
    std::fs::write(&path, b"synthetic protocol fixture").unwrap();
    let fixture = Fixture::start(&path).await;
    let parsed = librqbit::torrent_from_bytes(&fixture.metainfo).unwrap();
    assert!(parsed.info.data.private);
    assert_eq!(parsed.iter_announce().count(), 1);
    let client = reqwest::Client::new();
    let bytes = client
        .get(format!(
            "{}/announce?info_hash={}",
            fixture.base,
            urlencoding::encode_binary(&parsed.info_hash.0)
        ))
        .send()
        .await
        .unwrap()
        .bytes()
        .await
        .unwrap();
    assert!(bytes.windows(4).any(|w| w == [127, 0, 0, 1]));
    let response = client
        .get(format!("{}/download?apikey={KEY}", fixture.base))
        .send()
        .await
        .unwrap()
        .bytes()
        .await
        .unwrap();
    assert_eq!(response.as_ref(), fixture.metainfo);
    assert_eq!(
        client
            .get(format!("{}/download", fixture.base))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::UNAUTHORIZED
    );
    // Exercise actual tracker discovery; no test-only initial peer injection.
    let output = root.join("download");
    let downloader = Session::new_with_opts(
        output.clone(),
        SessionOptions {
            dht: None,
            disable_trackers: false,
            disable_local_service_discovery: true,
            listen: None,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let downloaded = downloader
        .add_torrent(
            AddTorrent::from_bytes(fixture.metainfo.clone()),
            Some(AddTorrentOptions {
                overwrite: true,
                output_folder: Some(output.to_str().unwrap().into()),
                ..Default::default()
            }),
        )
        .await
        .unwrap()
        .into_handle()
        .unwrap();
    tokio::time::timeout(Duration::from_secs(10), downloaded.wait_until_completed())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        std::fs::read(output.join("synthetic.mp4")).unwrap(),
        b"synthetic protocol fixture"
    );
    downloader.stop().await;
    fixture.stop().await;
    std::fs::remove_dir_all(root).unwrap();
}
