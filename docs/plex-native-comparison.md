# Plex: shared player and native LG target

Source review: 30 October 2026. The shared-player baseline is
`5d8518b1ec8f2049081a5606ee6d8a4fbc367195`. The native runtime is derived from
[PlxNative at aef53a3](https://github.com/GLinnik21/plx-native/tree/aef53a3f6148e41378bb21abd527518a642d733a).
The entries below describe code paths, not measurements on every television.

| Area | Shared OTT-play player | Separate OTTPlay Native target |
| --- | --- | --- |
| Interface | Common channel list, categories, mixed Favorites and Classic/Modern modes | Rust, SDL2 and OpenGL ES; native Plex shelves and details |
| LG application | Hosted web player, `com.openottplay.player` | Installed ARM executable, `com.openottplay.player.native` |
| Server connection | Plex PIN sign-in, verified server selection; browser/native transport adapters | Plex account/QR flow, or explicit managed server configuration; native HTTP |
| Catalog | Progressive flat catalog with cancellation and bounded pages | Plex hubs, movies, series and account features inherited from the native runtime |
| Media choice | Automatic now chooses a supported single-file alternative before conversion | Device codec table, Plex media decision and native playback pipeline |
| Video | Browser or host-specific media backend | Bundled FFmpeg demultiplexing, LG hardware decoder and video plane |
| Audio/subtitles | Tracks exposed by the selected engine; Plex server stream selection is not fully represented | Native Plex Media/Part/Stream handling and player controls |
| Resume/progress | Local playback journal | Native Plex timeline/session behavior; account-scoped features require account login |
| Other providers | M3U, Local, VPortal and the common provider set | Plex only in this first native target |
| Remote protocol | OTT command server and `ott` CLI | Not yet an implementation of the OTT remote protocol |

## What was adopted

The native delivery reuses the complete pinned native media/UI runtime under
its GPL license, instead of replacing the browser with a second browser
wrapper. The overlay supplies OTT-play identity and artwork, independent
storage, managed Plex configuration, and disabled third-party telemetry.
The distribution excludes the upstream platform-modification implementation.
The existing hosted application is not replaced.

The shared player keeps its flat catalog, categories, global Favorites and
queue ownership. Its new pure playback planner selects among Plex **Media**
versions, passes the selected `mediaIndex` to conversion, and preserves the
order of consecutive **Part** entries. It retains existing browser codec
checks, including the refusal to treat an ordinary AVC probe as proof of
High-10 support. Original and Compatible modes keep their previous meaning.

See [Plex provider behavior](plex-provider.md),
[`plex-playback-policy.ts`](../src/plugins/plex-playback-policy.ts), and the
[native build and installation instructions](../native/webos/README.md).

## Boundaries that matter

Native here means that interface rendering and media transport do not use
LG's web engine. The executable still relies on webOS services, system
graphics libraries and the TV's decoder. The Plex server and a network path
to it are still needed for its library and media; this is not an offline
media-copy feature.

The pinned runtime reads the TV's codec table. When that table cannot be
read, it retains upstream's assumed codec profile rather than a hardware
measurement. Actual codec, HDR, audio-output and firmware support must be
checked on the target television; a successful build or desktop simulator
does not settle those questions.

An imported PMS token remains a **server token**, not a Plex account token.
The managed file is applied on each cold launch and removal disables that
configuration. It preserves install settings, but does not provide Plex
Home or account-scoped local preference/history guarantees. Use the normal
QR sign-in for those account features. The native install does not silently
import or synchronize the shared player's Favorites or other provider data.

## Verification

The shared-player regression cases cover alternate versions, multipart
ordering, codec depth, original/conversion modes and cancellation. Native
tests cover profile parsing, token-free identity verification before
authenticated library access, authorization failure, settings preservation,
grant invalidation, and fallback to the normal sign-in path.

Package checks require an ARM executable, native application metadata,
matching application/package/service ownership and dependency notices. They
reject web launchers, host binaries, private profile files and foreign
installation paths. The source and build receipts bind the integration tree,
compiler and IPK digest. A native desktop rendering smoke test uses synthetic
Plex data; physical LG decoder acceptance is a separate device check.
