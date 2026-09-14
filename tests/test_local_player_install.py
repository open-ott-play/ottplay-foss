"""Exercise local installer configuration without changing the host service."""

import os
from pathlib import Path
import plistlib
import re
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
INSTALLER = ROOT / "scripts/install-ottplay-local-service.sh"
SOURCE = INSTALLER.read_text()


def embedded_python(marker):
    match = re.search(r"<<'" + marker + r"'\n(.*?)\n" + marker + r"\n", SOURCE, re.S)
    if not match:
        raise AssertionError("Missing executable installer configuration: " + marker)
    return match.group(1)


class LocalPlayerInstallTest(unittest.TestCase):
    def test_unload_waits_for_absence_and_rejects_inspection_errors(self):
        function = re.search(r"^stop_service\(\) \{\n.*?^\}\n", SOURCE, re.S | re.M).group(0)
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            launchctl = root / "launchctl"
            launchctl.write_text("#!/usr/bin/env python3\n" + '''import os, sys
from pathlib import Path
if sys.argv[1] == "bootout":
    sys.exit(0)
state = Path(os.environ["TEST_SERVICE_COUNTER"])
count = int(state.read_text()) if state.exists() else 0
state.write_text(str(count + 1))
mode = os.environ["TEST_SERVICE_STATE"]
if mode == "permission":
    sys.stderr.write("Operation not permitted")
    sys.exit(125)
if mode == "unloading" and count == 0:
    sys.exit(0)
sys.stderr.write("Could not find service test in domain")
sys.exit(113)
''')
            launchctl.chmod(0o755)
            (root / "sleep").write_text("#!/bin/sh\nexit 0\n")
            (root / "sleep").chmod(0o755)
            for mode in ["absent", "unloading", "permission"]:
                with self.subTest(mode=mode):
                    counter = root / (mode + ".counter")
                    env = dict(os.environ, PATH=str(root) + os.pathsep + os.environ["PATH"],
                               TEST_SERVICE_STATE=mode, TEST_SERVICE_COUNTER=str(counter))
                    result = subprocess.run(["bash", "-c", "set -euo pipefail\nDOMAIN=gui/test\n" +
                                             function + "\nstop_service com.example.fixture\n"],
                                            env=env, capture_output=True, text=True)
                    self.assertEqual(result.returncode == 0, mode != "permission")
                    self.assertEqual(int(counter.read_text()), 2 if mode == "unloading" else 1)

    def test_invalid_or_retired_ports_fail_before_installation(self):
        with tempfile.TemporaryDirectory() as temp:
            dest = Path(temp) / "player"
            env = dict(os.environ, OTTPLAY_SRC=str(ROOT), OTTPLAY_DEST=str(dest))
            env.pop("OTTPLAY_PORT", None)
            env.pop("OTTPLAY_HTTPS_PORTS", None)
            for ports in ["", "8095", "8443 8095", "0", "65536", "8443 8443", "8443 08443", "8443 invalid"]:
                with self.subTest(ports=ports):
                    result = subprocess.run(["bash", str(INSTALLER)],
                                            env=dict(env, OTTPLAY_HTTP_PORTS=ports),
                                            capture_output=True, text=True)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn("OTTPLAY_HTTP_PORTS", result.stderr)
                    self.assertFalse(dest.exists())

    def test_retired_environment_cannot_restore_legacy_listeners(self):
        with tempfile.TemporaryDirectory() as temp:
            dest = Path(temp) / "player"
            env = dict(os.environ, OTTPLAY_SRC=str(ROOT), OTTPLAY_DEST=str(dest))
            env.pop("OTTPLAY_PORT", None)
            env.pop("OTTPLAY_HTTPS_PORTS", None)
            for key, value in [("OTTPLAY_PORT", "8095"), ("OTTPLAY_HTTPS_PORTS", "8443 8444")]:
                result = subprocess.run(["bash", str(INSTALLER)], env=dict(env, **{key: value}),
                                        capture_output=True, text=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("retired", result.stderr)
                self.assertFalse(dest.exists())

    def test_four_http_origins_preserve_operator_plist_settings(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            dest = root / 'Player & "data"'
            plist = root / "player.plist"
            old = {
                "Label": "com.ottplay-foss-local",
                "ProgramArguments": [str(dest / "ottplay-server"), "--port", "8095",
                                     "--https-port", "8443", "--cert", "/unused/server.crt",
                                     "--key", "/unused/server.key"],
                "EnvironmentVariables": {"EPG_URLS": "fixture", "OPERATOR_OPTION": "keep"},
                "StandardOutPath": str(root / "custom.log"),
                "StandardErrorPath": str(root / "custom.err"),
                "ThrottleInterval": 7,
            }
            plist.write_bytes(plistlib.dumps(old))
            args = [sys.executable, "-", str(plist), str(dest / "ottplay-server"),
                    str(dest), old["Label"], str(root / "debug & archive"), "8443 8444 8445 8446"]
            for _ in range(2):
                subprocess.run(args, input=embedded_python("PYPLIST"), text=True,
                               capture_output=True, check=True)
                current = plistlib.loads(plist.read_bytes())
                self.assertEqual(current["ProgramArguments"], [str(dest / "ottplay-server"),
                    "--host", "127.0.0.1", "--port", "8443", "--port", "8444",
                    "--port", "8445", "--port", "8446"])
                for key in ["StandardOutPath", "StandardErrorPath", "ThrottleInterval"]:
                    self.assertEqual(current[key], old[key])
                self.assertEqual(current["EnvironmentVariables"]["EPG_URLS"], "fixture")
                self.assertEqual(current["EnvironmentVariables"]["OPERATOR_OPTION"], "keep")
                self.assertEqual(current["WorkingDirectory"], str(dest))
                self.assertTrue(current["RunAtLoad"] and current["KeepAlive"])
                self.assertEqual(plist.stat().st_mode & 0o777, 0o600)

    def test_fresh_configuration_needs_no_certificate(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            plist = root / "fresh.plist"
            subprocess.run([sys.executable, "-", str(plist), str(root / "ottplay-server"),
                            str(root), "com.ottplay-foss-local", str(root / "archive"),
                            "8443 8444 8445 8446"], input=embedded_python("PYPLIST"),
                           text=True, capture_output=True, check=True)
            self.assertEqual(set(root.iterdir()), {plist})
            config = plistlib.loads(plist.read_bytes())
            self.assertNotIn("--cert", config["ProgramArguments"])
            self.assertNotIn("--https-port", config["ProgramArguments"])


if __name__ == "__main__":
    unittest.main()
