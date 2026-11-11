# Windows native video geometry acceptance

## Purpose and scope

Issue #1132 describes a first-picture defect at an exact 16:9 window size:
video can occupy a small area at the upper left until the window is resized.
A correct DOM rectangle, a successful `playing` event and an advancing media
clock do not establish that the Windows compositor painted the expected image.

This document describes the implemented native acceptance harness. Its first
qualifying Windows run is still pending and must supply actual native evidence;
this document is not a claim that #1132 has been reproduced or resolved on
affected hardware.

The existing browser geometry matrix decodes real video, but runs in a browser
rather than the packaged Windows Tauri application. The Windows installer job
in `.github/workflows/native-parity.yml` also exercises native window controls,
IPC permissions and aspect-ratio sizing. Its `window_controls_smoke` example
starts with non-16:9 content and does not validate decoded video pixels. Neither
result replaces this acceptance.

## Run the production host

Use the release executable already built by the Windows installer job. Record
its SHA-256 and the exact source commit. Do not substitute an HTML-only window,
a mocked Tauri runtime, a standalone Chromium browser or a different Rust host.
The test must retain the application's normal Tauri/Wry/WebView2 initialization,
window preferences and aspect-lock implementation.

Use a fresh absolute `OTTPLAY_DATA_DIR` and a unique `OTTPLAY_INSTANCE`. Set
`OTTPLAY_WEB_URL` only for the owned test process to a loopback server serving
the exact generated production frontend and deterministic local media fixtures.
Record frontend and media hashes. The isolated fixture uses the normal saved `sInfoSwitch=0` and
`sInfoChange=0` preferences so automatic information overlays do not cover the
video probes. No CSS is injected to hide or resize the media plane. Before the first production script runs, the
owned test server inserts initial M3U settings pointing to its own local fixture
playlist, together with passive media-event recording. It does not replace
production client code or use Demo playback. Keep private profiles, credentials,
discovery and real IPTV servers out of the fixture.

The server holds each case's media bytes until CDP is attached. Before explicitly
admitting that case through the owned loopback endpoint, the driver verifies
that no `loadeddata` or `playing` event has occurred. The first source is the
owned wide clip selected by normal M3U startup. Initial Fit/cold acceptance does
not call `stbStop`, `stbPlay` or `setAspect` to restart or repair that playback.
Portable server tests cover media holding and ownership of the first source;
those tests do not substitute for the native pixel run.

