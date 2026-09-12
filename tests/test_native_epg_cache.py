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
    var resolved = false
    var rejected = false
    init(_ source: String) { self.source = source }
    func getString(_ key: String) -> String? { key == "xmltv_url" ? source : nil }
    func getInt(_ key: String) -> Int? { nil }
    func resolve(_ result: [String: Any] = [:]) { resolved = true }
    func reject(_ message: String) { rejected = true }
}
class URLSession {
    static let shared = URLSession()
    var data: Data?
    var requests = 0
    class Task {
        let action: () -> Void
        init(_ action: @escaping () -> Void) { self.action = action }
        func resume() { action() }
    }
    func dataTask(with url: URL, completionHandler: @escaping (Data?, Any?, Error?) -> Void) -> Task {
        requests += 1
        return Task { completionHandler(self.data, nil, self.data == nil ? NSError(domain: "offline", code: 1) : nil) }
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
        let legacy = CAPPluginCall(b.absoluteString)
        getEpg(legacy)
        assert(legacy.rejected && !legacy.resolved)
        print("PASS Swift: source identity, TTL, same-source offline fallback, corrupt response, prefetch, legacy metadata reset")
    }
'''

KOTLIN_CAPACITOR = r'''
package com.getcapacitor
import java.io.File
class Context(var cacheDir: File, var filesDir: File)
open class Plugin { var context = Context(File("."), File(".")) }
class PluginCall(val source: String) {
    var resolved = false
    var rejected = false
    fun getString(key: String): String? = if (key == "xmltv_url") source else null
    fun getInt(key: String): Int? = null
    fun resolve(value: JSObject = JSObject()) { resolved = true }
    fun reject(message: String) { rejected = true }
}
annotation class PluginMethod
class JSObject { fun put(key: String, value: Any) {} }
class JSArray { fun put(value: Any) {} }
'''

KOTLIN_HTTP = r'''
package okhttp3
import java.io.IOException
import java.util.concurrent.TimeUnit
object Fixture { var data: ByteArray? = null; var requests = 0 }
interface Call { fun enqueue(callback: Callback) }
interface Callback {
    fun onFailure(call: Call, e: IOException)
    fun onResponse(call: Call, response: Response)
}
class Body(private val data: ByteArray) { fun bytes(): ByteArray = data }
class Response(val body: Body?)
class Request {
    class Builder { fun url(url: String) = this; fun build() = Request() }
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
            val data = Fixture.data
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
            val legacy = PluginCall(b)
            getEpg(legacy)
            check(legacy.rejected && !legacy.resolved)
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
