param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Apply', 'Restore')]
    [string] $Action,
    [Parameter(Mandatory = $true)]
    [string] $Receipt
)

$ErrorActionPreference = 'Stop'

function Assert-DisplayCIHost {
    if (-not [Runtime.InteropServices.RuntimeInformation]::IsOSPlatform([Runtime.InteropServices.OSPlatform]::Windows) -or
        $env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_ENVIRONMENT -cne 'github-hosted' -or
        [Diagnostics.Process]::GetCurrentProcess().SessionId -le 0) {
        throw 'Display changes require an interactive Windows GitHub-hosted CI session.'
    }
}

function Initialize-DisplayAPI {
    if ('OttVideoDisplay' -as [type]) { return }
    # EnumDisplaySettingsEx returns driver-supported modes. Only CDS_TEST (2)
    # and dynamic apply (0) are used: no registry persistence or unsafe modes.
    Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class OttVideoDisplay {
    [StructLayout(LayoutKind.Explicit, CharSet=CharSet.Unicode, Size=220)]
    public struct DevMode {
        [FieldOffset(68)] public ushort size;
        [FieldOffset(70)] public ushort extra;
        [FieldOffset(72)] public uint fields;
        [FieldOffset(76)] public int x;
        [FieldOffset(80)] public int y;
        [FieldOffset(84)] public uint orientation;
        [FieldOffset(88)] public uint fixedOutput;
        [FieldOffset(168)] public uint bits;
        [FieldOffset(172)] public uint width;
        [FieldOffset(176)] public uint height;
        [FieldOffset(180)] public uint flags;
        [FieldOffset(184)] public uint frequency;
    }
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    public struct DisplayDevice {
        public uint size;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string name;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string description;
        public uint flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string id;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string key;
    }
    [StructLayout(LayoutKind.Sequential)]
    public struct Rect { public int left, top, right, bottom; }
    [StructLayout(LayoutKind.Sequential)]
    public struct MonitorInfo { public uint size; public Rect monitor, work; public uint flags; }
    [StructLayout(LayoutKind.Sequential)]
    public struct Point { public int x, y; }
    public class Mode {
        public string device;
        public uint width, height, bits, frequency, flags, orientation, fixedOutput;
        public int x, y, workWidth, workHeight, monitorWidth, monitorHeight;
    }
    [DllImport("user32.dll", CharSet=CharSet.Unicode, ExactSpelling=true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool EnumDisplayDevicesW(string name, uint index, ref DisplayDevice device, uint flags);
    [DllImport("user32.dll", CharSet=CharSet.Unicode, ExactSpelling=true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool EnumDisplaySettingsExW(string name, int index, ref DevMode mode, uint flags);
    [DllImport("user32.dll", CharSet=CharSet.Unicode, ExactSpelling=true)]
    static extern int ChangeDisplaySettingsExW(string name, ref DevMode mode, IntPtr window, uint flags, IntPtr parameter);
    [DllImport("user32.dll", ExactSpelling=true)]
    static extern IntPtr MonitorFromPoint(Point point, uint flags);
    [DllImport("user32.dll", CharSet=CharSet.Unicode, ExactSpelling=true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    static extern bool GetMonitorInfoW(IntPtr monitor, ref MonitorInfo info);
    static string Primary() {
        for (uint i=0; i<64; i++) {
            var device=new DisplayDevice { size=(uint)Marshal.SizeOf<DisplayDevice>() };
            if (!EnumDisplayDevicesW(null, i, ref device, 0)) break;
            if ((device.flags & 5)==5) return device.name;
        }
        throw new InvalidOperationException("No attached primary display.");
    }
    static DevMode ReadMode(string device, int index) {
        var mode=new DevMode { size=220 };
        if (!EnumDisplaySettingsExW(device, index, ref mode, 0))
            throw new InvalidOperationException("Display mode unavailable.");
        return mode;
    }
    static Mode Describe(string device, DevMode mode) {
        return new Mode { device=device, width=mode.width, height=mode.height,
            bits=mode.bits, frequency=mode.frequency, flags=mode.flags,
            orientation=mode.orientation, fixedOutput=mode.fixedOutput, x=mode.x, y=mode.y };
    }
    public static Mode Current() {
        string device=Primary();
        var result=Describe(device, ReadMode(device, -1));
        var info=new MonitorInfo { size=(uint)Marshal.SizeOf<MonitorInfo>() };
        if (!GetMonitorInfoW(MonitorFromPoint(new Point(), 1), ref info) ||
            info.monitor.left!=0 || info.monitor.top!=0)
            throw new InvalidOperationException("Primary monitor geometry unavailable.");
        result.monitorWidth=info.monitor.right; result.monitorHeight=info.monitor.bottom;
        result.workWidth=info.work.right-info.work.left; result.workHeight=info.work.bottom-info.work.top;
        return result;
    }
    public static Mode[] Supported() {
        string device=Primary(); var result=new List<Mode>();
        for (int i=0; i<4096; i++) {
            var mode=new DevMode { size=220 };
            if (!EnumDisplaySettingsExW(device, i, ref mode, 0)) return result.ToArray();
            result.Add(Describe(device, mode));
        }
        throw new InvalidOperationException("Display mode enumeration exceeded its bound.");
    }
    public static int Change(uint width, uint height, bool test) {
        // Use the current enumerated DEVMODE and change only width/height.
        // The caller has already matched depth/refresh/orientation to a supported mode.
        string device=Primary(); var mode=ReadMode(device, -1);
        mode.width=width; mode.height=height; mode.fields=0x00180000;
        return ChangeDisplaySettingsExW(device, ref mode, IntPtr.Zero, test ? 2u : 0u, IntPtr.Zero);
    }
}
'@
}

function Get-DisplayCurrent { Initialize-DisplayAPI; [OttVideoDisplay]::Current() }
function Get-DisplayModes { Initialize-DisplayAPI; [OttVideoDisplay]::Supported() }
function Set-DisplayMode($Mode, [bool] $Test) {
    Initialize-DisplayAPI
    $result = [OttVideoDisplay]::Change($Mode.width, $Mode.height, $Test)
    if ($result -ne 0) { throw "Display mode was rejected (code $result)." }
}
function Test-SameDisplayMode($First, $Second) {
    foreach ($key in @('device', 'width', 'height', 'bits', 'frequency', 'flags', 'orientation', 'fixedOutput', 'x', 'y')) {
        if ($First.$key -cne $Second.$key) { return $false }
    }
    return $true
}
function Assert-DisplayMode($Mode) {
    if ($null -eq $Mode -or $Mode.device -cnotmatch '^\\\\\.\\DISPLAY[0-9]{1,3}$') { throw 'Invalid display identity.' }
    foreach ($key in @('width', 'height', 'bits', 'frequency', 'flags', 'orientation', 'fixedOutput', 'x', 'y')) {
        if ($Mode.$key -isnot [ValueType] -or $Mode.$key -is [bool] -or
            [double]$Mode.$key -ne [Math]::Floor([double]$Mode.$key) -or $Mode.$key -lt 0 -or $Mode.$key -gt 65535) {
            throw 'Invalid numeric display mode.'
        }
    }
    if ($Mode.width -lt 1 -or $Mode.height -lt 1 -or $Mode.bits -ne 32 -or
        $Mode.x -ne 0 -or $Mode.y -ne 0 -or $Mode.orientation -ne 0) {
        throw 'Only a 32-bit unrotated primary display at the origin is supported.'
    }
}
function Write-DisplayReceipt($State, [bool] $Create) {
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes(($State | ConvertTo-Json -Depth 5 -Compress) + "`n")
    $target = if ($Create) { $Receipt } else { $Receipt + '.' + [Guid]::NewGuid().ToString('N') + '.tmp' }
    $stream = $null
    try {
        $stream = [IO.FileStream]::new($target, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        $stream.Write($bytes, 0, $bytes.Length); $stream.Flush($true); $stream.Dispose(); $stream = $null
        if (-not $Create) { [IO.File]::Replace($target, $Receipt, [NullString]::Value) }
    } finally {
        if ($null -ne $stream) { $stream.Dispose() }
        if (-not $Create -and [IO.File]::Exists($target)) { [IO.File]::Delete($target) }
    }
}
function Restore-DisplayState($State) {
    $current = Get-DisplayCurrent
    if (Test-SameDisplayMode $current $State.original) { $State.status = 'restored'; Write-DisplayReceipt $State $false; return }
    if ($State.status -ceq 'restored' -or -not (Test-SameDisplayMode $current $State.applied)) {
        throw 'Display ownership changed; current mode was preserved.'
    }
    if (-not @(Get-DisplayModes | Where-Object { Test-SameDisplayMode $_ $State.original }).Count) {
        throw 'Original display mode is no longer supported.'
    }
    Set-DisplayMode $State.original $true
    if (-not (Test-SameDisplayMode (Get-DisplayCurrent) $current)) { throw 'Display changed before restoration.' }
    Set-DisplayMode $State.original $false
    if (-not (Test-SameDisplayMode (Get-DisplayCurrent) $State.original)) { throw 'Display restoration readback failed.' }
    $State.status = 'restored'; Write-DisplayReceipt $State $false
}
function Invoke-VideoDisplay {
    Assert-DisplayCIHost
    if (-not [IO.Path]::IsPathFullyQualified($Receipt) -or -not [IO.Directory]::Exists([IO.Path]::GetDirectoryName($Receipt))) {
        throw 'Receipt must be an absolute path in an existing directory.'
    }
    if ($Action -eq 'Restore') {
        $file = Get-Item -LiteralPath $Receipt
        if ($file.PSIsContainer -or $file.Length -gt 8192 -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Invalid recovery receipt.' }
        $state = [IO.File]::ReadAllText($Receipt) | ConvertFrom-Json
        if ($state.schema -ne 1 -or $state.kind -cne 'ottplay-video-display' -or $state.status -cnotin @('planned', 'applied', 'restored')) { throw 'Invalid display receipt.' }
        Assert-DisplayMode $state.original; Assert-DisplayMode $state.applied
        foreach ($key in @('device', 'bits', 'frequency', 'flags', 'orientation', 'fixedOutput', 'x', 'y')) {
            if ($state.original.$key -cne $state.applied.$key) { throw 'Display receipt changed more than width/height.' }
        }
        Restore-DisplayState $state
    } else {
        $original = Get-DisplayCurrent
        Assert-DisplayMode $original
        $modes = @(Get-DisplayModes | Where-Object {
            $_.device -ceq $original.device -and $_.width -ge 1366 -and $_.height -ge 800 -and
            $_.bits -eq $original.bits -and $_.frequency -eq $original.frequency -and $_.flags -eq $original.flags -and
            $_.orientation -eq $original.orientation -and $_.fixedOutput -eq $original.fixedOutput -and $_.x -eq 0 -and $_.y -eq 0
        } | Sort-Object @{Expression={ if ($_.width -eq 1920 -and $_.height -eq 1080) { 0 } else { 1 } }}, @{Expression={ [long]$_.width * $_.height }})
        if (-not $modes.Count) { throw 'No supported display mode can contain the capture matrix.' }
        $selected = $modes[0]
        Assert-DisplayMode $selected
        Set-DisplayMode $selected $true
        if (-not (Test-SameDisplayMode (Get-DisplayCurrent) $original)) { throw 'Display changed during admission.' }
        $state = [ordered]@{ schema=1; kind='ottplay-video-display'; status='planned'; original=$original; applied=$selected }
        Write-DisplayReceipt $state $true
        try {
            if (-not (Test-SameDisplayMode (Get-DisplayCurrent) $original)) { throw 'Display changed before apply.' }
            if (-not (Test-SameDisplayMode $original $selected)) { Set-DisplayMode $selected $false }
            $actual = Get-DisplayCurrent
            if (-not (Test-SameDisplayMode $actual $selected) -or $actual.monitorWidth -lt 1366 -or
                $actual.monitorHeight -lt 800 -or $actual.workWidth -lt 1320 -or $actual.workHeight -lt 752) {
                throw 'Display or work-area readback cannot contain the capture matrix.'
            }
            $state.applied = $actual; $state.status = 'applied'; Write-DisplayReceipt $state $false
        } catch {
            $failure = $_
            Restore-DisplayState $state
            throw $failure
        }
    }
    $state | ConvertTo-Json -Depth 5 -Compress
}

# Dot-sourcing permits portable tests of the actual state machine with fake I/O.
if ($MyInvocation.InvocationName -ne '.') {
    try { Invoke-VideoDisplay } catch { [Console]::Error.WriteLine('Windows video display failed: ' + $_.Exception.Message); exit 1 }
}