For automation, launch only that process with a temporary
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` value containing
`--remote-debugging-port=<owned-port>`. Microsoft documents this mechanism for
[debugging WebView2 applications](https://learn.microsoft.com/en-us/microsoft-edge/webview2/how-to/debug-visual-studio-code).
Attach Playwright over CDP to the owned WebView2 target and drive existing
production controls or public player functions. Do not replace sizing functions
or inject CSS that repairs the defect. Verify the debugging listener is confined
to loopback and belongs to the owned process tree; do not change machine-wide
registry policy or expose a persistent debugging endpoint.

CDP is a control and diagnostic channel. Its screenshot command is not the
native pixel verdict. Tauri also supports
[native WebDriver on Windows](https://v2.tauri.app/develop/tests/webdriver/),
but introducing that additional driver is not required for this contract.

## Capture the visible native client plane

Resolve a single visible top-level HWND belonging to the launched PID. Obtain
its client rectangle, client-to-screen origin and effective DPI through Win32.
Capture only those physical screen pixels, with the owned window visible,
unminimized, fully on screen and unobscured. Check PID/HWND ownership and client
bounds again around each capture. Reject ambiguous windows or changed ownership.

An OS helper can use `System.Drawing.Graphics.CopyFromScreen`, which performs a
[screen pixel block transfer](https://learn.microsoft.com/en-us/dotnet/api/system.drawing.graphics.copyfromscreen).
The equivalent native path uses a screen DC, a compatible bitmap and
[`BitBlt`](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-bitblt),
then reads pixels with `GetDIBits`. Microsoft's
[image capture example](https://learn.microsoft.com/en-us/windows/win32/gdi/capturing-an-image)
describes the bitmap/DC handling. Check API results and release all acquired DCs,
bitmaps and drawing objects. A screen capture includes whatever is actually in
that screen region; it is not an off-screen render of the application's DOM.

A locked desktop, minimization, another foreground window, a failed capture,
or a black/incomplete video plane cannot be treated as a pass. Preserve the
bounded image and classify the failure as capture infrastructure or product
geometry only when the evidence distinguishes them. Never replace missing
native pixels with a DOM screenshot to make the job green.

If GDI capture cannot observe the composed video plane, evaluate
[Windows Graphics Capture for the owned HWND](https://learn.microsoft.com/en-us/windows/win32/api/windows.graphics.capture.interop/nf-windows-graphics-capture-interop-igraphicscaptureiteminterop-createforwindow).
That is a different capture backend requiring its own capability and pixel
qualification. Do not silently switch or mix its results with GDI results.

## Deterministic video oracle

The committed, locally served MP4 fixtures are `wide` (640×360, 16:9) and
`standard` (480×360, 4:3). Each contains four solid quadrants. Phase B rotates
phase A's palette, so changing quadrant colors are the temporal marker; there
are no separate corner markers or moving patches. Replay the wide clip through
the retained media element, then change to the standard clip. A static poster
or a canvas painted independently of the decoder is insufficient.

Compute expected visible regions from the native client size, fixture intrinsic
size and selected Fit/Fill mode. Check multiple interior patches against the
known quadrant palette, allowing the oracle's declared codec/color tolerance.
Detect missing coverage, a small upper-left picture, wrong quadrant placement
and missing Fit letterboxing. Compare captures against the two different palette
phases and require advancing decoder time/frame counters as supporting evidence.
Because the fixtures have uniform quadrants, the Fill oracle does not distinguish
stretching from a correct centered crop when their quadrant boundaries coincide.
That limitation must not be presented as complete crop/aspect-distortion coverage.

Record DOM geometry, video dimensions, playback events, current time and decoder
counters as diagnostics. They must not decide the pixel verdict. In particular,
an advancing clock with absent or incorrectly positioned pixels fails.

## Required scenarios

Create the target client size before starting playback. Record the actual
physical client size rather than assuming an outer-window or logical size.
At 100% DPI, cover both groups:

- 800×450, 799×450, 801×450, 800×449 and 800×451.
- 1280×720, 1279×720, 1281×720, 1280×719 and 1280×721.

Run the exact 16:9 sizes with aspect lock enabled and disabled. Run the ±1-pixel
controls with lock disabled so they remain genuine non-16:9 boundaries. Exercise
cold playback, same-element replay, changing to the second clip and Fit/Fill.
There are 12 isolated cold process/profile cases: the ten sizes plus the second
lock setting for the two exact ratios. Each case plays wide, wide again and
standard, in both Fit and Fill, with two palette-phase captures per selection:
144 native screenshots in a complete run. The normal instance-specific saved
window-state file is seeded before launch/reveal to establish the starting size.
No post-playback resize, page reload or CSS repair establishes the tested size.
Only initial Fit playback is labeled `cold`. Fill's first selection is labeled
`mode-change`, not cold startup. Subsequent wide replay and standard channel
change use the existing production playback controls. The 144-shot inventory
includes the two palette phases for each of those three selections in each mode.

Capture the initial playback interval on a bounded schedule and record the
settling deadline. Do not resize the window, toggle native fullscreen, open
DevTools or request a browser screenshot before evaluating the initial image.
Those actions can invalidate layout and hide the failure. A subsequent one-pixel
resize may be recorded as a recovery diagnostic, but cannot turn an initial
failed case into a pass. OS fullscreen is a separate control scenario.

The first hosted run qualifies only its actual DPI, OS, WebView2 runtime and
rendering adapter. Extend hardware acceptance to 125% and 150% DPI and an
affected Windows installation; do not relabel a 100% virtual-machine result as
coverage of those environments.

## Workflow integration

`.github/workflows/native-parity.yml` runs the pixel check in the existing
Windows installer job after building the production executable and checking
native window controls. The Python oracle and capture contracts run first with
explicit PowerShell failure propagation. The native driver has a 15-minute step
deadline; the complete installer job allows 60 minutes, retaining its existing
build and installer checks. Native evidence under
`build/windows-video-geometry-report/` is uploaded even on failure, for 14 days.

The manual boolean input `windows_video_geometry_only` defaults to false.
Explicitly enabling it runs that same Windows job and suppresses other platform
jobs; it does not create a second build path. Normal PR/reusable-workflow runs
still execute the native pixel check without an opt-in or silent skip.

## Runner admission, evidence and cleanup

Preflight the active desktop, monitor bounds, DPI, visible owned window and
capture capability before the media matrix. Record OS image, WebView2 version and available rendering-adapter information.
CDP `SystemInfo.getInfo` is best-effort; unavailable information is recorded and
never replaced by a claim of physical-GPU coverage. Use actual video pixels in
capture admission. Lack of a usable desktop
must produce an explicit non-qualifying result, not an empty successful matrix.

Do not assume that a Windows runner has either an interactive desktop or the
same GPU/decoder as a consumer PC. GitHub documents standard Windows runners as
[virtual machines](https://docs.github.com/en/actions/reference/runners/github-hosted-runners);
that does not promise a particular physical GPU. Microsoft documents that
[services run outside an interactive user desktop](https://learn.microsoft.com/en-us/windows/win32/services/debugging-a-service).
Inspect the actual job environment instead of inferring it from a runner label.
A standard hosted runner may provide useful regression coverage, but a successful
software/virtual-adapter run cannot exclude an affected hardware compositor bug.

Retain a bounded JSON receipt with source/binary/frontend/media hashes, PID/HWND,
actual client geometry, DPI, capture backend, per-scenario deadlines and numeric
pixel results. Retain the relevant native images, including failures, under an
explicit byte/count limit. Avoid screenshots of unrelated desktop regions and
any profile or credential data.

Use bounded process and callback deadlines. On every exit path, stop only the
owned player/descendant processes, loopback fixture server and debugging session;
release capture resources and remove the isolated profile. Do not change global
Windows display settings, disable GPU acceleration, or relax production sizing
and media guards to obtain a passing test.
