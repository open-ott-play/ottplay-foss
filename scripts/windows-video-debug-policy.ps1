param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Install', 'Restore')]
    [string] $Action,
    [ValidatePattern('^ottplay-video-fixture-[0-9a-f]{32}\.exe$')]
    [string] $Name,
    [ValidateRange(1, 65535)]
    [Nullable[int]] $Port,
    [Parameter(Mandatory = $true)]
    [string] $Receipt
)

$ErrorActionPreference = 'Stop'
$PolicyPath = 'Software\Policies\Microsoft\Edge\WebView2\AdditionalBrowserArguments'

function Assert-CIHost {
    if (-not [Runtime.InteropServices.RuntimeInformation]::IsOSPlatform([Runtime.InteropServices.OSPlatform]::Windows) -or
        $env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_ENVIRONMENT -cne 'github-hosted') {
        throw 'Debug policy is restricted to Windows GitHub-hosted CI.'
    }
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    try {
        $principal = [Security.Principal.WindowsPrincipal]::new($identity)
        if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
            throw 'Debug policy requires an administrator token.'
        }
    } finally { $identity.Dispose() }
}

function Read-PolicyValue($Hive, $View, [string] $Path, [string] $ValueName) {
    $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($Hive, $View)
    $key = $null
    try {
        $key = $base.OpenSubKey($Path, $false)
        if ($null -eq $key -or $key.GetValueNames() -notcontains $ValueName) { return $null }
        return [pscustomobject]@{
            kind = $key.GetValueKind($ValueName).ToString()
            value = $key.GetValue($ValueName, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
        }
    } finally {
        if ($null -ne $key) { $key.Dispose() }
        $base.Dispose()
    }
}

function Assert-RemoteDebuggingAllowed {
    foreach ($hive in @('LocalMachine', 'CurrentUser')) {
        foreach ($view in @('Registry64', 'Registry32')) {
            foreach ($path in @('Software\Policies\Microsoft\Edge', 'Software\Policies\Microsoft\Edge\WebView2')) {
                $value = Read-PolicyValue $hive $view $path 'RemoteDebuggingAllowed'
                if ($null -ne $value -and ($value.kind -cne 'DWord' -or $value.value -ne 1)) {
                    throw 'Remote debugging is forbidden or its policy is invalid.'
                }
            }
        }
    }
}

function Assert-OwnedValue($Value, [string] $Expected) {
    if ($null -ne $Value -and ($Value.kind -cne 'String' -or $Value.value -cne $Expected)) {
        throw 'Debug policy ownership mismatch; value was preserved.'
    }
}

function Set-OwnedPolicy([string] $ValueName, [string] $Expected) {
    $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey('LocalMachine', 'Registry64')
    $key = $null
    try {
        $key = $base.CreateSubKey($PolicyPath, $true)
        if ($key.GetValueNames() -contains $ValueName) { throw 'Debug policy value already exists.' }
        $key.SetValue($ValueName, $Expected, [Microsoft.Win32.RegistryValueKind]::String)
        $key.Flush()
    } finally {
        if ($null -ne $key) { $key.Dispose() }
        $base.Dispose()
    }
}

function Remove-OwnedPolicy([string] $ValueName, [string] $Expected) {
    $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey('LocalMachine', 'Registry64')
    $key = $null
    try {
        $key = $base.OpenSubKey($PolicyPath, $true)
        if ($null -eq $key -or $key.GetValueNames() -notcontains $ValueName) { return }
        # Recheck through the same open key immediately before deleting one value.
        $value = [pscustomobject]@{
            kind = $key.GetValueKind($ValueName).ToString()
            value = $key.GetValue($ValueName, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
        }
        Assert-OwnedValue $value $Expected
        $key.DeleteValue($ValueName, $true)
        $key.Flush()
        # Leave the key itself intact: it may contain another app's settings.
    } finally {
        if ($null -ne $key) { $key.Dispose() }
        $base.Dispose()
    }
}

function Write-PolicyReceipt([string] $Path, $State, [bool] $Create) {
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes(($State | ConvertTo-Json -Compress) + "`n")
    $target = if ($Create) { $Path } else { $Path + '.' + [Guid]::NewGuid().ToString('N') + '.tmp' }
    $stream = $null
    try {
        $stream = [IO.FileStream]::new($target, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Flush($true)
        $stream.Dispose()
        $stream = $null
        if (-not $Create) { [IO.File]::Replace($target, $Path, [NullString]::Value) }
    } finally {
        if ($null -ne $stream) { $stream.Dispose() }
        if (-not $Create -and [IO.File]::Exists($target)) { [IO.File]::Delete($target) }
    }
}

function Invoke-DebugPolicy {
    Assert-CIHost
    if (-not [IO.Path]::IsPathFullyQualified($Receipt) -or -not [IO.Directory]::Exists([IO.Path]::GetDirectoryName($Receipt))) {
        throw 'Receipt must be an absolute path in an existing directory.'
    }
    if ($Action -eq 'Restore') {
        if (-not [IO.File]::Exists($Receipt) -or (Get-Item -LiteralPath $Receipt).Length -gt 4096 -or
            (([IO.File]::GetAttributes($Receipt) -band [IO.FileAttributes]::ReparsePoint) -ne 0)) {
            throw 'A bounded regular recovery receipt is required.'
        }
        $state = [IO.File]::ReadAllText($Receipt) | ConvertFrom-Json
        if ($state.name -isnot [string] -or $state.name -cnotmatch '^ottplay-video-fixture-[0-9a-f]{32}\.exe$' -or
            ($state.port -isnot [int] -and $state.port -isnot [long]) -or $state.port -lt 1 -or $state.port -gt 65535) {
            throw 'Invalid fixture identity in recovery receipt.'
        }
        if (($Name -and $Name -cne $state.name) -or ($null -ne $Port -and $Port -ne $state.port)) {
            throw 'Recovery receipt does not match the requested fixture.'
        }
        $Name = $state.name
        $Port = $state.port
    }
    if ($Name -cnotmatch '^ottplay-video-fixture-[0-9a-f]{32}\.exe$' -or
        $null -eq $Port -or $Port -lt 1 -or $Port -gt 65535) {
        throw 'Invalid fixture identity or port.'
    }
    $expected = '--remote-debugging-address=127.0.0.1 --remote-debugging-port=' + $Port
    if ($Action -eq 'Install') {
        Assert-RemoteDebuggingAllowed
        $existing = Read-PolicyValue 'LocalMachine' 'Registry64' $PolicyPath $Name
        if ($null -ne $existing) { throw 'Debug policy value already exists.' }
        $state = [ordered]@{
            schema = 1; name = $Name; port = $Port; registry_path = $PolicyPath
            registry_view = 'Registry64'; kind = 'String'; expected_value = $expected; status = 'planned'
        }
        # A durable, exclusive intent survives a crash after the registry write.
        Write-PolicyReceipt $Receipt $state $true
        Set-OwnedPolicy $Name $expected
        $actual = Read-PolicyValue 'LocalMachine' 'Registry64' $PolicyPath $Name
        Assert-OwnedValue $actual $expected
        if ($null -eq $actual) { throw 'Debug policy install readback failed.' }
        $state.status = 'installed'
    } else {
        if ($state.schema -ne 1 -or $state.name -cne $Name -or $state.port -ne $Port -or
            $state.registry_path -cne $PolicyPath -or $state.registry_view -cne 'Registry64' -or
            $state.kind -cne 'String' -or $state.expected_value -cne $expected -or
            $state.status -cnotin @('planned', 'installed', 'restored')) {
            throw 'Recovery receipt does not match this fixture policy.'
        }
        $actual = Read-PolicyValue 'LocalMachine' 'Registry64' $PolicyPath $Name
        if ($state.status -ceq 'restored' -and $null -ne $actual) {
            throw 'A value appeared after restoration; value was preserved.'
        }
        Assert-OwnedValue $actual $expected
        Remove-OwnedPolicy $Name $expected
        if ($null -ne (Read-PolicyValue 'LocalMachine' 'Registry64' $PolicyPath $Name)) {
            throw 'Debug policy removal readback failed.'
        }
        $state.status = 'restored'
    }
    Write-PolicyReceipt $Receipt $state $false
    [ordered]@{ status = $state.status; name = $Name; port = $Port } | ConvertTo-Json -Compress
}

# Dot-sourcing exposes the same state machine to portable contract tests.
if ($MyInvocation.InvocationName -ne '.') {
    try { Invoke-DebugPolicy } catch {
        [Console]::Error.WriteLine('Windows video debug policy failed: ' + $_.Exception.Message)
        exit 1
    }
}
