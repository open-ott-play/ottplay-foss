# Remote settings coverage and remaining adapter work

The `player_settings` version 1 API uses the existing typed settings registry and source-bound draft. This inventory is an implementation handoff, not a claim that every persisted configuration field is already covered.

## Registry preferences

`src/settings/index.ts` defines 88 preferences at the baseline for this change. The remote schema is generated from those definitions, so new registry entries such as `uiFontScale` are automatically included. Integer ranges, allowed values, seek durations, language codes and application/provider scope come from the registry. `players` also publishes stable aliases (`html5`, `hls.js`, `shaka`, `auto`).

`bufSize` stores an integer from 0 through 3600, measured in seconds. The engine interprets only 1 through 120 as an explicit buffer; 0 and values above 120 select automatic buffering. Changing it affects the next stream. LG webOS retains the saved `players` preference but uses the automatic engine; the response exposes `effective_value: 3`.

A remote write captures raw saved bytes, source, runtime and per-key revision. It commits through `settingsStore.begin(true, capture)` and confirms the persisted value before reporting success. Existing UI drafts conflict if the same preference changes, including an A→B→A sequence. Missing or invalid stored values are distinguished from effective defaults. Secrets omit current, default and persisted values. Application preferences remain accessible without a loaded catalogue; provider preferences require a usable current provider storage binding.

## Provider adapters

The lazy `remote-provider-fields.js` asset exposes scalar adapters for the current provider and the separate paginated Plex folder collection. The inventory and command examples are in [Individual provider settings](../remote-provider-settings.md).

- M3U profile name, playlist, archive hours and compatibility media URL use `saveConfiguration()`. The shared M3U save now verifies a transaction before publishing configuration or retiring a catalogue; `medSourceId` remains derived state.
- Plex server/token and playback mode use `saveCredentials()` and its real normalizer. Folder selection uses source-bound list/add/remove/clear, supports all 1000 selected roots and feeds the saved roots to the next catalogue scan. Empty selection means all libraries. Legacy two-field setup validation moved into the optional provider-settings asset with a thin active-owner adapter retained on the driver.
- Edem key/CDN/portal/list and Stalker profile settings now use transactional shared save paths. Edem, catalogue and playlist providers invalidate requests only after verified persistence.
- Xtream, OTTCLUB, named-playlist, generic operator and catalogue providers expose only the fields their real credential codec supports. KBC exposes its saved playlist slot; device-derived MAC values remain outside the account-setting schema.
- VPortal name/link fields target the current slot. Its existing off-active compare/write lane remains available without provider switching or wake-up.

A private driver settings port binds remote receipts to saved bytes and revision. It is installed on first remote settings access; normal startup does not load the adapter. The provider UI's existing revision guard invalidates open local drafts after a verified remote write. Values and credentials are never included in operation-history evidence.

## Remaining lifecycle work

- **Interface language:** `ottplaylang` and `ottplaylangmode` use the shared dictionary loader through the optional lifecycle adapter. Desired code/mode are committed together, application occurs after acknowledgment, and dictionary failure restores the previous tuple. A stale language load cannot publish after ownership changes.
- **Remote connection settings:** `command_server` and `local_http` patches bind all three companion fields and apply through actual connection/listener owners after acknowledgment. Active scalar address/credential edits require `atomic_patch_required`. The command server must authenticate within 30 seconds; failure uses a guarded rollback. Missing ACK and crash recovery retain the same desired/previous tuple ownership. SWOP base/UUID changes retire existing sessions and verify identity aliases. See [lifecycle runbook](../remote-settings-lifecycle.md).

## Other typed operations and actions

Volume, aspect, current provider/profile selection, playback, standby/go, restart/exit, kiosk and notifications already have dedicated typed control operations. Their presence does not imply that arbitrary configuration fields are covered by `player_settings`.

Canonical favourites, hidden channels, channel locks and ordering belong to channel-library/favourites operations, not a free-form settings key/value map. Import/export/reset, Plex pairing, provider activation and diagnostic grants are actions with existing ownership/consent flows. They should be exposed as explicit operations when needed, rather than misrepresented as scalar settings.

## Verification expectations

Coverage is complete only when every intended user setting has a descriptor and a supported adapter (or a concrete platform limitation), with tests for scope changes, concurrent UI drafts, failed persistence and truthful application status. Keep this inventory visible until follow-on gaps are implemented; do not document the initial registry API as universal coverage.

## Application timing audit

The registry's media-selection preferences (`players`, `bufSize`, `streamMaxHeight`, `streamMaxBitrate`, `preferredAudioLanguage`, `preferredSubtitleLanguage`) report `next_stream`. Track language defaults are consulted by `applyChannelPreference` when tracks become available, and an explicit per-channel track selection wins. There is no separate codec preference in this registry.

The five subtitle appearance fields await the existing appearance module before saving; their normal apply hook then runs synchronously. Interface size, list position, colour, PiP layout, timezone, editor and sleep timer use their declared existing effects. A missing runtime hook is reported as manual application. Fields without an apply hook are active policy values for later key handling, list rendering, infobar events, history limits and access checks; success does not assert that the current video changed.

`hdmiSupport` remains a legacy preference with no direct HDMI operation in the current build. `autorun` needs follow-on platform work: the current `setAutorun()` reads `stb_autorun`, whereas the registered preference uses `sAutorun`. Their descriptors therefore report manual/platform application rather than claiming that current playback or platform startup changed. Do not silently rewrite either legacy key in this adapter.
