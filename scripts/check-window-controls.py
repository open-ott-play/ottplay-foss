#!/usr/bin/env python3
"""Run the already-built Windows/macOS fixture; never launch installed players."""
import argparse
import json
import math
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import time


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def validate_common_evidence(report):
    require(report.get("status") == "pass", f"Native assertion failed: {report.get('error')}")
    require(report.get("owned_labels") == ["main", "pip"], "Wrong fixture window ownership")
    require(report.get("cleanup_errors") == [], "Native window cleanup failed")


def validate_aspect_state(value, enabled, active):
    expected = {"ok": True, "supported": True, "enabled": enabled, "active": active}
    require(isinstance(value, dict) and value.keys() == expected.keys()
            and all(type(value[key]) is bool and value[key] is target for key, target in expected.items()),
            "Wrong native aspect state")


def validate_sizing_probe(probe, enabled):
    require(probe.get("kind") == "owned-hwnd-message-probe" and probe.get("enabled") is enabled,
            "Wrong native sizing probe")
    require(type(probe.get("os_bounds_captures")) is int and probe["os_bounds_captures"] > 0,
            "Missing OS-initialized tracking bounds")
    limits, insets = probe.get("outer_limits"), probe.get("client_insets")
    require(isinstance(limits, list) and len(limits) == 4 and all(type(v) is int for v in limits)
            and 0 < limits[0] <= limits[2] and 0 < limits[1] <= limits[3], "Invalid tracking bounds")
    require(isinstance(insets, list) and len(insets) == 2 and all(type(v) is int and v >= 0 for v in insets),
            "Invalid client insets")
    samples = probe.get("samples", [])
    require(len(samples) == 8 and all(type(s.get("edge")) is int for s in samples)
            and [s.get("edge") for s in samples] == list(range(1, 9)),
            "Incomplete native sizing edges")
    for sample in samples:
        before, after = sample.get("input"), sample.get("output")
        require(all(isinstance(r, list) and len(r) == 4 and all(type(v) is int for v in r)
                    for r in [before, after]), "Malformed sizing rectangle")
        if not enabled:
            require(before == after, "Disabled constraint changed native sizing")
            continue
        width, height = after[2] - after[0], after[3] - after[1]
        require(limits[0] <= width <= limits[2] and limits[1] <= height <= limits[3],
                "Native sizing exceeded OS tracking limits")
        require(width > insets[0] and height > insets[1]
                and abs((width - insets[0]) * 9 - (height - insets[1]) * 16) <= 4,
                "Native sizing did not constrain content to 16:9")
        edge = sample["edge"]
        if edge in [1, 4, 7]:
            require(after[2] == before[2], "Opposite right edge moved")
        if edge in [2, 5, 8]:
            require(after[0] == before[0], "Opposite left edge moved")
        if edge in [3, 4, 5]:
            require(after[3] == before[3], "Opposite bottom edge moved")
        if edge in [6, 7, 8]:
            require(after[1] == before[1], "Opposite top edge moved")


