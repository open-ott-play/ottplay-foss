#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
echo "[1] git pull origin main"
cd "$REPO"
git fetch origin main
git reset --hard origin/main
echo "[2] reinstall stack"
"$SCRIPT_DIR/reinstall-local-stack.sh"