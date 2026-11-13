use super::*;
use std::{
    fs,
    os::unix::fs::{symlink, PermissionsExt},
    path::Path,
    sync::Mutex,
};

static SERIAL: LazyLock<tokio::sync::Mutex<()>> = LazyLock::new(|| tokio::sync::Mutex::new(()));
const BUDGET: usize = 32 * 1024 * 1024;

struct Fixture {
    root: PathBuf,
    scene: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("ott-live-output-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();
        let root = root.canonicalize().unwrap();
        let scene = root.join("scene");
        fs::create_dir(&scene).unwrap();
        fs::set_permissions(&scene, fs::Permissions::from_mode(0o700)).unwrap();
        Self { root, scene }
    }
    fn window(&self, start: u64, count: usize) {
        for number in start..start + count as u64 {
            fs::write(self.scene.join(format!("segment-{number:06}.ts")), ts()).unwrap();
        }
        self.index(&playlist(start, count));
    }
    fn index(&self, text: &str) {
        fs::write(self.scene.join("index.m3u8.tmp"), text).unwrap();
        fs::rename(
            self.scene.join("index.m3u8.tmp"),
            self.scene.join("index.m3u8"),
        )
        .unwrap();
    }
    fn output(&self, budget: Arc<Semaphore>, minimum: u64) -> LiveOutput {
        LiveOutput::new(self.scene.clone(), budget, prefix(), minimum).unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.root).unwrap();
    }
}
fn prefix() -> String {
    format!("/multiview/v1/media/{}.{}", "a".repeat(32), "b".repeat(64))
}
fn ts() -> Vec<u8> {
    let mut bytes = vec![0; 188 * 5];
    for packet in bytes.chunks_exact_mut(188) {
        packet[0] = 0x47;
        packet[3] = 0x10;
    }
    bytes
}
fn playlist(start: u64, count: usize) -> String {
    let mut value=format!("#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:{start}\n#EXT-X-INDEPENDENT-SEGMENTS\n");
    for n in start..start + count as u64 {
        value.push_str(&format!("#EXTINF:1.250000,\nsegment-{n:06}.ts\n"));
    }
    value
}

#[tokio::test]
async fn actual_files_are_rewritten_and_segments_return_their_real_bytes() {
    let _serial = SERIAL.lock().await;
    let fixture = Fixture::new();
    fixture.window(10, 2);
    let budget = Arc::new(Semaphore::new(BUDGET));
    let output = fixture.output(budget.clone(), 10);
    let bytes = output.read("index.m3u8").await.unwrap();
    let expected = playlist(10, 2).replace("segment-", &format!("{}/segment-", prefix()));
    assert_eq!(bytes.as_ref(), expected.as_bytes());
    drop(bytes);
    let bytes = output.read("segment-000010.ts").await.unwrap();
    assert_eq!(bytes.as_ref(), ts());
    drop(bytes);
    assert_eq!(budget.available_permits(), BUDGET);
}

#[tokio::test]
async fn watermark_withholds_whole_window_and_refresh_never_serves_old_tail() {
    let _serial = SERIAL.lock().await;
    let fixture = Fixture::new();
    fixture.window(9, 2);
    let output = fixture.output(Arc::new(Semaphore::new(BUDGET)), 10);
    assert!(matches!(
        output.read("index.m3u8").await,
        Err(BoundaryError::Invalid)
    ));
    assert!(matches!(
        output.read("segment-000010.ts").await,
        Err(BoundaryError::Invalid)
    ));
    fixture.window(10, 2);
    assert!(output.read("index.m3u8").await.is_ok());
    assert!(matches!(
        output.read("segment-000009.ts").await,
        Err(BoundaryError::Invalid)
    ));
    fixture.window(12, 1);
    let index = output.read("index.m3u8").await.unwrap();
    assert!(std::str::from_utf8(&index)
        .unwrap()
        .contains("#EXT-X-MEDIA-SEQUENCE:12"));
    assert!(matches!(
        output.read("segment-000010.ts").await,
        Err(BoundaryError::Invalid)
    ));
}

#[tokio::test]
async fn raised_watermark_refreshes_same_signed_path_without_exposing_old_window() {
    let _serial = SERIAL.lock().await;
    let fixture = Fixture::new();
    fixture.window(10, 2);
    let output = fixture.output(Arc::new(Semaphore::new(BUDGET)), 10);
    assert!(output.read_with_minimum("index.m3u8", 10).await.is_ok());
    for file in ["index.m3u8", "segment-000011.ts"] {
        assert!(matches!(
            output.read_with_minimum(file, 12).await,
            Err(BoundaryError::Invalid)
        ));
    }
    // A mixed window stays withheld even when its newest leaf is clean.
    fixture.window(11, 2);
    assert!(matches!(
        output.read_with_minimum("segment-000012.ts", 12).await,
        Err(BoundaryError::Invalid)
    ));
    fixture.window(12, 2);
    let index = output.read_with_minimum("index.m3u8", 12).await.unwrap();
    let expected = playlist(12, 2).replace("segment-", &format!("{}/segment-", prefix()));
    assert_eq!(index.as_ref(), expected.as_bytes());
    assert_eq!(
        output
            .read_with_minimum("segment-000012.ts", 12)
            .await
            .unwrap()
            .as_ref(),
        ts()
    );
    assert!(matches!(
        output.read_with_minimum("index.m3u8", u64::MAX).await,
        Err(BoundaryError::Invalid)
    ));
    // A caller cannot lower the watermark established when this path was signed.
    fixture.window(9, 2);
    assert!(matches!(
        output.read_with_minimum("index.m3u8", 0).await,
        Err(BoundaryError::Invalid)
    ));
}

