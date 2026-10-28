# Favorites ledger recovery

This protocol accompanies the new transfer implementation. It requires a matching
player, controller permission/parser and CLI; a keyboard Favorites update alone
does not activate it.

An interrupted transfer can leave a `pending`, `partial` or `unknown` record.
Those records retain the original operation, source bindings and outcome. They
block new transfers even after restarting the player. An elapsed timeout is not
evidence that the original storage write stopped.

Recovery has three operations: read-only `list`, read-only `inspect`, and explicit
`acknowledge`. The separate permission is `favorites_transfer.recovery`. The
capability is the sibling `favorites_transfer_recovery: {version: 1}`; the original
transfer capability and operations keep their existing schemas. Recovery reads
the global ledger even when the original Plex source is inactive or deleted.

Acknowledgement means **accept the uncertain result without replaying it**. It
does not mark the original transfer successful, repair Favorites, restore an old
backup, or retry the original operation. The operator first inspects the record
and its deterministic plan, then explicitly confirms that exact plan. A missing
or invalid acknowledgement response permits fresh read-only inspection only.
There is no automatic acknowledgement retry.

## Physical exclusion and persistence

New persistent transfers require the captured synchronous `localStorage`
backend and its actual origin-scoped Web Locks implementation. Every transfer,
binding provision and acknowledgement uses the same exclusive lock,
`ottplay:favorites-ledger`. The physical apply promise owns the lock until it
settles, including receipt reservation, target writes, completion and cache
adoption. An outer RPC timeout does not release it. Recovery returns `busy`
while that writer is active. It never steals a lock.

The grant captures and rechecks the actual storage object, captured functions,
property owners, origin and LockManager. Writes use that backing directly with
exact preimage comparison and persisted readback. Cookies, memory fallback and
an unavailable or changed backend cannot advertise durable transfer support.
Read-only recovery remains available where a strict physical reader is usable.
This is a cooperating-writer guarantee, not cross-store crash atomicity or a
promise to exclude an old nonparticipating tab.

## Private records and deterministic confirmation

Legacy version-1 rows remain inspect-only. A current lock cannot prove that an
old row was produced under it. Newly guarded rows carry version-2 producer
provenance; legacy rows are never relabelled.

Inspection commits to the immutable original row, exact whole-ledger bytes,
current runtime and captured backend. The acknowledgement ID, exact prospective
after-image digest and plan digest use distinct SHA-256 domains. The stored audit
contains the acknowledgement ID, originating runtime, before-ledger revision,
backend proof and fixed reason `accept-unknown-no-replay`. It contains no variable
timestamp or circular after-image/plan digest.

Under the same lock, acknowledgement recomputes every value, checks expiry and
current ownership, performs one conditional write, and verifies exact persisted
bytes. Only the selected acknowledged row stops blocking newly admitted work.
Its original uncertain outcome and the other rows remain intact. A late
completion cannot overwrite an acknowledged row.

## Bounds and empty storage

The journal has at most 32 records and 65,536 UTF-8 bytes. Every write reserves
1,024 additional bytes inside that limit for each unacknowledged protected
version-2 row. Acknowledgement consumes only its selected row's reserve. It does
not evict history or free a record slot. A nonconforming journal is never silently
truncated or repaired.

Missing physical storage is hashed as the UTF-8 string `null`, returns an empty
list and reports logical `ledger_format: 2`. This is an empty wire projection,
not a producer-provenance claim. Inspection creates no journal, stage or cached
admission. An absent inspected operation has a null record, acknowledgement
disabled and null plan fields.

Verification must cover real same-origin pages sharing storage and locks:
another page stays blocked after an RPC timeout, can acquire the lock after the
actual writer settles, and can acquire it after the owning realm is destroyed.
Mocked storage alone does not qualify a platform's persistence implementation.
