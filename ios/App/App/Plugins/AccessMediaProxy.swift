import Foundation
import Network

// A per-launch, capability-protected listener on loopback only. WKWebView's
// native HLS loader can use it without Safari cookies or custom HTTP headers.
// After initialization, all mutable listener/client state is confined to queue.
final class AccessMediaProxy: @unchecked Sendable {
    fileprivate let queue = DispatchQueue(label: "play.ott.access-media")
    private let listener: NWListener
    fileprivate let sessionConfiguration: () -> URLSessionConfiguration
    private let capability: String
    private var port: UInt16 = 0
    private var failed = false
    private var waiters: [(Result<UInt16, Error>) -> Void] = []
    private var configs: [String: AccessMediaConfig] = [:]
    private var clients: [ObjectIdentifier: AccessMediaConnection] = [:]

    init(sessionConfiguration: @escaping () -> URLSessionConfiguration = { .ephemeral }) throws {
        self.sessionConfiguration = sessionConfiguration
        capability = try AccessMediaPolicy.random()
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
        parameters.allowLocalEndpointReuse = false
        listener = try NWListener(using: parameters)
        listener.stateUpdateHandler = { [weak self] state in
            guard let self else { return }
            switch state {
            case .ready:
                guard let port = self.listener.port?.rawValue else { self.fail(); return }
                self.port = port
                let waiters = self.waiters; self.waiters = []
                waiters.forEach { $0(.success(port)) }
            case .failed, .cancelled: self.fail()
            default: break
            }
        }
        listener.newConnectionHandler = { [weak self] connection in
            guard let self, self.clients.count < 24 else { connection.cancel(); return }
            let client = AccessMediaConnection(connection: connection, proxy: self)
            self.clients[ObjectIdentifier(client)] = client
            client.start()
        }
        listener.start(queue: queue)
    }

    private func fail() {
        failed = true
        let pending = waiters; waiters = []
        pending.forEach { $0(.failure(AccessMediaFailure.unavailable)) }
    }
    func stop() {
        queue.async {
            self.listener.cancel()
            Array(self.clients.values).forEach { $0.close() }
            self.configs = [:]
        }
    }
    fileprivate func finished(_ client: AccessMediaConnection) { clients[ObjectIdentifier(client)] = nil }
    func url(for url: URL, config: AccessMediaConfig) async throws -> URL {
        try await withCheckedThrowingContinuation { continuation in
            queue.async {
                self.configs[config.source_origin] = config
                self.configs[config.media_origin] = config
                let ready: (Result<UInt16, Error>) -> Void = { result in
                    do {
                        _ = try result.get()
                        guard let local = self.localURL(url) else { throw AccessMediaFailure.invalid }
                        continuation.resume(returning: local)
                    } catch { continuation.resume(throwing: error) }
                }
                if self.failed { ready(.failure(AccessMediaFailure.unavailable)) }
                else if self.port != 0 { ready(.success(self.port)) }
                else { self.waiters.append(ready) }
            }
        }
    }
    fileprivate func localURL(_ url: URL) -> URL? {
        guard let origin = AccessMediaPolicy.origin(url), configs[origin]?.map(url) != nil else { return nil }
        let suffix = url.pathExtension.range(of: "^[A-Za-z0-9]{1,8}$", options: .regularExpression) != nil
            ? "." + url.pathExtension : ""
        return URL(string: "http://127.0.0.1:\(port)/access/\(capability)/\(AccessMediaPolicy.base64(Data(url.absoluteString.utf8)))/media\(suffix)")
    }

