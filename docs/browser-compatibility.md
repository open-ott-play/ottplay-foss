# Browser generations and operating systems

The existing device, media, legacy ES5/worker, native UI and Apple native-HLS
checks remain required. The shared TypeScript workflow additionally runs the
Plex scenarios against the exact packaged Mode A archive: two
localized loading/reload flows, HLS.js and Video.js aspect persistence across
media changes/reload, and strict-kiosk natural episode completion with HLS.js.
The media scenarios use real decoding; all scenarios use real DOM/input. Only
Plex data and the media source are synthetic local fixtures.

Pull requests require current Chromium, Firefox and WebKit on Linux, Chromium
on Windows, and WebKit on macOS. Nightly and beta builds require these five targets. RC qualification requires
all 35 declared targets:
three exact Playwright/browser generations on Linux, Windows and macOS plus
installed stable Chrome/Edge on all three systems and beta Chrome/Edge on Linux.
The tested product versions are recorded at runtime. Playwright Firefox is its
patched build, not an assertion about native Firefox ESR; WebKit is not Safari.
This matrix does not replace qualification on physical TVs or native shells.

The full inventory has **35 platform targets: 32 HLS-capable targets and three
Windows WebKit UI-only targets**. The latter still require both localized
loading/reload flows; their WebKit build has neither MediaSource nor native HLS.
This is a declared limitation, not passed playback coverage. The exact three
target IDs are reviewed in `scripts/browser-compatibility-profile.cjs`.
A capability probe must confirm that limitation before their UI tests run. If
MSE (including ManagedMediaSource) or native HLS becomes available, the gate
fails until the profile is upgraded.
Every other target requires both H.264 and AAC MSE support and all five unchanged
scenarios; losing a capability fails instead of selecting a smaller suite.

Consequently, a complete RC requires **166 successful scenario executions**
(32 × 5 + 3 × 2), with 35 target receipts. The PR/nightly/beta subset remains five
targets and 25 scenario executions. Each receipt records its exact scenario set,
capability probe and either passed HLS coverage or the explicit unsupported
reason. These are configured requirements, not a claim that a particular RC has
already completed them. The limitation is confirmed by the
[WebKit Windows build configuration](https://github.com/WebKit/WebKit/blob/56453fdfe0b0ca6258c23e6453b34f70b885d13f/Source/cmake/OptionsWin.cmake#L75)
used by Playwright 1.64 and by the pinned runtime probe.

Both paths download the producing job's exact current-run artifact ID. Archive
checksums, source commit, packaged bundle/provider hashes, file types and paths
are checked before serving a fresh extracted directory. Release checks also
verify the frozen build receipt. Browser jobs do not rebuild the tested code.
They install production dependencies only. The test server still requires the
complete provider inventory from the source; the compiler loads only when an
actual bundle is assembled, not when its inventory constants are read.
Failed, skipped, stale or missing scenario evidence fails the shared gate; traces,
actual runtime identity and candidate digest are retained for each target.

The seven generated inventory/lock files come from
`venus-os-ci-toolkit/scripts/prepare_browser_compatibility.py`. Application
packages and historical browser packages have separate lockfiles. GitHub-hosted
runners remain the default; the shared workflow retains the prepared Linux
reserve selection, while Windows/macOS targets require their native OS.

The shared release verdict verifies every selected target and its source SHA,
run, attempt, channel and exact candidate artifact ID. RC cannot use the five-
target beta evidence. Stable promotion consumes the accepted RC bytes. Re-run
the whole qualification workflow after failure; older attempt receipts cannot
complete a new qualification.
