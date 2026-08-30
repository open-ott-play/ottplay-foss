# TODO.md: ottplay-foss vs Reference stbPlayer.js Parity Audit

## Context & Purpose
This document tracks missing features, stubs, and incomplete implementations in `ottplay-foss` identified by comparing it against the reference monolithic JavaScript player (`ottplay-foss.historical/stbPlayer/stbPlayer.js` vs current `src/` modular code and `dist/stbPlayer.js`).

---

## High Priority: Missing Features & Incomplete Implementations

### 1. Core Player & Stream Fallbacks
- [x] **Adaptive Bitrate Controls:** Verify manual quality switching / bitrate selection UI in `src/core/index.ts` matches the reference player.
- [x] **Shaka Player Integration:** Ensure DASH/Shaka fallback options are fully implemented for STBs lacking native HLS support (MAG/Dune/Enigma2).
- [x] **Audio Track & Subtitle Selection:** Check that multi-language audio tracks and external subtitles (SRT/WebVTT) are fully handled in the OSD.

### 2. EPG & Timeshift
- [x] **Timeshift Buffer Control:** Ensure pause/rewind/fast-forward controls for live archive streams match reference implementation.
- [x] **XMLTV Parsing Resilience:** Add robust error handling for malformed or missing EPG program descriptions during XMLTV ingestion in `server.py`.

### 3. Provider Protocols
- [x] **Stalker Middleware API:** Verify full Stalker/Ministra portal handshake (MAC address, token auth, portal load, profile loading) in `prov/stalker/`.
- [x] **Xtream Codes API V2:** Check complete VOD/Series/Live category tree synchronization and search.

### 4. UI & Remote Control Key Mappings
- [x] **Missing Device Mappings:** Audit `stb/` for missing keys across niche TV brands (Sharp, Toshiba, Hisense, Skyworth, TCL, Vewd, Spark).
- [x] **On-Screen Keyboard:** Ensure the virtual keyboard supports all 21 localized layouts (`stbPlayer/_*.js`) when navigating via remote control D-pad.

---

## Medium Priority: Refactoring & Code Quality

### 1. Monolith Decomposition (`src/index.ts`)
- [ ] Break down the massive `src/index.ts` (3,447 lines) into smaller, focused modules under `src/app/` or `src/view/`.
  - Note: `src/app/` and `src/view/` skeleton directories exist but are mostly empty. The actual decomposition work remains.
- [ ] Remove global variables and enforce strict ES modules across all subdirectories.

### 2. Testing Infrastructure
- [x] Add unit tests for `server.py` and `local_proxy.py` using `pytest`.
- [x] Add test coverage for the TypeScript channel filtering and EPG matching logic.
  - `tests/test_channel_filtering.ts` — passes (run: `npx tsx tests/test_channel_filtering.ts`)
  - `tests/test-epg-matching.ts` — passes (run: `npx tsx tests/test-epg-matching.ts`)

---

## Low Priority / Nice-to-Have

### 1. Documentation & Diagnostics
- [x] Expand developer documentation on how to add a new device profile under `stb/`.
  - See `docs/device-profiles.md` — covers device profiles, provider scripts, and linting.
- [x] Add automated linting checks for legacy provider scripts in `prov/`.
  - `biome.json` already includes `prov/**/prov.js` and `src/stb/**/stb.js` in `files.includes`.
  - Run `npm run lint` to check; `npm run lint:fix` to auto-fix.
  - ~5,190 biome errors in prov/ (legacy JS, mostly `noEmptyBlockStatements`, `useTopLevelRegex`) — suppress via biome config rules if auto-fix is desired.
