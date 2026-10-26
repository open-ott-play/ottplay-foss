#!/usr/bin/env python3
"""Create a private M3U overlay; never edit the original or print stream URLs."""
import argparse
import json
import os
from pathlib import Path
from urllib.parse import urlsplit


def overlay(contents: str, mapping: dict[str, str]) -> str:
    if not mapping or not all(isinstance(a, str) and isinstance(b, str) for a, b in mapping.items()):
        raise ValueError("mapping must contain source-to-playback URL strings")
    counts = dict.fromkeys(mapping, 0)
    for source, destination in mapping.items():
        src, dst = urlsplit(source), urlsplit(destination)
        if src.scheme not in ("http", "https") or not src.hostname:
            raise ValueError("invalid source mapping")
        if dst.scheme != "https" or not dst.hostname or dst.username or dst.password or dst.query or dst.fragment:
            raise ValueError("playback mapping must use a private HTTPS entry")
        parts = dst.path.split("/")
        if len(parts) != 6 or parts[1:3] != ["normalize", "play"] or not parts[3] or len(parts[4]) < 32 or parts[5] != "master.m3u8":
            raise ValueError("playback mapping must use a registered entry")
    lines = []
    for line in contents.splitlines(keepends=True):
        plain = line.rstrip("\r\n")
        key = plain.strip()
        if key in mapping:
            counts[key] += 1
            leading = plain[:len(plain) - len(plain.lstrip())]
            trailing = plain[len(plain.rstrip()):]
            line = leading + mapping[key] + trailing + line[len(plain):]
        lines.append(line)
    for index, count in enumerate(counts.values(), 1):
        if count != 1:
            raise ValueError(f"mapping {index} must match exactly one URL line (found {count})")
    return "".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--mapping", required=True, type=Path, help="private JSON object: original URL -> scoped playback URL")
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    try:
        contents = args.input.read_bytes().decode("utf-8")
        mapping = json.loads(args.mapping.read_bytes())
        if not isinstance(mapping, dict):
            raise ValueError("mapping must be a JSON object")
        result = overlay(contents, mapping).encode("utf-8")
        descriptor = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "wb") as output:
            output.write(result)
        print(f"Created private overlay with {len(mapping)} replacement(s); original unchanged.")
    except (OSError, ValueError, UnicodeError) as error:
        # Errors deliberately omit filenames and URL values.
        message = str(error)
        safe = message.startswith(("mapping ", "mapping must", "invalid source mapping", "playback mapping"))
        raise SystemExit("Overlay not created: " + (message if safe else "invalid input or output unavailable")) from None


if __name__ == "__main__":
    main()
