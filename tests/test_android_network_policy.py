#!/usr/bin/env python3
"""Compile real Android HTTP plugins and test edition policy against a local server.

Reuses the queue test's small Capacitor double without importing/running its test.
Uses Java, kotlinc, SDK36 and ANDROID_JSON_JAR; no app artifact mutation.
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
fun main() {
    val server = ServerSocket(0, 4, InetAddress.getByName("127.0.0.1"))
    val endpoint = "http://127.0.0.1:${server.localPort}/stalker_portal/api/?token=fixture"
    val generic = StalkerPortalPlugin(); val playlist = M3UProxyPlugin()
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
    println("PASS actual Android HTTP plugins: Play rejects HTTP before network with descriptive code; Full native HTTP/M3U retain requests; failure messages omit provider URLs")
}
'''
SDK=Path(os.environ.get('ANDROID_SDK_ROOT',os.environ.get('ANDROID_HOME','/opt/homebrew/share/android-commandlinetools')))/'platforms/android-36/android.jar'
JSON=Path(os.environ['ANDROID_JSON_JAR'])
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
    subprocess.run([shutil.which('kotlinc') or 'kotlinc','-jvm-target','17','-cp',str(classes)+os.pathsep+str(SDK),*map(str,temp.glob('*.kt')),*sources,'-include-runtime','-d',str(temp/'test.jar')],check=True)
    subprocess.run([str(JAVA/'java'),'-cp',os.pathsep.join(map(str,[temp/'test.jar',classes,JSON])),'fixture.MainKt'],check=True,timeout=30)
