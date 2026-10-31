#!/usr/bin/env python3
"""Use Ubuntu's primary archive and HTTPS ARM ports transport in CI."""

import argparse
import os
from pathlib import Path
import re
import sys


AZURE = re.compile(r"(?<![\w@./:-])(https?://)azure\.archive\.ubuntu\.com(?=[/\s]|$)")
PORTS = re.compile(r"(?<!\S)http://ports\.ubuntu\.com/ubuntu-ports(?=/?(?:\s|$))")


def rewrite(text):
    # Leave comments, suites, architecture restrictions and signature settings intact.
    lines = []
    for line in text.splitlines(keepends=True):
        active, marker, comment = line.partition("#")
        active = AZURE.sub(r"\1archive.ubuntu.com", active)
        active = PORTS.sub("https://ports.ubuntu.com/ubuntu-ports", active)
        lines.append(active + marker + comment)
    return "".join(lines)


def configure(root):
    root = root.resolve()
    apt = root / "etc/apt"
    candidates = [apt / "sources.list", apt / "apt-mirrors.txt"]
    candidates.extend(sorted((apt / "sources.list.d").glob("*.list")))
    candidates.extend(sorted((apt / "sources.list.d").glob("*.sources")))
    changed = []
    for path in candidates:
        # Never follow a fixture or configuration symlink outside the supplied root.
        if not path.is_file() or not path.resolve().is_relative_to(root):
            continue
        original = path.read_text()
        updated = rewrite(original)
        if updated != original:
            path.write_text(updated)
            changed.append(str(path.relative_to(root)))
    return changed


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path("/"), help="Sandbox root for tests")
    args = parser.parse_args(argv)
    root = args.root.resolve()
    if root == Path("/") and (sys.platform != "linux" or os.environ.get("CI") != "true"):
        print("APT mirror unchanged: host mutation is only enabled in Linux CI")
        return 0
    changed = configure(root)
    print("APT source transport updated in: " + (", ".join(changed) or "no files"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
