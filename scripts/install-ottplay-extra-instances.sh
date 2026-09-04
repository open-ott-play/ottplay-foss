#!/usr/bin/env bash
# REMOVED: multi-instance player approach.
#
# Multi-origin is now one process with four HTTPS ports (8443-8446).
# The old extra launchd instances fought over ports after #184.
#
# Use: scripts/install-local-stack.sh
set -euo pipefail
echo "install-ottplay-extra-instances.sh is obsolete." >&2
echo "Multi-origin is now one process with four HTTPS ports (8443-8446)." >&2
echo "Run: scripts/install-local-stack.sh" >&2
exit 1
