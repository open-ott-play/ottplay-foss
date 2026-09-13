# Device detection and emulator testing

Device selection happens twice: in `index.html` before the bundle loads, then
in `src/app/device.ts` inside the classic bundle. Both must select the same
`stb/<device>/stb.js`. An explicit `/f/<device>/` path takes precedence over
user-agent and native API signals, including nested `lg/*` and `samsung/*` paths.

## Automated checks

```sh
npm ci --ignore-scripts
npm run test:devices
npm run build
npm run check:bundle
npx playwright install chromium
npm run test:devices:browser
```

On a Linux host that lacks browser dependencies, use
`npx playwright install --with-deps chromium`. CI installs them in the Build job.
The normal `npm test` graph includes the source matrix; `check:bundle` also
executes the actual emitted ES5 detector. The CI inventory checks that both
variants and the browser spec remain reachable from executable workflow steps.

`tests/fixtures/device-detection.json` is shared by VM and browser tests. Each
fixture identifies its source or explicitly says it is synthetic. The NetCast
and webOS examples come from LG documentation; the MAG200 example comes from
the YASEM MAG250/AuraHD emulator profile, not a captured physical STB session.
Add an observed UA and its source here when supporting another device.

The VM checks execute the real boot scripts, detector and adapter, cover every
shipped adapter route, and exercise missing legacy APIs and throwing native
bridge access. Detection must inspect the MAG bridge without invoking it.

Playwright runs the production HTML, classic bundle and staged assets through
a loopback server with the Mode A URL layout. Each fresh browser context checks
the initial boot decision, final device, adapter request, remote codes and real
list navigation through Down, Back and Enter. User-Agent and optional `gSTB`
signals are emulated; HTTP requests outside the test origin and WebSockets are
blocked. No live provider or operator settings are required.

The report is `build/device-browser-report/index.html`. Failed runs retain
screenshots and traces under `build/device-browser-results/`; CI uploads both
directories as `device-browser-failures-<commit>`. For a focused local run:

```sh
npm run test:devices:browser -- --grep 'NetCast|MAG'
npx playwright show-report build/device-browser-report
```

These checks validate detection, loading and the existing adapter key contracts.
Chromium UA emulation does not reproduce a TV's engine version, firmware,
native services, decoder or DRM implementation. ES5 parsing separately protects
the syntax requirements of older engines.

## Official LG webOS TV Simulator

