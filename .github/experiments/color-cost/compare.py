#!/usr/bin/env python3
"""Hosted-only paired feature-cost experiment; never convert a failed gate to PASS."""
import ctypes
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import time

HEAD = "14ea5da80b20a8311bb55cee250f794ae278d310"
NODE = "22.23.4"
ZLIB = "1.3.1-e00f703"
MARKER = "color-cost-comparison-marker.txt"
MARKER_TEXT = "Identical inert dirty marker outside compiled source.\n"
TOTAL_SECONDS = 23 * 60
ARM_SECONDS = 11 * 60
FROZEN = ("package-lock.json", "scripts/classic-size.cjs",
          "scripts/player-build-identity.cjs", "scripts/media-runtime.cjs")
COMMANDS = (("dependencies", ["npm", "ci", "--ignore-scripts"]),
            ("media", ["npm", "run", "check:media"]),
            ("build", ["npm", "run", "build"]),
            ("size", ["npm", "run", "check:size"]))
REPORTS = ("classic-size-diagnostics.json", "classic-bundle.json", "classic-composition.json")
SHA = re.compile(r"[0-9a-f]{64}\Z")


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save(path, value):
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    temporary.replace(path)


def read_json(path):
    if path.is_symlink() or path.stat().st_size > 4 * 1024 * 1024:
        raise ValueError("Unsafe or oversized JSON input")
    return json.loads(path.read_text())


def safe_name(value):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_.@/-]+", value):
        raise ValueError("Invalid manifest path")
    p = PurePosixPath(value)
    if p.is_absolute() or any(x in ("", ".", "..", ".git") for x in value.split("/")):
        raise ValueError("Unsafe manifest path")
    return value


def checked_file(root, name):
    safe_name(name)
    current = root
    for part in PurePosixPath(name).parts:
        current = current / part
        if current.is_symlink():
            raise ValueError("Symlink in measured source path: " + name)
    if not current.is_file() or current.stat().st_size > 32 * 1024 * 1024:
        raise ValueError("Missing or oversized input: " + name)
    return current


def validate_manifest(manifest):
    if not isinstance(manifest, dict) or manifest.get("schemaVersion") != 1 or manifest.get("status") != "bound":
        raise ValueError("A finalized bound manifest is required; this packet is not a result")
    if manifest.get("baseCommit") != HEAD or manifest.get("nodeVersion") != NODE or manifest.get("zlibVersion") != ZLIB:
        raise ValueError("Unexpected comparison source/toolchain")
    if not SHA.fullmatch(str(manifest.get("featurePatchSha256", ""))):
        raise ValueError("Missing exact patch hash")
    if not SHA.fullmatch(str(manifest.get("upstreamManifestSha256", ""))):
        raise ValueError("Missing upstream source-manifest hash")
    if set(manifest.get("tools", {})) != {"compare.py", "collect-assets.cjs"}:
        raise ValueError("Both harness files must be hash-bound")
    if set(manifest.get("unchanged", {})) != set(FROZEN):
        raise ValueError("Measurement, identity, dependency and media controls must remain frozen")
    if any(not SHA.fullmatch(str(v)) for v in [*manifest["tools"].values(), *manifest["unchanged"].values()]):
        raise ValueError("Invalid control hash")
    files = manifest.get("files")
    if not isinstance(files, dict) or not 1 <= len(files) <= 512:
        raise ValueError("Invalid changed-file manifest")
    for name, entry in files.items():
        safe_name(name)
        if not (name.startswith(("src/", "styles/", "locales/", "tests/", "docs/")) or name in (
                "vite.config.ts", "package.json", "README.md", "CHANGELOG.md", "scripts/classic-bundle.cjs",
                "scripts/localization-dynamic.json", "scripts/localization-identical.json")):
            raise ValueError("Feature payload outside reviewed color source scope: " + name)
        if name in FROZEN or not isinstance(entry, dict) or set(entry) != {"before", "after"}:
            raise ValueError("Invalid or frozen feature path: " + name)
        for value in entry.values():
            if value is not None and (not isinstance(value, dict) or set(value) != {"sha256", "mode"}
                    or value["mode"] not in ("100644", "100755") or not SHA.fullmatch(str(value["sha256"]))):
                raise ValueError("Invalid file identity: " + name)
        if entry["before"] == entry["after"]:
            raise ValueError("Manifest contains an unchanged path: " + name)
    if manifest.get("expectedNewRootJs") != ["color-appearance.js"]:
        raise ValueError("Expected lazy color asset must be declared explicitly")
    counts = manifest.get("expectedRootJavaScriptFiles", {})
    if set(counts) != {"A", "B"} or any(type(v) is not int or v < 3 for v in counts.values()) or counts["B"] != counts["A"] + 3:
        raise ValueError("Bind expected complete JavaScript inventory counts for both arms")


