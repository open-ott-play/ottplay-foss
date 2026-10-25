#!/usr/bin/env bash
# Independent, signed local app copies. Use prepare/apply with a new work dir;
# the previous shell launchers reused the main executable's LaunchServices ID.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [[ -n "${OTTPLAY_MAIN_APP:-}" ]]; then
  set -- "$@" --main-app "$OTTPLAY_MAIN_APP"
fi
exec python3 "$SCRIPT_DIR/install-ottplay-instance-apps.py" "$@"
