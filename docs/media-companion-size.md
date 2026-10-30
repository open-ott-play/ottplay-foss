# Media companion size measurements

The companion client keeps torrent session handling, file selection and plugin
menus in the optional `media-companion.js` asset. Startup includes only its lazy
dispatcher, playback hooks and the setting descriptor. The native torrent engine
is measured separately from these frontend assets.

The [machine-readable receipt](evidence/media-companion-size-20261030.json)
compares base `f4dc61d3c6dc107a4b76ff2968bf528b1ff53dd9` with the feature working
tree at version 1.1.62. Both builds use Node 22.23.4, zlib 1.3.1-e00f703 and the
same npm lockfile. Every recorded artifact hash and raw/level-9 gzip size was
rechecked against its bytes. The baseline is a source archive; neither build
claims a clean source revision. A final source-stamped release still passes the
normal artifact gates.

| Component | Raw change | Maximum gzip change |
| --- | ---: | ---: |
| Main entry | +2,197 bytes | +667 bytes |
| New optional companion asset | 12,132 bytes | 4,481 bytes |
| Remote settings lifecycle descriptor | +36 bytes | +9 bytes |
| Complete payload | +14,365 bytes | +5,157 bytes |

All other provider and optional assets are byte-identical. Web entry size is
1,154,754 raw / 353,197 gzip bytes; Tauri and mobile entries are 1,154,712 /
353,257. Complete payloads are 1,683,813 / 519,457 for web and 1,683,771 /
519,517 for Tauri/mobile. These figures include every optional asset even though
normal startup does not fetch them.

## Explicit allocations

`MEDIA_COMPANION_ENTRY_ALLOWANCE` adds the measured entry cost plus 64 raw /
128 gzip bytes for the full source stamp, beta suffix and compression variation.
`MEDIA_COMPANION_OPTIONAL_ALLOWANCE` allocates the complete new asset plus 128
raw / 128 gzip bytes. `MEDIA_COMPANION_SETTINGS_ALLOWANCE` adds exactly the
36 raw / 9 gzip descriptor cost to its existing optional family. Each component
is counted once in the applicable entry, legacy or complete-payload limit.

The tests continue to validate every historical receipt against its original
limits by subtracting these named additions at the newest boundary. They also
retain missing, stale and oversized artifact checks, independent optional-family
limits, provider limits and complete-payload checks. The old providers cannot
borrow the new companion asset's allocation.
