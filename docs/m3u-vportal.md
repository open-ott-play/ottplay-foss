# VPortal profiles

## Standalone VPortal provider

Choose **VPortal** beside Plex in **Change provider** to use the media library
without a TV playlist. **VPortal profiles** contains 15 independently named
slots. Enter the complete cabinet link and choose **Save and load channels**.
The player immediately loads playable videos from the whole portal as a TV-style
channel list. No preliminary folder or section selection is required, including
for existing profiles with no saved sections.

Use the player's standard **Category selection** to filter that list by portal
section, folder or series. **All** shows every discovered video. Nested categories
use names such as `Cartoons / Series`; the parent `Cartoons` includes its descendant
videos. Category selection changes visibility, not the video's identity or the
saved account. Old profile section selections remain stored for compatibility,
but no longer limit the catalog.
Links are masked in summaries. These slots use their own storage. VPortal is
configured only in its standalone provider; M3U is reserved for television.

The standard channel list provides search, favorites, ordering and Actions. Videos can start from the first usable batch while the rest of the portal loads in the background. Selecting a file shows an owned loading dialog; Back cancels it. **Actions → Repeat** controls All / One / Off; **Shuffle / Reset order** uses the existing channel-list actions. See the [shared playlist flow](plex-provider.md).

Highlighting a video shows its title, available description and artwork below
the preview. This works in **All** and in filtered categories. **Description**
opens the same metadata in the larger information panel. Media entries do not
show a television schedule or a "no EPG" warning; ordinary TV channels retain
their programme-guide behavior. Artwork follows the thumbnail setting, and
descriptions follow the description setting. Missing metadata leaves no details
from the previously selected video.

Whole-portal discovery is bounded separately from explicit section and search
queues. It accepts up to 200,000 returned rows, 10,000 pages/containers and 64 MiB
of retained catalog metadata, plus a 32 MiB cumulative identity budget. Long
optional descriptions use a 128-byte UTF-8 text preview; titles, playable requests
and stable identities remain intact. A scan stops after one minute without a validated response; empty successful pages
also count as progress. Each request has its own timeout; there is no overall
whole-scan deadline while validated responses keep arriving. Page, row, identity
and metadata limits still bound the traversal. Discovered videos remain usable
while scanning, but a failed or cancelled scan is never reported as a complete
catalog to remote commands.
Explicit section and search queues retain their existing smaller limits.
For very large portals, the player removes optional description previews once
when the catalog reaches the memory budget. Existing entries keep their identity
and categories, and later entries omit descriptions too. Titles and playback
requests remain complete. If those required fields alone exceed the fixed
budget, discovery stops with an error instead of reporting a partial catalog as
complete.
A whole-portal scan retries the exact same request once after a transport
timeout. The retry keeps the existing inactivity deadline; cancelled requests,
malformed responses and invalid catalog identities are never retried.
Request-backed videos retain their exact playback request instead of a temporary
stream URL or a duplicated internal URL placeholder; starting or repeating a video
resolves a fresh URL. The channel list supplies its own playback placeholder. Videos supplied
only as direct URLs keep their original URL and catalog origin.
Diagnostics report only counters and failure codes, never account links or
request parameters.

The playback footer shows the playing item's folder or collection above its
current and next titles. Current time is the actual local playback-start clock,
including seconds; next time is that clock plus the current item's full duration.
It is an estimate and stays fixed through pause and seek. Unknown duration leaves
the next time blank. The next title follows the active order, repeat and kiosk
policy. See [Plex footer behavior](plex-provider.md) for the shared layout across
browser/server, Tauri and Capacitor builds.

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

Run `ott a1 kiosk on "VIDEO TITLE"` (or a channel number) to pin an entry from the profile’s channel list. Without a channel argument, `ott a1 kiosk on` arms the next channel selection. An explicitly started remote VPortal search queue remains a media queue; `kiosk on` without a channel argument captures that active queue. The kiosk repeats the pinned selection, blocks local navigation/settings and restores it across player reloads. Media addresses are resolved from the saved
provider requests on recovery; signed stream URLs are not kept in the policy.
The policy is bound to the exact VPortal profile/account, including after a
reload. Switching to another profile cannot play identically numbered videos.

VPortal gets a 60-second allowance for initial playback, loop transitions and
recovery attempts on slow devices. After playback starts, ten seconds without
progress triggers recovery. `ott a1 kiosk off`
releases the lock. Use `ott a1 kiosk set "VIDEO TITLE"` to replace a pinned
channel-list entry. To replace a remote search queue, unlock, start the next
queue, then lock again.
This requires the updated player and CLI. Actual provider access and device
codec support remain separate from profile/kiosk configuration.

For child-facing playback on a web player, use the same active VPortal profile
and add the strict kiosk flag. Select the standalone VPortal provider and its
configured slot before running `vp`. If a lock already
exists, release it before changing the source:

```sh
ott l kiosk off
ott l provider vportal
ott l profile 2
ott l vp "tom and jerry"
ott l kiosk on --strict
```

The matched episode queue repeats automatically. Local taps show the video footer
for five seconds. On the active core player, tapping or dragging its timeline
seeks within the current episode. Other playback controls, keyboard/remote seeking,
menus and player exit remain blocked. `ott l kiosk off` releases the lock remotely. A website cannot block
Android system navigation; app pinning with a PIN is separate.
Legacy wrappers that intercept touch without forwarding timeline gestures
retain a read-only footer, even with an updated web player. See
[kiosk mode](remote-command-server.md#kiosk-mode) for input and Android
limitations. `vp` collects matching titles into a queue, subject to catalog
limits; the first-match rule of `kiosk on/set CHANNEL` applies to the normal
channel list, including the visible VPortal category. It does not perform
VPortal search.

## Moving from an old M3U profile

VPortal links are no longer configured or used inside M3U profiles. Television
stays in M3U; select **VPortal** and configure its own profile to watch portal
videos. Enter the complete cabinet link there:

```text
portal::[key:YOUR_KEY]http://your-portal.example/api/v1/
```

Save the link to load the portal, then filter videos using **Category selection**.
Old M3U `medUrl`
and `medSourceId` values are left in device storage, but portal links do not
start a catalog request, appear in M3U settings, or affect TV profile selection.
They are not automatically copied into standalone profiles. Ordinary nonportal
Dune media catalogs retain their existing behavior.

The CLI's M3U settings now accept only `name`, `playlist` and `history_hours`.
Use `ott PLAYER provider vportal` before `profile N vportal LINK` or a VPortal
`profile-config` update. Old M3U fields in named setup files are ignored by the
updated CLI and never sent to the player. Update the player, controller and CLI
together so profile metadata and settings comparisons use the same contract.

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

The real-catalog acceptance check validated 113,972 videos by replaying saved
responses through the production collector, retaining about 60.69 MiB within
the unchanged 64 MiB metadata limit. Two series containers remain unverified
because requests were blocked by an access policy with HTTP 503. This is not
a claim of a completed live catalog traversal.

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
