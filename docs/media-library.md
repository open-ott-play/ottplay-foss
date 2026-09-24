# Media library and journal

`src/media/library.ts` owns navigation frames, selection, request cancellation and
resolution. Its injected ports describe provider rows, load a page and render a
detached view. Back, replacement and close revoke pending completions before
calling transport cleanup. Incremental page updates have the same frame lifetime.

`src/media/classic-adapter.ts` translates existing provider and UI ports. The
`mediaRecords`, `mediaUrls`, `mediaNames`, `mediaSelects`, `medHistory` and
`medFavorites` globals are compatibility projections. The active consumer uses
owned frames and explicit catalog/history/favorites routes; numeric history
routes are accepted only by the old public facade. The playback sentinel remains
an output/legacy codec in the playback adapter, rather than a media identity.

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
