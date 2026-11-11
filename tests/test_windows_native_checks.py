"""Run the real Windows check block against inert exit-code fixtures."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
COMMAND_FILES = (
    "tests/test_windows_installers.py",
    "scripts/check-updater-backport.py",
    "scripts/check-updater-features.py",
)


def native_check_block(workflow=None):
    if workflow is None:
        workflow = (ROOT / ".github/workflows/native-parity.yml").read_text(encoding="utf-8")
    lines = workflow.splitlines()
    heading = "      - name: Check installer harness and native dependency constraints"
    if lines.count(heading) != 1:
        raise AssertionError("Expected exactly one actual Windows native-check step")
    index = lines.index(heading) + 1
    while index < len(lines) and lines[index].startswith(("        if: ", "        shell: ")):
        index += 1
    if index >= len(lines) or lines[index] != "        run: |":
        raise AssertionError("Expected the actual multiline native-check command")
    body = []
    for line in lines[index + 1:]:
        if not line.startswith("          "):
            break
        body.append(line[10:])
    return "\n".join(body) + "\n"


class NativeCheckBlockContracts(unittest.TestCase):
    heading = "      - name: Check installer harness and native dependency constraints"

    def expected(self):
        return "".join("python " + filename + "\nif ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }\n"
                       for filename in COMMAND_FILES)

    def workflow(self, metadata=""):
        return (self.heading + "\n" + metadata + "        run: |\n"
                + "".join("          " + line + "\n" for line in self.expected().splitlines())
                + "      - name: Unrelated next step\n        run: echo unrelated\n")

    def test_actual_workflow_preserves_each_command_and_its_exit_guard(self):
        self.assertEqual(native_check_block(), self.expected())

    def test_legitimate_if_and_shell_metadata_do_not_hide_the_real_block(self):
        for metadata in ("", "        if: ${{ inputs.manual != true }}\n",
                         "        shell: pwsh\n",
                         "        if: ${{ inputs.manual != true }}\n        shell: pwsh\n"):
            with self.subTest(metadata=metadata):
                self.assertEqual(native_check_block(self.workflow(metadata)), self.expected())

    def test_missing_run_cannot_consume_the_next_step_command(self):
        workflow = (self.heading + "\n        if: ${{ inputs.manual != true }}\n"
                    "      - name: Unrelated next step\n        run: |\n          echo success\n")
        with self.assertRaisesRegex(AssertionError, "actual multiline"):
            native_check_block(workflow)

    def test_truncated_or_nonliteral_block_is_rejected(self):
        for ending in ("", "        shell: pwsh\n", "        run: echo success\n"):
            with self.subTest(ending=ending), self.assertRaisesRegex(AssertionError, "actual multiline"):
                native_check_block(self.heading + "\n" + ending)

    def test_duplicate_step_cannot_select_an_unrelated_copy(self):
        with self.assertRaisesRegex(AssertionError, "exactly one"):
            native_check_block(self.workflow() + self.workflow())


@unittest.skipUnless(sys.platform == "win32", "requires the hosted Windows PowerShell runner")
class WindowsNativeChecks(unittest.TestCase):
    def run_block(self, failing_index):
        powershell = shutil.which("pwsh")
        self.assertIsNotNone(powershell, "Windows qualification requires PowerShell, not a skipped subprocess")
        with tempfile.TemporaryDirectory(prefix="windows-native-checks-") as temporary:
            root = Path(temporary)
            for index, filename in enumerate(COMMAND_FILES):
                path = root / filename
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(
                    "from pathlib import Path\n"
                    "import sys\n"
                    "with Path('calls.txt').open('a', encoding='utf-8') as output:\n"
                    f"    output.write('{index}\\n')\n"
                    f"sys.exit({23 if index == failing_index else 0})\n",
                    encoding="utf-8",
                )
            script = root / "actual-check-block.ps1"
            # Do not rely on optional PowerShell native-error promotion. The
            # workflow's own guards must stop a nonzero external command.
            script.write_text("$ErrorActionPreference = 'Stop'\n"
                              "$PSNativeCommandUseErrorActionPreference = $false\n"
                              + native_check_block(), encoding="utf-8")
            result = subprocess.run([powershell, "-NoLogo", "-NoProfile", "-NonInteractive", "-File", str(script)],
                                    cwd=root, capture_output=True, text=True, encoding="utf-8", errors="replace",
                                    timeout=30, check=False)
            calls = (root / "calls.txt").read_text(encoding="utf-8").splitlines()
            return result, calls

    def test_each_native_failure_stops_before_following_success(self):
        for failing_index in range(len(COMMAND_FILES)):
            with self.subTest(failing_command=COMMAND_FILES[failing_index]):
                result, calls = self.run_block(failing_index)
                self.assertEqual(result.returncode, 23, result.stdout + result.stderr)
                self.assertEqual(calls, [str(index) for index in range(failing_index + 1)])

    def test_success_executes_all_three_checks(self):
        result, calls = self.run_block(None)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(calls, ["0", "1", "2"])

    def test_real_updater_inventory_in_inherited_and_controlled_encoding(self):
        for mode, environment in (("inherited", dict(os.environ)),
                                  ("controlled-PYTHONUTF8=0", dict(os.environ, PYTHONUTF8="0"))):
            with self.subTest(mode=mode):
                probe = subprocess.run(
                    [sys.executable, "-c", "import json,locale,os,sys; print(json.dumps({"
                     "'encoding':locale.getencoding(),'preferred':locale.getpreferredencoding(False),"
                     "'utf8_mode':sys.flags.utf8_mode,'PYTHONUTF8':os.environ.get('PYTHONUTF8')}))"],
                    env=environment, capture_output=True, text=True, encoding="utf-8", timeout=15, check=True,
                )
                observed = json.loads(probe.stdout)
                print("Windows updater encoding environment (" + mode + "): "
                      + json.dumps(observed, sort_keys=True), flush=True)
                if mode == "controlled-PYTHONUTF8=0":
                    self.assertEqual(observed["utf8_mode"], 0)
                    self.assertEqual(observed["PYTHONUTF8"], "0")
                result = subprocess.run([sys.executable, str(ROOT / "scripts/check-updater-backport.py")],
                                        cwd=ROOT, env=environment, capture_output=True, text=True,
                                        encoding="utf-8", errors="replace", timeout=30, check=False)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertIn("PASS: updater 2.12.0 published inventory", result.stdout)


if __name__ == "__main__":
    unittest.main()
