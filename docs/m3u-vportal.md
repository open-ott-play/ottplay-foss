# VPortal with an M3U TV playlist

## Standalone VPortal provider

Choose **VPortal** beside Plex in **Change provider** to use the media library
without a TV playlist. **VPortal profiles** contains 15 independently named
slots. Enter the complete cabinet link and select **Save and open library**.
Links are masked in summaries. These slots use their own storage; existing
VPortal links in M3U profiles are preserved and do not change with these slots.

The current provider determines which profiles the remote CLI manages:

```sh
ott a1 provider vportal
ott a1 profile-config 1 /path/to/private-vportal-profile.json
ott a1 profile 1
ott a1 profiles
```

The private JSON file contains `name` and `vportal`. Standalone profiles do not
accept playlist URLs or archive hours. Profile responses contain only names,
slot numbers and configuration flags; they never return the cabinet link/key.

### VPortal kiosk

Start a film, series or remote VPortal queue, then run `ott a1 kiosk on` without
a channel query. The kiosk locks that video's existing episode queue, repeats
it, blocks local navigation/settings and preserves the current episode and
position across player reloads. Media addresses are resolved from the saved
provider requests on recovery; signed stream URLs are not kept in the policy.
The policy is bound to the exact VPortal profile/account, including after a
reload. Switching to another profile cannot play identically numbered videos.

VPortal gets a 60-second startup allowance for slow devices; after playback
starts, ten seconds without progress triggers recovery. `ott a1 kiosk off`
releases the lock. To replace the selection, unlock, choose the next film or
queue, then lock again. `kiosk set CHANNEL` remains the live-TV command.
This requires the updated player and CLI. Actual provider access and device
codec support remain separate from profile/kiosk configuration.

For child-facing playback on a web player, use the same active VPortal profile
and add the strict kiosk flag:

```sh
ott l provider vportal
ott l profile 2
ott l vp "три кота"
ott l kiosk on --strict
```

The matched episode queue repeats automatically. Local taps show the video footer
for five seconds. On the active core player, tapping or dragging its timeline
seeks within the current episode. Other playback controls, keyboard/remote seeking,
menus and player exit remain blocked. `ott l kiosk off` releases the lock remotely. A website cannot block
Android system navigation; app pinning with a PIN is separate.

## VPortal alongside television

The M3U provider can use a VPortal media library independently of its TV
playlist. In the selected playlist's settings, enter the ordinary M3U/M3U8
channel URL in **Playlist URL** and the full portal value in **VPortal link**:

```text
portal::[key:YOUR_KEY]http://your-portal.example/api/v1/
```

Save it, return to the player menu, and open **Show Media Library**. The portal
provides its categories, videos, search, filters, and subsequent pages. Videos
with multiple quality variants offer a selection before playback. Portal content
does not become TV channels.

The link is stored separately for each M3U slot using the existing `medUrl`
setting. Previously saved VPortal links in that setting work without re-entry.
The key is masked in the playlist summary; the editor still shows the full
value. Entering a portal value in **Playlist URL** displays an explanation
instead of trying to fetch it as a playlist.

Existing ordinary media catalogs on Dune are retained for compatibility. The
new setting accepts VPortal links or an empty value; it does not advertise a
general catalog editor.

## OTT server and native apps

Browser clients send portal API requests through `POST /vportal/api` on their
OTT server. Update the server and frontend together. Native apps use their
existing native HTTP transport. API calls are asynchronous; leaving the view,
changing the source/provider, cancelling, or selecting another video retires
pending work.

The server route accepts JSON `{ "url": "...", "params": { "app": "ott-play",
"key": "..." } }` and returns the upstream JSON/status. It uses the existing
bounded proxy and destination policy; it does not forward keys to another
origin on redirect. Request bodies and portal keys are not logged.

Media URLs returned by the portal still need to be reachable and playable on
the client. This integration does not transcode video or proxy its media bytes.
In particular, an HTTPS browser page needs usable HTTPS media URLs. A local
fixture verifies the integration, but an actual subscription, its streams, and
physical TV devices require separate playback validation.

## Remote title search and repeat playback

With the updated command server, CLI and player connected, run:

```sh
ott t1 vp --list "title fragment"
ott t1 vp "title fragment"
```

The first command lists matching videos and episodes. The second collects all
matching search pages, starts the first result, then plays each result in order
and loops back to the first. Use `o1` or another configured player name to target a
different instance. Search is case-insensitive. Stop playback to interrupt the
queue. See [Remote VPortal queues](media-library.md#remote-vportal-queues) for
cancellation, URL renewal and catalog limits.

Updated players also accept `exact:` followed by a JSON array of 1–20 distinct
movie titles. The existing CLI and controller forward this as a normal query:

```sh
ott fire8 vp --list 'exact:["Винни-Пух","Винни Пух идёт в гости","Винни Пух и день забот"]'
ott fire8 vp 'exact:["Винни-Пух","Винни Пух идёт в гости","Винни Пух и день забот"]'
ott fire8 kiosk on --strict
```

Each title must identify exactly one playable movie; matching ignores case but
preserves punctuation. The queue follows the supplied order and loops. Missing
or ambiguous titles reject the whole selection without starting a partial queue.
Series folders are not expanded in this mode. The entire query retains the
remote command's 1024-byte limit and the search's shared time and paging limits.
Preview the exact selection on the target player before starting it.