class CleanupError(RuntimeError):
    pass


def enable_subreaper():
    # Adopt and reap descendants after their command leader exits (Linux only).
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(36, 1, 0, 0, 0) != 0:  # PR_SET_CHILD_SUBREAPER
        raise CleanupError("Could not enable child subreaping")


def _clean_group(proc):
    signals = []
    reaped = 0
    children_path = Path(f"/proc/{os.getpid()}/task/{os.getpid()}/children")

    def children():
        return [int(pid) for pid in children_path.read_text().split()]

    for sig, grace in ((signal.SIGTERM, 0.25), (signal.SIGKILL, 2.0)):
        try:
            os.killpg(proc.pid, sig)
            signals.append(sig.name)
        except ProcessLookupError:
            pass
        end = time.monotonic() + grace
        while time.monotonic() < end:
            proc.poll()
            # The harness is sequential. Any adopted child belongs to this
            # command, including one which created a new process group/session.
            for pid in children():
                try:
                    os.kill(pid, sig)
                except ProcessLookupError:
                    pass
            while True:
                try:
                    child, status = os.waitpid(-1, os.WNOHANG)
                except ChildProcessError:
                    break
                if not child:
                    break
                if child == proc.pid:
                    proc.returncode = os.waitstatus_to_exitcode(status)
                reaped += 1
            group_gone = False
            try:
                os.killpg(proc.pid, 0)
            except ProcessLookupError:
                group_gone = True
            if group_gone and not children():
                proc.poll()
                return {"groupGone": True, "adoptedChildrenGone": True, "signals": signals, "reaped": reaped}
            time.sleep(0.025)
    raise CleanupError("Owned group/adopted children remain after SIGKILL; no next step or arm is allowed")


def clean_group(proc):
    try:
        return _clean_group(proc)
    except CleanupError:
        raise
    except Exception as error:
        raise CleanupError("Could not verify process cleanup; no next step or arm is allowed") from error


def execute(args, cwd, env, output, deadline):
    start = time.monotonic()
    if start >= deadline:
        return {"argv": args, "started": False, "exit_code": 124, "raw_returncode": None, "timed_out": True, "seconds": 0}
    proc = subprocess.Popen(args, cwd=cwd, env=env, stdout=output,
                            stderr=subprocess.STDOUT, start_new_session=True, stdin=subprocess.DEVNULL)
    timed_out = False
    try:
        try:
            proc.wait(timeout=max(0.001, deadline - time.monotonic()))
        except subprocess.TimeoutExpired:
            timed_out = True
    finally:
        cleanup = clean_group(proc)
    return {"argv": args, "started": True, "exit_code": 124 if timed_out else proc.returncode,
            "raw_returncode": proc.returncode, "timed_out": timed_out,
            "seconds": round(time.monotonic() - start, 3), "cleanup": cleanup}


def capture(args, cwd, env, deadline):
    with tempfile.TemporaryFile() as output:
        result = execute(args, cwd, env, output, min(deadline, time.monotonic() + 30))
        output.seek(0)
        value = output.read(16 * 1024 * 1024 + 1)
    if result["exit_code"] or len(value) > 16 * 1024 * 1024:
        raise RuntimeError("Failed bounded source query: " + args[0])
    return value.decode("utf-8").rstrip("\n")


def run(name, args, cwd, env, out, deadline):
    with (out / (name + ".log")).open("w") as log:
        log.write("COMMAND " + json.dumps(args) + "\n")
        log.flush()
        result = execute(args, cwd, env, log, deadline)
    result.update(name=name, log=name + ".log")
    return result


def environment(work):
    keys = ("PATH", "HOME", "USER", "TMPDIR", "LANG", "LC_ALL", "CI", "GITHUB_ACTIONS", "RUNNER_ENVIRONMENT")
    env = {k: os.environ[k] for k in keys if k in os.environ}
    env.update(GITHUB_WORKSPACE=str(work), TZ="UTC", NPM_CONFIG_AUDIT="false", NPM_CONFIG_FUND="false",
               NPM_CONFIG_USERCONFIG="/dev/null")
    return env


