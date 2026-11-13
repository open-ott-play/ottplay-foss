# Private multiview source broker

This module is an experimental server component. It is not registered by the
server's main router, does not install anything on a player, and advertises no
production input capacity. Checked source fetching does not qualify a live media
decoder. Existing public controller commands are unchanged.

## Server configuration and pairing

The operator enrolls each source through `SourceService::enroll`, using a separate
`SourcesManage` principal. Enrollment binds a server-owned profile UUID, configuration
and network policy revisions, allowed principal/installation pairs, item references,
and immutable `ServerSource`/`CheckedTransport` configurations. Never construct this
configuration from a player's URL, credentials, local root alias, or favorite digest.

The native installation needs a dedicated credential provisioned by the operator:
`server_id`, exact `origin`, audience `ottplay-multiview-v1`, `installation_id`, and
`control_bearer`. The controller's existing bearer is not a compositor credential.
Keep the provisioning record private. Native credentials cannot enroll sources.
Default listener policy is loopback; a future LAN listener requires explicitly
approved HTTPS, exact origins, and paired credentials. Constructing the protected
router alone never starts a listener.

Private LAN upstream access requires the source's exact origin and explicit IP
allowance. DNS answers, redirects, HLS playlists, keys, maps, and segments all pass
the checked transport. Proxy environment settings cannot bypass it. Credentials
are restricted to their enrolled origin; diagnostics contain closed error codes.

## Request flow

`wire.rs` defines the single private protocol under `/multiview/v1`;
[`private-api-v1.json`](private-api-v1.json) contains the matching contract and
synthetic request/response examples:

1. Authenticated `GET /capabilities` reports the server epoch and qualified output
   profiles. The ordinary constructor reports zero `max_inputs` and empty
   `output_profiles`; the injected test host reports its explicit fixture profile.
2. `POST /sessions` bootstraps a backend identity without requiring an existing
   backend revision. Its exact native geometry must fit a qualified output profile.
3. `POST /status` recovers a fresh owner-bound snapshot after a lost response;
   a snapshot is not an input grant.
4. `POST /sources` returns permission-filtered metadata and opaque references.
5. `POST /input-grants` checks the complete native/backend context, source/item and
   catalog revisions, protection policy, and canonical favorite digest. The digest
   matches metadata only; it cannot create source authority. Grants are single use,
   expire within 30 seconds, and honor the smaller remaining invocation budget.
6. A host redeems a grant through `SourceService::resolve`. The source service checks
   authority before and after byte reads and cancels revoked preparation. It never
   returns an unchecked upstream URL to the native caller.
7. The separate decoder adapter must prepare attachment, then use
   `PublicationAuthority::attach` for its bounded commit. Frame/audio publication
   uses `publish`, which cannot activate a pending grant. Never hold the registry
   mutex around probing, child spawning, stopping, or joining.

Without the explicit test host, session/control routes return `backend_unavailable`;
they do not fabricate successful playback. The source service, registry, and
protected output transport can also be exercised independently with owned fixtures.

### Explicit native intent transitions

The native driver keeps its last confirmed server `Binding` separately from a new
UI selection. `SourcesRequest.context` uses that confirmed binding. Optional
`next_native` on a grant describes the next source intent; only the target source
revision/generation may change. The server checks the complete prior context,
catalog, source permission, target occupancy and capacity before committing the
transition and its one-use grant. The returned context is the exact redemption
context; Play does not perform another native transition.

Controls may change only their operation-specific native fields. Focus/audio/layout
commit bounded backend and registry changes together. Cache publication is part of
the grant transaction, so a failed receipt cannot silently commit a source intent.
Retry uses the recorded prior request and committed context, never a reinterpretation
of the old CAS. Status recovery accepts stale mutable native revisions while checking
the owner, installation, session and immutable native runtime/scene/slot; it returns
stored authoritative state without rebinding it. The canonical JSON describes the
field allowlist and concrete before/after examples.

### Fixture-only live HTTP host

`Broker::new_fixture` is available only in test builds and injects an actual Session,
SourceService and stream factory behind the same private-v1 handlers. It starts no
listener. The ordinary constructor and production server retain zero capacity and
unregistered routes. The fixture admits one compositor with at most a 60-second
hard lifetime. Its signed output path stays stable while bounded, checked reads
refresh the actual encoder playlist and segments.

Composite Ready requires actual closed HLS and may include slates for empty or
preparing slots. Slot Playing reports decoded frames; end-to-end image/audio
acceptance remains separate. Occupied-target replacement is currently refused
before source intent changes. In this initial fixture, Stop cleans up its input
and withholds output until Off; that is an explicit temporary limit. Stable ordinary
Stop/switch and a fresh codec epoch after security revocation require separate
qualification. A video-only watermark cannot certify that old PCM/AAC is gone.

Slot source/item references identify the current redeemed registry selection,
checked against the owner, complete binding and the core's observed source
revision. They remain absent before redemption and after expiry, revocation,
retirement or replacement. Preparing may carry selected references while source
resolution is still running; these metadata do not prove decoding or grant
permission to reuse a stale source. Empty, failed and closing/closed slots do not
publish references from an earlier selection.

## Lifetime and retirement

Grant redemption, renewable active authority, and absolute decoder custody have
different lifetimes. A 30-second grant deadline must not become a long video's
playback deadline. The active owner lease is 90 seconds, renewed only by the owner;
the host must also cap it to credential expiry and its operator hard ceiling.
Media reads never renew control authority.

Removing/re-enrolling a source rotates item revisions and revokes pending and active
work. Changes to the active source or permissions revoke composite output; unrelated
focus/audio/layout changes preserve unchanged active source authority. Pending
preparation still rejects geometry changes. Native-side favorite,
attachment, parental, and kiosk changes must also trigger immediate invalidation.

