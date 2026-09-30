import json
import os
from pathlib import Path
import plistlib
import stat
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/configure-nas-library.py"


class NasConfigurationTests(unittest.TestCase):
    def test_private_idempotent_configuration_preserves_listeners(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            plist = root / "player.plist"
            original = {
                "Label": "example.player",
                "ProgramArguments": ["/example/player", "--port", "8443", "--https-port", "8447"],
                "EnvironmentVariables": {"SWOP_INSTALLATION_TOKEN": "existing-installation-token"},
                "KeepAlive": True,
            }
            plist.write_bytes(plistlib.dumps(original))
            token = root / "token"
            token.write_text("private-fixture-plex-token")
            links = root / "connections.json"
            command = [sys.executable, str(SCRIPT), "--plex-url", "http://192.168.1.25:32400",
                       "--token-file", str(token), "--player-url", "https://player.example:8447",
                       "--plist", str(plist), "--connections", str(links)]
            first = subprocess.run(command, capture_output=True, text=True, check=True)
            config = plistlib.loads(plist.read_bytes())
            key = config["EnvironmentVariables"]["OTTPLAY_NAS_KEY"]
            self.assertGreaterEqual(len(key), 32)
            self.assertEqual(config["ProgramArguments"], original["ProgramArguments"])
            self.assertEqual(config["EnvironmentVariables"]["SWOP_INSTALLATION_TOKEN"], "existing-installation-token")
            self.assertNotIn(key, first.stdout + first.stderr)
            self.assertNotIn(token.read_text(), first.stdout + first.stderr)
            for path in (plist, links, root / ".ottplay-backups/player.plist.before-nas"):
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            connection = json.loads(links.read_text())
            self.assertEqual(connection["vportal"], "portal::[key:" + key + "]https://player.example:8447/nas/api")
            subprocess.run(command, capture_output=True, check=True)
            self.assertEqual(plistlib.loads(plist.read_bytes())["EnvironmentVariables"]["OTTPLAY_NAS_KEY"], key)
            self.assertEqual(plistlib.loads((root / ".ottplay-backups/player.plist.before-nas").read_bytes()), original)
            broken = command.copy()
            broken[broken.index("--plex-url") + 1] = "http://user:password@server/"
            self.assertNotEqual(subprocess.run(broken, capture_output=True).returncode, 0)
            self.assertEqual(plistlib.loads(plist.read_bytes()), config)
            # Restart must reload the new environment, rather than kickstarting
            # launchd's cached service definition.
            launcher = root / "launchctl"
            record = root / "launch-calls.jsonl"
            launcher.write_text("#!" + sys.executable + "\nimport json,sys\n"
                                + "with open(" + repr(str(record)) + ", 'a') as out: out.write(json.dumps(sys.argv[1:])+'\\n')\n")
            launcher.chmod(0o755)
            subprocess.run(command + ["--restart"], capture_output=True, check=True,
                           env=dict(os.environ, PATH=str(root) + os.pathsep + os.environ["PATH"]))
            calls = [json.loads(line) for line in record.read_text().splitlines()]
            self.assertEqual([call[0] for call in calls], ["bootout", "bootstrap"])
            self.assertEqual(calls[1][-1], str(plist))


if __name__ == "__main__":
    unittest.main()
