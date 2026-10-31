# Media companion

The native media service adds ordinary BitTorrent file playback and packaged
source resolvers. It uses the player's video engines and accepts sources from playlists.
Local videos still reads original files without importing them into this cache.

## Availability

- Tauri contains the service. It starts on demand on a private loopback port,
  using the instance's private data directory. Normal startup joins no swarm.
- The **Torrent** provider is available only when the app owns this native
  service, currently in Tauri. A configured external endpoint does not enable
  that provider.
- OTT server includes it but requires explicit operator configuration.
- Browser, hosted, Android and the current webOS/Tizen packages can play
  companion sources through an operator-configured reachable endpoint. Their
  web bundle does not contain a TCP/UDP torrent engine or expose the native
  Torrent provider.

```mermaid
flowchart LR
    T[Tauri player] --> L[Private loopback companion]
    W[Browser / hosted / Android / TV] --> S[Configured OTT server companion]
    L --> V[Per-viewer torrent session]
    S --> V
    L --> P[Packaged resolver]
    S --> P
    V --> C[Bounded verified-piece cache]
    C --> R[HTTP byte ranges]
    P --> U[Resolved source URL]
    R --> E[Player video engine]
    U --> E
```

HTTPS, browser local-network permissions and network reachability still apply.
The current webOS (LG) and Tizen packages do not install a local companion
service on the TV; those clients can use the service on a computer or NAS for
playlist sources. Local LG support requires a packaged webOS service and a
bridge that exposes its owned lifecycle to the player. That integration is not
implemented in the current package.

