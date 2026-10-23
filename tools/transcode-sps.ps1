# Transcode the shipped EAAC (.sps) audio into browser-playable OGG files.
#
# Source (read-only):  com.ea.spymouse_row/files/res/sound/{sound,music}/**/*.sps
# Output:              assets/audio/sfx/<id>_<name>.ogg   (177 sounds, ids 0..176)
#                      assets/audio/music/<name>.ogg      (26 tracks)
#                      assets/audio/manifest.json
#
# Tooling: vgmstream-cli (decodes EAAC/EA-XAS) + ffmpeg (Vorbis encode).
# The id -> path table and the per-file loop metadata come from the REA evidence
# produced by analysis/rea/audio (analysis/rea/evidence/audio_id_table.json and
# audio_sps_scan.json); re-run those scripts if the .so or data pack changes.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\transcode-sps.ps1
#   ... -Force            # re-encode all files
#   ... -SfxOnly / -MusicOnly
param(
    [string]$Res = 'com.ea.spymouse_row\files\res\sound',
    [string]$OutDir = 'assets\audio',
    [string]$Vgmstream = 'analysis\rea\audio\work\vgmstream\vgmstream-cli.exe',
    [string]$Ffmpeg = 'E:\ffmpeg\ffmpeg-8.1.1-essentials_build\bin\ffmpeg.exe',
    [string]$IdTable = 'analysis\rea\evidence\audio_id_table.json',
    [string]$SpsScan = 'analysis\rea\evidence\audio_sps_scan.json',
    [switch]$SfxOnly,
    [switch]$MusicOnly,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

function Resolve-Tool([string]$path, [string]$name) {
    if (Test-Path $path) { return (Resolve-Path $path).Path }
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    throw "$name not found (looked for '$path')"
}

$Vgmstream = Resolve-Tool $Vgmstream 'vgmstream-cli'
$Ffmpeg = Resolve-Tool $Ffmpeg 'ffmpeg'

if (-not (Test-Path $Res)) { throw "sound root not found: $Res" }
if (-not (Test-Path $IdTable)) { throw "missing id table: $IdTable (run analysis/rea/audio/dump_id_table.py)" }
if (-not (Test-Path $SpsScan)) { throw "missing sps scan: $SpsScan (run analysis/rea/audio/parse_sps.py)" }

$root = (Resolve-Path $Res).Path
$sfxDir = Join-Path $OutDir 'sfx'
$musicDir = Join-Path $OutDir 'music'
$tmpDir = Join-Path $OutDir '_tmp'
New-Item -ItemType Directory -Force -Path $sfxDir, $musicDir, $tmpDir | Out-Null

$idData = Get-Content $IdTable -Raw | ConvertFrom-Json
$scan = Get-Content $SpsScan -Raw | ConvertFrom-Json
$scanByRel = @{}
foreach ($r in $scan.files) {
    if ($r.file) { $scanByRel[($r.file -replace '/', '\')] = $r }
}
$failed = New-Object System.Collections.ArrayList
$converted = 0
$skipped = 0

function Encode-One([string]$sps, [string]$outFile, [string]$label, [bool]$music) {
    if ((-not $Force) -and (Test-Path $outFile) -and ((Get-Item $outFile).Length -gt 0)) {
        return 'skipped'
    }
    $wav = Join-Path $tmpDir ($label + '.wav')
    try {
        $null = & $Vgmstream -i -o $wav $sps 2>&1
        if (-not (Test-Path $wav)) { throw 'vgmstream produced no wav' }
        $quality = if ($music) { '4' } else { '3' }
        $ffArgs = @('-hide_banner', '-loglevel', 'error', '-y', '-i', $wav,
                    '-c:a', 'libvorbis', '-q:a', $quality, $outFile)
        $null = & $Ffmpeg @ffArgs 2>&1
        if (-not (Test-Path $outFile) -or (Get-Item $outFile).Length -le 0) { throw 'ffmpeg produced no ogg' }
        return 'converted'
    } catch {
        [void]$failed.Add([ordered]@{ file = $label; source = (Split-Path $sps -Leaf); error = $_.Exception.Message })
        return 'failed'
    } finally {
        if (Test-Path $wav) { Remove-Item $wav -Force -ErrorAction SilentlyContinue }
    }
}

# ---- sound effects: exactly the 177 entries of the native id table ----

$sfxManifest = [ordered]@{}
if (-not $MusicOnly) {
    foreach ($row in ($idData.soundIdTable | Sort-Object id)) {
        $rel = $row.spsPath -replace '^sound/', ''
        $relKey = $rel
        $sps = Join-Path $root ($rel -replace '/', '\')
        if (-not (Test-Path $sps)) {
            [void]$failed.Add([ordered]@{ file = [string]$row.id; source = $relKey; error = 'source sps missing' })
            continue
        }
        $name = [IO.Path]::GetFileNameWithoutExtension($sps)
        $outFile = Join-Path $sfxDir ($row.id.ToString() + '_' + $name + '.ogg')
        $status = Encode-One $sps $outFile ([string]$row.id + '_' + $name) $false
        if ($status -eq 'converted') { $converted++ } elseif ($status -eq 'skipped') { $skipped++ }
        $meta = $scanByRel[($relKey -replace '/', '\')]
        $sfxManifest[[string]$row.id] = [ordered]@{
            name = $name
            file = 'assets/audio/sfx/' + $row.id + '_' + $name + '.ogg'
            loop = if ($meta) { [bool]$meta.loopFlag } else { $false }
            loopStart = if ($meta) { $meta.loopStart } else { $null }
            loopEnd = if ($meta) { $meta.numSamples } else { $null }
            duration = if ($meta) { $meta.durationSec } else { $null }
            sampleRate = if ($meta) { $meta.sampleRate } else { 22050 }
            channels = if ($meta) { $meta.channels } else { 1 }
            category = if ($row.spsPath -match '/ui/') { 'ui' } else { 'sfx' }
        }
    }
}

# ---- music: every sound/music/*.sps ----
$musicManifest = [ordered]@{}
if (-not $SfxOnly) {
    foreach ($f in (Get-ChildItem (Join-Path $root 'music') -Filter *.sps | Sort-Object Name)) {
        $name = $f.BaseName
        $relKey = 'music/' + $f.Name
        $outFile = Join-Path $musicDir ($name + '.ogg')
        $status = Encode-One $f.FullName $outFile $name $true
        if ($status -eq 'converted') { $converted++ } elseif ($status -eq 'skipped') { $skipped++ }
        $meta = $scanByRel[($relKey -replace '/', '\')]
        $musicManifest[$name] = [ordered]@{
            file = 'assets/audio/music/' + $name + '.ogg'
            loop = if ($meta) { [bool]$meta.loopFlag } else { $false }
            loopStart = if ($meta) { $meta.loopStart } else { $null }
            loopEnd = if ($meta) { $meta.numSamples } else { $null }
            duration = if ($meta) { $meta.durationSec } else { $null }
            sampleRate = if ($meta) { $meta.sampleRate } else { 22050 }
            channels = if ($meta) { $meta.channels } else { 2 }
        }
    }
}

$manifest = [ordered]@{
    version = 1
    generated = (Get-Date -Format 'yyyy-MM-dd')
    source = 'EAAC v1 SPS / EA-XAS 4-bit ADPCM v1, 22050 Hz (libSpyMouse.so, EA Audio Core 7.03.01)'
    counts = [ordered]@{ sfx = $sfxManifest.Count; music = $musicManifest.Count }
    sfx = $sfxManifest
    music = $musicManifest
}
$json = $manifest | ConvertTo-Json -Depth 8
[IO.File]::WriteAllText((Join-Path $OutDir 'manifest.json'), $json, (New-Object System.Text.UTF8Encoding($false)))

$report = [ordered]@{
    generated = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
    converted = $converted
    skipped = $skipped
    failed = $failed
    sfx = $sfxManifest.Count
    music = $musicManifest.Count
}
$reportJson = $report | ConvertTo-Json -Depth 6
[IO.File]::WriteAllText((Join-Path $OutDir 'transcode-report.json'), $reportJson, (New-Object System.Text.UTF8Encoding($false)))

if (Test-Path $tmpDir) { Remove-Item $tmpDir -Recurse -Force -ErrorAction SilentlyContinue }

Write-Output ("converted=" + $converted + " skipped=" + $skipped + " failed=" + $failed.Count)
Write-Output ("sfx=" + $sfxManifest.Count + " music=" + $musicManifest.Count)
Write-Output ("manifest: " + (Join-Path $OutDir 'manifest.json'))
if ($failed.Count -gt 0) {
    foreach ($f in $failed) { Write-Output ("FAIL " + $f.file + " " + $f.source + " :: " + $f.error) }
    exit 1
}




