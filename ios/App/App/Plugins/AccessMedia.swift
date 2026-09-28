import AuthenticationServices
import Capacitor
import Foundation
import Security
import UIKit

private struct SavedAccessMedia: Codable {
    let config: AccessMediaConfig
    var session: AccessMediaSession?
}

@MainActor
final class AccessMedia: NSObject, ASWebAuthenticationPresentationContextProviding {
    static let shared = AccessMedia()
    weak var presenter: UIViewController?
    private var entries: [String: SavedAccessMedia] = [:]
    private var missing: [String: Date] = [:]
    private var discovery: [String: Task<AccessMediaConfig?, Error>] = [:]
    private var logins: [String: Task<AccessMediaSession, Error>] = [:]
    private var authentication: ASWebAuthenticationSession?
    private var proxy: AccessMediaProxy?
    private var generation = 0
    private let keychainService = "play.ott.foss.source-access.v1"

    override init() {
        super.init()
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService, kSecAttrAccount as String: "sources",
            kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var result: CFTypeRef?
        if SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
           let data = result as? Data, let saved = try? JSONDecoder().decode([String: SavedAccessMedia].self, from: data) {
            for (origin, entry) in saved {
                if let url = URL(string: origin), (try? entry.config.validated(for: url)) != nil {
                    entries[origin] = entry
                }
            }
        }
    }

