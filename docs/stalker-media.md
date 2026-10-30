# Classic Stalker movies and nested series

Classic MAG/Stalker profiles show playable movies and episodes in the normal
Channel list and Category selection. Live channels appear first. The player
then traverses the configured account's VOD categories in the background and
appends each completed category or folder. Folder paths provide category names;
posters and descriptions use metadata retained by the shared core. Provider text
is escaped before display.

For an account with no live channels, the first playable VOD batch initializes
the channel and category library directly. This does not replay startup, start
playback, or close an editor opened while the media catalog was loading.

The implementation uses the bundled OttPlayCore 0.1.4 `StalkerClient` APIs:
`load`, `browse` and `playback`. The matching source revision is
[`97b2d401351702cb10218fd171c2f91abb7be0dc`](https://github.com/open-ott-play/ottplay-core/tree/97b2d401351702cb10218fd171c2f91abb7be0dc).
No second Stalker parser or authentication implementation is introduced. The
legacy JSON-RPC provider path retains its existing live-channel behavior.

## Scope and limits

- This supports the core's `type=vod` movie, season and episode folders. It does
  not implement the separate `type=series` dialect.
- Discovery is sequential and bounded to 120 seconds, 5,000 requests, 5,000
  folders, eight folder levels, 50,000 playable leaves and approximately 64 MiB
  of serialized leaf metadata. The core also validates each paged response.
- Repeated ancestors, malformed pages, limits or transport failures stop the
  scan, report incomplete loading, and retain already published channels.
  Reloading the profile starts a fresh scan. Very large or slow catalogs may
  therefore be partial.
- Metadata is limited to fields preserved by the pinned core: title, description,
  poster and parental classification. No year, rating or runtime is invented.
- The companion relay additionally permits only `vod/get_categories`,
  `vod/get_ordered_list` and `vod/create_link`, under its existing destination,
  header and response-size policies.

## Identity and lifetime contract

Media IDs encode the complete provider folder route plus leaf ID. This separates
media from live numeric IDs and separates equal leaf IDs in different folders.
Names and posters are not identity. The reversible key is capped at the existing
256-character Favorites identifier limit; a longer route stops the scan instead
of being truncated or silently conflated. Numeric channel projection retains the
existing collision checks.

Global Favorites stores the existing `channel` locator with that stable key and
the existing profile binding. It stores neither a playable URL nor credentials.
On profile activation it waits for the matching newly published leaf through an
indexed lookup, with a bounded wait. Empty, failed and canceled scans terminate;
the router's existing missing-source and unavailable-item results are preserved.
The selected, nonplaying channel can be favorited. Arbitrary copied payloads,
foreign sources and ambiguous rows cannot attest a Favorite.

Playback always browses the saved route again, checks the current parental policy,
then asks the core for a fresh link. A 60-second resolution deadline includes
the PIN prompt. Discovery and resolution have separate cancellation owners, so
media selection does not cancel background discovery. Retiring a profile cancels
both and ignores late callbacks. A core playback operation is captured before
an asynchronous PIN prompt so another folder's equal leaf ID cannot change the
command being admitted. Live guide/link operations retain the same core session
and do not consume VOD rows as live-channel metadata.

The global playback proof binds the active driver, profile/load token, source,
canonical media request, actual media reference, playback generation and session.
When fresh metadata replaces a catalog record, the resolver preserves the host's
launch reference only if its source and stable item ID match the admitted request.
Only an EOF proof prepared while that media is current can accept its immediately
following stopped generation.

## Offline verification

Run `node --test tests/test_stalker_media.cjs tests/test_stalker_media_favorites.cjs`.
The former exercises the shipped core with synthetic responses: live-first and
incremental publication, nested folders, posters/text, stable identity, repeated
pages, bounds, cancellation, overdue responses, parallel live operations, fresh
links and PIN races. The latter covers selected and playing capture, source
attestation, indexed rescan waits, finite failures and playback/EOF proof.
The actual host/library regression also covers a VOD-only account and preserves
an open editor's owner, value, caret and focus as media categories arrive.
Neither test contacts a provider. Relay Rust tests are defined in
`src-rs/core/src/stalker.rs`; their execution is separate from these JS tests.
