# TODO: Recover legacy behavior for WebOS LG target

> **Sources**:
> - Legacy monolith: `~/victron/home-assistant/stbPlayer/stbPlayer.js` (298KB) + `~/victron/home-assistant/index.html` + `~/victron/home-assistant/stb/<device>/stb.js`
> - Current TS: `~/victron/ottplay-foss/src/` (modular) → builds to `dist/stbPlayer.js` via `build-concat.cjs` (ES5 single file)

---

## START HERE — Ordered implementation sequence

### 1. Device detection & globals (foundation) ✅
**Legacy source**: `index.html:67-91` → `detectDevice()` returns `'lg/webos'`, `'mag'`, `'android'`, `'pc'`, etc.
**TS target**: Create `src/app/device.ts`
- Export `detectDevice(): string` — copy regex logic verbatim from legacy
- Export globals: `host`, `__cv`, `__av`, `__iid`, `dnt`, `ott_device` (from `detectDevice()`)
- `index.html` must set `host = window.location.origin`, `__iid = ""` before loading bundle
- Wire in `src/app/init.ts` (where `initUIReferences` runs)

### 2. loadSTB() dynamic stub loader ✅
**Legacy source**: `index.html:146-155` (`loadSTB` loads `core.js` → `<device>/stb.js` → calls `startPlayer()`)
**TS target**: Add to `src/app/init.ts` or new `src/app/stb-loader.ts`
- After `core.ts` compiles, inject `<script src="${host}/stb/${ott_device}/stb.js?${__cv}">`
- On load → call `startPlayer()`

### 3. Device stubs (WebOS first) ✅
**Legacy source**: `~/victron/home-assistant/stb/<device>/stb.js` (21 devices)
**TS target**: `src/stb/<device>/stb.ts` (compile via build-concat)
- **WebOS**: copy `~/victron/home-assistant/stb/lg/webos/stb.js` → `src/stb/lg/webos/stb.ts` (exact keycodes, `stbInit`, `strEXIT`, `strRETURN`, `strTools`)
- Others: create per device; can share base via `src/stb/common.ts` but each file must export its own `keys` + `stbInit` globally (legacy expects globals, not imports)
- **PC fallback**: minimal stub if no match

### 4. Storage layer (providerGetItem / providerSetItem)
**Legacy source**: `stbPlayer.js:1015-1060` — `stbGetItem`/`stbSetItem` = `ottpStorage.get/set`; `providerGetItem`/`providerSetItem` prefix with `p_pref`
**TS target**: `src/storage/index.ts` (already has `providerGetItem`/`providerSetItem` at L139/L144, L545/L560)
- Ensure they wrap `ottpStorage.get/set` and use `p_pref` prefix
- Export `stbGetItem` = `providerGetItem`, `stbSetItem` = `providerSetItem` globally (attach to `window`)

### 5. Benchy diagnostics (CSS integrity + live reload + telemetry) ✅
**Legacy source**: `stbPlayer.js:514-731`
| fn | lines | purpose |
|---|---|---|
| `client_feedb` | 514 | POST to `/report_feedb` via `PostFeedback` |
| `PostFeedback` | — | AJAX POST (stubbed in `index.html`) |
| `benchy_CSSJS` | 629 | test CSSOM injection, report via `client_feedb` |
| `benchy_CSSJS_LIVE` | 652 | poll `/version/...` every 30s, `eval()` JS, inject CSS |
| `benchy_fixSettings` | 681 | no-op (guard `__iid==="blablabla"`) |
| `fix_mag_favoritesArray` | 694 | migrate `localStorage fav_*` → provider (MAG only) |
| `benchy_showPlayer` | 721 | start `CSSJS_LIVE` interval |
| `benchy_startPlayer` | 728 | call `fixSettings` + `CSSJS` |
| `benchy_stbReady` | 733 | increment `stb_ready_count`, `pperf_stamp("stb ready")` |

**TS target**: New `src/benchy/index.ts`
- Copy functions 1:1 (adapt `PostFeedback` to use `fetch`)
- Wire calls in `startPlayer()` (L1278), player-ready block, `onStbReady()` (L1342)
- `pperf_stamp` / `pperf_flush`: copy `stbPlayer.js:1024-1060` logic (array of stamps)

### 6. innerStyle singleton (CSS rule manager)
**Legacy source**: `stbPlayer.js:1066-1100`
**TS target**: `src/utils/innerStyle.ts`
- Manages `<style>` element, `getRule(selector)` for dynamic CSS
- Used by `benchy_CSSJS` for integrity test

### 7. Polyfills & error handling ✅
**Legacy source**: `index.html:3-20` (performance.now, trim, imul, findIndex, isArray) + `index.html:108-122` (window.onerror)
**TS target**: `src/polyfills/index.ts` (already exists — verify coverage) + error handler in `src/app/init.ts`

