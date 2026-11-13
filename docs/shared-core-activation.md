# Classic Core activation boundary

The shared Core package and the FOSS host have separate activation decisions.
A correct, published library export does not automatically replace an existing
player hot path. This integration keeps the established Classic behavior while
activating the qualified contracts below.

## Active contracts

FOSS delegates storage-v2 XML framing, source-scan classification, UTF-16
fingerprints, portable Favorites codec rules, reminder decisions, live-stall
policy and the M3U user-agent table to Core. HTTP, storage transactions/readback,
PIN preparation and grants, current-owner checks, timers and UI effects remain
in FOSS. Existing `classicPortableSnapshot` and `classicInstallationState`
consumers also remain active; they are distinct from the new library APIs.

## Bulk activation remains held

`src/channels/library.ts` and `src/channels/channel-references.ts` retain the
local implementations shipped at `e2f2ac06217d76548f8499e9883ad813b4089dc8`.
The player does not call the new `classicChannelLibrary*` or
`createClassicChannelReferences` APIs from those paths. Existing groups, order,
shuffle/reset, preferences, references and persisted identifiers keep their
established behavior.

The [Core performance investigation](https://github.com/open-ott-play/ottplay-core/pull/159)
found correct results but substantial costs from converting a complete library
state across the JSON ABI for each operation. Paired local controls on the fresh
compiled JS runtime, with 10,000 items and 2,000 stored groups, measured snapshot
at approximately 21.8 ms versus 0.66 ms locally, move at 57.4 ms versus 6.0 ms,
and reset-shuffle at 50.8 ms versus 4.4 ms. Removing quadratic searches improved
some cases substantially but did not remove this transport cost.

These measurements support retaining the current path; they do not establish
browser/TV performance acceptance. The new exports remain additive Core APIs.
Activating them in FOSS requires a bounded transport design, preserved output,
order, ownership and purity, and fresh paired CPU/retained-heap qualification.
A global cache of mutable profiles is not a substitute for that qualification.

## Regression and provenance

`tests/test_classic_bulk_local_boundary.cjs` exercises the real local factories
with the unqualified Core bulk APIs unavailable. It checks functional results
and host effects, so adding a premature dependency fails before publication.
The normal channel-library and reference suites continue to cover behavior.

Vendor JS/JAR/manifest/license files must come from the qualified Core producer
with its exact source and SHA-256 evidence. Draft working-tree artifacts are not
release inputs. This activation boundary does not change historical release
assets, native-engine source provenance, or the separate LG application.
