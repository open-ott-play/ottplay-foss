# Play desktop videos by dropping them into the player

On PC, PC2, and the Tauri desktop shell, select **one or more video files** and drop them together into the player window. The player starts the first file and uses the selected files as a temporary Local queue. This does not add a provider, import a folder, or replace the saved Local library. The configured provider remains saved for later use.

## Drop an M3U or M3U8 playlist

Drop a UTF-8 `.m3u` or `.m3u8` file into the same window. The player reads its entries in order and starts the first one, using the same temporary queue and previous/next controls. `#EXTINF` supplies the displayed title. The playlist can contain HTTP/HTTPS live streams, HTTP/HTTPS video files, or local video paths. HTTP URLs, including signed query strings, are used directly by the player: the OTT server does not download or relay them. Network access, CORS, mixed-content restrictions, codecs, and autoplay policy still apply.

For example:

```m3u
#EXTM3U
#EXTINF:-1,Example live channel
https://media.example.test/live/index.m3u8
#EXTINF:120,Example remote video
https://media.example.test/film.mp4
#EXTINF:90,Example local video
movies/clip.mp4
```

In Tauri, relative local paths are resolved from the playlist's own directory; absolute local paths and local `file:///` URLs are also accepted for supported video files. The playlist author can therefore name local videos outside that directory. Only those individual files receive temporary read capabilities; no directory is imported or scanned. Symlinks and unavailable or unsupported files are rejected. Local media bytes are read from the originals, without copying them into player storage. Playlists from untrusted sources should be inspected before opening because their entries determine which videos or network addresses the player opens.

A browser cannot read neighbouring files merely because a playlist was selected. Drop the local videos together with the playlist, using unambiguous relative paths matching the selected files. Otherwise use Tauri for playlists containing local paths. A browser playlist containing only HTTP/HTTPS URLs needs no additional files.

There are two different uses of M3U8. A channel playlist whose entries point to `.m3u8` URLs opens each URL as **one HLS stream**. A directly dropped HLS manifest containing `#EXT-X-` tags is explicitly rejected; its segment, key, subtitle, and variant references are never treated as separate channels. Put the original HTTP/HTTPS HLS manifest URL in an ordinary channel playlist instead. A public channel-list URL in a dropped playlist is fetched once and expanded in place: its entries replace that URL in the queue. Channel lists referenced by the fetched document are not fetched or expanded. A reference that leaves public address space or cannot be read stays a single stream and reports a closed reason. Nested playlists are not fetched or recursively expanded. VLC/Kodi/header directives do not grant custom HTTP headers or execute commands.

An offer contains at most 128 selected files, at most 128 native local-video grants, and at most 20,000 expanded playlist entries. Each playlist is limited to 8 MiB and all playlist text in one offer to 16 MiB. Empty, malformed, oversized, or partially unavailable offers are rejected as a whole. A failed, cancelled, or superseded read leaves the previous playback intact. This operation never changes the saved provider or creates a persistent M3U profile.

Each drop accepts 1–128 files in the order supplied by the operating system or browser. That order may differ from the order in which you clicked files in Finder or Explorer. The channel list displays the queue, and the normal previous/next controls and Repeat setting apply. Files with identical names remain separate queue entries.

In **Settings → Interface settings**, **Dropped files · Shuffle** starts each new drop in a fresh random order. The queue then keeps that order. **Dropped files** selects **Repeat: All**, **Repeat: One**, or **Repeat: Off** for the dropped queue. These preferences are saved independently of the normal Local videos library. Repeat also applies to the current drop and can be changed under Actions. Repeat One replays the current file on completion; the previous and next controls can still choose a different file. Defaults are Shuffle Off and Repeat All.

Tauri, OTTserver and the hosted player keep the active dropped queue in memory during a network outage. For a directly playable HTTP(S) media file, the player retries the same URL with delays up to 30 seconds between failed attempts and resumes from the saved playback position. The media origin must support byte ranges for reliable seeking. A dropped playlist with 15,000 URLs can use this path without opening or scanning a network volume. Pause suspends reconnects until Play, and leaving or replacing the playback session cancels them. On the HTTPS hosted player, use an HTTPS media origin that the device can reach.

A new accepted drop replaces the previous temporary queue. It does not append to it. If any selected file is a directory, unsupported, empty, or unavailable during preparation, the whole new drop is rejected and the previous playback remains intact. A drag cursor may show a copy symbol; the player does not copy the original media into its library.

The native player prepares one drop request at a time, including all files in that drop. Wait for preparation to finish before dropping or opening another selection; additional requests during validation or handoff are not queued.

## Browser playback

The browser reads each selected `File` through its own temporary object URL. It does not upload the files to the OTT server or persist their bytes in browser storage. Moving to the next queue entry retains the other file references; replacing the queue or leaving its session releases them together.

The browser path accepts MP4, M4V, WebM, and MOV filenames. MKV additionally requires the browser to report Matroska playback capability. AVI is not accepted by this path. Actual playback still depends on the container and codecs supported by the browser and operating system; a filename or capability response is not a guarantee that every stream will decode.

