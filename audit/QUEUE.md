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
- `restoreCPD` — legacy `stbPlayer.js:L7980` `restoreCPD()` with bare `listCaption.innerHTML = ui_state.lc`, `listPodval.innerHTML = ui_state.lp`, `listDetail.innerHTML = ui_state.ld`, `ui_state = {}`; TS `src/ui/index.ts:L1189` now matches: removed null guards on `listCaptionElement`/`listPodvalElement`/`listDetailElement`, removed `|| ""` fallbacks (`ui_state.lc || ""`), direct assignments `listCaptionElement.innerHTML = ui_state.lc`, `listPodvalElement.innerHTML = ui_state.lp`, `listDetailElement.innerHTML = ui_state.ld`; stripped null-safe guards and optional chaining.
- `timeShift` — legacy `stbPlayer.js:L6302` `timeShift(n)` with bare `getEPGchanelCached`, `chanels[e].rec`, `setCurProg(t, e, null)`, `showShift(step2text(-n))`, `playArchive(Math.round(Date.now() / 1e3) - n)`, `showShift(_("Archive - begin"))`, `epgArray[s].time`; TS `src/channels/index.ts:L1942` now matches: local `getEPGchanelCached` call, `channels[chId].rec` guard, `setCurProg(chId, epgData, null)`, `showShift(step2text(-n))`, inline `playArchive(Math.round(Date.now() / 1000) - n)`, `showShift(_("Archive - begin"))`, `playArchive(r[s].time)`; stripped extra `getEPGchanelCached` typeof guard fallback, `ch!.rec!` non-null assertions, `(window as any).epgArray`/`curProg` writes, `playArchive` s>=0 guard, `showShift` typeof guards, `step2text`/_() typeof fallbacks.
- `shiftArchive` — legacy `shiftArchive()` (`stbPlayer.js:L6148`) + `_shiftArchive()` (`stbPlayer.js:L6161`); current `shiftArchive()` + `_shiftArchive()` (`src/channels/index.ts:L1805`); fix: accumulation order `_shiftSec += e` before early return when `e === -6e6` to match legacy.
- `playArchive` — legacy `stbPlayer.js:L3681` `playArchive(e)` with `updateArchiveInfo(e)`, `showChanelInfo(1)`, `primaryIndex`, `curList`, `epgArray`, `s.time_to`, `fileArchive`, `stbPlay`, `stbSetPosTime`; TS `src/channels/index.ts` now matches: `updateArchiveInfo(e)`, `w.showChanelInfo(1)`, `curList[primaryIndex]`, `epgArray[curProg]`, `prog.time_to`, `fileArchive`, `w.stbPlay`, `w.stbSetPosTime`; function signature `playArchive(e: number): void` identical, all parameter usage and side effects match.
- `channelsList` — legacy `_channelsList()` (`stbPlayer.js:L2702`) full implementation; current stub `channelsList()` (`src/channels/index.ts:L2006`) delegates to `showPage()`, full logic in `_channelsList()` (`src/provider/index.ts:L1654`); callers: `epgKeyHandler`, `bucketsKeyHandler`, `searchChannel`, `channelsKeyHandler` call `window.channelsList`.
- `setListDataArray` — missing in legacy (`stbPlayer.js`), present at `src/app/state.ts:109`, caller `src/view/channel-list.ts:23`
