#!/usr/bin/env python3
"""Run the production per-scan availability index on the JVM, without a device."""
import pathlib
import shutil
import subprocess
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
CASES = r'''
package play.ott.foss
fun main() {
    val index = LocalMediaAvailability()
    check(!index.anyAvailable())
    check(!index.containsSource("absent"))
    index.update("preferred", "folder", true)
    index.update("preferred", "folder", false)
    check(index.containsSource("folder") && !index.sourceIsAvailable("folder") && !index.anyAvailable())
    index.update("preferred", "moved", true)
    check(!index.containsSource("folder") && index.sourceIsAvailable("moved"))
    // Snapshot indexes rows, including corrupt metadata with duplicate item IDs.
    val snapshot = LocalMediaAvailability()
    snapshot.update("row-0", "same-source", true)
    snapshot.update("row-1", "same-source", false)
    check(snapshot.sourceIsAvailable("same-source"))
    val expected = mutableMapOf<String, Pair<String, Boolean>>("preferred" to ("moved" to true))
    val random = java.util.Random(42)
    repeat(12000) { position ->
        val id = "item-${random.nextInt(2000)}"
        val source = "source-${random.nextInt(40)}"
        val available = random.nextBoolean()
        index.update(id, source, available)
        expected[id] = source to available
        if (position % 97 == 0) {
            check(index.anyAvailable() == expected.values.any { it.second })
            repeat(40) { number ->
                val key = "source-$number"
                check(index.containsSource(key) == expected.values.any { it.first == key })
                check(index.sourceIsAvailable(key) == expected.values.any { it.first == key && it.second })
            }
        }
    }
    // A library of unavailable files is the worst case for the former
    // `items.values.none` performed on each insertion.
    val previousItems = mutableListOf<Boolean>()
    var previousItemVisits = 0L
    repeat(12000) {
        check(previousItems.none { previousItemVisits++; it })
        previousItems.add(false)
    }
    check(previousItemVisits == 71994000L)
    val unavailable = LocalMediaAvailability()
    repeat(12000) {
        unavailable.update("item-$it", "source-$it", false)
        check(!unavailable.anyAvailable())
        check(unavailable.containsSource("source-$it"))
    }
    println("Availability regression passed: 12,000 updates/lookups replace $previousItemVisits measured previous-item visits for first-playability checks")
}
'''
with tempfile.TemporaryDirectory(prefix="ott-local-availability-") as directory:
    temp = pathlib.Path(directory)
    (temp / "Cases.kt").write_text(CASES)
    subprocess.run([shutil.which("kotlinc") or "kotlinc",
                    str(ROOT / "android/app/src/main/java/play/ott/foss/LocalMediaAvailability.kt"),
                    str(temp / "Cases.kt"), "-include-runtime", "-d", str(temp / "cases.jar")], check=True)
    subprocess.run([shutil.which("java") or "java", "-jar", str(temp / "cases.jar")], check=True)
