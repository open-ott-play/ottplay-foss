import Capacitor
import Foundation
import os.log

// UA presets mirrored from src-rs/core/src/m3u.rs and archive/server.py
private let uaPresets: [String: String] = [
  "webos":
    "Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/68.0.3440.106 Safari/537.36 LG Browser/9.00.00",
  "tizen":
    "Mozilla/5.0 (SMART-TV; Linux; Tizen 5.5) AppleWebKit/537.36 (KHTML, like Gecko) SamsungTV/3.0 Chrome/76.0.3809.146 Safari/537.36",
  "viera":
    "Mozilla/5.0 (Unknown; Linux; Viera/1.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/68.0.3440.106 Safari/537.36",
  "mag": "Mozilla/5.0 (STB; Infomir MAG524) Maple 6.0 QtWebKit/3.0",
  "dune":
    "Mozilla/5.0 (Dune HD; DuneOS) AppleWebKit/537.36 (KHTML, like Gecko) DuneHD/1.0 Chrome/68.0.3440.106 Safari/537.36",
]

private func resolveUA(_ input: String?) -> String {
  guard let input, !input.isEmpty else { return "OTT-play-FOSS/1.0" }
  return uaPresets[input.lowercased()] ?? input
}

@objc(M3UProxyPlugin)
public class M3UProxyPlugin: CAPPlugin, CAPBridgedPlugin {
  public let identifier = "M3UProxyPlugin"
  public let jsName = "M3UProxy"
  public let pluginMethods: [CAPPluginMethod] = [
    CAPPluginMethod(name: "proxyFetch", returnType: CAPPluginReturnPromise)
  ]

  private static let defaultTimeout: TimeInterval = 15

  @objc func proxyFetch(_ call: CAPPluginCall) {
    guard let rawURL = call.getString("url"), !rawURL.isEmpty else {
      call.reject("missing url")
      return
    }

    var urlStr = rawURL
    if urlStr.hasPrefix("@") { urlStr.removeFirst() }
    guard let url = URL(string: urlStr),
      let scheme = url.scheme?.lowercased(),
      ["http", "https"].contains(scheme),
      url.host != nil
    else {
      call.reject("invalid url")
      return
    }

    let referer = call.getString("referer") ?? ""
    let ua = resolveUA(call.getString("userAgent"))

    var request = URLRequest(url: url)
    request.httpMethod = "GET"
    request.setValue(ua, forHTTPHeaderField: "User-Agent")
    if !referer.isEmpty, let refURL = URL(string: referer) {
      request.setValue(refURL.absoluteString, forHTTPHeaderField: "Referer")
    } else if let origin = url.scheme.map({ "\($0)://\(url.host ?? "")" }) {
      request.setValue(origin, forHTTPHeaderField: "Referer")
    }
    request.timeoutInterval = M3UProxyPlugin.defaultTimeout

    let task = URLSession.shared.dataTask(with: request) { data, response, error in
      if let error = error {
        DispatchQueue.main.async {
          // URLSession descriptions may contain provider credentials.
          call.reject("proxy_fetch failed: transport error \((error as NSError).code)")
        }
        return
      }
      guard let response = response as? HTTPURLResponse else {
        DispatchQueue.main.async { call.reject("proxy_fetch failed: invalid HTTP response") }
        return
      }
      guard (200..<300).contains(response.statusCode) else {
        DispatchQueue.main.async { call.reject("Upstream \(response.statusCode)") }
        return
      }
      guard let data = data, let body = String(data: data, encoding: .utf8) else {
        let nsError = NSError(
          domain: "M3UProxy", code: -1, userInfo: [NSLocalizedDescriptionKey: "empty response"])
        DispatchQueue.main.async {
          call.reject("proxy_fetch failed: \(nsError.localizedDescription)")
        }
        return
      }
      os_log("[M3UProxy] OK (status=%d, bytes=%d)", response.statusCode, data.count)
      DispatchQueue.main.async {
        call.resolve(["body": body])
      }
    }

    task.resume()
  }
}
