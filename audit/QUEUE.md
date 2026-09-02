# Audit queue

Functions to audit for port parity (legacy → current):

1. `initPlayer`
2. `keyHandler`
3. `setListDataArray`
4. `getListDataArray`
5. `setListSelectionIndex`
6. `getListSelectionIndex`
7. `setGetListItemFn`
8. `setDetailListActionFn`
9. `setListKeyHandlerFn`
10. `searchChannel`
11. `searchMedia`
12. `searchRec`
13. `getFilteredHistory`
14. `getFilteredChannelList`
15. `playChannel`
16. `stopPlayer`
17. `setVolume`
18. `getVolume`
19. `toggleFullscreen`
20. `setChannelList`
21. `getChannelList`

---

## Done:
- `editKey2` — legacy `stbPlayer.js:L7962` referenced only as `editKey = editKey2` in `setEditor()`; never defined as a function in legacy (assumed external global); current `src/ui/index.ts:L2931` `editKey2(code: number): void` with switch on `keys.ENTER`/`keys.EXIT`/`keys.RETURN`; callers: `src/index.ts:933` + `src/view/display-helpers.ts:329` alias `window.editKey = window.editKey2`; status: partial — legacy has no body to match; no TS fix needed.
- `shiftArchive` — legacy `shiftArchive()` (`stbPlayer.js:L6148`) + `_shiftArchive()` (`stbPlayer.js:L6161`); current `shiftArchive()` + `_shiftArchive()` (`src/channels/index.ts:L1805`); fix: when `e === -6e6`, use assignment `_shiftSec = e` (not `_shiftSec += e`) before calling `_shiftArchive()` to match legacy L6150.
- `btnDiv` — legacy `stbPlayer.js:L2651` `btnDiv(e, t, r, s, n)` with guard `if (!r || !e) return ""`, localized description, color class by key, number-key stripping, sNoColorKeys suppression, sNoNumbersKeys stripping; TS `src/ui/index.ts:L1210` matches: signature `btnDiv(keyLabel, label, description, num?, extra?)`, same guard logic, same color/sNumber/sNoColor handling, same HTML output; no discrepancies.
- `shiftArchive` — legacy `shiftArchive()` (`stbPlayer.js:L6148`) + `_shiftArchive()` (`stbPlayer.js:L6161`); current `shiftArchive()` + `_shiftArchive()` (`src/channels/index.ts:L1805`); fix: when `e === -6e6`, use assignment `_shiftSec = e` (not `_shiftSec += e`) before calling `_shiftArchive()` to match legacy L6150.
- `keyFun` — legacy `stbPlayer.js:L7377` `keyFun(e)` with switch cases 0-21 calling global functions directly; current TS `src/keyhandler/index.ts:692` `keyFun(fn: number)` now matches: cases 20/21 have `typeof` guards removed, all other cases retain their guards per legacy/stbPlayer.js implementation; function signature `keyFun(fn: number): void` compatible; all parameter usage and side effects match.
- `showActionsDialog` — legacy `stbPlayer.js:L2502` anonymous dialog-builder `a()` + `dialogBoxKeyHandler`; TS `src/channels/index.ts:L2515` now matches: removed `typeof fn === "function"` guards from all `dialogBoxKeyHandler` cases (ENTER/UP/DOWN/LEFT/RIGHT/RETURN/YELLOW/TOOLS), removed conditional guard on `keys.RIGHT` (`w.sPSchannels && w.parentPIN != "*"`), changed return statements to bare `return;` instead of `return true;`/`return false;`, removed `return false;` after switch; removed `: boolean` return type annotation.
- `restoreCPD` — legacy `stbPlayer.js:L7980` `restoreCPD()` with bare `listCaption.innerHTML = ui_state.lc`, `listPodval.innerHTML = ui_state.lp`, `listDetail.innerHTML = ui_state.ld`, `ui_state = {}`; TS `src/ui/index.ts:L1189` now matches: removed null guards on `listCaptionElement`/`listPodvalElement`/`listDetailElement`, removed `|| ""` fallbacks (`ui_state.lc || ""`), direct assignments `listCaptionElement.innerHTML = ui_state.lc`, `listPodvalElement.innerHTML = ui_state.lp`, `listDetailElement.innerHTML = ui_state.ld`; stripped null-safe guards and optional chaining.
- `timeShift` — legacy `stbPlayer.js:L6302` `timeShift(n)` with bare `getEPGchanelCached`, `chanels[e].rec`, `setCurProg(t, e, null)`, `showShift(step2text(-n))`, `playArchive(Math.round(Date.now() / 1e3) - n)`, `showShift(_("Archive - begin"))`, `epgArray[s].time`; TS `src/channels/index.ts:L1942` now matches: local `getEPGchanelCached` call, `channels[chId].rec` guard, `setCurProg(chId, epgData, null)`, `showShift(step2text(-n))`, inline `playArchive(Math.round(Date.now() / 1000) - n)`, `showShift(_("Archive - begin"))`, `playArchive(r[s].time)`; stripped extra `getEPGchanelCached` typeof guard fallback, `ch!.rec!` non-null assertions, `(window as any).epgArray`/`curProg` writes, `playArchive` s>=0 guard, `showShift` typeof guards, `step2text`/_() typeof fallbacks.
- `shiftArchive` — legacy `shiftArchive()` (`stbPlayer.js:L6148`) + `_shiftArchive()` (`stbPlayer.js:L6161`); current `shiftArchive()` + `_shiftArchive()` (`src/channels/index.ts:L1805`); fix: when `e === -6e6`, use assignment `_shiftSec = e` (not `_shiftSec += e`) before calling `_shiftArchive()` to match legacy L6150.
- `playArchive` — legacy `stbPlayer.js:L3681` `playArchive(e)` with `updateArchiveInfo(e)`, `showChanelInfo(1)`, `primaryIndex`, `curList`, `epgArray`, `s.time_to`, `fileArchive`, `stbPlay`, `stbSetPosTime`; TS `src/channels/index.ts` now matches: `updateArchiveInfo(e)`, `w.showChanelInfo(1)`, `curList[primaryIndex]`, `epgArray[curProg]`, `prog.time_to`, `fileArchive`, `w.stbPlay`, `w.stbSetPosTime`; function signature `playArchive(e: number): void` identical, all parameter usage and side effects match.
- `keyHandler` — legacy `stbPlayer.js:L7088` keyHandler, `keyFun()` (`L7377`), dialog/select/edit mode handlers; TS `src/keyhandler/index.ts:L102` now matches: added `sArrowFun == 1` check in `handleListKey()` for LEFT/RIGHT volume control, added RW/FF/CH_UP/CH_DOWN → page jump in list mode, added PREV/NEXT page navigation with `sPNFun == 3` variant, fixed N8 to map to STOP with showShift, added `liveStop()` for N0 when `playType <= 0` and `nProg` empty; added `keyFun`(20/21) calls for N2/N5 in archive mode.
- `channelsList` — legacy `_channelsList()` (`stbPlayer.js:L2702`) full implementation; current stub `channelsList()` (`src/channels/index.ts:L2006`) delegates to `showPage()`, full logic in `_channelsList()` (`src/provider/index.ts:L1654`); callers: `epgKeyHandler`, `bucketsKeyHandler`, `searchChannel`, `channelsKeyHandler` call `window.channelsList`.
- `setListDataArray` — missing in legacy (`stbPlayer.js`), present at `src/app/state.ts:109`, caller `src/view/channel-list.ts:23`