def validate_evidence(report, missing, *, platform="windows"):
    require(platform in {"windows", "macos"}, "Unsupported native fixture platform")
    if platform == "macos":
        require(report.get("platform") == "macos", "Wrong native fixture platform")
    validate_common_evidence(report)
    denials = report.get("denials", [])
    expected = ({"set_always_on_top", "set_fullscreen", "toggle_fullscreen"} if missing else {"set_always_on_top"}) | {"get_window_aspect_lock", "set_window_aspect_lock"}
    require(len(denials) == len(expected), "Missing ACL denial evidence")
    require({entry.get("command") for entry in denials} == expected, "Wrong denied commands")
    require(all(entry.get("window") == ("main" if missing else "pip")
                and "not allowed" in entry.get("error", "") for entry in denials), "Not an ACL denial")
    require(report.get("mode") == ("missing-permission" if missing else "production-permissions"), "Wrong ACL mode")
    if missing:
        return
    if platform == "macos":
        return validate_appkit_evidence(report)
    require(report.get("aux_unchanged") is True, "Auxiliary window changed")
    top = report.get("topmost_sequence", [])
    full = report.get("fullscreen_sequence", [])
    require(len(top) == 4 and len(full) == 4, "Incomplete native state sequence")
    for state, expected_top in zip(top, [True, True, False, False]):
        require(state.get("topmost") is expected_top and state.get("win32_topmost") is expected_top
                and state.get("fullscreen") is False, "Topmost native readback disagrees")
    for state, expected_top, expected_full in zip(full, [False, False, True, True], [True, False, True, False]):
        require(state.get("topmost") is expected_top and state.get("win32_topmost") is expected_top
                and state.get("fullscreen") is expected_full, "Fullscreen native readback disagrees")
    for name in ["initial", "final"]:
        state = report.get(name, {})
        require(all(state.get(key) is False for key in ["topmost", "win32_topmost", "fullscreen"]),
                f"Wrong {name} native state")

    aspect = report.get("aspect", {})
    validate_aspect_state(aspect.get("initial"), False, False)
    validate_aspect_state(aspect.get("final"), False, False)
    sequence = aspect.get("set_sequence", [])
    require(len(sequence) == 4, "Incomplete aspect idempotence sequence")
    for value, enabled in zip(sequence, [True, True, False, False]):
        validate_aspect_state(value, enabled, enabled)
    geometry = aspect.get("set_geometry", [])
    baseline = report.get("initial", {}).get("rect")
    require(isinstance(baseline, list) and len(baseline) == 4
            and all(type(v) is int for v in baseline), "Missing initial native geometry")
    require(len(geometry) == 4, "Incomplete aspect geometry sequence")
    for item in geometry:
        rect = item.get("rect")
        require(isinstance(rect, list) and len(rect) == 4 and all(type(v) is int for v in rect)
                and all(abs(a - b) <= 2 for a, b in zip(rect, baseline)),
                "Aspect toggle changed native geometry")
    full = aspect.get("fullscreen_sequence", [])
    require(len(full) == 6, "Incomplete aspect fullscreen sequence")
    for value, active in zip(full, [False, True, False, True, False, True]):
        validate_aspect_state(value, True, active)
    validate_sizing_probe(aspect.get("sizing_enabled", {}), True)
    validate_sizing_probe(aspect.get("sizing_disabled", {}), False)


def validate_restoration_evidence(report, phase, *, platform="windows"):
    if platform == "macos":
        return validate_appkit_restoration(report, phase)
    validate_common_evidence(report)
    require(report.get("mode") == "preference-restoration" and report.get("phase") == phase,
            "Wrong preference restoration phase")
    require(report.get("aux_unchanged") is True, "Auxiliary window changed")
    for name, expected in [("initial", phase == "unpin"), ("final", phase == "pin")]:
        state = report.get(name, {})
        require(state.get("topmost") is expected and state.get("win32_topmost") is expected
                and state.get("fullscreen") is False, f"Wrong restored {name} native state")

    validate_aspect_state(report.get("aspect_initial"), phase == "unpin", phase == "unpin")
    validate_aspect_state(report.get("aspect_final"), phase == "pin", phase == "pin")
    validate_sizing_probe(report.get("aspect_sizing", {}), phase == "pin")


def validate_appkit_snapshot(value, baseline, *, active, fullscreen=False,
                             zoomed=False, original_geometry=True):
    require(isinstance(value, dict) and value.get("label") == "main",
            "Missing owned AppKit main-window observation")
    require(type(value.get("window_number")) is int
            and value["window_number"] == baseline.get("window_number"),
            "AppKit observation changed native window identity")
    require(type(value.get("level")) is int, "Missing AppKit window level")
    for key, size in [("frame", 4), ("content_size", 2), ("content_aspect", 2),
                      ("resize_increments", 2)]:
        items = value.get(key)
        require(isinstance(items, list) and len(items) == size
                and all(type(v) in (int, float) and math.isfinite(v) for v in items),
                f"Invalid AppKit {key}")
    require(all(v > 0 for v in value["frame"][2:] + value["content_size"]),
            "Empty AppKit geometry")
    for key in ["fullscreen", "zoomed", "miniaturized"]:
        require(type(value.get(key)) is bool, f"Invalid AppKit {key}")
    require(value["fullscreen"] is fullscreen and value["miniaturized"] is False
            and (zoomed is None or value["zoomed"] is zoomed),
            "Wrong native AppKit window state")
    require(value["content_aspect"] == ([16, 9] if active else baseline["content_aspect"]),
            "Native AppKit aspect readback disagrees")
    if not active:
        require(value["resize_increments"] == baseline["resize_increments"],
                "Original AppKit resize increments were not restored")
    if original_geometry:
        require(value["level"] == baseline["level"], "AppKit window level changed")
        require(all(abs(a - b) <= 2 for key in ["frame", "content_size"]
                    for a, b in zip(value[key], baseline[key])),
                "AppKit aspect operation changed original geometry")


