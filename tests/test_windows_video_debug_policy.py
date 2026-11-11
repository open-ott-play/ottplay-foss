"""Exercise the actual PowerShell policy state machine without changing host policy."""
import ctypes
import json
import os
import shutil
import subprocess
import tempfile
import unittest
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / "scripts/windows-video-debug-policy.ps1"
PWSH = shutil.which("pwsh")
POLICY = r"Software\Policies\Microsoft\Edge\WebView2\AdditionalBrowserArguments"


def ps_quote(value):
    return "'" + str(value).replace("'", "''") + "'"


@unittest.skipUnless(PWSH, "PowerShell is required to exercise the real helper")
class PortablePolicyContracts(unittest.TestCase):
    def run_contract(self, body):
        with tempfile.TemporaryDirectory(prefix="ott-policy-contract-") as directory:
            receipt = Path(directory) / "receipt.json"
            script = f"""
. {ps_quote(HELPER)} -Action Install -Name ottplay-video-fixture-{'a' * 32}.exe -Port 9222 -Receipt {ps_quote(receipt)}
$script:stored = $null
$script:writes = 0
$script:removes = 0
$script:denied = $false
function Assert-CIHost {{ }}
function Read-PolicyValue($Hive, $View, $Path, $ValueName) {{
    if ($ValueName -eq 'RemoteDebuggingAllowed') {{
        if ($script:denied) {{ return [pscustomobject]@{{ kind = 'DWord'; value = 0 }} }}
        return $null
    }}
    return $script:stored
}}
function Set-OwnedPolicy($ValueName, $Expected) {{
    $intent = [IO.File]::ReadAllText($Receipt) | ConvertFrom-Json
    if ($intent.status -ne 'planned' -or $intent.expected_value -cne $Expected) {{ throw 'intent must precede write' }}
    $script:writes++
    $script:stored = [pscustomobject]@{{ kind = 'String'; value = $Expected }}
}}
function Remove-OwnedPolicy($ValueName, $Expected) {{
    $script:removes++
    $script:stored = $null
}}
function Require($condition, $message) {{ if (-not $condition) {{ throw $message }} }}
function Expect-Failure([scriptblock] $operation, $message) {{
    $failed = $false
    try {{ & $operation | Out-Null }} catch {{ $failed = $true }}
    Require $failed $message
}}
{body}
"""
            result = subprocess.run([PWSH, "-NoProfile", "-NonInteractive", "-Command", script],
                                    capture_output=True, text=True, timeout=25, check=False)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_install_has_durable_intent_then_roundtrip_and_idempotent_restore(self):
        self.run_contract("""
Invoke-DebugPolicy | Out-Null
Require ($script:writes -eq 1) 'expected one install'
Require ((Get-Content -Raw $Receipt | ConvertFrom-Json).status -eq 'installed') 'installed readback'
$Action = 'Restore'
Invoke-DebugPolicy | Out-Null
Require ($null -eq $script:stored) 'own value removed'
Require ((Get-Content -Raw $Receipt | ConvertFrom-Json).status -eq 'restored') 'receipt retained'
Invoke-DebugPolicy | Out-Null
""")

    def test_preexisting_value_and_receipt_are_never_overwritten(self):
        self.run_contract("""
$script:stored = [pscustomobject]@{ kind = 'String'; value = 'foreign' }
Expect-Failure { Invoke-DebugPolicy } 'preexisting policy must fail'
Require ($script:stored.value -eq 'foreign' -and $script:writes -eq 0) 'foreign policy preserved'
Require (-not (Test-Path $Receipt)) 'no intent for refused install'
$script:stored = $null
[IO.File]::WriteAllText($Receipt, 'foreign receipt')
Expect-Failure { Invoke-DebugPolicy } 'exclusive receipt required'
Require ([IO.File]::ReadAllText($Receipt) -eq 'foreign receipt' -and $script:writes -eq 0) 'receipt preserved'
""")

    def test_disabled_remote_debugging_refuses_without_receipt_or_write(self):
        self.run_contract("""
$script:denied = $true
Expect-Failure { Invoke-DebugPolicy } 'disabled policy must fail'
Require ($script:writes -eq 0 -and -not (Test-Path $Receipt)) 'refusal cannot mutate'
""")

    def test_restore_preserves_changed_value_and_changed_registry_type(self):
        self.run_contract("""
Invoke-DebugPolicy | Out-Null
$expected = $script:stored.value
$Action = 'Restore'
$script:stored.value = 'foreign'
Expect-Failure { Invoke-DebugPolicy } 'changed value must fail'
Require ($script:removes -eq 0 -and $script:stored.value -eq 'foreign') 'foreign value preserved'
$script:stored = [pscustomobject]@{ kind = 'ExpandString'; value = $expected }
Expect-Failure { Invoke-DebugPolicy } 'changed type must fail'
Require ($script:removes -eq 0 -and $script:stored.kind -eq 'ExpandString') 'foreign type preserved'
$script:stored.kind = 'String'
Invoke-DebugPolicy | Out-Null
""")

    def test_crash_after_write_recovers_from_planned_receipt(self):
        self.run_contract("""
function Set-OwnedPolicy($ValueName, $Expected) {
    $script:stored = [pscustomobject]@{ kind = 'String'; value = $Expected }
    throw 'simulated crash after write'
}
Expect-Failure { Invoke-DebugPolicy } 'simulated crash must fail install'
Require ((Get-Content -Raw $Receipt | ConvertFrom-Json).status -eq 'planned') 'recoverable intent retained'
$Action = 'Restore'
Invoke-DebugPolicy | Out-Null
Require ($null -eq $script:stored) 'crash cleanup removed own value'
""")

    def test_crash_before_write_and_missing_readback_remain_recoverable(self):
        self.run_contract("""
function Set-OwnedPolicy($ValueName, $Expected) { }
Expect-Failure { Invoke-DebugPolicy } 'missing write must fail readback'
Require ((Get-Content -Raw $Receipt | ConvertFrom-Json).status -eq 'planned') 'intent survives failed write'
$Action = 'Restore'
Invoke-DebugPolicy | Out-Null
Require ((Get-Content -Raw $Receipt | ConvertFrom-Json).status -eq 'restored') 'absent write can recover'
""")

    def test_receipt_binding_and_value_after_restoration_fail_closed(self):
        self.run_contract("""
Invoke-DebugPolicy | Out-Null
$Action = 'Restore'
$Port = 9223
Expect-Failure { Invoke-DebugPolicy } 'wrong port must fail'
Require ($script:removes -eq 0) 'receipt binding precedes remove'
$Port = 9222
Invoke-DebugPolicy | Out-Null
$script:stored = [pscustomobject]@{ kind = 'String'; value = 'foreign' }
Expect-Failure { Invoke-DebugPolicy } 'post-restore insertion must fail'
Require ($script:stored.value -eq 'foreign') 'new insertion preserved'
""")

    def test_receipt_only_restore_validates_target_and_flags_before_cleanup(self):
        self.run_contract("""
Invoke-DebugPolicy | Out-Null
$saved = [IO.File]::ReadAllText($Receipt)
$Action = 'Restore'
# Simulate a fresh invocation with both optional parameters omitted.
Remove-Variable Name, Port
$Name = ''
$Port = $null
foreach ($field in @('name', 'port', 'registry_path', 'expected_value')) {
    $tampered = $saved | ConvertFrom-Json
    if ($field -eq 'port') { $tampered.port = 65536 }
    else { $tampered.$field = '*' }
    [IO.File]::WriteAllText($Receipt, ($tampered | ConvertTo-Json))
    Expect-Failure { Invoke-DebugPolicy } 'untrusted receipt must not select target or arguments'
    Require ($script:removes -eq 0) 'invalid receipt cannot remove a value'
}
[IO.File]::WriteAllText($Receipt, $saved)
Invoke-DebugPolicy | Out-Null
Require ($null -eq $script:stored) 'receipt-only recovery removed own value'
Require ((Get-Content -Raw $Receipt | ConvertFrom-Json).status -eq 'restored') 'recovery receipt retained'
""")

    def test_parameter_binding_rejects_production_and_wildcard_names(self):
        self.run_contract(f"""
foreach ($unsafe in @('*', 'ottplay-tauri.exe')) {{
    Expect-Failure {{ & {ps_quote(HELPER)} -Action Install -Name $unsafe -Port 9222 -Receipt $Receipt }} 'unsafe app name'
}}
Require ($script:writes -eq 0 -and -not (Test-Path $Receipt)) 'invalid name cannot mutate'
""")

    def test_actual_cli_rejects_non_hosted_execution(self):
        with tempfile.TemporaryDirectory(prefix="ott-policy-refusal-") as directory:
            receipt = Path(directory) / "receipt.json"
            env = dict(os.environ, GITHUB_ACTIONS="false", RUNNER_ENVIRONMENT="local")
            name = "ottplay-video-fixture-" + "a" * 32 + ".exe"
            result = subprocess.run([PWSH, "-NoProfile", "-NonInteractive", "-File", str(HELPER),
                                     "-Action", "Install", "-Name", name, "-Port", "9222",
                                     "-Receipt", str(receipt)], env=env, capture_output=True, timeout=25, check=False)
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(receipt.exists())


