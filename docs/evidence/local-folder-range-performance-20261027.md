# Native folder scanning during playback

The final implementation completed a fresh, unindexed copy of 13,657 metadata
records in **28.831 seconds** while reading video through the real loopback HTTP
Range handler. Its 46-item selected folder was ready after **22.606 seconds**.
All legacy item IDs were preserved; the large source retained 13,608 available
and three unavailable items. Both measurements met the 45-second test budget.

These are isolated core-harness results, not a claim about installed-player or
decoder performance. The [source-bound measurements](local-folder-range-performance-20261027.json)
include source/binary hashes, exact counts, timings, and evidence hashes.

## What changed

Folder scans validate each saved metadata record before reusing its ID. They
then discover original-file availability during directory enumeration instead
of first canonicalizing every known original and inspecting it again during
the walk. Known regular files reuse the no-follow type that Tokio already
obtained during enumeration. New files, directories, and individual-file
sources retain their applicable metadata and access checks.

Directory identity is checked before enumeration and at completion. Modification
stamps detect ordinary changes while walking a directory. This is not an atomic
filesystem snapshot: network attribute caches and later changes still exist.
Catalog availability describes the enumeration-time observation. Every actual
media read and preferred-item lookup retains the full token, metadata, source,
and original-path checks; a cached type never authorizes serving a file.

## Controlled comparison

Each run used the same two source bindings and authoritative metadata. The video
reader consumed sequential 256 KiB ranges on a 1.49 GB file, paced at 250 ms,
validated HTTP 206, Content-Range and body length, and discarded payloads.
Catalog polling ran every 500 ms. Scans were capped at 180 seconds, with bounded
reader/background draining and a separate 270-second process limit.

| Version and metadata preparation | Selected folder | Full completion | Large-source walk | Actual video bytes |
| --- | ---: | ---: | ---: | ---: |
| Baseline, fresh copy without indexes | 25.641 s | Not complete at 180 s | Still running | 164,888,576 |
| Walk-first only, fresh copy without indexes | 18.595 s | 92.573 s | 72.326 s | 94,109,696 |
| Final, reused metadata without indexes | 2.008 s | 11.226 s | 7.178 s | 11,534,336 |
| Final, fresh copy without indexes | 22.606 s | 28.831 s | 6.387 s | 26,738,688 |

The final fresh-copy run spent 21.159 seconds obtaining the large source's
metadata, 0.956 seconds validating saved records, and 6.387 seconds walking the
source. The baseline spent 100.008 seconds validating originals before its
second walk, which was still incomplete at the cap. No run had a Range-reader
error, and all reached zero pending background jobs after standby.

OS and NAS caches were **not purged**. Runs were sequential, and the reused-
metadata result is deliberately separated from the fresh-copy confirmation.
The figures demonstrate the removed duplicate work and the measured budget
result; they do not isolate every cache effect or promise a fixed latency on
other networks.

## Correctness checks and limits

The core suite passed 164 tests, with three existing tests ignored. Targeted
coverage includes legacy IDs and unavailable references; stale or changed
metadata indexes; initial symlinks; cached leaf replacement; parent/root
replacement; incomplete subtrees; cancellation and generation ownership; and
independent completion of a selected source while another source is blocked.
The leaf-replacement regression verifies that actual serving rejects the
replacement even after a regular-file type was prefetched.

This change adds no containers, codecs or transcoding. A connected folder can
still have no playable entries when its files are unsupported. Inspect
`supported_formats` when the player advertises it and diagnose decoder support
separately. Installed-player playback and deployment verification remain
separate acceptance steps.
