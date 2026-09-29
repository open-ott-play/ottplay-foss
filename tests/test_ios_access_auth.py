#!/usr/bin/env python3
"""Exercise the production iOS auth state machine with deterministic OS fixtures.

Only platform APIs and HTTP are replaced; the session, discovery, Keychain,
ASWebAuthenticationSession and Capacitor request orchestration runs unchanged.
No real browser, Keychain or network is used.
"""
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SWIFT = r'''
import Foundation
import CoreFoundation

public protocol CAPBridgedPlugin {}
public struct CAPPluginMethod {
    init(name: String, returnType: String) {}
}
public let CAPPluginReturnPromise = "promise"
class Bridge { var viewController: UIViewController? }
public class CAPPlugin: NSObject {
    var bridge: Bridge?
    public func load() {}
}
public class CAPPluginCall: NSObject {
    let options: [String: Any]
    var result: [String: Any]?
    var error: String?
    init(_ options: [String: Any]) { self.options = options }
    func getString(_ key: String) -> String? { options[key] as? String }
    func resolve(_ result: [String: Any] = [:]) { self.result = result }
    func reject(_ error: String) { self.error = error }
}
final class AccessMediaHTTP {
    static var requests = 0
    static func fetch(_ request: URLRequest, limit: Int = 64 * 1024 * 1024) async throws -> (Data, HTTPURLResponse) {
        requests += 1
        throw AccessMediaFailure.unavailable
    }
}

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
    var beforeExchangeReturns: (() -> Void)?
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
        beforeExchangeReturns?()
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
        assert(AccessMediaPolicy.origin(URL(string: "HTTPS://SOURCE.fixture.invalid/list.m3u8")!) == fixture.config.source_origin)
        assert(fixture.config.map(URL(string: "HTTPS://SOURCE.fixture.invalid/list.m3u8")!)?.host == "media.fixture.invalid")
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
        let soleFixture = Fixture(), soleAccess = soleFixture.makeAccess()
        var soleSettled = false
        let sole = Task {
            defer { soleSettled = true }
            return try await soleAccess.authorized(URLRequest(url: soleFixture.source), config: soleFixture.config)
        }
        await until { ASWebAuthenticationSession.opened.count == 1 }
        let cancelledBrowser = ASWebAuthenticationSession.opened[0]
        sole.cancel()
        await until { soleSettled }
        await failure(sole, .cancelled)
        assert(cancelledBrowser.cancelled && soleFixture.exchanges == 0)
        let afterSole = Task { try await soleAccess.authorized(URLRequest(url: soleFixture.source), config: soleFixture.config) }
        await until { ASWebAuthenticationSession.opened.count == 2 }
        cancelledBrowser.succeed()
        for _ in 0..<20 { await Task.yield() }
        assert(soleFixture.exchanges == 0, "A cancelled operation's callback must never exchange its code")
        ASWebAuthenticationSession.opened[1].succeed()
        _ = try await afterSole.value
        assert(soleFixture.exchanges == 1)

        reset()
        let sharedFixture = Fixture(), sharedAccess = sharedFixture.makeAccess()
        var retiredSettled = false, survivorStarted = false
        let retired = Task {
            defer { retiredSettled = true }
            return try await sharedAccess.authorized(URLRequest(url: sharedFixture.source), config: sharedFixture.config)
        }
        await until { ASWebAuthenticationSession.opened.count == 1 }
        let survivor = Task {
            survivorStarted = true
            return try await sharedAccess.authorized(URLRequest(url: sharedFixture.source), config: sharedFixture.config)
        }
        await until { survivorStarted }
        retired.cancel()
        await until { retiredSettled }
        await failure(retired, .cancelled)
        assert(!ASWebAuthenticationSession.opened[0].cancelled && ASWebAuthenticationSession.opened.count == 1,
            "Cancelling one waiter must preserve another waiter's shared browser")
        ASWebAuthenticationSession.opened[0].succeed()
        _ = try await survivor.value
        assert(sharedFixture.exchanges == 1)

        reset()
        let retiredExchangeFixture = Fixture(), retiredExchangeAccess = retiredExchangeFixture.makeAccess()
        retiredExchangeFixture.holdExchange = true
        var exchangeSettled = false
        let retiredExchange = Task {
            defer { exchangeSettled = true }
            return try await retiredExchangeAccess.authorized(URLRequest(url: retiredExchangeFixture.source), config: retiredExchangeFixture.config)
        }
        await until { ASWebAuthenticationSession.opened.count == 1 }
        ASWebAuthenticationSession.opened[0].succeed()
        await until { retiredExchangeFixture.exchangeGate != nil }
        retiredExchange.cancel()
        await until { exchangeSettled }
        await failure(retiredExchange, .cancelled)
        assert(Keychain.writes == 0, "The last cancelled waiter settles without waiting for the network")
        let newExchange = Task { try await retiredExchangeAccess.authorized(URLRequest(url: retiredExchangeFixture.source), config: retiredExchangeFixture.config) }
        await until { ASWebAuthenticationSession.opened.count == 2 }
        retiredExchangeFixture.exchangeGate!.resume()
        for _ in 0..<20 { await Task.yield() }
        assert(Keychain.writes == 0, "A late cancelled exchange cannot save credentials or retire a newer login")
        retiredExchangeFixture.holdExchange = false
        ASWebAuthenticationSession.opened[1].succeed()
        _ = try await newExchange.value
        assert(Keychain.writes == 1 && retiredExchangeFixture.exchanges == 2)

        reset()
        let simultaneousFixture = Fixture(), simultaneousAccess = simultaneousFixture.makeAccess()
        var simultaneous: Task<URLRequest, Error>!
        simultaneousFixture.beforeExchangeReturns = { simultaneous.cancel() }
        simultaneous = Task { try await simultaneousAccess.authorized(URLRequest(url: simultaneousFixture.source), config: simultaneousFixture.config) }
        await until { ASWebAuthenticationSession.opened.count == 1 }
        ASWebAuthenticationSession.opened[0].succeed()
        await failure(simultaneous, .cancelled)
        assert(Keychain.writes == 0,
            "Cancellation immediately before exchange returns must prevent credential persistence before actor cleanup runs")

        reset()
        let survivingFixture = Fixture(), survivingAccess = survivingFixture.makeAccess()
        var cancelledAtExchange: Task<URLRequest, Error>!
        survivingFixture.beforeExchangeReturns = { cancelledAtExchange.cancel() }
        cancelledAtExchange = Task { try await survivingAccess.authorized(URLRequest(url: survivingFixture.source), config: survivingFixture.config) }
        await until { ASWebAuthenticationSession.opened.count == 1 }
        let liveAtExchange = Task { try await survivingAccess.authorized(URLRequest(url: survivingFixture.source), config: survivingFixture.config) }
        for _ in 0..<20 { await Task.yield() }
        ASWebAuthenticationSession.opened[0].succeed()
        await failure(cancelledAtExchange, .cancelled)
        _ = try await liveAtExchange.value
        assert(Keychain.writes == 1 && survivingFixture.exchanges == 1,
            "An exchange with a remaining live consumer still completes and persists once")

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

        reset()
        let bridgeFixture = Fixture()
        let configObject = try JSONSerialization.jsonObject(with: JSONEncoder().encode(bridgeFixture.config))
        Keychain.data = try JSONSerialization.data(withJSONObject: [bridgeFixture.config.source_origin: ["config": configObject]])
        AccessMedia.shared.presenter = bridgeFixture.presenter
        let plugin = AccessMediaPlugin()
        let first = CAPPluginCall(["url": bridgeFixture.source.absoluteString, "requestId": "first"])
        let second = CAPPluginCall(["url": bridgeFixture.source.absoluteString, "requestId": "second"])
        plugin.prepare(first); plugin.prepare(second)
        await until { ASWebAuthenticationSession.opened.count == 1 }
        let duplicateID = CAPPluginCall(["url": bridgeFixture.source.absoluteString, "requestId": "first"])
        plugin.prepare(duplicateID)
        await until { duplicateID.error != nil }
        assert(duplicateID.error == "Source request is already pending" && first.error == nil,
            "A duplicate ID must reject only the duplicate and preserve the original request")
        let cancelFirst = CAPPluginCall(["requestId": "first"])
        plugin.cancelPrepare(cancelFirst)
        await until { first.error != nil }
        assert(cancelFirst.result?["cancelled"] as? Bool == true && second.error == nil)
        assert(!ASWebAuthenticationSession.opened[0].cancelled)
        let unknown = CAPPluginCall(["requestId": "unknown"])
        plugin.cancelPrepare(unknown)
        await until { unknown.result != nil }
        assert(unknown.result?["cancelled"] as? Bool == false)
        let cancelSecond = CAPPluginCall(["requestId": "second"])
        plugin.cancelPrepare(cancelSecond)
        await until { second.error != nil }
        assert(ASWebAuthenticationSession.opened[0].cancelled)

        let immediate = CAPPluginCall(["url": bridgeFixture.source.absoluteString, "requestId": "immediate"])
        let cancelImmediate = CAPPluginCall(["requestId": "immediate"])
        plugin.prepare(immediate); plugin.cancelPrepare(cancelImmediate)
        await until { immediate.error != nil }
        assert(cancelImmediate.result?["cancelled"] as? Bool == true,
            "Cancellation queued before work starts must still see the registered request")

        let baseline = ASWebAuthenticationSession.opened.count
        let reuseOld = CAPPluginCall(["url": bridgeFixture.source.absoluteString, "requestId": "reuse"])
        plugin.prepare(reuseOld)
        await until { ASWebAuthenticationSession.opened.count == baseline + 1 }
        let reuseBrowser = ASWebAuthenticationSession.opened.last!
        let cancelReuse = CAPPluginCall(["requestId": "reuse"])
        let reuseNew = CAPPluginCall(["url": bridgeFixture.source.absoluteString, "requestId": "reuse"])
        plugin.cancelPrepare(cancelReuse); plugin.prepare(reuseNew)
        await until { reuseOld.error != nil }
        // The new waiter may retain a still-live shared login, or start a fresh
        // one after the old waiter was retired; both orderings are valid.
        if reuseBrowser.cancelled { reuseBrowser.succeed() }
        for _ in 0..<20 { await Task.yield() }
        let cancelNew = CAPPluginCall(["requestId": "reuse"])
        plugin.cancelPrepare(cancelNew)
        await until { reuseNew.error != nil }
        assert(cancelNew.result?["cancelled"] as? Bool == true,
            "An old task's completion must not erase a reused request ID")
        assert(AccessMediaHTTP.requests == 0, "Cancelled bridge work must never reach the exchange network")

        let badID = CAPPluginCall(["url": bridgeFixture.source.absoluteString, "requestId": "../bad"])
        plugin.prepare(badID)
        assert(badID.error == "Invalid source request")
        let newlineID = CAPPluginCall(["url": bridgeFixture.source.absoluteString, "requestId": "bad\n"])
        plugin.prepare(newlineID)
        assert(newlineID.error == "Invalid source request")
        let nonStringID = CAPPluginCall(["url": bridgeFixture.source.absoluteString, "requestId": 42])
        plugin.prepare(nonStringID)
        assert(nonStringID.error == "Invalid source request")
        let legacyCount = ASWebAuthenticationSession.opened.count
        let legacy = CAPPluginCall(["url": bridgeFixture.source.absoluteString])
        plugin.prepare(legacy)
        await until { ASWebAuthenticationSession.opened.count == legacyCount + 1 }
        try AccessMedia.shared.signOut()
        await until { legacy.error != nil }
        print("PASS: native auth deduplication/reuse/alias trust, per-waiter cancellation, late browser/exchange isolation, native prepare/cancel ownership and uppercase HTTPS")
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
    (path / "AccessMedia.swift").write_text("import CoreFoundation\n" + production)
    policy = (sources / "AccessMediaPolicy.swift").read_text().split("// Used only for protected requests", 1)[0]
    (path / "AccessMediaPolicy.swift").write_text(policy)
    (path / "main.swift").write_text(SWIFT)
    subprocess.run(["swiftc", str(path / "AccessMediaPolicy.swift"),
                    str(path / "AccessMedia.swift"), str(path / "main.swift"),
                    "-o", str(path / "test")], check=True)
    subprocess.run([str(path / "test")], check=True, timeout=35)
