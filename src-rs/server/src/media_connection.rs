//! Supervision armed only by a successfully admitted private HTTP/1 media response.
//! Ordinary HTTP, failed admissions and upgraded traffic remain unarmed.
use axum::{
    http::{header::CONNECTION, HeaderValue, Version},
    response::Response,
};
use std::{
    future::Future,
    io::{self, IoSlice},
    pin::Pin,
    sync::{Arc, Mutex, MutexGuard, Weak},
    task::{Context, Poll},
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncWrite, ReadBuf},
    sync::Notify,
    time::Instant,
};

const WRITE_IDLE: Duration = Duration::from_secs(30);
const AUTHORITY_CHECK: Duration = Duration::from_millis(100);

/// Implemented by broker custody, using existing authority checks only.
/// The implementation must be bounded, synchronous and perform no media I/O.
pub(crate) trait MediaAuthority: Send + Sync {
    fn authorized(&self) -> bool;
}

/// A server-only response extension. Its shared owner holds the existing output
/// reference and stream permit; cloning this lease never acquires another permit.
/// Deliberately no Debug or serialization implementation.
#[derive(Clone)]
pub(crate) struct MediaLease {
    authority: Arc<dyn MediaAuthority>,
    owner: Weak<Inner>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum MediaTransportError {
    UnsupportedVersion,
    WrongConnection,
    AlreadyArmed,
    ConnectionClosed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum MediaStop {
    WriteIdle,
    AuthorityRevoked,
    AlreadySupervised,
}

#[derive(Default)]
struct State {
    lease: Option<Arc<dyn MediaAuthority>>,
    last_write: Option<Instant>,
    supervising: bool,
    closed: bool,
}

struct Inner {
    state: Mutex<State>,
    changed: Notify,
    write_idle: Duration,
    authority_check: Duration,
}

/// One owner per accepted connection. No timer runs until prepare_response
/// consumes a successful response's broker-created MediaLease extension.
#[derive(Clone)]
pub(crate) struct ConnectionControl(Arc<Inner>);

impl Default for ConnectionControl {
    fn default() -> Self {
        Self::with_budgets(WRITE_IDLE, AUTHORITY_CHECK)
    }
}

impl ConnectionControl {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    pub(crate) fn media_lease(&self, authority: Arc<dyn MediaAuthority>) -> MediaLease {
        MediaLease {
            authority,
            owner: Arc::downgrade(&self.0),
        }
    }

    #[cfg(test)]
    pub(crate) fn with_test_budgets(write_idle: Duration, authority_check: Duration) -> Self {
        Self::with_budgets(write_idle, authority_check)
    }

    #[cfg(test)]
    pub(crate) fn is_armed_for_test(&self) -> bool {
        self.state().lease.is_some()
    }

    fn with_budgets(write_idle: Duration, authority_check: Duration) -> Self {
        assert!(!write_idle.is_zero() && !authority_check.is_zero());
        Self(Arc::new(Inner {
            state: Mutex::new(State::default()),
            changed: Notify::new(),
            write_idle,
            authority_check,
        }))
    }

    fn state(&self) -> MutexGuard<'_, State> {
        // No external callback runs under this lock. Recovering a poisoned lock
        // still permits the supervision guard to release retained custody.
        self.0
            .state
            .lock()
            .unwrap_or_else(|error| error.into_inner())
    }

    /// Called by the trusted service adapter with the actual request version.
    /// Errors drop only this response/lease; the caller supplies a fixed private
    /// unavailable response. In particular, H2 must not cancel shared connection
    /// traffic or receive the HTTP/1 Connection header.
    pub(crate) fn prepare_response(
        &self,
        mut response: Response,
        request_version: Version,
    ) -> Result<Response, MediaTransportError> {
        let Some(lease) = response.extensions_mut().remove::<MediaLease>() else {
            return Ok(response);
        };
        if !response.status().is_success() {
            return Ok(response);
        }
        if !lease
            .owner
            .upgrade()
            .is_some_and(|owner| Arc::ptr_eq(&owner, &self.0))
        {
            return Err(MediaTransportError::WrongConnection);
        }
        if !matches!(request_version, Version::HTTP_10 | Version::HTTP_11) {
            return Err(MediaTransportError::UnsupportedVersion);
        }
        {
            let mut state = self.state();
            if state.closed {
                return Err(MediaTransportError::ConnectionClosed);
            }
            if state.lease.is_some() {
                return Err(MediaTransportError::AlreadyArmed);
            }
            state.last_write = Some(Instant::now());
            state.lease = Some(lease.authority);
        }
        response
            .headers_mut()
            .insert(CONNECTION, HeaderValue::from_static("close"));
        self.0.changed.notify_one();
        Ok(response)
    }

    /// Wrap TCP before TLS when TLS is used. Positive socket writes, rather than
    /// TLS plaintext buffering, then constitute progress. Handshakes are unarmed.
    pub(crate) fn watch_io<T>(&self, io: T) -> WatchedIo<T> {
        WatchedIo {
            inner: Box::pin(io),
            control: self.clone(),
        }
    }

    fn wrote(&self, bytes: usize) {
        if bytes == 0 {
            return;
        }
        let armed = {
            let mut state = self.state();
            if state.lease.is_some() && !state.closed {
                state.last_write = Some(Instant::now());
                true
            } else {
                false
            }
        };
        if armed {
            self.0.changed.notify_one();
        }
    }

    /// Own/poll the actual Hyper connection, not a detached watcher. Cancellation
    /// drops the future, body and transport. The guard also clears custody if the
    /// outer task is aborted or this future is otherwise dropped.
    pub(crate) async fn supervise<F: Future>(&self, connection: F) -> Result<F::Output, MediaStop> {
        {
            let mut state = self.state();
            if state.supervising || state.closed {
                return Err(MediaStop::AlreadySupervised);
            }
            state.supervising = true;
        }
        let _guard = SupervisionGuard(self.clone());
        tokio::pin!(connection);
        let mut next_authority: Option<Instant> = None;
        loop {
            let armed = {
                let state = self.state();
                state
                    .lease
                    .as_ref()
                    .map(|lease| (lease.clone(), state.last_write.expect("armed write clock")))
            };
            if let Some((lease, last_write)) = armed {
                let now = Instant::now();
                let idle_deadline = last_write + self.0.write_idle;
                if now >= idle_deadline {
                    return Err(MediaStop::WriteIdle);
                }
                if next_authority.is_none_or(|next| now >= next) {
                    if !lease.authorized() {
                        return Err(MediaStop::AuthorityRevoked);
                    }
                    next_authority = Some(now + self.0.authority_check);
                }
                // Only the connection state holds this extra custody reference
                // during awaits. Body EOF does not disarm that state.
                drop(lease);
                let wake = idle_deadline.min(next_authority.expect("armed authority clock"));
                tokio::select! {
                    biased;
                    result = &mut connection => return Ok(result),
                    _ = self.0.changed.notified() => {},
                    _ = tokio::time::sleep_until(wake) => {},
                }
            } else {
                // No timer, authority callback or cutoff for ordinary traffic.
                tokio::select! {
                    biased;
                    result = &mut connection => return Ok(result),
                    _ = self.0.changed.notified() => {},
                }
            }
        }
    }
}

struct SupervisionGuard(ConnectionControl);

impl Drop for SupervisionGuard {
    fn drop(&mut self) {
        let lease = {
            let mut state = self.0.state();
            state.closed = true;
            state.supervising = false;
            state.last_write = None;
            state.lease.take()
        };
        // Broker custody destructors must not run while the connection lock is held.
        drop(lease);
    }
}

pub(crate) struct WatchedIo<T> {
    inner: Pin<Box<T>>,
    control: ConnectionControl,
}

impl<T: AsyncRead> AsyncRead for WatchedIo<T> {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buffer: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        self.get_mut().inner.as_mut().poll_read(cx, buffer)
    }
}

