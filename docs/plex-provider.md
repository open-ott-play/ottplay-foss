# Plex on each player

Choose **Plex** in the provider list, then **Sign in with Plex**. The official Plex sign-in page opens in a browser. On a TV, open `plex.tv/link` on a phone or computer and enter the displayed code. Choose an available Plex server after signing in; the player checks its connection and opens the library. **Back** cancels sign-in or server connection.

For a manual connection, enter the Plex server address (for example `http://192.168.1.25:32400`) and its access token, then choose **Save and open library**. The token is masked in the settings screen. Prefer an HTTPS Plex endpoint for an HTTPS browser player: access to local HTTP endpoints depends on the browser's local-network permissions and mixed-content policy. Native players can use the transport supported by their build. The Play distribution retains its HTTPS policy.

Plex is a library provider: it opens library sections, search, folders and media. It does not flatten the collection into TV channels. Switching to Plex preserves other providers' saved connections, playlists and favorites.

**Browse folders** opens the server's filesystem hierarchy. Items without a title
use alternate Plex metadata or a filename, with **Untitled** as a final fallback.
The heading keeps the selected folder's name instead of Plex's generic `Folder`
label. Approaching the last three rows automatically loads the next page into
the same list. **Loading…** is replaced by the next items without moving the
selection or adding another breadcrumb. A failed request keeps the existing
items and offers a selectable retry row; **Back** still opens the parent folder.
Selecting a video starts an ordered queue of that folder’s files. Natural completion
plays the next file in the same folder, including files on later catalog pages.
The selected filename and an animated loading dialog appear immediately while
the player collects the folder and resolves the file. Other list selections are
blocked during this wait. **Back** cancels and keeps the same file selected;
a connection error returns to the list for retry. Once the stream is handed to
the decoder, its normal buffering indicator follows actual video readiness.
Subfolders are excluded. **Shuffle: Off** starts its videos in a random order. The
queue includes every page of that folder and applies the current title filter;
it does not descend into subfolders. A failed page cancels the new queue.

During full-screen Plex playback, **Left/Right** seek backward/forward by
10 seconds and **Up/Down** play the next/previous file. These controls also apply
to a remote Plex queue while another TV provider is selected. Dedicated volume
buttons still control volume; open lists and dialogs retain their own navigation.

The playback buttons appear beside the description. **Repeat** cycles through
**All**, **One**, and **Off**: repeat the queue, repeat the current video, or finish
after its last video. Remote shortcuts are **5** (or **Play**) for shuffle and
**9** for repeat. Shuffle visibly changes from **Off** through **Loading** to **On**.
Press **5** again to cancel loading or switch the current queue back to folder
order without restarting the video; **Play** explicitly starts a fresh shuffle.
Both the keyboard number row and numeric keypad work. The repeat preference is
saved per media source. Back, Stop,
changing the filter or choosing another item cancels a pending queue launch.

On reopening the player, Plex continues the last unfinished video at its saved
position, including seconds within the first minute. It resolves the Plex item
again instead of retaining an expiring stream URL. **Enter/OK** reopens the saved
folder with the playing file selected; **Back** returns through its saved
breadcrumbs. The folder queue is rebuilt from the current server catalog and
continues from that file, respecting the saved repeat setting. Older checkpoints
restore the saved folder directly even when they do not contain its full
breadcrumb trail. Tauri saves the current
position before its explicit Exit action. If the file is unavailable, the
library opens for another selection. Disabled watch history and finished videos
do not trigger automatic playback; the parental PIN still applies.

The **Playback** setting offers:

- **Automatic** — original files when the current device reports support; compatible HLS when conversion is needed.
- **Original file** — direct playback, using the device's own decoder.
- **Compatible HLS** — Plex prepares a stream for the player. Conversion speed depends on the Plex server and source format.

When the device supports HEVC through Media Source Extensions, compatible HLS uses fragmented MP4, preserves HEVC video at its source resolution and requests AAC audio. For HEVC/Opus files this avoids unnecessary video encoding on the NAS while adapting audio for WebKit.

The selected server address, its access token and playback preference are stored in the current device's provider profile as `plexcfg`. Account sign-in also saves that server's identity and connection candidates. Each time the provider opens, it checks which connection is reachable, so a laptop can move between home Wi-Fi and the internet without signing in again. Browsing history stays associated with the same server and server credential. Editing the address or token manually clears these account connection candidates.

Remote control can update the selected Plex provider through the `provider_settings` request with `{"provider":"plex","settings":{"server":"https://plex.example:32400","token":"YOUR_SERVER_TOKEN"}}`. First setup requires the server and token together. Later requests may update either field; the omitted credential and playback preference are preserved. Provider restrictions and the player's parental settings lock still apply. Tokens must contain no whitespace or control characters and must be at most 1024 characters. Server URLs must use HTTP or HTTPS, with no embedded credentials, query, fragment, or parent-directory path segments.

A successful response contains only the field names, `provider: "plex"`, and `saved: true`; it never includes the token or server address and does not claim that connection succeeded. Saving retires the old library and reloads the provider. Changing either credential clears account connection candidates; other providers' settings remain untouched.

Account sign-in tokens remain in memory during server discovery. No environment variables, central player-server configuration or NAS deployment are required. A settings backup containing this profile also contains its server credential.

## Ordered queues from the command server

An updated player and controller support an explicit list of Plex `ratingKey` IDs:

```sh
ott l plex preview 78777 78776 78775
ott l plex play 78777 78776 78775
ott l plex queue
ott l plex next
ott l plex prev
ott l plex stop
```

