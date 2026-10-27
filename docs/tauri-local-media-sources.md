# Tauri direct local sources

The desktop Local videos provider uses the operating system file/folder picker.
Selected videos remain in their original location: app data stores only small
JSON records, not copies of media. A folder selection scans media recursively;
non-media files and symlinks are skipped. Refresh scans the connected folders
again and discovers new files. Existing
IDs and unavailable file references are retained; exact source paths are
deduplicated.

The picker is `tauri-plugin-dialog` 2.7.3, exposed through the application's
`offline_media_import_files` and `offline_media_import_folder` commands. There is
no HTTP API for submitting an arbitrary filesystem path. These commands return
the private loopback endpoint, and the UI fetches its catalog. They do not upload
the picked files to that endpoint.

## Remote Local videos commands

An updated Tauri player also accepts an explicitly requested absolute folder
through authenticated remote control:

```sh
ott t1 local sources
ott t1 local connect /Volumes/data/Movies/
ott t1 local shuffle /Volumes/data/Movies/
ott t1 local shuffle Movies
```

An absolute path refers to the filesystem of the computer running `t1`, not the
working directory of the machine running the CLI. A name such as `Movies` refers
to a source already connected in that player. The native boundary resolves an
absolute path to its canonical directory, checks that it can be read, and saves
the source reference before starting background discovery. Selecting the same
canonical directory again reuses its existing source ID. A new remote connection
is rejected once 32 sources are registered; reconnecting an existing root remains
available. Originals are never copied, and the operating system can still deny
access to the directory.

A newly connected directory cannot contain, or be contained by, another
connected source. The command reports this overlap without adding a partial
source; use the existing source or disconnect that source before connecting the
replacement directory. This avoids losing or duplicating files in the catalog,
which currently keeps one source binding per file. A filesystem root, relative
path, missing directory, or file supplied as a directory is rejected. Discovery
does not follow child symlinks outside the selected tree.

`local sources` returns names and source IDs without private paths. The explicit
`local sources --paths` form can include canonical native paths for a private CLI
profile backup. Windows exports use ordinary drive paths or forward-slash UNC
paths such as `//nas/videos/Movies`; canonical OS paths remain internal for file
access and source identity. These paths are not included in the ordinary HTTP
catalog or playback results. Keep such backups private. Copying a profile does
not copy media or create a matching filesystem on another player.

Preset verification can give `local_media_sources` an optional absolute `path`
filter. The native player resolves aliases on its own filesystem, validates the
directory, and returns its existing binding or an empty list. This read does not
connect a new source or scan media. It keeps remote preset checks accurate when
the same directory has a symlink alias or a different Windows path spelling.

The native commands `local_media_capabilities`, `local_media_sources` and
`local_media_link_folder` are restricted to the main player window and its
existing approved application origins. The frontend checks the authenticated
remote request and advertised capability before invoking them. These commands
do not extend the loopback HTTP API, change playback themselves, or add native
path access to browser, Android, iOS, or TV builds.

Native directory scans have a separate 100,000-entry bound per source, counting
the selected root, subdirectories and non-media entries as well as videos. A
scan that exceeds it reports an incomplete-scan error; remote playback must not
treat its partial catalog as a complete queue. The remote `local play` and
`local shuffle` queue limit is 50,000 playable items. Split a larger source into
smaller, non-overlapping folders. Disconnecting a source while its scan waits
cannot recreate that source or replace its stable ID.

The picker command schedules background discovery and returns without waiting
for the entire directory. The private catalog exposes cumulative items with
`scanning`, `scanned`, nullable `total`, and an optional `scanError`. While it is
scanning, the frontend polls every 250 ms and publishes changed snapshots. Adding
a folder starts playback when an eligible item becomes available; later entries
append without reopening the playing video. When restoring a saved selection,
the frontend passes its stable item ID to `offline_media_endpoint`. The native
library reads that one metadata record and validates its original file before
starting the full background scan. The first catalog can therefore contain the
saved video even when its record would be near the end of directory enumeration.
Playback resumes from the profile's saved position; later catalog batches do
not reopen it. Each Tauri instance uses its own metadata and profile selection.

The preferred lookup accepts only an existing opaque item ID, never a path. It
is bounded so a missing or unresponsive source cannot block scan startup. An
unavailable source still follows the recovery flow. When the source is available
and the saved file is confirmed missing, the first playable file allowed by the
active profile or folder kiosk starts without waiting for the full scan. A lookup
still in progress cannot authorize that fallback. Reading an endpoint during an active scan does not
restart that scan.

Standby cancels pending lookup and scan work. After an explicit wake, an
invalidated catalog is rebuilt in the background with the same saved-item
priority; a completed valid catalog is reused. A late endpoint response from
before standby cannot start a new catalog request.
Acceptance must cover a playing instance entering standby during a partial scan
and waking in the same window. Confirm a new provider load, the same saved file
and position, and continued catalog growth; an accepted wake command alone does
not establish that playback resumed.

The standard loading dialog shows its loading title once and one count of
playable videos found. Internal scan counters remain available for diagnostics
and stall detection; they are not a second visible count or downloaded bytes.
Unchanged polling does not reset the 60-second stall timeout.
The loading window has Cancel for pointer/touch and Back/Esc. Q cancels the
pending request before exiting on PC. Late results cannot reopen the window or
start a video after cancellation; strict kiosk keeps its local-input lock.
Catalog polling does not start a second scan. Explicit Refresh requests a new
scan, and source changes preserve existing item IDs.

The existing Rust byte-range server opens the original files read-only. URLs use
opaque IDs and a random per-process token rather than filesystem paths. JSON
catalogs expose source names, availability, and item source IDs, not full paths.
The local server listens only on `127.0.0.1`.

`offline_media_remove_source` (and the authenticated DELETE source route) removes
the source's metadata and references. It never removes an original linked file.
Legacy private imports remain playable and can still be deleted as private
copies. Missing/moved originals remain listed unavailable instead of triggering
a copy. Reconnect the original drive/folder or choose a new source. macOS privacy
restrictions may require allowing folder access again; this is a desktop Tauri
implementation, not a sandbox security-scoped bookmark implementation.

The shared server distribution retains its explicit upload library. Server
uploads and native desktop source linking are different operations.

Automated Rust core tests cover persisted links, nested scans,
byte-range reads, unavailable originals, unchanged source files after disconnect,
legacy upload behavior, symlink exclusion, canonical path lookup, private path
exports and the source and scan-entry limits. Tauri command tests cover the
main-window boundary. OS-picker UI and actual video decoding need native app
verification.

Official picker API: https://v2.tauri.app/plugin/dialog/
