#!/usr/bin/env bash
# Exercise the authenticated Local HTTP pipeline using generated media only.
set -euo pipefail

compat_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compat_ffmpeg="${OTT_TEST_FFMPEG:-$(command -v ffmpeg)}"
compat_ffprobe="${OTT_TEST_FFPROBE:-$(command -v ffprobe)}"
test -x "$compat_ffmpeg"
test -x "$compat_ffprobe"
compat_fixtures="$(mktemp -d "${TMPDIR:-/tmp}/ott-local-compat.XXXXXX")"
trap 'rm -rf -- "$compat_fixtures"' EXIT

"$compat_ffmpeg" -hide_banner -loglevel error \
    -f lavfi -i 'testsrc2=size=160x90:rate=12:duration=12' \
    -f lavfi -i 'sine=frequency=440:sample_rate=44100:duration=12' \
    -c:v mpeg4 -q:v 8 -c:a ac3 -shortest "$compat_fixtures/xvid-ac3.avi"
"$compat_ffmpeg" -hide_banner -loglevel error \
    -f lavfi -i 'testsrc2=size=160x90:rate=12:duration=12' \
    -f lavfi -i 'sine=frequency=660:sample_rate=44100:duration=12' \
    -c:v libx264 -preset ultrafast -g 24 -pix_fmt yuv420p -c:a aac \
    -shortest "$compat_fixtures/h264-aac.mkv"

export OTT_LOCAL_FFMPEG="$compat_ffmpeg"
export OTT_LOCAL_FFPROBE="$compat_ffprobe"
export OTT_LOCAL_COMPAT_FIXTURES="$compat_fixtures"
cd "$compat_root"
cargo test --locked -p ottplay-core \
    real_ffmpeg_http_finite_seek_decode_and_independent_leases \
    --lib -- --ignored --nocapture
