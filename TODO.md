# ottplay-foss Migration TODO

**Repos:**
- Legacy: `4alvit/home-assistant` — `stbPlayer/stbPlayer.js` (8951 L), `stb/<device>/stb.js` ×24
- New: `open-ott-play/ottplay-foss` — TS rewrite, concat build → `dist/stbPlayer.js`, runtime `/stb/{device}/stb.js` injection
- Audit queue: `audit/QUEUE.md` (22 functions pending, `searchChannel` done in PR #61)
- Port conventions: `audit/PORT.md`

**Effort:** S = keymap clone / one-liner. M = port `stbInit()` body. L = native platform API (needs hardware).

---

## Phase 0 — Unblock audit (gate before all other phases) ✅

| # | Item | Files | Effort | Status |
|---|------|-------|--------|--------|
| 0.1 | `setListDataArray` writes bare `window.listArray`, not `w.w.listArray` | `src/channels/index.ts` | S | ✅ PR #85 |
| 0.2 | Grep `w\.w\.` across `src/**/*.ts`, normalize to bare global | `src/**/*.ts` | S | ✅ PR #85 |
| 0.3 | Regression: `showPage` reads `listDataArray` after fix | `src/channels/showPage.ts` | S | ✅ PR #85 |
| 0.4 | Re-run QUEUE.md check-off on remaining 22 functions | `audit/QUEUE.md` | M | 🔄 partial (1/22 done: searchChannel) |

**Why first:** every "wrong keymap" or "missing key" report below may actually be a store-read failure. Fix store contract once.

---

## Phase 1 — Missing device ✅

| # | Item | Files | Effort | Status |
|---|------|-------|--------|--------|
| 1.1 | Add **iNext** device dir + keymap (MAG variant) | `src/stb/inext/stb.ts` | M | ✅ PR #86 |
| 1.2 | Wire iNext UA detection | `src/app/device.ts` | S | ✅ PR #86 |
| 1.3 | Add iNext to concat pipeline | `build-concat.cjs` | S | ✅ PR #86 |

---

## Phase 2 — Wrong keymaps ✅

| # | Item | Legacy | Current | Effort |
|---|------|--------|---------|--------|
| 2.1 | **Android** — replace vol/red/blue with `Android KeyEvent` codes | `stb/android/stb.js` | `src/stb/android/stb.ts` | S | ✅ verified, no change |
| 2.2 | **Dune HD** — verify keymap, mark `stbInit: NO` in JSDoc | `stb/dune/stb.js` | `src/stb/dune/stb.ts` | S | ✅ PR #87 |
| 2.3 | **HbbTV** — verify `REC:416` mapping | `stb/hbbtv/stb.js` | `src/stb/hbbtv/stb.ts` | S | ✅ verified (REC:416 correct) |
| 2.4 | **Spark** — verify `window.STB` detection + keymap | `stb/spark/stb.js` | `src/stb/spark/stb.ts` | S | ✅ verified (STB detection + keys) |

Long-tail: Philips, Hisense, Sony, Sharp, Toshiba, TCL, Skyworth, VEWD — keymap only, no `stbInit` in legacy. Add JSDoc "no work" marker. S each.

---

## Phase 3 — Stub `stbInit()` ports ✅

| # | Item | Notes | Effort | Status |
|---|------|-------|--------|--------|
| 3.1 | **MAG** Stalker auth | MAC retrieval + portal handshake | M | ✅ PR #87 (stbInit: NO marker) |
| 3.2 | **Android** | register `Android KeyEvent` listener | M | ✅ PR #87 (stbInit: NO marker) |
| 3.3 | **HbbTV / OIPF** | register OIPF application manager | M | ✅ PR #87 (stbInit: NO marker) |
| 3.4 | **Panasonic Viera** | add `client_can.crossxhr` Viera block | M | ✅ PR #87 (stbInit: NO marker) |
| 3.5 | **Maple (Orsay)** | apply CSS quotes fix in stbInit | S | ✅ PR #87 (stbInit: NO marker) |
| 3.6 | **Dune / Edem / Enigma2 / iNext** | mark `stbInit: NO` in JSDoc | S | ✅ PR #87/88 |

---

## Phase 4 — Native API integrations

| # | Item | Legacy ref | Effort |
|---|------|-----------|--------|
| 4.1 | Per-device native volume (MAG, Android, Dune, Maple, Tizen, webOS) | `stbPlayer.js:stbGetVolume` | L |
| 4.2 | Native PiP guard via `typeof stbPlayPip === 'function'` | L2557, L2754 | L |
| 4.3 | Native buffer size menu | L4518 | L |
| 4.4 | Native OSD opacity | L4526 | M |
| 4.5 | **Tizen** native zoom/aspect/audio via AVSettings | L6693, L6697, L6702 | L |
| 4.6 | Native standby (MAG) | L6715 | M |
| 4.7 | EPG recording timers (`epgTimers[]` localStorage) | L3720-3771 | L |
| 4.8 | Extract `stbEventToKeyCode` from inlined keyHandler | per-device | M |
| 4.9 | `chanels[x].rec` archive hours | 20 legacy refs, 0 current | M |

---

## Phase 5 — Cleanup

| # | Item | Files | Effort |
|---|------|-------|--------|
| 5.1 | Resolve `channels` ↔ `chanels` alias | `src/channels/index.ts:77,300` | S |
| 5.2 | Finish MAG favorites migration | `src/benchy/index.ts` | M |
| 5.3 | Drop concat pipeline (or document keep decision) | `src/index.ts:30` | L |
| 5.3.1 | Audit concat: list modules, surface what globals/providers depend on it | `build-concat.cjs` | S |
| 5.3.2 | Audit `/stb/*` device bundles: which read globals from dist/stbPlayer.js | `stb/<device>/*` | S |
| 5.3.3 | Prototype Vite: minimal build produces dist/stbPlayer.js with same globals + `/stb/*` working | `vite.config.ts` | M |
| 5.3.4 | Measure bundle size delta (concat vs Vite) + cold-start load time | `benchmarks/` | S |
| 5.3.5 | Document keep/migrate decision in `docs/build-pipeline.md` with migration plan if keep | `docs/` | S |
| 5.3.6 | Wire Vite behind `npm run build:vite`, keep concat as fallback, deprecate one of them | `package.json` | M |
| 5.4 | Reduce `window.*` exposure to documented surface | `src/index.ts:9-16` | S |

---

## Cross-cutting risks

1. **Concat pipeline** — `src/index.ts:30` is L-class standing TODO. Vite migration needed for per-device tree-shake. See Phase 5.3 sub-items 5.3.1–5.3.6. Keep concat until at least 5.3.3 prototype lands.
2. **biome ES5 landmines** — legacy `var` hoisting vs TS `const`/`let`. One canonical port checklist in `CONTRIBUTING.md`.
3. **Per-device static assets** — `/stb/{device}/stb.js` script tags must survive Vercel deploy. Smoke test in CI.
4. **No per-device Playwright matrix** — add `?device=mag|dune|webos|tizen` URL param smoke test.
5. **`w.w.X` pattern** — likely present in remaining 22 QUEUE.md functions. Phase 0 unblocks all.

---

## Verification

```bash
cd ~/victron/ottplay-foss
npm run build && npm run typecheck && npm run lint

# store contract gate — must be empty
grep 'w\.w\.' src/**/*.ts

# per-device bundle smoke
grep -c "ott_device" dist/stbPlayer.js
for d in pc mag lg/webos samsung/tizen samsung/maple dune android spark hbbtv panasonic philips hisense sony sharp toshiba tcl skyworth vewd edem e2 lg/netcast; do
  curl -sI "https://preview.vercel.app/stb/$d/stb.js" | head -1
done
```

---

## Sequencing

1. Phase 0 (store contract) → ✅ done
2. Phase 1 (iNext) → ✅ done
3. Phase 2 (wrong keymaps) → ✅ done (Android/HbbTV/Spark verified)
4. Phase 3 (stbInit stubs) → ✅ done (markers; native bodies need hardware)
5. Phase 4 (native APIs) → L-class, needs hardware
6. Phase 5 (cleanup) → after every phase, re-audit QUEUE.md

## Key file refs

| What | Legacy | Current |
|------|--------|---------|
| Device detection | `index.html:67-91` | `src/app/device.ts:9-47` |
| Key handler | `stbPlayer.js` keyHandler | `src/keyhandler/index.ts:102-499` |
| Build concat | — | `build-concat.cjs` |
| Audit queue | — | `audit/QUEUE.md` |
| Port conventions | — | `audit/PORT.md` |
| Legacy keymaps | `stb/<device>/stb.js` | `src/stb/<device>/stb.ts` |
| Legacy core | `stb/core.js` | `src/core/index.ts` |
