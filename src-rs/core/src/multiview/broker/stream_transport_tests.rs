use super::super::{
    network::{Limits, NetworkPolicy, OriginRule},
    resolvers::ServerSource,
};
use super::*;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
};

fn ts(count: usize) -> Vec<u8> {
    let mut bytes = vec![0x55; count * PACKET_BYTES];
    for packet in bytes.chunks_exact_mut(PACKET_BYTES) {
        packet[..4].copy_from_slice(&[0x47, 0x40, 0, 0x10]);
    }
    bytes
}
async fn fixture() -> (TcpListener, String) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    (listener, base)
}
fn transport(origins: &[&str]) -> CheckedTransport {
    CheckedTransport::new(
        NetworkPolicy::fixture(origins),
        Limits {
            concurrent: 1,
            timeout: Duration::from_secs(2),
            ..Limits::default()
        },
    )
    .unwrap()
}
fn limits() -> StreamLimits {
    StreamLimits {
        first_response: Duration::from_secs(2),
        idle: Duration::from_millis(150),
        hard_end: Instant::now() + Duration::from_secs(5),
    }
}
async fn request(socket: &mut TcpStream) -> String {
    let mut bytes = Vec::new();
    let mut buf = [0u8; 1024];
    while !bytes.windows(4).any(|w| w == b"\r\n\r\n") {
        let n = tokio::time::timeout(Duration::from_secs(2), socket.read(&mut buf))
            .await
            .unwrap()
            .unwrap();
        assert_ne!(n, 0);
        bytes.extend_from_slice(&buf[..n]);
        assert!(bytes.len() < 16384);
    }
    String::from_utf8(bytes).unwrap()
}
async fn headers(socket: &mut TcpStream) {
    socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: video/mp2t\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n").await.unwrap();
}
async fn chunk(socket: &mut TcpStream, bytes: &[u8]) {
    socket
        .write_all(format!("{:x}\r\n", bytes.len()).as_bytes())
        .await
        .unwrap();
    socket.write_all(bytes).await.unwrap();
    socket.write_all(b"\r\n").await.unwrap();
}
async fn open(
    transport: &CheckedTransport,
    url: &str,
    owner: &CancellationToken,
    limits: StreamLimits,
) -> Result<MpegTsStream, Error> {
    MpegTsStream::open(
        transport,
        url,
        None,
        owner,
        transport.reserve_source()?,
        limits,
    )
    .await
}

#[tokio::test]
async fn fragmented_ts_and_delayed_body_have_no_finite_total_timeout() {
    let (listener, base) = fixture().await;
    let expected = ts(8);
    let data = expected.clone();
    let task = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        request(&mut socket).await;
        headers(&mut socket).await;
        chunk(&mut socket, &data[..100]).await;
        chunk(&mut socket, &data[100..SNIFF_BYTES]).await;
        tokio::time::sleep(Duration::from_millis(80)).await;
        chunk(&mut socket, &data[SNIFF_BYTES..]).await;
        chunk(&mut socket, &[]).await;
    });
    // Only this regression deliberately uses an unusually short finite timeout.
    let transport = CheckedTransport::new(
        NetworkPolicy::fixture(&[&base]),
        Limits {
            concurrent: 1,
            timeout: Duration::from_millis(30),
            ..Limits::default()
        },
    )
    .unwrap();
    let mut stream = open(&transport, &base, &CancellationToken::new(), limits())
        .await
        .unwrap();
    let mut actual = Vec::new();
    while let Some(bytes) = stream.next_chunk().await.unwrap() {
        assert!(bytes.len() <= CHUNK_BYTES);
        actual.extend_from_slice(&bytes);
    }
    assert_eq!(actual, expected);
    drop(stream);
    task.await.unwrap();
}

