<#
.SYNOPSIS
  Install a locally built Spy Mouse compatibility APK to a connected Android device.

.DESCRIPTION
  Windows PowerShell 5.1 compatible. Pure ASCII on purpose so the script is not
  affected by console codepage / BOM issues.

  Local research use only. You must already legally own the original game.
  This script never modifies or bypasses the game's licensing code.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File android-port\install.ps1 -Mode full

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File android-port\install.ps1 -Mode slim -Launch
#>
[CmdletBinding()]
param(
    [ValidateSet('full', 'slim')]
    [string]$Mode = 'full',

    [string]$Adb = '',

    [string]$Package = 'com.ea.spymouse_row',

    [switch]$Force,

    [switch]$Launch,

    [switch]$Diagnose
)

$ErrorActionPreference = 'Stop'

$PortDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$OutDir  = Join-Path $PortDir 'out'
$WorkDir = Join-Path $PortDir '_work'

function Find-Adb {
    if ($Adb -and (Test-Path $Adb)) { return $Adb }

    $found = Get-Command adb -ErrorAction SilentlyContinue
    if ($found) { return $found.Source }

    $candidates = @()

    # Prefer the adb shipped with the running MuMu build: its version matches
    # that emulator's adbd. Resolve the path from the registry (no drive guess).
    $reg = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
        Where-Object { $_.DisplayName -like 'MuMu*' -and $_.InstallLocation } | Select-Object -First 1
    if ($reg) {
        $nx = Join-Path $reg.InstallLocation 'nx_device'
        if (Test-Path $nx) {
            $mumuAdb = Get-ChildItem -Path $nx -Filter adb.exe -Recurse -ErrorAction SilentlyContinue |
                Select-Object -First 1
            if ($mumuAdb) { $candidates += $mumuAdb.FullName }
        }
    }

    $candidates += @(
        'C:\Program Files (x86)\pcsuite\adb\adb.exe',
        'C:\Program Files (x86)\pcsuite\adb_41\adb.exe',
        'C:\Program Files\Netease\MuMuPlayer-12.0\shell\adb.exe',
        'C:\Program Files\Netease\MuMu Player 12\shell\adb.exe'
    )
    # Never pass an unset environment variable to Join-Path: it throws
    # "Cannot bind argument to parameter 'Path' because it is null".
    if ($env:LOCALAPPDATA) {
        $candidates += (Join-Path $env:LOCALAPPDATA 'Thunder Network\ldplayer\pre_ldplayer\adb.exe')
        $candidates += (Join-Path $env:LOCALAPPDATA 'Thunder Network\ldplayer\adb.exe')
    }
    foreach ($sdkVar in @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT)) {
        if ($sdkVar) { $candidates += (Join-Path $sdkVar 'platform-tools\adb.exe') }
    }
    foreach ($c in $candidates) {
        if ($c -and (Test-Path $c)) { return $c }
    }
    return $null
}

function Invoke-Adb {
    param([string[]]$AdbArgs, [switch]$Global)
    # adb writes normal progress (e.g. "* daemon not running*") to stderr.
    # With ErrorActionPreference=Stop, PowerShell 5.1 turns a merged stderr
    # record into a terminating error -- so relax it for this one call.
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        # Pin every per-device command to one serial. MuMu can show up both as
        # emulator-5554 and 127.0.0.1:5555, which makes adb fail with
        # "more than one device/emulator" for every getprop/install call.
        $effective = $AdbArgs
        if (-not $Global -and $script:Device) { $effective = @('-s', $script:Device) + $AdbArgs }
        $out = & $script:AdbPath @effective 2>&1
        $code = $LASTEXITCODE
        return @{ Code = $code; Text = ($out | Out-String).Trim() }
    }
    finally { $ErrorActionPreference = $prev }
}

# ------------------------------------------------------------------ adb --
$script:AdbPath = Find-Adb
if (-not $script:AdbPath) {
    throw 'adb.exe not found. Pass -Adb <path> or add platform-tools to PATH.'
}
Write-Host "adb      : $script:AdbPath"

$script:Device = $null
$dev = Invoke-Adb -Global @('devices')
$online = @($dev.Text -split "`n" | Where-Object { $_ -match '^\s*(\S+)\s+device\s*$' })
if ($online.Count -eq 0) {
    foreach ($port in @(5555, 7555, 16384)) {
        Invoke-Adb -Global @('connect', "127.0.0.1:$port") | Out-Null
    }
    $dev = Invoke-Adb -Global @('devices')
    $online = @($dev.Text -split "`n" | Where-Object { $_ -match '^\s*(\S+)\s+device\s*$' })
}
if ($online.Count -eq 0) {
    throw "No online device/emulator. Output was:`n$($dev.Text)"
}
$script:Device = ($online[0] -replace '^\s*(\S+)\s+device\s*$', '$1').Trim()
Write-Host "device   : $script:Device ($($online.Count) online)"

# --------------------------------------------------------------- precheck --
$sdk      = (Invoke-Adb @('shell', 'getprop', 'ro.build.version.sdk')).Text
$release  = (Invoke-Adb @('shell', 'getprop', 'ro.build.version.release')).Text
$abi32    = (Invoke-Adb @('shell', 'getprop', 'ro.product.cpu.abilist32')).Text
$abiAll   = (Invoke-Adb @('shell', 'getprop', 'ro.product.cpu.abilist')).Text
$bridge64 = (Invoke-Adb @('shell', 'getprop', 'ro.vendor.enable.native.bridge.exec64')).Text
$model    = (Invoke-Adb @('shell', 'getprop', 'ro.product.model')).Text
$arm32Ok  = ($abiAll -match 'armeabi') -or ($abi32 -match 'armeabi')

