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

    @objc func portalRequest(_ call: CAPPluginCall) {
        guard let rawURL = call.getString("url"), !rawURL.isEmpty else {
            call.reject("missing url")
            return
        }
        guard let url = URL(string: rawURL) else {
            call.reject("invalid url")
            return
        }

        let method = (call.getString("method") ?? "GET").uppercased()
        let bodyString = call.getString("body") ?? ""
        let contentType = call.getString("contentType") ?? "application/json"

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        if !bodyString.isEmpty {
            request.httpBody = bodyString.data(using: .utf8)
        }
        request.timeoutInterval = StalkerPortalPlugin.DEFAULT_TIMEOUT

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
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            let contentType = response.mimeType ?? "application/octet-stream"
            let body = String(data: data, encoding: .utf8) ?? ""
            os.log("[StalkerPortal] OK %{public}s (status=%d)", rawURL, status)
            DispatchQueue.main.async {
                call.resolve([
                    "status": NSNumber(value: status),
                    "body": body,
                    "contentType": contentType,
                ])
            }
        }
        task.resume()
    }
}
