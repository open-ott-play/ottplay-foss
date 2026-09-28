#!/usr/bin/env python3
"""Run actual Swift policy and loopback HLS transport against Foundation fixtures."""
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SWIFT = r'''
import Foundation
import CryptoKit

@MainActor final class AccessMedia {
    static let shared = AccessMedia()
    func authorized(_ request: URLRequest, config: AccessMediaConfig, replacing rejectedCookie: String? = nil) async throws -> URLRequest {
        var result = request
        result.url = config.map(request.url!)
        result.setValue("CF_Authorization=TEST_ONLY", forHTTPHeaderField: "Cookie")
        return result
    }
}

final class Fixture: URLProtocol {
    static let lock = NSLock()
    static var seen: [URLRequest] = []
    static func snapshot() -> [URLRequest] { lock.lock(); defer { lock.unlock() }; return seen }
    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "media.fixture.invalid" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.lock.lock(); Self.seen.append(request); Self.lock.unlock()
        assert(request.value(forHTTPHeaderField: "Cookie") == "CF_Authorization=TEST_ONLY")
        let path = request.url!.path
        var status = 200
        var headers = ["Content-Type": "application/octet-stream", "Set-Cookie": "CF_Authorization=DO_NOT_EXPOSE"]
        var data = Data([1, 2, 3, 4])
        if path == "/master.m3u8" {
            headers["Content-Type"] = "application/vnd.apple.mpegurl"
            data = Data("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nlevel/list.m3u8\n".utf8)
        } else if path == "/level/list.m3u8" {
            data = Data("#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"../key\"\n#EXT-X-MAP:URI=\"init.mp4\"\n#EXTINF:2,\nsegment.ts?secret=fixture\n#EXT-X-ENDLIST\n".utf8)
        } else if path == "/level/segment.ts" {
            headers["Content-Type"] = "video/mp2t"
            if request.value(forHTTPHeaderField: "Range") == "bytes=1-2" {
                status = 206; data = Data([2, 3]); headers["Content-Range"] = "bytes 1-2/4"
            }
        } else if path == "/redirect" {
            let response = HTTPURLResponse(url: request.url!, statusCode: 302, httpVersion: "HTTP/1.1",
                headerFields: ["Location": "https://other.fixture.invalid/stolen"] )!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocolDidFinishLoading(self)
            return
        }
        headers["Content-Length"] = String(data.count)
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        if request.httpMethod != "HEAD" {
            // Deliberately split the HLS marker to exercise TCP/URLSession chunk boundaries.
            client?.urlProtocol(self, didLoad: data.prefix(3))
            client?.urlProtocol(self, didLoad: data.dropFirst(3))
        }
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
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

        let proxy = try AccessMediaProxy(sessionConfiguration: {
            let configuration = URLSessionConfiguration.ephemeral
            configuration.protocolClasses = [Fixture.self]
            return configuration
        })
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
        var head = URLRequest(url: segment); head.httpMethod = "HEAD"
        let (headBytes, headResponse) = try await URLSession.shared.data(for: head)
        assert(headBytes.isEmpty && (headResponse as! HTTPURLResponse).statusCode == 200)
        let keyMatch = try NSRegularExpression(pattern: "URI=\"([^\"]+)\"").firstMatch(in: playlist, range: NSRange(playlist.startIndex..., in: playlist))!
        let keyURL = URL(string: String(playlist[Range(keyMatch.range(at: 1), in: playlist)!]))!
        let (keyBytes, _) = try await URLSession.shared.data(from: keyURL)
        assert(keyBytes == Data([1, 2, 3, 4]))
        var malicious = URLRequest(url: local); malicious.setValue("https://evil.invalid", forHTTPHeaderField: "Origin")
        let (_, denied) = try await URLSession.shared.data(for: malicious)
        assert((denied as! HTTPURLResponse).statusCode == 403)
        let wrong = URL(string: local.absoluteString.replacingOccurrences(of: "/access/", with: "/wrong/"))!
        let (_, wrongResponse) = try await URLSession.shared.data(from: wrong)
        assert((wrongResponse as! HTTPURLResponse).statusCode == 403)
        let seen = Fixture.snapshot()
        assert(seen.count >= 5 && seen.allSatisfy { $0.url?.host == "media.fixture.invalid" })
        proxy.stop()
        print("PASS: PKCE, origin isolation, manifest/key/map rewrites, streaming, Range, HEAD and loopback authentication")
        finished = true
    } catch { fatalError("Access media fixture failed: \(error)") }
}
let deadline = Date().addingTimeInterval(25)
while !finished && Date() < deadline { RunLoop.main.run(until: Date().addingTimeInterval(0.02)) }
assert(finished, "Timed out")
'''

with tempfile.TemporaryDirectory(prefix="ottplay-access-test-") as directory:
    path = Path(directory)
    (path / "main.swift").write_text(SWIFT)
    sources = ROOT / "ios/App/App/Plugins"
    subprocess.run(["swiftc", str(sources / "AccessMediaPolicy.swift"),
                    str(sources / "AccessMediaProxy.swift"), str(path / "main.swift"),
                    "-o", str(path / "test")], check=True)
    subprocess.run([str(path / "test")], check=True, timeout=35)