@unittest.skipUnless(os.name == "nt" and PWSH and os.environ.get("GITHUB_ACTIONS") == "true"
                     and os.environ.get("RUNNER_ENVIRONMENT") == "github-hosted",
                     "Real registry roundtrip is restricted to hosted Windows CI")
class HostedWindowsPolicyRoundtrip(unittest.TestCase):
    def test_real_install_cas_and_restore_preserve_another_app(self):
        import winreg

        self.assertTrue(ctypes.windll.shell32.IsUserAnAdmin(), "Hosted CI must supply an admin token")
        name = "ottplay-video-fixture-" + uuid.uuid4().hex + ".exe"
        foreign = "ottplay-video-fixture-" + uuid.uuid4().hex + ".exe"
        expected = "--remote-debugging-address=127.0.0.1 --remote-debugging-port=19222"
        with tempfile.TemporaryDirectory(prefix="ott-policy-win32-") as directory:
            receipt = Path(directory) / "receipt.json"

            def invoke(action):
                args = [PWSH, "-NoProfile", "-NonInteractive", "-File", str(HELPER),
                        "-Action", action, "-Receipt", str(receipt)]
                if action == "Install":
                    args += ["-Name", name, "-Port", "19222"]
                return subprocess.run(args, capture_output=True, text=True, timeout=25, check=False)

            access = winreg.KEY_READ | winreg.KEY_WRITE | winreg.KEY_WOW64_64KEY
            with winreg.CreateKeyEx(winreg.HKEY_LOCAL_MACHINE, POLICY, 0, access) as key:
                for value_name in (name, foreign):
                    with self.assertRaises(FileNotFoundError):
                        winreg.QueryValueEx(key, value_name)
                winreg.SetValueEx(key, foreign, 0, winreg.REG_SZ, "retained sentinel")
                try:
                    install = invoke("Install")
                    self.assertEqual(install.returncode, 0, install.stderr)
                    self.assertEqual(winreg.QueryValueEx(key, name), (expected, winreg.REG_SZ))
                    for changed, kind in (("changed", winreg.REG_SZ), (expected, winreg.REG_EXPAND_SZ)):
                        winreg.SetValueEx(key, name, 0, kind, changed)
                        self.assertNotEqual(invoke("Restore").returncode, 0)
                        self.assertEqual(winreg.QueryValueEx(key, name), (changed, kind))
                    winreg.SetValueEx(key, name, 0, winreg.REG_SZ, expected)
                    restored = invoke("Restore")
                    self.assertEqual(restored.returncode, 0, restored.stderr)
                    with self.assertRaises(FileNotFoundError):
                        winreg.QueryValueEx(key, name)
                    self.assertEqual(winreg.QueryValueEx(key, foreign), ("retained sentinel", winreg.REG_SZ))
                    self.assertEqual(json.loads(receipt.read_text())["status"], "restored")
                finally:
                    # Only the test's two unguessable names are eligible for cleanup.
                    for value_name in (name, foreign):
                        try:
                            value, kind = winreg.QueryValueEx(key, value_name)
                            if (value_name == foreign and (value, kind) == ("retained sentinel", winreg.REG_SZ)) or (
                                value_name == name and (value, kind) in ((expected, winreg.REG_SZ),
                                                                      ("changed", winreg.REG_SZ),
                                                                      (expected, winreg.REG_EXPAND_SZ))
                            ):
                                winreg.DeleteValue(key, value_name)
                        except FileNotFoundError:
                            pass


if __name__ == "__main__":
    unittest.main()