#[tokio::test]
async fn each_probe_decode_subscription_is_fresh_without_cancelling_source() {
    let (listener, base) = fixture().await;
    let task = tokio::spawn(async move {
        for _ in 0..2 {
            let (mut socket, _) = listener.accept().await.unwrap();
            request(&mut socket).await;
            headers(&mut socket).await;
            chunk(&mut socket, &ts(5)).await;
            chunk(&mut socket, &[]).await;
        }
    });
    let transport = transport(&[&base]);
    let owner = CancellationToken::new();
    let source = ServerSource::http(&base, None)
        .unwrap()
        .resolve(&transport, &owner)
        .await
        .unwrap();
    let mut probe = source.open_mpeg_ts(limits()).await.unwrap();
    let prefix = probe.next_chunk().await.unwrap().unwrap();
    assert!(prefix.len() >= SNIFF_BYTES);
    drop(prefix);
    probe.cancel();
    drop(probe);
    assert!(!owner.is_cancelled());
    let mut decode = source.open_mpeg_ts(limits()).await.unwrap();
    let prefix = decode.next_chunk().await.unwrap().unwrap();
    assert!(prefix.len() >= SNIFF_BYTES);
    drop(prefix);
    drop(decode);
    source.finish().await.unwrap();
    task.await.unwrap();
}

#[tokio::test]
async fn outstanding_slice_retains_source_and_request_budgets_after_stream_drop() {
    let (listener, base) = fixture().await;
    let task = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        request(&mut socket).await;
        headers(&mut socket).await;
        chunk(&mut socket, &ts(5)).await;
        chunk(&mut socket, &[]).await;
        let (mut socket, _) = listener.accept().await.unwrap();
        request(&mut socket).await;
        socket
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok")
            .await
            .unwrap();
    });
    let transport = transport(&[&base]);
    let mut stream = open(&transport, &base, &CancellationToken::new(), limits())
        .await
        .unwrap();
    let bytes = stream.next_chunk().await.unwrap().unwrap();
    let retained = bytes.slice(100..200);
    drop(bytes);
    assert!(matches!(stream.next_chunk().await, Err(Error::Busy)));
    drop(stream);
    assert!(matches!(
        transport.get(&base, None, &CancellationToken::new()).await,
        Err(Error::Busy)
    ));
    assert!(matches!(transport.reserve_source(), Err(Error::Busy)));
    drop(retained);
    assert!(transport.reserve_source().is_ok());
    assert_eq!(
        transport
            .get(&base, None, &CancellationToken::new())
            .await
            .unwrap()
            .bytes(),
        b"ok"
    );
    task.await.unwrap();
}

#[tokio::test]
async fn consumer_backpressure_does_not_consume_upstream_or_start_idle_timer() {
    let (listener, base) = fixture().await;
    let task = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        request(&mut socket).await;
        headers(&mut socket).await;
        chunk(&mut socket, &ts(5)).await;
        chunk(&mut socket, &ts(1)).await;
        chunk(&mut socket, &[]).await;
    });
    let transport = transport(&[&base]);
    let mut configured = limits();
    configured.idle = Duration::from_millis(30);
    let mut stream = open(&transport, &base, &CancellationToken::new(), configured)
        .await
        .unwrap();
    let prefix = stream.next_chunk().await.unwrap().unwrap();
    tokio::time::sleep(Duration::from_millis(80)).await;
    assert!(matches!(stream.next_chunk().await, Err(Error::Busy)));
    drop(prefix);
    let next = stream.next_chunk().await.unwrap();
    if let Some(bytes) = next {
        assert_eq!(bytes.len(), PACKET_BYTES);
        drop(bytes);
    }
    assert!(stream.next_chunk().await.unwrap().is_none());
    drop(stream);
    task.await.unwrap();
}

#[tokio::test]
async fn body_idle_and_parent_cancel_close_waiting_subscription() {
    for cancel_parent in [false, true] {
        let (listener, base) = fixture().await;
        let (release, released) = tokio::sync::oneshot::channel();
        let task = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            request(&mut socket).await;
            headers(&mut socket).await;
            chunk(&mut socket, &ts(5)).await;
            let _ = released.await;
        });
        let transport = transport(&[&base]);
        let owner = CancellationToken::new();
        let mut stream = open(&transport, &base, &owner, limits()).await.unwrap();
        drop(stream.next_chunk().await.unwrap().unwrap());
        if cancel_parent {
            owner.cancel();
        }
        assert!(
            matches!(stream.next_chunk().await,Err(error) if error == if cancel_parent { Error::Cancelled } else { Error::Timeout })
        );
        drop(stream);
        release.send(()).unwrap();
        task.await.unwrap();
    }
}