def file_identity(root, name):
    path = root / name
    if not path.exists() and not path.is_symlink():
        return None
    path = checked_file(root, name)
    mode = "100755" if path.stat().st_mode & stat.S_IXUSR else "100644"
    return {"sha256": digest(path), "mode": mode}


def verify_sources(root, manifest, arm, env, deadline, marked):
    if capture(["git", "rev-parse", "HEAD"], root, env, deadline) != HEAD:
        raise ValueError("Arm HEAD changed")
    changed = set(filter(None, capture(["git", "diff", "--name-only", "-z", "HEAD"], root, env, deadline).split("\0")))
    expected_changed = set() if arm == "A" else set(manifest["files"])
    if changed != expected_changed:
        raise ValueError("Actual changed paths differ from exact feature manifest")
    untracked = set(filter(None, capture(["git", "ls-files", "--others", "--exclude-standard", "-z"], root, env, deadline).split("\0")))
    if untracked != ({MARKER} if marked else set()):
        raise ValueError("Unexpected untracked source files")
    hashes = {}
    for name, expected in manifest["unchanged"].items():
        hashes[name] = digest(checked_file(root, name))
        if hashes[name] != expected:
            raise ValueError("Frozen control changed: " + name)
    for name, identity in manifest["files"].items():
        value = file_identity(root, name)
        if value != identity["before" if arm == "A" else "after"]:
            raise ValueError("Feature source identity mismatch: " + name)
        hashes[name] = value
    if (root / ".release-plan.json").exists() or list(root.glob(".env*")):
        raise ValueError("Release/private environment inputs are forbidden")
    if marked and (root / MARKER).read_text() != MARKER_TEXT:
        raise ValueError("Dirty marker changed")
    return hashes


def package_controls(root):
    package = read_json(root / "package.json")
    result = {key: package.get(key) for key in ("name", "version", "type", "dependencies", "devDependencies", "optionalDependencies", "overrides", "engines", "packageManager")}
    result["scripts"] = {key: value for key, value in package.get("scripts", {}).items()
                         if key in ("build", "check:media", "check:size") or key.startswith(("prebuild", "postbuild", "precheck:", "postcheck:"))}
    return result


def clear_reports(root):
    for name in REPORTS:
        path = root / "build/reports" / name
        if path.is_symlink():
            raise ValueError("Report symlink is forbidden")
        path.unlink(missing_ok=True)


def preserve_reports(root, out, stage):
    records = []
    for name in REPORTS:
        source = root / "build/reports" / name
        if not source.exists():
            continue
        source = checked_file(root, "build/reports/" + name)
        target = out / stage / name
        target.parent.mkdir(exist_ok=True)
        shutil.copyfile(source, target)
        records.append({"path": str(target.relative_to(out)), "bytes": source.stat().st_size, "sha256": digest(source)})
    return records


def require_no_outputs(root):
    for name in ("dist", "src-tauri/frontend", "dist-mobile", "build/reports"):
        if (root / name).exists() or (root / name).is_symlink():
            raise ValueError("Refuse stale generated output: " + name)


def comparison(evidence, receipt, manifest):
    result = {"available": False, "purpose": "Diagnostic size delta; not gate/release acceptance",
              "allCommandsPassed": receipt.get("allCommandsPassed", False)}
    if set(receipt["arms"]) != {"A", "B"} or not all(
            arm.get("measurementComplete") and arm.get("sourceValidatedAfter") for arm in receipt["arms"].values()):
        result["reason"] = "Both complete, source-validated asset inventories are required"
        return result
    inventories = {arm: read_json(evidence / arm / "assets/inventory.json") for arm in ("A", "B")}
    for arm, inv in inventories.items():
        if inv.get("complete") is not True or inv.get("node") != NODE or inv.get("zlib") != ZLIB:
            raise ValueError("Incomplete/unpinned asset inventory")
        if len([r for r in inv["records"] if r["category"] == "rootJavaScript"]) != manifest["expectedRootJavaScriptFiles"][arm]:
            raise ValueError("Complete JavaScript inventory differs from the bound source expectation")
    tables = {arm: {r["path"]: r for r in inv["records"]} for arm, inv in inventories.items()}
    for name in manifest["expectedNewRootJs"]:
        for root in ("dist", "src-tauri/frontend/dist", "dist-mobile/dist"):
            if root + "/" + name in tables["A"] or root + "/" + name not in tables["B"]:
                raise ValueError("Expected new color asset not isolated in all three outputs")
    if receipt["arms"]["A"]["identityProbe"] != receipt["arms"]["B"]["identityProbe"]:
        raise ValueError("Dirty identity controls differ between arms")
    rows = []
    for path in sorted(set(tables["A"]) | set(tables["B"])):
        a, b = tables["A"].get(path), tables["B"].get(path)
        exemplar = a or b
        if a and b and (a["category"], a["family"]) != (b["category"], b["family"]):
            raise ValueError("Asset category changed unexpectedly")
        rows.append({"path": path, "family": exemplar["family"], "category": exemplar["category"],
                     "status": "added" if a is None else "removed" if b is None else "unchanged" if a["sha256"] == b["sha256"] else "changed",
                     "before": a, "after": b,
                     "deltaBytes": (b["bytes"] if b else 0) - (a["bytes"] if a else 0),
                     "deltaGzipBytes": (b["gzipBytes"] if b else 0) - (a["gzipBytes"] if a else 0)})
    result.update(available=True, assets=rows,
                  totalsByCategory={category: {"deltaBytes": sum(r["deltaBytes"] for r in rows if r["category"] == category),
                                              "deltaGzipBytes": sum(r["deltaGzipBytes"] for r in rows if r["category"] == category)}
                                    for category in ("rootJavaScript", "stylesheets", "locales")},
                  gzipMeaning="Sum of separately gzip-level-9 compressed files; not concatenated payload or initial network transfer")
    return result


