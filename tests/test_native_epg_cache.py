#!/usr/bin/env python3
"""Run native cache regressions with Swift and Kotlin/JVM (no mobile SDK/build).

The actual plugin sources are compiled with small Capacitor/network stubs. Only
platform imports/annotations are adapted; cache and callback code is unchanged.
Requires swift, kotlinc and java on PATH. Run: python3 tests/test_native_epg_cache.py
Use --check-mirrors-only for the shipping-source guard without native compilers.
"""

import base64
import gzip
import pathlib
import shutil
import subprocess
import sys
import tempfile


ROOT = pathlib.Path(__file__).resolve().parents[1]
XML = '<tv><channel id="a"><display-name>Feed A</display-name></channel></tv>'
GZIP = base64.b64encode(gzip.compress(XML.encode())).decode()


def run(*args, cwd):
    subprocess.run(args, cwd=cwd, check=True)


def check_shipping_sources():
    mirrors = (
        ("mobile-xmltv-epg/src/ios/MobileXmltvEpg.swift", "ios/App/CapApp-SPM/Sources/CapApp-SPM/MobileXmltvEpg.swift"),
        ("mobile-xmltv-epg/src/android/play/ott/foss/plugin/MobileXmltvEpgPlugin.kt", "android/app/src/main/java/play/ott/foss/plugin/MobileXmltvEpgPlugin.kt"),
    )
    for source, shipping in mirrors:
        if (ROOT / source).read_bytes() != (ROOT / shipping).read_bytes():
            raise AssertionError(f"Shipping native source differs from template: {shipping}")
    print("PASS native shipping source mirrors match templates", flush=True)


SWIFT_STUBS = r'''
import Foundation
public class CAPPlugin: NSObject {}
public protocol CAPBridgedPlugin {}
public struct CAPPluginMethod { init(name: String, returnType: String) {} }
let CAPPluginReturnPromise = "promise"
class CAPPluginCall {
    let source: String
    var values: [String: Any] = [:]
    var result: [String: Any] = [:]
    var resolved = false
    var rejected = false
    init(_ source: String) { self.source = source }
    func getString(_ key: String) -> String? { key == "xmltv_url" ? source : values[key] as? String }
    func getArray<T>(_ key: String, _ ofType: T.Type) -> [T]? { values[key] as? [T] }
    func getInt(_ key: String) -> Int? { values[key] as? Int }
    func resolve(_ result: [String: Any] = [:]) { resolved = true; self.result = result }
    func reject(_ message: String) { rejected = true }
}
class URLSession {
    static let shared = URLSession()
    var data: Data?
    var requests = 0
    var sources: [String: Data] = [:]
    class Task {
        let action: () -> Void
        init(_ action: @escaping () -> Void) { self.action = action }
        func resume() { action() }
    }
    func dataTask(with url: URL, completionHandler: @escaping (Data?, Any?, Error?) -> Void) -> Task {
        requests += 1
        return Task { let body = self.sources[url.absoluteString] ?? self.data; completionHandler(body, nil, body == nil ? NSError(domain: "offline", code: 1) : nil) }
    }
}
'''