def validate_appkit_baseline(report):
    baseline = report.get("baseline")
    require(isinstance(baseline, dict), "Missing pre-initialize AppKit baseline")
    validate_appkit_snapshot(baseline, baseline, active=False)
    require(baseline["content_aspect"] != [16, 9],
            "AppKit fixture already constrained before initialization")
    width, height = baseline["content_size"]
    require(abs(width * 9 - height * 16) > 4, "AppKit fixture did not start off-ratio")
    return baseline


def validate_appkit_evidence(report):
    baseline = validate_appkit_baseline(report)
    require(report.get("aux_unchanged") is True, "Auxiliary AppKit window changed")
    validate_aspect_state(report.get("initial_state"), False, False)
    validate_appkit_snapshot(report.get("initial"), baseline, active=False)
    sequence = report.get("set_sequence", [])
    require(len(sequence) == 4, "Incomplete AppKit idempotence sequence")
    for item, enabled in zip(sequence, [True, True, False, False]):
        validate_aspect_state(item.get("state"), enabled, enabled)
        validate_appkit_snapshot(item.get("native"), baseline, active=enabled)
    transitions = report.get("transitions", [])
    expected = [(kind, target) for kind in ["toggle_fullscreen", "set_fullscreen", "zoom"]
                for target in [True, False]]
    require(len(transitions) == len(expected), "Incomplete AppKit native transitions")
    for item, (kind, target) in zip(transitions, expected):
        require(item.get("kind") == kind and item.get("target") is target,
                "Wrong AppKit transition order")
        validate_aspect_state(item.get("state"), True, not target)
        validate_appkit_snapshot(item.get("native"), baseline, active=not target,
                                 fullscreen=target if kind != "zoom" else False,
                                 zoomed=(None if target else False) if kind != "zoom" else target,
                                 original_geometry=not target)
    validate_aspect_state(report.get("final_state"), False, False)
    validate_appkit_snapshot(report.get("final"), baseline, active=False)


def validate_appkit_restoration(report, phase):
    require(report.get("platform") == "macos", "Wrong native fixture platform")
    validate_common_evidence(report)
    require(report.get("mode") == "preference-restoration" and report.get("phase") == phase,
            "Wrong AppKit preference phase")
    require(report.get("aux_unchanged") is True, "Auxiliary AppKit window changed")
    baseline = validate_appkit_baseline(report)
    for name, enabled in [("initial", phase == "unpin"), ("final", phase == "pin")]:
        validate_aspect_state(report.get(name + "_state"), enabled, enabled)
        validate_appkit_snapshot(report.get(name), baseline, active=enabled)


def stop_owned_process(process, *, platform="windows"):
    """PID comes only from this runner's Popen. Never terminate by image name."""
    if process.poll() is not None:
        return
    if platform == "macos":
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait(timeout=5)
        return
    subprocess.run(["taskkill.exe", "/PID", str(process.pid), "/T", "/F"],
                   check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5)
    process.wait(timeout=5)


def remove_private_data(directory):
    deadline = time.monotonic() + 5
    while True:
        try:
            shutil.rmtree(directory)
            return
        except OSError:
            if time.monotonic() >= deadline:
                raise
            time.sleep(0.1)


