#!/usr/bin/env python3
"""Exercise the production iOS auth state machine with deterministic OS fixtures.

Only platform imports and the Capacitor bridge are replaced; the session,
discovery, Keychain and ASWebAuthenticationSession orchestration runs unchanged.
No real browser, Keychain or network is used.
"""
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SWIFT = r'''
import Foundation
import CoreFoundation

let kSecClass = "class", kSecClassGenericPassword = "generic"
let kSecAttrService = "service", kSecAttrAccount = "account"
let kSecReturnData = "return", kSecMatchLimit = "limit", kSecMatchLimitOne = "one"
let kSecValueData = "data", kSecAttrAccessible = "accessible"
let kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly = "deviceOnlyAfterFirstUnlock"
let errSecSuccess: Int32 = 0, errSecItemNotFound: Int32 = -25300
enum Keychain {
    static var data: Data?
    static var writes = 0
}
func SecItemCopyMatching(_ query: CFDictionary, _ result: UnsafeMutablePointer<CFTypeRef?>) -> Int32 {
    guard let data = Keychain.data else { return errSecItemNotFound }
    result.pointee = data as CFTypeRef
    return errSecSuccess
}
func SecItemUpdate(_ query: CFDictionary, _ attributes: CFDictionary) -> Int32 {
    guard Keychain.data != nil else { return errSecItemNotFound }
    return store(attributes)
}
func SecItemAdd(_ query: CFDictionary, _ result: UnsafeMutablePointer<CFTypeRef?>?) -> Int32 { store(query) }
func store(_ attributes: CFDictionary) -> Int32 {
    let values = attributes as! [String: Any]
    assert(values[kSecAttrAccessible] as? String == kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly)
    Keychain.data = values[kSecValueData] as? Data
    Keychain.writes += 1
    return errSecSuccess
}

class UIWindow {}
class UIView { var window: UIWindow? = UIWindow() }
class UIViewController: NSObject {
    let view = UIView()
    func present(_ controller: UIViewController, animated: Bool) {}
}
class UIAlertController: UIViewController {
    enum Style { case alert }
    init(title: String?, message: String?, preferredStyle: Style) {}
    func addAction(_ action: UIAlertAction) {}
}
class UIAlertAction {
    enum Style { case `default`, destructive, cancel }
    init(title: String, style: Style, handler: ((UIAlertAction) -> Void)? = nil) {}
}
class UIApplication {
    static let shared = UIApplication()
    enum State { case active, background }
    var applicationState = State.active
}
typealias ASPresentationAnchor = UIWindow
protocol ASWebAuthenticationPresentationContextProviding: AnyObject {
    @MainActor func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor
}
struct ASWebAuthenticationSessionError: Error {
    enum Code { case canceledLogin }
    let code: Code
}
class ASWebAuthenticationSession {
    static var opened: [ASWebAuthenticationSession] = []
    static var startSucceeds = true
    let url: URL
    let callback: (URL?, Error?) -> Void
    weak var presentationContextProvider: ASWebAuthenticationPresentationContextProviding?
    var prefersEphemeralWebBrowserSession = true
    var cancelled = false
    init(url: URL, callbackURLScheme: String?, completionHandler: @escaping (URL?, Error?) -> Void) {
        assert(callbackURLScheme == "ottplay-access")
        self.url = url; callback = completionHandler
    }
    func start() -> Bool {
        assert(!prefersEphemeralWebBrowserSession)
        Self.opened.append(self)
        return Self.startSucceeds
    }
    // Deliberately never invokes completion: the app must settle its own waiters.
    func cancel() { cancelled = true }
    func succeed() {
        let state = URLComponents(url: url, resolvingAgainstBaseURL: false)!.queryItems!
            .first(where: { $0.name == "state" })!.value!
        callback(URL(string: "ottplay-access://callback?state=\(state)&code=\(String(repeating: "a", count: 43))")!, nil)
    }
}
final class AccessMediaProxy {
    init() throws {}
    func stop() {}
    func url(for url: URL, config: AccessMediaConfig) async throws -> URL { url }
}

@MainActor final class Fixture {
    let source = URL(string: "https://source.fixture.invalid/list.m3u8")!
    let config = AccessMediaConfig(version: 1, source_origin: "https://source.fixture.invalid",
        media_origin: "https://media.fixture.invalid", authorize_path: "/_ottplay/authorize",
        exchange_path: "/_ottplay/public/exchange", callback: "ottplay-access://callback")
    var time = Date()
    var discoveries = 0, exchanges = 0
    var discoveryStatus = 200
    var holdDiscovery = false, holdExchange = false
    var discoveryGate: CheckedContinuation<Void, Never>?
    var exchangeGate: CheckedContinuation<Void, Never>?
    let presenter = UIViewController()
    func makeAccess() -> AccessMedia {
        let access = AccessMedia(now: { self.time }, fetch: { request, limit in
            try await self.fetch(request, limit: limit)
        })
        access.presenter = presenter
        return access
    }
    func fetch(_ request: URLRequest, limit: Int) async throws -> (Data, HTTPURLResponse) {
        let url = request.url!
        if url.path == "/_ottplay/public/config" {
            discoveries += 1
            assert(request.timeoutInterval == 5 && limit == 4096)
            if holdDiscovery { await withCheckedContinuation { discoveryGate = $0 } }
            return (try JSONEncoder().encode(config), HTTPURLResponse(url: url, statusCode: discoveryStatus,
                httpVersion: "HTTP/1.1", headerFields: [:])!)
        }
        assert(url.host == "media.fixture.invalid" && url.path == "/_ottplay/public/exchange")
        assert(request.httpMethod == "POST" && limit == 20000)
        let body = try JSONSerialization.jsonObject(with: request.httpBody!) as! [String: String]
        assert(body["verifier"]!.count == 43 && body["code"]!.count == 43)
        exchanges += 1
        let exchange = exchanges
        if holdExchange { await withCheckedContinuation { exchangeGate = $0 } }
        let data = try JSONEncoder().encode(AccessMediaSession(token: "fixture.session\(exchange).signature",
            expires_at: Date().timeIntervalSince1970 + 3600, media_origin: config.media_origin))
        return (data, HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: [:])!)
    }
}

@MainActor func until(_ condition: () -> Bool) async {
    let deadline = Date().addingTimeInterval(3)
    while !condition() && Date() < deadline { try! await Task.sleep(nanoseconds: 1_000_000) }
    assert(condition(), "Fixture did not reach the expected state")
}
@MainActor func reset() {
    Keychain.data = nil; Keychain.writes = 0
    ASWebAuthenticationSession.opened = []; ASWebAuthenticationSession.startSucceeds = true
}
@MainActor func failure<T>(_ task: Task<T, Error>, _ expected: AccessMediaFailure? = nil) async {
    do { _ = try await task.value; fatalError("Expected failure") }
    catch { if let expected { assert(error as? AccessMediaFailure == expected, "Unexpected failure: \(error)") } }
}
var finished = false
Task { @MainActor in
    do {
        reset()
        let fixture = Fixture(), access = fixture.makeAccess()
        let discoveryTasks = (0..<20).map { _ in Task { try await access.configuration(for: fixture.source, discover: true) } }
        for task in discoveryTasks { let result = try await task.value; assert(result == fixture.config) }
        assert(fixture.discoveries == 1, "Concurrent discovery must issue one HTTP request")
        var request = URLRequest(url: fixture.source)
        request.setValue("foreign=secret", forHTTPHeaderField: "Cookie")
        request.setValue("forged", forHTTPHeaderField: "CF-Access-Jwt-Assertion")
        request.setValue("evil.invalid", forHTTPHeaderField: "Host")
        request.setValue("bytes=1-2", forHTTPHeaderField: "Range")
        let tasks = (0..<20).map { _ in Task { try await access.authorized(request, config: fixture.config) } }
        await until { ASWebAuthenticationSession.opened.count == 1 }
        ASWebAuthenticationSession.opened[0].succeed()
        for task in tasks {
            let result = try await task.value
            assert(result.url?.host == "media.fixture.invalid")
            assert(result.value(forHTTPHeaderField: "Cookie") == "CF_Authorization=fixture.session1.signature")
            assert(result.value(forHTTPHeaderField: "CF-Access-Jwt-Assertion") == nil)
            assert(result.value(forHTTPHeaderField: "Host") == nil)
            assert(result.value(forHTTPHeaderField: "Range") == "bytes=1-2" && !result.httpShouldHandleCookies)
        }
        assert(fixture.exchanges == 1 && Keychain.writes == 1)
        let restored = fixture.makeAccess()
        let restoredConfig = try await restored.configuration(for: fixture.source, discover: true)
        assert(restoredConfig == fixture.config)
        _ = try await restored.authorized(request, config: fixture.config)
        assert(fixture.discoveries == 1 && fixture.exchanges == 1 && ASWebAuthenticationSession.opened.count == 1,
            "Cold launch with a valid saved session must avoid discovery/login/exchange")

        let renewals = (0..<20).map { _ in Task {
            try await access.authorized(request, config: fixture.config,
                replacing: "CF_Authorization=fixture.session1.signature")
        } }
        await until { ASWebAuthenticationSession.opened.count == 2 }
        ASWebAuthenticationSession.opened[1].succeed()
        for task in renewals {
            let result = try await task.value
            assert(result.value(forHTTPHeaderField: "Cookie") == "CF_Authorization=fixture.session2.signature")
        }
        assert(fixture.exchanges == 2, "Concurrent rejected requests must refresh only once")
        let invalid = Task { try await access.authorized(URLRequest(url: URL(string: "https://other.invalid/a")!), config: fixture.config) }
        await failure(invalid, .invalid)

        reset()
        let cancelFixture = Fixture(), cancelAccess = cancelFixture.makeAccess()
        let old = Task { try await cancelAccess.authorized(URLRequest(url: cancelFixture.source), config: cancelFixture.config) }
        await until { ASWebAuthenticationSession.opened.count == 1 }
        let oldBrowser = ASWebAuthenticationSession.opened[0]
        try cancelAccess.signOut()
        assert(oldBrowser.cancelled)
        let fresh = Task { try await cancelAccess.authorized(URLRequest(url: cancelFixture.source), config: cancelFixture.config) }
        await until { ASWebAuthenticationSession.opened.count == 2 }
        await failure(old, .cancelled)
        oldBrowser.succeed() // A delayed browser callback must not exchange or clear the new login.
        for _ in 0..<20 { await Task.yield() }
        assert(cancelFixture.exchanges == 0)
        let duplicate = Task { try await cancelAccess.authorized(URLRequest(url: cancelFixture.source), config: cancelFixture.config) }
        ASWebAuthenticationSession.opened[1].succeed()
        _ = try await fresh.value; _ = try await duplicate.value
        assert(cancelFixture.exchanges == 1 && ASWebAuthenticationSession.opened.count == 2)

        reset()
        let exchangeFixture = Fixture(), exchangeAccess = exchangeFixture.makeAccess()
        exchangeFixture.holdExchange = true
        let stale = Task { try await exchangeAccess.authorized(URLRequest(url: exchangeFixture.source), config: exchangeFixture.config) }
        await until { ASWebAuthenticationSession.opened.count == 1 }
        ASWebAuthenticationSession.opened[0].succeed()
        await until { exchangeFixture.exchangeGate != nil }
        try exchangeAccess.signOut()
        exchangeFixture.exchangeGate!.resume()
        await failure(stale, .cancelled)
        assert(!String(data: Keychain.data!, encoding: .utf8)!.contains("fixture.session"),
            "An exchange finishing after logout must not restore credentials")

        reset()
        let startFixture = Fixture(), startAccess = startFixture.makeAccess()
        ASWebAuthenticationSession.startSucceeds = false
        let failedStart = Task { try await startAccess.authorized(URLRequest(url: startFixture.source), config: startFixture.config) }
        await failure(failedStart, .login)
        ASWebAuthenticationSession.opened[0].succeed() // Must not resume the continuation twice.
        ASWebAuthenticationSession.startSucceeds = true
        let afterFailure = Task { try await startAccess.authorized(URLRequest(url: startFixture.source), config: startFixture.config) }
        await until { ASWebAuthenticationSession.opened.count == 2 }
        ASWebAuthenticationSession.opened[1].succeed()
        _ = try await afterFailure.value
        assert(startFixture.exchanges == 1)

        reset()
        let retryFixture = Fixture(), retryAccess = retryFixture.makeAccess()
        retryFixture.discoveryStatus = 503
        _ = try await retryAccess.configuration(for: retryFixture.source, discover: true)
        _ = try await retryAccess.configuration(for: retryFixture.source, discover: true)
        assert(retryFixture.discoveries == 1)
        retryFixture.time.addTimeInterval(11); retryFixture.discoveryStatus = 200
        let recovered = try await retryAccess.configuration(for: retryFixture.source, discover: true)
        assert(recovered == retryFixture.config)
        assert(retryFixture.discoveries == 2, "Transient outages must recover after ten seconds, not five minutes")
        reset()
        let absentFixture = Fixture(), absentAccess = absentFixture.makeAccess()
        absentFixture.discoveryStatus = 404
        _ = try await absentAccess.configuration(for: absentFixture.source, discover: true)
        absentFixture.time.addTimeInterval(11)
        _ = try await absentAccess.configuration(for: absentFixture.source, discover: true)
        assert(absentFixture.discoveries == 1, "Unsupported sources retain the five-minute negative cache")

        reset()
        let trustFixture = Fixture()
        let untrusted = AccessMediaConfig(version: 1, source_origin: trustFixture.config.source_origin,
            media_origin: "https://attacker.fixture.invalid", authorize_path: "/_ottplay/authorize",
            exchange_path: "/_ottplay/public/exchange", callback: "ottplay-access://callback")
        var discoveryHosts: [String] = []
        let trusted = AccessMedia(fetch: { request, _ in
            discoveryHosts.append(request.url!.host!)
            let config = request.url!.host == "attacker.fixture.invalid" ? untrusted : trustFixture.config
            return (try JSONEncoder().encode(config), HTTPURLResponse(url: request.url!, statusCode: 200,
                httpVersion: "HTTP/1.1", headerFields: [:])!)
        })
        let poisoned = Task { try await trusted.configuration(for: URL(string: untrusted.media_origin + "/a")!, discover: true) }
        await failure(poisoned, .invalid)
        let absentClaim = try await trusted.configuration(for: trustFixture.source, discover: false)
        assert(absentClaim == nil, "An untrusted alias must not insert its claimed source")
        let canonical = try await trusted.configuration(for: trustFixture.source, discover: true)
        assert(canonical == trustFixture.config)
        let beforeAlias = discoveryHosts.count
        let knownAlias = try await trusted.configuration(for: URL(string: trustFixture.config.media_origin + "/a")!, discover: true)
        assert(knownAlias == trustFixture.config && discoveryHosts.count == beforeAlias,
            "A previously validated alias must avoid all discovery requests")

        reset()
        let aliasFixture = Fixture(), aliasAccess = aliasFixture.makeAccess()
        let firstAlias = try await aliasAccess.configuration(for: URL(string: aliasFixture.config.media_origin + "/a")!, discover: true)
        assert(firstAlias == aliasFixture.config && aliasFixture.discoveries == 2,
            "An unknown alias requires one confirmation from its authoritative source")

        reset()
        let discoveryFixture = Fixture(), discoveryAccess = discoveryFixture.makeAccess()
        discoveryFixture.holdDiscovery = true
        let preparing = Task { try await discoveryAccess.preparedURL(discoveryFixture.source) }
        await until { discoveryFixture.discoveryGate != nil }
        try discoveryAccess.signOut()
        discoveryFixture.discoveryGate!.resume()
        await failure(preparing, .cancelled)
        assert(ASWebAuthenticationSession.opened.isEmpty,
            "A discovery finishing after logout must not reopen the browser")
        print("PASS: actual native auth state, 20-way discovery/login/renewal deduplication, cold-launch reuse, header isolation, logout/browser/exchange races, start failure, transient retry, source-authorized aliases")
        finished = true
    } catch { fatalError("Auth fixture failed: \(error)") }
}
let deadline = Date().addingTimeInterval(25)
while !finished && Date() < deadline { RunLoop.main.run(until: Date().addingTimeInterval(0.005)) }
assert(finished, "Timed out")
'''

with tempfile.TemporaryDirectory(prefix="ottplay-auth-test-") as directory:
    path = Path(directory)
    sources = ROOT / "ios/App/App/Plugins"
    production = (sources / "AccessMedia.swift").read_text()
    for module in ["AuthenticationServices", "Capacitor", "Security", "UIKit"]:
        production = production.replace(f"import {module}\n", "")
    production = production.split("@objc(AccessMediaPlugin)", 1)[0]
    (path / "AccessMedia.swift").write_text("import CoreFoundation\n" + production)
    (path / "main.swift").write_text(SWIFT)
    subprocess.run(["swiftc", str(sources / "AccessMediaPolicy.swift"),
                    str(path / "AccessMedia.swift"), str(path / "main.swift"),
                    "-o", str(path / "test")], check=True)
    subprocess.run([str(path / "test")], check=True, timeout=35)
