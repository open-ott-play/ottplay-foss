//! Text HTTP transport for the embedded frontend's jQuery AJAX requests.

use std::collections::HashMap;
use std::time::Duration;

use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpResponse {
    status: u16,
    status_text: String,
    body: String,
    headers: String,
}

#[derive(Debug, Serialize)]
pub struct HttpError {
    message: String,
    timeout: bool,
}

impl From<reqwest::Error> for HttpError {
    fn from(error: reqwest::Error) -> Self {
        Self {
            message: error.to_string(),
            timeout: error.is_timeout(),
        }
    }
}

/// HTTP errors are responses, not IPC failures: jQuery needs their status/body.
/// No browser cookies are imported; explicit provider request headers survive.
#[tauri::command]
pub async fn proxy_http(
    url: String,
    method: String,
    body: Option<String>,
    headers: Option<HashMap<String, String>>,
    timeout_ms: Option<u64>,
    secure_control: Option<bool>,
) -> Result<HttpResponse, HttpError> {
    let secure_control = secure_control.unwrap_or(false);
    let url =
        reqwest::Url::parse(url.strip_prefix('@').unwrap_or(&url)).map_err(|error| HttpError {
            message: error.to_string(),
            timeout: false,
        })?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(HttpError {
            message: "Only HTTP(S) URLs are supported".into(),
            timeout: false,
        });
    }
    if secure_control
        && (url.scheme() != "https"
            || !url.username().is_empty()
            || url.password().is_some()
            || url.fragment().is_some())
    {
        return Err(HttpError {
            message: "Secure control requests require HTTPS without URL credentials or a fragment"
                .into(),
            timeout: false,
        });
    }
    let method = reqwest::Method::from_bytes(method.as_bytes()).map_err(|error| HttpError {
        message: error.to_string(),
        timeout: false,
    })?;
    let client = client_builder(timeout_ms, secure_control).build()?;
    let mut request = client.request(method, url);
    for (name, value) in headers.unwrap_or_default() {
        request = request.header(name, value);
    }
    if let Some(body) = body {
        request = request.body(body);
    }
    let response = request.send().await?;
    let status = response.status();
    let mut headers = String::new();
    for (name, value) in response.headers() {
        if let Ok(value) = value.to_str() {
            headers.push_str(name.as_str());
            headers.push_str(": ");
            headers.push_str(value);
            headers.push_str("\r\n");
        }
    }
    Ok(HttpResponse {
        status: status.as_u16(),
        status_text: status.canonical_reason().unwrap_or("").to_string(),
        headers,
        body: response.text().await?,
    })
}

fn client_builder(timeout_ms: Option<u64>, secure_control: bool) -> reqwest::ClientBuilder {
    let builder = reqwest::Client::builder()
        .timeout(Duration::from_millis(timeout_ms.unwrap_or(30000).max(1)))
        .user_agent("OTT-play-FOSS/1.0");
    if secure_control {
        // Pairing claims carry bearer credentials. Even a same-host redirect
        // can change TLS to cleartext; return the redirect response untouched.
        builder
            .https_only(true)
            .redirect(reqwest::redirect::Policy::none())
    } else {
        builder
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::TcpListener;

    #[tokio::test]
    async fn preserves_http_error_body_headers_and_post_request() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!(
            "http://{}/m3u/match-channels?source=custom",
            listener.local_addr().unwrap()
        );
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            let mut reader = BufReader::new(&mut stream);
            let mut request = String::new();
            let mut content_length = 0;
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                if line == "\r\n" || line.is_empty() {
                    break;
                }
                if let Some(value) = line.to_lowercase().strip_prefix("content-length:") {
                    content_length = value.trim().parse::<usize>().unwrap();
                }
                request.push_str(&line);
            }
            let mut body = vec![0; content_length];
            reader.read_exact(&mut body).unwrap();
            stream.write_all(b"HTTP/1.1 403 Forbidden\r\nContent-Type: application/json\r\nX-Upstream: custom\r\nContent-Length: 18\r\nConnection: close\r\n\r\n{\"error\":\"denied\"}").unwrap();
            (request, body)
        });
        let response = proxy_http(
            url,
            "POST".into(),
            Some("{}\n\t\nchannels".into()),
            Some(HashMap::from([
                ("Authorization".into(), "Bearer test".into()),
                ("Content-Type".into(), "text/plain".into()),
            ])),
            Some(2000),
            None,
        )
        .await
        .unwrap();
        assert_eq!(response.status, 403);
        assert_eq!(response.status_text, "Forbidden");
        assert_eq!(response.body, r#"{"error":"denied"}"#);
        assert!(response.headers.contains("x-upstream: custom\r\n"));
        let (request, body) = server.join().unwrap();
        assert!(request.starts_with("POST /m3u/match-channels?source=custom HTTP/1.1\r\n"));
        assert!(request
            .to_lowercase()
            .contains("authorization: bearer test\r\n"));
        assert_eq!(body, b"{}\n\t\nchannels");
    }

    #[tokio::test]
    async fn rejects_non_http_schemes() {
        let error = proxy_http(
            "file:///tmp/playlist".into(),
            "GET".into(),
            None,
            None,
            None,
            None,
        )
        .await
        .unwrap_err();
        assert!(error.message.contains("Only HTTP(S)"));
        assert!(!error.timeout);
    }

    #[tokio::test]
    async fn secure_control_rejects_plaintext_and_url_credentials_before_network_io() {
        for url in [
            "http://127.0.0.1:1/api/pairings?id=receipt",
            "https://user:secret@localhost/api/pairings",
            "https://localhost/api/pairings#fragment",
        ] {
            let error = proxy_http(url.into(), "GET".into(), None, None, Some(100), Some(true))
                .await
                .unwrap_err();
            assert!(error
                .message
                .contains("Secure control requests require HTTPS"));
            assert!(!error.message.contains("secret"));
        }
        // HTTPS-only also applies inside the HTTP client, not just URL parsing.
        assert!(client_builder(Some(100), true)
            .build()
            .unwrap()
            .get("http://127.0.0.1:1/")
            .send()
            .await
            .unwrap_err()
            .is_builder());
    }

    #[tokio::test]
    async fn secure_control_does_not_forward_bearer_on_redirect() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            let mut reader = BufReader::new(&mut stream);
            let mut request = String::new();
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                if line == "\r\n" || line.is_empty() {
                    break;
                }
                request.push_str(&line);
            }
            stream.write_all(format!("HTTP/1.1 307 Temporary Redirect\r\nLocation: http://{address}/leak\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").as_bytes()).unwrap();
            listener.set_nonblocking(true).unwrap();
            std::thread::sleep(Duration::from_millis(150));
            assert!(
                matches!(listener.accept(), Err(error) if error.kind() == std::io::ErrorKind::WouldBlock),
                "redirect destination was contacted"
            );
            request
        });
        // Use a plaintext fixture solely to exercise the production redirect
        // policy. The separate test above covers the HTTPS-only enforcement.
        let client = client_builder(Some(1000), true)
            .https_only(false)
            .build()
            .unwrap();
        let response = client
            .get(format!("http://{address}/api/pairings?id=receipt"))
            .bearer_auth("claim-secret")
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), reqwest::StatusCode::TEMPORARY_REDIRECT);
        assert_eq!(response.url().path(), "/api/pairings");
        assert!(server
            .join()
            .unwrap()
            .to_lowercase()
            .contains("authorization: bearer claim-secret"));
    }
}
