"""Portable cross-build admission and real Mach-O byte checks; no compiler or app runs."""

import importlib.util
import plistlib
import struct
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import yaml

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("check_macos_cross_build", ROOT / "scripts/check_macos_cross_build.py")
cross = importlib.util.module_from_spec(SPEC)
with mock.patch.object(sys, "path", [str(ROOT / "scripts"), *sys.path]):
    SPEC.loader.exec_module(cross)

HOST_ENV = {"GITHUB_ACTIONS": "true", "RUNNER_ENVIRONMENT": "github-hosted",
            "RUNNER_OS": "macOS", "RUNNER_ARCH": "X64"}


class Prerequisites(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.sdk = Path(self.temporary.name).resolve()
        self.environment = mock.patch.dict(cross.os.environ, HOST_ENV, clear=True)
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.system = mock.patch.object(cross.platform, "system", return_value="Darwin").start()
        self.machine = mock.patch.object(cross.platform, "machine", return_value="x86_64").start()
        self.addCleanup(mock.patch.stopall)
        self.run = mock.patch.object(cross.subprocess, "run", side_effect=[
            SimpleNamespace(stdout=cross.TARGET + "\nx86_64-apple-darwin\n", stderr=""),
            SimpleNamespace(stdout=str(self.sdk) + "\n", stderr=""),
            SimpleNamespace(stdout="", stderr=""),
        ]).start()

    def test_hosted_intel_admits_only_installed_target_and_syntax_only_sdk_check(self):
        result = cross.preflight()
        self.assertEqual(result["target"], cross.TARGET)
        self.assertFalse(result["runtimeAccepted"])
        self.assertEqual(self.run.call_count, 3)
        self.assertEqual(self.run.call_args_list[0].args[0], ["rustup", "target", "list", "--installed"])
        self.assertEqual(self.run.call_args_list[1].args[0], ["xcrun", "--sdk", "macosx", "--show-sdk-path"])
        invocation = self.run.call_args_list[2]
        self.assertEqual(invocation.args[0], ["xcrun", "--sdk", "macosx", "clang",
                         "--target=arm64-apple-macos11.0", "-isysroot", str(self.sdk),
                         "-fsyntax-only", "-x", "c", "-"])
        self.assertEqual(invocation.kwargs["input"], cross.TARGET_CHECK)
        for macro in ("__aarch64__", "__APPLE__", "TARGET_OS_OSX", "TARGET_OS_IPHONE"):
            self.assertIn(macro, invocation.kwargs["input"])
        for call in self.run.call_args_list:
            self.assertEqual(call.kwargs["timeout"], 30)
            self.assertTrue(call.kwargs["check"])

    def test_local_wrong_host_and_untrusted_runner_fail_before_any_tool(self):
        for key in HOST_ENV:
            with self.subTest(key=key), mock.patch.dict(cross.os.environ, {key: "wrong"}), \
                 self.assertRaisesRegex(ValueError, "hosted Intel"):
                cross.preflight()
        for mocked, wrong in ((self.system, "Linux"), (self.machine, "arm64")):
            original = mocked.return_value
            mocked.return_value = wrong
            with self.subTest(host=wrong), self.assertRaisesRegex(ValueError, "hosted Intel"):
                cross.preflight()
            mocked.return_value = original
        self.run.assert_not_called()

    def test_missing_target_or_sdk_never_reaches_compiler(self):
        self.run.side_effect = [SimpleNamespace(stdout="x86_64-apple-darwin\n", stderr="")]
        with self.assertRaisesRegex(ValueError, "target is not installed"):
            cross.preflight()
        self.assertEqual(self.run.call_count, 1)
        for sdk in ("relative-sdk", str(self.sdk / "missing")):
            self.run.reset_mock()
            self.run.side_effect = [SimpleNamespace(stdout=cross.TARGET, stderr=""),
                                    SimpleNamespace(stdout=sdk, stderr="")]
            with self.subTest(sdk=sdk), self.assertRaisesRegex(ValueError, "SDK is unavailable"):
                cross.preflight()
            self.assertEqual(self.run.call_count, 2)

    def test_compiler_rejection_timeout_and_unbounded_output_do_not_pass(self):
        for error in (subprocess.CalledProcessError(1, "synthetic-clang"),
                      subprocess.TimeoutExpired("synthetic-clang", 30)):
            self.run.side_effect = [SimpleNamespace(stdout=cross.TARGET, stderr=""),
                                    SimpleNamespace(stdout=str(self.sdk), stderr=""), error]
            with self.subTest(error=type(error)), self.assertRaises(type(error)):
                cross.preflight()
        self.run.side_effect = [SimpleNamespace(stdout="x" * 16385, stderr="")]
        with self.assertRaisesRegex(ValueError, "output exceeds"):
            cross.preflight()


class AppFormat(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name).resolve()
        self.app = self.directory / "OttPlay FOSS.app"
        self.contents = self.app / "Contents"
        self.macos = self.contents / "MacOS"
        self.macos.mkdir(parents=True)
        self.plist = self.contents / "Info.plist"
        self.binary = self.macos / "ottplay-tauri"
        self.write_info("ottplay-tauri")
        # A genuine Mach-O header/load-command layout, deliberately not runnable.
        self.valid = struct.pack("<8I", 0xFEEDFACF, 0x0100000C, 0, 2, 1, 24, 0, 0)
        self.valid += struct.pack("<IIQQ", 0x80000028, 24, 0, 0)
        self.binary.write_bytes(self.valid)

    def write_info(self, name):
        self.plist.write_bytes(plistlib.dumps({"CFBundleExecutable": name}))

    def test_actual_plist_selected_arm64_bytes_pass_without_process_execution(self):
        with mock.patch.object(cross.subprocess, "run", side_effect=AssertionError("No native execution")):
            result = cross.verify_app(self.directory)
        self.assertEqual(result["status"], "arm64-format-verified")
        self.assertEqual(result["binary"]["name"], "ottplay-tauri")
        self.assertEqual(result["binary"]["size"], len(self.valid))
        self.assertFalse(result["runtimeAccepted"])

    def test_intel_fat_non_executable_and_malformed_load_commands_fail(self):
        mutations = [(0, 0xCAFEBABE), (1, 0x01000007), (3, 6), (4, 2), (5, 16)]
        for field, value in mutations:
            changed = bytearray(self.valid)
            struct.pack_into("<I", changed, field * 4, value)
            self.binary.write_bytes(changed)
            with self.subTest(field=field), self.assertRaises(ValueError):
                cross.verify_app(self.directory)
        self.binary.write_bytes(self.valid[:31])
        with self.assertRaises(ValueError):
            cross.verify_app(self.directory)

    def test_executable_basename_rejects_escape_and_wrong_types(self):
        for name in ("../ottplay-tauri", "/ottplay-tauri", "..", ".", "a/b", "a\\b", "a:b", "", 42):
            self.write_info(name)
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, "single filename"):
                cross.verify_app(self.directory)

    def test_missing_or_multiple_apps_and_missing_executable_fail(self):
        self.app.rename(self.directory / "not-an-app")
        with self.assertRaisesRegex(ValueError, "exactly one"):
            cross.verify_app(self.directory)
        (self.directory / "not-an-app").rename(self.app)
        other = self.directory / "extra.app"
        other.mkdir()
        with self.assertRaisesRegex(ValueError, "exactly one"):
            cross.verify_app(self.directory)
        other.rmdir()
        self.binary.unlink()
        with self.assertRaises(FileNotFoundError):
            cross.verify_app(self.directory)

    def test_symlink_binary_plist_and_directory_aliases_fail(self):
        for path in (self.binary, self.plist, self.macos):
            retained = path.with_name(path.name + "-retained")
            path.rename(retained)
            path.symlink_to(retained.name, target_is_directory=retained.is_dir())
            try:
                with self.subTest(path=path.name), self.assertRaises(ValueError):
                    cross.verify_app(self.directory)
            finally:
                path.unlink()
                retained.rename(path)

    def test_plist_and_binary_size_bounds_use_shared_reader(self):
        self.plist.write_bytes(b"x" * (cross.MAX_PLIST_BYTES + 1))
        with self.assertRaisesRegex(ValueError, "size is outside"):
            cross.verify_app(self.directory)
        self.write_info("ottplay-tauri")
        with mock.patch.object(cross.artifact, "MAX_BINARY_BYTES", len(self.valid) - 1), \
             self.assertRaisesRegex(ValueError, "size is outside"):
            cross.verify_app(self.directory)


