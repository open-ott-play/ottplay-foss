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
- `playArchive` — legacy `stbPlayer.js:L3681` `playArchive(e)` with `updateArchiveInfo(e)`, `showChanelInfo(1)`, `primaryIndex`, `curList`, `epgArray`, `s.time_to`, `fileArchive`, `stbPlay`, `stbSetPosTime`; TS `src/channels/index.ts` now matches: `updateArchiveInfo(e)`, `w.showChanelInfo(1)`, `curList[primaryIndex]`, `epgArray[curProg]`, `prog.time_to`, `fileArchive`, `w.stbPlay`, `w.stbSetPosTime`; function signature `playArchive(e: number): void` identical, all parameter usage and side effects match.
- `channelsList` — legacy `_channelsList()` (`stbPlayer.js:L2702`) full implementation; current stub `channelsList()` (`src/channels/index.ts:L2006`) delegates to `showPage()`, full logic in `_channelsList()` (`src/provider/index.ts:L1654`); callers: `epgKeyHandler`, `bucketsKeyHandler`, `searchChannel`, `channelsKeyHandler` call `window.channelsList`.
- `setListDataArray` — missing in legacy (`stbPlayer.js`), present at `src/app/state.ts:109`, caller `src/view/channel-list.ts:23`
