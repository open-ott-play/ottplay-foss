# EPG diagnostics on the hosted player

The decompressed-input limit is 512 MiB of UTF-8 XML. Count bytes in the
incrementally decoded chunks, not `string.length * 2`: the latter incorrectly
rejected the 457,465,999-byte public feed on 2026-09-28 because its cumulative
UTF-16 representation was 647,854,032 bytes. The full XML is never retained;
separate chunk, channel and retained-cache limits still bound memory.

Downloads allow up to ten minutes in total, but fail after one minute without
receiving additional bytes. Only increasing byte progress extends the idle
deadline. This lets a large public feed finish over a slower connection while
still stopping stalled transfers. A production check on 2026-09-28 received
46,230,420 of 49,166,552 bytes before the former fixed three-minute timeout
aborted the transfer.

The retained programme budget is 192 MiB per cache generation, measured as
`80 + 2 * (title.length + description.length)` per programme. This is a
conservative payload estimate, not measured browser heap or exact disk usage.
A 1,565-channel playlist with up to six days of archive required 203,908 unique
programme records and 134,648,412 estimated bytes: 430,684 bytes above the former
128 MiB budget. The larger budget preserves descriptions and archive windows;
it does not silently discard channels or programmes. The 300,000-record limit,
8 MiB/20,000-record per-channel limits and 4 MiB pending-batch limit still apply.
Parsing and storage remain incremental. Refresh keeps the previous generation
until the replacement commits, so storage must temporarily accommodate both;
browser quota failures are still reported as storage errors.

Open **Information → EPG diagnostics** from the player menu (also available with
a TV remote). The screen stays available after startup and updates while XMLTV
downloads and parses. It shows the source host and index, byte progress, retained
programme count, matched channels, cache timestamp, elapsed time, and the failed
stage with an error code. Source credentials, paths and query parameters are not
displayed; diagnostics remain on the device and are not uploaded.

**OK / Retry EPG download** restarts the worker and requests a fresh guide even
when the saved cache is still fresh. The last accepted cache remains available
until a replacement commits. If the old worker was interrupted while writing,
the replacement waits for its short cache lease to expire. **Back** closes the
screen; up/down scroll its details. A failure also displays a brief notice with
the menu location, rather than only appending to the hidden startup screen.

- `EPG_HTTP` includes the source HTTP status; `EPG_TIMEOUT` is the download timeout.
- `EPG_NETWORK` can mean network, TLS or CORS failure: browsers do not expose
  enough detail to distinguish these through XMLHttpRequest.
- `EPG_INSECURE_SOURCE` means an HTTPS player was given an HTTP-only source.
- `EPG_GZIP`, `EPG_XML*` and `EPG_UTF8` identify corrupt/unsupported input.
- `EPG_STORAGE*` identifies unavailable, blocked or failing IndexedDB storage.
- `EPG_*_LIMIT` identifies an explicit input/cache limit; data is never silently
  truncated to claim a successful guide.
- `EPG_EMPTY` means no usable programmes matched the playlist and time window.
- `EPG_WORKER` or `EPG_STALLED` identifies unavailable/crashed/unresponsive
  background processing. Retrying does not enable an infrastructure fallback.

For a physical-TV report, record the code, stage, source host, progress and model
from this screen. A desktop browser test is not proof of physical webOS support.