impl<T: AsyncWrite> AsyncWrite for WatchedIo<T> {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buffer: &[u8],
    ) -> Poll<io::Result<usize>> {
        let this = self.get_mut();
        let result = this.inner.as_mut().poll_write(cx, buffer);
        if let Poll::Ready(Ok(bytes)) = &result {
            this.control.wrote(*bytes);
        }
        result
    }

    fn poll_write_vectored(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buffers: &[IoSlice<'_>],
    ) -> Poll<io::Result<usize>> {
        let this = self.get_mut();
        let result = this.inner.as_mut().poll_write_vectored(cx, buffers);
        if let Poll::Ready(Ok(bytes)) = &result {
            this.control.wrote(*bytes);
        }
        result
    }

    fn is_write_vectored(&self) -> bool {
        self.inner.is_write_vectored()
    }

    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        self.get_mut().inner.as_mut().poll_flush(cx)
    }

    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        self.get_mut().inner.as_mut().poll_shutdown(cx)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, http::StatusCode};
    use futures_util::future::poll_fn;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    struct Authority {
        valid: Arc<AtomicBool>,
        checks: Arc<AtomicUsize>,
    }

    impl MediaAuthority for Authority {
        fn authorized(&self) -> bool {
            self.checks.fetch_add(1, Ordering::SeqCst);
            self.valid.load(Ordering::SeqCst)
        }
    }

    fn authority() -> (Arc<Authority>, Arc<AtomicBool>, Arc<AtomicUsize>) {
        let valid = Arc::new(AtomicBool::new(true));
        let checks = Arc::new(AtomicUsize::new(0));
        (
            Arc::new(Authority {
                valid: valid.clone(),
                checks: checks.clone(),
            }),
            valid,
            checks,
        )
    }

    fn marked(
        control: &ConnectionControl,
        authority: Arc<Authority>,
        status: StatusCode,
    ) -> Response {
        let mut response = Response::new(Body::empty());
        *response.status_mut() = status;
        response
            .extensions_mut()
            .insert(control.media_lease(authority));
        response
    }

    fn control() -> ConnectionControl {
        ConnectionControl::with_test_budgets(Duration::from_millis(80), Duration::from_millis(5))
    }

    struct FakeIo {
        write_ready: bool,
        flush_ready: bool,
        shutdown_ready: bool,
    }

    impl AsyncRead for FakeIo {
        fn poll_read(
            self: Pin<&mut Self>,
            _cx: &mut Context<'_>,
            buffer: &mut ReadBuf<'_>,
        ) -> Poll<io::Result<()>> {
            if buffer.remaining() > 0 {
                buffer.put_slice(b"x");
            }
            Poll::Ready(Ok(()))
        }
    }

    impl AsyncWrite for FakeIo {
        fn poll_write(
            self: Pin<&mut Self>,
            _cx: &mut Context<'_>,
            buffer: &[u8],
        ) -> Poll<io::Result<usize>> {
            if self.write_ready {
                Poll::Ready(Ok(buffer.len()))
            } else {
                Poll::Pending
            }
        }

        fn poll_write_vectored(
            self: Pin<&mut Self>,
            _cx: &mut Context<'_>,
            buffers: &[IoSlice<'_>],
        ) -> Poll<io::Result<usize>> {
            if self.write_ready {
                Poll::Ready(Ok(buffers.iter().map(|b| b.len()).sum()))
            } else {
                Poll::Pending
            }
        }

        fn is_write_vectored(&self) -> bool {
            true
        }

        fn poll_flush(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<io::Result<()>> {
            if self.flush_ready {
                Poll::Ready(Ok(()))
            } else {
                Poll::Pending
            }
        }

        fn poll_shutdown(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<io::Result<()>> {
            if self.shutdown_ready {
                Poll::Ready(Ok(()))
            } else {
                Poll::Pending
            }
        }
    }

    async fn bounded<F: Future>(future: F) -> F::Output {
        tokio::time::timeout(Duration::from_secs(2), future)
            .await
            .expect("connection fixture must terminate")
    }

    #[tokio::test]
    async fn public_and_failed_responses_leave_pending_io_unbounded_by_media_policy() {
        for failed_marker in [false, true] {
            let control = control();
            let (owner, _, checks) = authority();
            let response = if failed_marker {
                marked(&control, owner, StatusCode::TOO_MANY_REQUESTS)
            } else {
                Response::new(Body::empty())
            };
            let response = control
                .prepare_response(response, Version::HTTP_11)
                .unwrap();
            assert!(response.headers().get(CONNECTION).is_none());
            assert!(control.state().lease.is_none());
            let mut io = control.watch_io(FakeIo {
                write_ready: false,
                flush_ready: false,
                shutdown_ready: false,
            });
            let result = tokio::time::timeout(
                Duration::from_millis(160),
                control.supervise(async move { io.write_all(b"public").await }),
            )
            .await;
            assert!(
                result.is_err(),
                "only the test deadline may stop unarmed traffic"
            );
            assert_eq!(checks.load(Ordering::SeqCst), 0);
        }
    }

    #[tokio::test]
    async fn h2_media_drops_only_its_lease_without_arming_the_connection() {
        let control = control();
        let (owner, _, checks) = authority();
        let weak = Arc::downgrade(&owner);
        assert!(matches!(
            control.prepare_response(marked(&control, owner, StatusCode::OK), Version::HTTP_2),
            Err(MediaTransportError::UnsupportedVersion)
        ));
        assert!(weak.upgrade().is_none());
        assert!(control.state().lease.is_none());
        assert_eq!(checks.load(Ordering::SeqCst), 0);
        assert_eq!(bounded(control.supervise(async { 42 })).await, Ok(42));
    }

    #[tokio::test]
    async fn media_marker_cannot_arm_a_different_or_replacement_connection() {
        for issuer_closed in [false, true] {
            let issuer = control();
            let receiver = control();
            let (owner, _, checks) = authority();
            let weak = Arc::downgrade(&owner);
            let response = marked(&issuer, owner, StatusCode::OK);
            let issuer = (!issuer_closed).then_some(issuer);
            assert!(matches!(
                receiver.prepare_response(response, Version::HTTP_11),
                Err(MediaTransportError::WrongConnection)
            ));
            assert!(!receiver.is_armed_for_test());
            assert!(issuer
                .as_ref()
                .is_none_or(|control| !control.is_armed_for_test()));
            assert!(weak.upgrade().is_none());
            assert_eq!(checks.load(Ordering::SeqCst), 0);
            assert_eq!(bounded(receiver.supervise(async { 42 })).await, Ok(42));
        }
    }

    #[tokio::test]
    async fn authority_revocation_ends_a_connection_without_body_or_io_progress() {
        let control = control();
        let (owner, valid, checks) = authority();
        let weak = Arc::downgrade(&owner);
        let response = control
            .prepare_response(marked(&control, owner, StatusCode::OK), Version::HTTP_11)
            .unwrap();
        assert_eq!(response.headers()[CONNECTION], "close");
        drop(response);
        let revoke = async {
            tokio::time::sleep(Duration::from_millis(15)).await;
            valid.store(false, Ordering::SeqCst);
        };
        let (result, ()) = bounded(async {
            tokio::join!(control.supervise(std::future::pending::<()>()), revoke)
        })
        .await;
        assert_eq!(result, Err(MediaStop::AuthorityRevoked));
        assert!(checks.load(Ordering::SeqCst) >= 1);
        assert!(weak.upgrade().is_none());
    }

    #[tokio::test]
    async fn final_flush_and_shutdown_keep_custody_after_body_drop_until_timeout() {
        for shutdown in [false, true] {
            let control = control();
            let (owner, _, _) = authority();
            let weak = Arc::downgrade(&owner);
            let body_lease = control.media_lease(owner.clone());
            control
                .prepare_response(marked(&control, owner, StatusCode::OK), Version::HTTP_11)
                .unwrap();
            drop(body_lease);
            assert!(
                weak.upgrade().is_some(),
                "body EOF must not drop connection custody"
            );
            let mut io = control.watch_io(FakeIo {
                write_ready: true,
                flush_ready: false,
                shutdown_ready: false,
            });
            let result = bounded(control.supervise(async move {
                io.write_all(b"last chunk").await.unwrap();
                if shutdown {
                    io.shutdown().await
                } else {
                    io.flush().await
                }
            }))
            .await;
            assert!(matches!(result, Err(MediaStop::WriteIdle)));
            assert!(weak.upgrade().is_none());
        }
    }

    #[tokio::test]
    async fn positive_normal_and_vectored_writes_extend_only_the_idle_budget() {
        for write in ["none", "normal", "vectored"] {
            // The real production bound avoids scheduler-sensitive short sleeps.
            // An unrefreshed clock must already be expired before supervision.
            let control = ConnectionControl::new();
            let (owner, _, _) = authority();
            control
                .prepare_response(marked(&control, owner, StatusCode::OK), Version::HTTP_11)
                .unwrap();
            control.state().last_write = Some(Instant::now() - WRITE_IDLE - Duration::from_secs(1));
            let mut io = control.watch_io(FakeIo {
                write_ready: true,
                flush_ready: true,
                shutdown_ready: true,
            });
            match write {
                "normal" => io.write_all(b"data").await.unwrap(),
                "vectored" => assert_eq!(
                    io.write_vectored(&[IoSlice::new(b"d"), IoSlice::new(b"ata")])
                        .await
                        .unwrap(),
                    4
                ),
                _ => {}
            }
            let result = bounded(control.supervise(async { 42 })).await;
            if write == "none" {
                assert_eq!(result, Err(MediaStop::WriteIdle));
            } else {
                assert_eq!(
                    result,
                    Ok(42),
                    "actual {write} write must refresh the stale clock"
                );
            }
            assert!(!control.is_armed_for_test());
        }
    }

    #[tokio::test]
    async fn reads_flushes_pending_and_zero_byte_writes_do_not_refresh_idle() {
        let control = control();
        let (owner, _, _) = authority();
        control
            .prepare_response(marked(&control, owner, StatusCode::OK), Version::HTTP_11)
            .unwrap();
        let mut io = control.watch_io(FakeIo {
            write_ready: false,
            flush_ready: true,
            shutdown_ready: true,
        });
        let result = bounded(control.supervise(async move {
            loop {
                let mut byte = [0];
                io.read_exact(&mut byte).await.unwrap();
                io.flush().await.unwrap();
                poll_fn(|cx| {
                    assert!(Pin::new(&mut io).poll_write(cx, b"pending").is_pending());
                    Poll::Ready(())
                })
                .await;
                io.control.wrote(0);
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        }))
        .await;
        assert!(matches!(result, Err(MediaStop::WriteIdle)));
    }

    #[tokio::test]
    async fn supervisor_abort_and_normal_completion_release_lease_without_detached_task() {
        for abort in [false, true] {
            let control = control();
            let (owner, _, _) = authority();
            let weak = Arc::downgrade(&owner);
            control
                .prepare_response(marked(&control, owner, StatusCode::OK), Version::HTTP_11)
                .unwrap();
            if abort {
                let cloned = control.clone();
                let (ready, started) = tokio::sync::oneshot::channel();
                let task = tokio::spawn(async move {
                    cloned
                        .supervise(async move {
                            let _ = ready.send(());
                            std::future::pending::<()>().await;
                        })
                        .await
                });
                bounded(started).await.unwrap();
                task.abort();
                assert!(bounded(task).await.unwrap_err().is_cancelled());
            } else {
                assert_eq!(bounded(control.supervise(async { 42 })).await, Ok(42));
            }
            assert!(weak.upgrade().is_none());
            assert!(control.state().closed);
        }
    }

    #[tokio::test]
    async fn late_admission_wakes_dormant_supervision_and_cannot_be_retargeted() {
        let control = control();
        let (first, valid, _) = authority();
        let first_weak = Arc::downgrade(&first);
        let arm = async {
            tokio::time::sleep(Duration::from_millis(10)).await;
            control
                .prepare_response(marked(&control, first, StatusCode::OK), Version::HTTP_11)
                .unwrap();
            let (second, _, _) = authority();
            let second_weak = Arc::downgrade(&second);
            assert!(matches!(
                control
                    .prepare_response(marked(&control, second, StatusCode::OK), Version::HTTP_11),
                Err(MediaTransportError::AlreadyArmed)
            ));
            assert!(second_weak.upgrade().is_none());
            valid.store(false, Ordering::SeqCst);
        };
        let (result, ()) =
            bounded(async { tokio::join!(control.supervise(std::future::pending::<()>()), arm) })
                .await;
        assert_eq!(result, Err(MediaStop::AuthorityRevoked));
        assert!(first_weak.upgrade().is_none());
    }
}