Install the [LG Simulator](https://webostv.developer.lge.com/develop/tools/simulator-installation)
for the desired version and host OS, accepting its SDK agreement separately.
The webOS TV 25 and 26 macOS downloads support ARM64. The SDK is not downloaded
by CI or redistributed in this repository.

Run the hosted app against the existing local stack:

```sh
./scripts/run-webos-simulator.sh
```

The defaults are webOS TV 26 and `http://127.0.0.1:8095/`. The launcher checks
`/health` and the player page, prepares `build/device-webos-simulator`, then
calls LG's `ares-launch`. It does not start another server, deploy a build or
require local `dist/` files. The player uses the build already deployed to the
stack. Port 8090 belongs to the playlist proxy, not the player.

Install the official [webOS CLI](https://webostv.developer.lge.com/develop/tools/cli-installation)
once, for example in a user-owned directory:

```sh
npm install --prefix "$HOME/.local/share/ottplay/webos-cli" @webos-tools/cli
```

The shell launcher checks `WEBOS_CLI`, then `ares-launch` on `PATH`, then that
user-local installation. On the first launch, register the extracted Simulator
SDK directory with the CLI:

```sh
./scripts/run-webos-simulator.sh --sdk "$HOME/Applications/webOS_TV_26_Simulator_1.5.0"
```

The CLI remembers the directory for subsequent launches. Keep the SDK in a
persistent directory, not `/tmp`. The directory passed to `--sdk` contains the
Simulator `.app` on macOS, rather than being the `.app` itself. SDK installation
and acceptance of its agreement remain separate from this script.

Other examples:

```sh
./scripts/run-webos-simulator.sh --version 25 --sdk /path/to/webOS_TV_25_Simulator_1.4.1
./scripts/run-webos-simulator.sh --url http://127.0.0.1:8095/
./scripts/run-webos-simulator.sh --dry-run
./scripts/run-webos-simulator.sh --help
```

`WEBOS_VERSION`, `WEBOS_SDK_PATH`, `WEBOS_CLI` and `OTTP_PLAYER_URL` provide the
same configuration through environment variables. `OTTP_DEVICE_TEST_PORT` is
retained as a loopback URL fallback when `OTTP_PLAYER_URL` is not set. Explicit
`--url` takes precedence. `--dry-run` prepares the app and prints the command
without network checks or SDK execution. No SDK is downloaded automatically.

The launcher follows LG's
[hosted web app](https://webostv.developer.lge.com/develop/getting-started/web-app-types)
model and redirects to the server root by default, preserving automatic device
detection. You can also select `build/device-webos-simulator` through Simulator's
**File > Launch App**. Use **File > Close App**, then launch again if an existing
app has not picked up a changed target. Storage is origin-specific, so switching
ports can require configuring the test playlist again.

For EPG, the existing companion needs current XMLTV data in its configured
`EPG_URLS` sources. A successful `/health` response does not establish EPG
readiness: check actual programme data and the full guide. Using the same
playlist URL in Chrome and Simulator does not guarantee the same EPG backend;
compare the player's origin and its EPG server setting. Deploy the desired
[Mode A package](mode-a-test-bundle.md) to the stack before checking PR changes.

The separate static server used by Chromium tests is only for detection and
button checks. To deliberately run this narrower manual test:

```sh
npm run build
OTTP_DEVICE_TEST_DIAGNOSTICS=1 node tests/helpers/device-browser-server.cjs
# In another terminal: prepare the SDK app, then launch it through File > Launch App.
OTTP_DEVICE_TEST_PORT=4179 node scripts/prepare-webos-simulator.cjs
```

That static server has no companion APIs: matching returns 405 and `/epg/*`
returns 404. The shell launcher's companion health check intentionally rejects
it. Its opt-in read-only badge shows the actual UA, adapter, remote key codes
and shortcut settings, and its diagnostic log includes EPG route classes and
HTTP status codes without playlist bodies, channel identifiers or query strings.
Diagnostics are disabled in the Chromium CI matrix.

In the [Simulator Inspector](https://webostv.developer.lge.com/develop/tools/simulator-dev-guide),
record `navigator.userAgent`, `ott_device`, `keys.RETURN`, console errors and the
loaded adapter request. Expect `lg/webos`, Back code 461 and
`/stb/lg/webos/stb.js`. On a fresh profile, select a language and use the SDK's
RCU Down, Back and OK buttons to check the first-run screen and language chooser.
During playback, LG profiles default Left to action 1 (Menu). A saved Left
assignment takes precedence, including action 14 (volume down); a correct LG
profile alone does not prove its shortcut configuration. Other profiles retain
the existing Left default of 14, and Right remains 13 (volume up). Assignments
can be changed in **Settings > Button settings**.
On webOS, both **STB settings** and **Interface settings** hide the playback
engine selector. Playback chooses native HLS when supported, Shaka for DASH
manifests, and hls.js when native HLS is unavailable or fails the Auto probe.
Previously saved manual engine choices remain stored for use on other platforms,
but webOS runs Auto. NetCast and other platforms keep their existing choices.
This does not guarantee every codec or DRM scheme: see LG's
[streaming specification](https://webostv.developer.lge.com/develop/specifications/streaming-protocol-drm)
and [MSE/Shaka playback sample](https://github.com/webOS-TV-app-samples/MediaPlayback).
The manual simulator has ordinary application networking; use a test profile
and explicit test streams when checking playback.

LG's [simulator limitations](https://webostv.developer.lge.com/develop/tools/simulator-introduction)
include different media capabilities and no DRM support. Retain physical TV/STB
acceptance for decoder behavior, stream compatibility, DRM and real remote
events. A successful simulator launch is separate from the automated Chromium
matrix and from physical-device acceptance.

## Other TV simulators on an Apple Silicon Mac

- **Android TV / Google TV:** Google's [emulator acceleration requirements](https://developer.android.com/studio/run/emulator-acceleration)
  support Apple Silicon, and the [official TV image catalog](https://dl.google.com/android/repository/sys-img/android-tv/sys-img2-3.xml)
  contains Android 36 ARM64 TV images. Install a TV image and create a TV AVD;
  a phone AVD does not cover remote/focus behavior. Access the host stack through
  the emulator's [host alias `10.0.2.2`](https://developer.android.com/studio/run/emulator-networking),
  not its own `127.0.0.1`. A web player launch also needs a browser/hosted shell,
  or use this repository's Android app for native Android testing.
- **Samsung Tizen TV:** the official [emulator requirements](https://developer.samsung.com/smarttv/develop/tools/prerequisites.html)
  specify Intel hardware and VT-x, not Apple Silicon. Use a supported x86 host
  for that emulator. The separate [TV Simulator](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/tv-simulator.html)
  does not support hosted web apps and substitutes dummy video for HLS, so this
  webOS hosted launcher cannot simply be reused.
- **LG NetCast:** the archived [SDK 3.0.1 requirements](https://webostv.developer.lge.com/more/netcast/sdk-v301)
  target old operating systems and VirtualBox 4.1–4.2. Keep its Chromium adapter
  checks here; vendor emulator testing requires a compatible legacy host.
- **MAG and other shipped adapters:** the existing Chromium matrix exercises
  detection and key contracts. It does not emulate device firmware, native
  services or decoders; retain real-device checks for those contracts.
