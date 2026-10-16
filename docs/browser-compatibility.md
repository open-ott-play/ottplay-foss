# Browser generations and operating systems

The existing device, media, legacy ES5/worker, native UI and Apple native-HLS
checks remain required. The shared TypeScript workflow additionally runs the
same five Plex scenarios against the exact packaged Mode A archive: two
localized loading/reload flows, HLS.js and Video.js aspect persistence across
media changes/reload, and strict-kiosk natural episode completion with HLS.js.
These scenarios use real decoding and real DOM/input; only Plex data and the
media source are synthetic local fixtures.

Pull requests require current Chromium, Firefox and WebKit on Linux, Chromium
on Windows, and WebKit on macOS. Release builds require all 35 declared targets:
three exact Playwright/browser generations on Linux, Windows and macOS plus
installed stable Chrome/Edge on all three systems and beta Chrome/Edge on Linux.
The tested product versions are recorded at runtime. Playwright Firefox is its
patched build, not an assertion about native Firefox ESR; WebKit is not Safari.
This matrix does not replace qualification on physical TVs or native shells.

Both paths download the producing job's exact current-run artifact ID. Archive
checksums, source commit, packaged bundle/provider hashes, file types and paths
are checked before serving a fresh extracted directory. Release checks also
verify the frozen build receipt. Browser jobs do not rebuild the tested code.
Failed, skipped, stale or missing scenario evidence fails the shared gate; traces,
actual runtime identity and candidate digest are retained for each target.

The seven generated inventory/lock files come from
`venus-os-ci-toolkit/scripts/prepare_browser_compatibility.py`. Application
packages and historical browser packages have separate lockfiles. GitHub-hosted
runners remain the default; the shared workflow retains the prepared Linux
reserve selection, while Windows/macOS targets require their native OS.
