#!/usr/bin/env bash
# Fetch only Samsung's pinned TV Web Simulator, without the firmware emulator.
# Extract vendor files; do not run installers, accept licenses or alter an SDK.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VERSION=10.0.6
ARCHIVE_NAME="tv-samsung-websimulator-core_${VERSION}_macos-64.zip"
ARCHIVE_SIZE=207640744
ARCHIVE_SHA256=d1454e448742d75580917b91f6a21953785af0b53fd78f148162fb1005ed708f
DOWNLOAD_URL="https://download.tizen.org/sdk/extensions/tv_extensions/binary/$ARCHIVE_NAME"

usage() {
    cat <<'EOF'
Usage: scripts/setup-tizen-simulator.sh [options]

  --destination DIR  New directory to extract the macOS simulator into
                     (default: ~/.local/share/ottplay/tizen-tv-simulator/10.0.6)
  --cache DIR        Download cache (default: build/vendor-tools/samsung)
  --dry-run          Print paths and commands without downloading or extracting
  -h, --help         Show this help

Downloads the official Samsung TV Web Simulator 10.0.6 package (207,640,744
bytes). Requires macOS, curl, Python 3 and ditto. The Intel application uses
Rosetta. Existing destinations are never overwritten. No license acceptance,
vendor installer execution, firmware download or simulator launch occurs.
EOF
}

die() { printf 'Error: %s\n' "$*" >&2; exit 1; }
need_value() { [[ $# -ge 2 && -n "$2" && "$2" != --* ]] || die "$1 requires a value"; }

destination="$HOME/.local/share/ottplay/tizen-tv-simulator/$VERSION"
cache="$PROJECT_ROOT/build/vendor-tools/samsung"
dry_run=0
while [[ $# -gt 0 ]]; do
    case "$1" in
        --destination) need_value "$@"; destination="$2"; shift 2 ;;
        --cache) need_value "$@"; cache="$2"; shift 2 ;;
        --dry-run) dry_run=1; shift ;;
        -h|--help) usage; exit 0 ;;
        *) die "Unknown option: $1 (see --help)" ;;
    esac
done

[[ ! -e "$destination" && ! -L "$destination" ]] || die "Destination already exists; refusing to overwrite: $destination"
archive="$cache/$ARCHIVE_NAME"
printf 'Samsung TV Web Simulator %s; archive: %s bytes\n' "$VERSION" "$ARCHIVE_SIZE"
printf 'Source: %s\nDestination: %s\n' "$DOWNLOAD_URL" "$destination"
if [[ "$dry_run" == 1 ]]; then
    printf 'Download:'
    printf ' %q' curl --fail --location --output "$archive" "$DOWNLOAD_URL"
    printf '\nExtract after validation:'
    printf ' %q' ditto -x -k "$archive" "$destination"
    printf '\n'
    exit 0
fi

[[ "$(uname -s)" == Darwin ]] || die "This package is for macOS"
for required_command in curl python3 ditto; do
    command -v "$required_command" >/dev/null || die "$required_command is required"
done
mkdir -p "$cache"
if [[ ! -f "$archive" ]]; then
    download_temp="$(mktemp "$cache/.tizen-simulator-download.XXXXXX")"
    trap 'rm -f "$download_temp"' EXIT
    curl --fail --location --show-error --connect-timeout 10 --max-time 900 \
        --output "$download_temp" "$DOWNLOAD_URL"
    mv "$download_temp" "$archive"
    trap - EXIT
fi

# Validate before extraction, including archive paths and bundled symlinks.
# SDK packages can have a data/ prefix; find the actual app instead of guessing.
app_relative_path="$(python3 - "$archive" "$ARCHIVE_SIZE" "$ARCHIVE_SHA256" <<'PY'
import hashlib, pathlib, posixpath, stat, sys, zipfile

archive = pathlib.Path(sys.argv[1])
if archive.stat().st_size != int(sys.argv[2]):
    raise SystemExit('Archive size differs from the official package; remove the cached file and retry.')
with archive.open('rb') as source:
    digest = hashlib.sha256()
    for chunk in iter(lambda: source.read(1024 * 1024), b''):
        digest.update(chunk)
if digest.hexdigest() != sys.argv[3]:
    raise SystemExit('Archive checksum differs from the pinned official package; remove the cached file and retry.')
apps = []
with zipfile.ZipFile(archive) as package:
    for info in package.infolist():
        path = pathlib.PurePosixPath(info.filename)
        if path.is_absolute() or '..' in path.parts or '\\' in info.filename:
            raise SystemExit('Unsafe path in archive: ' + info.filename)
        if stat.S_ISLNK(info.external_attr >> 16):
            target = package.read(info).decode('utf-8')
            resolved = posixpath.normpath(posixpath.join(str(path.parent), target))
            if target.startswith('/') or resolved == '..' or resolved.startswith('../') or '\\' in target:
                raise SystemExit('Unsafe symlink in archive: ' + info.filename)
        if info.filename.endswith('nwjs.app/Contents/MacOS/nwjs'):
            apps.append(str(path.parents[2]))
    if len(apps) != 1:
        raise SystemExit('Expected one nwjs.app in the official archive; found ' + str(len(apps)))
    print(apps[0])
PY
)"

destination_parent="$(dirname "$destination")"
mkdir -p "$destination_parent"
staging="$(mktemp -d "$destination_parent/.tizen-simulator-extract.XXXXXX")"
trap 'rm -rf "$staging"' EXIT
ditto -x -k "$archive" "$staging"
[[ -x "$staging/$app_relative_path/Contents/MacOS/nwjs" ]] || die "Extracted Simulator executable is missing or not executable"
printf '%s\n' "$app_relative_path" > "$staging/simulator-app-path.txt"
[[ ! -e "$destination" && ! -L "$destination" ]] || die "Destination appeared during extraction; refusing to overwrite"
mv "$staging" "$destination"
trap - EXIT
printf 'Vendor files extracted: %s\n' "$destination"
printf 'Review the Samsung license files supplied with the package before launching.\n'
printf 'Launch:'
printf ' %q' "$SCRIPT_DIR/run-tizen-simulator.sh" --sdk "$destination"
printf '\n'
