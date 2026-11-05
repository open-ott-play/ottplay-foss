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


    def test_helper_breadcrumbs_stay_separate_from_single_json_stdout(self):
        with tempfile.TemporaryDirectory() as directory:
            runner = MODULE.Runner(Path(directory), 10)
            proc = Mock(pid=123, returncode=0)
            proc.poll.return_value = 0
            def fake_spawn(argv, *, stdout, stderr, **kwargs):
                self.assertIsNot(stdout, stderr)
                stdout.write(b'{"schema":1,"action":"snapshot","status":"ok"}\n')
                stderr.write(b'{"phase":"synthetic","state":"before"}\n')
                return proc
            with patch.object(MODULE.subprocess, "Popen", side_effect=fake_spawn), \
                 patch.object(MODULE, "stop_owned", return_value=False):
                result = runner.helper("synthetic", Path("unused"), "snapshot")
            self.assertEqual(result["action"], "snapshot")
            self.assertIn('"phase":"synthetic"', (Path(directory) / "synthetic.stderr.log").read_text())
            self.assertEqual(runner.commands[0]["stderr_sha256"],
                             MODULE.sha(Path(directory) / "synthetic.stderr.log"))

    def test_helper_still_rejects_multiple_stdout_documents(self):
        with tempfile.TemporaryDirectory() as directory:
            runner = MODULE.Runner(Path(directory), 10)
            with patch.object(runner, "run", return_value='{}\n{}\n'):
                with self.assertRaises(json.JSONDecodeError):
                    runner.helper("synthetic", Path("unused"), "snapshot")

    def test_helper_stderr_budget_failure_remains_failed(self):
        with tempfile.TemporaryDirectory() as directory:
            runner = MODULE.Runner(Path(directory), 10)
            proc = Mock(pid=123, returncode=0)
            proc.poll.return_value = 0
            def fake_spawn(argv, *, stdout, stderr, **kwargs):
                stderr.seek(2 * 1024 * 1024)
                stderr.write(b'x')
                stderr.flush()
                return proc
            with patch.object(MODULE.subprocess, "Popen", side_effect=fake_spawn), \
                 patch.object(MODULE, "stop_owned", return_value=False) as stop:
                with self.assertRaisesRegex(RuntimeError, "stderr budget"):
                    runner.helper("synthetic", Path("unused"), "snapshot")
            stop.assert_called_once_with(proc)
            self.assertEqual(runner.commands[0]["status"], "failed")

    def test_one_readonly_failure_diagnostic_preserves_primary_failure(self):
        receipt = {"status": "FAILED", "error": "primary cold-open deadline"}
        runner = Mock()
        runner.helper.side_effect = RuntimeError("diagnostic unavailable")
        MODULE.collect_failure_evidence(receipt, runner, Path("unused"))
        runner.helper.assert_called_once_with("finder-failure-state", Path("unused"),
                                              "finder-diagnostic", seconds=12, cleanup=True)
        self.assertEqual(receipt["error"], "primary cold-open deadline")
        self.assertEqual(receipt["status"], "FAILED")
        self.assertIn("diagnostic unavailable", receipt["finder_diagnostic_error"])

    def test_success_does_not_trigger_failure_diagnostic(self):
        runner = Mock()
        receipt = {"status": "CAPTURED_REQUIRES_VISUAL_REVIEW"}
        MODULE.collect_failure_evidence(receipt, runner, Path("unused"))
        runner.helper.assert_not_called()

    def test_original_child_failure_survives_cleanup_error(self):
        with tempfile.TemporaryDirectory() as directory:
            runner = MODULE.Runner(Path(directory), 10)
            proc = Mock(pid=123, returncode=7)
            proc.poll.return_value = 7
            with patch.object(MODULE.subprocess, "Popen", return_value=proc), \
                 patch.object(MODULE, "stop_owned", side_effect=RuntimeError("cleanup failed")):
                with self.assertRaisesRegex(RuntimeError, "command failed"):
                    runner.run("synthetic", ["not-executed"])
            self.assertEqual(runner.commands[0]["exit_code"], 7)
            self.assertIn("cleanup failed", runner.commands[0]["cleanup_error"])


if __name__ == "__main__":
    unittest.main()
