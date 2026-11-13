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
   profiles. Currently `max_inputs` is zero and `output_profiles` is empty.
2. `POST /sessions` will bootstrap a backend identity without requiring an existing
   backend revision. Its exact native geometry must fit a qualified output profile.
3. `POST /status` will recover a fresh owner-bound snapshot after a lost response;
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

The session/control routes currently return `backend_unavailable`; they do not
fabricate successful playback. The source service, registry, and protected output
transport can be exercised independently with owned fixtures.

## Lifetime and retirement

Grant redemption, renewable active authority, and absolute decoder custody have
different lifetimes. A 30-second grant deadline must not become a long video's
playback deadline. The active owner lease is 90 seconds, renewed only by the owner;
the host must also cap it to credential expiry and its operator hard ceiling.
Media reads never renew control authority.

Removing/re-enrolling a source rotates item revisions and revokes pending and active
work. Changes to the active source or permissions revoke composite output; unrelated
focus/audio/layout changes preserve unchanged source authority. Native-side favorite,
attachment, parental, and kiosk changes must also trigger immediate invalidation.

Cancellation is not retirement. The host must observe provider cleanup, decoder
reaping, and output revocation before acknowledging the corresponding barriers.
`AuthorizedSource::finish` confirms source cleanup only. Drop requests cancellation;
it does not establish reaping. An uncertain VPortal allocation or failed stop remains
`source_cleanup_unconfirmed`; never retry the allocation blindly.

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