If the browser blocks autoplay on a new page, press Play to start the selected file. The file remains selected; dropping it again is unnecessary.

## Tauri desktop playback

The native path accepts regular, non-symlink MP4, M4V, WebM, OGV, AVI, and MKV files. AVI/MKV use the existing Local compatibility backend and are rejected if it is unavailable. MOV is not part of the native Local format list in this implementation.

The original file is served on demand through the existing private loopback Local media routes. There is no media import, directory scan, or durable source registration. The file must remain available. Native reads recheck the opened file against captured metadata, including device/inode identity on Unix and volume/file identity on Windows. If Windows cannot read that identity, the file is rejected. This is not a snapshot of immutable file contents.

The application event `local-media-drop` carries one opaque grant for the complete selection. The main-window commands `local_media_take_drop` and `local_media_release_drop` consume or release that grant; neither accepts an arbitrary filesystem path. The returned catalog contains ordered temporary HTTP playback URLs. A playlist whose channel-list link could not be expanded reports one closed `notice` code so the player can say why that link stayed a single stream; a plain single-stream drop reports none. A pending grant expires after 30 seconds. At most two groups of up to 128 files are retained while preparing a replacement, including unfinished preparations. Releasing a rejected new grant leaves the previous queue intact.

This is a boundary for the new application API, not a claim that filesystem paths are hidden from the trusted Tauri frontend. Tauri's standard OS drag/drop events can themselves contain native paths. No additional filesystem-plugin or asset-protocol permission is introduced by this feature.

## Open With and default applications

The macOS and Linux packages advertise **MP4, M4V, WebM, OGV, AVI, MKV, M3U, and M3U8** as supported file types. On macOS, registration uses the `Viewer` role and `Alternate` rank. The application does not select itself as your default player. These declarations follow [Tauri's file-association configuration](https://v2.tauri.app/reference/config/#fileassociation).

### macOS: choose a player once or make it the default

After installing a package containing this feature:

1. In Finder, select one supported video file.
2. For this opening only, choose **File → Open With → OttPlay FOSS**.
3. To change the default for that file type, choose **File → Get Info**, expand **Open with**, and select the intended OttPlay application.
4. Click **Change All** only if you want that application to open all files of this type. Repeat with a representative file of another type if you also want to change its default.

These are the standard [Apple instructions for choosing an application to open a file](https://support.apple.com/en-bh/guide/mac-help/mh35597/mac). Choosing an app without **Change All** leaves the change limited to the selected file.

For a managed multi-instance installation, choose the copy explicitly: **OttPlay FOSS.app** is T1, while **OttPlay FOSS 2.app** is T2 (likewise T3/T4). Each copy has a distinct bundle identifier and instance environment. Use the identity-preserving installer when updating them so the chosen copy keeps its own settings; choosing T2 as the file-type default does not mean “whichever player is already open.” If the updated app is missing from **Open With**, its installation and application registration need checking before treating the feature as available.

The macOS implementation handles a selection that launches the chosen app or opens while that app is already running. At launch, it retains the file request until the player page is ready. For an already-running app, it restores the main window if minimized and offers the selection to that instance. Files delivered together by the system form one queue; separate OS requests retain the replacement behavior described above. Both routes use the same temporary Local playback and access checks as a drop.

### Linux and Windows

Linux DEB/RPM packages include a desktop entry with video MIME types and file-argument forwarding. A standalone AppImage needs integration with the desktop environment before it appears in application menus or an **Open With** chooser; merely downloading the AppImage does not establish a menu entry. Choose the integrated application using your desktop's **Open With** or default-application settings.

Windows supports selecting the installed executable manually in **Open With**. Automatic Windows file-association registration is not enabled in this feature, so installation does not assign extension defaults.

On Windows and Linux, this implementation accepts supported video and playlist file arguments when a process starts. Forwarding a second **Open With** request to an already-running process is not implemented. You can drop a selection into the existing player window instead. Audio-only files and MOV are not registered as native video types.

AVI/MKV still require the existing compatibility backend, and supported extensions do not guarantee that every codec will play. Native package installation, Finder/desktop registration, and real cold/warm OS opening have not yet been verified for this change; the behavior above describes the implementation, not a completed native delivery test.

## Restrictions and cleanup

Drop playback is unavailable while kiosk mode is enabled or locked, while parental protection requires access to Providers or Settings, or while the player is in standby. It does not bypass these checks or open a protected configuration flow automatically.

An accepted replacement drop, an explicit provider change, or closing/reloading the page ends the previous temporary playback ownership and releases its object URL or native grant. A rejected pending drop leaves the current video intact. Standby suspends playback work while retaining the temporary source for resume after wake.

Dropped queues are session-only. Reopening the application or browser page does not restore the queue; drop the files again to play them. Saved provider and Local-library configuration continue to use their normal persistence behavior.
