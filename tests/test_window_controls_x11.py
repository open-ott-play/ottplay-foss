#!/usr/bin/env python3
"""Validate X11 evidence contracts without opening a display or starting native code."""
import copy
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("window_controls_x11", ROOT / "scripts/check-window-controls.py")
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


def state(enabled=False, active=None):
    return {"ok": True, "supported": True, "enabled": enabled,
            "active": enabled if active is None else active}


def native(active=False, fullscreen=False, maximized=False):
    return {"label": "main", "xid": 42, "pid": 123, "rect": [40, 40, 640, 400],
            "hints": 48 | (128 if active else 0), "min_size": [320, 180],
            "max_size": [1600, 1000], "min_aspect": [16, 9] if active else [0, 0],
            "max_aspect": [16, 9] if active else [0, 0], "fullscreen": fullscreen,
            "maximized": maximized, "above": False, "wm_present": True}


def evidence(missing=False):
    commands = (["set_always_on_top", "set_fullscreen", "toggle_fullscreen"] if missing
                else ["set_always_on_top"]) + ["get_window_aspect_lock", "set_window_aspect_lock"]
    report = {"status": "pass", "platform": "linux-x11", "owned_labels": ["main", "pip"],
              "cleanup_errors": [], "mode": "missing-permission" if missing else "production-permissions",
              "denials": [{"window": "main" if missing else "pip", "command": name,
                           "error": "command not allowed"} for name in commands],
              "requested_content": [640, 400], "baseline": native()}
    if not missing:
        report.update({"aux_unchanged": True, "initial_state": state(),
                       "set_sequence": [{"state": state(on), "native": native(on)}
                                        for on in (True, True, False, False)],
                       "transitions": [{"kind": kind, "target": target,
                                        "state": state(True, not target),
                                        "native": native(not target, kind != "maximize" and target,
                                                         kind == "maximize" and target)}
                                       for kind in ("toggle_fullscreen", "set_fullscreen", "maximize")
                                       for target in (True, False)],
                       "final": native(), "final_state": state()})
    return report


def restoration(phase):
    initial, final = phase == "unpin", phase == "pin"
    return {"status": "pass", "platform": "linux-x11", "owned_labels": ["main", "pip"],
            "cleanup_errors": [], "mode": "preference-restoration", "phase": phase,
            "requested_content": [640, 400], "aux_unchanged": True,
            "initial": native(initial), "initial_state": state(initial),
            "final": native(final), "final_state": state(final)}


class X11WindowEvidenceTests(unittest.TestCase):
    def test_complete_native_acl_and_preference_evidence(self):
        for missing in (True, False):
            runner.validate_evidence(evidence(missing), missing, platform="linux")
        for phase in ("pin", "unpin", "verify-off"):
            runner.validate_restoration_evidence(restoration(phase), phase, platform="linux")

    def test_initial_toggle_and_saved_on_geometry_jump_are_rejected(self):
        for key in ("baseline", "final"):
            report = evidence()
            report[key]["rect"][3] = 360
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                runner.validate_evidence(report, False, platform="linux")
        report = evidence()
        report["set_sequence"][0]["native"]["rect"][0] += 10
        with self.assertRaises(RuntimeError):
            runner.validate_evidence(report, False, platform="linux")
        report = restoration("unpin")
        report["initial"]["rect"][3] = 360
        with self.assertRaises(RuntimeError):
            runner.validate_restoration_evidence(report, "unpin", platform="linux")

    def test_lost_bounds_and_wrong_active_or_disabled_hint_are_rejected(self):
        for key, value in (("hints", 128), ("min_size", [1, 1]),
                           ("max_size", [999, 999]), ("min_aspect", [4, 3]),
                           ("max_aspect", [0, 0]), ("hints", 48)):
            report = evidence()
            report["set_sequence"][0]["native"][key] = value
            with self.subTest(key=key, value=value), self.assertRaises(RuntimeError):
                runner.validate_evidence(report, False, platform="linux")
        report = evidence()
        report["final"]["hints"] |= 128
        with self.assertRaises(RuntimeError):
            runner.validate_evidence(report, False, platform="linux")

    def test_foreign_identity_missing_wm_changed_pip_and_wrong_backend_refuse(self):
        for key, value in (("xid", 99), ("pid", 999), ("wm_present", False)):
            report = evidence()
            report["set_sequence"][0]["native"][key] = value
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                runner.validate_evidence(report, False, platform="linux")
        for key, value in (("aux_unchanged", False), ("platform", "wayland")):
            report = evidence()
            report[key] = value
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                runner.validate_evidence(report, False, platform="linux")
        report = evidence()
        report["initial_state"]["supported"] = False
        with self.assertRaises(RuntimeError):
            runner.validate_evidence(report, False, platform="linux")

    def test_missing_or_unrestored_native_transition_is_rejected(self):
        base = evidence()
        cases = []
        report = copy.deepcopy(base)
        report["transitions"].pop()
        cases.append(report)
        for index, key, value in ((0, "hints", 176), (0, "fullscreen", False),
                                  (4, "maximized", False), (5, "rect", [40, 40, 800, 600])):
            report = copy.deepcopy(base)
            report["transitions"][index]["native"][key] = value
            cases.append(report)
        for report in cases:
            with self.subTest(report=report), self.assertRaises(RuntimeError):
                runner.validate_evidence(report, False, platform="linux")

    def test_saved_on_requires_eager_native_hint_and_denial_requires_acl(self):
        report = restoration("unpin")
        report["initial"]["hints"] = 48
        with self.assertRaises(RuntimeError):
            runner.validate_restoration_evidence(report, "unpin", platform="linux")
        report = evidence(True)
        report["denials"][0]["error"] = "IPC timed out"
        with self.assertRaises(RuntimeError):
            runner.validate_evidence(report, True, platform="linux")


if __name__ == "__main__":
    unittest.main()
