#!/usr/bin/env python3
"""Check hosted Intel cross-build prerequisites and ARM64 bundle format, never run an app."""

import argparse
import json
import os
import platform
import plistlib
import subprocess
from pathlib import Path

if __package__:
    from . import macos_server_artifact as artifact
else:
    import macos_server_artifact as artifact


TARGET = "aarch64-apple-darwin"
MAX_PLIST_BYTES = 1024 * 1024
TARGET_CHECK = """#include <TargetConditionals.h>
#if !defined(__aarch64__) || !defined(__APPLE__) || !TARGET_OS_OSX || TARGET_OS_IPHONE
#error Expected an ARM64 macOS compilation target
#endif
int ottplay_cross_target(void);
"""


def require(condition, message):
    if not condition:
        raise ValueError(message)


def command(arguments, source=None):
    result = subprocess.run(arguments, input=source, capture_output=True,
                            text=True, check=True, timeout=30)
    require(len(result.stdout) <= 16384 and len(result.stderr) <= 16384,
            "Cross-build tool output exceeds its bound")
    return result.stdout.strip()


def preflight():
    """Compile syntax only on the admitted GitHub Intel host; emit no native binary."""
    require(os.environ.get("GITHUB_ACTIONS") == "true"
            and os.environ.get("RUNNER_ENVIRONMENT") == "github-hosted"
            and os.environ.get("RUNNER_OS") == "macOS"
            and os.environ.get("RUNNER_ARCH") == "X64"
            and platform.system() == "Darwin" and platform.machine() == "x86_64",
            "Cross-build preflight requires the hosted Intel macOS runner")
    require(TARGET in command(["rustup", "target", "list", "--installed"]).splitlines(),
            "ARM64 Rust target is not installed")
    sdk = command(["xcrun", "--sdk", "macosx", "--show-sdk-path"])
    require(Path(sdk).is_absolute() and Path(sdk).is_dir(), "macOS SDK is unavailable")
    command(["xcrun", "--sdk", "macosx", "clang", "--target=arm64-apple-macos11.0",
             "-isysroot", sdk, "-fsyntax-only", "-x", "c", "-"], TARGET_CHECK)
    return {"schema": 1, "status": "prerequisites-verified", "host": "x86_64",
            "target": TARGET, "sdk": sdk, "runtimeAccepted": False}


def directory(path):
    require(path.is_dir() and not path.is_symlink()
            and path.resolve(strict=True) == path.absolute(),
            "Bundle directory must not contain symlink aliases")
    return path


def verify_app(bundle_directory):
    """Read the actual bundle executable; signatures and archive roundtrip stay separate."""
    bundle_directory = directory(Path(bundle_directory).absolute())
    apps = list(bundle_directory.glob("*.app"))
    require(len(apps) == 1, "Expected exactly one macOS application bundle")
    app = directory(apps[0])
    contents = directory(app / "Contents")
    _, raw = artifact._read(contents / "Info.plist", MAX_PLIST_BYTES, MAX_PLIST_BYTES)
    info = plistlib.loads(raw)
    name = info.get("CFBundleExecutable") if isinstance(info, dict) else None
    require(isinstance(name, str) and 0 < len(name) <= 255 and name not in {".", ".."}
            and not any(character in name for character in ("/", "\\", ":", "\0")),
            "CFBundleExecutable must be a single filename")
    executable = directory(contents / "MacOS") / name
    identity, header = artifact._read(executable, artifact.MAX_BINARY_BYTES,
                                      32 + artifact.MAX_LOAD_COMMAND_BYTES)
    artifact._mach_o(header, identity["size"])
    return {"schema": 1, "status": "arm64-format-verified", "target": TARGET,
            "bundle": app.name, "binary": identity, "runtimeAccepted": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="action", required=True)
    commands.add_parser("preflight")
    verify = commands.add_parser("verify-app")
    verify.add_argument("--directory", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(preflight() if args.action == "preflight" else verify_app(args.directory)))


if __name__ == "__main__":
    main()
