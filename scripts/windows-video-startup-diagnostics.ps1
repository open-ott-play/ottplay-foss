param(
    [Parameter(Mandatory = $true)]
    [ValidateRange(1, 2147483647)]
    [int] $RootPid,

    [Parameter(Mandatory = $true)]
    [ValidateRange(1, 65535)]
    [int] $DebugPort
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$deadline = [DateTime]::UtcNow.AddSeconds(18)

function Assert-BeforeDeadline {
    if ([DateTime]::UtcNow -ge $deadline) {
        throw 'diagnostic time budget exceeded'
    }
}

function Get-LoopbackClass([string] $Address) {
    if ([string]::IsNullOrWhiteSpace($Address)) { return 'unknown' }
    if ($Address -eq 'localhost') { return 'loopback' }
    try {
        if ([System.Net.IPAddress]::IsLoopback([System.Net.IPAddress]::Parse($Address))) { return 'loopback' }
    } catch { }
    return 'non-loopback'
}

function Get-SafeDebugFlags([string] $CommandLine) {
    $result = [ordered]@{ address = @(); port = @() }
    if ([string]::IsNullOrWhiteSpace($CommandLine)) { return $result }

    # Only the two debugging switches are ever copied into output. All other
    # command-line content remains in memory and is discarded.
    $tokens = [regex]::Matches($CommandLine, '"([^"]*)"|''([^'']*)''|([^\s]+)')
    $values = New-Object System.Collections.Generic.List[string]
    foreach ($match in $tokens) {
        if ($match.Groups[1].Success) { $values.Add($match.Groups[1].Value) }
        elseif ($match.Groups[2].Success) { $values.Add($match.Groups[2].Value) }
        else { $values.Add($match.Groups[3].Value) }
    }

    for ($i = 0; $i -lt $values.Count; $i++) {
        $token = $values[$i]
        foreach ($name in @('remote-debugging-address', 'remote-debugging-port')) {
            $prefix = "--$name="
            $value = $null
            if ($token.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
                $value = $token.Substring($prefix.Length)
            } elseif ($token.Equals("--$name", [StringComparison]::OrdinalIgnoreCase) -and ($i + 1) -lt $values.Count) {
                $i++
                $value = $values[$i]
            }
            if ($null -eq $value) { continue }

            if ($name -eq 'remote-debugging-address') {
                $classification = Get-LoopbackClass $value
                $safeAddress = if ($classification -eq 'loopback') { $value } else { $null }
                $result.address += [ordered]@{ classification = $classification; value = $safeAddress }
            } else {
                $parsedPort = 0
                $validPort = [int]::TryParse($value, [ref] $parsedPort) -and $parsedPort -ge 1 -and $parsedPort -le 65535
                $result.port += [ordered]@{ valid = [bool] $validPort; value = $(if ($validPort) { $parsedPort } else { $null }) }
            }
        }
    }
    return $result
}

function Get-SafeTitle([string] $Title) {
    if ([string]::IsNullOrWhiteSpace($Title)) { return '' }
    $safe = $Title -replace '(?i)\bhttps?://\S+', '[URL]'
    $safe = $safe -replace '(?i)\b(token|password|passwd|authorization|api[_-]?key)\s*[:=]\s*\S+', '$1=[REDACTED]'
    if ($safe.Length -gt 128) { $safe = $safe.Substring(0, 128) }
    return $safe
}

function Read-PolicyValue([string] $Path) {
    $key = $null
    try { $key = Get-Item -LiteralPath $Path -ErrorAction Stop } catch {
        if ($_.Exception -is [System.Management.Automation.ItemNotFoundException]) { return [ordered]@{ path = $Path; present = $false } }
        return [ordered]@{ path = $Path; present = $null; status = 'unavailable'; error_type = $_.Exception.GetType().Name }
    }
    $present = $key.GetValueNames() -contains 'RemoteDebuggingAllowed'
    if (-not $present) { return [ordered]@{ path = $Path; present = $false } }
    $kind = $key.GetValueKind('RemoteDebuggingAllowed').ToString()
    if ($kind -ne 'DWord') { return [ordered]@{ path = $Path; present = $true; kind = $kind; value = $null } }
    return [ordered]@{ path = $Path; present = $true; kind = 'DWord'; value = [int] $key.GetValue('RemoteDebuggingAllowed', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) }
}

function Get-SafeFileVersion([string] $ExecutablePath) {
    if ([string]::IsNullOrWhiteSpace($ExecutablePath)) { return $null }
    try {
        $info = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($ExecutablePath)
        return [ordered]@{
            file = [IO.Path]::GetFileName($ExecutablePath)
            company_name = $info.CompanyName
            file_description = $info.FileDescription
            file_version = $info.FileVersion
            product_name = $info.ProductName
            product_version = $info.ProductVersion
        }
    } catch { return $null }
}

function Get-TokenDiagnostic([int] $ProcessId) {
    if (-not ('OttTokenDiagnostics' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class OttTokenDiagnostics {
    public sealed class TokenInfo {
        public bool Available { get; set; }
        public string Integrity { get; set; }
        public bool? Elevated { get; set; }
        public int? ErrorCode { get; set; }
    }
    [StructLayout(LayoutKind.Sequential)] private struct SidAndAttributes { public IntPtr Sid; public uint Attributes; }
    [StructLayout(LayoutKind.Sequential)] private struct TokenMandatoryLabel { public SidAndAttributes Label; }
    [DllImport("kernel32.dll", SetLastError=true)] private static extern IntPtr OpenProcess(uint access, bool inheritHandle, int processId);
    [DllImport("kernel32.dll", SetLastError=true)] private static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll", SetLastError=true)] private static extern uint GetCurrentProcessId();
    [DllImport("kernel32.dll", SetLastError=true)] private static extern bool CloseHandle(IntPtr handle);
    [DllImport("advapi32.dll", SetLastError=true)] private static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError=true)] private static extern bool GetTokenInformation(IntPtr token, int informationClass, IntPtr information, int informationLength, out int returnLength);
    [DllImport("advapi32.dll", SetLastError=true)] private static extern IntPtr GetSidSubAuthorityCount(IntPtr sid);
    [DllImport("advapi32.dll", SetLastError=true)] private static extern IntPtr GetSidSubAuthority(IntPtr sid, uint index);
    private static TokenInfo Failed() { return new TokenInfo { Available=false, ErrorCode=Marshal.GetLastWin32Error() }; }
    public static TokenInfo ForProcess(int processId) {
        IntPtr process = IntPtr.Zero;
        bool closeProcess = false;
        IntPtr token = IntPtr.Zero;
        IntPtr buffer = IntPtr.Zero;
        try {
            if (processId == 0 || processId == GetCurrentProcessId()) process = GetCurrentProcess();
            else {
                process = OpenProcess(0x1000, false, processId);
                closeProcess = true;
                if (process == IntPtr.Zero) return Failed();
            }
            if (!OpenProcessToken(process, 0x0008, out token)) return Failed();
            int needed;
            GetTokenInformation(token, 25, IntPtr.Zero, 0, out needed);
            if (needed <= 0 || needed > 65536) return Failed();
            buffer = Marshal.AllocHGlobal(needed);
            if (!GetTokenInformation(token, 25, buffer, needed, out needed)) return Failed();
            var label = (TokenMandatoryLabel)Marshal.PtrToStructure(buffer, typeof(TokenMandatoryLabel));
            IntPtr countPtr = GetSidSubAuthorityCount(label.Label.Sid);
            if (countPtr == IntPtr.Zero) return Failed();
            byte count = Marshal.ReadByte(countPtr);
            if (count == 0) return Failed();
            IntPtr ridPtr = GetSidSubAuthority(label.Label.Sid, (uint)(count - 1));
            if (ridPtr == IntPtr.Zero) return Failed();
            int rid = Marshal.ReadInt32(ridPtr);
            string integrity = rid >= 0x4000 ? "System" : rid >= 0x3000 ? "High" : rid >= 0x2000 ? "Medium" : rid >= 0x1000 ? "Low" : "Untrusted";
            IntPtr elevationBuffer = Marshal.AllocHGlobal(sizeof(int));
            bool elevationAvailable = GetTokenInformation(token, 20, elevationBuffer, sizeof(int), out needed);
            bool? elevated = elevationAvailable ? (bool?)(Marshal.ReadInt32(elevationBuffer) != 0) : null;
            Marshal.FreeHGlobal(elevationBuffer);
            return new TokenInfo { Available=true, Integrity=integrity, Elevated=elevated };
        } catch {
            return Failed();
        } finally {
            if (buffer != IntPtr.Zero) Marshal.FreeHGlobal(buffer);
            if (token != IntPtr.Zero) CloseHandle(token);
            if (closeProcess && process != IntPtr.Zero) CloseHandle(process);
        }
    }
}
'@ -ErrorAction Stop
    }
    return [OttTokenDiagnostics]::ForProcess($ProcessId)
}

