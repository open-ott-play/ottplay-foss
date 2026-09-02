# Audit: channelsList

## Legacy

`4alvit/home-assistant/stbPlayer/stbPlayer.js` L2702

```js
function _channelsList(e, t)
```

- `e` — category index (listCatIndex)
- `t` — channel index (primaryIndex / selIndex)

Full implementation:
- Validates category existence (`catsArray[e]`); emits `infoBox` + `client_feedb` error on miss.
- Sets `selIndex`, `listCatIndex`, `listArray`.
- Computes layout metrics (item width, pikon size, progress bar geometry) using `getWidthK()`, `getHeightK()`, `sShowNum`, `sShowArchive`, `sShowProgress`, etc.
- Assigns `getListItem`, `detailListAction`, `listKeyHandler`, `listCaption`, `listPodval`, `listDetail`.
- Calls `setPopupChannels()`, hides `#listPopUp`, sets `previewChan`.
- Calls `showPage()`.

No direct internal callers found in legacy graph (invoked via global `window` reference from key handlers).

## Current

**Stub** — `src/channels/index.ts` L2006

```ts
export function channelsList(catIdx: number, channelIdx: number): void {
    if (typeof (window as any).showPage === "function")
        (window as any).showPage();
}
```

**Implementation** — `src/provider/index.ts` L1654

```ts
function _channelsList(catIdx: number, channelIdx: number): void
```

Full port of the legacy logic (category validation, error feedback, layout metric
computation, `getListItemFn` assignment, `setPopupChannels()`, `showPage()`).

Callers (via `window.channelsList`):
- `epgKeyHandler()` L1111–1112, L1135–1136, L1140–1141
- `bucketsKeyHandler()` L2211–2213, L2230–2231, L2239–2240
- `searchChannel()` L2367–2368, L2384–2385, L2389–
- `channelsKeyHandler()` (indirect)

## Differences

- Signature identical: `(catIdx: number, channelIdx: number): void`.
- Stub in `channels/index.ts` delegates to `showPage()` only; full implementation
  lives in `provider/index.ts` as `_channelsList`.
- Provider module wires `_channelsList → channelsList` at init (L816).
- Callers use `window.channelsList` indirection, not direct import.

## Status

**partial** — logic ported but exported entry point is a stub.
