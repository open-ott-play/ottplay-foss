# XMLTV platform adapters

`src/ios/MobileXmltvEpg.swift` is the only maintained Swift adapter. The iOS
application's Xcode Sources phase references it directly; it is not copied into
the Capacitor-generated Swift package. `cap sync ios` therefore cannot recreate
or overwrite a second implementation.

`src/android/play/ott/foss/plugin/MobileXmltvEpgPlugin.kt` is the canonical
archived Capacitor Android fixture. The JVM cache and edition tests compile it
directly. The active native Android application lives in `ottplay-android`.

Run `python3 tests/test_native_epg_cache.py --check-sources-only` from the
repository root to verify ownership. The full command compiles and exercises
both adapters. Its old `--check-mirrors-only` spelling remains an alias for
existing external callers.

Guide matching, timestamp conversion, regional shifts and schedule windows
delegate to the pinned `vendor/ottplay-core.*` distribution. Swift executes the
same ES5 artifact as the browser and Rust through system JavaScriptCore; the
archived Android adapter links the JVM artifact. Native XML, HTTP, gzip, source
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

The Xcode target bundles the core script, source receipt and license directly
from `vendor`. Its Swift bridge verifies the script hash before execution; data
is passed through JSValue calls, never interpolated into code. JVM fixtures
require JDK 17+ and Kotlin 2.4.20+.

To update, build the canonical shared-core source and run its distribution tool
with `install-native` and this checkout path. Do not maintain native copies of
the displaced algorithms. The workspace guard rejects their reintroduction.