def main():
    if os.environ.get("GITHUB_ACTIONS") != "true" or os.environ.get("RUNNER_ENVIRONMENT") != "github-hosted" or sys.platform != "linux":
        raise RuntimeError("This experiment runs only on Linux GitHub-hosted Actions")
    if len(sys.argv) != 3:
        raise ValueError("Usage: compare.py SOURCE EMPTY_WORK")
    enable_subreaper()
    deadline = time.monotonic() + TOTAL_SECONDS
    source, work = (Path(x).resolve() for x in sys.argv[1:])
    controls = Path(__file__).resolve().parent
    if work == source or work in source.parents or source in work.parents or controls == work or controls in work.parents:
        raise ValueError("Work directory must be isolated from source and controls")
    work.mkdir(parents=True, exist_ok=True)
    evidence = work / "evidence"
    evidence.mkdir(exist_ok=True)
    if (evidence / "receipt.json").exists() or any((work / name).exists() for name in ("A", "B")):
        raise ValueError("Refuse to reuse a previous comparison")
    receipt = {"schemaVersion": 1, "purpose": "Same-HEAD dirty-overlay color cost; not release qualification",
               "baseCommit": HEAD, "workflowSha": os.environ.get("GITHUB_SHA"),
               "workflowRef": os.environ.get("GITHUB_WORKFLOW_REF"), "runId": os.environ.get("GITHUB_RUN_ID"),
               "runAttempt": os.environ.get("GITHUB_RUN_ATTEMPT"), "arms": {}, "complete": False}
    save(evidence / "receipt.json", receipt)
    try:
        manifest_path = checked_file(controls, "manifest.json")
        expected_manifest = os.environ.get("COLOR_COST_MANIFEST_SHA256", "")
        if not SHA.fullmatch(expected_manifest) or digest(manifest_path) != expected_manifest:
            raise ValueError("Manifest does not match the dispatch-bound SHA256")
        manifest = read_json(manifest_path)
        validate_manifest(manifest)
        for name, expected in {**manifest["tools"], "feature.patch": manifest["featurePatchSha256"],
                               "source-manifest.json": manifest["upstreamManifestSha256"]}.items():
            if digest(checked_file(controls, name)) != expected:
                raise ValueError("Bound control hash mismatch: " + name)
        receipt.update(manifestSha256=expected_manifest, featurePatchSha256=manifest["featurePatchSha256"], tools=manifest["tools"])
        for name in ("manifest.json", "source-manifest.json", "feature.patch", "compare.py", "collect-assets.cjs"):
            shutil.copyfile(controls / name, evidence / name)
        env = environment(source)
        versions = json.loads(capture(["node", "-p", "JSON.stringify(process.versions)"], source, env, deadline))
        receipt["nodeVersions"] = versions
        if versions.get("node") != NODE or versions.get("zlib") != ZLIB:
            raise ValueError("Pinned Node/zlib mismatch")
        if capture(["git", "rev-parse", "HEAD"], source, env, deadline) != HEAD:
            raise ValueError("Pinned checkout HEAD mismatch")
        baseline_package = package_controls(source)
        invalid = False
        for arm in ("A", "B"):
            arm_root, out = work / arm, evidence / arm
            out.mkdir()
            result = {"inputValid": False, "steps": [], "reports": [], "measurementComplete": False}
            receipt["arms"][arm] = result
            arm_deadline = min(deadline, time.monotonic() + ARM_SECONDS)
            try:
                setups = [("clone", ["git", "clone", "--quiet", "--no-hardlinks", str(source), str(arm_root)], work),
                          ("checkout", ["git", "checkout", "--detach", HEAD], arm_root)]
                for name, command, directory in setups:
                    step = run(name, command, directory, env, out, arm_deadline)
                    result["steps"].append(step)
                    if step["exit_code"]:
                        raise RuntimeError("Arm setup failed: " + name)
                env = environment(arm_root)
                verify_sources(arm_root, manifest, "A", env, arm_deadline, False)
                if arm == "B":
                    step = run("apply", ["git", "apply", "--index", str(controls / "feature.patch")], arm_root, env, out, arm_deadline)
                    result["steps"].append(step)
                    if step["exit_code"]:
                        raise RuntimeError("Exact feature patch did not apply")
                (arm_root / MARKER).write_text(MARKER_TEXT)
                result["sourceHashes"] = verify_sources(arm_root, manifest, arm, env, arm_deadline, True)
                if package_controls(arm_root) != baseline_package:
                    raise ValueError("Dependency or measured command changed between arms")
                require_no_outputs(arm_root)
                probe = json.loads(capture(["node", "-e", "console.log(JSON.stringify(require('./scripts/player-build-identity.cjs').createPlayerBuildIdentity('paired-color-cost-probe',process.cwd())))"], arm_root, env, arm_deadline))
                if probe.get("sourceHead") != HEAD or probe.get("sourceRevision") != "":
                    raise ValueError("Both arms require the same HEAD and dirty source identity")
                result["identityProbe"] = probe
                result.update(inputValid=True, gitHead=HEAD, markerSha256=digest(arm_root / MARKER),
                              gitStatus=capture(["git", "status", "--porcelain", "--untracked-files=all"], arm_root, env, arm_deadline))
                (out / "source.patch").write_text(capture(["git", "diff", "--binary", "HEAD"], arm_root, env, arm_deadline) + "\n")
                for name, command in COMMANDS:
                    if name == "build":
                        require_no_outputs(arm_root)
                    if name in ("build", "size"):
                        clear_reports(arm_root)
                    step = run(name, command, arm_root, env, out, arm_deadline - 20)
                    result["steps"].append(step)
                    if name in ("build", "size"):
                        result["reports"].extend(preserve_reports(arm_root, out, name))
                    save(evidence / "receipt.json", receipt)
                    if step["exit_code"] and name in ("dependencies", "media"):
                        raise RuntimeError("Prerequisite/deadline failure: " + name)
                # Even a failed build or size gate must retain raw diagnostic bytes.
                verify_sources(arm_root, manifest, arm, env, arm_deadline, True)
                step = run("collect", ["node", str(controls / "collect-assets.cjs"), str(arm_root), str(out / "assets")], arm_root, env, out, arm_deadline)
                result["steps"].append(step)
                inventory = out / "assets/inventory.json"
                if inventory.is_file():
                    result["inventorySha256"] = digest(inventory)
                result["measurementComplete"] = step["exit_code"] == 0 and bool(result["reports"])
                verify_sources(arm_root, manifest, arm, env, arm_deadline, True)
                result["sourceValidatedAfter"] = True
                result["allCommandsPassed"] = all(x["exit_code"] == 0 for x in result["steps"])
                invalid |= not result["allCommandsPassed"] or not result["measurementComplete"]
            except (CleanupError, InterruptedError):
                raise  # Isolation failed: never start another arm.
            except Exception as error:
                result["error"] = str(error)
                result["measurementComplete"] = False
                invalid = True
            finally:
                save(evidence / "receipt.json", receipt)
        receipt["allCommandsPassed"] = not invalid
        summary = comparison(evidence, receipt, manifest)
        save(evidence / "comparison.json", summary)
        receipt["complete"] = summary["available"]
        invalid |= not summary["available"]
        return 1 if invalid else 0
    except BaseException as error:
        receipt["complete"] = False
        receipt["error"] = str(error)
        raise
    finally:
        save(evidence / "receipt.json", receipt)


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(InterruptedError("Termination requested")))
    sys.exit(main())
