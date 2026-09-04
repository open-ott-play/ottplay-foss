# Build Pipeline Audit — Phase 5.3

## 5.3.1 — `vite.config.ts` concat pipeline

**Pipeline** (live in `vite.config.ts` `generateBundle`, formerly `build-concat.cjs`): `tsc → stripModule (drop import/export) → concat (`MODULES` order) → version replace → terser` (no mangle, names readable).

**17 modules concat order**: polyfills → lzstring → storage → localization → settings → helpers → encoding → channels/types → channels → core → ui → keyhandler → provider → commands → app/init → app/device → index.

**~130 window globals** the bundle writes. Groups:
- **Init**: `startPlayer`, `onStbReady`, `restart`
- **Keys**: `onkeydown`, `keyHandler`, `_doKey`, `keys`
- **Playback**: `playType`, `playTime`, `playChannel`, `playMedia`, `_playChannel`, `_playMedia`
- **STB API**: `stbPlay/Stop/Pause/Continue/IsPlaying`, `stbToggleMute`, `stbGet/SetVolume`, `stbGet/SetPosTime`, `stbGetLen`, `stbToFullScreen`, `stbSetWindow`
- **UI**: `showChanelsList`, `showPage`, `closeList`, `changeSelect`, `setSelect`, `showShift`, `showSelectBox`, `infoBox`, `confirmBox`, `updateChanelInfo`, `updateMediaInfo`
- **Settings/storage**: `settings*`, `loadOpt/saveOpt`, `loadAllOptions/saveAllOptions`
- **Provider bridge**: `providerGetItem/SetItem/HasItem/HasItemValue/GetJson`
- **Data**: `channels`, `curList`, `catsArray`, `chanels`, `epgArray/Cache`, `mediaList`, `mediaRecords`, `medHistory`, `medFavorites`, `mediaUrls`
- **Misc**: `version`, `host`, `__host/iid/av/cv`, `ottpStorage`, `stbOptions`, `player`, `TMDb`, `pperf_stamp`, `bufferSizes`

## 5.3.2 — `/stb/*` Device Bundles

**23 device bundles** in repo (all `stb/<vendor>/<vendor>/stb.js` unless noted):

`android` `dune` `e2` `edem` `hbbtv` `hisense` `inext` `lg/netcast` `lg/webos` `mag` `nodejs` `panasonic` `pc` `pc2` `philips` `samsung/tizen` `samsung/maple` `sharp` `skyworth` `sony` `spark` `tcl` `toshiba` `vewd`

Plus **`stb/core.js`** — standalone player impl (`stbPlayers = ["html5","hls.js","shaka"]`, `stbEventToKeyCode`, `str*` labels). Bypasses main concat pipeline. No bundle dep.

**Vercel remote** at `ottplay.dev` unreachable during audit — remote bundle list not confirmed.

**Read/write split** (bundle ↔ device scripts):

| Direction | Payload | Notes |
|-----------|---------|-------|
| Device → bundle | `window.keys` (+ `window.strEXIT/RETURN` for inext; `window.stbInit` for inext) | 21/23 device scripts write zero globals — passive keymaps |
| Bundle → device | All ~130 globals above | Device UI overlays read state |

`core.js` does not call `providerGetItem/SetItem` — only `stb/core.js` uses those at runtime. Device scripts in `stb/` read nothing from `core.js`.

**Key facts**:
- Bundle owns all state, device scripts own keymap only.
- Device → bundle writes: `window.keys` (universal) + `window.stbInit`/`strEXIT`/`strRETURN` (inext only).
- `core.js` is fully self-contained, separate from concat pipeline.
