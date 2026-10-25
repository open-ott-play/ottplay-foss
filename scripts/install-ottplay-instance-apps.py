#!/usr/bin/env python3
"""Prepare and apply independent macOS instance apps without changing the main app."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import plistlib
import re
import shutil
import subprocess
import sys
import uuid

IDENTIFIER = "com.ottplay.foss"
EXECUTABLE = "Contents/MacOS/ottplay-tauri"
LSREGISTER = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"


def require(value, message):
    if not value:
        raise RuntimeError(message)


def require_supported_macos():
    # This migration relies on WKWebsiteDataStore's named UUID stores, which
    # are only available on macOS 14+. Do not guess at older default stores.
    match = re.fullmatch(r"([0-9]+)(?:\.[0-9]+){1,2}", platform.mac_ver()[0])
    require(sys.platform == "darwin" and match and int(match[1]) >= 14,
            "Instance-store migration requires a recognized macOS 14 or later version")


def run(*args):
    return subprocess.check_output(args, stderr=subprocess.PIPE, text=True)


def tree(root):
    if not root.exists():
        return None
    result = {}
    for path in [root, *sorted(root.rglob("*"))]:
        key = str(path.relative_to(root))
        if path.is_symlink():
            result[key] = {"link": os.readlink(path)}
        elif path.is_file():
            result[key] = {
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                "mode": path.stat().st_mode & 0o777,
            }
        else:
            result[key] = {"directory": True}
    return result


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def read_info(app):
    return plistlib.loads((app / "Contents/Info.plist").read_bytes())


def store_id(data_dir):
    # Same stable key as src-tauri/src/instance.rs, not a new profile identity.
    return str(uuid.UUID(bytes=hashlib.md5(
        ("ottplay-foss:webview:" + str(data_dir)).encode(), usedforsecurity=False
    ).digest()))


def configuration(app, number):
    """Read current instance context; never execute an existing launcher."""
    env = read_info(app).get("LSEnvironment", {}) if app.exists() else {}
    if env.get("OTTPLAY_MANAGED_INSTANCE") == "1":
        require(env.get("OTTPLAY_INSTANCE") == str(number), "Instance context changed")
        port = env.get("OTTPLAY_QUEUE_PORT", "")
        data_dir = env.get("OTTPLAY_DATA_DIR")
    elif app.exists():
        try:
            script = (app / EXECUTABLE).read_text()
        except UnicodeDecodeError as error:
            raise RuntimeError("Unrecognized instance executable; review its configuration") from error
        match = re.fullmatch(
            r'#!/bin/bash\nexec env OTTPLAY_INSTANCE=(\d+) OTTPLAY_QUEUE_PORT=(\d+) '
            r'"[^"\n]+/Contents/MacOS/ottplay-tauri" "\$@"\n', script
        )
        require(match and match[1] == str(number), "Unrecognized instance launcher; review its environment")
        port, data_dir = match[2], None
    else:
        port, data_dir = str(18080 + number), None
    require(str(port).isdigit() and 1024 <= int(port) <= 65535, "Invalid instance queue port")
    if data_dir:
        require(Path(data_dir).is_absolute(), "Instance data directory is not absolute")
    return {
        "OTTPLAY_INSTANCE": str(number),
        "OTTPLAY_QUEUE_PORT": str(port),
        "OTTPLAY_MANAGED_INSTANCE": "1",
        **({"OTTPLAY_DATA_DIR": data_dir} if data_dir else {}),
    }


def require_closed(main, applications):
    # Every previous wrapper execs the main binary. Refuse to copy live WebKit
    # stores, including when the only running process is a legacy wrapper.
    for line in run("ps", "-axo", "comm=").splitlines():
        path = line.strip()
        require(path != str(main / EXECUTABLE), "Close the native players before applying")
        require(not any(path == str(applications / f"OttPlay FOSS {n}.app" / EXECUTABLE)
                        for n in (2, 3, 4)), "Close the native players before applying")


def prepare(main, applications, work, home):
    require_supported_macos()
    require(not work.exists(), "Use a new work directory")
    require(main.is_dir() and (main / EXECUTABLE).is_file(), "Main app missing")
    require(read_info(main).get("CFBundleIdentifier") == IDENTIFIER, "Unexpected main app identity")
    run("codesign", "--verify", "--deep", "--strict", str(main))
    require_closed(main, applications)
    main_tree = tree(main)
    version = read_info(main)["CFBundleShortVersionString"]
    work.mkdir(mode=0o700, parents=True)
    (work / "candidates").mkdir()
    (work / "stores").mkdir()
    entries = []
    for number in (2, 3, 4):
        app = applications / f"OttPlay FOSS {number}.app"
        environment = configuration(app, number)
        identity = f"{IDENTIFIER}.inst{number}"
        candidate = work / "candidates" / app.name
        run("ditto", "--rsrc", "--extattr", "--acl", str(main), str(candidate))
        require(tree(main) == main_tree, "Main app changed during preparation")
        info_path = candidate / "Contents/Info.plist"
        info = read_info(candidate)
        info.update(CFBundleIdentifier=identity,
                    CFBundleName=f"OttPlay FOSS {number}",
                    CFBundleDisplayName=f"OttPlay FOSS {number}",
                    LSEnvironment=environment)
        info_path.write_bytes(plistlib.dumps(info))
        run("codesign", "--force", "--deep", "--sign", "-",
            "--preserve-metadata=entitlements,flags,runtime",
            "--identifier", identity, str(candidate))
        run("codesign", "--verify", "--deep", "--strict", str(candidate))
        data_dir = Path(environment.get("OTTPLAY_DATA_DIR") or
                        home / "Library/Application Support" / f"{IDENTIFIER}.{number}")
        identifier = store_id(data_dir)
        old_store = home / "Library/WebKit" / IDENTIFIER / "WebsiteDataStore" / identifier
        new_store = home / "Library/WebKit" / identity / "WebsiteDataStore" / identifier
        existing_store = tree(new_store)
        source_store = tree(old_store)
        stage_store = work / "stores" / str(number)
        if existing_store is None and source_store is not None:
            # The operator must close players before preparing too: a live
            # SQLite/WAL snapshot is not established by copying its files.
            require_closed(main, applications)
            run("ditto", "--rsrc", "--extattr", "--acl", str(old_store), str(stage_store))
            require(tree(old_store) == source_store == tree(stage_store), "WebKit store changed during snapshot")
        elif existing_store is None:
            require(not app.exists(), "Existing instance has no recognized WebKit store; do not reset its profile")
        entries.append({
            "number": number, "app": str(app), "candidate": str(candidate),
            "oldApp": tree(app), "newApp": tree(candidate),
            "store": str(new_store), "oldStore": existing_store,
            "sourceStore": str(old_store), "sourceStoreTree": source_store,
            "stagedStore": str(stage_store),
            "stagedStoreTree": tree(stage_store),
            "environment": environment,
        })
    ports = [entry["environment"]["OTTPLAY_QUEUE_PORT"] for entry in entries]
    require(len(set(ports)) == len(ports), "Instance ports collide")
    plan = {"main": str(main), "applications": str(applications), "home": str(home),
            "version": version, "mainTree": main_tree, "entries": entries}
    require(tree(main) == main_tree, "Main app changed during preparation")
    plan["sha256"] = digest(plan)
    (work / "plan.json").write_text(json.dumps(plan, indent=2) + "\n")
    return {"status": "prepared_not_installed", "plan": str(work / "plan.json"),
            "version": plan["version"], "instances": [2, 3, 4]}


def apply(work):
    require_supported_macos()
    plan = json.loads((work / "plan.json").read_text())
    expected = plan.pop("sha256")
    require(digest(plan) == expected, "Plan changed")
    require(not (work / "apply-intent.json").exists(), "Previous apply intent exists; reconcile before retrying")
    main, applications = Path(plan["main"]), Path(plan["applications"])
    require_closed(main, applications)
    require(tree(main) == plan["mainTree"], "Main app changed; prepare again")
    for entry in plan["entries"]:
        number = entry["number"]
        require(number in (2, 3, 4), "Invalid planned instance")
        require(Path(entry["app"]) == applications / f"OttPlay FOSS {number}.app", "Invalid destination")
        require(Path(entry["candidate"]) == work / "candidates" / f"OttPlay FOSS {number}.app", "Invalid candidate")
        require(tree(Path(entry["app"])) == entry["oldApp"], "Existing instance changed")
        require(tree(Path(entry["candidate"])) == entry["newApp"], "Candidate changed")
        require(tree(Path(entry["store"])) == entry["oldStore"], "Destination profile changed")
        if entry["stagedStoreTree"] is not None:
            require(tree(Path(entry["sourceStore"])) == entry["sourceStoreTree"], "Original profile changed")
            require(tree(Path(entry["stagedStore"])) == entry["stagedStoreTree"], "Staged profile changed")
    (work / "apply-intent.json").write_text(json.dumps({"plan": expected}) + "\n")
    backups = work / "backups"
    backups.mkdir()
    installed, migrated, registered = [], [], []
    try:
        for entry in plan["entries"]:
            app, candidate, store = map(Path, (entry["app"], entry["candidate"], entry["store"]))
            backup = backups / app.name
            if app.exists():
                os.replace(app, backup)
            installed.append((app, candidate, backup))
            os.replace(candidate, app)
            if entry["stagedStoreTree"] is not None:
                store.parent.mkdir(parents=True, exist_ok=True)
                require(not store.exists(), "Destination profile appeared during apply")
                os.replace(entry["stagedStore"], store)
                migrated.append((store, Path(entry["stagedStore"])))
        require(tree(main) == plan["mainTree"], "Main app changed during apply")
        for app, _, _ in installed:
            # A same-path replacement can retain the former shell launcher's
            # cached environment. Refresh only these three application paths.
            registered.append(app)
            run(LSREGISTER, "-f", str(app))
    except Exception as error:
        registration_errors = []
        # Unregister while each new app still exists, including a registration
        # call that failed after partially updating LaunchServices.
        for app in registered:
            try:
                run(LSREGISTER, "-u", str(app))
            except (OSError, subprocess.SubprocessError):
                registration_errors.append(str(app))
        for store, stage in reversed(migrated):
            os.replace(store, stage)
        for app, candidate, backup in reversed(installed):
            if app.exists():
                os.replace(app, candidate)
            if backup.exists():
                os.replace(backup, app)
        for app in registered:
            if app.exists():
                try:
                    run(LSREGISTER, "-f", str(app))
                except (OSError, subprocess.SubprocessError):
                    registration_errors.append(str(app))
        if registration_errors:
            raise RuntimeError("Application files restored; LaunchServices registration needs repair: "
                               + ", ".join(registration_errors)) from error
        raise
    result = {"status": "installed_pending_runtime_verification", "version": plan["version"],
              "instances": [2, 3, 4], "originalProfilesRetained": True,
              "backupDirectory": str(backups), "selfUpdate": "managed_by_main_app_refresh",
              "launchServicesRefreshed": True}
    (work / "result.json").write_text(json.dumps(result, indent=2) + "\n")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("phase", choices=("prepare", "apply"))
    parser.add_argument("--work-dir", type=Path, required=True)
    parser.add_argument("--main-app", type=Path, default=Path("/Applications/OttPlay FOSS.app"))
    parser.add_argument("--applications-dir", type=Path, default=Path("/Applications"))
    args = parser.parse_args()
    require(sys.platform == "darwin", "This installer requires macOS")
    work = args.work_dir.expanduser().resolve()
    output = (prepare(args.main_app.resolve(), args.applications_dir.resolve(), work, Path.home())
              if args.phase == "prepare" else apply(work))
    print(json.dumps(output))


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, subprocess.SubprocessError) as error:
        print(f"Instance installation stopped: {error}", file=sys.stderr)
        raise SystemExit(1)
