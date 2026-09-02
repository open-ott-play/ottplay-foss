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
- `shiftArchive` — legacy `shiftArchive()` (`stbPlayer.js:L6148`) + `_shiftArchive()` (`stbPlayer.js:L6161`); current `shiftArchive()` + `_shiftArchive()` (`src/channels/index.ts:L1805`); fix: when `e === -6e6`, use assignment `_shiftSec = e` (not `_shiftSec += e`) before calling `_shiftArchive()` to match legacy L6150.
- `restoreCPD` — legacy `stbPlayer.js:L7980` `restoreCPD()` with bare `listCaption.innerHTML = ui_state.lc`, `listPodval.innerHTML = ui_state.lp`, `listDetail.innerHTML = ui_state.ld`, `ui_state = {}`; TS `src/ui/index.ts:L1189` now matches: removed null guards on `listCaptionElement`/`listPodvalElement`/`listDetailElement`, removed `|| ""` fallbacks (`ui_state.lc || ""`), direct assignments `listCaptionElement.innerHTML = ui_state.lc`, `listPodvalElement.innerHTML = ui_state.lp`, `listDetailElement.innerHTML = ui_state.ld`; stripped null-safe guards and optional chaining.
- `channelsList` — legacy `_channelsList()` (`stbPlayer.js:L2702`) full implementation; current stub `channelsList()` (`src/channels/index.ts:L2006`) delegates to `showPage()`, full logic in `_channelsList()` (`src/provider/index.ts:L1654`); callers: `epgKeyHandler`, `bucketsKeyHandler`, `searchChannel`, `channelsKeyHandler` call `window.channelsList`.
- `setListDataArray` — missing in legacy (`stbPlayer.js`), present at `src/app/state.ts:109`, caller `src/view/channel-list.ts:23`
