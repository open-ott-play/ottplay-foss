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
- `closeList` — legacy `closeList()` (`stbPlayer.js:L1723`); current `closeList()` (`src/ui/index.ts:L776`); fix: add missing `$("#listPopUp").hide()`, PiP restore (`!sNoSmall && pipIndex != null → stbPlayPip(...)`), and preview-channel resume (`sPreview && previewChan → stbStop/playArchive/playChannel + previewChan = null`) — three blocks present in legacy but absent from TypeScript port.
- `showEditKey1` — legacy `showEditKey1(e)` (`stbPlayer.js:L3988`); current `showEditKey1(_initKeys)` (`src/ui/index.ts:L2642`); fix: no mismatch — body parity exact (saveCPD, lang check, _keysSymbol[1/7/9], sNoColorKeys underlines, editPos, _keyCur clamp, _setPunct + showEdit).
- `shiftArchive` — legacy `shiftArchive()` (`stbPlayer.js:L6148`) + `_shiftArchive()` (`stbPlayer.js:L6161`); current `shiftArchive()` + `_shiftArchive()` (`src/channels/index.ts:L1805`); fix: when `e === -6e6`, use assignment `_shiftSec = e` (not `_shiftSec += e`) before calling `_shiftArchive()` to match legacy L6150.
- `channelsList` — legacy `_channelsList()` (`stbPlayer.js:L2702`) full implementation; current stub `channelsList()` (`src/channels/index.ts:L2006`) delegates to `showPage()`, full logic in `_channelsList()` (`src/provider/index.ts:L1654`); callers: `epgKeyHandler`, `bucketsKeyHandler`, `searchChannel`, `channelsKeyHandler` call `window.channelsList`.
- `setListDataArray` — missing in legacy (`stbPlayer.js`), present at `src/app/state.ts:109`, caller `src/view/channel-list.ts:23`
