# Guide ownership and retained device interfaces

`src/guide/service.ts` owns provider/native request coalescing, the serial queue,
LRU schedule cache, now/next projections, subscriptions and one transition clock.
A last subscriber cancels its request, including a request recreated by native
XMLTV warm-up. Direct archive/menu consumers remain independent subscribers.
The configured cache capacity still disables full-schedule retention at zero;
completed schedules expire after twelve hours or after all programmes end.
Only subscribed channels trigger clock refreshes. Channel renderer fields are
accessors over this owner; scalar reads do not clone whole schedules.

`src/guide/screen.ts` owns the programme list and selection by programme ID.
Time, alphabetical and completed-record views are derived from one accepted
schedule. The classic codec resolves category positions at commit, captures PIN
and source ownership, and binds cancellation to the list-screen owner. Search
uses owned cache snapshots and opens the selected programme on completion;
there is no delayed 50 ms selection heuristic.

The shared core `guideScheduleSelection` specifies finite, positive intervals
with `[start, end)` boundaries. Among overlapping programmes the greatest start
wins; equal starts retain the first input row. Following programmes are ordered
by start. Refresh happens at the next start/end transition, bounded by one hour.
Programme identity includes source and stable channel identity and uses provider
programme ID when present, otherwise broadcast start. Title/end corrections do
not rename a programme. Native XMLTV parameter names, ordered source URLs and
post-fetch `tvg-shift` remain transport codecs in `fetchChannelGuide`.

`src/guide/reminders.ts` owns durable records and one timer. A record contains
source/channel/programme IDs, title and start/end, never category positions or
runtime handles. Each source has a versioned `guideReminders:<source>` document
inside the provider/M3U-slot storage scope. Provider keys remain portable through
existing raw backup/cloud export. Invalid, foreign and future documents are
read-only. Writes require read-back before accepting new state. Storage reset
revokes pending guide and reminder work before deleting data.

Legacy `epgTimers` bytes are retained. Import claims the namespace containing the
legacy bytes before scheduling: provider storage for provider records, global
storage for the older global fallback. A source replacement cannot import the
same fallback again. Missing channels are retained but cannot play; a unique
`legacyChannelId` alias may resolve a migrated hash. Legacy records are marked so
an existing timestamp-based reminder matches the same programme when its provider
ID becomes available. Ambiguous old hashes remain unresolved. A historical record
without provider programme ID cannot reliably identify a programme whose start
also changed; no attribution or history is rewritten to claim otherwise.

`epg`, `epgCache`, list arrays and `epgTimers` are detached/read-only renderer
projections, not authoritative state. The old queue, cache-order object and
positional timer scheduler are removed from the active bundle. The frozen
`tests/fixtures/guide/retired-adapter.ts` exists only to replay historical core
compatibility fixtures; new runtime tests assert the explicit timeline semantics.

All new runtime modules target ES5 and use existing array/object/timer facilities.
They do not require Proxy, Map, WeakMap, fetch or AbortController. Attribution and
third-party notices are unchanged.