Cancellation is not retirement. The host must observe provider cleanup, decoder
reaping, and output revocation before acknowledging the corresponding barriers.
`AuthorizedSource::finish` confirms source cleanup only. Drop requests cancellation;
it does not establish reaping. An uncertain VPortal allocation or failed stop remains
`source_cleanup_unconfirmed`; never retry the allocation blindly.

## Streaming host adapter

`StreamFactory` adds a Unix-only MPEG-TS input bridge for an already resolved
`AuthorizedSource`. The checked upstream configuration and credentials remain in
the broker. Core receives a blocking socket file descriptor, never an upstream URL.
HLS, MP4, seeking, Windows pipes, and ordinary Local Library path reopening are not
qualified by this adapter.

The trusted host uses this sequence:

1. Redeem the input grant once and create `StreamFactory::new(source, hard_end)`.
   The absolute hard end is at most 24 hours; it is separate from the 30-second
   redemption deadline and renewable owner lease.
   Constructor rejection returns `StreamCreationFailure`; recover its source with
   `into_source()` and finish provider cleanup instead of discarding its owner.
2. Capture the core session preparation outside the asynchronous work. Construct
   `GrantedStream` from `reservation.decoder_context()`, the factory hard end,
   `reservation.revoked()`, and `reservation.publication_authority()`. Preserve
   this immutable issued context and the **same** revocation atomic; do not
   recapture a newer focus/audio context after resolution.
3. Open `StreamPhase::Probe`, transfer its one-use file with `take_file`, wrap it
   with `GrantedStream::wrap_probe`, and call the actual `probe_stream` outside
   the session/control lock. Preserve its opaque `PreparedStreamInfo` on success.
4. Retire and join the Probe producer. A successful metadata probe can close its
   reader early, so a producer write error alone does not determine probe success.
   Factory admission requires observed producer joining; core separately requires
   the successful metadata proof. Do not open Decode after a failed metadata probe.
5. Open `StreamPhase::Decode` for a fresh HTTP subscription and file descriptor
   under the same source/provider lease. Never clone or rewind the Probe reader.
   Wrap the file with the same grant, then use the core prepare/commit API and
   registry attachment barrier. Invalid preparation must leave the old input intact.
6. On retirement, revoke output, stop/reap the decoder, and call `factory.finish()`.
   Inspect the joined-producer and provider-cleanup receipt before acknowledging
   the host's retirement barriers. Cancellation or Drop is not that receipt.

Each phase can be attempted only once, including failed opens. Retiring Probe
cancels only that subscription; factory cancellation synchronously revokes the
reservation and cancels both phases. A cancelled `OpenedStream::retire` or
`StreamFactory::finish` await can be resumed while retaining its owner: the join
handle and cleanup result stay owned, and a provider stop is not replayed. This
does not make the consuming `AuthorizedSource::finish` await resumable; after a
constructor failure, keep that cleanup operation under a stable task owner until
completion. Never write request cancellation into the session-wide stop atomic.

After redemption, unrelated focus/audio changes do not invalidate pending source
preparation. The original issued binding remains immutable. Attach rebases only
focus/audio from current state; owner, installation, runtime, scene, geometry,
target slot/generation, source and policy changes still invalidate preparation.
Read the authoritative status after commit rather than treating the caller's old
candidate revisions as the final global state. Grant issuance/redemption and
ordinary controls continue to require their full exact context.

The transport checks the initial MPEG-TS packet headers before exposing bytes.
First-response and idle defaults are eight seconds; each is capped at 30 seconds.
Backpressure does not extend the absolute hard end. Probe forwarding is capped at
8 MiB. Returned chunks are at most 64 KiB, with one outstanding chunk per stream;
retained clones/slices retain their source and request admission permits. The
transport retains at most one inbound frame up to 512 KiB while splitting it,
plus the bounded output and 940-byte sniff prefix. These are application buffer
bounds, separate from the HTTP parser's own bounded buffers.

This bridge is an internal integration surface. Production capacity remains zero
until actual broker-to-core media, native lifecycle, and output renewal are jointly
qualified. Adjacent owned fixtures are not evidence of television playback.

Output HMAC leases live in the private path, allowing native HLS clients to fetch
children without custom headers. Every resource and body chunk rechecks its lease,
credential, session, generation, expiry, and revocation. Generated children stay in
the same exact origin and lease prefix. Never log or publish signed paths. Output
buffers and serving permits remain bounded through body lifetime.

## Qualification and troubleshooting

- `revision_conflict`: refresh the source/status metadata; do not replay a consumed
  play operation blindly. Idempotency is scoped to principal, installation,
  credential revision, epoch, session, and endpoint.
- `source_destination_denied`: review the operator-owned exact-origin/address
  policy. A local player's network consent does not authorize the server.
- `authority_revoked`: close the old output and finish retirement before replacement.
- `source_cleanup_unconfirmed`: retain the reservation and reconcile with the
  provider; cancellation alone cannot release it for another attachment.
- `backend_unavailable`: expected until the actual media adapter and host lifecycle
  are connected and independently qualified.

Before enabling capacity, qualify the actual decoder source adapter, admitted raster,
native active invalidation, credential expiry, streaming lifecycle, output renewal,
and independent multi-source end-to-end playback. A finite HLS graph fetch is not a
live demuxer. Ordinary Local Library records are not supported through an unsafe
path reopen; they need a separately reviewed file-custody bridge.

The adjacent unit tests and `server/tests/multiview_broker_boundary.rs` use synthetic
configuration, in-memory HTTP routing, and explicitly owned loopback fixtures.
They neither enroll household sources nor prove TV/device playback.