    fileprivate func parse(_ bytes: Data) throws -> (URLRequest, AccessMediaConfig)? {
        guard bytes.count <= 32768 else { throw AccessMediaFailure.invalid }
        guard let separator = bytes.range(of: Data("\r\n\r\n".utf8)) else { return nil }
        guard separator.upperBound == bytes.count,
              let header = String(data: bytes[..<separator.lowerBound], encoding: .ascii) else { throw AccessMediaFailure.invalid }
        let lines = header.components(separatedBy: "\r\n")
        let first = (lines.first ?? "").split(separator: " ", omittingEmptySubsequences: false)
        guard first.count == 3, ["GET", "HEAD"].contains(String(first[0])),
              ["HTTP/1.0", "HTTP/1.1"].contains(String(first[2])), lines.count < 80 else { throw AccessMediaFailure.invalid }
        var headers: [String: String] = [:]
        for line in lines.dropFirst() {
            guard let colon = line.firstIndex(of: ":"), colon != line.startIndex else { throw AccessMediaFailure.invalid }
            let name = line[..<colon].lowercased()
            guard headers[name] == nil else { throw AccessMediaFailure.invalid }
            headers[name] = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
        }
        guard headers["host"] == "127.0.0.1:\(port)", headers["transfer-encoding"] == nil,
              headers["content-length"] == nil || headers["content-length"] == "0",
              headers["origin"] == nil || headers["origin"] == "capacitor://localhost" else { throw AccessMediaFailure.invalid }
        let path = first[1].split(separator: "/", omittingEmptySubsequences: false)
        guard path.count == 5, path[0].isEmpty, path[1] == "access", path[2] == capability,
              let data = AccessMediaPolicy.decode(String(path[3])),
              let value = String(data: data, encoding: .utf8), let url = URL(string: value),
              let origin = AccessMediaPolicy.origin(url), let config = configs[origin], config.map(url) != nil else {
            throw AccessMediaFailure.invalid
        }
        var request = URLRequest(url: url)
        request.httpMethod = String(first[0]); request.timeoutInterval = 45
        request.setValue("OTT-play-FOSS/1.0", forHTTPHeaderField: "User-Agent")
        for name in ["range", "if-range", "accept"] {
            if let value = headers[name] { request.setValue(value, forHTTPHeaderField: name) }
        }
        return (request, config)
    }
}

private final class AccessMediaConnection: NSObject, URLSessionDataDelegate {
    private let connection: NWConnection
    private let proxy: AccessMediaProxy
    private var input = Data()
    private var session: URLSession?
    private var task: URLSessionDataTask?
    private var original: URLRequest?
    private var authorized: URLRequest?
    private var config: AccessMediaConfig?
    private var response: HTTPURLResponse?
    private var body = Data()
    private var isManifest = false
    private var classified = false
    private var sentHeaders = false
    private var closed = false
    private var retry = false
    private var retrying = false
    private var suspended = false
    private var pendingBytes = 0
    private var deadline: DispatchWorkItem?