    private func save() throws {
        let data = try JSONEncoder().encode(entries)
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService, kSecAttrAccount as String: "sources"]
        let attributes: [String: Any] = [kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            guard SecItemAdd(query.merging(attributes, uniquingKeysWith: { _, value in value }) as CFDictionary, nil) == errSecSuccess
            else { throw AccessMediaFailure.unavailable }
        } else if status != errSecSuccess { throw AccessMediaFailure.unavailable }
    }

    func configuration(for url: URL, discover: Bool) async throws -> AccessMediaConfig? {
        guard let origin = AccessMediaPolicy.origin(url) else { return nil }
        if let entry = entries[origin] { return entry.config }
        if let entry = entries.values.first(where: { $0.config.media_origin == origin }) { return entry.config }
        guard discover else { return nil }
        if let until = missing[origin], until > Date() { return nil }
        if let pending = discovery[origin] { return try await pending.value }
        let pending = Task<AccessMediaConfig?, Error> {
            var request = URLRequest(url: URL(string: origin + "/_ottplay/public/config")!)
            request.timeoutInterval = 5
            request.setValue("application/json", forHTTPHeaderField: "Accept")
            guard let (data, response) = try? await AccessMediaHTTP.fetch(request, limit: 4096), response.statusCode == 200,
                  let config = try? JSONDecoder().decode(AccessMediaConfig.self, from: data) else { return nil }
            return try config.validated(for: url)
        }
        discovery[origin] = pending
        defer { discovery[origin] = nil }
        if let config = try await pending.value {
            if entries[config.source_origin]?.config != config {
                entries[config.source_origin] = SavedAccessMedia(config: config, session: nil)
            }
            return config
        }
        missing[origin] = Date().addingTimeInterval(300)
        return nil
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        presenter?.view.window ?? ASPresentationAnchor()
    }

    private func authenticate(_ config: AccessMediaConfig) async throws -> AccessMediaSession {
        if let current = entries[config.source_origin]?.session, current.valid(for: config) { return current }
        if let pending = logins[config.source_origin] { return try await pending.value }
        let generation = self.generation
        let pending = Task<AccessMediaSession, Error> {
            guard self.authentication == nil else { throw AccessMediaFailure.busy }
            guard UIApplication.shared.applicationState == .active, self.presenter?.view.window != nil else {
                throw AccessMediaFailure.login
            }
            let verifier = try AccessMediaPolicy.random()
            let state = try AccessMediaPolicy.random()
            var login = URLComponents(string: config.media_origin + config.authorize_path)!
            login.queryItems = [URLQueryItem(name: "state", value: state),
                URLQueryItem(name: "code_challenge", value: AccessMediaPolicy.challenge(verifier)),
                URLQueryItem(name: "code_challenge_method", value: "S256")]
            let callback: URL = try await withCheckedThrowingContinuation { continuation in
                let auth = ASWebAuthenticationSession(url: login.url!, callbackURLScheme: "ottplay-access") { url, error in
                    Task { @MainActor in self.authentication = nil }
                    if let url { continuation.resume(returning: url) }
                    else {
                        let cancelled = (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin
                        continuation.resume(throwing: cancelled ? AccessMediaFailure.cancelled : AccessMediaFailure.login)
                    }
                }
                auth.presentationContextProvider = self
                auth.prefersEphemeralWebBrowserSession = false
                self.authentication = auth
                if !auth.start() {
                    self.authentication = nil
                    continuation.resume(throwing: AccessMediaFailure.login)
                }
            }
            let code = try AccessMediaPolicy.callbackCode(callback, state: state)
            var exchange = URLRequest(url: URL(string: config.media_origin + config.exchange_path)!)
            exchange.httpMethod = "POST"; exchange.timeoutInterval = 15
            exchange.setValue("application/json", forHTTPHeaderField: "Content-Type")
            exchange.httpBody = try JSONSerialization.data(withJSONObject: ["code": code, "verifier": verifier])
            let (data, response) = try await AccessMediaHTTP.fetch(exchange, limit: 20000)
            guard self.generation == generation else { throw AccessMediaFailure.cancelled }
            guard response.statusCode == 200, let result = try? JSONDecoder().decode(AccessMediaSession.self, from: data),
                  result.valid(for: config) else { throw AccessMediaFailure.login }
            self.entries[config.source_origin] = SavedAccessMedia(config: config, session: result)
            do { try self.save() } catch {
                self.entries[config.source_origin]?.session = nil
                throw error
            }
            return result
        }
        logins[config.source_origin] = pending
        defer { logins[config.source_origin] = nil }
        return try await pending.value
    }

    func authorized(_ request: URLRequest, config: AccessMediaConfig, replacing rejectedCookie: String? = nil) async throws -> URLRequest {
        guard let url = request.url, let target = config.map(url) else { throw AccessMediaFailure.invalid }
        if let rejectedCookie, let current = entries[config.source_origin]?.session,
           rejectedCookie == "CF_Authorization=\(current.token)" { entries[config.source_origin]?.session = nil }
        let session = try await authenticate(config)
        var result = request
        result.url = target
        for name in result.allHTTPHeaderFields?.keys.map({ $0 }) ?? [] {
            if name.lowercased() == "cookie" || name.lowercased().hasPrefix("cf-") || name.lowercased() == "host" {
                result.setValue(nil, forHTTPHeaderField: name)
            }
        }
        result.httpShouldHandleCookies = false
        result.setValue("CF_Authorization=\(session.token)", forHTTPHeaderField: "Cookie")
        return result
    }

    func preparedURL(_ url: URL) async throws -> URL {
        guard let config = try await configuration(for: url, discover: true) else { return url }
        _ = try await authenticate(config)
        if proxy == nil { proxy = try AccessMediaProxy() }
        return try await proxy!.url(for: url, config: config)
    }

    // No credentials or ephemeral loopback URLs are written to JS settings/backups.
    nonisolated static func fetch(_ request: URLRequest, discoverOnFailure: Bool = true,
                                 completion: @escaping (Data?, URLResponse?, Error?) -> Void) {
        Task {
            do {
                guard let url = request.url else { throw AccessMediaFailure.invalid }
                var config = try await shared.configuration(for: url, discover: false)
                if config == nil {
                    let (data, response) = try await URLSession.shared.data(for: request)
                    let http = response as? HTTPURLResponse
                    let challenge = [401, 403].contains(http?.statusCode ?? 0) ||
                        response.url?.host?.hasSuffix(".cloudflareaccess.com") == true
                    if discoverOnFailure && request.httpMethod == "GET" && challenge {
                        config = try await shared.configuration(for: url, discover: true)
                    }
                    if config == nil { completion(data, response, nil); return }
                }
                guard let config else { throw AccessMediaFailure.invalid }
                var rejectedCookie: String?
                for attempt in 0...1 {
                    let authorized = try await shared.authorized(request, config: config, replacing: rejectedCookie)
                    let (data, response) = try await AccessMediaHTTP.fetch(authorized)
                    if [301, 302, 303, 307, 308, 401, 403].contains(response.statusCode) {
                        if attempt == 0 { rejectedCookie = authorized.value(forHTTPHeaderField: "Cookie"); continue }
                        throw AccessMediaFailure.login
                    }
                    // Access credentials must never cross the Capacitor bridge as response headers.
                    var fields: [String: String] = [:]
                    for (name, value) in response.allHeaderFields {
                        let key = String(describing: name)
                        if key.lowercased() != "set-cookie" && !key.lowercased().hasPrefix("cf-access-") {
                            fields[key] = String(describing: value)
                        }
                    }
                    completion(data, HTTPURLResponse(url: url, statusCode: response.statusCode,
                        httpVersion: "HTTP/1.1", headerFields: fields), nil)
                    return
                }
            } catch {
                // Transport error descriptions can contain signed media URLs.
                completion(nil, nil, error as? AccessMediaFailure ?? AccessMediaFailure.unavailable)
            }
        }
    }

    func manage() {
        guard let presenter else { return }
        let russian = Locale.preferredLanguages.first?.hasPrefix("ru") == true
        let alert = UIAlertController(title: russian ? "Доступ к источникам" : "Source access",
            message: entries.isEmpty ? (russian ? "Вход появится при загрузке защищённого плейлиста." :
                "Sign-in opens when you load a protected playlist.") : nil, preferredStyle: .alert)
        for origin in entries.keys.sorted() {
            let host = URL(string: origin)?.host ?? origin
            alert.addAction(UIAlertAction(title: (russian ? "Войти: " : "Sign in: ") + host, style: .default) { _ in
                Task { @MainActor in
                    guard let config = self.entries[origin]?.config else { return }
                    self.entries[origin]?.session = nil
                    do { _ = try await self.authenticate(config) }
                    catch { self.showError(error) }
                }
            })
        }
        if !entries.isEmpty {
            alert.addAction(UIAlertAction(title: russian ? "Выйти из всех источников" : "Sign out of all sources", style: .destructive) { _ in
                self.generation += 1
                self.authentication?.cancel()
                self.proxy?.stop(); self.proxy = nil
                for origin in self.entries.keys { self.entries[origin]?.session = nil }
                do { try self.save() } catch { self.showError(error) }
            })
        }
        alert.addAction(UIAlertAction(title: russian ? "Закрыть" : "Close", style: .cancel))
        presenter.present(alert, animated: true)
    }

    private func showError(_ error: Error) {
        let alert = UIAlertController(title: "Source access", message: (error as? AccessMediaFailure)?.rawValue ?? AccessMediaFailure.unavailable.rawValue,
                                      preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        presenter?.present(alert, animated: true)
    }
}

@objc(AccessMediaPlugin)
public class AccessMediaPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AccessMediaPlugin"
    public let jsName = "AccessMedia"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "prepare", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "manage", returnType: CAPPluginReturnPromise),
    ]
    public override func load() {
        Task { @MainActor in AccessMedia.shared.presenter = self.bridge?.viewController }
    }
    @objc func prepare(_ call: CAPPluginCall) {
        guard let value = call.getString("url"), let url = URL(string: value) else { call.reject("Invalid source URL"); return }
        Task { @MainActor in
            do { call.resolve(["url": try await AccessMedia.shared.preparedURL(url).absoluteString]) }
            catch { call.reject((error as? AccessMediaFailure)?.rawValue ?? AccessMediaFailure.unavailable.rawValue) }
        }
    }
    @objc func manage(_ call: CAPPluginCall) {
        Task { @MainActor in AccessMedia.shared.manage(); call.resolve() }
    }
}
