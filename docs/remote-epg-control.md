# Server EPG queries from the control CLI

With a configured public EPG service, `ott PLAYER p` and `p --list TEXT` list
current programmes without loading every channel's schedule on the player.
`p TEXT` performs the same server search and requests the first matching channel.
VPortal library searches remain the separate `vp TEXT` command.

The CLI requests `epg_catalog` from the player. This synchronous metadata snapshot
contains an opaque `catalog` receipt and ordered channels with `id`, `number`,
`name`, `tvgId`, `tvgName` and `shift` in seconds. It never calls the guide loader.
No playlist, stream URL, account credentials or private EPG URL is included. The
receipt's source fingerprint and catalogue signature stay inside the player.
Only M3U's explicit XMLTV identifiers are forwarded as `tvgId` and `tvgName`.
Other providers are matched by channel name because their internal EPG IDs can
collide with unrelated IDs in the public guide.

The CLI sends the metadata and title filter directly to the configured service's
`POST /epg/v1/current` endpoint without the command-server authorization token.
The service matches against its accepted public guide snapshot and returns only
current programme titles and intervals. There is no per-channel schedule transfer
or XMLTV parsing on the TV for this command. Inferred channel timezone and the
player's explicit EPG shift are applied separately, once each.

Playback uses `play_catalog` with the opaque receipt and selected local channel
ID. The player checks the source, channel reload generation, full ordered metadata
and receipt age before entering its ordinary channel playback path. Changed
provider, reordered channels, modified guide identity/shift or an expired receipt
reject the request instead of playing a different channel at the old number.
Unchanged snapshots share a receipt for up to two minutes; receipts do not survive
a player reload. Parental and category admission remain owned by ordinary playback.

Snapshots are limited to 2,048 channels and 512 UTF-16 code units per metadata
field. Explicit shifts must be integer seconds in -86,400..86,400. The CLI and
server also enforce request/response size limits. A configured server failure must
not silently fall back to the expensive player-wide EPG scan. Deploy the matching
controller, player and EPG API before enabling the CLI's server EPG configuration.

The public service supports the fixed `epg-one` source. Configuring that service
explicitly selects its programme data for remote queries; it does not upload or
replace custom/private guide sources configured on a player.

Source tests verify a 1,565-channel metadata snapshot makes zero guide requests,
preserves channel IDs/time shifts, and rejects stale playback receipts. This is a
deterministic work/transport contract, not a physical LG latency measurement.