class WorkflowIdentity(unittest.TestCase):
    def test_only_arm_package_runner_changes_and_checks_precede_staging(self):
        workflow = yaml.safe_load((ROOT / ".github/workflows/release-build.yml").read_text())
        job = workflow["jobs"]["tauri"]
        rows = job["strategy"]["matrix"]["include"]
        arm = next(row for row in rows if row["target"] == cross.TARGET)
        self.assertEqual(arm, {"platform": "macos-latest", "target": cross.TARGET, "runner": "macos-15-intel"})
        self.assertTrue(all("runner" not in row for row in rows if row is not arm))
        self.assertEqual(job["runs-on"], "${{ matrix.runner || matrix.platform }}")
        self.assertIn("matrix.runner || matrix.platform", job["name"])
        steps = {step.get("name"): step for step in job["steps"]}
        self.assertIn("matrix.runner || matrix.platform", steps["Rust cache"]["with"]["shared-key"])
        for name in ("Verify Intel macOS cross-build prerequisites", "Verify cross-built macOS application architecture"):
            self.assertEqual(steps[name]["if"], "matrix.runner == 'macos-15-intel'")
        names = list(steps)
        self.assertLess(names.index("Install Rust target"), names.index("Verify Intel macOS cross-build prerequisites"))
        self.assertLess(names.index("Verify Intel macOS cross-build prerequisites"), names.index("Build desktop package"))
        self.assertLess(names.index("Collect desktop bundles"), names.index("Verify cross-built macOS application architecture"))
        self.assertLess(names.index("Verify cross-built macOS application architecture"), names.index("Verify and stage versioned release assets"))
        self.assertEqual(steps["Build macOS ARM64 server from frozen release inputs"]["if"],
                         "matrix.platform == 'macos-latest' && matrix.target == 'aarch64-apple-darwin'")
        self.assertIn("matrix.platform", steps["Detect optional signing / notarize secrets"]["run"])
        self.assertEqual(steps["Verify and stage versioned release assets"]["env"]["RELEASE_ASSET_TARGET"],
                         "desktop-${{ matrix.platform }}-${{ matrix.target || 'host' }}")
        self.assertEqual(job["timeout-minutes"], 90)


if __name__ == "__main__":
    unittest.main()