SWIFT_TESTS = r'''
    func runCacheTests() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        cacheURL = dir.appendingPathComponent("epg2.xml.gz")
        metaURL = dir.appendingPathComponent("epg2.meta")
        let a = URL(string: "https://a.invalid/feed.gz")!
        let b = URL(string: "https://b.invalid/feed.gz")!
        let data = Data(base64Encoded: "GZIP_FIXTURE")!
        let xml = String(data: gunzip(data)!, encoding: .utf8)!
        try writeCache(data, for: a)
        assert(try readCache(for: a) == xml)
        assert(try readCache(for: b) == nil)
        assert(try readCache(for: b, allowStale: true) == nil)
        let fresh = CAPPluginCall(a.absoluteString)
        getEpg(fresh)
        assert(fresh.resolved && !fresh.rejected && URLSession.shared.requests == 0)
        let other = CAPPluginCall(b.absoluteString)
        getEpg(other)
        assert(other.rejected && !other.resolved)
        try "0\n\(a.absoluteString)".write(to: metaURL, atomically: true, encoding: .utf8)
        assert(try readCache(for: a) == nil)
        assert(try readCache(for: a, allowStale: true) == xml)
        let stale = CAPPluginCall(a.absoluteString)
        getEpg(stale)
        assert(stale.resolved && !stale.rejected)
        URLSession.shared.data = Data("invalid gzip".utf8)
        let invalid = CAPPluginCall(b.absoluteString)
        getEpg(invalid)
        assert(invalid.rejected && !invalid.resolved)
        assert(try readCache(for: a, allowStale: true) == xml)
        prefetch(CAPPluginCall(b.absoluteString))
        assert(try readCache(for: a, allowStale: true) == xml)
        URLSession.shared.data = data
        prefetch(CAPPluginCall(b.absoluteString))
        assert(try readCache(for: b) == xml)
        assert(try readCache(for: a, allowStale: true) == nil)
        try "\(Date().timeIntervalSince1970)".write(to: metaURL, atomically: true, encoding: .utf8)
        assert(try readCache(for: b) == nil)
        assert(try readCache(for: b, allowStale: true) == nil)
        URLSession.shared.data = nil
        parsedCache.removeAll() // simulate restart after incompatible disk metadata
        let legacy = CAPPluginCall(b.absoluteString)
        getEpg(legacy)
        assert(legacy.rejected && !legacy.resolved)

        // Native source selection, XML metadata, regional shifts and shared index/EPG cache.
        let now = Int(Date().timeIntervalSince1970)
        let format = DateFormatter(); format.dateFormat = "yyyyMMddHHmmss Z"; format.timeZone = TimeZone(secondsFromGMT: 0)
        let start = format.string(from: Date(timeIntervalSince1970: Double(now)))
        let stop = format.string(from: Date(timeIntervalSince1970: Double(now + 3600)))
        let fixture = "<tv><channel id=\"wanted\"><display-name>Original &amp; A</display-name><display-name>Alias</display-name><icon src=\"https://icons.test/a.png\"/></channel><channel id=\"wrong\"><display-name>Private</display-name></channel><programme channel=\"wanted\" start=\"\(start)\" stop=\"\(stop)\"><title><![CDATA[Morning & News]]></title><desc>Details</desc></programme></tv>"
        let parsed = parseXmltv(fixture)
        assert(parsed.names["wanted"] == ["Original & A", "Alias"])
        assert(parsed.icons["wanted"] == "https://icons.test/a.png")
        assert(resolveXmltvId(channels: parsed.channels, ch: "Private +4", hash: "wanted", names: parsed.names) == "wanted")
        assert(resolveXmltvId(channels: parsed.channels, ch: "Renamed", hash: "", tvgName: "Alias", names: parsed.names) == "wanted")
        let plus = buildSlice(parsed, channelId: "42", ch: "Private +4", hash: "wanted", timeShiftHours: 0, archiveHours: 168)
        let plusRows = plus["epg_data"] as! [[String: Any]]
        assert(plusRows[0]["time"] as! Int == now + 14400)
        assert(plusRows[0]["name"] as! String == "Morning & News")
        let explicit = buildSlice(parsed, channelId: "42", ch: "Private +4", hash: "wanted", timeShiftHours: -2, archiveHours: 168)
        assert((explicit["epg_data"] as! [[String: Any]])[0]["time"] as! Int == now - 7200)
        let sourceA = "http://custom.test/a.xml"
        let sourceB = "https://custom.test/b.xml"
        URLSession.shared.sources[sourceA] = Data(fixture.utf8)
        URLSession.shared.sources[sourceB] = Data(fixture.replacingOccurrences(of: "Morning & News", with: "Second feed").utf8)
        let indexCall = CAPPluginCall("")
        indexCall.values["xmltv_urls"] = [sourceA, sourceB]
        getChannels(indexCall)
        assert(indexCall.resolved && !indexCall.rejected)
        assert((indexCall.result["channels"] as! [[String: Any]]).contains { ($0["id"] as? String) == "wanted" && ($0["icon"] as? String) == "https://icons.test/a.png" })
        let requestsBefore = URLSession.shared.requests
        let epgCall = CAPPluginCall("")
        epgCall.values = ["xmltv_urls": [sourceA, sourceB], "hash": "wanted", "ch": "Private +4"]
        getEpg(epgCall)
        assert(epgCall.resolved && URLSession.shared.requests == requestsBefore)
        assert((epgCall.result["epg_data"] as! [[String: Any]])[0]["name"] as! String == "Morning & News")
        let secondCall = CAPPluginCall(sourceB); secondCall.values["hash"] = "wanted"
        getEpg(secondCall)
        assert((secondCall.result["epg_data"] as! [[String: Any]])[0]["name"] as! String == "Second feed")
        // Once the single disk slot belongs to B, stale source-A memory must still win offline.
        parsedCache[sourceA] = (0, parsedCache[sourceA]!.data)
        parsedCache[sourceB] = (0, parsedCache[sourceB]!.data)
        try "0\n\(sourceB)".write(to: metaURL, atomically: true, encoding: .utf8)
        URLSession.shared.sources.removeAll(); URLSession.shared.data = nil
        let offline = CAPPluginCall(""); offline.values = ["xmltv_urls": [sourceA, sourceB], "hash": "wanted"]
        getEpg(offline)
        assert(offline.resolved && !offline.rejected)
        assert((offline.result["epg_data"] as! [[String: Any]])[0]["name"] as! String == "Morning & News")
        print("PASS Swift native parity: plain XML, entities/CDATA/aliases/icons, raw ID, regional/explicit shifts, ordered sources, shared index cache")

        print("PASS Swift: source identity, TTL, same-source offline fallback, corrupt response, prefetch, legacy metadata reset")
    }
'''

