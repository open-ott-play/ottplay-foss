"""Exercise the real Python suite runner without launching coverage or runtimes."""

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("python_suite_runner", ROOT / "scripts/test-python.py")
RUNNER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RUNNER)


class PythonSuiteInventoryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="python-suite-inventory-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        (self.root / "tests").mkdir()
        self.suites = {
            "portable": [["tests/test_portable.py"]],
            "android": [["tests/test_android.py", "--source-only"]],
            "ios": [["tests/test_ios.py", "--source-only"]],
        }
        for cases in self.suites.values():
            (self.root / cases[0][0]).write_text("raise AssertionError('must never execute')\n")
        self.write_inventory()

    def write_inventory(self):
        (self.root / "tests/python-suites.json").write_text(json.dumps(self.suites))

    def run_main(self, arguments):
        with mock.patch.object(RUNNER, "ROOT", self.root), \
                mock.patch.object(sys, "argv", ["test-python.py", *arguments]):
            return RUNNER.main()

    def test_valid_check_all_profiles_creates_no_reports_or_subprocesses(self):
        before = set(self.root.rglob("*"))
        for profile in self.suites:
            with self.subTest(profile=profile), \
                    mock.patch.object(RUNNER.subprocess, "run") as execute, \
                    mock.patch.object(Path, "mkdir", side_effect=AssertionError("must not create reports")):
                self.assertEqual(self.run_main(["--profile", profile, "--check-inventory"]), 0)
                execute.assert_not_called()
        self.assertEqual(set(self.root.rglob("*")), before)

    def assert_inventory_refused(self, path):
        for arguments in ([], ["--check-inventory"]):
            with self.subTest(arguments=arguments), \
                    mock.patch.object(RUNNER.subprocess, "run") as execute, \
                    mock.patch.object(Path, "mkdir", side_effect=AssertionError("must not create reports")):
                with self.assertRaisesRegex(SystemExit, "Python suite inventory mismatch") as error:
                    self.run_main(arguments)
                self.assertIn(path, str(error.exception))
                execute.assert_not_called()
                self.assertFalse((self.root / "reports").exists())

    def test_missing_registration_fails_check_and_normal_mode(self):
        path = "tests/test_unregistered.py"
        (self.root / path).write_text("raise AssertionError('must never execute')\n")
        self.assert_inventory_refused(path)

    def test_stale_registration_fails_check_and_normal_mode(self):
        path = "tests/test_removed.py"
        self.suites["portable"].append([path])
        self.write_inventory()
        self.assert_inventory_refused(path)

    def test_default_portable_mode_retains_coverage_and_result_execution(self):
        def completed(command, **_kwargs):
            if command[3:4] == ["json"]:
                covered = {path: {} for path in (
                    "local_proxy.py", "archive/proxy_security.py",
                    "scripts/smoke-xmltv-cache-refresh.py", "scripts/prepare-container-workspace.py",
                )}
                (self.root / "reports/python/coverage.json").write_text(json.dumps({"files": covered}))
            return subprocess.CompletedProcess(command, 0)

        with mock.patch.object(RUNNER.subprocess, "run", side_effect=completed) as execute:
            self.assertEqual(self.run_main([]), 0)
        prefix = [sys.executable, "-m", "coverage"]
        self.assertEqual([call.args[0] for call in execute.call_args_list], [
            [*prefix, "erase"],
            [*prefix, "run", "--parallel-mode", "tests/test_portable.py"],
            [*prefix, "combine"],
            [*prefix, "json", "-o", "reports/python/coverage.json"],
            [*prefix, "report"],
            [*prefix, "xml"],
        ])
        runtime_call = execute.call_args_list[1]
        self.assertEqual(runtime_call.kwargs["timeout"], 600)
        self.assertEqual(runtime_call.kwargs["env"]["PYTHONDONTWRITEBYTECODE"], "1")
        result = json.loads((self.root / "reports/python/portable-results.json").read_text())
        self.assertEqual([(item["case"], item["exit_code"]) for item in result],
                         [(self.suites["portable"][0], 0)])

    def test_explicit_profiles_keep_commands_and_failures_without_coverage(self):
        for profile in ("android", "ios"):
            with self.subTest(profile=profile), \
                    mock.patch.object(RUNNER.subprocess, "run", return_value=
                                      subprocess.CompletedProcess([], 7)) as execute:
                self.assertEqual(self.run_main(["--profile", profile]), 1)
                execute.assert_called_once()
                self.assertEqual(execute.call_args.args[0],
                                 [sys.executable, *self.suites[profile][0]])
                self.assertEqual(execute.call_args.kwargs["timeout"], 600)
                result = json.loads((self.root / f"reports/python/{profile}-results.json").read_text())
                self.assertEqual(result[0]["exit_code"], 7)


if __name__ == "__main__":
    unittest.main()
