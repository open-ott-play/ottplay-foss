#!/usr/bin/env python3
"""Execute the shipped queue on JVM with real coroutines, Android JSON and sockets.

Requires kotlinc, Java, Android SDK 36, and ANDROID_JSON_JAR pointing to the AOSP JSON artifact
com.vaadin.external.google:android-json:0.0.20131108.vaadin1. KOTLIN_HOME may select
the Kotlin installation; it must contain lib/kotlinx-coroutines-core-jvm.jar.
Android/Capacitor lifecycle dispatch is replaced by small JVM test doubles.

Portable CI setup (after Java 21 and Android SDK setup):
  curl -fsSL https://github.com/JetBrains/kotlin/releases/download/v2.3.0/kotlin-compiler-2.3.0.zip -o /tmp/kotlin.zip
  unzip -q /tmp/kotlin.zip -d /tmp/ott-queue-kotlin
  curl -fsSL https://repo.maven.apache.org/maven2/com/vaadin/external/google/android-json/0.0.20131108.vaadin1/android-json-0.0.20131108.vaadin1.jar -o /tmp/android-json.jar
  PATH=/tmp/ott-queue-kotlin/kotlinc/bin:$PATH ANDROID_JSON_JAR=/tmp/android-json.jar python3 tests/test_android_queue.py
The test respects JAVA_HOME and ANDROID_SDK_ROOT (or ANDROID_HOME), and leaves
the SDK, project sources and existing app build outputs unchanged.
"""
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
JSON_JAR = Path(os.environ["ANDROID_JSON_JAR"]).resolve()
KOTLINC = Path(shutil.which("kotlinc") or "kotlinc").resolve()
KOTLIN_HOME = Path(os.environ.get("KOTLIN_HOME", KOTLINC.parent.parent))
if (KOTLIN_HOME / "libexec").is_dir():
    KOTLIN_HOME /= "libexec"
COROUTINES = KOTLIN_HOME / "lib/kotlinx-coroutines-core-jvm.jar"
ANDROID_SDK = Path(os.environ.get("ANDROID_SDK_ROOT", os.environ.get("ANDROID_HOME", "/opt/homebrew/share/android-commandlinetools")))
ANDROID_API = ANDROID_SDK / "platforms/android-36/android.jar"
assert JSON_JAR.is_file(), JSON_JAR
assert COROUTINES.is_file(), COROUTINES
assert ANDROID_API.is_file(), ANDROID_API

CAPACITOR = r'''
package com.getcapacitor
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
class Activity { fun runOnUiThread(action: Runnable) { action.run() } }
class Bridge { val activity = Activity() }
open class Plugin {
    val bridge = Bridge()
    open fun load() {}
    open fun handleOnDestroy() {}
    fun notifyListeners(event: String, data: JSObject) {}
}
class PluginCall(val data: JSObject = JSObject()) {
    val done = CountDownLatch(1)
    var result = JSObject()
    var error: String? = null
    fun getString(key: String): String? = if (data.has(key)) data.getString(key) else null
    fun resolve(value: JSObject = JSObject()) { result = value; done.countDown() }
    fun reject(value: String) { error = value; done.countDown() }
    fun await(): JSObject {
        check(done.await(5, TimeUnit.SECONDS)) { "Plugin promise did not settle" }
        check(error == null) { error!! }
        return result
    }
}
annotation class PluginMethod
'''