KOTLIN_CAPACITOR = r'''
package com.getcapacitor
import java.io.File
class Context(var cacheDir: File, var filesDir: File)
open class Plugin { var context = Context(File("."), File(".")) }
class PluginCall(val source: String) {
    val values = mutableMapOf<String, Any>()
    var result = JSObject()
    var resolved = false
    var rejected = false
    fun getString(key: String): String? = if (key == "xmltv_url") source else values[key] as? String
    fun getArray(key: String): JSArray? = values[key] as? JSArray
    fun getInt(key: String): Int? = values[key] as? Int
    fun resolve(value: JSObject = JSObject()) { resolved = true; result = value }
    fun reject(message: String) { rejected = true }
}
annotation class PluginMethod
class JSObject { val values = mutableMapOf<String, Any>(); fun put(key: String, value: Any) { values[key] = value } }
class JSArray { val values = mutableListOf<Any>(); fun put(value: Any) { values.add(value) }; fun length() = values.size; fun optString(index: Int) = values[index] as? String ?: "" }
'''

KOTLIN_HTTP = r'''
package okhttp3
import java.io.IOException
import java.util.concurrent.TimeUnit
object Fixture { var data: ByteArray? = null; var requests = 0; val sources = mutableMapOf<String, ByteArray>() }
interface Call { fun enqueue(callback: Callback) }
interface Callback {
    fun onFailure(call: Call, e: IOException)
    fun onResponse(call: Call, response: Response)
}
class Body(private val data: ByteArray) { fun bytes(): ByteArray = data }
class Response(val body: Body?) { val isSuccessful = true; val code = 200; fun close() {} }
class Request(val url: String) {
    class Builder { var value = ""; fun url(url: String) = apply { value = url }; fun build() = Request(value) }
}
class OkHttpClient {
    class Builder {
        fun connectTimeout(value: Long, unit: TimeUnit) = this
        fun readTimeout(value: Long, unit: TimeUnit) = this
        fun build() = OkHttpClient()
    }
    fun newCall(request: Request): Call = object: Call {
        override fun enqueue(callback: Callback) {
            Fixture.requests++
            val data = Fixture.sources[request.url] ?: Fixture.data
            if (data == null) callback.onFailure(this, IOException("offline"))
            else callback.onResponse(this, Response(Body(data)))
        }
    }
}
'''

