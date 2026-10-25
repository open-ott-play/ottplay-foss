"""Exercise installer transactions without launching apps or accessing user data."""

import importlib.util
from pathlib import Path
import plistlib
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("instance_apps", ROOT / "scripts/install-ottplay-instance-apps.py")
INSTALL = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(INSTALL)


class InstanceApps(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.home = self.root / "home"
        self.apps = self.root / "Applications"
        self.main = self.apps / "OttPlay FOSS.app"
        self.work = self.root / "work"
        (self.main / "Contents/MacOS").mkdir(parents=True)
        (self.main / INSTALL.EXECUTABLE).write_bytes(b"fixture executable")
        (self.main / "Contents/Info.plist").write_bytes(plistlib.dumps({
            "CFBundleIdentifier": INSTALL.IDENTIFIER,
            "CFBundleExecutable": "ottplay-tauri",
            "CFBundleShortVersionString": "1.2.3-beta.4",
        }))
        self.ports = {2: 18082, 3: 18085, 4: 18086}
        self.old_stores = {}
        for number, port in self.ports.items():
            app = self.apps / f"OttPlay FOSS {number}.app"
            (app / "Contents/MacOS").mkdir(parents=True)
            (app / "Contents/Info.plist").write_bytes(plistlib.dumps({
                "CFBundleIdentifier": f"com.ottplay.foss.inst{number}",
            }))
            (app / INSTALL.EXECUTABLE).write_text(
                f'#!/bin/bash\nexec env OTTPLAY_INSTANCE={number} OTTPLAY_QUEUE_PORT={port} '
                f'"{self.main / INSTALL.EXECUTABLE}" "$@"\n'
            )
            data = self.home / "Library/Application Support" / f"com.ottplay.foss.{number}"
            store = self.home / "Library/WebKit/com.ottplay.foss/WebsiteDataStore" / INSTALL.store_id(data)
            (store / "LocalStorage").mkdir(parents=True)
            (store / "LocalStorage/fixture.sqlite3").write_bytes(f"private fixture {number}".encode())
            self.old_stores[number] = store
        self.running = ""
        self.mock_run = patch.object(INSTALL, "run", side_effect=self.run_tool).start()
        patch.object(INSTALL.sys, "platform", "darwin").start()
        patch.object(INSTALL.platform, "mac_ver", return_value=("14.0", (), "")).start()
        self.addCleanup(patch.stopall)
        self.addCleanup(self.temp.cleanup)

    def run_tool(self, *args):
        if args[0] == "ps":
            return self.running
        if args[0] == "ditto":
            shutil.copytree(args[-2], args[-1], symlinks=True)
        elif args[0] not in ("codesign", INSTALL.LSREGISTER):
            self.fail(f"Unexpected command {args[0]}")
        return ""

    def prepare(self):
        return INSTALL.prepare(self.main, self.apps, self.work, self.home)

    def test_independent_apps_preserve_port_identity_and_original_stores(self):
        original = INSTALL.tree(self.main)
        stores = {n: INSTALL.tree(p) for n, p in self.old_stores.items()}
        self.prepare()
        result = INSTALL.apply(self.work)
        self.assertEqual(result["status"], "installed_pending_runtime_verification")
        self.assertTrue(result["launchServicesRefreshed"])
        registered = [call.args for call in self.mock_run.call_args_list
                      if call.args[0] == INSTALL.LSREGISTER]
        self.assertEqual(registered, [
            (INSTALL.LSREGISTER, "-f", str(self.apps / f"OttPlay FOSS {n}.app"))
            for n in self.ports
        ])
        self.assertEqual(INSTALL.tree(self.main), original)
        for n, port in self.ports.items():
            app = self.apps / f"OttPlay FOSS {n}.app"
            info = INSTALL.read_info(app)
            self.assertEqual(info["CFBundleIdentifier"], f"com.ottplay.foss.inst{n}")
            self.assertEqual(info["LSEnvironment"], {
                "OTTPLAY_INSTANCE": str(n), "OTTPLAY_QUEUE_PORT": str(port),
                "OTTPLAY_MANAGED_INSTANCE": "1",
            })
            self.assertEqual((app / INSTALL.EXECUTABLE).read_bytes(), b"fixture executable")
            self.assertFalse((app / INSTALL.EXECUTABLE).is_symlink())
            new = self.home / f"Library/WebKit/com.ottplay.foss.inst{n}/WebsiteDataStore" / self.old_stores[n].name
            self.assertEqual(INSTALL.tree(new), stores[n])
            self.assertEqual(INSTALL.tree(self.old_stores[n]), stores[n])
        with self.assertRaisesRegex(RuntimeError, "Previous apply"):
            INSTALL.apply(self.work)

    def test_unsupported_system_stops_before_files_or_commands(self):
        for version in ("13.6.9", "12.7", "", "unknown", "14.unknown"):
            with self.subTest(version=version), patch.object(
                INSTALL.platform, "mac_ver", return_value=(version, (), "")
            ):
                with self.assertRaisesRegex(RuntimeError, "macOS 14 or later"):
                    self.prepare()
                # No plan exists, and apply must reject the system before
                # attempting even to read it.
                with self.assertRaisesRegex(RuntimeError, "macOS 14 or later"):
                    INSTALL.apply(self.work)
                self.assertFalse(self.work.exists())
                self.mock_run.assert_not_called()

    def test_named_store_macos_versions_are_accepted(self):
        for version in ("14.0", "14.7.3", "15.1", "26.0.1"):
            with self.subTest(version=version), patch.object(
                INSTALL.platform, "mac_ver", return_value=(version, (), "")
            ):
                INSTALL.require_supported_macos()

    def test_existing_new_store_is_never_replaced_by_old_store(self):
        self.prepare()
        INSTALL.apply(self.work)
        new = self.home / "Library/WebKit/com.ottplay.foss.inst2/WebsiteDataStore" / self.old_stores[2].name
        (new / "LocalStorage/fixture.sqlite3").write_bytes(b"newer settings")
        before = INSTALL.tree(new)
        self.work = self.root / "second-work"
        self.prepare()
        INSTALL.apply(self.work)
        self.assertEqual(INSTALL.tree(new), before)

    def test_running_main_or_instance_blocks_prepare(self):
        self.running = str(self.main / INSTALL.EXECUTABLE)
        with self.assertRaisesRegex(RuntimeError, "Close the native players"):
            self.prepare()
        self.assertFalse(self.work.exists())

    def test_changed_profile_blocks_apply_before_intent(self):
        self.prepare()
        (self.old_stores[2] / "LocalStorage/fixture.sqlite3").write_bytes(b"new write")
        with self.assertRaisesRegex(RuntimeError, "Original profile changed"):
            INSTALL.apply(self.work)
        self.assertFalse((self.work / "apply-intent.json").exists())

    def test_changed_main_blocks_apply(self):
        self.prepare()
        (self.main / INSTALL.EXECUTABLE).write_bytes(b"new release")
        with self.assertRaisesRegex(RuntimeError, "Main app changed"):
            INSTALL.apply(self.work)

    def test_main_change_during_copy_blocks_preparation(self):
        original = self.run_tool

        def changing_copy(*args):
            result = original(*args)
            if args[0] == "ditto":
                (self.main / INSTALL.EXECUTABLE).write_bytes(b"different release")
            return result

        with patch.object(INSTALL, "run", side_effect=changing_copy):
            with self.assertRaisesRegex(RuntimeError, "Main app changed during preparation"):
                self.prepare()
        self.assertFalse((self.work / "plan.json").exists())

    def test_transaction_failure_rolls_back_apps_and_profile_copies(self):
        originals = {n: INSTALL.tree(self.apps / f"OttPlay FOSS {n}.app") for n in self.ports}
        self.prepare()
        replace = INSTALL.os.replace

        def failing_replace(source, target):
            if Path(source) == self.work / "candidates/OttPlay FOSS 3.app":
                raise OSError("fixture rename failure")
            return replace(source, target)

        with patch.object(INSTALL.os, "replace", side_effect=failing_replace):
            with self.assertRaisesRegex(OSError, "fixture rename failure"):
                INSTALL.apply(self.work)
        for n in self.ports:
            self.assertEqual(INSTALL.tree(self.apps / f"OttPlay FOSS {n}.app"), originals[n])
        self.assertTrue((self.work / "stores/2").is_dir())

    def test_unknown_legacy_launcher_does_not_guess_configuration(self):
        app = self.apps / "OttPlay FOSS 2.app"
        (app / INSTALL.EXECUTABLE).write_text("#!/bin/sh\nunknown-launch\n")
        with self.assertRaisesRegex(RuntimeError, "Unrecognized instance launcher"):
            self.prepare()

    def test_registration_failure_restores_and_reregisters_original_apps(self):
        originals = {n: INSTALL.tree(self.apps / f"OttPlay FOSS {n}.app") for n in self.ports}
        self.prepare()
        original = self.run_tool
        registrations = []
        failed = False

        def registration_failure(*args):
            nonlocal failed
            if args[0] == INSTALL.LSREGISTER:
                registrations.append(args)
                if not failed and args[1] == "-f" and args[2].endswith("3.app"):
                    failed = True
                    raise subprocess.CalledProcessError(1, args)
            return original(*args)

        with patch.object(INSTALL, "run", side_effect=registration_failure):
            with self.assertRaises(subprocess.CalledProcessError):
                INSTALL.apply(self.work)
        for n in self.ports:
            self.assertEqual(INSTALL.tree(self.apps / f"OttPlay FOSS {n}.app"), originals[n])
        expected_paths = [str(self.apps / f"OttPlay FOSS {n}.app") for n in (2, 3)]
        self.assertEqual(registrations, [
            (INSTALL.LSREGISTER, mode, app)
            for mode in ("-f", "-u", "-f") for app in expected_paths
        ])
        self.assertTrue((self.work / "stores/2").is_dir())

    def test_existing_instance_without_store_is_not_reset(self):
        shutil.rmtree(self.old_stores[2])
        with self.assertRaisesRegex(RuntimeError, "no recognized WebKit store"):
            self.prepare()


if __name__ == "__main__":
    unittest.main()