def run_case(binary, output, missing, *, phase=None, preferences=None, platform="windows"):
    require(phase in {None, "pin", "unpin", "verify-off"}, "Unknown preference phase")
    require((phase is None) == (preferences is None), "Preference phases need an owned shared directory")
    require(phase is None or not missing, "Preference phases require production permissions")
    name = f"restore-{phase}" if phase else ("missing-permission" if missing else "production-permissions")
    directory = Path(tempfile.mkdtemp(prefix="ott-window-controls-"))
    result = {"mode": name, "status": "fail"}
    process = None
    try:
        command = [str(binary), str(directory)] + (["--without-permission"] if missing else [])
        if phase:
            command += ["--preference-phase", phase]
        environment = os.environ.copy()
        environment["OTTPLAY_DATA_DIR"] = str(preferences if phase else directory / "preferences")
        environment.pop("OTTPLAY_INSTANCE", None)
        with (output / f"{name}.log").open("w", encoding="utf-8") as log:
            platform_options = {"start_new_session": True} if platform == "macos" else {}
            process = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT, env=environment, **platform_options)
            result["pid"] = process.pid
            try:
                result["exit_code"] = process.wait(timeout=40)
            finally:
                stop_owned_process(process, platform=platform)
        native = directory / "result.json"
        require(native.is_file(), "Native fixture produced no evidence")
        result["native"] = json.loads(native.read_text(encoding="utf-8"))
        require(result["exit_code"] == 0, f"Fixture exited {result['exit_code']}")
        if phase:
            validate_restoration_evidence(result["native"], phase, platform=platform)
            if platform == "windows":
                stored = preferences / "window-always-on-top"
                require(stored.is_file() and not stored.is_symlink(), "Preference file is missing or invalid")
                with stored.open("rb") as stream:
                    require(stream.read(3) == (b"1\n" if phase == "pin" else b"0\n"),
                            "Confirmed preference bytes were not retained")
            aspect_stored = preferences / "window-aspect-lock"
            require(aspect_stored.is_file() and not aspect_stored.is_symlink(), "Aspect preference file is missing or invalid")
            with aspect_stored.open("rb") as stream:
                require(stream.read(3) == (b"1\n" if phase == "pin" else b"0\n"),
                        "Confirmed aspect preference bytes were not retained")
            if platform == "windows":
                result["saved_preference"] = phase == "pin"
            result["saved_aspect_preference"] = phase == "pin"
        else:
            validate_evidence(result["native"], missing, platform=platform)
        result["status"] = "pass"
    except Exception as error:
        result["error"] = str(error)
        native = directory / "result.json"
        if native.is_file() and "native" not in result:
            try:
                result["native"] = json.loads(native.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                pass
    finally:
        try:
            if process is not None:
                stop_owned_process(process, platform=platform)
            remove_private_data(directory)
            result["private_data_removed"] = True
        except Exception as error:
            result["status"] = "fail"
            result["cleanup_error"] = str(error)
        (output / f"{name}.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    return result


def run_restoration_sequence(binary, output, *, platform="windows"):
    preferences = Path(tempfile.mkdtemp(prefix="ott-window-preferences-"))
    summary = {"status": "fail", "runs": []}
    try:
        for phase in ["pin", "unpin", "verify-off"]:
            result = run_case(binary, output, False, phase=phase, preferences=preferences,
                              **({"platform": platform} if platform != "windows" else {}))
            summary["runs"].append(result)
            require(result["status"] == "pass", f"Preference phase failed: {phase}")
        summary["status"] = "pass"
    except (OSError, RuntimeError) as error:
        summary["error"] = str(error)
    finally:
        try:
            remove_private_data(preferences)
            summary["preferences_removed"] = True
        except OSError as error:
            summary["status"] = "fail"
            summary["cleanup_error"] = str(error)
        (output / "restoration.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    return summary


def main():
    platform = "macos" if sys.platform == "darwin" else "windows"
    require(sys.platform == "darwin" or os.name == "nt", "Native window fixture requires Windows or macOS")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", type=Path, default=Path("target/debug/examples/window_controls_smoke" + (".exe" if platform == "windows" else "")))
    parser.add_argument("--output", type=Path, default=Path("build/" + platform + "-window-controls-report"))
    args = parser.parse_args()
    binary = args.binary.resolve()
    require(binary.is_file(), "Build window_controls_smoke before running the fixture")
    args.output.mkdir(parents=True, exist_ok=True)
    reports = [run_case(binary, args.output, missing, platform=platform) for missing in [True, False]]
    restoration = run_restoration_sequence(binary, args.output, platform=platform)
    passed = all(item["status"] == "pass" for item in reports) and restoration["status"] == "pass"
    summary = {"status": "pass" if passed else "fail", "runs": reports, "restoration": restoration}
    (args.output / "result.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2))
    return 0 if summary["status"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
