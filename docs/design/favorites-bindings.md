# Favorites binding registry foundation

This module is a preparation artifact, not an enabled favorites-sync capability.
It does not access storage, providers, profiles, files, devices or the network.
The host injects persistence and exact target validation. Existing membership
remains in the channel favorites library and media journal; this registry stores
identity-to-target bindings only.

## Identities and public data

Profiles and sources receive independent lowercase UUID v4 identifiers from the
injected cryptographic UUID generator. There is no fallback to names, numbered
slots, account/configuration hashes, timestamps or `Math.random()`.

A public profile row contains `id`, `kind: "profile"` and `provider`. A source
row additionally contains `profile_id` and uses `kind: "source"`. Its parent
must exist, be a profile, and have the same provider. These are registry objects,
not a negotiated remote wire schema. `list()` and `lookup()` return only these
public fields and the registry revision. They never expose private selectors,
paths, grants, credentials or owner contexts.

A private binding is `{owner, selector}`. The selector is an explicit JSON
object supplied by the host; `validateSelector(kind, selector)` must validate its
exact platform-specific shape. Display names and mutable display metadata do not
belong in target selectors. The registry detects duplicate canonical selectors
within the same kind/provider/parent. It does not guess that different locators
refer to the same target; the host must reject such aliases or ambiguity during
explicit resolution. Owner context is private stale-binding protection, not a
public identity or an authentication credential.

`resolve(id)` is privileged internal access and returns a detached private
binding. It checks `current(publicRow, privateBinding)` on every call, including
the bound parent of a source, then confirms that persisted registry bytes have
not changed. Its result is not a remote DTO or an enduring lease: the host must
recheck ownership at the actual operation boundary. Callbacks are synchronous,
must inspect current authority, and must not perform hidden mutation or expose
private data through diagnostics.

## API and persistence contract

`window.__ottFavoritesBindings.create(ports)` constructs an independent instance.
Ports are `read()`, `compareAndSwap(before, after)`, `uuid()`,
`validateSelector(kind, selector)` and `current(publicRow, privateBinding)`.

- `list()` returns `{version:1, revision, entries}`.
- `lookup(id)` returns `{revision, entry}` or a fixed missing/invalid error.
- `create({kind,provider,profile_id?,binding}, expectedRevision)` creates a new
  random identity for an explicitly bound target.
- `bind(id, binding, expectedRevision)` keeps the identity while explicitly
  replacing its private target. Identical binding is a no-op.
- `resolve(id)` returns `{revision,entry,binding}` for internal use only.
- `importPublic(rows, expectedRevision)` imports/restores public IDs. New rows
  are unbound. An existing ID must have identical kind/provider/parent; any
  conflict rejects the whole import. Existing local bindings are preserved.
  An identical repeated import is a no-op. Imported sources may refer to a
  parent already in this registry or included in the same import.
- `copyProfile(id, {profile: binding, sources:[{id,binding}]}, expectedRevision)`
  requires explicit targets for every source in that profile. It generates new
  profile and source IDs together, remaps all parents, and retains the originals.
  While validating the copy, `current(source, binding)` sees the prospective
  new parent UUID before persistence. The host must validate the explicit copied
  target context, not require that new parent already exist on disk. A future
  host-integration fixture must cover this prospective-parent behavior.

Mutations return `{revision,changed,result}`. `result` is a public row for create
and bind, an array of new public rows for copy, and `null` for import. Every
changed write increments the integer revision once. An unchanged operation
performs no persistence write. Public import does not reset a local revision or
overwrite bindings from another installation. There is no full-private-registry
restore method: restoring foreign selectors/grants requires explicit rebinding.

The private persisted document is `{version:1,revision,entries}`, where rows may
have a `binding`. Maximums are 256 total rows, 512 KiB encoded document, 16 KiB
selector, eight nested selector levels and 64 members per selector collection.
Canonical traversal shares a budget of 512 nodes and 16 KiB encoded keys,
strings and structure across the entire selector, checked before retaining each
part. This conservative budget can reject a document slightly below the final
serialized limit; the final exact UTF-8 size check remains in place.
Both unknown fields and invalid IDs/parents are rejected. The revision is a
nonnegative JavaScript-safe integer; exhaustion refuses further changes.

`compareAndSwap` receives exact captured bytes (or `null`) and the complete next
document. The host must serialize competing writers or supply a real conditional
replace, and verify recoverable persisted bytes. The registry does not turn a
plain localStorage get/set pair into an atomic cross-tab operation.

- `confirmed`: the conditional replacement succeeded.
- `conflict`: it did not write because the preimage changed.
- `unknown`: a write may have happened but cannot be confirmed.

Exceptions from persistence after write admission are also `outcome_unknown`.
There is one attempt, no retry or blind rollback. A reported confirmation is
followed by a fresh exact-byte read; mismatch or read failure is unknown. A local
reentrancy guard prevents recursive mutations of one registry instance; it is
not a lock shared with other WebViews. No crash atomicity beyond the supplied
backend contract is advertised. Cookies/session-memory require a separately
honest host adapter; they must not claim confirmed durable CAS just because an
in-memory read echoes the attempted write.

## Integration and verification still required

This foundation module does not itself add provider hooks, save/copy/import UI
behavior, a capability, remote command, profile migration or runtime initializer.
The optional current-Plex transfer integration supplies the selectors, owner
checks and shared persistence boundary. Its guarded receipt recovery contract is
documented in [Favorites ledger recovery](favorites-ledger-recovery.md). Saving an
existing profile must call bind; copy-as-new must remap both profile/source IDs;
explicit public restore must call import and require binding where missing.

The fixture suite uses only in-memory callbacks. It covers public/private
separation, reload, stable IDs, import preservation/conflicts, current parent and
source checks, copying, UUID collision, selector/count/byte bounds, no-op, CAS
conflict, a throw after a write, readback uncertainty and reentrant ownership.
It does not qualify browser/cookie/Tauri/Capacitor persistence or favorites sync.