#[tokio::test]
async fn hard_end_is_absolute_even_with_retained_output() {
    let (listener, base) = fixture().await;
    let task = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        request(&mut socket).await;
        headers(&mut socket).await;
        chunk(&mut socket, &ts(5)).await;
        chunk(&mut socket, &[]).await;
    });
    let transport = transport(&[&base]);
    let mut configured = limits();
    configured.hard_end = Instant::now() + Duration::from_millis(300);
    let mut stream = open(&transport, &base, &CancellationToken::new(), configured)
        .await
        .unwrap();
    let prefix = stream.next_chunk().await.unwrap().unwrap();
    tokio::time::sleep_until(configured.hard_end).await;
    assert!(matches!(stream.next_chunk().await, Err(Error::Timeout)));
    drop(prefix);
    drop(stream);
    task.await.unwrap();
}

#[tokio::test]
async fn container_claim_never_replaces_packet_sniff_and_headers_are_bounded() {
    for case in 0..4 {
        let (listener, base) = fixture().await;
        let task = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            request(&mut socket).await;
            let (content, body, extra) = match case {
                0 => (
                    "video/mp2t",
                    b"#EXTM3U\n#EXTINF:1,\nvideo.ts\n".to_vec(),
                    String::new(),
                ),
                1 => ("video/mp2t", vec![0u8; SNIFF_BYTES], String::new()),
                2 => ("video/mp4", ts(5), String::new()),
                _ => (
                    "video/mp2t",
                    ts(5),
                    format!("X-Large: {}\r\n", "a".repeat(32768)),
                ),
            };
            let head=format!("HTTP/1.1 200 OK\r\nContent-Type: {content}\r\nContent-Length: {}\r\nConnection: close\r\n{extra}\r\n",body.len());
            socket.write_all(head.as_bytes()).await.unwrap();
            let _ = socket.write_all(&body).await;
        });
        let transport = transport(&[&base]);
        assert!(matches!(
            open(&transport, &base, &CancellationToken::new(), limits()).await,
            Err(Error::Unsupported | Error::TooLarge)
        ));
        task.await.unwrap();
    }
}

#[tokio::test]
async fn streaming_redirect_uses_same_exact_origin_policy_and_strips_credentials() {
    let (first, base) = fixture().await;
    let (second, other) = fixture().await;
    let target = other.clone();
    let a = tokio::spawn(async move {
        let (mut socket, _) = first.accept().await.unwrap();
        assert!(request(&mut socket).await.contains("Bearer fixture-secret"));
        socket.write_all(format!("HTTP/1.1 302 Found\r\nLocation: {target}/video\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").as_bytes()).await.unwrap();
    });
    let b = tokio::spawn(async move {
        let (mut socket, _) = second.accept().await.unwrap();
        assert!(!request(&mut socket)
            .await
            .to_ascii_lowercase()
            .contains("authorization:"));
        headers(&mut socket).await;
        chunk(&mut socket, &ts(5)).await;
        chunk(&mut socket, &[]).await;
    });
    let transport = transport(&[&base, &other]);
    let mut headers = HeaderMap::new();
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_static("Bearer fixture-secret"),
    );
    let credentials = OriginCredentials::new(&base, headers).unwrap();
    let mut stream = MpegTsStream::open(
        &transport,
        &base,
        Some(&credentials),
        &CancellationToken::new(),
        transport.reserve_source().unwrap(),
        limits(),
    )
    .await
    .unwrap();
    drop(stream.next_chunk().await.unwrap().unwrap());
    drop(stream);
    a.await.unwrap();
    b.await.unwrap();
}