function Invoke-WindowEnumeration {
    if (-not ('OttWindowDiagnostics' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class OttWindowDiagnostics {
    public static bool Truncated { get; private set; }
    public sealed class WindowInfo {
        public long Handle { get; set; }
        public int ProcessId { get; set; }
        public bool Visible { get; set; }
        public bool Iconic { get; set; }
        public string Title { get; set; }
        public string ClassName { get; set; }
    }
    private delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int maxCount);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetClassName(IntPtr hwnd, StringBuilder text, int maxCount);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr hwnd);
    public static WindowInfo[] ForProcesses(int[] processIds) {
        var selected = new HashSet<int>(processIds);
        var rows = new List<WindowInfo>();
        Truncated = false;
        EnumWindows((hwnd, unused) => {
            uint pid;
            GetWindowThreadProcessId(hwnd, out pid);
            if (!selected.Contains((int)pid)) return true;
            var title = new StringBuilder(1024);
            var cls = new StringBuilder(256);
            GetWindowText(hwnd, title, title.Capacity);
            GetClassName(hwnd, cls, cls.Capacity);
            rows.Add(new WindowInfo { Handle = hwnd.ToInt64(), ProcessId = (int)pid,
                Visible = IsWindowVisible(hwnd), Iconic = IsIconic(hwnd),
                Title = title.ToString(), ClassName = cls.ToString() });
            if (rows.Count < 512) return true;
            Truncated = true;
            return false;
        }, IntPtr.Zero);
        return rows.ToArray();
    }
}
'@ -ErrorAction Stop
    }
    return [OttWindowDiagnostics]::ForProcesses([int[]] $script:ownedPids)
}