    init(connection: NWConnection, proxy: AccessMediaProxy) { self.connection = connection; self.proxy = proxy }
    func start() {
        connection.stateUpdateHandler = { [weak self] state in
            if case .failed = state { self?.close() }
            if case .cancelled = state { self?.close() }
        }
        connection.start(queue: proxy.queue)
        armDeadline(10)
        receive()
    }
    private func armDeadline(_ seconds: Double = 60) {
        deadline?.cancel()
        let deadline = DispatchWorkItem { [weak self] in self?.close() }
        self.deadline = deadline
        proxy.queue.asyncAfter(deadline: .now() + seconds, execute: deadline)
    }
    private func receive() {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 32768) { [weak self] data, _, complete, error in
            guard let self, !self.closed else { return }
            if let data { self.input.append(data) }
            do {
                if let (request, config) = try self.proxy.parse(self.input) {
                    self.original = request; self.config = config
                    self.begin(request, config: config, renew: false)
                } else if complete || error != nil { self.close() }
                else { self.receive() }
            } catch { self.fail(403) }
        }
    }
    private func begin(_ request: URLRequest, config: AccessMediaConfig, renew: Bool) {
        // User interaction can take longer than a segment download.
        armDeadline(180)
        let rejectedCookie = renew ? authorized?.value(forHTTPHeaderField: "Cookie") : nil
        Task {
            do {
                let authorized = try await AccessMedia.shared.authorized(request, config: config,
                    replacing: rejectedCookie)
                proxy.queue.async {
                    guard !self.closed else { return }
                    self.authorized = authorized
                    self.retrying = false
                    let config = self.proxy.sessionConfiguration()
                    config.httpCookieStorage = nil; config.httpShouldSetCookies = false
                    config.urlCredentialStorage = nil; config.urlCache = nil
                    let delegate = OperationQueue(); delegate.maxConcurrentOperationCount = 1
                    delegate.underlyingQueue = self.proxy.queue
                    let session = URLSession(configuration: config, delegate: self, delegateQueue: delegate)
                    self.session = session; self.task = session.dataTask(with: authorized)
                    self.armDeadline(); self.task?.resume()
                }
            } catch { proxy.queue.async { self.fail(401) } }
        }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        guard let from = authorized?.url, let to = request.url,
              AccessMediaPolicy.origin(from) == AccessMediaPolicy.origin(to) else { completionHandler(nil); return }
        var next = request
        next.setValue(authorized?.value(forHTTPHeaderField: "Cookie"), forHTTPHeaderField: "Cookie")
        completionHandler(next)
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didReceive challenge: URLAuthenticationChallenge,
                    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        completionHandler(challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust
            ? .performDefaultHandling : .cancelAuthenticationChallenge, nil)
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard !closed, let http = response as? HTTPURLResponse else { completionHandler(.cancel); return }
        if [301, 302, 303, 307, 308, 401, 403].contains(http.statusCode) {
            if !retry, let original, let config {
                retry = true; retrying = true
                completionHandler(.cancel)
                session.invalidateAndCancel()
                begin(original, config: config, renew: true)
            } else { completionHandler(.cancel); fail(401) }
            return
        }
        guard (200..<300).contains(http.statusCode) else { completionHandler(.cancel); fail(http.statusCode); return }
        self.response = http
        let mime = (http.mimeType ?? "").lowercased()
        isManifest = mime.contains("mpegurl") || http.url?.pathExtension.lowercased() == "m3u8"
        classified = isManifest || original?.httpMethod == "HEAD"
        if original?.httpMethod == "HEAD" { sendHeaders(manifest: false) }
        completionHandler(.allow)
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard !closed, self.session === session else { return }
        armDeadline()
        if !classified {
            body.append(data)
            guard body.count >= 8 else { return }
            isManifest = String(data: body.prefix(64), encoding: .utf8)?.hasPrefix("#EXTM3U") == true
            classified = true
            if !isManifest { let initial = body; body = Data(); sendHeaders(manifest: false); sendChunk(initial) }
        } else if isManifest { body.append(data) }
        else { sendHeaders(manifest: false); sendChunk(data) }
        if body.count > 2 * 1024 * 1024 { fail(502) }
    }
    private func sendHeaders(manifest: Bool) {
        guard !sentHeaders, !closed, let response else { return }
        sentHeaders = true
        var fields = ["Connection": "close", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "capacitor://localhost"]
        fields["Content-Type"] = manifest ? "application/vnd.apple.mpegurl" : response.value(forHTTPHeaderField: "Content-Type") ?? "application/octet-stream"
        if original?.httpMethod == "HEAD" {
            fields["Content-Length"] = response.value(forHTTPHeaderField: "Content-Length")
        } else { fields["Transfer-Encoding"] = "chunked" }
        for key in ["Content-Range", "Accept-Ranges"] {
            if let value = response.value(forHTTPHeaderField: key), !manifest { fields[key] = value }
        }
        let header = "HTTP/1.1 \(response.statusCode) OK\r\n" + fields.map { "\($0): \($1)\r\n" }.joined() + "\r\n"
        connection.send(content: Data(header.utf8), completion: .contentProcessed { [weak self] error in
            if error != nil { self?.close() }
        })
    }
    private func sendChunk(_ data: Data) {
        guard !data.isEmpty, !closed, original?.httpMethod != "HEAD" else { return }
        var framed = Data("\(String(data.count, radix: 16))\r\n".utf8)
        framed.append(data); framed.append(Data("\r\n".utf8))
        pendingBytes += data.count
        if pendingBytes > 512 * 1024 && !suspended { task?.suspend(); suspended = true }
        connection.send(content: framed, completion: .contentProcessed { [weak self] error in
            guard let self else { return }
            if error != nil { self.close(); return }
            self.pendingBytes -= data.count
            if self.pendingBytes < 256 * 1024 && self.suspended { self.task?.resume(); self.suspended = false }
        })
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard !closed, self.session === session, !retrying else { return }
        if error != nil { fail(502); return }
        if isManifest, original?.httpMethod != "HEAD" {
            guard let text = String(data: body, encoding: .utf8), text.hasPrefix("#EXTM3U"), let base = response?.url else { fail(502); return }
            let manifest = AccessMediaPolicy.rewriteManifest(text, base: base) { self.proxy.localURL($0) }
            sendHeaders(manifest: true); sendChunk(Data(manifest.utf8))
        } else {
            sendHeaders(manifest: false)
            if !classified { sendChunk(body) }
        }
        let end = original?.httpMethod == "HEAD" ? Data() : Data("0\r\n\r\n".utf8)
        connection.send(content: end, isComplete: true, completion: .contentProcessed { [weak self] _ in self?.close() })
        session.finishTasksAndInvalidate()
    }
    private func fail(_ status: Int) {
        guard !closed else { return }
        if sentHeaders { close(); return }
        sentHeaders = true
        let response = "HTTP/1.1 \(status) Error\r\nContent-Length: 0\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n"
        connection.send(content: Data(response.utf8), isComplete: true, completion: .contentProcessed { [weak self] _ in self?.close() })
    }
    fileprivate func close() {
        guard !closed else { return }
        closed = true; deadline?.cancel(); deadline = nil
        task?.cancel(); session?.invalidateAndCancel(); session = nil; task = nil
        connection.cancel(); proxy.finished(self)
    }
}
