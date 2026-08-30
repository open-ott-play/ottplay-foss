# TS port conventions (not bugs)

Gold is a JS monolith with bare globals (`listArray = ...`, `showPage()`).
Src is a TypeScript split: `var w = window as any` plus ES modules.

Do NOT spend analysis time on these. They are intentional and equivalent
unless the *store* gold writes is not the *store* src reads (see "real gaps").

## Ignore — port noise

1. `export function` / type annotations / `(): void` vs gold `function foo()`.
2. `var w = window as any` then `w.foo` / `w.showPage()` vs gold bare `foo` / `showPage()`.
   That is how the port reaches window globals from a module.
3. `typeof w.foo === "function"` (or `typeof window.X === "function"`) before a call.
   Same call as gold, plus a guard. Including `w.showEditKey()` at the end of
   searchChannel (`src/channels/index.ts:2396`) — it is NOT missing.
4. Extra null checks (`chanels[id] && ch.channel_name`) vs gold assuming they exist.
5. Extra HTML `#editvar` input read in `setEdit`. Additive, not a missing gold chunk.
6. `w.curList` vs gold `curList` when both are window/module aliases of the same list.
7. `w.w.foo` is NOT `window.window`. `var w = window as any` then `w.w` is
   `window["w"]`, which is usually undefined. That throws
   `Cannot read properties of undefined (reading 'listCatIndex')`.
   Gold bare `listCatIndex` ≡ `w.listCatIndex` ≡ `window.listCatIndex`.
   Never write `w.w.*`. Same for `w.w.w.*`.

## Not equivalent — still a gap

The `w.w` *object* is window. The *name* of the field still has to match what
the reader uses.

- Gold `searchChannel` assigns the filtered result to bare global `listArray`.
  Gold `showPage` iterates `listArray`.
- Src `showPage` (`src/ui/index.ts`) iterates module `listDataArray`
  (fallback `window.listDataArray` only). It does **not** read `window.listArray`.
- Src `searchChannel` writes `w.w.listArray` and never `listDataArray` /
  `setListDataArray`. Filter is computed and thrown away. **This is a bug.**
- `var editvar = saved` inside `searchChannel` is a local. `setEdit` reads
  `(window as any).editvar` / `#editvar`, not that local. They do assign
  `w.editvar = editvar` before `showEditKey`, so the seed reaches window;
  after the user types, confirm that `setEdit` still sees the new value
  (local vs window vs input). If the OK path ignores the input, **this is a bug.**
- A stub `export function channelsList` in `src/channels/index.ts` plus a full
  `_channelsList` in `src/provider/index.ts` rebound at init is DUP/leftover,
  not "gold uses globals so the stub is fine".
- Concat clones in `src/index.ts` vs the module are leftover, not port style.

## What to report / fix

Only: lost writes to the store the consumer reads, lost calls that are actually
absent (not hidden behind typeof), lost variables, stub body vs gold body,
wrong identifier that is *not* `w` vs bare global.