try {
    if ($env:OS -ne 'Windows_NT') { throw 'diagnostics require Windows' }
    Assert-BeforeDeadline

    $snapshot = @(Get-CimInstance -ClassName Win32_Process -Property ProcessId, ParentProcessId, Name, CommandLine, ExecutablePath, CreationDate, SessionId -ErrorAction Stop)
    Assert-BeforeDeadline
    $byPid = @{}
    $childrenByParent = @{}
    foreach ($process in $snapshot) {
        $ownedProcessId = [int] $process.ProcessId
        $byPid[$ownedProcessId] = $process
        $parent = [int] $process.ParentProcessId
        if (-not $childrenByParent.ContainsKey($parent)) { $childrenByParent[$parent] = New-Object System.Collections.Generic.List[int] }
        $childrenByParent[$parent].Add($ownedProcessId)
    }
    if (-not $byPid.ContainsKey($RootPid)) { throw 'owned root process is unavailable' }
    if ([string] $byPid[$RootPid].Name -notmatch '(?i)^ottplay') { throw 'root process name is not an OTTPlay executable' }

    $owned = New-Object System.Collections.Generic.List[object]
    $queue = New-Object System.Collections.Generic.Queue[object]
    $queue.Enqueue([pscustomobject]@{ Pid = $RootPid; Depth = 0 })
    $seen = New-Object 'System.Collections.Generic.HashSet[int]'
    while ($queue.Count -gt 0) {
        Assert-BeforeDeadline
        $entry = $queue.Dequeue()
        if (-not $seen.Add([int] $entry.Pid)) { continue }
        if ($entry.Depth -gt 16) { throw 'owned process tree exceeds depth limit' }
        if ($seen.Count -gt 512) { throw 'owned process tree exceeds process limit' }
        $process = $byPid[[int] $entry.Pid]
        if ($null -eq $process) { continue }
        $owned.Add([pscustomobject]@{ Pid = [int] $entry.Pid; ParentPid = [int] $process.ParentProcessId; Depth = [int] $entry.Depth; Name = [IO.Path]::GetFileNameWithoutExtension([string] $process.Name); Process = $process })
        foreach ($childPid in $childrenByParent[[int] $entry.Pid]) {
            $queue.Enqueue([pscustomobject]@{ Pid = [int] $childPid; Depth = ([int] $entry.Depth + 1) })
        }
    }
    $script:ownedPids = @($owned | ForEach-Object { $_.Pid })
    $ownedIds = [int[]] $script:ownedPids
    $processRows = @()
    $versionRows = @()
    $debugFlagRows = @()
    foreach ($entry in $owned) {
        Assert-BeforeDeadline
        $responding = $null
        $hasExited = $null
        $exitCode = $null
        $fileVersion = Get-SafeFileVersion ([string] $entry.Process.ExecutablePath)
        try {
            $live = Get-Process -Id $entry.Pid -ErrorAction Stop
            if ($null -ne $live.Responding) { $responding = [bool] $live.Responding }
            $hasExited = [bool] $live.HasExited
            if ($live.HasExited) { $exitCode = [int] $live.ExitCode }
        } catch { }
        $created = $null
        if ($null -ne $entry.Process.CreationDate) { $created = ([DateTime] $entry.Process.CreationDate).ToUniversalTime().ToString('o') }
        $processRows += [ordered]@{
            pid = $entry.Pid
            parent_pid = $entry.ParentPid
            depth = $entry.Depth
            name = $entry.Name
            created_utc = $created
            session_id = [int] $entry.Process.SessionId
            responding = $responding
            exited = $hasExited
            exit_code = $exitCode
            token = Get-TokenDiagnostic $entry.Pid
        }
        if ($entry.Pid -eq $RootPid -or $entry.Name -match '(?i)^msedgewebview2') {
            if ($null -ne $fileVersion) { $versionRows += [ordered]@{ pid = $entry.Pid; name = $entry.Name; file_version = $fileVersion.file_version; product_version = $fileVersion.product_version } }
        }
        $flags = Get-SafeDebugFlags ([string] $entry.Process.CommandLine)
        if ($flags.address.Count -or $flags.port.Count) { $debugFlagRows += [ordered]@{ pid = $entry.Pid; address = @($flags.address); port = @($flags.port) } }
    }

    $listeners = @()
    try {
        foreach ($connection in @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object { $ownedIds -contains [int] $_.OwningProcess })) {
            Assert-BeforeDeadline
            $class = Get-LoopbackClass ([string] $connection.LocalAddress)
            $listeners += [ordered]@{
                pid = [int] $connection.OwningProcess
                local_port = [int] $connection.LocalPort
                address_class = $class
                local_address = $(if ($class -eq 'loopback') { [string] $connection.LocalAddress } else { $null })
                is_debug_port = ([int] $connection.LocalPort -eq $DebugPort)
            }
        }
    } catch {
        $listeners = @([ordered]@{ diagnostic_error = 'listener query unavailable'; error_type = $_.Exception.GetType().Name })
    }

    $policyPaths = @(
        'HKLM:\SOFTWARE\Policies\Microsoft\Edge',
        'HKCU:\SOFTWARE\Policies\Microsoft\Edge',
        'HKLM:\SOFTWARE\Policies\Microsoft\Edge\WebView2',
        'HKCU:\SOFTWARE\Policies\Microsoft\Edge\WebView2',
        'HKLM:\SOFTWARE\WOW6432Node\Policies\Microsoft\Edge',
        'HKCU:\SOFTWARE\WOW6432Node\Policies\Microsoft\Edge'
    )
    $policies = @($policyPaths | ForEach-Object { Read-PolicyValue $_ })

    Assert-BeforeDeadline
    $windowRows = @()
    $enumeratedWindows = @(Invoke-WindowEnumeration)
    if ([OttWindowDiagnostics]::Truncated) { throw 'owned window enumeration exceeds limit' }
    foreach ($window in $enumeratedWindows) {
        Assert-BeforeDeadline
        $windowRows += [ordered]@{
            hwnd = ('0x{0:X}' -f $window.Handle)
            pid = [int] $window.ProcessId
            visible = [bool] $window.Visible
            iconic = [bool] $window.Iconic
            class_name = [string] $window.ClassName
            title = Get-SafeTitle ([string] $window.Title)
        }
    }

    $output = [ordered]@{
        schema = 'ottplay.windows-video-startup-diagnostics.v1'
        ok = $true
        root_pid = $RootPid
        debug_port = $DebugPort
        process_tree = @($processRows)
        current_host_token = Get-TokenDiagnostic 0
        remote_debugging_flags = @($debugFlagRows)
        tcp_listeners = @($listeners)
        remote_debugging_policy = @($policies)
        owned_top_level_windows = @($windowRows)
        safe_versions = @($versionRows)
        diagnostic_runtime_versions = [ordered]@{
            powershell = $PSVersionTable.PSVersion.ToString()
            dotnet = [Environment]::Version.ToString()
        }
    }
} catch {
    $output = [ordered]@{ schema = 'ottplay.windows-video-startup-diagnostics.v1'; ok = $false; root_pid = $RootPid; debug_port = $DebugPort; error = $_.Exception.Message }
}

$json = ConvertTo-Json -InputObject $output -Depth 9 -Compress
if ($json.Length -gt 131072) {
    $json = ConvertTo-Json -InputObject ([ordered]@{ schema = 'ottplay.windows-video-startup-diagnostics.v1'; ok = $false; root_pid = $RootPid; debug_port = $DebugPort; error = 'diagnostic output exceeded size limit' }) -Depth 4 -Compress
}
[Console]::Out.WriteLine($json)