KOTLIN_TESTS = r'''
    fun runCacheTests() {
        val dir = java.nio.file.Files.createTempDirectory("epg-cache-test").toFile()
        context = com.getcapacitor.Context(dir, dir)
        try {
            val a = "https://a.invalid/feed.gz"
            val b = "https://b.invalid/feed.gz"
            val data = java.util.Base64.getDecoder().decode("GZIP_FIXTURE")
            val xml = String(gunzip(data)!!, Charsets.UTF_8)
            writeCache(data, a)
            check(readCache(a) == xml)
            check(readCache(b) == null)
            check(readCache(b, allowStale = true) == null)
            val fresh = PluginCall(a)
            getEpg(fresh)
            check(fresh.resolved && !fresh.rejected && okhttp3.Fixture.requests == 0)
            val other = PluginCall(b)
            getEpg(other)
            check(other.rejected && !other.resolved)
            metaFile.writeText("0\n$a")
            check(readCache(a) == null)
            check(readCache(a, allowStale = true) == xml)
            val stale = PluginCall(a)
            getEpg(stale)
            check(stale.resolved && !stale.rejected)
            okhttp3.Fixture.data = "invalid gzip".toByteArray()
            val invalid = PluginCall(b)
            getEpg(invalid)
            check(invalid.rejected && !invalid.resolved)
            check(readCache(a, allowStale = true) == xml)
            prefetch(PluginCall(b))
            check(readCache(a, allowStale = true) == xml)
            okhttp3.Fixture.data = data
            prefetch(PluginCall(b))
            check(readCache(b) == xml)
            check(readCache(a, allowStale = true) == null)
            metaFile.writeText((System.currentTimeMillis() / 1000).toString())
            check(readCache(b) == null)
            check(readCache(b, allowStale = true) == null)
            okhttp3.Fixture.data = null
            parsedCache.clear() // simulate restart after incompatible disk metadata
            val legacy = PluginCall(b)
            getEpg(legacy)
            check(legacy.rejected && !legacy.resolved)

            val now = (System.currentTimeMillis() / 1000).toInt()
            val format = java.text.SimpleDateFormat("yyyyMMddHHmmss Z").apply { timeZone = java.util.TimeZone.getTimeZone("UTC") }
            val start = format.format(java.util.Date(now.toLong() * 1000))
            val stop = format.format(java.util.Date((now.toLong() + 3600) * 1000))
            val fixture = """<tv><channel id="wanted"><display-name>Original &amp; A</display-name><display-name>Alias</display-name><icon src="https://icons.test/a.png"/></channel><channel id="wrong"><display-name>Private</display-name></channel><programme channel="wanted" start="$start" stop="$stop"><title><![CDATA[Morning & News]]></title><desc>Details</desc></programme></tv>"""
            val parsed = parseXmltv(fixture)
            check(parsed.names["wanted"] == listOf("Original & A", "Alias"))
            check(parsed.icons["wanted"] == "https://icons.test/a.png")
            check(resolveXmltvId(parsed.channels, "Private +4", "wanted", names = parsed.names) == "wanted")
            check(resolveXmltvId(parsed.channels, "Renamed", "", "Alias", parsed.names) == "wanted")
            fun rows(value: JSObject) = (value.values["epg_data"] as JSArray).values.map { it as JSObject }
            val plus = rows(buildSlice(parsed, "42", "Private +4", "wanted", 0, 168))
            check(plus[0].values["time"] == now + 14400)
            check(plus[0].values["name"] == "Morning & News")
            val explicit = rows(buildSlice(parsed, "42", "Private +4", "wanted", -2, 168))
            check(explicit[0].values["time"] == now - 7200)
            val sourceA = "http://custom.test/a.xml"
            val sourceB = "https://custom.test/b.xml"
            okhttp3.Fixture.sources[sourceA] = fixture.toByteArray()
            okhttp3.Fixture.sources[sourceB] = fixture.replace("Morning & News", "Second feed").toByteArray()
            val sources = JSArray().apply { put(sourceA); put(sourceB) }
            val indexCall = PluginCall("").apply { values["xmltv_urls"] = sources }
            getChannels(indexCall)
            check(indexCall.resolved && !indexCall.rejected)
            check((indexCall.result.values["channels"] as JSArray).values.any { (it as JSObject).values["id"] == "wanted" && it.values["icon"] == "https://icons.test/a.png" })
            val requestsBefore = okhttp3.Fixture.requests
            val epgCall = PluginCall("").apply { values["xmltv_urls"] = sources; values["hash"] = "wanted"; values["ch"] = "Private +4" }
            getEpg(epgCall)
            check(epgCall.resolved && okhttp3.Fixture.requests == requestsBefore)
            check(rows(epgCall.result)[0].values["name"] == "Morning & News")
            val secondCall = PluginCall(sourceB).apply { values["hash"] = "wanted" }
            getEpg(secondCall)
            check(rows(secondCall.result)[0].values["name"] == "Second feed")
            parsedCache[sourceA] = Pair(0, parsedCache[sourceA]!!.second)
            parsedCache[sourceB] = Pair(0, parsedCache[sourceB]!!.second)
            metaFile.writeText("0\n$sourceB")
            okhttp3.Fixture.sources.clear(); okhttp3.Fixture.data = null
            val offline = PluginCall("").apply { values["xmltv_urls"] = sources; values["hash"] = "wanted" }
            getEpg(offline)
            check(offline.resolved && !offline.rejected)
            check(rows(offline.result)[0].values["name"] == "Morning & News")
            println("PASS Kotlin native parity: plain XML, entities/CDATA/aliases/icons, raw ID, regional/explicit shifts, ordered sources, shared index cache")

            println("PASS Kotlin: source identity, TTL, same-source offline fallback, corrupt response, prefetch, legacy metadata reset")
        } finally { dir.deleteRecursively() }
    }
'''