The local bundled-service design follows
[NuvioTVSmart at commit `3977b0c`](https://github.com/NuvioMedia/NuvioTVSmart/tree/3977b0cabfb4ca338dce5f3fcd9001b2f0e10e30/services/webos):
the app owns a packaged service and uses its local playback endpoint. OTTPlay
uses its own maintained Rust companion core rather than Nuvio's bundled media
runtime. This architecture is the reference for LG integration; packaging,
lifecycle and playback still need validation in OTTPlay's LG build.

The [standalone companion](../src-rs/companion/README.md) also builds as an ARM
executable for the webOS SDK. This executable is a separate building block;
the current LG application does not yet start it or provide its source picker.

The optional companion client requires the browser's Fetch API. The shared
player's ES5 runtime does not add it. Older TV browsers may therefore run the
ordinary player but cannot use companion source playback. Use a newer
browser or WebView where available. Browser API availability does not establish
codec support or compatibility with every TV model and firmware.

## Playback

Select the **Torrent** provider in the Tauri app. Its source and file
selection uses the app's own service. It never adopts the external companion
endpoint, even when one is configured. There is no companion endpoint editor in
the player settings UI.

Open **Torrent: Manage lists** in provider settings, choose **Add new list**, and enter
a magnet URI or public HTTP(S) torrent metadata URL and a source name. The player
reads and saves the playable file list. Each source appears as a category;
choose a file from its channel list to play it. References use stable zero-based
file indices. Metadata loading has a deadline and can be cancelled.

Source preparation shows **Connecting...** while the companion resolves the
source, with a 60-second limit per resolution attempt. Loading the optional
client beforehand has its own 15-second limit. The normal decoder startup
deadline begins only after a playback URL is ready. Pause/resume does not
extend source resolution or start the previous source while preparation is
pending. Cancelling or switching sources discards late results.

M3U entries can contain these source URIs too. This existing source-playback path
uses an explicitly configured external endpoint, or Tauri's built-in service
when the endpoint is empty. Other clients require the complete private endpoint
configured by the operator. Favorites for those catalogue entries retain the
playlist identity and original source, never temporary lease URLs. The Torrent
provider stores its catalogue sources and selected file references without
saving private endpoints or temporary lease URLs. Each playback
gets a fresh viewer lease. Seeking reads byte ranges from the selected file.
Raw and cloud settings backups include the `torrentcfg` catalogue. Importing
Favorites alone transfers references, so the receiving player also needs the
matching catalogue. Named presets and structured settings JSON do not provision
a Torrent catalogue; use the typed catalog API below or a full raw/cloud backup
for that transfer. Private companion endpoints remain installation settings throughout.
Codec support still depends on the video engine; receiving a file does not make
an unsupported codec playable. External AceStream engines remain separate.

Torrent file responses and resolver URLs with a recognized video-file extension
use file playback without changing the saved streaming-engine preference.
Other resolver URLs follow that preference. If a resolver returns a file URL
without an extension, choose Auto or HTML5; the client does not probe arbitrary
endpoints to guess their format.

For a catalogue entry, add the original source to your own M3U:

```m3u
#EXTM3U
#EXTINF:-1 group-title="My media",My video
magnet:?xt=urn:btih:REPLACE_WITH_THE_40_CHARACTER_INFO_HASH
```

Do not copy a running session's `/sessions/.../stream` address into a playlist.
That URL expires with its viewer. The original reference obtains a new session
on the next playback. A file choice is carried as a zero-based `so` index in a
magnet reference, or `index` in an `ottplay-torrent:` reference.

## Movie discovery and language

The first discovery stage adds movie categories, search and metadata details to
the native **Torrent** provider. A metadata result is not a playable torrent:
this stage does not discover streams or promise playback for every film. The
manually maintained source catalog and its file playback remain separate and
available when metadata requests fail or the catalog service is offline.

On a supported native installation, choose **Torrent** in the provider settings.
An empty source catalog opens the movie list. **Category selection** offers
**Popular**, **New releases**, **Genre**, **My sources** and **Favorites**.
Use the normal Search action to find a movie; select a result to read its full
information. **Next page** fetches another page only when requested. Merely
opening a list, highlighting a film or reading its description does not start
a torrent download. **My sources** returns to your existing playable sources.
Choose **Catalog language** in the Torrent provider settings to override the
interface language for movie metadata.

`torrentCatalogLanguage` is a portable preference for the current provider. Its
default empty value follows the effective interface language. An explicit value
uses one of the existing language identifiers, such as `_rus` or `_fra`, and
applies to subsequent categories, searches and details. It does not change the
interface, audio tracks or subtitles. Metadata services may still return their
own fallback text when a translation is unavailable.

By default discovery uses the existing TMDB transport. The installation-only
`torrentCatalogEndpoint` can select a compatible public Stremio TMDB addon for
local validation without a private TMDB key. Its production default is empty;
no public service is selected automatically. Operators configure it through
the existing authenticated settings API, with no endpoint editor in the UI:

```sh
ott TARGET setting torrentCatalogEndpoint --value-file /absolute/private/catalog-base-url.txt
```

The file must contain an HTTPS addon **base URL**, not a `/manifest.json` URL or
a preconfigured JSON path. User information, query strings and fragments are
rejected. Paths can contain private configuration, so reads are masked and both
`torrentCatalogEndpoint` and `sTorrentCatalogEndpoint` are excluded from JSON,
raw and cloud backups. Restoring a backup preserves this installation's current
endpoint. A configured public service receives metadata requests and search
terms; setting it does not enable Torrent on unsupported web-only clients.
Operating a private TMDB-backed service with an operator's own API key remains
a future deployment option; this setting neither stores nor provisions a TMDB
API key.

Movie metadata and images are supplied by [TMDB](https://www.themoviedb.org).
The built-in credits include its official logo and attribution notice.
The logo is retained unchanged from the [official asset](https://www.themoviedb.org/assets/v4/logos/v2/blue_short-8e7b30f73a4020692ccca9c88bafe5dcb6f8a62a4c6bc55cd9ba82bb2cd95f6c.svg).

## Remote catalog control

Authenticated remote control exposes `torrent_catalog: {version: 1}` only when
the player supports its own native service. An external companion endpoint does
not grant this capability. Requests use action `torrent_catalog`, the current
`runtime`, and one of `read`, `read_chunk`, `metadata`, `status`, `cancel`,
`write_begin`, `write_chunk`, `write_commit`, or `play`. Each operation has its own
controller permission, `torrent_catalog.OP`; existing player restrictions still
apply. The API does not enable remote access or change its authorization.

Reads return immutable catalog snapshots without selecting a provider or starting
network activity. `metadata` prepares a playable file list without saving or
playing it. File indices are the native zero-based indices, not positions in a
displayed list. Catalogs preserve stable catalog and entry IDs and original
source references; they contain no private endpoints or temporary stream URLs.

Writes upload strict UTF-8 JSON in canonical base64 chunks of at most 6,144 decoded
bytes, with an 8 MiB document limit and SHA-256 verification. `write_commit` checks
the original catalog revision again and confirms the persisted result. `replace`
adopts the incoming catalog; `merge` requires matching catalog IDs, preserves
existing order and name, and rejects conflicting entries as a whole. Importing
never selects a provider or starts playback. The updated list appears on the next
explicit provider load or play.

Use a UUID for each mutation and retain it if a response is lost. Identical
requests reuse their retained receipt; `status` recovers the result and `cancel`
cancels pending work. Records and snapshots expire after 600 seconds of inactivity;
valid status or chunk access extends the corresponding lifetime. Metadata has a
75-second total deadline. After expiry or reload, an unknown result must not be
automatically retried as a new mutation. `play` uses the normal guarded playback
path; acceptance confirms dispatch, not decoder startup. Cancelling an accepted
play does not stop it.

Catalog and optional portable Favorites imports are separate commits. A client
must validate both before writing and report partial success if Favorites fails.
Unresolved Favorites keep their original references rather than being remapped.

## Server configuration

Create a private directory and configure `OTT_COMPANION_DIR` with its absolute
path. Set `OTT_COMPANION_TOKEN` to a freshly generated random token of at least
32 URL-safe characters. Both are required; the service is otherwise disabled.

The companion has a separate listener; it does not share the control/web server
port. Its default address is `127.0.0.1:8793`, giving the endpoint
`http://127.0.0.1:8793/companion/<your-token>/v1`.
Set `OTT_COMPANION_HOST` and `OTT_COMPANION_PORT` to change that listener.

When upgrading from the shared-listener implementation, change each configured
client endpoint to this separate address. The old companion URL on the player
port returns 404. A previous `OTT_COMPANION_ALLOW_REMOTE=1` does not move the
new listener out of loopback; intentional LAN deployments must also set their
explicit companion host.

The installation-scoped `companionEndpoint` setting accepts this complete
address through the existing authenticated remote settings API. Use a private
UTF-8 file containing the endpoint with the existing CLI:

```sh
ott TARGET setting companionEndpoint --value-file /absolute/private/companion-endpoint.txt
```

Existing remote-control authorization, kiosk and PIN restrictions apply. Reads
only report whether the setting is configured; they do not reveal the address
or token. Changes apply to subsequent source playback. An empty value restores
Tauri's built-in service for playlist sources; the Torrent provider always uses
its own native service. Keep the token out of public playlists, screenshots and
issues. Native discovery does not publish it to other machines.

This endpoint belongs to the installation, not to a provider profile. JSON,
local/raw and cloud backups omit both `companionEndpoint` and its storage key
`sCompanionEndpoint`. Restoring old backups that contain either key leaves the
current installation setting unchanged. Existing locally saved endpoint values
are preserved; importing a profile or backup cannot configure an external service.

Remote clients additionally require `OTT_COMPANION_ALLOW_REMOTE=1`, an explicit
non-loopback `OTT_COMPANION_HOST`, a reachable endpoint and TLS when needed by
the browser. `OTT_COMPANION_ALLOW_REMOTE` does not change the default bind address.
Keep it within the intended trusted network or an authenticated access boundary.
The service does not modify firewall/router rules. Dedicated relay modes cannot
also host it.

## Ownership and storage

Each viewer owns a lease. Stopping one never invokes another viewer's global
stop. Source changes, standby and page exit cancel pending work and playback.
Tauri closes its native service on standby or reload, then obtains a fresh
endpoint when needed. Inactive leases expire if a client disappears.

Only selected-file verified pieces enter the private cache. A boundary piece
may contain neighbouring-file bytes needed for hash verification. The service
does not create the torrent's directory tree in the media library. Cache space,
viewers, peers, metadata and idle lifetime are bounded. `GET /capabilities`
reports the installed limits. A successful handshake proves service availability,
not the presence of peers or successful video decoding.

The cache has exclusive process ownership. After a crash, a new owner validates
the private marker and directory before reclaiming recognized lease files. It
refuses unknown entries instead of deleting user files. This is a temporary
playback cache, not an offline download library: stopped sessions remove their
piece files. The initial implementation allows two viewers and 2 GiB of reserved
piece windows in total. A selected file whose window exceeds the remaining
limit returns `cache_limit`; it does not silently exceed the disk budget.
Ordinary BitTorrent
peer and tracker traffic is distinct from the restricted HTTP metadata and
plugin fetch paths; enabling torrent playback permits that P2P traffic.

## Packaged resolvers

The service ships a direct-URL resolver and loads operator-installed JavaScript
packages at startup. Each execution has an isolated QuickJS context and memory,
stack, time, input and output limits. Scripts cannot import native modules or
read player settings, tokens or filesystem paths. A strict manifest binds each
script to its SHA-256 digest. HTTP callers cannot upload executable code.

See [resolver packages](../plugins/examples/README.md) for the schema, examples
and exact network permissions. Tauri uses `media-companion/plugins` in its
instance data directory. The server accepts an absolute `OTT_COMPANION_PLUGIN_DIR`.
Invalid configured packages reject startup. Restart after changing packages.

## Protocol

All routes are relative to the private endpoint:

- `GET /capabilities`: protocol and actual capabilities.
- `POST /sessions`: admit a source and return a viewer lease.
- `GET /sessions/{id}`: metadata progress, file list and state.
- `POST /sessions/{id}/select`: select a file by index.
- `GET` or `HEAD /sessions/{id}/stream`: selected file with byte ranges.
- `DELETE /sessions/{id}`: release that viewer's resources.
- `GET /plugins`: installed resolvers and capabilities.
- `POST /plugins/{id}/resolve`: bounded JSON request and stream results.

Errors return categories, not source URLs, tokens or local paths. Clients check
the protocol instead of inferring support from the operating system.

The torrent implementation uses [librqbit](https://github.com/ikatson/rqbit)
(Apache-2.0); resolvers use the existing QuickJS integration. Their licenses and
notices remain with the distribution. The adapter and ownership policy are
maintained in this repository.
