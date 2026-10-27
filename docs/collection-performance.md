# Collection performance checks

The October 2026 collection changes preserve the existing ES5 runtime, stored
documents, ordering, reference identity and source-ownership checks. They target
work that grows with the number of channels or favorites:

- Channel lock reconciliation uses a temporary null-prototype membership index.
  Stored and migrated IDs keep their original order; explicit unlocks still win.
  The index is local to reconciliation and cannot become stale across mutations.
  Exclusion sets live inside the deduplication call; the legacy migration index
  is explicitly released because returned methods share its closure. This must
  also hold after minification, which can inline an apparently isolated function.
- Favorite merging appends invisible references to their retained neighbor's
  bucket, then appends those buckets to the result. It does not repeatedly copy
  the growing prefix. Equal reference values do not replace object identity.
  The snapshot caller also tells record construction that these exact merged
  references already contain every selected prior binding. Other callers retain
  the identity-membership check; no semantic-key approximation is used.
- Diagnostic reads derive their first array position from the cursor and oldest
  retained sequence. Accepted sequence IDs are consecutive; rejection allocates
  no ID and eviction removes only a prefix. Clearing retains the sequence counter.

## Reproducing the measurements

Use the same Node version and dependencies for both source trees. The comparison
base is `25b0881541c7a9c54e312354592e788218da71d0`. With that revision checked out
separately, run from the candidate:

```sh
node scripts/measure-channel-collections.cjs --base-root /path/to/baseline --out /tmp/channel-measurements.json
npm run build
npm run check:size
npm run check:bundle
```

The benchmark compiles the actual functions to ES5, checks equal output and
reference identity, alternates warmed baseline/candidate samples, and counts
array scans/copies separately from timings. It includes the favorite-record
construction after merging, so an isolated helper improvement cannot hide the
cost of preparing the resulting record. Synthetic Node timings are not physical
TV measurements or whole-player speedups.

Build both revisions and compare `build/reports/classic-bundle.json`, including
the web and native entries and **all** optional provider bundles. Standalone
helper size is insufficient; the existing complete-payload budgets remain in
force. No timing threshold is used in CI. Regression tests check behavior and
bound avoidable array work deterministically.

## October 27 audit: history and media catalogues

The follow-up audit targets avoidable catalogue work without changing stored
profiles, ordering, category selection, source access or playback policy:

- History restoration builds a temporary category/location index once when
  restoring multiple entries. A channel-reference codec is also created lazily
  once for that restoration. A one-entry history keeps the direct lookup path;
  later catalogue replacements build a fresh index.
- VPortal incremental publication uses a temporary typed membership index for
  new and category-updated IDs. Numeric and string IDs remain distinct, and the
  original append order is preserved.
- The Rust media library computes lowercase sort keys once per record, retaining
  the ID tie-breaker. A set replaces repeated scans when adding file sources;
  source order and source metadata remain unchanged.
- Android media scans index source presence and availability. Updating a preferred
  record replaces its old contribution, including when its source changes.
  Snapshots keep duplicate metadata rows independent. The index belongs to one
  scan/snapshot and does not cache filesystem access between scans.
- An unused local settings-policy function and import were removed from remote
  request dispatch. The active policy checks remain in their operation owners.
  Legacy functions used by concatenated scripts and compatibility aliases were
  retained even where TypeScript's unused-local diagnostic flags them.

Deterministic regression fixtures record the following work, rather than claim
whole-player timing improvements:

- 12,000 channels and 1,000 history entries: catalogue element reads fall from
  11,489,499 to 12,000. A one-entry fixture still reads only two elements.
- 2,048 new VPortal rows plus 2,048 category updates: zero growing-array
  membership searches, previously 2,048 searches.
- 12,000 unavailable Android records: first-playability checks no longer visit
  the 71,994,000 preceding records cumulatively. Availability updates and reads
  use keyed lookups; randomized replacement tests compare with linear results.

Run the existing regressions and the additional JVM test with:

```sh
node tests/test_playback_journal.cjs
node tests/test_vportal_provider.cjs
node tests/test_remote_requests.cjs
cargo test --locked -p ottplay-core offline_media
python3 tests/test_android_local_media_availability.py
node tests/test_android_local_media_scan.cjs
```

The JVM test requires Java and Kotlin; it does not require a connected device.
These changes do not resolve slow or disconnected network mounts, and this
source audit is not a guarantee that every unused function or optimization
opportunity has been found. Guide projection retention needs a separate API
lifetime decision before eviction can safely change.