def main():
    check_shipping_sources()
    if sys.argv[1:] == ["--check-mirrors-only"]:
        return
    for compiler in ("swift", "kotlinc", "java"):
        if not shutil.which(compiler):
            raise SystemExit(f"Required native test tool is missing: {compiler}")
    with tempfile.TemporaryDirectory(prefix="native-epg-cache-") as directory:
        tmp = pathlib.Path(directory)
        swift = (ROOT / "mobile-xmltv-epg/src/ios/MobileXmltvEpg.swift").read_text()
        swift = swift.replace("import Capacitor", SWIFT_STUBS)
        swift = swift.replace("@objc(MobileXmltvEpg)", "").replace("@objc ", "")
        # Swift's assert autoclosure cannot throw; evaluate the real read first.
        tests = SWIFT_TESTS.replace("GZIP_FIXTURE", GZIP)
        tests = tests.replace("assert(try readCache", "assert(try! readCache")
        swift = swift.replace("    // MARK: - Cache", tests + "\n    // MARK: - Cache")
        swift += "\ntry MobileXmltvEpg().runCacheTests()\n"
        (tmp / "CacheTest.swift").write_text(swift)
        run("swift", "-module-cache-path", str(tmp / "swift-module-cache"), "CacheTest.swift", cwd=tmp)

        kotlin = (ROOT / "mobile-xmltv-epg/src/android/play/ott/foss/plugin/MobileXmltvEpgPlugin.kt").read_text()
        kotlin = kotlin.replace("    // MARK: - Cache", KOTLIN_TESTS.replace("GZIP_FIXTURE", GZIP) + "\n    // MARK: - Cache")
        kotlin += "\nfun main() { MobileXmltvEpgPlugin().runCacheTests() }\n"
        (tmp / "CacheTest.kt").write_text(kotlin)
        (tmp / "Capacitor.kt").write_text(KOTLIN_CAPACITOR)
        (tmp / "Http.kt").write_text(KOTLIN_HTTP)
        (tmp / "Annotation.kt").write_text("package com.getcapacitor.annotation\nannotation class CapacitorPlugin(val name: String)\n")
        run("kotlinc", "CacheTest.kt", "Capacitor.kt", "Http.kt", "Annotation.kt", "-nowarn", "-include-runtime", "-d", "cache-test.jar", cwd=tmp)
        run("java", "-jar", "cache-test.jar", cwd=tmp)


if __name__ == "__main__":
    main()
