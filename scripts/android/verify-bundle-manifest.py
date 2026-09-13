#!/usr/bin/env python3
"""Verify native AAB identity and release permissions using official bundletool.

Assets cannot establish an Android package identity. This gate reads every
module's compiled manifest with `bundletool dump manifest`, whose protobuf
decoder is maintained by Android:
https://github.com/google/bundletool/blob/1.18.3/src/main/java/com/android/tools/build/bundletool/commands/DumpCommand.java

Set BUNDLETOOL_JAR or pass --bundletool; an installed `bundletool` also works.
The tool is never downloaded or installed by this verifier.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET
import zipfile


ROOT = Path(__file__).resolve().parents[2]
ANDROID = "{http://schemas.android.com/apk/res/android}"
FORBIDDEN_PERMISSIONS = {
    "android.permission.REQUEST_INSTALL_PACKAGES",
    "android.permission.QUERY_ALL_PACKAGES",
}
MANIFEST_LIMIT = 4 * 1024 * 1024


def package_version_code():
    version = json.loads((ROOT / "package.json").read_text())["version"]
    match = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)(?:[-+].*)?", version)
    if not match:
        raise ValueError("Unsupported package.json version: " + version)
    major, minor, patch = map(int, match.groups())
    if minor > 99 or patch > 99:
        raise ValueError("Version cannot use the Android major*10000+minor*100+patch scheme")
    return major * 10000 + minor * 100 + patch


def tool_command(jar=None):
    jar = jar or os.environ.get("BUNDLETOOL_JAR")
    if jar:
        jar = Path(jar).resolve()
        if not jar.is_file():
            raise ValueError("Bundletool jar is missing: " + str(jar))
        java_home = os.environ.get("JAVA_HOME")
        java = str(Path(java_home) / "bin/java") if java_home else shutil.which("java")
        if not java or not Path(java).is_file():
            raise ValueError("Java is required to run bundletool")
        return [java, "-jar", str(jar)]
    executable = shutil.which("bundletool")
    if executable:
        return [executable]
    raise ValueError("Set BUNDLETOOL_JAR or --bundletool to the official bundletool jar")


def manifest_modules(bundle):
    """Reject duplicate/ambiguous manifests before a ZIP reader can pick one."""
    modules = []
    with zipfile.ZipFile(bundle) as archive:
        seen = set()
        for entry in archive.infolist():
            if entry.filename in seen:
                raise ValueError("Duplicate bundle entry: " + entry.filename)
            seen.add(entry.filename)
            path = PurePosixPath(entry.filename)
            if path.is_absolute() or ".." in path.parts or "\\" in entry.filename:
                raise ValueError("Invalid bundle entry path")
            if entry.filename.endswith("/manifest/AndroidManifest.xml"):
                if len(path.parts) != 3 or not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*", path.parts[0]):
                    raise ValueError("Unsupported bundle module path")
                if entry.is_dir() or not 0 < entry.file_size <= MANIFEST_LIMIT:
                    raise ValueError("Missing or oversized compiled manifest")
                modules.append(path.parts[0])
    if "base" not in modules:
        raise ValueError("Bundle has no base compiled AndroidManifest.xml")
    return sorted(modules, key=lambda name: (name != "base", name))


def check_manifest(xml, module, expected_package, version_code):
    if len(xml) > MANIFEST_LIMIT or "<!DOCTYPE" in xml or "<!ENTITY" in xml:
        raise ValueError("Unexpected manifest XML structure")
    manifest = ET.fromstring(xml)
    if manifest.tag != "manifest":
        raise ValueError("Unexpected manifest root")
    if manifest.get("package") != expected_package:
        raise ValueError("Native package mismatch in " + module + ": " + str(manifest.get("package")))
    actual_code = manifest.get(ANDROID + "versionCode")
    if module == "base" and actual_code != str(version_code):
        raise ValueError("Native versionCode mismatch: " + str(actual_code))
    if manifest.get(ANDROID + "versionCodeMajor", "0") != "0":
        raise ValueError("Unexpected native versionCodeMajor")
    applications = manifest.findall("application")
    if (module == "base" and len(applications) != 1) or len(applications) > 1:
        raise ValueError("Expected exactly one base application")
    for application in applications:
        # Absence is Android's default false. Resource references, ambiguous
        # strings and true are rejected; this gate validates release bundles.
        if application.get(ANDROID + "debuggable", "false") != "false":
            raise ValueError("Release application is debuggable in " + module)
    permissions = set()
    for element in manifest.iter():
        if element.tag.startswith("uses-permission"):
            permission = element.get(ANDROID + "name")
            if not permission:
                raise ValueError("Permission has no Android name")
            permissions.add(permission)
    blocked = sorted(permissions & FORBIDDEN_PERMISSIONS)
    if blocked:
        raise ValueError("Forbidden native permissions in " + module + ": " + ", ".join(blocked))
    return {
        "module": module,
        "package": expected_package,
        "versionCode": actual_code,
        "debuggable": False,
        # May be @0x...; do not claim that a resource reference is resolved text.
        "labelReference": applications[0].get(ANDROID + "label") if applications else None,
        "permissions": sorted(permissions),
    }


def verify_bundle(bundle, flavor, version_code=None, jar=None):
    if flavor not in ("full", "play"):
        raise ValueError("Expected full or play distribution")
    version_code = package_version_code() if version_code is None else version_code
    if not 0 < version_code <= 2100000000:
        raise ValueError("Invalid expected versionCode")
    bundle = Path(bundle).resolve()
    command = tool_command(jar)
    expected_package = "play.ott.foss" + (".play" if flavor == "play" else "")
    reports = []
    for module in manifest_modules(bundle):
        result = subprocess.run(
            command + ["dump", "manifest", "--bundle=" + str(bundle), "--module=" + module],
            check=False, capture_output=True, text=True, timeout=120,
        )
        if result.returncode:
            raise ValueError("bundletool could not decode " + module + ": " + result.stderr.strip()[-2000:])
        reports.append(check_manifest(result.stdout, module, expected_package, version_code))
    with bundle.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    return {"ok": True, "distribution": flavor, "aabSha256": digest, "modules": reports}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("bundle", type=Path)
    parser.add_argument("flavor", choices=("full", "play"))
    parser.add_argument("--version-code", type=int, default=None)
    parser.add_argument("--bundletool", type=Path)
    args = parser.parse_args()
    try:
        report = verify_bundle(args.bundle, args.flavor, args.version_code, args.bundletool)
    except (ValueError, OSError, ET.ParseError, zipfile.BadZipFile, subprocess.SubprocessError) as error:
        print("AAB manifest validation failed: " + str(error), file=sys.stderr)
        return 1
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
