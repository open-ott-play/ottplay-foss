#!/usr/bin/env bash
# Proposal only: run once in the same hosted Ubuntu 26 / pinned Playwright job,
# after its existing install/build steps. No decoder ranks or media code change.
set -euo pipefail
diag_dir="$(mktemp -d "${RUNNER_TEMP:-/tmp}/plex-gst.XXXXXX")"
collect_diagnostics() {
    result=$?
    trap - EXIT
    mkdir -p build/device-browser-results/gstreamer
    # The normal failure-artifact upload already includes this directory.
    find "$diag_dir" -maxdepth 1 -type f -name 'gst-*.log' -exec cp {} build/device-browser-results/gstreamer/ \;
    exit "$result"
}
trap collect_diagnostics EXIT
export OTTP_PLEX_RELOAD_DIAGNOSTICS=1
export GST_DEBUG_NO_COLOR=1
# State transitions are DEBUG; general WebKit/decoder messages stop at INFO.
# No LOG/TRACE/per-buffer logging, plugin rank changes, or alternate decoders.
export GST_DEBUG='2,GST_STATES:5,GST_EVENT:4,webkit*:4,playbin*:4,decodebin*:4,playsink:4'
export GST_DEBUG_FILE="$diag_dir/gst-%p.log"
# Outer watchdog only bounds a hung browser teardown; test's 60s/15s limits,
# assertions, retries=0, routes, local media, and production code are unchanged.
timeout --signal=TERM --kill-after=10s 180s \
    npx playwright test tests/browser/plex-provider.spec.cjs \
    --grep 'Plex aspect persists through media changes and reload: hls\.js$' \
    --browser=webkit --workers=1 --retries=0
