# Media library and journal

`src/media/library.ts` owns navigation frames, selection, request cancellation and
resolution. Its injected ports describe provider rows, load a page and render a
detached view. Back, replacement and close revoke pending completions before
calling transport cleanup. Incremental page updates have the same frame lifetime.

Navigation reads have different copying contracts. `revision()` reads the current
operation generation without traversing frames. `highlight(index)` changes owned
selection without returning an item or copying its metadata; missing rows leave
selection unchanged. `select(index)` still returns a detached selected item, and
`snapshot()` still detaches the complete view for consumers. Use `capture()` when
work must also be invalidated by a selection change: highlighting another row
does not increment the operation generation.

`src/media/classic-adapter.ts` translates existing provider and UI ports. The
`mediaRecords`, `mediaUrls`, `mediaNames`, `mediaSelects`, `medHistory` and
`medFavorites` globals are compatibility projections. The active consumer uses
owned frames and explicit catalog/history/favorites routes; numeric history
routes are accepted only by the old public facade. The playback sentinel remains
an output/legacy codec in the playback adapter, rather than a media identity.

The adapter checks scalar revision when highlighting or releasing a screen, and
captures one detached frame for each favorite action. Reading the same snapshot
repeatedly would copy the entire navigation stack, including nested provider
metadata. Keep detached publication at the boundary without introducing a second
mutable catalog cache for these inexpensive ownership checks.
The recursive copier allocates its ancestor list once per object, not once per
property; cycle detection stays local to each branch, so shared sibling values
are copied independently and the caller's ancestor list is never mutated.

An item is identified by `(sourceId, itemId)`. The shared source identity includes
the provider account and playlist slot, and Edem's separate media portal. Provider
IDs take precedence, followed by canonical provider request objects. When neither
is available, the fallback is catalog location, title and duplicate occurrence.
That fallback cannot promise continuity after title changes or duplicate reorder.
Resolved stream URLs are metadata, not identifiers.

New history and favorite entries retain their origin route. Selection loads that
origin again and matches the stable identity before resolving playback. Thus a
changed signed URL does not lose resume position, and a missing entry does not
silently play an expired URL. Legacy entries without origin metadata retain their
old locator as importer fallback entries. New catalog visits create provider-backed
entries; the importer cannot reconstruct identity that the old data never recorded.

`src/media/journal.ts` stores version 1 documents at
`mediaJournal.v1:<sourceId>`. Kotlin `mediaCollectionChange` owns deduplication,
capacity, favorites and position mutations. Exact position is stored; the existing
whole-minute resume prompt is an explicit `mediaResumePosition` policy. Position
updates do not resurrect deleted history. Playback checkpoints target an explicit
MediaRef, never the first history row.

The importer reads the legacy media arrays without modifying them and claims their
old namespace once. A different account cannot import the same legacy data again.
Unknown or malformed new documents are read-only. Storage exceptions do not
overwrite accepted state. Disabling favorites persistence pauses journal writes
and can be reversed without recreating the runtime.

The implementation compiles to the existing ES5 bundle and requires no new browser
APIs. Tests cover real UI/playback entrypoints, detached frames, cold URL renewal,
account/slot isolation, cancellation and reentry, quality selection, lazy Edem
pages, journal failures and full compiled-artifact startup.

`tests/helpers/media-read-cost.cjs` uses 1,000 records with observable payload
getters to verify that scalar reads and highlighting do not traverse metadata;
it also verifies selection-guard invalidation and detached item/view results.
The source media suite and actual bundle smoke execute this contract. These are
deterministic allocation/work checks, not elapsed-time measurements on a TV.