#[tokio::test]
async fn stream_policy_rejection_and_cancellation_precede_any_connection() {
    let transport = CheckedTransport::new(
        NetworkPolicy::new(vec![OriginRule::new("http://127.0.0.1", &[]).unwrap()]).unwrap(),
        Limits::default(),
    )
    .unwrap();
    assert!(matches!(
        open(
            &transport,
            "http://127.0.0.1/video",
            &CancellationToken::new(),
            limits()
        )
        .await,
        Err(Error::DestinationDenied)
    ));
    let owner = CancellationToken::new();
    owner.cancel();
    assert!(matches!(
        open(&transport, "http://127.0.0.1/video", &owner, limits()).await,
        Err(Error::Cancelled)
    ));
}

#[tokio::test]
async fn initial_sniff_honors_idle_before_longer_first_response_deadline() {
    let (listener, base) = fixture().await;
    let (release, released) = tokio::sync::oneshot::channel();
    let task = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        request(&mut socket).await;
        headers(&mut socket).await;
        chunk(&mut socket, &ts(1)).await;
        let _ = released.await;
    });
    let transport = transport(&[&base]);
    let result = tokio::time::timeout(
        Duration::from_secs(1),
        open(&transport, &base, &CancellationToken::new(), limits()),
    )
    .await
    .expect("prefix idle must expire before the two-second first-response deadline");
    assert!(matches!(result, Err(Error::Timeout)));
    release.send(()).unwrap();
    task.await.unwrap();
}

#[test]
fn one_large_inbound_frame_splits_without_retaining_its_allocation_in_output() {
    let data = ts(2000); // 376000 bytes: a legitimate frame larger than one output.
    let original = Bytes::from(data.clone());
    let original_start = original.as_ptr() as usize;
    let original_end = original_start + original.len();
    let mut buffer = PacketBuffer::default();
    buffer.accept(original.clone()).unwrap();
    let first = buffer.take(CHUNK_BYTES).unwrap().unwrap();
    assert_eq!(first.len(), CHUNK_BYTES);
    assert!(!(original_start..original_end).contains(&(first.as_ptr() as usize)));
    assert!(matches!(
        buffer.accept(Bytes::from_static(b"other")),
        Err(Error::Busy)
    ));
    let mut output = first.to_vec();
    while let Some(bytes) = buffer.take(CHUNK_BYTES).unwrap() {
        assert!(bytes.len() <= CHUNK_BYTES);
        output.extend_from_slice(&bytes);
    }
    assert_eq!(output, data);
    buffer.eof().unwrap();
    let mut oversized = PacketBuffer::default();
    assert!(matches!(
        oversized.accept(Bytes::from(vec![0u8; INBOUND_FRAME_BYTES + 1])),
        Err(Error::TooLarge)
    ));
    assert!(oversized.pending.is_none());
    assert_eq!(oversized.received, 0);
}

#[tokio::test]
async fn large_ts_http_chunk_uses_bounded_outputs_and_stops_polling_while_retained() {
    let (listener, base) = fixture().await;
    let data = ts(2000);
    let expected = data.clone();
    let task = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        request(&mut socket).await;
        headers(&mut socket).await;
        chunk(&mut socket, &data).await;
        chunk(&mut socket, &[]).await;
    });
    let transport = transport(&[&base]);
    let mut stream = open(&transport, &base, &CancellationToken::new(), limits())
        .await
        .unwrap();
    let prefix = stream.next_chunk().await.unwrap().unwrap();
    assert_eq!(prefix.len(), SNIFF_BYTES);
    let remaining = stream.buffer.pending.as_ref().map_or(0, Bytes::len);
    let received = stream.buffer.received;
    assert!(matches!(stream.next_chunk().await, Err(Error::Busy)));
    assert_eq!(
        stream.buffer.pending.as_ref().map_or(0, Bytes::len),
        remaining
    );
    assert_eq!(stream.buffer.received, received);
    let mut output = prefix.to_vec();
    drop(prefix);
    while let Some(bytes) = stream.next_chunk().await.unwrap() {
        assert!(bytes.len() <= CHUNK_BYTES);
        output.extend_from_slice(&bytes);
    }
    assert_eq!(output, expected);
    drop(stream);
    task.await.unwrap();
}