#[tokio::test]
async fn retained_slice_keeps_exact_allocation_budget_after_output_drop() {
    let _serial = SERIAL.lock().await;
    let fixture = Fixture::new();
    fixture.window(0, 1);
    let budget = Arc::new(Semaphore::new(BUDGET));
    let output = fixture.output(budget.clone(), 0);
    let bytes = output.read("segment-000000.ts").await.unwrap();
    let slice = bytes.slice(0..1);
    let clone = slice.clone();
    drop(bytes);
    drop(output);
    drop(slice);
    assert_eq!(budget.available_permits(), BUDGET - ts().len());
    drop(clone);
    assert_eq!(budget.available_permits(), BUDGET);
}

#[tokio::test]
async fn abandoned_blocking_read_keeps_admission_until_worker_really_finishes() {
    let _serial = SERIAL.lock().await;
    let fixture = Fixture::new();
    fixture.window(0, 1);
    let budget = Arc::new(Semaphore::new(BUDGET));
    let mut output = fixture.output(budget.clone(), 0);
    let entered = Arc::new(tokio::sync::Notify::new());
    let notify = entered.clone();
    let (release, wait) = std::sync::mpsc::channel();
    let wait = Mutex::new(wait);
    output.before_read = Some(Arc::new(move || {
        notify.notify_one();
        wait.lock().unwrap().recv().unwrap();
    }));
    let output = Arc::new(output);
    let reader = output.clone();
    let task = tokio::spawn(async move { reader.read("index.m3u8").await });
    tokio::time::timeout(Duration::from_secs(2), entered.notified())
        .await
        .unwrap();
    task.abort();
    assert!(task.await.unwrap_err().is_cancelled());
    drop(output);
    assert_eq!(budget.available_permits(), BUDGET - PLAYLIST_BYTES);
    release.send(()).unwrap();
    tokio::time::timeout(Duration::from_secs(2), async {
        while budget.available_permits() != BUDGET {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap();
}

#[tokio::test]
async fn segment_and_index_allocations_need_shared_byte_capacity() {
    let _serial = SERIAL.lock().await;
    let fixture = Fixture::new();
    fixture.window(0, 1);
    let budget = Arc::new(Semaphore::new(PLAYLIST_BYTES + ts().len() - 1));
    assert!(matches!(
        fixture
            .output(budget.clone(), 0)
            .read("segment-000000.ts")
            .await,
        Err(BoundaryError::Limit)
    ));
    assert_eq!(budget.available_permits(), PLAYLIST_BYTES + ts().len() - 1);
    let budget = Arc::new(Semaphore::new(PLAYLIST_BYTES));
    assert!(matches!(
        fixture.output(budget.clone(), 0).read("index.m3u8").await,
        Err(BoundaryError::Limit)
    ));
    assert_eq!(budget.available_permits(), PLAYLIST_BYTES);
}

#[tokio::test]
async fn file_and_directory_symlinks_hardlinks_fifo_and_traversal_fail_closed() {
    let _serial = SERIAL.lock().await;
    let fixture = Fixture::new();
    fixture.window(0, 1);
    let budget = Arc::new(Semaphore::new(BUDGET));
    let output = fixture.output(budget.clone(), 0);
    let alias = fixture.root.join("scene-alias");
    symlink(&fixture.scene, &alias).unwrap();
    assert!(matches!(
        LiveOutput::new(alias, budget.clone(), prefix(), 0),
        Err(BoundaryError::Configuration)
    ));
    assert!(matches!(
        output.read("../index.m3u8").await,
        Err(BoundaryError::Invalid)
    ));
    let leaf = fixture.scene.join("segment-000000.ts");
    let outside = fixture.root.join("outside.ts");
    fs::rename(&leaf, &outside).unwrap();
    symlink(&outside, &leaf).unwrap();
    assert!(matches!(
        output.read("index.m3u8").await,
        Err(BoundaryError::Invalid)
    ));
    fs::remove_file(&leaf).unwrap();
    fs::hard_link(&outside, &leaf).unwrap();
    assert!(matches!(
        output.read("segment-000000.ts").await,
        Err(BoundaryError::Invalid)
    ));
    fs::remove_file(&leaf).unwrap();
    use std::os::unix::ffi::OsStrExt;
    let path = std::ffi::CString::new(leaf.as_os_str().as_bytes()).unwrap();
    assert_eq!(unsafe { libc::mkfifo(path.as_ptr(), 0o600) }, 0);
    assert!(matches!(
        output.read("segment-000000.ts").await,
        Err(BoundaryError::Invalid)
    ));
    fs::remove_file(&leaf).unwrap();
    fs::write(&leaf, ts()).unwrap();
    fs::remove_file(fixture.scene.join("index.m3u8")).unwrap();
    symlink(&outside, fixture.scene.join("index.m3u8")).unwrap();
    assert!(matches!(
        output.read("index.m3u8").await,
        Err(BoundaryError::Invalid)
    ));
}

#[tokio::test]
async fn opened_directory_inode_survives_a_path_replacement() {
    let _serial = SERIAL.lock().await;
    let fixture = Fixture::new();
    fixture.window(0, 1);
    let output = fixture.output(Arc::new(Semaphore::new(BUDGET)), 0);
    fs::rename(&fixture.scene, fixture.root.join("old-scene")).unwrap();
    fs::create_dir(&fixture.scene).unwrap();
    fs::write(fixture.scene.join("index.m3u8"), "untrusted replacement").unwrap();
    assert_eq!(
        output.read("segment-000000.ts").await.unwrap().as_ref(),
        ts()
    );
}

#[tokio::test]
async fn missing_non_ts_oversized_and_mutably_shared_files_are_rejected() {
    let _serial = SERIAL.lock().await;
    let fixture = Fixture::new();
    fixture.window(0, 1);
    let output = fixture.output(Arc::new(Semaphore::new(BUDGET)), 0);
    let leaf = fixture.scene.join("segment-000000.ts");
    fs::remove_file(&leaf).unwrap();
    assert!(matches!(
        output.read("index.m3u8").await,
        Err(BoundaryError::Invalid)
    ));
    fs::write(&leaf, vec![0u8; 188 * 5]).unwrap();
    assert!(matches!(
        output.read("segment-000000.ts").await,
        Err(BoundaryError::Invalid)
    ));
    fs::write(&leaf, ts()).unwrap();
    let file = fs::OpenOptions::new().write(true).open(&leaf).unwrap();
    file.set_len(SEGMENT_BYTES as u64 + 1).unwrap();
    drop(file);
    assert!(matches!(
        output.read("segment-000000.ts").await,
        Err(BoundaryError::Invalid)
    ));
    fs::write(&leaf, ts()).unwrap();
    fs::set_permissions(&leaf, fs::Permissions::from_mode(0o666)).unwrap();
    assert!(matches!(
        output.read("index.m3u8").await,
        Err(BoundaryError::Invalid)
    ));
}

#[test]
fn closed_playlist_grammar_rejects_unsupported_authority_and_ambiguous_windows() {
    let good = playlist(0, 1);
    assert!(parse_playlist(good.as_bytes(), 0).is_ok());
    for bad in [
        good.replace("segment-000000.ts", "https://example.invalid/video.ts"),
        good.replace(
            "#EXTINF:1.250000,",
            "#EXT-X-KEY:METHOD=AES-128,URI=\"key\"\n#EXTINF:1.250000,",
        ),
        good.replace(
            "#EXTINF:1.250000,",
            "#EXT-X-BYTERANGE:188@0\n#EXTINF:1.250000,",
        ),
        good.replace(
            "#EXTINF:1.250000,",
            "#EXT-X-MAP:URI=\"init.ts\"\n#EXTINF:1.250000,",
        ),
        good.replace(
            "#EXTINF:1.250000,",
            "#EXT-X-STREAM-INF:BANDWIDTH=123\n#EXTINF:1.250000,",
        ),
        good.replace("#EXTINF:1.250000,", "#EXTINF:3.000000,"),
        good.replace("#EXTINF:1.250000,", "#EXTINF:NaN,"),
        good.replace("segment-000000.ts", "segment-000001.ts"),
        playlist(0, 9),
        format!("{good}#EXT-X-ENDLIST\n#EXT-X-VERSION:3\n"),
        format!("{good}{}", "x\n".repeat(1000)),
    ] {
        assert!(
            parse_playlist(bad.as_bytes(), 0).is_err(),
            "unsupported playlist was accepted"
        );
    }
}

#[test]
fn only_exact_signed_prefix_and_owned_absolute_directory_are_accepted() {
    let fixture = Fixture::new();
    let budget = Arc::new(Semaphore::new(BUDGET));
    for bad in [
        "https://example.invalid/media".to_owned(),
        format!("{}/..", prefix()),
        format!("{}?x=1", prefix()),
    ] {
        assert!(matches!(
            LiveOutput::new(fixture.scene.clone(), budget.clone(), bad, 0),
            Err(BoundaryError::Configuration)
        ));
    }
    assert!(matches!(
        LiveOutput::new(Path::new("relative").into(), budget.clone(), prefix(), 0),
        Err(BoundaryError::Configuration)
    ));
    fs::set_permissions(&fixture.scene, fs::Permissions::from_mode(0o777)).unwrap();
    assert!(matches!(
        LiveOutput::new(fixture.scene.clone(), budget, prefix(), 0),
        Err(BoundaryError::Configuration)
    ));
}
