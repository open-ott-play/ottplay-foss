//! Thin authenticated routes; filesystem access remains owned by offline_media.
use super::*;
use crate::local_compatibility::{Error, Input, Manager};
static DELIVERIES: std::sync::LazyLock<Arc<Semaphore>> =
    std::sync::LazyLock::new(|| Arc::new(Semaphore::new(8)));
fn delivery_body(
    bytes: Bytes,
    permit: tokio::sync::OwnedSemaphorePermit,
    work: crate::background_work::WorkLease,
) -> Body {
    Body::from_stream(stream::unfold(
        (Some(bytes), permit, work),
        |(bytes, permit, work)| async move {
            if work.check().is_err() {
                return None;
            }
            bytes.map(|bytes| (Ok::<_, std::io::Error>(bytes), (None, permit, work)))
        },
    ))
}
fn failure(error: Error) -> Response {
    let status = match error {
        Error::Unavailable | Error::Cancelled => StatusCode::SERVICE_UNAVAILABLE,
        Error::Unsupported => StatusCode::UNSUPPORTED_MEDIA_TYPE,
        Error::Busy => StatusCode::TOO_MANY_REQUESTS,
        Error::Source => StatusCode::NOT_FOUND,
    };
    let mut response = (
        status,
        Json(serde_json::json!({"code":error.code(),"message":error.message()})),
    )
        .into_response();
    cors(&mut response);
    response
}
async fn input(
    l: Library,
    id: String,
    work: &crate::background_work::WorkLease,
) -> Result<Input, Error> {
    if !valid_id(&id) {
        return Err(Error::Source);
    }
    owned_read(work, move |owner| async move {
        let record = l.read_record(&id, Some(&owner)).await?;
        if !matches!(record.extension.as_str(), "avi" | "mkv") {
            return Err((
                StatusCode::UNSUPPORTED_MEDIA_TYPE,
                "Unsupported compatibility source",
            ));
        }
        let path = l.read_path(&record, Some(&owner)).await?;
        let file = checked(Some(&owner), fs::File::open(path))
            .await?
            .map_err(storage_error)?;
        let metadata = checked(Some(&owner), file.metadata())
            .await?
            .map_err(storage_error)?;
        let modified = metadata
            .modified()
            .ok()
            .and_then(|v| v.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|v| v.as_nanos())
            .unwrap_or(0);
        #[cfg(unix)]
        let identity = {
            use std::os::unix::fs::MetadataExt;
            format!("{}:{}", metadata.dev(), metadata.ino())
        };
        #[cfg(not(unix))]
        let identity = String::new();
        Ok(Input {
            source_id: record.source_id.clone().unwrap_or_else(|| id.clone()),
            id,
            fingerprint: format!("{}:{modified}:{identity}", metadata.len()),
            extension: record.extension,
            size: metadata.len(),
        })
    })
    .await
    .map_err(|e| {
        if e.0 == StatusCode::SERVICE_UNAVAILABLE {
            Error::Cancelled
        } else {
            Error::Source
        }
    })
}
fn manager(l: &Library) -> Result<Manager, Error> {
    l.compatibility.clone().ok_or(Error::Unavailable)
}
pub(super) async fn compat_prepare(
    State(l): State<Library>,
    Path((token, id)): Path<(String, String)>,
) -> Response {
    if let Err(e) = l.authorize(&token) {
        return e.into_response();
    }
    let _admission = match DELIVERIES.clone().try_acquire_owned() {
        Ok(p) => p,
        Err(_) => return failure(Error::Busy),
    };
    let m = match manager(&l) {
        Ok(m) => m,
        Err(e) => return failure(e),
    };
    let Ok(work) = l.background.enter() else {
        return failure(Error::Cancelled);
    };
    let base = l.endpoint();
    let result = async {
        let value = input(l, id, &work).await?;
        m.prepare(value, &base, &work).await
    }
    .await;
    let mut response = match result {
        Ok(v) => Json(v).into_response(),
        Err(e) => return failure(e),
    };
    cors(&mut response);
    response
}
pub(super) async fn compat_cancel(
    State(l): State<Library>,
    Path((token, id)): Path<(String, String)>,
    headers: HeaderMap,
) -> Response {
    if let Err(e) = l.authorize(&token) {
        return e.into_response();
    }
    let lease = headers
        .get("X-OTT-Playback-Lease")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let mut response = if !valid_id(&id) || !valid_id(lease) {
        StatusCode::BAD_REQUEST.into_response()
    } else {
        if let Some(m) = &l.compatibility {
            m.cancel(&id, lease);
        }
        StatusCode::NO_CONTENT.into_response()
    };
    cors(&mut response);
    response
}
pub(super) async fn compat_playlist(
    State(l): State<Library>,
    Path((token, id, lease, name)): Path<(String, String, String, String)>,
) -> Response {
    if let Err(e) = l.authorize(&token) {
        return e.into_response();
    }
    let delivery = match DELIVERIES.clone().try_acquire_owned() {
        Ok(p) => p,
        Err(_) => return failure(Error::Busy),
    };
    if !valid_id(&lease) {
        return failure(Error::Cancelled);
    }
    let m = match manager(&l) {
        Ok(m) => m,
        Err(e) => return failure(e),
    };
    let Ok(work) = l.background.enter() else {
        return failure(Error::Cancelled);
    };
    let base = format!("{}/compat/{id}/{lease}", l.endpoint());
    let result = async {
        let value = input(l, id, &work).await?;
        m.playlist(&value, &lease, &name, &base, &work)
    }
    .await;
    let mut response = match result {
        Ok(v) => (
            [("content-type", "application/vnd.apple.mpegurl")],
            delivery_body(Bytes::from(v), delivery, work.clone()),
        )
            .into_response(),
        Err(e) => return failure(e),
    };
    cors(&mut response);
    response
}
pub(super) async fn compat_segment(
    State(l): State<Library>,
    Path((token, id, lease, track, segment)): Path<(String, String, String, String, String)>,
    headers: HeaderMap,
    method: Method,
) -> Response {
    if let Err(e) = l.authorize(&token) {
        return e.into_response();
    }
    let delivery = match DELIVERIES.clone().try_acquire_owned() {
        Ok(p) => p,
        Err(_) => return failure(Error::Busy),
    };
    let Some(index) = segment
        .strip_suffix(".ts")
        .and_then(|v| v.parse::<usize>().ok())
        .filter(|n| segment == format!("{n}.ts"))
    else {
        return failure(Error::Unsupported);
    };
    if !valid_id(&lease) {
        return failure(Error::Cancelled);
    }
    let m = match manager(&l) {
        Ok(m) => m,
        Err(e) => return failure(e),
    };
    let Ok(work) = l.background.enter() else {
        return failure(Error::Cancelled);
    };
    let result = async {
        let value = input(l, id, &work).await?;
        m.segment(value, &lease, &track, index, &work).await
    }
    .await;
    let data = match result {
        Ok(v) => v,
        Err(e) => return failure(e),
    };
    let size = data.len() as u64;
    let range = match byte_range(headers.get("range").and_then(|v| v.to_str().ok()), size) {
        Ok(v) => v,
        Err(e) => return e.into_response(),
    };
    let (start, end) = range.unwrap_or((0, size - 1));
    let length = end - start + 1;
    let mut response = if method == Method::HEAD {
        Body::empty()
    } else {
        let bytes = Bytes::from(data[start as usize..=end as usize].to_vec());
        delivery_body(bytes, delivery, work.clone())
    }
    .into_response();
    *response.status_mut() = if range.is_some() {
        StatusCode::PARTIAL_CONTENT
    } else {
        StatusCode::OK
    };
    response
        .headers_mut()
        .insert("content-type", HeaderValue::from_static("video/mp2t"));
    response
        .headers_mut()
        .insert("content-length", length.into());
    response
        .headers_mut()
        .insert("accept-ranges", HeaderValue::from_static("bytes"));
    if range.is_some() {
        response.headers_mut().insert(
            "content-range",
            format!("bytes {start}-{end}/{size}").parse().unwrap(),
        );
    }
    cors(&mut response);
    response
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn readonly_routes_keep_auth_lease_cors_and_no_mutation() {
        let root =
            std::env::temp_dir().join(format!("local-compat-routes-{}", uuid::Uuid::new_v4()));
        let token = "t".repeat(32);
        let id = "a".repeat(32);
        let mut library = Library::new(root.clone(), token.clone(), "server")
            .await
            .unwrap();
        library.read_only_paths = Some(Arc::new(vec![root.join("unused")]));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let server =
            tokio::spawn(async move { axum::serve(listener, library.routes()).await.unwrap() });
        let client = reqwest::Client::new();
        let base = format!("{origin}/offline-media/{token}");
        let preflight = client
            .request(
                reqwest::Method::OPTIONS,
                format!("{base}/compat/{id}/cancel"),
            )
            .send()
            .await
            .unwrap();
        assert_eq!(preflight.status(), StatusCode::NO_CONTENT);
        assert!(preflight.headers()["access-control-allow-headers"]
            .to_str()
            .unwrap()
            .contains("X-OTT-Playback-Lease"));
        assert!(preflight.headers()["access-control-allow-methods"]
            .to_str()
            .unwrap()
            .contains("POST"));
        let response = client
            .post(format!("{base}/compat/{id}/prepare"))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(
            response.json::<serde_json::Value>().await.unwrap()["code"],
            "compatibility_unavailable"
        );
        let wrong = client
            .post(format!(
                "{origin}/offline-media/{}/compat/{id}/prepare",
                "x".repeat(32)
            ))
            .send()
            .await
            .unwrap();
        assert_eq!(wrong.status(), StatusCode::NOT_FOUND);
        assert_eq!(
            client
                .post(format!("{base}/compat/{id}/cancel"))
                .header("X-OTT-Playback-Lease", "b".repeat(32))
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::NO_CONTENT
        );
        assert_eq!(
            client
                .post(format!("{base}/compat/{id}/cancel"))
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::BAD_REQUEST
        );
        let import = client
            .post(format!("{base}/import?name=movie.avi"))
            .send()
            .await
            .unwrap();
        assert!(!import.status().is_success());
        assert!(!client
            .delete(format!("{base}/{id}"))
            .send()
            .await
            .unwrap()
            .status()
            .is_success());
        server.abort();
        let _ = server.await;
        fs::remove_dir_all(root).await.unwrap();
    }
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    #[ignore = "requires explicitly provided synthetic AVI/MKV and installed FFmpeg tools"]
    async fn real_ffmpeg_http_finite_seek_decode_and_independent_leases() {
        let fixtures = PathBuf::from(
            std::env::var_os("OTT_LOCAL_COMPAT_FIXTURES")
                .expect("explicit synthetic fixture directory"),
        );
        let before: Vec<_> = ["xvid-ac3.avi", "h264-aac.mkv"]
            .into_iter()
            .map(|name| {
                let p = fixtures.join(name);
                let bytes = std::fs::read(&p).unwrap();
                assert!(bytes.len() < 2 * 1024 * 1024);
                (p, Sha256::digest(bytes).to_vec())
            })
            .collect();
        let root =
            std::env::temp_dir().join(format!("local-compat-smoke-{}", uuid::Uuid::new_v4()));
        let token = "s".repeat(32);
        let library = Library::new_read_only(root.clone(), token.clone(), vec![fixtures])
            .await
            .unwrap()
            .with_compatibility_from_env()
            .await;
        assert!(
            library.compatibility.is_some(),
            "explicit installed tools required"
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let app = library.clone();
        let server =
            tokio::spawn(async move { axum::serve(listener, app.routes()).await.unwrap() });
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(40))
            .build()
            .unwrap();
        let mut catalogue = None;
        for _ in 0..100 {
            let c = library.catalog().await.unwrap();
            if c.items.len() == 2 && !c.scanning {
                catalogue = Some(c);
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        for item in catalogue.expect("synthetic source must finish scan").items {
            let prepare = format!("{origin}/offline-media/{token}/compat/{}/prepare", item.id);
            let a = client
                .post(&prepare)
                .send()
                .await
                .unwrap()
                .error_for_status()
                .unwrap()
                .json::<serde_json::Value>()
                .await
                .unwrap();
            let b = client
                .post(&prepare)
                .send()
                .await
                .unwrap()
                .error_for_status()
                .unwrap()
                .json::<serde_json::Value>()
                .await
                .unwrap();
            assert_ne!(a["lease"], b["lease"]);
            assert_eq!(b["finite"], true);
            assert_eq!(b["timeOrigin"], 0);
            let duration = b["duration"].as_f64().unwrap();
            assert!((11.5..13.0).contains(&duration));
            let master_url = format!("{origin}{}", b["url"].as_str().unwrap());
            let master = client
                .get(&master_url)
                .send()
                .await
                .unwrap()
                .error_for_status()
                .unwrap()
                .text()
                .await
                .unwrap();
            assert!(master.contains("#EXT-X-STREAM-INF") && !master.contains("#EXT-X-ENDLIST"));
            let child_url = master_url.trim_end_matches("index.m3u8").to_string() + "video.m3u8";
            let child = client
                .get(&child_url)
                .send()
                .await
                .unwrap()
                .error_for_status()
                .unwrap()
                .text()
                .await
                .unwrap();
            assert!(
                child.contains("#EXT-X-PLAYLIST-TYPE:VOD") && child.ends_with("#EXT-X-ENDLIST\n")
            );
            let sum: f64 = child
                .lines()
                .filter_map(|s| s.strip_prefix("#EXTINF:"))
                .map(|s| s.trim_end_matches(',').parse::<f64>().unwrap())
                .sum();
            assert!((sum - duration).abs() < 0.00001);
            let segments: Vec<_> = child
                .lines()
                .filter(|s| !s.starts_with('#') && !s.is_empty())
                .collect();
            for segment in [segments[0], *segments.last().unwrap()] {
                let bytes = client
                    .get(format!("{origin}{segment}"))
                    .send()
                    .await
                    .unwrap()
                    .error_for_status()
                    .unwrap()
                    .bytes()
                    .await
                    .unwrap();
                let ffmpeg = std::env::var_os("OTT_LOCAL_FFMPEG")
                    .map(PathBuf::from)
                    .unwrap_or_else(|| PathBuf::from("/opt/homebrew/bin/ffmpeg"));
                let mut decode = tokio::process::Command::new(ffmpeg)
                    .args(["-nostdin", "-v", "error", "-i", "pipe:0", "-f", "null", "-"])
                    .stdin(std::process::Stdio::piped())
                    .stdout(std::process::Stdio::null())
                    .stderr(std::process::Stdio::piped())
                    .kill_on_drop(true)
                    .spawn()
                    .unwrap();
                let mut stdin = decode.stdin.take().unwrap();
                let writer = tokio::spawn(async move {
                    stdin.write_all(&bytes).await.unwrap();
                });
                let output = tokio::time::timeout(
                    std::time::Duration::from_secs(10),
                    decode.wait_with_output(),
                )
                .await
                .unwrap()
                .unwrap();
                writer.await.unwrap();
                assert!(output.status.success(), "synthetic segment decode failed");
            }
            client
                .post(format!("{origin}{}", a["cancelUrl"].as_str().unwrap()))
                .header("X-OTT-Playback-Lease", a["lease"].as_str().unwrap())
                .send()
                .await
                .unwrap()
                .error_for_status()
                .unwrap();
            assert!(!client
                .get(format!("{origin}{}", a["url"].as_str().unwrap()))
                .send()
                .await
                .unwrap()
                .status()
                .is_success());
            assert!(client
                .get(&master_url)
                .send()
                .await
                .unwrap()
                .status()
                .is_success());
            client
                .post(format!("{origin}{}", b["cancelUrl"].as_str().unwrap()))
                .header("X-OTT-Playback-Lease", b["lease"].as_str().unwrap())
                .send()
                .await
                .unwrap()
                .error_for_status()
                .unwrap();
        }
        server.abort();
        let _ = server.await;
        drop(library);
        for (path, hash) in before {
            assert_eq!(Sha256::digest(std::fs::read(path).unwrap()).to_vec(), hash);
        }
        fs::remove_dir_all(root).await.unwrap();
    }
}
