"""Pure and mocked capture contracts. Never starts Cocoa, a compiler or a player."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("desktop_capture", ROOT / "scripts/ci-macos-desktop.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class DesktopCaptureContracts(unittest.TestCase):
    def test_capture_is_explicit_manual_only_and_conflicting_modes_fail(self):
        for event in ("pull_request", "push", "merge_group", "workflow_call"):
            self.assertFalse(MODULE.manual_capture(event, False, True))
        self.assertFalse(MODULE.manual_capture("workflow_dispatch", False, False))
        self.assertFalse(MODULE.manual_capture("workflow_dispatch", True, False))
        self.assertTrue(MODULE.manual_capture("workflow_dispatch", False, True))
        with self.assertRaises(RuntimeError):
            MODULE.manual_capture("workflow_dispatch", True, True)
        workflow = (ROOT / ".github/workflows/native-parity.yml").read_text()
        self.assertIn("inputs.desktop_acceptance == true && inputs.desktop_preflight_only != true", workflow)
        self.assertLess(workflow.index("python3 scripts/ci-macos-desktop.py preflight"),
                        workflow.index("python3 scripts/ci-macos-desktop.py capture"))
        self.assertIn('run: test "$DESKTOP_ACCEPTANCE" != true', workflow)

    def test_helper_result_must_match_requested_action(self):
        value = {"schema": 1, "action": "snapshot", "status": "ok"}
        self.assertIs(MODULE.validate_helper(value, "snapshot"), value)
        for action in ("finder-open", "finder-drop", "preflight"):
            with self.assertRaises(RuntimeError):
                MODULE.validate_helper(value, action)
        value["status"] = "refused"
        with self.assertRaises(RuntimeError):
            MODULE.validate_helper(value, "snapshot")

    def test_full_helper_requires_capabilities_but_not_appleevents(self):
        facts = dict.fromkeys(("accessibility", "post_events", "screen_capture",
                               "on_console", "login_complete", "display_active"), True)
        facts["finder_automation_status"] = -1743
        value = {"schema": 1, "action": "preflight", "status": "ok", "capabilities": facts}
        self.assertIs(MODULE.validate_helper(value, "preflight"), value)
        facts["screen_capture"] = False
        with self.assertRaises(RuntimeError):
            MODULE.validate_helper(value, "preflight")

    def test_architecture_is_actual_supported_host(self):
        for arch in ("arm64", "x86_64"):
            self.assertEqual(MODULE.host_architecture(arch), arch)
        with self.assertRaises(RuntimeError):
            MODULE.host_architecture("unknown")

    def test_config_uses_new_private_store_without_seeding_it(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {
                "GITHUB_RUN_ID": "123", "GITHUB_RUN_ATTEMPT": "1"}):
            output = Path(directory)
            config, environment = MODULE.generate_config(output, "a" * 40)
            self.assertEqual(config["identifier"], "com.ottplay.foss.qa123a1")
            self.assertEqual(environment["OTTPLAY_DATA_DIR"], str(output / "runtime-data"))
            self.assertFalse((output / "runtime-data").exists())
            self.assertEqual(environment["OTTPLAY_WEB_URL"], "")
            self.assertEqual(config["bundle"]["macOS"]["signingIdentity"], "-")
            (output / "runtime-data").mkdir()
            with self.assertRaises(RuntimeError):
                MODULE.generate_config(output, "a" * 40)

    def test_failed_child_keeps_failure_without_retry(self):
        with tempfile.TemporaryDirectory() as directory:
            runner = MODULE.Runner(Path(directory), 10)
            proc = Mock(pid=123, returncode=7)
            proc.poll.return_value = 7
            with patch.object(MODULE.subprocess, "Popen", return_value=proc) as spawn, \
                 patch.object(MODULE, "stop_owned", return_value=False):
                with self.assertRaises(RuntimeError):
                    runner.run("synthetic", ["not-executed"])
            spawn.assert_called_once()
            self.assertEqual(runner.commands[0]["exit_code"], 7)

    def test_timeout_stops_owned_group_and_retains_error(self):
        with tempfile.TemporaryDirectory() as directory:
            runner = MODULE.Runner(Path(directory), 10)
            proc = Mock(pid=123, returncode=None)
            proc.poll.return_value = None
            with patch.object(MODULE.subprocess, "Popen", return_value=proc), \
                 patch.object(MODULE, "stop_owned", return_value=True) as stop, \
                 patch.object(MODULE.time, "monotonic", side_effect=[0, 0, 11, 12]):
                with self.assertRaisesRegex(RuntimeError, "deadline"):
                    runner.run("synthetic", ["not-executed"], seconds=1)
            stop.assert_called_once_with(proc)

    def test_lingering_owned_group_is_not_success(self):
        with tempfile.TemporaryDirectory() as directory:
            runner = MODULE.Runner(Path(directory), 10)
            proc = Mock(pid=123, returncode=0)
            proc.poll.return_value = 0
            with patch.object(MODULE.subprocess, "Popen", return_value=proc), \
                 patch.object(MODULE, "stop_owned", return_value=True):
                with self.assertRaisesRegex(RuntimeError, "left its process group"):
                    runner.run("synthetic", ["not-executed"])


if __name__ == "__main__":
    unittest.main()
