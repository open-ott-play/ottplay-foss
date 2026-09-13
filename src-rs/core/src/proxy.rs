//! Bounded HTTP playlist proxy. Each connection uses only previously checked DNS
//! answers; redirects and environment proxies cannot bypass that check.
use std::future::Future;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, ToSocketAddrs};
use std::time::Duration;

use reqwest::{header::HeaderMap, redirect, Client, Url};
use tokio::sync::Semaphore;

const MAX_BYTES: usize = 16 * 1024 * 1024;
const MAX_REQUESTS: usize = 8;
const MAX_REDIRECTS: usize = 5;
const TIMEOUT: Duration = Duration::from_secs(15);
static REQUESTS: Semaphore = Semaphore::const_new(MAX_REQUESTS);
static DNS_REQUESTS: Semaphore = Semaphore::const_new(MAX_REQUESTS);

#[derive(Clone, Default)]
struct Policy {
    // Only exact literal RFC1918/ULA origins can enter this list via configuration.
    lan_origins: Vec<String>,
}

fn http_url(raw: &str) -> Result<Url, String> {
    let url = Url::parse(raw).map_err(|_| "Invalid proxy URL")?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err("Only HTTP(S) proxy URLs are supported".into());
    }
    Ok(url)
}

fn redirect_url(current: &Url, location: &str) -> Result<Url, String> {
    let joined = current
        .join(location)
        .map_err(|_| "Invalid proxy redirect")?;
    let mut next = http_url(joined.as_str())?;
    // URL::join drops userinfo for an absolute Location. Preserve the original
    // Basic credentials only within the exact same scheme/host/effective port.
    if next.origin() == current.origin()
        && next.username().is_empty()
        && next.password().is_none()
        && (!current.username().is_empty() || current.password().is_some())
    {
        next.set_username(current.username())
            .map_err(|_| "Invalid proxy redirect")?;
        next.set_password(current.password())
            .map_err(|_| "Invalid proxy redirect")?;
    }
    Ok(next)
}

fn literal_ip(url: &Url) -> Option<IpAddr> {
    url.host_str()?
        .trim_start_matches('[')
        .trim_end_matches(']')
        .parse()
        .ok()
}

fn is_lan(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => ip.is_private(),
        IpAddr::V6(ip) => ip.segments()[0] & 0xfe00 == 0xfc00,
    }
}

fn public_v4(ip: Ipv4Addr) -> bool {
    let [a, b, c, _] = ip.octets();
    !(a == 0
        || a == 10
        || a == 127
        || a >= 224
        || (a == 100 && (64..=127).contains(&b))
        || (a == 169 && b == 254)
        || (a == 172 && (16..=31).contains(&b))
        || (a == 192
            && (b == 168 || (b == 0 && c == 0) || (b == 0 && c == 2) || (b == 88 && c == 99)))
        || (a == 198 && (b == 18 || b == 19 || (b == 51 && c == 100)))
        || (a == 203 && b == 0 && c == 113))
}

fn public_v6(ip: Ipv6Addr) -> bool {
    if let Some(v4) = ip.to_ipv4_mapped() {
        return public_v4(v4);
    }
    let s = ip.segments();
    // Only global unicast. Exclude special-use, documentation and 6to4 ranges;
    // NAT64, ULA, link-local, multicast and IPv4-compatible forms are outside /3.
    s[0] & 0xe000 == 0x2000
        && !(s[0] == 0x2001 && s[1] < 0x0200)
        && !(s[0] == 0x2001 && s[1] == 0x0db8)
        && s[0] != 0x2002
        && !(s[0] == 0x3fff && s[1] < 0x1000)
}

fn is_public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => public_v4(ip),
        IpAddr::V6(ip) => public_v6(ip),
    }
}

