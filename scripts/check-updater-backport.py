#!/usr/bin/env python3
"""Verify the exact published updater source and its manifest-only ZIP patch."""

import difflib
import hashlib
import json
from pathlib import Path
import tomllib

ROOT = Path(__file__).resolve().parents[1]
VENDOR = ROOT / "vendor"
SOURCE = VENDOR / "tauri-plugin-updater-2.12.0"
MANIFEST = json.loads((VENDOR / "tauri-plugin-updater-2.12.0.provenance.json").read_text())


def digest(data):
    return hashlib.sha256(data).hexdigest()


def require(condition, message):
    if not condition:
        raise SystemExit(message)


def main():
    require(MANIFEST["archiveSha256"] == "7a5cad8ed5948d988e1018ecd31e27cacedbf72ce3fb972940c3e4bf51639e4b", "unexpected published crate")
    require(set(MANIFEST["omittedFiles"]) == {"Cargo.lock"}, "only upstream's unused development lock may be omitted")
    require(set(MANIFEST["patchedFiles"]) == {"Cargo.toml", "Cargo.toml.orig"}, "only two manifests may change")
    actual = set()
    for path in SOURCE.rglob("*"):
        require(not path.is_symlink(), f"unexpected symlink: {path}")
        if path.is_dir():
            continue
        require(path.is_file(), f"unexpected file type: {path}")
        relative = path.relative_to(SOURCE).as_posix()
        actual.add(relative)
        expected = MANIFEST["patchedFiles"].get(relative, MANIFEST["files"].get(relative))
        require(digest(path.read_bytes()) == expected, f"source hash mismatch: {relative}")
    require(actual == set(MANIFEST["files"]) - set(MANIFEST["omittedFiles"]), "published source inventory mismatch")

    patch = ""
    replacements = {
        "Cargo.toml": ('[target.\'cfg(target_os = "windows")\'.dependencies.zip]\nversion = "9"', '[target.\'cfg(target_os = "windows")\'.dependencies.zip]\nversion = "4"'),
        "Cargo.toml.orig": ('zip = { version = "9",', 'zip = { version = "4",'),
    }
    for filename, (changed, original) in replacements.items():
        content = (SOURCE / filename).read_text()
        require(content.count(changed) == 1, f"ZIP constraint mismatch: {filename}")
        restored = content.replace(changed, original)
        require(digest(restored.encode()) == MANIFEST["files"][filename], f"undocumented change: {filename}")
        patch += "".join(difflib.unified_diff(restored.splitlines(True), content.splitlines(True), fromfile="a/" + filename, tofile="b/" + filename))
    require(patch == (VENDOR / "tauri-plugin-updater-2.12.0-zip9.patch").read_text(), "patch receipt mismatch")
    cargo = tomllib.loads((ROOT / "Cargo.toml").read_text())
    require(cargo["patch"]["crates-io"]["tauri-plugin-updater"] == {"path": "vendor/tauri-plugin-updater-2.12.0"}, "missing workspace override")
    packages = tomllib.loads((ROOT / "Cargo.lock").read_text())["package"]
    updater = [p for p in packages if p["name"] == "tauri-plugin-updater"]
    require(len(updater) == 1 and updater[0]["version"] == "2.12.0" and "source" not in updater[0] and "checksum" not in updater[0], "workspace updater must resolve to reviewed local source")
    for lock in (ROOT / "Cargo.lock", ROOT / "tests/updater-zip-regression/Cargo.lock"):
        zip_packages = [p for p in tomllib.loads(lock.read_text())["package"] if p["name"] == "zip"]
        require(len(zip_packages) == 1 and zip_packages[0]["version"] == "9.0.0" and zip_packages[0]["checksum"] == "711e8c9646791c49b7eb799a19c4ae70a9b8372ddc6a1fa4778defd1e2aa5d5e", f"unexpected ZIP lock: {lock}")
    print("PASS: updater 2.12.0 published inventory, licenses, two-line ZIP 9 patch and locked graphs")


if __name__ == "__main__":
    main()
