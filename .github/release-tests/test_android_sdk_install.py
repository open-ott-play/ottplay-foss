"""Exercise SDK setup without letting stdin or skipped packages hide failures."""

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


INSTALLER = Path(__file__).resolve().parents[2] / "scripts/ci-android-install-sdk.sh"


class AndroidSdkInstallTests(unittest.TestCase):
    def run_installer(self, status=0, skip_packages=False):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            sdk = root / "sdk with spaces"
            sdk.mkdir()
            tools = root / "tools"
            tools.mkdir()
            manager = tools / "sdkmanager"
            manager.write_text(
                f"#!{sys.executable}\n"
                "import os, sys\n"
                "from pathlib import Path\n"
                "sdk = Path(os.environ['ANDROID_HOME'])\n"
                "assert sys.argv[1:] == ['--sdk_root=' + str(sdk), "
                "'platforms;android-36', 'build-tools;34.0.0', 'platform-tools']\n"
                "assert sys.stdin.read() == ''\n"
                "status = int(os.environ['SDK_TEST_STATUS'])\n"
                "if status: sys.exit(status)\n"
                "if os.environ['SDK_TEST_SKIP'] == '1': sys.exit(0)\n"
                "for name in ['platforms/android-36/android.jar', "
                "'build-tools/34.0.0/aapt2', 'platform-tools/adb']:\n"
                "    path = sdk / name\n"
                "    path.parent.mkdir(parents=True, exist_ok=True)\n"
                "    path.write_bytes(b'installed')\n"
                "    path.chmod(0o755)\n"
            )
            manager.chmod(0o755)
            env = {
                **os.environ,
                "PATH": str(tools) + os.pathsep + os.environ["PATH"],
                "ANDROID_HOME": str(sdk),
                "SDK_TEST_STATUS": str(status),
                "SDK_TEST_SKIP": "1" if skip_packages else "0",
            }
            return subprocess.run(
                ["bash", str(INSTALLER)],
                env=env,
                capture_output=True,
                text=True,
                check=False,
                # Python ignores SIGPIPE; preserve that runner condition in Bash.
                restore_signals=False,
            )

    def test_installs_with_closed_stdin_and_inherited_sigpipe_ignored(self):
        result = self.run_installer()
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_propagates_sdkmanager_failure(self):
        result = self.run_installer(status=42)
        self.assertEqual(result.returncode, 42, result.stderr)

    def test_rejects_success_without_installed_components(self):
        result = self.run_installer(skip_packages=True)
        self.assertNotEqual(result.returncode, 0)


if __name__ == "__main__":
    unittest.main()