impl Policy {
    fn parse(raw: &str) -> Result<Self, String> {
        let mut policy = Self::default();
        for entry in raw
            .split(',')
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            let url = http_url(entry).map_err(|_| "Invalid OTTPLAY_PROXY_LAN_ORIGINS")?;
            if !literal_ip(&url).is_some_and(is_lan)
                || !url.username().is_empty()
                || url.password().is_some()
                || !matches!(url.path(), "" | "/")
                || url.query().is_some()
                || url.fragment().is_some()
            {
                return Err("OTTPLAY_PROXY_LAN_ORIGINS requires exact HTTP(S) origins with literal RFC1918/ULA addresses".into());
            }
            policy.lan_origins.push(url.origin().ascii_serialization());
        }
        Ok(policy)
    }

    fn check_addresses(&self, url: &Url, addresses: &[SocketAddr]) -> Result<(), String> {
        let lan_allowed = self
            .lan_origins
            .contains(&url.origin().ascii_serialization());
        if addresses.is_empty()
            || addresses.len() > 32
            || addresses
                .iter()
                .any(|address| !(is_public(address.ip()) || lan_allowed && is_lan(address.ip())))
        {
            return Err("Proxy destination is not allowed".into());
        }
        Ok(())
    }

    async fn resolve(&self, url: &Url) -> Result<Vec<SocketAddr>, String> {
        let port = url.port_or_known_default().ok_or("Invalid proxy port")?;
        let addresses = if let Some(ip) = literal_ip(url) {
            vec![SocketAddr::new(ip, port)]
        } else {
            let host = url.host_str().ok_or("Invalid proxy host")?.to_string();
            let permit = DNS_REQUESTS
                .try_acquire()
                .map_err(|_| "Proxy DNS is busy; retry later")?;
            // A timed-out request cannot cancel libc DNS. Keep its separate slot
            // inside the blocking job until lookup really finishes.
            tokio::task::spawn_blocking(move || {
                let _permit = permit;
                (host.as_str(), port)
                    .to_socket_addrs()
                    .map(|answers| answers.take(33).collect())
            })
            .await
            .map_err(|_| "Proxy DNS lookup failed")?
            .map_err(|_| "Proxy DNS lookup failed")?
        };
        self.check_addresses(url, &addresses)?;
        Ok(addresses)
    }
}

async fn request_pinned(
    url: Url,
    ua: &str,
    addresses: &[SocketAddr],
) -> Result<reqwest::Response, String> {
    let client = Client::builder()
        .no_proxy()
        .redirect(redirect::Policy::none())
        .timeout(TIMEOUT)
        // The original hostname remains in Host and TLS SNI/certificate checks.
        // The connector cannot perform a second, potentially rebound DNS lookup.
        .resolve_to_addrs(url.host_str().ok_or("Invalid proxy host")?, addresses)
        .build()
        .map_err(|_| "Cannot create proxy client")?;
    client
        .get(url)
        .header("User-Agent", ua)
        .send()
        .await
        .map_err(|_| "Proxy upstream request failed".into())
}

async fn fetch_checked<F, Fut>(
    mut url: Url,
    ua: &str,
    mut check: F,
    max_bytes: usize,
) -> Result<(HeaderMap, Vec<u8>), String>
where
    F: FnMut(Url) -> Fut,
    Fut: Future<Output = Result<Vec<SocketAddr>, String>>,
{
    for hop in 0..=MAX_REDIRECTS {
        let addresses = check(url.clone()).await?;
        let mut response = request_pinned(url.clone(), ua, &addresses).await?;
        let status = response.status();
        if matches!(status.as_u16(), 301 | 302 | 303 | 307 | 308) {
            if hop == MAX_REDIRECTS {
                return Err("Too many proxy redirects".into());
            }
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|value| value.to_str().ok())
                .ok_or("Invalid proxy redirect")?;
            url = redirect_url(&url, location)?;
            continue;
        }
        if !status.is_success() {
            return Err(format!("Upstream {status}"));
        }
        if response
            .content_length()
            .is_some_and(|size| size > max_bytes as u64)
        {
            return Err("Proxy response exceeds byte limit".into());
        }
        let headers = response.headers().clone();
        let mut body = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| "Proxy response read failed")?
        {
            if chunk.len() > max_bytes - body.len() {
                return Err("Proxy response exceeds byte limit".into());
            }
            body.extend_from_slice(&chunk);
        }
        return Ok((headers, body));
    }
    Err("Too many proxy redirects".into())
}

async fn limited<T>(
    requests: &Semaphore,
    work: impl Future<Output = Result<T, String>>,
) -> Result<T, String> {
    // Reject overload immediately instead of creating an unbounded waiter queue.
    let _permit = requests
        .try_acquire()
        .map_err(|_| "Proxy is busy; retry later")?;
    tokio::time::timeout(TIMEOUT, work)
        .await
        .map_err(|_| "Proxy request timed out")?
}

