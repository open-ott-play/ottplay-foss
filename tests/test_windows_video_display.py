"""Exercise display admission/rollback without changing the developer desktop."""
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / "scripts/windows-video-display.ps1"
PWSH = shutil.which("pwsh")


def ps_quote(value):
    return "'" + str(value).replace("'", "''") + "'"


@unittest.skipUnless(PWSH, "PowerShell 7 is needed for the actual helper")
class DisplayContracts(unittest.TestCase):
    def run_contract(self, body):
        with tempfile.TemporaryDirectory(prefix="ott-display-contract-") as directory:
            receipt = Path(directory) / "display.json"
            script = f"""
. {ps_quote(HELPER)} -Action Apply -Receipt {ps_quote(receipt)}
function Assert-DisplayCIHost {{ }}
function Mode($width, $height) {{
    [pscustomobject]@{{ device='\\\\.\\DISPLAY1'; width=$width; height=$height; bits=32; frequency=60;
      flags=0; orientation=0; fixedOutput=0; x=0; y=0; monitorWidth=$width; monitorHeight=$height;
      workWidth=$width; workHeight=($height-48) }}
}}
$script:current = Mode 1024 768
$script:modes = @((Mode 1024 768), (Mode 1600 900), (Mode 1920 1080))
$script:changes = 0
$script:tests = 0
function Get-DisplayCurrent {{ $script:current }}
function Get-DisplayModes {{ $script:modes }}
function Set-DisplayMode($Mode, [bool] $Test) {{
    if ($Test) {{ $script:tests++; return }}
    $intent = Get-Content -Raw $Receipt | ConvertFrom-Json
    if ($intent.status -notin @('planned','applied')) {{ throw 'intent must precede mutation' }}
    $script:changes++
    $script:current = Mode $Mode.width $Mode.height
}}
function Require($value, $message) {{ if (-not $value) {{ throw $message }} }}
function Expect-Failure([scriptblock] $operation, $message) {{
    $failed=$false; try {{ & $operation | Out-Null }} catch {{ $failed=$true }}
    Require $failed $message
}}
{body}
"""
            result = subprocess.run(
                [PWSH, "-NoProfile", "-NonInteractive", "-Command", script],
                capture_output=True, text=True, timeout=25, check=False,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_supported_preferred_mode_durable_intent_readback_and_restore(self):
        self.run_contract("""
Invoke-VideoDisplay | Out-Null
Require ($script:current.width -eq 1920 -and $script:tests -eq 1 -and $script:changes -eq 1) 'preferred tested mode'
$state = Get-Content -Raw $Receipt | ConvertFrom-Json
Require ($state.status -eq 'applied' -and $state.original.width -eq 1024 -and $state.applied.workHeight -eq 1032) 'real readback retained'
$Action='Restore'; Invoke-VideoDisplay | Out-Null
Require ($script:current.width -eq 1024 -and $script:changes -eq 2) 'original restored'
Invoke-VideoDisplay | Out-Null
Require ($script:changes -eq 2) 'restoration idempotent'
""")

    def test_supported_fallback_and_too_small_or_wrong_refresh_refusal(self):
        self.run_contract("""
$script:modes = @((Mode 1024 768), (Mode 1600 900))
Invoke-VideoDisplay | Out-Null
Require ($script:current.width -eq 1600) 'supported fallback'
$Action='Restore'; Invoke-VideoDisplay | Out-Null
Remove-Item $Receipt
$Action='Apply'; $script:modes = @((Mode 1297 800), (Mode 1920 1080))
$script:modes[1].frequency=75
Expect-Failure { Invoke-VideoDisplay } 'undersized or altered refresh cannot qualify'
Require (-not (Test-Path $Receipt)) 'refusal before intent'
Require ($script:changes -eq 2) 'no speculative apply'
""")

    def test_native_test_rejection_does_not_write_or_apply(self):
        self.run_contract("""
function Set-DisplayMode($Mode, [bool] $Test) { throw 'driver rejected test mode' }
Expect-Failure { Invoke-VideoDisplay } 'native test rejection'
Require (-not (Test-Path $Receipt) -and $script:current.width -eq 1024) 'no mutation'
""")

    def test_display_change_during_admission_is_not_overwritten(self):
        self.run_contract("""
function Set-DisplayMode($Mode, [bool] $Test) {
    if (-not $Test) { throw 'must never apply after foreign change' }
    $script:current=Mode 1600 900
}
Expect-Failure { Invoke-VideoDisplay } 'foreign change during test must fail'
Require (-not (Test-Path $Receipt) -and $script:current.width -eq 1600) 'foreign mode preserved'
""")

    def test_foreign_change_and_post_restore_change_are_preserved(self):
        self.run_contract("""
Invoke-VideoDisplay | Out-Null
$Action='Restore'; $script:current=Mode 1600 900
Expect-Failure { Invoke-VideoDisplay } 'foreign mode must be preserved'
Require ($script:current.width -eq 1600 -and $script:changes -eq 1) 'foreign mode intact'
$script:current=Mode 1920 1080
Invoke-VideoDisplay | Out-Null
$script:current=Mode 1920 1080
Expect-Failure { Invoke-VideoDisplay } 'new owner after restore must be preserved'
Require ($script:changes -eq 2) 'no second rollback'
""")

    def test_failed_work_area_readback_restores_own_mode(self):
        self.run_contract("""
function Set-DisplayMode($Mode, [bool] $Test) {
    if ($Test) { return }
    $script:changes++; $script:current=Mode $Mode.width $Mode.height
    if ($Mode.width -eq 1920) { $script:current.workHeight=700 }
}
Expect-Failure { Invoke-VideoDisplay } 'insufficient work area must fail'
Require ($script:changes -eq 2 -and $script:current.width -eq 1024) 'failure cleanup restored original'
Require ((Get-Content -Raw $Receipt | ConvertFrom-Json).status -eq 'restored') 'cleanup recorded'
""")

    def test_planned_receipt_recovers_crash_before_or_after_apply(self):
        self.run_contract("""
$state=[ordered]@{schema=1;kind='ottplay-video-display';status='planned';original=(Mode 1024 768);applied=(Mode 1920 1080)}
Write-DisplayReceipt $state $true
$Action='Restore'; Invoke-VideoDisplay | Out-Null
Require ($script:changes -eq 0) 'crash before apply already original'
Remove-Item $Receipt; $state.status='planned'; Write-DisplayReceipt $state $true
$script:current=Mode 1920 1080
Invoke-VideoDisplay | Out-Null
Require ($script:changes -eq 1 -and $script:current.width -eq 1024) 'crash after apply recovers'
""")

    def test_receipt_collision_and_invalid_identity_do_not_change_display(self):
        self.run_contract("""
[IO.File]::WriteAllText($Receipt, 'foreign')
Expect-Failure { Invoke-VideoDisplay } 'exclusive receipt required'
Require ($script:changes -eq 0 -and [IO.File]::ReadAllText($Receipt) -eq 'foreign') 'collision preserved'
Remove-Item $Receipt; Invoke-VideoDisplay | Out-Null
$saved=Get-Content -Raw $Receipt
$Action='Restore'
foreach ($field in @('device', 'frequency')) {
    $state=$saved | ConvertFrom-Json
    if ($field -eq 'device') { $state.applied.device='*' } else { $state.original.frequency=75 }
    [IO.File]::WriteAllText($Receipt, ($state | ConvertTo-Json))
    Expect-Failure { Invoke-VideoDisplay } 'invalid target or non-dimension changes rejected'
}
Require ($script:changes -eq 1) 'invalid receipt never changes display'
""")

    def test_actual_cli_refuses_non_hosted_execution(self):
        with tempfile.TemporaryDirectory(prefix="ott-display-refusal-") as directory:
            receipt = Path(directory) / "receipt.json"
            result = subprocess.run(
                [PWSH, "-NoProfile", "-NonInteractive", "-File", str(HELPER),
                 "-Action", "Apply", "-Receipt", str(receipt)],
                env=dict(os.environ, GITHUB_ACTIONS="false", RUNNER_ENVIRONMENT="local"),
                capture_output=True, text=True, timeout=25, check=False,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(receipt.exists())

    def test_actual_binding_compiles_and_devmode_layout_is_exact(self):
        self.run_contract("""
Initialize-DisplayAPI
Require ([Runtime.InteropServices.Marshal]::SizeOf([type][OttVideoDisplay+DevMode]) -eq 220) 'DEVMODEW size'
Require ([Runtime.InteropServices.Marshal]::OffsetOf([type][OttVideoDisplay+DevMode], 'width').ToInt32() -eq 172) 'DEVMODEW width offset'
Require ([Runtime.InteropServices.Marshal]::SizeOf([type][OttVideoDisplay+DisplayDevice]) -eq 840) 'DISPLAY_DEVICEW size'
Require ([Runtime.InteropServices.Marshal]::SizeOf([type][OttVideoDisplay+MonitorInfo]) -eq 40) 'MONITORINFO size'
""")


@unittest.skipUnless(
    PWSH and os.name == "nt" and os.environ.get("GITHUB_ACTIONS") == "true"
    and os.environ.get("RUNNER_ENVIRONMENT") == "github-hosted",
    "Actual display changes run only on the hosted Windows worker before app launch",
)
class NativeDisplayRoundtrip(unittest.TestCase):
    def test_actual_supported_mode_apply_and_restore(self):
        with tempfile.TemporaryDirectory(prefix="ott-display-native-") as directory:
            receipt = Path(directory) / "display.json"
            command = [PWSH, "-NoProfile", "-NonInteractive", "-File", str(HELPER)]
            try:
                result = subprocess.run(
                    command + ["-Action", "Apply", "-Receipt", str(receipt)],
                    capture_output=True, text=True, timeout=30, check=False,
                )
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                state = json.loads(receipt.read_text(encoding="utf-8"))
                self.assertEqual(state["status"], "applied")
                self.assertGreaterEqual(state["applied"]["workHeight"], 752)
                self.assertGreaterEqual(state["applied"]["monitorWidth"], 1366)
            finally:
                if receipt.exists():
                    result = subprocess.run(
                        command + ["-Action", "Restore", "-Receipt", str(receipt)],
                        capture_output=True, text=True, timeout=30, check=False,
                    )
                    self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                    self.assertEqual(json.loads(receipt.read_text(encoding="utf-8"))["status"], "restored")


if __name__ == "__main__":
    unittest.main()