### 8. CSS link injection ✅
**Legacy source**: `stbPlayer.js:1137-1138` — appends `<link rel="stylesheet" href="${host}/stbPlayer/1280.css?${__av}">`
**TS target**: `src/app/init.ts` — add DOM injection on startup

### 9. Build verification ✅
- Run `npm run build` → check `dist/stbPlayer.js` ≈ 300KB (matches legacy)
- Load in WebOS emulator / real LG TV → no console errors, `client_feedb` hits server, CSS live-reload works

---

## Copy-paste reference map (legacy → TS)

| Legacy item | File:line | TS destination | Notes |
|---|---|---|---|
| `detectDevice()` | `index.html:67-91` | `src/app/device.ts` | exact regex copy |
| `loadSTB()` | `index.html:146-155` | `src/app/stb-loader.ts` | dynamic script injection |
| `stb/lg/webos/stb.js` | full file | `src/stb/lg/webos/stb.ts` | **priority #1** |
| `stbGetItem`/`stbSetItem` | `stbPlayer.js:1015-1016` | `src/storage/index.ts` | wire to `ottpStorage` |
| `providerGetItem`/`providerSetItem` | `stbPlayer.js:1024-1047` | `src/storage/index.ts` L139/L144 | add `p_pref` prefix |
| `client_feedb` | `stbPlayer.js:514` | `src/benchy/index.ts` | use `fetch` not jQuery |
| `PostFeedback` | `index.html:102` (stub) | `src/benchy/index.ts` | real impl: `fetch(host+"/report_feedb", ...)` |
| `pperf_stamp`/`pperf_flush` | `stbPlayer.js:1024-1060` | `src/benchy/index.ts` | array + timestamp |
| `benchy_CSSJS` | `stbPlayer.js:629-648` | `src/benchy/index.ts` | uses `innerStyle` |
| `benchy_CSSJS_LIVE` | `stbPlayer.js:652-678` | `src/benchy/index.ts` | AJAX + eval |
| `benchy_fixSettings` | `stbPlayer.js:681-692` | `src/benchy/index.ts` | keep no-op |
| `fix_mag_favoritesArray` | `stbPlayer.js:694-718` | `src/benchy/index.ts` | MAG only |
| `benchy_showPlayer` | `stbPlayer.js:721-726` | `src/benchy/index.ts` | interval start |
| `benchy_startPlayer` | `stbPlayer.js:728-731` | `src/benchy/index.ts` | call in `startPlayer()` |
| `benchy_stbReady` | `stbPlayer.js:733-741` | `src/benchy/index.ts` | call in `onStbReady()` |
| `innerStyle` | `stbPlayer.js:1066-1100` | `src/utils/innerStyle.ts` | singleton |
| `window.onerror` | `index.html:108-122` | `src/app/init.ts` | global error handler |
| `1280.css` link | `stbPlayer.js:1137-1138` | `src/app/init.ts` | inject on startup |

---

## Device keycode groups (copy from correct legacy file)

| Group | Devices | Reference file |
|---|---|---|
| **PC-base** (identical) | PC, PC2, Spark, Edem, NodeJS | `~/victron/home-assistant/stb/pc/stb.js` |
| **Dune-family** | Dune, E2, Inext | `~/victron/home-assistant/stb/dune/stb.js` |
| **MAG** | MAG | `~/victron/home-assistant/stb/mag/stb.js` |
| **HbbTV-family** | HbbTV, Hisense, Philips, Sharp, Skyworth, Sony, TCL, Toshiba, VEWD | `~/victron/home-assistant/stb/hbbtv/stb.js` |
| **Samsung Maple** | Maple | `~/victron/home-assistant/stb/samsung/maple/stb.js` |
| **Samsung Tizen** | Tizen | `~/victron/home-assistant/stb/samsung/tizen/stb.js` |
| **Android** | Android | `~/victron/home-assistant/stb/android/stb.js` |
| **LG WebOS** | WebOS | `~/victron/home-assistant/stb/lg/webos/stb.js` |

---

## What's already done in TS (don't redo)
- `providerGetItem` / `providerSetItem` wrappers: `src/storage/index.ts` L139, L144, L545, L560
- `pperf_stamp` / `pperf_flush` / `PostFeedback` / `client_feedb`: `src/utils/helpers.ts` L38-L93
- Polyfills: `src/polyfills/index.ts`
- Module concat build: `build-concat.cjs` (outputs single ES5 `stbPlayer.js`)
- Version injection: `__OTTP_VERSION__` → `pkg.version`

---

## Next step command
```bash
# 1. Create device detection
# 2. Create WebOS stub
# 3. Wire loadSTB + startPlayer hooks
# 4. Run build → test on WebOS
```
