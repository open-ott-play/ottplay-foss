#!/usr/bin/env python3
"""Run actual Swift policy and loopback HLS transport against Foundation fixtures."""
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SWIFT = r'''
import Foundation
import CryptoKit
import Darwin

@MainActor final class AccessMedia {
    static let shared = AccessMedia()
    var authorizationStarted = Set<String>()
    var authorizationCancelled = Set<String>()
    func authorized(_ request: URLRequest, config: AccessMediaConfig, replacing rejectedCookie: String? = nil) async throws -> URLRequest {
        if request.url!.path.hasPrefix("/authorize-pending") {
            let path = request.url!.path
            authorizationStarted.insert(path)
            do { try await Task.sleep(nanoseconds: 120_000_000_000) }
            catch { authorizationCancelled.insert(path); throw error }
        }
        var result = request
        result.url = config.map(request.url!)
        result.setValue("CF_Authorization=TEST_ONLY_" + URL(string: config.media_origin)!.host!, forHTTPHeaderField: "Cookie")
        return result
    }
}

final class Fixture: URLProtocol {
    static let lock = NSLock()
    static var seen: [URLRequest] = []
    static var stopped: [String] = []
    static var pending: [String: Fixture] = [:]
    static var sessionCount = 0
    static func snapshot() -> [URLRequest] { lock.lock(); defer { lock.unlock() }; return seen }
    static func wasStopped(_ path: String) -> Bool { lock.lock(); defer { lock.unlock() }; return stopped.contains(path) }
    static func configurationsCreated() -> Int { lock.lock(); defer { lock.unlock() }; return sessionCount }
    static func configuration() -> URLSessionConfiguration {
        lock.lock(); sessionCount += 1; lock.unlock()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [Fixture.self]
        return configuration
    }
    override class func canInit(with request: URLRequest) -> Bool { request.url?.host?.hasSuffix(".fixture.invalid") == true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.lock.lock(); Self.seen.append(request); Self.lock.unlock()
        assert(request.value(forHTTPHeaderField: "Cookie") == "CF_Authorization=TEST_ONLY_" + request.url!.host!)
        let path = request.url!.path
        var status = 200
        var headers = ["Content-Type": "application/octet-stream", "Set-Cookie": "CF_Authorization=DO_NOT_EXPOSE"]
        var data = Data([1, 2, 3, 4])
        if path == "/master.m3u8" {
            headers["Content-Type"] = "application/vnd.apple.mpegurl"
            data = Data("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nlevel/list.m3u8\n".utf8)
        } else if path == "/level/list.m3u8" {
            data = Data("#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"../key\"\n#EXT-X-MAP:URI=\"init.mp4\"\n#EXTINF:2,\nsegment.ts?secret=fixture\n#EXT-X-ENDLIST\n".utf8)
        } else if path == "/external-refs.m3u8" {
            data = Data("#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"//cdn.fixture.invalid/key?signature=a%2Fb%2B%3D&&=preserved\"\n#EXTINF:2,\n//cdn.fixture.invalid/segment.ts?signature=a%2Fb%2B%3D&&=preserved\n#EXT-X-ENDLIST\n".utf8)
        } else if path == "/level/segment.ts" {
            headers["Content-Type"] = "video/mp2t"
            if request.value(forHTTPHeaderField: "Range") == "bytes=1-2" {
                status = 206; data = Data([2, 3]); headers["Content-Range"] = "bytes 1-2/4"
            } else if request.value(forHTTPHeaderField: "Range") == "bytes=10-" {
                status = 416; data = Data(); headers["Content-Range"] = "bytes */4"
            }
        } else if path == "/sniffed" {
            // The first 64 bytes end in half a UTF-8 code point. Detection must
            // inspect the ASCII magic, not decode an arbitrary UTF-8 prefix.
            data = Data(("#EXTM3U\n#" + String(repeating: "a", count: 54) + "я\nsegment.ts\n").utf8)
        } else if path == "/large.ts" {
            headers["Content-Type"] = "video/mp2t"
            data = Data(repeating: 37, count: 2 * 1024 * 1024 + 17)
        } else if path == "/oversized.m3u8" {
            data = Data("#EXTM3U\n".utf8) + Data(repeating: 35, count: 2 * 1024 * 1024)
        } else if path == "/missing" {
            status = 404
        } else if path == "/chunked-large" {
            data = Data(repeating: 37, count: 4096)
        } else if ["/pending", "/cancel-upstream", "/half-close"].contains(path) {
            Self.lock.lock(); Self.pending[path] = self; Self.lock.unlock()
            return
        } else if path.hasPrefix("/redirect-") {
            let next = path == "/redirect-same" ? "https://media.fixture.invalid/level/segment.ts" : "https://other.fixture.invalid/stolen"
            let response = HTTPURLResponse(url: request.url!, statusCode: 302, httpVersion: "HTTP/1.1",
                headerFields: ["Location": next] )!
            client?.urlProtocol(self, wasRedirectedTo: URLRequest(url: URL(string: next)!), redirectResponse: response)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocolDidFinishLoading(self)
            return
        }
        if path != "/chunked-large" { headers["Content-Length"] = String(data.count) }
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        if request.httpMethod != "HEAD" {
            // Deliberately split the HLS marker to exercise TCP/URLSession chunk boundaries.
            client?.urlProtocol(self, didLoad: data.prefix(3))
            client?.urlProtocol(self, didLoad: data.dropFirst(3))
        }
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {
        Self.lock.lock(); Self.stopped.append(request.url!.path); Self.pending[request.url!.path] = nil; Self.lock.unlock()
    }
    static func finishPending(_ path: String) {
        lock.lock(); let fixture = pending.removeValue(forKey: path); lock.unlock()
        guard let fixture else { fatalError("Missing pending response fixture") }
        let response = HTTPURLResponse(url: fixture.request.url!, statusCode: 200, httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "video/mp2t", "Content-Length": "4"])!
        fixture.client?.urlProtocol(fixture, didReceive: response, cacheStoragePolicy: .notAllowed)
        fixture.client?.urlProtocol(fixture, didLoad: Data([1, 2, 3, 4]))
        fixture.client?.urlProtocolDidFinishLoading(fixture)
    }
}

func waitFor(_ predicate: () -> Bool) async throws {
    let deadline = Date().addingTimeInterval(3)
    while !predicate() && Date() < deadline { try await Task.sleep(nanoseconds: 10_000_000) }
    assert(predicate(), "Expected asynchronous fixture event")
}

// Raw localhost clients distinguish an actual TCP reset from a write-half-close,
// which must remain open long enough to read the complete HTTP response.
func openSocket(_ url: URL) -> Int32 {
    let fd = Darwin.socket(AF_INET, SOCK_STREAM, 0)
    assert(fd >= 0)
    var address = sockaddr_in()
    address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    address.sin_family = sa_family_t(AF_INET)
    address.sin_port = UInt16(url.port!).bigEndian
    address.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))
    let connected = withUnsafePointer(to: &address) {
        $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.connect(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) }
    }
    assert(connected == 0)
    var timeout = timeval(tv_sec: 3, tv_usec: 0)
    assert(setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size)) == 0)
    let request = Data("GET \(url.path) HTTP/1.1\r\nHost: 127.0.0.1:\(url.port!)\r\nConnection: close\r\n\r\n".utf8)
    let sent = request.withUnsafeBytes { Darwin.write(fd, $0.baseAddress!, $0.count) }
    assert(sent == request.count)
    return fd
}
func resetSocket(_ fd: Int32) {
    var reset = linger(l_onoff: 1, l_linger: 0)
    assert(setsockopt(fd, SOL_SOCKET, SO_LINGER, &reset, socklen_t(MemoryLayout<linger>.size)) == 0)
    assert(Darwin.close(fd) == 0)
}
func readSocket(_ fd: Int32) async -> Data {
    await withCheckedContinuation { continuation in
        DispatchQueue.global().async {
            defer { Darwin.close(fd) }
            var output = Data(), buffer = [UInt8](repeating: 0, count: 4096)
            while true {
                let count = Darwin.read(fd, &buffer, buffer.count)
                assert(count >= 0, "Timed out reading the half-closed client response")
                if count == 0 { break }
                output.append(contentsOf: buffer.prefix(count))
                assert(output.count < 32768)
            }
            continuation.resume(returning: output)
        }
    }
}

func fixtureRequest(_ path: String) -> URLRequest {
    var request = URLRequest(url: URL(string: "https://media.fixture.invalid" + path)!)
    request.setValue("CF_Authorization=TEST_ONLY_media.fixture.invalid", forHTTPHeaderField: "Cookie")
    return request
}

func requireThrows(_ operation: () throws -> Void) {
    do { try operation(); fatalError("Expected rejection") } catch {}
}
var finished = false
URLProtocol.registerClass(Fixture.self)
Task { @MainActor in
    do {
        let source = URL(string: "https://source.fixture.invalid/master.m3u8")!
        let config = AccessMediaConfig(version: 1, source_origin: "https://source.fixture.invalid",
            media_origin: "https://media.fixture.invalid", authorize_path: "/_ottplay/authorize",
            exchange_path: "/_ottplay/public/exchange", callback: "ottplay-access://callback")
        _ = try config.validated(for: source)
        assert(config.map(URL(string: "https://other.fixture.invalid/a")!) == nil)
        assert(config.map(URL(string: "https://evil@source.fixture.invalid/a")!) == nil)
        assert(AccessMediaPolicy.origin(URL(string: "http://source.fixture.invalid")!) == nil)
        assert(AccessMediaPolicy.origin(URL(string: "https://[2001:db8::1]/live")!) == "https://[2001:db8::1]")
        assert(AccessMediaPolicy.origin(URL(string: "https://[2001:db8::1]:8443/live")!) == "https://[2001:db8::1]:8443")
        assert(AccessMediaPolicy.challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk") == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
        let state = try AccessMediaPolicy.random(), code = try AccessMediaPolicy.random()
        let returnedCode = try AccessMediaPolicy.callbackCode(URL(string: "ottplay-access://callback?state=\(state)&code=\(code)")!, state: state)
        assert(returnedCode == code)
        for value in ["ottplay-access://callback?state=wrong&code=\(code)",
                      "ottplay-access://callback?state=\(state)&state=\(state)&code=\(code)",
                      "ottplay-access://evil?state=\(state)&code=\(code)",
                      "ottplay-access://callback?state=\(state)&code=x"] {
            requireThrows { _ = try AccessMediaPolicy.callbackCode(URL(string: value)!, state: state) }
        }
        let manifest = "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"key?a=1&b=%2F\"\n#EXT-X-MEDIA:TYPE=AUDIO,URI=\"audio.m3u8\"\n#EXT-X-PART:DURATION=1,URI=\"part.m4s\"\n#EXT-X-CONTENT-STEERING:SERVER-URI=\"steer.json\"\nhttps://external.invalid/no-cookie.ts\nsegment.ts\n"
        let rewritten = AccessMediaPolicy.rewriteManifest(manifest, base: source) { config.map($0) }
        assert(rewritten.contains("https://media.fixture.invalid/key?a=1&b=%2F"))
        assert(rewritten.contains("https://media.fixture.invalid/audio.m3u8"))
        assert(rewritten.contains("https://media.fixture.invalid/part.m4s"))
        assert(rewritten.contains("https://media.fixture.invalid/steer.json"))
        assert(rewritten.contains("https://external.invalid/no-cookie.ts"))

        let networkPath = "//cdn.fixture.invalid/segment.ts?signature=a%2Fb%2B%3D&&=preserved"
        let external = AccessMediaPolicy.rewriteManifest(networkPath, base: source) { config.map($0) }
        let resolvedExternal = URL(string: external, relativeTo: URL(string: "http://127.0.0.1:1234/media.m3u8")!)!.absoluteURL
        assert(resolvedExternal.absoluteString == "https:" + networkPath,
            "An unproxied network-path URI must not inherit HTTP from loopback")

        let proxy = try AccessMediaProxy(sessionConfiguration: Fixture.configuration)
        let local = try await proxy.url(for: source, config: config)
        let (masterData, masterResponse) = try await URLSession.shared.data(from: local)
        assert((masterResponse as! HTTPURLResponse).statusCode == 200, "Expected 200, got \((masterResponse as! HTTPURLResponse).statusCode), requests \(Fixture.seen.count)")
        assert((masterResponse as! HTTPURLResponse).value(forHTTPHeaderField: "Set-Cookie") == nil)
        let master = String(data: masterData, encoding: .utf8)!
        let level = URL(string: master.split(separator: "\n").last!.description)!
        assert(level.host == "127.0.0.1")
        let (levelData, _) = try await URLSession.shared.data(from: level)
        let playlist = String(data: levelData, encoding: .utf8)!
        assert(playlist.contains("#EXT-X-KEY:METHOD=AES-128,URI=\"http://127.0.0.1:"))
        assert(playlist.contains("#EXT-X-MAP:URI=\"http://127.0.0.1:"))
        let segment = URL(string: playlist.split(separator: "\n").first(where: { !$0.hasPrefix("#") })!.description)!
        var range = URLRequest(url: segment)
        range.setValue("bytes=1-2", forHTTPHeaderField: "Range")
        let (bytes, rangeResponse) = try await URLSession.shared.data(for: range)
        assert(bytes == Data([2, 3]))
        assert((rangeResponse as! HTTPURLResponse).statusCode == 206)
        assert((rangeResponse as! HTTPURLResponse).value(forHTTPHeaderField: "Content-Range") == "bytes 1-2/4")
        assert((rangeResponse as! HTTPURLResponse).value(forHTTPHeaderField: "Access-Control-Expose-Headers")!.contains("Content-Range"))
        range.setValue("bytes=10-", forHTTPHeaderField: "Range")
        let (outOfRangeBytes, outOfRangeResponse) = try await URLSession.shared.data(for: range)
        assert(outOfRangeBytes.isEmpty && (outOfRangeResponse as! HTTPURLResponse).statusCode == 416)
        assert((outOfRangeResponse as! HTTPURLResponse).value(forHTTPHeaderField: "Content-Range") == "bytes */4")
        var head = URLRequest(url: segment); head.httpMethod = "HEAD"
        let (headBytes, headResponse) = try await URLSession.shared.data(for: head)
        assert(headBytes.isEmpty && (headResponse as! HTTPURLResponse).statusCode == 200)
        let keyMatch = try NSRegularExpression(pattern: "URI=\"([^\"]+)\"").firstMatch(in: playlist, range: NSRange(playlist.startIndex..., in: playlist))!
        let keyURL = URL(string: String(playlist[Range(keyMatch.range(at: 1), in: playlist)!]))!
        let (keyBytes, _) = try await URLSession.shared.data(from: keyURL)
        assert(keyBytes == Data([1, 2, 3, 4]))
        let externalLocal = try await proxy.url(for: URL(string: config.source_origin + "/external-refs.m3u8")!, config: config)
        let (externalData, _) = try await URLSession.shared.data(from: externalLocal)
        let externalManifest = String(data: externalData, encoding: .utf8)!
        assert(externalManifest.contains("URI=\"https://cdn.fixture.invalid/key?signature=a%2Fb%2B%3D&&=preserved\""))
        let externalSegment = externalManifest.components(separatedBy: "\n").first { !$0.isEmpty && !$0.hasPrefix("#") }!
        assert(URL(string: externalSegment, relativeTo: externalLocal)!.absoluteURL.absoluteString == "https:" + networkPath)
        assert(!externalManifest.contains("127.0.0.1"), "External resources must stay outside the credentialed proxy")
        let signed = URL(string: source.absoluteString + "?signature=a%2Fb%2B%3D&&=preserved&_HLS_msn=1")!
        var reload = URLComponents(url: try await proxy.url(for: signed, config: config), resolvingAgainstBaseURL: false)!
        reload.percentEncodedQuery = "_HLS_msn=12&_HLS_part=3&_HLS_skip=v2"
        _ = try await URLSession.shared.data(from: reload.url!)
        assert(Fixture.snapshot().last!.url!.query! == "signature=a%2Fb%2B%3D&&=preserved&_HLS_msn=12&_HLS_part=3&_HLS_skip=v2")
        reload.percentEncodedQuery = "_HLS_msn=12&_HLS_msn=13"
        let (_, duplicate) = try await URLSession.shared.data(from: reload.url!)
        assert((duplicate as! HTTPURLResponse).statusCode == 403)
        let sniffed = try await proxy.url(for: URL(string: config.source_origin + "/sniffed")!, config: config)
        let (sniffedData, _) = try await URLSession.shared.data(from: sniffed)
        assert(String(data: sniffedData, encoding: .utf8)!.contains("http://127.0.0.1:"))
        let large = try await proxy.url(for: URL(string: config.source_origin + "/large.ts")!, config: config)
        let (largeData, _) = try await URLSession.shared.data(from: large)
        assert(largeData == Data(repeating: 37, count: 2 * 1024 * 1024 + 17))
        let oversized = try await proxy.url(for: URL(string: config.source_origin + "/oversized.m3u8")!, config: config)
        let (_, oversizedResponse) = try await URLSession.shared.data(from: oversized)
        assert((oversizedResponse as! HTTPURLResponse).statusCode == 502)
        let missing = try await proxy.url(for: URL(string: config.source_origin + "/missing")!, config: config)
        for _ in 0..<8 {
            let (missingData, missingResponse) = try await URLSession.shared.data(from: missing)
            assert(missingData.isEmpty && (missingResponse as! HTTPURLResponse).statusCode == 404)
        }
        let sameRedirect = try await proxy.url(for: URL(string: config.source_origin + "/redirect-same")!, config: config)
        let (redirectedData, _) = try await URLSession.shared.data(from: sameRedirect)
        assert(redirectedData == Data([1, 2, 3, 4]))
        let otherRedirect = try await proxy.url(for: URL(string: config.source_origin + "/redirect-other")!, config: config)
        let (_, refusedRedirect) = try await URLSession.shared.data(from: otherRedirect)
        assert((refusedRedirect as! HTTPURLResponse).statusCode == 401)
        let otherConfig = AccessMediaConfig(version: 1, source_origin: "https://source2.fixture.invalid",
            media_origin: "https://media2.fixture.invalid", authorize_path: "/_ottplay/authorize",
            exchange_path: "/_ottplay/public/exchange", callback: "ottplay-access://callback")
        let otherLocal = try await proxy.url(for: URL(string: otherConfig.source_origin + "/key")!, config: otherConfig)
        let (otherBytes, _) = try await URLSession.shared.data(from: otherLocal)
        assert(otherBytes == Data([1, 2, 3, 4]))
        assert(Fixture.configurationsCreated() == 1, "Every segment must reuse the isolated upstream session")
        var malicious = URLRequest(url: local); malicious.setValue("https://evil.invalid", forHTTPHeaderField: "Origin")
        let (_, denied) = try await URLSession.shared.data(for: malicious)
        assert((denied as! HTTPURLResponse).statusCode == 403)
        let wrong = URL(string: local.absoluteString.replacingOccurrences(of: "/access/", with: "/wrong/"))!
        let (_, wrongResponse) = try await URLSession.shared.data(from: wrong)
        assert((wrongResponse as! HTTPURLResponse).statusCode == 403)
        let seen = Fixture.snapshot()
        assert(seen.count >= 13 && seen.allSatisfy { ["media.fixture.invalid", "media2.fixture.invalid"].contains($0.url!.host!) })

        let pendingURL = try await proxy.url(for: URL(string: config.source_origin + "/cancel-upstream")!, config: config)
        let disconnected = openSocket(pendingURL)
        try await waitFor { Fixture.snapshot().contains { $0.url?.path == "/cancel-upstream" } }
        resetSocket(disconnected)
        try await waitFor { Fixture.wasStopped("/cancel-upstream") }

        let halfClosedURL = try await proxy.url(for: URL(string: config.source_origin + "/half-close")!, config: config)
        let halfClosed = openSocket(halfClosedURL)
        try await waitFor { Fixture.snapshot().contains { $0.url?.path == "/half-close" } }
        assert(Darwin.shutdown(halfClosed, SHUT_WR) == 0)
        try await Task.sleep(nanoseconds: 50_000_000)
        assert(!Fixture.wasStopped("/half-close"), "HTTP write-half-close must preserve the response")
        Fixture.finishPending("/half-close")
        let halfClosedResponse = await readSocket(halfClosed)
        assert(halfClosedResponse.starts(with: Data("HTTP/1.1 200".utf8)))
        assert(halfClosedResponse.range(of: Data([1, 2, 3, 4])) != nil)
        assert(halfClosedResponse.suffix(5) == Data("0\r\n\r\n".utf8))

        let authURL = try await proxy.url(for: URL(string: config.source_origin + "/authorize-pending-reset")!, config: config)
        let authClient = openSocket(authURL)
        try await waitFor { AccessMedia.shared.authorizationStarted.contains("/authorize-pending-reset") }
        resetSocket(authClient)
        try await waitFor { AccessMedia.shared.authorizationCancelled.contains("/authorize-pending-reset") }
        let stoppedAuthURL = try await proxy.url(for: URL(string: config.source_origin + "/authorize-pending-stop")!, config: config)
        let stoppedAuthClient = openSocket(stoppedAuthURL)
        try await waitFor { AccessMedia.shared.authorizationStarted.contains("/authorize-pending-stop") }
        proxy.stop()
        try await waitFor { AccessMedia.shared.authorizationCancelled.contains("/authorize-pending-stop") }
        Darwin.close(stoppedAuthClient)
        assert(!Fixture.snapshot().contains { $0.url!.path.hasPrefix("/authorize-pending") })
        do { _ = try await proxy.url(for: source, config: config); fatalError("Stopped listener accepted new playback") } catch {}

        // The non-streaming helper must enforce the same redirect and memory
        // boundaries, and cancellation must release a pending network request.
        let (httpData, httpResponse) = try await AccessMediaHTTP.fetch(fixtureRequest("/redirect-same"), sessionConfiguration: Fixture.configuration)
        assert(httpResponse.statusCode == 200 && httpData == Data([1, 2, 3, 4]))
        let (_, httpRefused) = try await AccessMediaHTTP.fetch(fixtureRequest("/redirect-other"), sessionConfiguration: Fixture.configuration)
        assert(httpRefused.statusCode == 302)
        assert(!Fixture.snapshot().contains { $0.url?.host == "other.fixture.invalid" })
        do {
            _ = try await AccessMediaHTTP.fetch(fixtureRequest("/large.ts"), limit: 1024, sessionConfiguration: Fixture.configuration)
            fatalError("Oversized native fetch was accepted")
        } catch {}
        do {
            _ = try await AccessMediaHTTP.fetch(fixtureRequest("/chunked-large"), limit: 1024, sessionConfiguration: Fixture.configuration)
            fatalError("Oversized chunked native fetch was accepted")
        } catch {}
        let pending = Task { try await AccessMediaHTTP.fetch(fixtureRequest("/pending"), sessionConfiguration: Fixture.configuration) }
        try await waitFor { Fixture.snapshot().contains { $0.url?.path == "/pending" } }
        pending.cancel()
        do { _ = try await pending.value; fatalError("Cancelled fetch completed") } catch is CancellationError {} catch { fatalError("Wrong cancellation error") }
        try await waitFor { Fixture.wasStopped("/pending") }
        let seenCount = Fixture.snapshot().count
        do {
            _ = try await AccessMediaHTTP.fetch(URLRequest(url: URL(string: "http://media.fixture.invalid/insecure")!), sessionConfiguration: Fixture.configuration)
            fatalError("Non-HTTPS native fetch was accepted")
        } catch {}
        let cancelled = Task { try await AccessMediaHTTP.fetch(fixtureRequest("/never-started"), sessionConfiguration: Fixture.configuration) }
        cancelled.cancel()
        do { _ = try await cancelled.value; fatalError("Cancelled-before-start fetch completed") } catch is CancellationError {} catch { fatalError("Wrong early cancellation error") }
        assert(Fixture.snapshot().count == seenCount)
        print("PASS: PKCE, origin isolation, HLS/LL-HLS rewriting, \(seen.count) media requests through one session, redirects, streaming, Range, HEAD, reset/half-close, authorization cancellation and bounds")
        finished = true
    } catch { fatalError("Access media fixture failed: \(error)") }
}
let deadline = Date().addingTimeInterval(25)
while !finished && Date() < deadline { RunLoop.main.run(until: Date().addingTimeInterval(0.02)) }
assert(finished, "Timed out after requests: \(Fixture.snapshot().map { $0.url!.path })")
'''

with tempfile.TemporaryDirectory(prefix="ottplay-access-test-") as directory:
    path = Path(directory)
    (path / "main.swift").write_text(SWIFT)
    sources = ROOT / "ios/App/App/Plugins"
    subprocess.run(["swiftc", str(sources / "AccessMediaPolicy.swift"),
                    str(sources / "AccessMediaProxy.swift"), str(path / "main.swift"),
                    "-o", str(path / "test")], check=True)
    subprocess.run([str(path / "test")], check=True, timeout=35)
