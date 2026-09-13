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

The test launcher follows LG's
[hosted web app](https://webostv.developer.lge.com/develop/getting-started/web-app-types)
model. It redirects to the built player's server root so automatic detection is
exercised without forcing `/f/lg/webos/`. Prepare it and leave the server running:

```sh
npm run build
node scripts/prepare-webos-simulator.cjs
node tests/helpers/device-browser-server.cjs
```

For a visible snapshot of the actual runtime profile and button configuration,
start the server with `OTTP_DEVICE_TEST_DIAGNOSTICS=1` instead. The test server
adds a read-only badge and logs `Device runtime: {...}` with the actual UA,
adapter, Left/Right/Back codes and Left/Right action indices. It reads no
provider credentials and does not alter the build, settings or detection.
Diagnostics are disabled by default, including in the Chromium CI matrix.

In Simulator, use **File > Launch App** and select
`build/device-webos-simulator`. Alternatively, install the official
[webOS CLI](https://webostv.developer.lge.com/develop/tools/cli-installation)
and launch from another terminal:

```sh
ares-launch -s 26 -sp /absolute/path/to/webOS_TV_26_Simulator_1.5.0 build/device-webos-simulator
```

Set `OTTP_DEVICE_TEST_PORT` to the same value for preparation and server commands
if port 4179 is occupied. The server binds only to `127.0.0.1`, which works for
LG's simulator on the same host. This launcher is for development and is not an
installable product package.

In the [Simulator Inspector](https://webostv.developer.lge.com/develop/tools/simulator-dev-guide),
record `navigator.userAgent`, `ott_device`, `keys.RETURN`, console errors and the
loaded adapter request. Expect `lg/webos`, Back code 461 and
`/stb/lg/webos/stb.js`. On a fresh profile, select a language and use the SDK's
RCU Down, Back and OK buttons to check the first-run screen and language chooser.
During playback, the default Left/Right actions are 14 (volume down) and 13
(volume up), regardless of adapter. Change them in **Settings > Button settings**
if desired; volume control by arrows does not indicate a PC profile.
The manual simulator has ordinary application networking; use a test profile
and explicit test streams when checking playback.

LG's [simulator limitations](https://webostv.developer.lge.com/develop/tools/simulator-introduction)
include different media capabilities and no DRM support. Retain physical TV/STB
acceptance for decoder behavior, stream compatibility, DRM and real remote
events. A successful simulator launch is separate from the automated Chromium
matrix and from physical-device acceptance.
