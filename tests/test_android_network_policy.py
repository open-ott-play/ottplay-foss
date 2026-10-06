#!/usr/bin/env python3
"""Compile real Android HTTP plugins and test edition policy against a local server.

Reuses the queue test's small Capacitor double without importing/running its test.
Uses Java, kotlinc, SDK36, ANDROID_JSON_JAR and ANDROID_HTTP_CLASSPATH
(real OkHttp/Okio jars); no app artifact mutation.
"""
import ast
from pathlib import Path
import os
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
module=ast.parse((ROOT/'tests/test_android_queue.py').read_text())
CAP=next(ast.literal_eval(node.value) for node in module.body if isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='CAPACITOR' for t in node.targets))
CAP=CAP.replace('    var error: String? = null','    var error: String? = null\n    var code: String? = null')
CAP=CAP.replace('    fun getString(key: String): String?', '    fun getInt(key: String): Int? = if (data.has(key)) data.getInt(key) else null\n    fun getObject(key: String): JSObject? = data.optJSONObject(key)?.let { JSObject.fromJSONObject(it) }\n    fun getString(key: String): String?')
CAP=CAP.replace('fun reject(value: String) { error = value; done.countDown() }','fun reject(value: String, errorCode: String? = null) { error = value; code = errorCode; done.countDown() }')
MAIN=r'''
package fixture
import com.getcapacitor.*
import play.ott.foss.*
import java.net.*
import java.util.concurrent.*
fun wait(call: PluginCall) { check(call.done.await(5, TimeUnit.SECONDS)); }
fun screenshotTransport() {
    BuildConfig.FLAVOR = "full"
    val plugin = StalkerPortalPlugin()
    fun shot(url: String, id: String = "shot_test", body: String = "{}", headers: JSObject = JSObject().put("Authorization", "Bearer fixture")): PluginCall {
        val call = PluginCall(JSObject().put("url", url).put("requestId", id).put("body", body)
            .put("method", "POST").put("headers", headers).put("timeoutMs", 2000).put("screenshotControl", true))
        plugin.httpRequest(call); return call
    }
    fun readRequest(socket: Socket): String {
        val input = socket.getInputStream().bufferedReader()
        val headers = StringBuilder()
        var length = 0
        while (true) {
            val line = input.readLine() ?: error("missing request")
            if (line.isEmpty()) break
            headers.append(line).append('\n')
            if (line.startsWith("Content-Length:", true)) length = line.substringAfter(':').trim().toInt()
        }
        repeat(length) { check(input.read() >= 0) }
        return headers.toString()
    }
    fun exchange(response: ByteArray): Pair<PluginCall, String> {
        val server = ServerSocket(0, 4, InetAddress.getByName("127.0.0.1"))
        var request = ""
        val worker = Thread {
            server.soTimeout = 4000
            server.accept().use { socket ->
                request = readRequest(socket)
                try { socket.getOutputStream().write(response) } catch (_: java.io.IOException) { }
            }
        }.apply { start() }
        val call = shot("http://127.0.0.1:${server.localPort}/api/responses")
        wait(call); worker.join(5000); server.close(); check(!worker.isAlive)
        return call to request
    }
    val cookieManager = CookieManager()
    CookieHandler.setDefault(cookieManager)
    cookieManager.cookieStore.add(URI("http://127.0.0.1"), HttpCookie("private", "must-not-send"))
    val (ok, request) = exchange("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nSet-Cookie: private=secret\r\nConnection: close\r\n\r\n{}".toByteArray())
    check(ok.error == null && ok.result.getInt("status") == 200)
    check(request.contains("Authorization: Bearer fixture"))
    check(!request.lines().any { it.startsWith("Cookie:", true) })
    check(!ok.result.getString("headers")!!.contains("Cookie", true))
    CookieHandler.setDefault(null)
    for (url in listOf("http://192.168.1.1/api/responses", "http://127.1/api/responses", "http://localhost.example/api/responses", "https://user:secret@controller.example/api/responses")) {
        val bad = shot(url); wait(bad); check(bad.code == "invalid_request")
    }
    for (headers in listOf(JSObject().put("Cookie", "private=value"), JSObject().put("Authorization", "Bearer x\r\nX-Bad: y"))) {
        val bad = shot("https://controller.example/api/responses", headers = headers); wait(bad); check(bad.code == "invalid_request")
    }
    val largeUpload = shot("https://controller.example/api/responses", body = "я".repeat(1048577))
    wait(largeUpload); check(largeUpload.code == "invalid_request")
    val receiver = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))
    val (redirect, _) = exchange("HTTP/1.1 307 Temporary Redirect\r\nLocation: http://127.0.0.1:${receiver.localPort}/target\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray())
    check(redirect.error != null)
    receiver.soTimeout = 200
    try { receiver.accept(); error("Screenshot redirect followed") } catch (_: SocketTimeoutException) { }
    receiver.close()
    val (large, _) = exchange("HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n".toByteArray() + ByteArray(2097153) { 65 })
    check(large.error != null)
    val (utf8, _) = exchange("HTTP/1.1 200 OK\r\nContent-Length: 1\r\nConnection: close\r\n\r\n".toByteArray() + byteArrayOf(-1))
    check(utf8.error != null)
    println("PASS screenshot HTTP lane: exact-loopback/HTTPS, no global cookies, header/upload/streaming bounds, no redirected destination request")

    val held = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))
    val started = CountDownLatch(1)
    val release = CountDownLatch(1)
    val worker = Thread {
        held.accept().use { socket ->
            readRequest(socket)
            socket.getOutputStream().write("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n".toByteArray())
            started.countDown(); release.await(5, TimeUnit.SECONDS)
        }
    }.apply { start() }
    val pending = shot("http://127.0.0.1:${held.localPort}/api/responses", "cancel_this")
    check(started.await(5, TimeUnit.SECONDS))
    val duplicate = shot("http://127.0.0.1:${held.localPort}/api/responses", "cancel_this")
    wait(duplicate); check(duplicate.code == "busy")
    val cancel = PluginCall(JSObject().put("requestId", "cancel_this"))
    plugin.cancelHttpRequest(cancel); wait(cancel); wait(pending)
    check(cancel.result.getBoolean("cancelled") && pending.error != null)
    release.countDown(); worker.join(5000); held.close(); check(!worker.isAlive)
    val again = PluginCall(JSObject().put("requestId", "cancel_this"))
    plugin.cancelHttpRequest(again); wait(again); check(!again.result.getBoolean("cancelled"))
    plugin.handleOnDestroy()
    val destroyed = shot("https://controller.example/api/responses")
    wait(destroyed); check(destroyed.code == "busy")
    println("PASS screenshot HTTP lane: requestId ownership, active socket cancellation and destroyed-owner rejection")
    // OkHttp's dispatcher is idle but has a keepalive thread; release it so this
    // standalone JVM regression does not wait a minute after all assertions pass.
    val clientField = plugin.javaClass.getDeclaredField("swopClient").apply { isAccessible = true }
    val client = clientField.get(plugin) as okhttp3.OkHttpClient
    client.dispatcher.executorService.shutdown()
    client.connectionPool.evictAll()
}
fun main() {
    val server = ServerSocket(0, 4, InetAddress.getByName("127.0.0.1"))
    val endpoint = "http://127.0.0.1:${server.localPort}/stalker_portal/api/?token=fixture"
    val generic = StalkerPortalPlugin(); val playlist = M3UProxyPlugin()
    for (flavor in listOf("play", "full")) {
        BuildConfig.FLAVOR = flavor
        for (url in listOf("http://127.0.0.1:${server.localPort}/swop/session", "https://user:secret@relay.example/swop/val", "https://relay.example/swop/val?token=secret", "https://relay.example/x/../swop/val")) {
            val swop = PluginCall(JSObject().put("url", url).put("body", "{}").put("clientId", "device"))
            generic.swopRequest(swop); wait(swop)
            check(swop.error == "Native remote text entry request failed")
        }
    }
    BuildConfig.FLAVOR = "play"
    val portal = PluginCall(JSObject().put("url",endpoint)); generic.portalRequest(portal); wait(portal)
    val http = PluginCall(JSObject().put("url",endpoint)); generic.httpRequest(http); wait(http)
    val m3u = PluginCall(JSObject().put("url","@$endpoint")); playlist.proxyFetch(m3u); wait(m3u)
    for (call in listOf(portal,http,m3u)) {
        check(call.code == "https_required")
        check(call.error!!.contains("HTTPS") && !call.error!!.contains(endpoint))
    }
    server.soTimeout=150
    try { server.accept(); error("Play attempted plaintext network before rejection") } catch (_: SocketTimeoutException) {}
    BuildConfig.FLAVOR = "full"
    val worker = Thread {
        repeat(2) {
            server.soTimeout=4000
            server.accept().use { socket ->
                val input=socket.getInputStream().bufferedReader()
                while (input.readLine().orEmpty().isNotEmpty()) {}
                socket.getOutputStream().write("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{}".toByteArray())
            }
        }
    }.apply { start() }
    val fullHttp = PluginCall(JSObject().put("url",endpoint)); generic.httpRequest(fullHttp); wait(fullHttp)
    check(fullHttp.error == null && fullHttp.result.getInt("status")==200)
    val fullM3u = PluginCall(JSObject().put("url",endpoint)); playlist.proxyFetch(fullM3u); wait(fullM3u)
    check(fullM3u.error == null && fullM3u.result.getString("body")=="{}")
    worker.join(5000); server.close(); check(!worker.isAlive)
    val failure = PluginCall(JSObject().put("url",endpoint)); generic.httpRequest(failure); wait(failure)
    check(failure.error != null && !failure.error!!.contains("token") && !failure.error!!.contains("127.0.0.1"))
    println("PASS actual Android HTTP plugins: SWOP refuses plaintext/credentials/query/normalized paths in both editions; Play rejects HTTP before network; Full native HTTP/M3U retain requests; errors omit provider URLs")
    screenshotTransport()
}
'''
SDK=Path(os.environ.get('ANDROID_SDK_ROOT',os.environ.get('ANDROID_HOME','/opt/homebrew/share/android-commandlinetools')))/'platforms/android-36/android.jar'
JSON=Path(os.environ['ANDROID_JSON_JAR'])
HTTP_JARS=[Path(p) for p in os.environ['ANDROID_HTTP_CLASSPATH'].split(os.pathsep)]
assert HTTP_JARS and all(p.is_file() for p in HTTP_JARS), 'Real OkHttp and Okio jars are required'
JAVA=Path(os.environ['JAVA_HOME'])/'bin' if os.environ.get('JAVA_HOME') else Path('/usr/bin')
with tempfile.TemporaryDirectory(prefix='ott-http-policy-') as directory:
    temp=Path(directory); classes=temp/'classes';classes.mkdir()
    files=[]
    for name in ['JSObject','JSArray']:
        path=temp/(name+'.java'); path.write_text((ROOT/f'node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/{name}.java').read_text());files.append(str(path))
    annotation=temp/'Nullable.java'; annotation.write_text('package androidx.annotation; public @interface Nullable {}');files.append(str(annotation))
    subprocess.run([str(JAVA/'javac'),'--release','17','-cp',str(SDK),'-d',str(classes),*files],check=True)
    (temp/'Capacitor.kt').write_text(CAP)
    (temp/'BuildConfig.kt').write_text('package play.ott.foss\nobject BuildConfig { var FLAVOR = "play" }')
    (temp/'Annotation.kt').write_text('package com.getcapacitor.annotation\nannotation class CapacitorPlugin(val name: String)')
    (temp/'Main.kt').write_text(MAIN)
    sources=[str(ROOT/f'android/app/src/main/java/play/ott/foss/{name}.kt') for name in ['StalkerPortalPlugin','M3UProxyPlugin']]
    subprocess.run([shutil.which('kotlinc') or 'kotlinc','-jvm-target','17','-cp',os.pathsep.join(map(str,[classes,SDK,*HTTP_JARS])),*map(str,temp.glob('*.kt')),*sources,'-include-runtime','-d',str(temp/'test.jar')],check=True)
    subprocess.run([str(JAVA/'java'),'-cp',os.pathsep.join(map(str,[temp/'test.jar',classes,JSON,*HTTP_JARS])),'fixture.MainKt'],check=True,timeout=30)