Write-Host "model    : $model"
Write-Host "Android  : $release (API $sdk)"
Write-Host "ABI all  : $abiAll"
Write-Host "ABI 32   : $abi32"
Write-Host "ARM64-only bridge : $bridge64"

if ($Diagnose) {
    Write-Host '---'
    if ($arm32Ok) {
        Write-Host 'VERDICT: ARM32 ABI present -> this target can install the 32-bit ARM build.'
    }
    else {
        Write-Host 'VERDICT: NO ARM32 ABI -> install fails with -16 / INSTALL_FAILED_NO_MATCHING_ABIS.'
        Write-Host "MuMu Android 15 instances officially do NOT support ARM 32-bit apps."
        Write-Host "Switch to a MuMu Android 12 instance, LDPlayer 5/9 (Android 7/9), or another ARM32-capable target."
    }
    return
}

if (-not $Force -and -not $arm32Ok) {
    throw @'
INSTALL WILL FAIL: this target exposes NO ARM 32-bit ABI.
  abilist    : see above
  installers report -16 (INSTALL_FAILED_CPU_ABI_INCOMPATIBLE) or
  INSTALL_FAILED_NO_MATCHING_ABIS: Failed to extract native libraries.

libSpyMouse.so is a 2008 ELF32 ARM binary. There is no arm64-v8a build and
no source to recompile it, so a 64-bit-only target cannot run this game.
MuMu officially states that its Android 15 instances cannot use ARM 32-bit
apps, while Android 12 instances can.

WHAT TO DO:
  1. In the MuMu multi-instance manager, create/switch to an Android 12
     instance (Android 15 and 12 can coexist), then run this script again.
  2. Or use LDPlayer 5/9 (Android 7/9 with ARM32 translation), or any
     real 32-bit-capable ARM device.
  3. Or use the Web port in this repository, which has no native binary.

-Force only bypasses this precheck; the install itself will still be rejected.
'@
}
if ($abi32 -match 'x86' -and $abiAll -match 'armeabi') {
    Write-Warning 'ARM support comes from a translation layer; runtime behaviour may differ from a real ARM device.'
}

$apk = Join-Path $OutDir "spymouse-compat-$Mode.apk"
if (-not (Test-Path $apk)) {
    throw "Missing $apk -- run: node android-port/build.mjs --mode $Mode"
}
Write-Host "APK      : $apk ($([math]::Round((Get-Item $apk).Length / 1MB, 1)) MiB)"

# --------------------------------------------------------------- install --
Write-Host "`nInstalling (-r -g grants runtime permissions)..."
$ins = Invoke-Adb @('install', '-r', '-g', $apk)
Write-Host $ins.Text
if ($ins.Code -ne 0) { throw "adb install failed with exit $($ins.Code)" }

$remote = "/sdcard/Android/data/$Package/files"

if ($Mode -eq 'slim') {
    $zip = Join-Path $OutDir 'spymouse-data.zip'
    if (-not (Test-Path $zip)) { throw "Missing $zip" }

    Write-Host "`nProvisioning data pack to $remote ..."
    Invoke-Adb @('shell', "mkdir -p $remote") | Out-Null

    $hasUnzip = (Invoke-Adb @('shell', 'command -v unzip')).Text
    if ($hasUnzip -and $hasUnzip -match 'unzip') {
        Write-Host 'Device has unzip: pushing the zip in one transfer.'
        $p = Invoke-Adb @('push', $zip, '/data/local/tmp/spymouse-data.zip')
        if ($p.Code -ne 0) { throw "adb push failed: $($p.Text)" }
        $u = Invoke-Adb @('shell', "unzip -o -q /data/local/tmp/spymouse-data.zip -d $remote")
        if ($u.Code -ne 0) { throw "device unzip failed: $($u.Text)" }
        Invoke-Adb @('shell', 'rm /data/local/tmp/spymouse-data.zip') | Out-Null
    }
    else {
        Write-Host 'Device has no unzip: extracting on the PC, then pushing the tree (this is slower).'
        $stage = Join-Path $WorkDir 'data-staged'
        if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
        New-Item -ItemType Directory -Path $stage -Force | Out-Null
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        [System.IO.Compression.ZipFile]::ExtractToDirectory($zip, $stage)
        Push-Location $stage
        try {
            $p = Invoke-Adb @('push', '.', $remote)
            if ($p.Code -ne 0) { throw "adb push failed: $($p.Text)" }
        }
        finally { Pop-Location }
    }

    $marker = (Invoke-Adb @('shell', "ls -l $remote/Downloaded.indicate")).Text
    Write-Host "marker   : $marker"
    if ($marker -notmatch 'Downloaded.indicate') {
        throw 'Data provisioning looks incomplete (Downloaded.indicate missing).'
    }
    Write-Host 'NOTE: Android 11+ may block adb writes under /sdcard/Android/data. If the push failed, use -Mode full instead.'
}
else {
    Write-Host @"

Self-contained build: the APK will unpack ~167 MiB into
  $remote
on FIRST launch. This happens on the main thread and can take 10-60 s;
if Android shows an 'App is not responding' dialog, choose 'Wait'.
Progress is logged under tag SpyMouseCompat:
  adb logcat -s SpyMouseCompat
"@
}

# ------------------------------------------------------------------ done --
if ($Launch) {
    Write-Host 'Launching...'
    Invoke-Adb @('shell', "am start -n $Package/com.ea.spymouse_na.SpyMouseActivity") | Out-Null
}

Write-Host @"

Installed. Reminder: the app's Google Play LVL licensing classes were left
untouched, but re-signing changes the certificate, so the license check may
fail on a device without the original purchase state. This tool does not
bypass licensing. See android-port/README.md for details and legal scope.
"@
