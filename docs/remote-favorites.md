# Legacy remote favorites across profiles

This page describes the legacy `favorites` protocol and its `fav-…` bookmarks.
The current CLI uses [Global Favorites](mixed-favorites.md) for ordinary `fav`
commands when the player advertises global support. Use `fav legacy` below to
select the legacy protocol explicitly; mapped bookmarks can share entries with
Global Favorites.

Remote favorites save what the target player is actually playing, together with
its provider and profile. You do not need to enter a profile number, channel
number, movie ID or stream URL. Selecting the saved entry loads its profile,
waits for the catalog and resolves the item again through its provider.

Update the player, control server and `ott` CLI to versions that support the
`favorites` capability. `ott NAME caps` reports support; `ott NAME` shows the
available commands. The existing remote-control connection authorizes these
operations. Check the advertised operations: some hosts support only legacy
list/play, without add/remove. Provider restrictions and parental controls still
apply.

## Save and play

Start the channel or film on the target player, then run:

```sh
ott l fav legacy add
ott l fav legacy list
```

The first command saves the current item using its title. To choose a label:

```sh
ott l fav legacy add "Evening film"
ott l fav legacy play "Evening film"
```

Adding the same item in the same profile again keeps its ID. An explicit new
label renames that entry instead of creating a duplicate.

The second command works after changing providers or profiles: the player
returns to the saved context and resolves the saved item. It does not select
whatever happens to occupy the old channel number or reuse a temporary playback
URL. A successful dispatch means the item was handed to playback; it does not
prove that the device has displayed a video frame.

List entries to obtain their stable `fav-…` IDs. Use an ID when labels are
ambiguous, or use a unique case-insensitive name:

```sh
ott l favorites legacy list
ott l favorites legacy play "Evening film"
ott l fav legacy remove "Evening film"
```

`fav`, `favs`, `favorite`, `favorites`, `favourite` and `favourites` are aliases.
Within `fav legacy`, `current` aliases `add`, `rm` aliases `remove`, and
`ott l fav legacy "Evening film"`
is shorthand for `play`. Up to 100 entries can be saved per installation.
The list is stored on the target installation and survives a player restart.
Another device has its own list. Clearing the player's local data removes it.
On older players, or for an unmapped legacy bookmark, removing it deletes only
its cross-profile shortcut and leaves provider-local favorites unchanged. On a
player with the shared Global Favorites store, removing a legacy alias mapped
to a global entry also removes that global entry and all legacy aliases linked
to it. Neither path deletes the underlying channel or media file.

## Identity and storage

The installation-wide index keeps the provider/profile binding and an opaque
source fingerprint alongside the existing channel or media reference. Channel
references use the catalog's item identity. Media references use the owned media
journal and provider resolver described in [Media library and journal](media-library.md).
Profile-local favorite lists keep their existing format and scope.

The source fingerprint distinguishes two profiles with overlapping channel or
film IDs. Replacing a profile's account or source invalidates its old binding;
the command fails instead of playing an unrelated item from the replacement.
Display names are not source identity. Remote replies expose labels and profile
metadata, not credentials, source URLs or provider request payloads.

## Troubleshooting

- **No current item:** start playback first. Highlighting a row in a channel list
  or browsing a film's details does not make it the playing item.
- **Unsupported item:** the player cannot reconstruct this item through a
  durable provider reference. Live TV and provider-backed video are supported;
  an archive programme is not silently converted into its live channel. The
  command will not save a temporary URL as a fallback.
- **Profile changed or unavailable:** restore the saved profile/source, or start
  the desired item in its new profile and add it again.
- **Item unavailable:** the source loaded but no longer contains the saved
  identity, or its provider could not resolve playback. Check that provider on
  the player; the command does not silently choose another item.
- **Ambiguous name:** list entries and select the intended `fav-…` ID.
- **Storage unavailable:** persistent storage could not confirm the write. A
  memory-only value is not reported as a successfully saved favorite.
- **Policy denied:** the target's provider, parental or kiosk policy prevents
  the operation. Remote favorites do not bypass those restrictions.
- **Timeout or context changed:** loading was too slow, or the playback/profile
  context changed during the operation. Inspect the target before retrying;
  the CLI does not automatically repeat a write or play command.
