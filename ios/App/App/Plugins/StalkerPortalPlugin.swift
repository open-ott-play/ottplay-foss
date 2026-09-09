/// Mode B native HTTP for Stalker `/stalker_portal/api/`, `host_ott/swop/a.php`,
/// and Mag path-shaped `/load.php`|`/c/portal` URLs (allowlist + header forward only).
import Capacitor
import Foundation
import os.log

@objc(StalkerPortalPlugin)
public class StalkerPortalPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "StalkerPortalPlugin"
    public let jsName = "StalkerPortal"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "portalRequest", returnType: CAPPluginReturnPromise),
    ]

    private static let DEFAULT_TIMEOUT: TimeInterval = 15

    private func isAllowedUrl(_ url: String) -> Bool {
        return url.contains("/stalker_portal/api/")
            || url.contains("/stalker_portal/stream/")
            || url.contains("/swop/a.php")
            || url.contains("/load.php")
            || url.contains("/c/portal")
    }

    private func isForbiddenHeader(_ name: String) -> Bool {
        let n = name.lowercased()
        return n == "host" || n == "content-length" || n == "connection"
            || n == "transfer-encoding" || n == "upgrade"
    }

    @objc func portalRequest(_ call: CAPPluginCall) {
        guard let rawURL = call.getString("url"), !rawURL.isEmpty else {
            call.reject("missing url")
            return
        }
        guard isAllowedUrl(rawURL) else {
            call.reject("url is not an allowed stalker/swop/load.php/c/portal path")
            return
        }
        guard let url = URL(string: rawURL) else {
            call.reject("invalid url")
            return
        }

        let method = (call.getString("method") ?? "GET").uppercased()
        let bodyString = call.getString("body") ?? ""
        let contentType = call.getString("contentType") ?? "application/json"
        let headers = call.getObject("headers") as? [String: Any]

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = StalkerPortalPlugin.DEFAULT_TIMEOUT

        var contentTypeFromHeaders = false
        if let headers = headers {
            for (key, value) in headers {
                if isForbiddenHeader(key) { continue }
                guard let str = value as? String else { continue }
                if key.lowercased() == "content-type" {
                    contentTypeFromHeaders = true
                }
                request.setValue(str, forHTTPHeaderField: key)
            }
        }
        if !bodyString.isEmpty {
            if !contentTypeFromHeaders {
                request.setValue(contentType, forHTTPHeaderField: "Content-Type")
            }
            request.httpBody = bodyString.data(using: .utf8)
        }

        let task = URLSession.shared.dataTask(with: request) { data, response, error in
            if let error = error {
                DispatchQueue.main.async {
                    call.reject("portalRequest failed: \(error.localizedDescription)")
                }
                return
            }
            guard let data = data, let response = response else {
                let nsError = NSError(domain: "StalkerPortal", code: -1, userInfo: [NSLocalizedDescriptionKey: "empty response"])
                DispatchQueue.main.async {
                    call.reject("portalRequest failed: \(nsError.localizedDescription)")
                }
                return
            }
            let http = response as? HTTPURLResponse
            let status = http?.statusCode ?? 0
            let contentType = response.mimeType ?? "application/octet-stream"
            let body = String(data: data, encoding: .utf8) ?? ""
            var setCookie: [String] = []
            if let fields = http?.allHeaderFields {
                for (k, v) in fields {
                    if String(describing: k).lowercased() == "set-cookie",
                       let s = v as? String {
                        setCookie.append(s)
                    }
                }
                // URLSession may coalesce; also check value(forHTTPHeaderField:)
                if setCookie.isEmpty,
                   let single = http?.value(forHTTPHeaderField: "Set-Cookie"),
                   !single.isEmpty {
                    setCookie.append(single)
                }
            }
            Logger(subsystem: "play.ott.foss", category: "StalkerPortal").debug("[StalkerPortal] OK \(rawURL) (status=\(status))")
            DispatchQueue.main.async {
                call.resolve([
                    "status": NSNumber(value: status),
                    "body": body,
                    "contentType": contentType,
                    "setCookie": setCookie,
                ])
            }
        }
        task.resume()
    }
}