MAIN = r'''
package fixture
import com.getcapacitor.*
import kotlinx.coroutines.*
import kotlinx.coroutines.internal.MainDispatcherFactory
import kotlin.coroutines.CoroutineContext
import play.ott.foss.MobileCommandQueuePlugin
import java.net.*

@OptIn(InternalCoroutinesApi::class)
class ImmediateMainFactory : MainDispatcherFactory {
    override val loadPriority = Int.MAX_VALUE
    override fun createDispatcher(allFactories: List<MainDispatcherFactory>): MainCoroutineDispatcher =
        object : MainCoroutineDispatcher() {
            override val immediate: MainCoroutineDispatcher get() = this
            override fun isDispatchNeeded(context: CoroutineContext) = false
            override fun dispatch(context: CoroutineContext, block: Runnable) { block.run() }
        }
    override fun hintOnError() = "JVM queue test dispatcher"
}

private fun job(plugin: MobileCommandQueuePlugin): Job {
    val field = plugin.javaClass.getDeclaredField("scope").apply { isAccessible = true }
    return (field.get(plugin) as CoroutineScope).coroutineContext[Job]!!
}

fun main() = runBlocking {
    val port = System.getenv("OTTPLAY_QUEUE_PORT")!!.toInt()
    val plugin = MobileCommandQueuePlugin()
    plugin.load()
    withTimeout(5000) {
        while (true) {
            val call = PluginCall(); plugin.isRunning(call)
            if (call.await().getBoolean("running")) break
            delay(10)
        }
    }
    // Send a real loopback request and drain it through the native plugin API.
    val body = """{"type":"popup_message","text":"Hello queue"}"""
    val connection = URL("http://127.0.0.1:$port/api/webhook/commands").openConnection() as HttpURLConnection
    connection.requestMethod = "POST"
    connection.connectTimeout = 3000; connection.readTimeout = 3000
    connection.doOutput = true
    connection.setRequestProperty("Content-Type", "application/json")
    connection.outputStream.use { it.write(body.toByteArray()) }
    check(connection.responseCode == 200)
    connection.inputStream.use { it.readBytes() }; connection.disconnect()
    val getCall = PluginCall(); plugin.get(getCall)
    val result = getCall.await()
    val encoded = result.toString()
    val commands = org.json.JSONObject(encoded).getJSONArray("commands")
    check(commands.length() == 1)
    check(commands.getJSONObject(0).getString("text") == "Hello queue")
    check(result.get("commands") is JSArray)
    val emptyCall = PluginCall(); plugin.get(emptyCall)
    check(emptyCall.await().getJSONArray("commands").length() == 0)
    // The old Android JSONObject/raw Java array path produces a string.
    val rawArray = JSObject().put("commands", arrayOf(JSObject().put("type", "old")))
    check(org.json.JSONObject(rawArray.toString()).get("commands") is String)

    // An idle client blocks readLine, which coroutine cancellation cannot interrupt.
    val idleClient = Socket("127.0.0.1", port)
    val clientsField = plugin.javaClass.getDeclaredField("activeClients").apply { isAccessible = true }
    withTimeout(5000) {
        while ((clientsField.get(plugin) as Set<*>).isEmpty()) delay(10)
    }
    val runningJob = job(plugin)
    plugin.handleOnDestroy()
    withTimeout(5000) { runningJob.join() }
    check(!runningJob.isActive)
    idleClient.soTimeout = 1000
    check(idleClient.getInputStream().read() == -1)
    idleClient.close()
    ServerSocket(port, 50, InetAddress.getByName("127.0.0.1")).close()
    // Destruction can also race with the asynchronous initial bind.
    repeat(20) {
        val transient = MobileCommandQueuePlugin()
        val transientJob = job(transient)
        transient.load(); transient.handleOnDestroy()
        withTimeout(5000) { transientJob.join() }
        ServerSocket(port, 50, InetAddress.getByName("127.0.0.1")).close()
    }
    println("PASS Android queue: real loopback POST/native JSON drain, empty array, cancellation closes accept/idle clients/racing bind, port reusable")
}
'''

with tempfile.TemporaryDirectory(prefix="ott-android-queue-") as directory:
    temp = Path(directory)
    classes = temp / "classes"
    classes.mkdir()
    java_sources = []
    cap_src = ROOT / "node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor"
    for name in ["JSObject", "JSArray"]:
        target = temp / f"{name}.java"
        target.write_text((cap_src / f"{name}.java").read_text())
        java_sources.append(target)
    nullable = temp / "Nullable.java"
    nullable.write_text("package androidx.annotation; public @interface Nullable {}")
    java_sources.append(nullable)
    java_bin = Path(os.environ["JAVA_HOME"]) / "bin" if os.environ.get("JAVA_HOME") else Path("/usr/bin")
    subprocess.run([str(java_bin / "javac"), "--release", "17", "-cp", str(ANDROID_API), "-d", str(classes), *map(str, java_sources)], check=True)
    sources = {
        "Capacitor.kt": CAPACITOR,
        "Log.kt": "package android.util\nobject Log { fun d(tag: String, msg: String)=0; fun w(tag: String, msg: String)=0; fun e(tag: String, msg: String)=0 }",
        "Annotation.kt": 'package com.getcapacitor.annotation\nannotation class CapacitorPlugin(val name: String)',
        "Main.kt": MAIN,
    }
    for name, source in sources.items():
        (temp / name).write_text(source)
    service = classes / "META-INF/services/kotlinx.coroutines.internal.MainDispatcherFactory"
    service.parent.mkdir(parents=True)
    service.write_text("fixture.ImmediateMainFactory")
    jar = temp / "queue.jar"
    classpath = os.pathsep.join(map(str, [classes, JSON_JAR, COROUTINES]))
    # Compile against the real modern Android API (including Iterator<String>),
    # then use AOSP's executable JSON implementation instead of SDK stubs at runtime.
    compile_classpath = os.pathsep.join(map(str, [classes, ANDROID_API, COROUTINES]))
    subprocess.run([str(KOTLINC), "-jvm-target", "17", "-cp", compile_classpath,
        *map(str, temp.glob("*.kt")), str(ROOT / "android/app/src/main/java/play/ott/foss/MobileCommandQueuePlugin.kt"),
        "-include-runtime", "-d", str(jar)], check=True)
    with socket.socket() as port_probe:
        port_probe.bind(("127.0.0.1", 0))
        port = port_probe.getsockname()[1]
    subprocess.run([str(java_bin / "java"), "-cp", str(jar) + os.pathsep + classpath, "fixture.MainKt"],
        env={**os.environ, "OTTPLAY_QUEUE_PORT": str(port)}, check=True, timeout=30)
