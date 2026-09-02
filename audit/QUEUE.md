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
9. `searchChannel`
10. `searchMedia`
11. `searchRec`
12. `getFilteredHistory`
13. `getFilteredChannelList`
14. `playChannel`
15. `stopPlayer`
16. `setVolume`
17. `getVolume`
18. `toggleFullscreen`
19. `setChannelList`
20. `getChannelList`

---

## Done:
- `setListDataArray` — missing in legacy (`stbPlayer.js`), present at `src/app/state.ts:109`, caller `src/view/channel-list.ts:23`
