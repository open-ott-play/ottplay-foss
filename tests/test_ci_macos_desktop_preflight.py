"""Pure hosted-preflight contracts; no Cocoa, player or compiler is executed."""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("desktop_preflight", ROOT / "scripts/ci-macos-desktop-preflight.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class DesktopPreflightContracts(unittest.TestCase):
    def test_only_explicit_manual_request_can_suppress_existing_native_jobs(self):
        workflow = (ROOT / ".github/workflows/native-parity.yml").read_text()
        guard = "if: \u0024{{ !(github.event_name == 'workflow_dispatch' && (inputs.desktop_preflight_only == true || inputs.desktop_acceptance == true || inputs.windows_video_geometry_only == true)) }}"
        for job in ("shared-guide", "android", "apple", "favorites-native", "linux-window-controls"):
            self.assertIn("  " + job + ":\n    " + guard, workflow)
        self.assertIn("if: \u0024{{ github.event_name == 'workflow_dispatch' && inputs.desktop_preflight_only == true && inputs.windows_video_geometry_only != true }}",
                      workflow)
        self.assertIn("type: boolean\n        default: false", workflow)

    def test_windows_video_mode_reuses_production_build_and_keeps_normal_checks_required(self):
        workflow = (ROOT / ".github/workflows/native-parity.yml").read_text()
        self.assertIn("windows_video_geometry_only:\n        description:", workflow)
        windows = workflow.split("  windows-installers:\n", 1)[1].split("\n  android:", 1)[0]
        self.assertIn("inputs.windows_video_geometry_only != true && (inputs.desktop_preflight_only == true || inputs.desktop_acceptance == true)", windows)
        self.assertIn("timeout-minutes: 60", windows)
        self.assertIn('npx --no-install tauri build --ci --bundles "nsis,msi" -- --locked', windows)
        normal = "if: ${{ github.event_name != 'workflow_dispatch' || inputs.windows_video_geometry_only != true }}"
        manual = "if: ${{ github.event_name == 'workflow_dispatch' && inputs.windows_video_geometry_only == true }}"
        for name in (
            "Test Windows native-check failure propagation and text encoding",
            "Check installer harness and native dependency constraints",
            "Exercise updater ZIP extraction on Windows",
            "Bundle MSI and NSIS without signing or publishing",
            "Verify embedded manifests before native tests",
            "Test main-window control contracts on Windows",
            "Test native aspect command and geometry contracts",
            "Test saved window preferences",
            "Test fullscreen confirmation contracts on Windows",
            "Test local drop and OS file-open contracts on Windows",
            "Check owned-window smoke runner",
            "Test isolated window fixture watchdog contracts on Windows",
            "Build isolated window controls fixture",
            "Verify isolated fixture manifest before launch",
            "Exercise native window IPC and ACL on Windows",
            "Install, verify and uninstall both native packages",
        ):
            self.assertIn("      - name: " + name + "\n        " + normal, windows)
        for name in (
            "Build production EXE without installer bundles for manual video acceptance",
            "Verify production EXE manifest for manual video acceptance",
        ):
            self.assertIn("      - name: " + name + "\n        " + manual, windows)
        self.assertIn("npx --no-install tauri build --ci --no-bundle -- --locked", windows)
        self.assertIn("python scripts/check-windows-manifest.py --binary target/release/ottplay-tauri.exe --output build/windows-video-geometry-report/production-manifest.json", windows)
        block = windows.split("      - name: Test native video pixel oracle and capture failure contracts\n", 1)[1].split("      - name: Restore owned WebView2 debug policy after native video acceptance\n", 1)[0]
        self.assertIn("python tests/test_windows_video_oracle.py\n          if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }", block)
        self.assertIn("python tests/test_windows_video_capture.py\n          if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }", block)
        self.assertIn("timeout-minutes: 15\n        run: node scripts/check-windows-video-geometry.cjs", block)
        self.assertNotIn("if:", block)
        self.assertNotIn("continue-on-error", block)
        self.assertIn("python tests/test_windows_video_debug_policy.py\n          if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }", block)
        cleanup = windows.split("      - name: Restore owned WebView2 debug policy after native video acceptance\n", 1)[1].split("      - name:", 1)[0]
        self.assertIn("if: always()", cleanup)
        self.assertIn("Join-Path $env:GITHUB_WORKSPACE", cleanup)
        self.assertIn("-Action Restore -Receipt $receipt", cleanup)
        self.assertIn("if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }", cleanup)
        self.assertNotIn("continue-on-error", cleanup)
        display_cleanup = windows.split("      - name: Restore owned desktop display after native video acceptance\n", 1)[1].split("      - name:", 1)[0]
        self.assertIn("if: always()", display_cleanup)
        self.assertIn("Join-Path $env:GITHUB_WORKSPACE", display_cleanup)
        self.assertIn("-Action Restore -Receipt $receipt", display_cleanup)
        self.assertIn("if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }", display_cleanup)
        self.assertNotIn("continue-on-error", display_cleanup)
        display_preflight = windows.split("      - name: Qualify hosted desktop display before compiling the native player\n", 1)[1].split("      - ", 1)[0]
        self.assertIn("timeout-minutes: 2", display_preflight)
        self.assertIn("run: python tests/test_windows_video_display.py", display_preflight)
        self.assertNotIn("if:", display_preflight)
        self.assertNotIn("continue-on-error", display_preflight)
        self.assertLess(windows.index("run: python tests/test_windows_video_display.py"), windows.index("Bundle MSI and NSIS"))
        self.assertLess(windows.index("node scripts/check-windows-video-geometry.cjs"), windows.index("python scripts/check-windows-installers.py"))
        evidence = windows.split("      - name: Preserve native video geometry evidence\n", 1)[1].split("      - name:", 1)[0]
        self.assertIn("if: always()", evidence)
        self.assertIn("path: |\n            build/windows-video-geometry-report/result.json\n            build/windows-video-geometry-report/*.log", evidence)
        self.assertNotIn("*.bmp", evidence)
        self.assertNotIn("path: build/windows-video-geometry-report/", evidence)
        self.assertIn("retention-days: 14", evidence)
        for job in ("desktop-preflight", "desktop-capture"):
            section = workflow.split("  " + job + ":\n", 1)[1].split("    runs-on:", 1)[0]
            self.assertIn("inputs.windows_video_geometry_only != true", section)

    def test_refused_or_incomplete_capability_is_not_success(self):
        for value in ({}, {"schema": 1, "action": "preflight", "status": "refused"},
                      {"schema": 1, "action": "snapshot", "status": "ok"}):
            with self.assertRaises(RuntimeError):
                MODULE.validate_capabilities(value)
        good = {"schema": 1, "action": "preflight", "status": "ok", "missing": [],
                "capabilities": dict.fromkeys(("usage", "macos_14_or_later", "accessibility",
                    "post_events", "screen_capture", "on_console", "login_complete", "display_active",
                    "finder_running", "finder_ax_menu"), True)}
        self.assertIs(MODULE.validate_capabilities(good), good)
        # Finder AppleEvent permission is observed, not used by the AX/Workspace route.
        good["capabilities"]["finder_automation"] = False
        good["capabilities"]["finder_automation_status"] = -1743
        self.assertIs(MODULE.validate_capabilities(good), good)
        good["capabilities"]["finder_ax_menu"] = False
        with self.assertRaises(RuntimeError):
            MODULE.validate_capabilities(good)

    def test_swift_target_uses_host_architecture_and_explicit_deployment(self):
        for arch in ("arm64", "x86_64"):
            self.assertEqual(MODULE.swift_target(arch), arch + "-apple-macosx14.0")
        with self.assertRaises(RuntimeError):
            MODULE.swift_target("unsupported")

    def test_child_failure_keeps_nonzero_and_is_not_retried(self):
        with tempfile.TemporaryDirectory() as directory:
            proc = Mock(pid=123, returncode=17)
            proc.poll.return_value = 17
            with patch.object(MODULE.subprocess, "Popen", return_value=proc) as spawn, \
                 patch.object(MODULE, "stop_owned", return_value=False):
                with self.assertRaises(RuntimeError):
                    MODULE.run_owned(["synthetic"], Path(directory) / "child.log", 1)
            spawn.assert_called_once()
            evidence = json.loads((Path(directory) / "child.json").read_text())
            self.assertEqual(evidence["exit_code"], 17)

    def test_timeout_still_stops_only_owned_child(self):
        with tempfile.TemporaryDirectory() as directory:
            proc = Mock(pid=123, returncode=None)
            proc.poll.return_value = None
            with patch.object(MODULE.subprocess, "Popen", return_value=proc), \
                 patch.object(MODULE, "stop_owned", return_value=True) as stop, \
                 patch.object(MODULE.time, "monotonic", side_effect=[0, 2, 3]):
                with self.assertRaisesRegex(RuntimeError, "deadline"):
                    MODULE.run_owned(["synthetic"], Path(directory) / "child.log", 1)
            stop.assert_called_once_with(proc)

    def test_orphan_cleanup_cannot_turn_success_into_pass(self):
        with tempfile.TemporaryDirectory() as directory:
            proc = Mock(pid=123, returncode=0)
            proc.poll.return_value = 0
            with patch.object(MODULE.subprocess, "Popen", return_value=proc), \
                 patch.object(MODULE, "stop_owned", return_value=True):
                with self.assertRaisesRegex(RuntimeError, "left an owned"):
                    MODULE.run_owned(["synthetic"], Path(directory) / "child.log", 1)


if __name__ == "__main__":
    unittest.main()
