# Optional multiaudio normalization

Some streams put several audio tracks in the same MPEG-TS segments. A native
browser can expose only one of those tracks even when a desktop media application
lists all of them. This optional host feature copies compressed video and audio
into an HLS master with separate audio renditions. It does not transcode, invent
languages, alter subtitle positions, or change the player's track-selection UI.

The default server exposes none of these routes. An operator must configure a
private source registry and installed `ffmpeg` and `ffprobe` executables. Keep the
registry and generated playback URLs private. Do not put credentials in logs,
public documentation, crash reports, or analytics.

## Deployment

Set `OTT_NORMALIZATION_CONFIG` to an absolute path to a private JSON file. Set
`OTT_NORMALIZATION_ONLY=1` for a dedicated managed deployment: that role serves
only health and normalization routes, without the general player/proxy routes.
Terminate HTTPS at a trusted ingress matching `public_base`; forward only
`/normalize/` and `/health`. Disable access logging or redact **all** request
paths/query strings under `/normalize/`. Do not reuse the admin API key as a
playback credential. Configure process/container memory and CPU limits too.

Example structure (replace all values; generate independent random keys):

```json
{
  "key": "REPLACE_WITH_RANDOM_ADMIN_KEY_AT_LEAST_32_BYTES",
  "public_base": "https://media.example.invalid",
  "origins": ["https://player.ottplay.here.now"],
  "ffmpeg": "/usr/bin/ffmpeg",
  "ffprobe": "/usr/bin/ffprobe",
  "directory": "/var/lib/ottplay/normalization",
  "sources": {
    "sample": {
      "url": "https://video.example.invalid/live/master.m3u8",
      "allowed_origins": ["https://video.example.invalid"],
      "headers": {},
      "playback_key": "REPLACE_WITH_INDEPENDENT_RANDOM_PLAYBACK_KEY"
    }
  }
}
```

A source ID and playback key use letters, digits, `_`, and `-`; keys contain at
least 32 characters. Add exact browser origins for each client, including local
HTTP loopback origins or the supported `tauri://localhost` /
`capacitor://localhost` origin when needed. No credentialed wildcard CORS is used.
`allowed_origins` authorizes upstream destinations, not player origins. Every
redirect and nested playlist/key/media URI is checked against that explicit list.
Configured hostname addresses are resolved and pinned at startup; restart the gateway
after an intentional upstream DNS migration. Source headers are sent only to the
initial source's origin. Workers receive a
loopback proxy URL, never direct unrestricted upstream access.

## Private local profile delivery

A managed local desktop deployment may use `public_base` such as
`http://127.0.0.1:8789`, only while the server also binds explicitly to
`--host 127.0.0.1` (or literal `::1`). Non-loopback deployments still require
HTTPS. Hostnames and alternate numeric IP spellings cannot enable this exception.
Use the normalization-only role for this dedicated service.

Optional `profiles` configuration delivers an operator-created private overlay:

```json
"profiles": {
  "home": {
    "file": "/absolute/private/home-overlay.m3u",
    "key": "REPLACE_WITH_SEPARATE_RANDOM_PROFILE_KEY"
  }
}
```

The profile key is independent of every source playback key and the admin key:
a playlist can contain credentials for several sources. Its GET/HEAD endpoint is
`/normalize/profile/home/PROFILE_KEY/index.m3u`. Keep that URL private too.
At startup the server reads at most eight regular, non-symlink UTF-8 M3U files,
up to 4 MiB each, with a three-second read deadline per file. Unix files must have
no group/other permissions. The immutable snapshot requires a service restart to
change; no request accepts a path, URL, or replacement content. Responses use the
shared bounded response capacity, `no-store`, `no-referrer`, and `nosniff`.
Keep the original profile intact and select a cloned profile for validation.

## Portable playlist integration

A registered source's stable playback entry is:

```text
https://media.example.invalid/normalize/play/SOURCE_ID/PLAYBACK_KEY/master.m3u8
```

An operator may substitute **only the exact registered stream URL** in an overlay
M3U. Preserve every `#EXTINF`, group, EPG ID, channel name, ordering, and unrelated
URL. Retain a private original-to-overlay mapping for rollback. Do not overwrite
existing player profiles as part of server startup.

`scripts/normalize-m3u-overlay.py` creates a new mode-0600 file from a private JSON
mapping of exact original URL to scoped playback URL. It rejects missing or
ambiguous matches and refuses to overwrite an existing output:

```sh
python3 scripts/normalize-m3u-overlay.py --input original.m3u \
  --mapping private-mapping.json --output private-overlay.m3u
```

The same ordinary HLS address can be used by OTT server/web, here.now, Tauri, and
Capacitor clients that support the stream's codecs and fragmented-MP4 HLS. Older
native television engines may lack that container support; retain the original
source for rollback and verify each target engine before changing its profile. A trusted public HTTPS gateway
is needed for remote/web clients; a self-signed local certificate is insufficient.

The stable entry and child playlists require the source-scoped playback key.
Segment addresses carry separate 10-minute HMAC signatures. A fragment keeps the
same signed address across playlist reloads; a bounded 256-entry per-lease cache
prevents changing the identity of media that native players have already seen. Child playlist
refreshes mint fresh segment addresses, so continuous playback does not depend on
re-fetching the master when a segment token expires. Track URLs and initialization URLs stay stable. Initialization data uses exact
allowlisted MP4 names; media fragments use exact allowlisted M4S names.
Replacement producers continue each rendition’s last published media sequence independently, a distinct
discontinuity sequence, and a new lease-specific initialization address. The
discontinuity counter and per-rendition sequence checkpoints are durably stored
under the private working directory; an
exclusive owner lock rejects two gateway processes sharing that directory. Deploy its metadata directory on persistent storage; use a single owner with a Recreate deployment strategy. Do not reset metadata while keeping the same public playback identity. Source history is bounded to 128 IDs, including retired IDs; migration to new source identities must preserve that bound. A stable
child playlist therefore cannot silently replace an old fragment with unrelated
new bytes under the same sequence number.
A rendition keeps a durably persisted, fixed target duration across worker replacements. A later larger target is rejected instead of silently changing the playlist contract; a smaller raw target must still provide three times the advertised fixed duration before the source is admitted. Use a new registered source identity for an intentional incompatible target-duration change. An out-of-order response cannot replace the saved overlap window with an older one. The first replacement fragment carries an explicit discontinuity marker; the
discontinuity sequence advances when that marker leaves the window, following
[RFC 8216](https://www.rfc-editor.org/rfc/rfc8216.html#section-6.2.2).
Active reads renew the producer lease: there is no arbitrary elapsed-playback
cutoff. Readers that stop requesting media release the shared producer after the
bounded idle timeout. A failed/unsupported normalization attempt falls back to
the original stream through the same authorized proxy, without exposing its URL
or credentials. That fallback preserves playback, but may retain the original
browser limitation on audio-track visibility.

## Administration and limits

`GET /normalize/config` reports protocol availability. `POST /normalize/api`
requires `Authorization: Bearer ADMIN_KEY`, authenticates before JSON parsing,
limits the request body to 4 KiB, and accepts only:

- `{"op":"prepare","sourceId":"sample"}`: begin bounded background work;
  returns a lease. Keep existing playback running while polling.
- `{"op":"status","lease":"..."}` or `heartbeat`: returns `preparing`,
  `ready` (with a stable lease-bound `masterURL`), `original`, or `unavailable`.
- `{"op":"close","lease":"..."}`: revoke the lease, cancel pending probe or
  startup, stop its worker, and remove its files before acknowledging completion.

No request accepts a source URL, executable path, shell command, or arbitrary
FFmpeg arguments. Default bounds are two active workers/leases, a 96 MiB session disk
budget (up to four directories including retained media), 16 MiB per served media object, six retained HLS segments plus deletion
margin, an eight-second probe deadline, bounded startup, and a 40-second reader
idle lease. An unexpectedly exited worker is reaped immediately; its previously
advertised files remain available for a bounded interval while a replacement starts.
Retention is derived from the longest advertised window, its longest segment, and a 35-second replacement allowance, with a hard 180-second maximum. Playlists requiring a larger retention window are rejected before publication.
At most two retired generations are retained, and an independent directory
semaphore bounds all active/retained directories to four. Explicit close revokes
and removes its files without this grace period. Upstream responses are limited to four concurrent 16 MiB buffers; media delivery to
eight concurrent 16 MiB buffers. Permits remain attached to the emitted byte buffer
until its last reference is released, including slow clients. FFmpeg copies supported tracks and is never
downloaded automatically. Readiness requires at least three target durations of
media in every generated audio/video playlist, plus each initialization file; a
playlist header alone is insufficient. Sources whose GOP/segment duration cannot
provide that window within the 25-second producer deadline use the authorized
original-stream fallback; they are not advertised as ready. Preparation permits
two attempts by default, separated by one second, within one absolute 30-second
preparation deadline. An individual source with slow cold startup can opt into:

```json
"preparation_budget_seconds": 45,
"preparation_attempts": 3
```

Deploy a build that supports these fields before adding them to a private registry;
older builds reject unknown source fields. These optional source fields accept
30–60 seconds and 1–3 total attempts. Omitted
fields retain the existing 30-second/two-attempt policy. The single budget covers
all probes, retry delays, producer startup and admission; it is not multiplied by
the attempt count. Individual probes remain limited to eight seconds and producer
startup to 25 seconds. The example gives two cold failed probes room for a third
attempt without keeping a permanent warm-up worker.

While preparing, a lease expires at its creation time plus its preparation budget
and five seconds of response grace. Heartbeats cannot extend that absolute bound.
The playback entry waits only until that same deadline. On completion the normal
40-second reader idle clock begins; explicit close still cancels immediately and
waits for cleanup. Session count, storage, authentication and upstream limits are
unchanged. The client gives only the initial `/normalize/play/` master a
75-second Hls.js manifest deadline, including picture-in-picture. Main-video
startup feedback uses the same bounded window. Later playlist/segment loads,
stalls, `/normalize/lease/` requests and ordinary sources retain their existing
limits. Existing normalized
child playlists return retryable failure instead of receiving an incompatible
original master; original fallback is exposed only through the master entry.
This entry is intended for ordinary live MPEG-TS HLS sources; it does not add
archive/VOD timeline semantics or claim support for byte-range HLS fallback.

## Verification

Unit and real-process checks are separate so ordinary tests need no host tools:

```sh
cargo test -p ottplay-core audio_normalization --lib
cargo test -p ottplay-server normalization --bin ottplay-server
OTT_TEST_FFMPEG=/verified/path/ffmpeg OTT_TEST_FFPROBE=/verified/path/ffprobe \
  cargo test -p ottplay-core audio_normalization --lib -- --include-ignored
OTT_TEST_FFMPEG=/verified/path/ffmpeg OTT_TEST_FFPROBE=/verified/path/ffprobe \
  cargo test -p ottplay-server normalization --bin ottplay-server -- --include-ignored
```

`OTT_TEST_CRASH=1` kills only the temporary test worker and verifies recovery
without a seek or reload; `OTT_TEST_RESTART=1` intentionally revokes its lease and
is a teardown diagnostic, not the crash-recovery acceptance case.

The optional isolated WebKit check additionally requires the built server and
installed Playwright WebKit. Set `OTT_TEST_ENGINE=hls` to use the shipped Hls.js
with Chromium instead. `OTT_TEST_DIRECT_HTTPS=1` uses an ephemeral local TLS
listener instead of request interception. It generates synthetic six-track media, checks actual
native track exposure/selection, and closes its temporary server/browser:

```sh
OTT_TEST_FFMPEG=/verified/path/ffmpeg OTT_TEST_FFPROBE=/verified/path/ffprobe \
OTT_TEST_SERVER=/absolute/path/to/ottplay-server \
  node tests/test_normalization_webkit.cjs
```

## Client integration and validation scope

The companion shared-player change recognizes only the parsed, exact
`/normalize/play/SOURCE/KEY/master.m3u8` and
`/normalize/lease/LEASE/KEY/master.m3u8` route structures. On MSE-capable engines it
uses the existing Hls.js path for that source, including PiP, without changing the
saved player-engine preference or the behavior of unrelated URLs. Userinfo,
query/hash lookalikes, malformed IDs, media-child paths and substring matches do
not trigger this rule. If MSE is unavailable the existing native path remains.

Real-source validation with the shared player demonstrated six audio tracks,
French-to-English selection, and sustained English selection after an owned
FFmpeg process was killed. Both WebKit using Hls.js and Chromium using Hls.js
continued decoding frames after replacement. Tests require elapsed wall time and
continued decoding after the observation interval; a currentTime jump alone is
not success. No test seek or reload is used.

Bare native WebKit exposes the six tracks but does not reliably cross a replaced
producer's discontinuity. The shared player's explicit-track restoration fixes
native language resets, while the scoped MSE choice addresses the discontinuity
case where supported. This is not proof of support on every older television or
WebView; validate clients without MSE before replacing their original source.
The separate Video.js PC2 path is outside this shared-core routing change.
