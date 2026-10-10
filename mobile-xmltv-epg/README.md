# XMLTV platform adapters

`src/ios/MobileXmltvEpg.swift` is the only maintained Swift adapter. The iOS
application's Xcode Sources phase references it directly; it is not copied into
the Capacitor-generated Swift package. `cap sync ios` therefore cannot recreate
or overwrite a second implementation.

`src/android/play/ott/foss/plugin/MobileXmltvEpgPlugin.kt` is the canonical
Capacitor Android adapter. Both Full and API 22 APKs and the JVM cache/edition
tests compile it directly. The independent native Android application lives in
`ottplay-android`.

Run `python3 tests/test_native_epg_cache.py --check-sources-only` from the
repository root to verify ownership. The full command compiles and exercises
both adapters. Its old `--check-mirrors-only` spelling remains an alias for
existing external callers.

Guide matching, timestamp conversion, regional shifts and schedule windows
delegate to the pinned `vendor/ottplay-core.*` distribution. Swift executes the
same ES5 artifact as the browser and Rust through system JavaScriptCore; the
Android adapter links the JVM artifact. Native XML, HTTP, gzip, source
ownership, caching and platform callbacks remain here.

On iOS, XMLTV downloads and cached input are limited to 64 MiB of delivered
bytes. This is the body after any HTTP content decoding, not a wire-size limit.
Gzip expansion is streamed to a temporary file with a separate 512 MiB limit;
`XMLParser` reads that file without a whole-document UTF-8 string conversion.
Oversized or invalid input follows the existing source error and cache fallback
policy. A large plain XML response can therefore be rejected even when the same
document fits as a gzip file. Temporary XML files are removed when loading ends.

These limits bound input and decompression, not the complete parsed programme
graph or all cached sources. Physical-device playback and EPG checks remain
necessary when qualifying a release.

Capacitor Android uses the same 64 MiB delivered-input and 512 MiB expanded-XML
limits. Downloads are spooled to an owned temporary file; SAX parses plain XML
or a bounded gzip stream directly, including cached files. It does not allocate
the complete XML as a byte array or UTF-16 string. Loading validates the gzip
trailer, closes response streams and removes temporary files on success/failure;
the existing same-source fresh/stale cache policy remains in effect. Cache
metadata is limited to 8 KiB. The JVM regression suite exercises a 24 MiB plain
and compressed document with a 64 MiB heap.

The Xcode target bundles the core script, source receipt and license directly
from `vendor`. Its Swift bridge verifies the script hash before execution; data
is passed through JSValue calls, never interpolated into code. JVM fixtures
require JDK 17+ and Kotlin 2.4.20+.

To update, build the canonical shared-core source and run its distribution tool
with `install-native` and this checkout path. Do not maintain native copies of
the displaced algorithms. The workspace guard rejects their reintroduction.
