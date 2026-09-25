# Guide ownership and retained device interfaces

`src/guide/service.ts` owns provider/native request coalescing, the serial queue,
LRU schedule cache, now/next projections, subscriptions and one transition clock.
A last subscriber cancels its request, including a request recreated by native
XMLTV warm-up. Direct archive/menu consumers remain independent subscribers.
The configured cache capacity still disables full-schedule retention at zero;
completed schedules expire after twelve hours or after all programmes end.
Only subscribed channels trigger clock refreshes. Channel renderer fields are
accessors over this owner; scalar reads do not clone whole schedules.

## Request, cache and projection are different operations

`getChannelEpgCached(id, callback)` is a request interface despite its historical
name. Its return value cancels that consumer; it is not an EPG array. A valid
cache hit can invoke the callback synchronously. A miss queues transport work and
coalesces consumers for the same source/channel reference; the service runs one
transport request at a time. Each successful consumer receives detached rows.
Empty/failing responses produce `null` rather than an indefinitely reusable empty
schedule. A cancelled/retired consumer does not receive late completion.

`__ottClassicGuide.peek(id)` and the compatibility `getEpgFromCache(id)` read a
retained full schedule without fetching. They validate source identity, channel-row
token, configured capacity and expiry, and update LRU recency. A returned array is
a detached value, not mutable cache storage. `getCachedChannelEpg` needs special
care: its source declaration is a cache reader, but provider/native startup
replaces the public property with the retained current-guide **transport** hook.
Do not infer a cache-only contract from that replaceable property's name.

`observeCurrentProgramme(id, callback)` binds the renderer's now/next subscription
and reports whether its current snapshot contains an airing programme. Its Boolean
return does not promise an immediate callback. Notifications are queued and bound
to the source/channel reference. Repeated calls retain the existing consumer until
it is retired; they do not install a new listener for every paint. Cache capacity
zero disables full-schedule retention, but requests and now/next projections still
work. Publishing a display slice does not promote that slice to the full cache.

Provider/native transport selection lives in `fetchChannelGuide`. Built-in M3U can
use the Tauri/Capacitor XMLTV interface; other provider requests keep their declared
API route. Native XMLTV warm-up invalidates accepted schedules and recreates pending
consumers without letting a retired source publish into its replacement. Cancellation
of the last consumer also retires the recreated request. These contracts are covered
by `test_guide_service.cjs` and `test_guide_integration.cjs`.

## Screens and durable reminders

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