The player uses its existing saved Plex profile even while a TV provider such as
M3U is selected. It checks the server and all requested metadata, then resolves
the first stream before handing playback over. The selected TV provider and
saved credentials remain unchanged. A failed preparation leaves existing
playback and any previously accepted queue intact. `preview` checks ordered
metadata without starting playback or replacing a queue. If another remote
request is preparing playback, preview waits behind it. It does not test
physical decoder compatibility.

`play` starts the first ID at zero, ignores saved resume positions, and plays the
IDs exactly in the supplied order. `plex play --shuffle ID...` shuffles the
complete input once in the CLI. Without kiosk, completion of the last item stops
playback. Manual next/previous at a boundary returns an
error without stopping the current item. The completed queue remains available
for status and previous. `ott l next` and `ott l prev` use that accepted queue
until `plex stop` clears it. A failed first queue request does not take over TV
channel navigation. Stop only stops video still owned by the queue, so clearing
an old queue cannot stop a TV channel selected afterwards.

Status distinguishes `preparing`, `playing`, `paused`, `ended`, `error`, and
`idle`; its index is zero-based. Requests contain 1–500 positive decimal IDs
without leading zeros. Responses contain IDs, bounded titles and static errors,
never stream URLs or credentials. Commands target the discovered player runtime;
a reload creates a new runtime and clears this in-memory queue. Disconnecting
remote control cancels a pending launch, but an already accepted queue continues
autonomously through natural completion. A CLI timeout does not prove whether
playback started: inspect status before issuing another play request. The player
processes remote requests serially, so a status or preview command queued during
slow preparation waits for that bounded request to finish.

After restarting the player, use `ott l` to check that it is ready before
starting or stepping a queue. Playback requests are refused while the initial
provider load is incomplete; preview, status and stop remain available. An old
archive-resume prompt cannot override a newer playback command.

`playing` confirms the managed video decoder's state, not that its picture is
visible above every window or overlay. When diagnosing a TV, check the physical
screen as well as status. Decoder errors remove the `playing` state until
playback is confirmed again; they never count as natural completion or skip to
the next film.

If preview reports missing configuration, save a Plex profile on that player.
If it reports connection failure, check that the saved endpoint is reachable
from the player, rather than only from the CLI machine. HTTPS browser players
can still be blocked by mixed-content, CORS or local-network policies; the queue
does not bypass those restrictions or invent a proxy. Native platforms use their
existing Plex transport. Kiosk restrictions still apply when playback is
committed. Ordinary films work with the default parental settings; items
explicitly marked adult require local parental access before starting the queue.
A refused handoff restores the prior media runtime, including its natural-end
continuation, rather than publishing a replacement queue that never started.
Successful playback closes the channel/media list and cancels its stale TV
preview, without restoring PiP. It does not discard an open unsaved settings or
input dialog; close or finish that local draft to uncover the full video.

To retain and loop the queue across application restarts, select the Plex provider,
start the required queue, then enable kiosk:

```sh
ott f10 provider plex
ott f10 plex play --shuffle 78777 78776 78775
ott f10 kiosk on --strict
ott f10 kiosk status
```

Kiosk repeats the same complete shuffled order and stores provider requests,
source identity, cursor and position without retaining expiring stream URLs.
After a page reload, use `kiosk status` for the durable queue; the separate remote
queue controller is in-memory. Use `kiosk off` before replacing the queue or
updating the application. Strict mode blocks local navigation and playback
controls while allowing the information footer for five seconds. On the active
core player, tapping or dragging its timeline seeks within the current episode;
other controls remain locked. This support
is shared by browser/hosted, server, Tauri, and Capacitor Android/iOS builds.

If Plex cannot connect while kiosk is locked, the player keeps the saved kiosk
policy and does not open Plex settings or a modal connection-error dialog.
Inspect `ott f10 kiosk status` for recovery progress. To repair the connection
or edit settings, explicitly unlock the player first:

```sh
ott f10 kiosk off
ott f10 restart
ott f10
ott f10 plex preview 78777 78776 78775
ott f10 plex play 78777 78776 78775
ott f10 plex status
```

Wait for the restarted player to reconnect and finish loading its provider
before starting playback. If necessary, repair its saved Plex connection while
unlocked. `preview` checks server access; confirm actual playback before enabling
`ott f10 kiosk on --strict` again. On older builds that already opened Plex
settings under a strict lock, `ott f10 kiosk off` restores local navigation;
restarting alone retains that lock.

The wire contract is `plex_queue` with `op`, exact `runtime`, and `ids` for
`play`/`preview`. `capabilities.plex_queue` advertises version 1, supported
operations and `max_items: 500`. The CLI respects older players that still
advertise a smaller maximum. The shared examples and bounds are in
[`contracts/plex-queue-v1.json`](../contracts/plex-queue-v1.json).

For access away from home, the selected Plex server must have a reachable remote connection. Plex may impose account or subscription requirements for remote personal-media playback; see [Plex remote playback requirements](https://support.plex.tv/articles/requirements-for-remote-playback-of-personal-media/).

Developer checks:

```sh
node tests/test_plex_provider.cjs
node tests/test_remote_plex.cjs
npx playwright test tests/browser/remote-plex.spec.cjs
npx tsc --noEmit
```

The provider tests cover local profile isolation, masked token editing, authenticated readiness, cancellation of stale connection callbacks, account sign-in, server choice and cancellation after switching providers. Transport and account-service protocol tests live alongside their respective Plex plugin tests.
