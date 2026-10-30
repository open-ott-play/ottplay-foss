# STB source review and player improvements

Review date: 29 October 2026. The input was the [dext2ter starred repository list](https://github.com/dext2ter?tab=stars), captured through the GitHub API (26 entries). Repository promises were checked against implementation where source was available. This is an independent implementation in the existing player architecture, not a replacement player or an imported UI.

## Delivered behavior

### Stalker movies in the normal TV interface

Classic Stalker already had a VOD-capable shared core, but the host only exposed its live catalog. Playable movies and nested episodes now join the normal Channel list. Folder paths become categories; available descriptions and posters follow the existing media presentation. Live channels publish first, followed by completed media folders in the background.

The same entries can be added to global Favorites and resolved in a matching configured profile. Internal Favorites provisioning now accepts validated built-in provider identities instead of its former four-provider list; both selectors must agree with the bound provider and still identify a current source. A Favorite carries a stable source/route identity, not a temporary playback URL. Playback obtains a fresh link and rechecks current access policy. Equal leaf IDs in different folders remain separate.

The implementation supports the pinned core's classic `type=vod` folder protocol. A separate `type=series` protocol is not implemented. Very large/slow catalogs may stop at documented bounds and retain a partial result. See [protocol, lifetime and limits](stalker-media.md).

### Xtream descriptions and artwork

Movies, series and episodes now retain descriptions already returned by the core. Refreshed series descriptions also reach the core's parent record. The existing sanitized detail renderer and poster fallback are reused, with no extra network requests or invented metadata. See [Xtream metadata](xtream-media-metadata.md).

### Resource-aware Android buffers

The existing buffer policy can now use the installed Android bridge's physical-memory and low-RAM information. A single optional snapshot has a 1.5-second acceptance deadline and never delays startup. Unsupported bridges retain browser behavior. Accepted information affects subsequent engine construction; it does not rebuild a playing decoder. This connects existing native data to the existing policy rather than copying another player's cache sizes.

### Understandable playback failures

The existing compact ERROR indicator can be opened with INFO, pointer or keyboard. Its details distinguish unavailable content, source load, connection failure, unsupported format, protected playback and sign-in requirements. An explicit Retry is available for an eligible, still-current live stream. Replacement, pause, standby, kiosk, access rules and finite-media reclassification are checked again when the action is used.

The dialog appears only on request. It does not add a footer row or keep the footer on screen. Real progress clears the old failure. Messages use known categories; raw provider responses and playback URLs are not shown.

### Stable local-file recovery

A brief recovery no longer replenishes the local-file retry budget. Ten continuous observed wall-clock seconds of playback are required. Short pause/resume or seek operations between timer samples, native media interruptions and long scheduling gaps break that interval. Faster playback cannot earn ten seconds of credit in less real time. Existing stall deadlines remain in force.

These playback changes use shared code in browser, OTT server frontend, Tauri and Capacitor. The native memory hint is Android-specific. A hosted browser uses explicitly configured Stalker routes backed by a dedicated mode of the existing Rust server. Deployment must update that relay as well as web assets; see [hosted relay setup and verification](stalker-relay.md).

## Source comparison

| Sources inspected | Useful finding | Decision |
| --- | --- | --- |
| [Infinity IPTV](https://github.com/asheeshsahu7300/Infinity-IPTV-Player/tree/22cffb60bb322b18c81699ca2ffa06303ec74bc1), [stalker-ui](https://github.com/santhosh101066/stalker-ui/tree/dc23a13348f0a54854460f57c24595bcae67006d) | Incremental libraries, item artwork, distinct first-load and continuation failures | Expose the VOD capability already present in our shared core; retain bounded sequential requests and cancellation |
| [OwnTV Core](https://github.com/ahXN00/OwnTV_Core/tree/1de78b1e2690c22b50c060e986bce221454bf880) (dependency pinned by the starred OwnTV app) | Native memory classification and sustained healthy playback | Connect our native memory snapshot and strengthen our local retry criterion |
| [OpenTV](https://github.com/opentvproject/opentv/tree/443811904b6437720d37bb1064c0830906c3515f), [IPTVnator](https://github.com/4gray/iptvnator/tree/e480e842ffd62453efebc07c0aed549e312a0d9d), [sbtlTV](https://github.com/thesubtleties/sbtlTV/tree/47b6ac094dcefcfdbc4923e7ec6d3478c9ac9bae) | Explicit playback failures and recover actions | Add details through our owned dialog and existing retry backend |
| [clubTivi](https://github.com/clubanderson/clubTivi/tree/ac690553a7aba33e8f91db653e1ac74e74a9e3b4) | Guide-matching evidence and passive stream-health history | Existing manual guide binding and explicit backup policy remain; history-based ranking needs a separate measured design |
| [IPTVnator TV fork](https://github.com/WilliamMorgan73/iptvnator/tree/9473047ef703f0603255515b6d462816cf93a387) | Desktop remote navigation | Keep our existing cross-platform keyboard/remote system |
| [PortalBridge](https://github.com/Tparag/portalbridge/tree/fa2bf5acd745120acd9cfe505993d97baace0065), [IPTV-Restream](https://github.com/antebrl/IPTV-Restream/tree/d9705451cece0141201d97c76c545b112e675587), [ProxyStream](https://github.com/Abhaikumar007/iptvproxystream/tree/290aac5214f747a8032117e84665406ff87a525c) | Catalog persistence, timestamp-aware synchronization, provider metadata | Retain our transport and metadata boundaries instead of adopting another server stack |
| [Tuvora](https://github.com/paradox-kush/tuvora/tree/677cac93d5df401f9c30a665d8e62cc58423b99f) | Product descriptions | Its reviewed tree is README-only; claimed capabilities are not implementation evidence |

The remaining starred entries are server distributions, a playlist editor, resource indexes, unrelated tools and portal/account checking utilities. Those are not additional player implementations. They do not justify introducing a second server stack or account-discovery functionality.

## Existing capabilities retained

Global Favorites, per-source identity, guarded source changes, explicit backups, quality limits, manual EPG mapping, audio/subtitle selection, desktop shortcuts, screen-off suspension, local media and lazy engine loading already exist. Reimplementing them would create competing state and input owners.

Some attractive claims did not survive source inspection: one warm-switch implementation closes its warmed decoder before reopening the URL, another retry path resets its failure counter during each restart, and some media clients treat failed pages as empty results. These behaviors were not adopted. Cache sizes suited to a desktop were not applied to low-memory tablets.

## Validation and remaining limits

Tests use the shipped shared core with synthetic provider responses, real host adapters and controlled playback clocks. They cover live-first publication, folder routes, partial failures, bounds, cancellation, stale callbacks, current-source Favorites, fresh links, access-prompt races, playback/EOF identity, native snapshot deadlines and continuous recovery time. The failure dialog is exercised with the actual screen ownership controller.

Source tests do not prove compatibility with every provider, decoder or physical Android device. Hardware audio-focus policy, HDMI refresh-rate switching, guide confidence review, passive backup ranking and persistent last-good catalog caches remain separate work. There is no measured startup-speed percentage claim.

See [resource and recovery behavior](player-resource-and-recovery.md) and [Stalker implementation notes](stalker-media.md). Release/installation status is recorded separately from this source design, so a passing fixture is never presented as a deployed-device result.
