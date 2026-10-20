"""Run shipped mobile metadata loops with controlled reads and the real work gate."""
from pathlib import Path
import argparse
import os
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


def function(source, marker):
    start = source.index(marker)
    opening = source.index("{", start)
    depth = 1
    end = opening + 1
    while depth:
        depth += (source[end] == "{") - (source[end] == "}")
        end += 1
    return source[start:end]


class MobileMetadataStandby(unittest.TestCase):
    def test_android_read_boundaries_and_publication(self):
        folder = ROOT / "android/app/src/main/java/play/ott/foss"
        source = (folder / "LocalMediaPlugin.kt").read_text()
        methods = "\n".join(function(source, marker) for marker in (
            "private fun readMetadata(", "private fun metadata(",
            "private fun sourceMetadata(", "private fun resolveSnapshot(",
        ))
        import_methods = "\n".join(function(source, marker) for marker in (
            "private fun releaseUnusedGrant(", "private fun selected(",
        ))
        access_method = function(source, "fun requestAccess(")
        code = r'''
import java.io.IOException
import play.ott.foss.NativeWork
object Probe { var reads = 0; var cancel = false; var fail = false }
class JSONObject(val raw: String, val grant: String = raw) {
  fun optString(key: String) = if (key == "grantUri") grant else raw
  fun getString(key: String) = optString(key)
}
class PluginCall(val requested: String? = null) {
  var replies = 0; var errors = 0
  fun getString(key: String) = requested
  fun resolve(value: Any) { replies++ }
  fun reject(value: String) { errors++ }
}
class File(val name: String = "") {
  fun listFiles() = arrayOf(File("a.json"), File("b.json"), File("c.json"))
  fun readText(): String {
    Probe.reads++
    if (Probe.reads == 1 && Probe.cancel) {
      NativeWork.setStandby(true)
      check(NativeWork.snapshot().pending == 1)
    }
    if (Probe.reads == 1 && Probe.fail) throw IOException("unreadable")
    return name
  }
}
class Harness(val ticket: NativeWork.Ticket) {
  val directory = File()
  val sourceDirectory = File()
  val currentWork = ThreadLocal<NativeWork.Ticket>().apply { set(ticket) }
  fun checkWork() = ticket.check()
  fun privateFile(file: File) = true
  fun validId(id: String) = true
  fun snapshot(): Int { NativeWork.setStandby(true); return 1 }
''' + methods + r'''
  fun run(sources: Boolean) = if (sources) sourceMetadata() else metadata()
  fun publish(call: PluginCall) = resolveSnapshot(call)
}
data class Uri(val value: String) {
  override fun toString() = value
  companion object { fun parse(value: String) = Uri(value) }
}
object Intent { const val FLAG_GRANT_READ_URI_PERMISSION = 1 }
object Activity { const val RESULT_OK = 1 }
class ClipItem(val uri: Uri)
class ClipData {
  val itemCount = 0
  fun getItemAt(index: Int) = ClipItem(Uri("unused"))
}
class PickData(val data: Uri) { val clipData: ClipData? = null }
class ActivityResult(val resultCode: Int, val data: PickData)
class Resolver {
  val released = mutableListOf<String>()
  fun releasePersistableUriPermission(uri: Uri, flags: Int) { released.add(uri.toString()) }
}
class Context { val contentResolver = Resolver() }
class ImportHarness(val ticket: NativeWork.Ticket, val rows: List<JSONObject>, val cancelAt: String) {
  var picking = true
  var reads = 0
  val context = Context()
  fun checkWork() = ticket.check()
  fun submit(call: PluginCall, action: () -> Unit) { action() }
  fun metadata(): List<JSONObject> { checkWork(); reads++; return rows }
  fun grant(uri: Uri) {
    if (cancelAt == "grant") NativeWork.setStandby(true)
  }
  fun link(uri: Uri, grant: Uri, known: MutableSet<String>): Boolean {
    checkWork()
    known.add(uri.toString()) // Model a successful publication before cancellation.
    if (cancelAt == "published") NativeWork.setStandby(true)
    return true
  }
  fun saveSource(uri: Uri, name: String, kind: String) { checkWork() }
  fun resolveSnapshot(call: PluginCall) { checkWork(); call.resolve(1) }
''' + import_methods + r'''
  fun pick(call: PluginCall) = selected(call, ActivityResult(Activity.RESULT_OK, PickData(Uri("picked"))))
}
class UiThread {
  var queued = 0
  fun runOnUiThread(action: () -> Unit) { queued++ }
}
class AccessHarness(val ticket: NativeWork.Ticket, val cancelDuringOpen: Boolean = false, val empty: Boolean = false) {
  val activity = UiThread()
  var catalogReads = 0; var sourceReads = 0; var opens = 0
  fun checkWork() = ticket.check()
  fun submit(call: PluginCall, action: () -> Unit) { action() }
  fun metadata(): List<JSONObject> { checkWork(); catalogReads++; return listOf(JSONObject("s1"), JSONObject("s2"), JSONObject("s3")) }
  fun sourceMetadata(): List<JSONObject> {
    checkWork(); sourceReads++
    return if (empty) emptyList() else if (cancelDuringOpen) listOf(JSONObject("s1")) else listOf(JSONObject("s1"), JSONObject("s2"), JSONObject("s3"))
  }
  fun sourceId(item: JSONObject) = item.raw
  fun openSource(item: JSONObject): java.io.Closeable {
    checkWork(); opens++
    if (cancelDuringOpen) NativeWork.setStandby(true)
    return java.io.Closeable { }
  }
  fun pick(call: PluginCall, folder: Boolean) {}
''' + access_method + r'''
}
fun main() {
  for (sources in listOf(false, true)) {
    for ((cancel, fail) in listOf(false to false, false to true, true to false, true to true)) {
      NativeWork.setStandby(false)
      val ticket = NativeWork.begin()!!
      val harness = Harness(ticket)
      Probe.reads = 0; Probe.cancel = cancel; Probe.fail = fail
      var cancelled = false
      var count = -1
      try { count = harness.run(sources).size } catch (_: IOException) { cancelled = true }
      check(NativeWork.snapshot().pending == 1)
      check(cancelled == cancel)
      check(Probe.reads == if (cancel) 1 else 3)
      if (!cancel) check(count == if (fail) 2 else 3)
      if (cancel) {
        NativeWork.setStandby(false)
        Probe.reads = 0
        check(runCatching { harness.run(sources) }.isFailure)
        check(Probe.reads == 0) // Wake cannot revive the retired enumeration.
      }
      ticket.finish()
      check(NativeWork.snapshot().pending == 0)
    }
  }
  NativeWork.setStandby(false)
  val emptyOwner = NativeWork.begin()!!
  val emptyAccess = AccessHarness(emptyOwner, empty = true)
  emptyAccess.requestAccess(PluginCall())
  check(emptyAccess.catalogReads == 0 && emptyAccess.opens == 0 && emptyAccess.sourceReads == 1)
  check(emptyAccess.activity.queued == 1)
  emptyOwner.finish()
  NativeWork.setStandby(false)
  val ticket = NativeWork.begin()!!
  val call = PluginCall()
  check(runCatching { Harness(ticket).publish(call) }.isFailure)
  check(call.replies == 0)
  ticket.finish()
  check(NativeWork.snapshot().pending == 0)
  for ((rows, moment, released) in listOf(
    Triple(emptyList<JSONObject>(), "grant", listOf("picked")),
    Triple(listOf(JSONObject("picked")), "grant", emptyList()),
    Triple(listOf(JSONObject("child", "picked")), "grant", emptyList()),
    Triple(emptyList<JSONObject>(), "published", emptyList())
  )) {
    NativeWork.setStandby(false)
    val owner = NativeWork.begin()!!
    val importer = ImportHarness(owner, rows, moment)
    val reply = PluginCall()
    importer.pick(reply)
    check(reply.errors == 1 && reply.replies == 0)
    check(importer.context.contentResolver.released == released)
    check(importer.reads == 1) // Cleanup never starts a cancelled metadata read.
    check(NativeWork.snapshot().pending == 1)
    owner.finish()
    check(NativeWork.snapshot().pending == 0)
  }
  for (requested in listOf(null, "s3")) {
    NativeWork.setStandby(false)
    val owner = NativeWork.begin()!!
    val access = AccessHarness(owner)
    access.requestAccess(PluginCall(requested))
    check(access.catalogReads == if (requested == null) 1 else 0)
    check(access.sourceReads == 1 && access.activity.queued == 1)
    check(access.opens == if (requested == null) 3 else 0)
    owner.finish()
  }
  NativeWork.setStandby(false)
  val accessOwner = NativeWork.begin()!!
  val cancelledAccess = AccessHarness(accessOwner, true)
  check(runCatching { cancelledAccess.requestAccess(PluginCall()) }.isFailure)
  check(cancelledAccess.opens == 1 && cancelledAccess.activity.queued == 0)
  check(NativeWork.snapshot().pending == 1)
  accessOwner.finish()
  check(NativeWork.snapshot().pending == 0)
  println("PASS Android metadata: cancel between reads, unreadable files, stale wake, fenced publication")
  println("PASS Android grant cleanup: cancelled import releases only unreferenced grants")
  println("PASS Android access recovery: one catalog snapshot, explicit ID skips it, cancellation prevents UI continuation")
}
'''
        with tempfile.TemporaryDirectory(prefix="ott-mobile-metadata-") as temp:
            temp = Path(temp)
            test = temp / "Metadata.kt"
            test.write_text(code)
            jar = temp / "metadata.jar"
            subprocess.run(["kotlinc", str(folder / "NativeWork.kt"), str(test),
                            "-include-runtime", "-d", str(jar)], check=True, timeout=90)
            java = str(Path(os.environ["JAVA_HOME"]) / "bin/java") if os.environ.get("JAVA_HOME") else "java"
            subprocess.run([java, "-jar", str(jar)], check=True, timeout=15)

    def test_ios_read_boundaries_and_publication(self):
        folder = ROOT / "ios/App/App/Plugins"
        source = (folder / "LocalMedia.swift").read_text()
        methods = "\n".join(function(source, marker) for marker in (
            "private func readMetadata(", "private func sources(", "private func resolveSnapshot(",
        ))
        work = (folder / "NativeBackground.swift").read_text().split("@objc(NativeBackground)", 1)[0].replace("import Capacitor\n", "")
        code = work + r'''
enum Probe { static var reads = 0; static var cancel = false; static var fail = false }
struct Source { var id: String; var name: String }
struct Data {
  let count = 10
  init(contentsOf url: URL) throws {
    Probe.reads += 1
    if Probe.reads == 1 && Probe.cancel {
      NativeWork.shared.setStandby(true)
      assert(NativeWork.shared.snapshot["pending"] as! Int == 1)
    }
    if Probe.reads == 1 && Probe.fail { throw URLError(.cannotOpenFile) }
  }
}
struct JSONDecoder {
  func decode<T>(_ type: T.Type, from data: Data) throws -> T {
    Source(id: "fe074b1e-921f-4c84-b39e-5d37a2cdaede", name: "source") as! T
  }
}
struct FileManager {
  static let `default` = FileManager()
  func contentsOfDirectory(at url: URL, includingPropertiesForKeys: [String]?) throws -> [URL] {
    ["a.source.json", "b.source.json", "c.source.json"].map { url.appendingPathComponent($0) }
  }
}
class CAPPluginCall { var replies = 0; func resolve(_ value: [String: Any]) { replies += 1 } }
final class Harness {
  let currentWork: NativeWork.Ticket?
  init(_ ticket: NativeWork.Ticket) { currentWork = ticket }
  func checkWork() throws { try currentWork!.check() }
  func directory() throws -> URL { URL(fileURLWithPath: "/unused") }
  func regularPrivateFile(_ url: URL, in root: URL) -> Bool { true }
  func snapshot() throws -> [String: Any] { NativeWork.shared.setStandby(true); return [:] }
''' + methods + r'''
  func run() throws -> [Source] { try sources() }
  func publish(_ call: CAPPluginCall) throws { try resolveSnapshot(call) }
}
for (cancel, fail) in [(false, false), (false, true), (true, false), (true, true)] {
  NativeWork.shared.setStandby(false)
  let ticket = NativeWork.shared.begin()!
  let harness = Harness(ticket)
  Probe.reads = 0; Probe.cancel = cancel; Probe.fail = fail
  var cancelled = false
  var count = -1
  do { count = try harness.run().count } catch { cancelled = true }
  assert(NativeWork.shared.snapshot["pending"] as! Int == 1)
  assert(cancelled == cancel)
  assert(Probe.reads == (cancel ? 1 : 3))
  if !cancel { assert(count == (fail ? 2 : 3)) }
  if cancel {
    NativeWork.shared.setStandby(false)
    Probe.reads = 0
    do { _ = try harness.run(); fatalError("Retired enumeration revived") } catch {}
    assert(Probe.reads == 0)
  }
  ticket.finish()
  assert(NativeWork.shared.snapshot["pending"] as! Int == 0)
}
NativeWork.shared.setStandby(false)
let ticket = NativeWork.shared.begin()!
let call = CAPPluginCall()
do { try Harness(ticket).publish(call); fatalError("Late publication") } catch {}
assert(call.replies == 0)
ticket.finish()
assert(NativeWork.shared.snapshot["pending"] as! Int == 0)
print("PASS iOS metadata: cancel between reads, unreadable files, stale wake, fenced publication")
'''
        with tempfile.TemporaryDirectory(prefix="ott-mobile-metadata-") as temp:
            temp = Path(temp)
            test = temp / "Metadata.swift"
            test.write_text(code)
            binary = temp / "metadata"
            subprocess.run(["swiftc", "-swift-version", "5", str(test), "-o", str(binary)],
                           check=True, timeout=90)
            subprocess.run([str(binary)], check=True, timeout=15)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--platform", choices=("all", "android", "ios"), default="all")
    args = parser.parse_args()
    names = {
        "android": "test_android_read_boundaries_and_publication",
        "ios": "test_ios_read_boundaries_and_publication",
    }
    suite = unittest.TestSuite(
        MobileMetadataStandby(method)
        for platform, method in names.items()
        if args.platform in ("all", platform)
    )
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    raise SystemExit(not result.wasSuccessful())
