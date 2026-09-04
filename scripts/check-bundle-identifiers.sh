#!/usr/bin/env bash
# HS5-safe snapshot: ensure critical plugin/boot identifiers survive the bundle.
# Does not change runtime window.* publishing — only greps the built classic bundle.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUNDLE="${ROOT}/dist/stbPlayer.js"

if [[ ! -f "$BUNDLE" ]]; then
  echo "error: missing built bundle — run the Vite build first" >&2
  exit 1
fi

REQUIRED=(
  startPlayer
  popupActions
  noProvParam
  optionsList
  listKeyHandler
  chanels
)

missing=()
for id in "${REQUIRED[@]}"; do
  if ! grep -q -- "$id" "$BUNDLE"; then
    missing+=("$id")
  fi
done

if ((${#missing[@]} > 0)); then
  echo "error: classic bundle is missing required HS5/plugin identifier(s):" >&2
  for id in "${missing[@]}"; do
    echo "  - $id" >&2
  done
  echo "These strings must remain in the classic ES5 bundle (terser mangle off)." >&2
  echo "See docs/window-globals.md (CI must-keep)." >&2
  exit 1
fi

echo "OK: bundle identifier snapshot (HS5) — all ${#REQUIRED[@]} must-keep strings present"