pub(crate) async fn fetch(raw: &str, ua: &str) -> Result<(HeaderMap, Vec<u8>), String> {
    limited(&REQUESTS, async {
        let url = http_url(raw)?;
        let policy =
            Policy::parse(&std::env::var("OTTPLAY_PROXY_LAN_ORIGINS").unwrap_or_default())?;
        fetch_checked(
            url,
            ua,
            |url| {
                let policy = policy.clone();
                async move { policy.resolve(&url).await }
            },
            MAX_BYTES,
        )
        .await
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[test]
    fn public_destinations_exclude_special_ipv4_ipv6_and_numeric_aliases() {
        for value in [
            "8.8.8.8",
            "93.184.216.34",
            "2606:4700:4700::1111",
            "2001:4860:4860::8888",
        ] {
            assert!(is_public(value.parse().unwrap()), "{value}");
        }
        for value in [
            "0.0.0.0",
            "10.1.2.3",
            "127.0.0.1",
            "100.64.0.1",
            "169.254.169.254",
            "172.16.0.1",
            "192.168.1.1",
            "192.0.0.1",
            "192.0.2.1",
            "198.18.0.1",
            "198.51.100.1",
            "203.0.113.1",
            "224.0.0.1",
            "240.0.0.1",
            "::",
            "::1",
            "::ffff:127.0.0.1",
            "::ffff:169.254.169.254",
            "::127.0.0.1",
            "fc00::1",
            "fe80::1",
            "ff02::1",
            "64:ff9b::7f00:1",
            "2001::1",
            "2001:db8::1",
            "2002:7f00:1::",
            "3fff::1",
        ] {
            assert!(!is_public(value.parse().unwrap()), "{value}");
        }
        for raw in [
            "http://2130706433/",
            "http://0x7f000001/",
            "http://127.1/",
            "http://[::ffff:127.0.0.1]/",
        ] {
            assert!(
                !is_public(literal_ip(&http_url(raw).unwrap()).unwrap()),
                "{raw}"
            );
        }
        assert!(http_url("file:///tmp/secret").is_err());
        assert!(http_url("ftp://example.com/playlist").is_err());
    }

    #[test]
    fn dns_answer_sets_fail_closed_and_lan_exceptions_are_exact_origins() {
        let public = http_url("https://provider.example/playlist?password=secret").unwrap();
        let addresses = [
            "8.8.8.8:443".parse().unwrap(),
            "127.0.0.1:443".parse().unwrap(),
        ];
        assert!(Policy::default()
            .check_addresses(&public, &addresses)
            .is_err());
        let policy = Policy::parse("http://192.168.1.20:8080, https://[fd00::10]:8443").unwrap();
        let ip = ["192.168.1.20:8080".parse().unwrap()];
        assert!(policy
            .check_addresses(&http_url("http://192.168.1.20:8080/list").unwrap(), &ip)
            .is_ok());
        for url in [
            "http://192.168.1.20:8081/list",
            "https://192.168.1.20:8080/list",
            "http://provider.example:8080/list",
        ] {
            assert!(policy
                .check_addresses(&http_url(url).unwrap(), &ip)
                .is_err());
        }
        for origin in [
            "*",
            "http://127.0.0.1:8080",
            "http://169.254.169.254",
            "http://[::1]",
            "http://provider.example",
            "http://192.168.1.0/24",
            "http://user:secret@192.168.1.20",
            "http://192.168.1.20?allow=all",
        ] {
            assert!(Policy::parse(origin).is_err(), "{origin}");
        }
    }

    async fn fixture(response: &'static [u8]) -> (SocketAddr, tokio::task::JoinHandle<String>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let task = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = vec![0; 4096];
            let length = socket.read(&mut request).await.unwrap();
            socket.write_all(response).await.unwrap();
            String::from_utf8_lossy(&request[..length]).to_string()
        });
        (address, task)
    }

    #[tokio::test]
    async fn transport_pins_checked_address_and_preserves_host_and_user_agent() {
        let (address, request) =
            fixture(b"HTTP/1.1 200 OK\r\nContent-Length: 7\r\nConnection: close\r\n\r\n#EXTM3U")
                .await;
        // This hostname cannot resolve publicly; only the supplied checked address works.
        let url = http_url(&format!(
            "http://pinning-fixture.invalid:{}/list",
            address.port()
        ))
        .unwrap();
        let response = request_pinned(url, "OTT-audit-UA", &[address])
            .await
            .unwrap();
        assert_eq!(response.text().await.unwrap(), "#EXTM3U");
        let raw = request.await.unwrap().to_lowercase();
        assert!(raw.contains(&format!("host: pinning-fixture.invalid:{}", address.port())));
        assert!(raw.contains("user-agent: ott-audit-ua"));
    }

    #[tokio::test]
    async fn redirect_destination_is_rechecked_before_connecting() {
        let (address, request) = fixture(b"HTTP/1.1 302 Found\r\nLocation: http://169.254.169.254/latest/meta-data\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await;
        let url = http_url(&format!(
            "http://redirect-fixture.invalid:{}/list",
            address.port()
        ))
        .unwrap();
        let error = fetch_checked(
            url,
            "audit",
            |url| async move {
                // Approve just the dummy first hop; every redirect uses the real policy.
                if url.host_str() == Some("redirect-fixture.invalid") {
                    Ok(vec![address])
                } else {
                    Policy::default().resolve(&url).await
                }
            },
            MAX_BYTES,
        )
        .await
        .unwrap_err();
        assert_eq!(error, "Proxy destination is not allowed");
        request.await.unwrap();
    }

    #[tokio::test]
    async fn redirects_keep_basic_auth_only_within_the_same_origin() {
        for kind in ["relative", "absolute", "other"] {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let location = match kind {
                "relative" => "/final".to_string(),
                "absolute" => format!(
                    "http://credentials-fixture.invalid:{}/final",
                    address.port()
                ),
                _ => format!("http://other-fixture.invalid:{}/final", address.port()),
            };
            let task = tokio::spawn(async move {
                let mut requests = Vec::new();
                for reply in [
                    format!("HTTP/1.1 302 Found\r\nLocation: {location}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"),
                    "HTTP/1.1 200 OK\r\nContent-Length: 7\r\nConnection: close\r\n\r\n#EXTM3U".into(),
                ] {
                    let (mut socket, _) = listener.accept().await.unwrap();
                    let mut request = vec![0; 4096];
                    let length = socket.read(&mut request).await.unwrap();
                    requests.push(String::from_utf8_lossy(&request[..length]).to_lowercase());
                    socket.write_all(reply.as_bytes()).await.unwrap();
                }
                requests
            });
            let url = http_url(&format!(
                "http://dummy:secret@credentials-fixture.invalid:{}/start",
                address.port()
            ))
            .unwrap();
            let (_, body) = fetch_checked(url, "audit", |_| async { Ok(vec![address]) }, MAX_BYTES)
                .await
                .unwrap();
            assert_eq!(body, b"#EXTM3U");
            let requests = task.await.unwrap();
            assert!(requests[0].contains("authorization: basic zhvtbxk6c2vjcmv0"));
            assert_eq!(
                requests[1].contains("authorization: basic zhvtbxk6c2vjcmv0"),
                kind != "other",
                "{kind}"
            );
        }
        let current = http_url("https://user%40name:secret%2Fkey@provider.example/start").unwrap();
        let same = redirect_url(&current, "https://provider.example/final").unwrap();
        assert_eq!(same.username(), current.username());
        assert_eq!(same.password(), current.password());
        for target in [
            "http://provider.example/final",
            "https://provider.example:8443/final",
            "https://other.example/final",
        ] {
            let next = redirect_url(&current, target).unwrap();
            assert!(next.username().is_empty());
            assert!(next.password().is_none());
        }
    }

    #[tokio::test]
    async fn byte_limit_covers_declared_and_chunked_responses() {
        for response in [
            b"HTTP/1.1 200 OK\r\nContent-Length: 17\r\nConnection: close\r\n\r\n01234567890123456".as_slice(),
            b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n8\r\n01234567\r\n9\r\n890123456\r\n0\r\n\r\n".as_slice(),
        ] {
            let (address, request) = fixture(response).await;
            let url = http_url(&format!("http://size-fixture.invalid:{}/list", address.port())).unwrap();
            let error = fetch_checked(url, "audit", |_| async { Ok(vec![address]) }, 16).await.unwrap_err();
            assert_eq!(error, "Proxy response exceeds byte limit");
            request.await.unwrap();
        }
    }

    #[tokio::test]
    async fn overload_rejects_without_running_work_and_errors_release_permits() {
        let requests = Semaphore::new(1);
        let held = requests.acquire().await.unwrap();
        let result: Result<(), String> =
            limited(&requests, async { panic!("busy work must not run") }).await;
        assert_eq!(result.unwrap_err(), "Proxy is busy; retry later");
        drop(held);
        let failed: Result<(), String> =
            limited(&requests, async { Err("upstream failed".into()) }).await;
        assert!(failed.is_err());
        assert_eq!(requests.available_permits(), 1);
        {
            let pending = limited::<()>(&requests, std::future::pending());
            tokio::pin!(pending);
            tokio::select! { result = &mut pending => panic!("unexpected {result:?}"), _ = tokio::task::yield_now() => {} }
            assert_eq!(requests.available_permits(), 0);
        }
        assert_eq!(requests.available_permits(), 1);
    }
}
