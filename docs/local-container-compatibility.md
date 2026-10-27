# AVI and MKV compatibility without importing originals

Local videos keeps its ordinary channel list, keyboard controls, profiles,
shuffle/repeat and kiosk behavior. Compatible native/server libraries can prepare
AVI and MKV for the existing player engines. The source stays in its authorized
folder; selecting it does not upload it or import a second movie copy.

## Platforms and requirements

- **Tauri desktop:** the bundled Rust backend can use already installed `ffmpeg`
  and `ffprobe`. It discovers their explicit `OTT_LOCAL_FFMPEG` /
  `OTT_LOCAL_FFPROBE` paths or installed executable locations. A hosted HTML update
  alone cannot install this native backend or those tools.
- **OTT server library:** compatibility runs on the server against folders the
  operator has authorized there. The player uses the existing **Server library…**
  row. Network access to that library is required. The browser never uploads its
  own selected files for conversion.
- **Android/iOS Capacitor:** existing direct native playback remains available for
  containers/codecs supported by that device, including MKV where the native
  decoder supports it. An explicitly configured **Server library…** takes
  precedence over local plugin sources. Use a server address reachable from that
  device; its loopback address refers to the phone/tablet itself. Clearing its
  URL returns to the same
  native handles and grants. This does not add offline FFmpeg transcoding to
  Android or iOS.
- **Plain browser / here.now:** local file playback uses browser-supported codecs.
  JavaScript cannot spawn an installed FFmpeg process or grant a remote server
  arbitrary filesystem access. Xvid AVI is retained as an unsupported reference;
  MKV direct playback requires the browser's declared container support and still
  depends on its codecs. Unsupported entries explain the native/Server library
  requirement. No FFmpeg-WASM input copy or large browser conversion buffer is
  used. An offline-cached player shell does not make NAS/server media offline.

Missing compatibility tools affect AVI/MKV preparation only. Supported direct
MP4 and other formats remain playable. Unavailable/unsupported items keep their
IDs and source references, with no playback URL, rather than disappearing or
silently selecting a different saved video. Switching to a server library uses
that library's separate source identity; existing explicit profile binding rules
still apply. Portable profile exports do not contain runtime leases or source
access grants.

## Output, duration and controls

The backend probes the original only when selected. H.264/AAC in MKV can be
remuxed when its seek/cue structure allows it; incompatible inputs such as
Xvid/AC3 AVI require H.264/AAC transcoding. Remux fallback and unsupported codecs
are backend decisions, never a promise inferred from a filename alone.

Prepared playback uses a lease-scoped HLS URL. Media playlists have a finite
zero-origin source timeline, VOD type and ENDLIST; a master may describe multiple
audio renditions. The client rejects descriptors without a positive finite
duration, `finite: true`, `timeline: "vod"` and `timeOrigin: 0`. It uses the
existing HLS engine rather than treating the playlist as a direct local MP4 or a
live stream. Requested seeks and saved resume positions remain source seconds;
there is no segment-offset subtraction in the player. Completed-video, EOF,
auto-next, shuffle/repeat, volume/seek keys and kiosk decisions remain in their
existing owners.

On a seek, the client retires its old lease and prepares a new one before
attaching the source-time position. A paused seek remains paused. Stop, file
replacement, standby/hidden teardown and cancellation retire only that player's
lease; late asynchronous preparation cannot attach an obsolete URL. Resume on
quit/restart still belongs to the stable Local item ID, not its temporary HLS
URL. Real-device duration, long seeks, EOF and restart acceptance are required;
source tests alone do not establish decoder behavior on every platform. Compatibility
leases expire after five idle minutes. The shared HTML5/HLS player prepares a fresh
lease on Resume; an optional device engine may require Retry/reselect after a very
long pause, retaining the original item and saved source position.

Audio rendition selection uses the player's existing audio-track UI (up to the
backend's eight renditions). This first compatibility path does not carry embedded
subtitles. Existing direct-play subtitle support remains unchanged; do not infer
subtitle preservation from a successful remux/transcode.

The backend bounds generated segments/cache and child processes. These are
discardable playback derivatives, not a full imported source copy. The current
policy is a 64 MiB default global cache, a 256 MiB hard maximum, at most two
processes, and bounded command deadlines. It does not enable MediaHelper, install
executables, mount a NAS, reset privacy permission or change source files.

## Client/backend contract

The catalog advertises `compatibility` with `available`, `formats`, `modes` and
optional `tools_unavailable` reason. A normal direct item may omit `playback`.
An unsupported compatibility item retains its identity with
`playback.mode: "unsupported"` and reason `compatibility_unavailable`.
An enabled item advertises `playback.mode: "compatibility"`, an ID-bound
`prepareUrl` and HLS MIME. Its ordinary catalog URL and item ID stay stable.

The client sends an empty authenticated POST to `prepareUrl`. A successful
response contains `mode` (`remux` or `transcode`), `finite`, `timeline`,
`timeOrigin`, `duration`, `mime`, an opaque 32-character lowercase-hex `lease`,
and its lease-scoped `url`. The client validates origin and the exact
`compat/<item>/<lease>/index.m3u8` path, maps it back to the original item, and
keeps it out of saved profile/selection identity.

Cancellation is an empty POST to the ID-bound sibling `cancel` endpoint with
`X-OTT-Playback-Lease`. An old player's cancellation cannot cancel another
player's newer lease. The server must fence child/cache publication by lease
and standby epoch. Runtime error text and original filesystem paths are not
forwarded into the client notice. Browser/server connection failures and revoked
source access remain failures; they do not trigger imports or permission resets.

The lease protocol loads `dist/local-compatibility.js` on the first compatibility
playback request. The existing Local library screen and editor load
`dist/local-media-ui.js` when that screen opens. Imports, removals and playback
activation keep their main runtime APIs, including synchronous picker gestures.
Direct playback and remote catalog commands do not download either asset. Cancellation applies while a download is
pending; failed downloads can be retried. The file picker still opens directly
from its Enter/click action after the screen has loaded. Both assets remain in
the complete distribution size accounting.
