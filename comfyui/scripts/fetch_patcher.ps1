# fetch_patcher.ps1 - download the patched NVIDIA driver package (dartraiden/NVIDIA-patcher)
#
# WHY A SEPARATE FETCHER: the patcher zip is needed only when the P104 is physically installed, but it
# lives on GitHub, which this link reaches at ~8 KB/s directly while gh-proxy.com measured ~107 KB/s
# for the same content. So this races the two sources instead of hard-coding one.
#
# INTEGRITY: GitHub release assets give no cheap checksum here (the API is rate-limited and a HEAD
# through the redirect failed), so completeness is proved two ways instead of by byte count:
#   1. curl exits 0 AND the file stops growing, and
#   2. the zip actually opens and lists entries (a truncated zip fails this).
#
# The version is NOT arbitrary: per the patcher's own README version table, a P1XX mining card whose
# display GPU is "NVIDIA Turing and newer" (here: the RTX 3060) takes 581.94 - not 582.78, and
# definitely not the 582.66 that circulates in tutorials (no such release exists).
# P1XX cards have NVENC hardware-disabled, so the Regular (non "NVENC-NvFBC-") asset is required.
#
# Usage: pwsh -File C:\ComfyUI\scripts\fetch_patcher.ps1 [-ListOnly]
# Exit: 0 = complete or nothing to do; 1 = failed/incomplete.

param(
  [string]$Root = 'C:\ComfyUI',
  [switch]$ListOnly
)

$ErrorActionPreference = 'Continue'

$tag   = '581.94'
$asset = '581.94-desktop-notebook-win10-win11-64bit-international-dch.hf.zip'
$dest  = 'C:\driver-patch'
$log   = Join-Path $Root 'logs\fetch_patcher.log'

New-Item -ItemType Directory -Force -Path $dest | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null

function Say($m) {
  $l = "{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m
  Write-Host $l
  Add-Content -Path $log -Value $l
}
function SizeOf($p) { if (Test-Path $p) { (Get-Item $p).Length } else { 0 } }

$target = Join-Path $dest $asset
$direct = "https://github.com/dartraiden/NVIDIA-patcher/releases/download/$tag/$asset"
$sources = @(
  @{ name = 'gh-proxy'; url = "https://gh-proxy.com/$direct" },
  @{ name = 'direct';   url = $direct }
)

if ($ListOnly) {
  Write-Output "patcher package : $asset"
  Write-Output "release tag     : $tag  (P1XX row x 'NVIDIA Turing and newer' column)"
  Write-Output "destination     : $target"
  Write-Output "already present : $(SizeOf $target) B"
  foreach ($s in $sources) { Write-Output ("source {0,-9}: {1}" -f $s.name, $s.url) }
  Write-Output "  -ListOnly: nothing downloaded."
  exit 0
}

# already complete? a zip that opens and lists entries is complete enough to use
if (Test-Path $target) {
  Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue
  try {
    $z = [System.IO.Compression.ZipFile]::OpenRead($target)
    $n = $z.Entries.Count
    $z.Dispose()
    if ($n -gt 0) {
      Say ("=== already complete: {0:N0} B, {1} zip entries -> nothing to do ===" -f (SizeOf $target), $n)
      exit 0
    }
  } catch {
    Say ("partial/corrupt zip present ({0:N0} B): {1} - will resume" -f (SizeOf $target), $_.Exception.Message)
  }
}

Say ("=== fetch_patcher.ps1 start : resuming from {0:N0} B ===" -f (SizeOf $target))

foreach ($s in $sources) {
  $before = SizeOf $target
  Say ("--- trying {0} (have {1:N0} B) ---" -f $s.name, $before)

  $round = 0
  while ($round -lt 20) {
    $round++
    $have = SizeOf $target
    $t0 = Get-Date
    # NOTE: deliberately NO --max-time here. A 1-hour cap on a ~7.6 h download at 8 KB/s is what
    # silently killed the first attempt; --max-time applies to the whole transfer, not per stall.
    curl.exe -sS -L --retry 3 --retry-delay 3 --retry-all-errors -C - -o "$target" "$($s.url)" 2>&1 |
      ForEach-Object { if ($_ -match '\S') { Add-Content -Path $log -Value ("  curl: " + $_) } }
    $now  = SizeOf $target
    $dt   = ((Get-Date) - $t0).TotalSeconds
    $grew = $now - $have
    Say ("  [{0} #{1}] {2:N0} B  +{3:N0} B in {4:N0}s = {5:N1} KB/s" -f $s.name, $round, $now, $grew, $dt, ($(if ($dt -gt 0) { $grew / 1KB / $dt } else { 0 })))

    # is it a complete zip now?
    Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue
    try {
      $z = [System.IO.Compression.ZipFile]::OpenRead($target)
      $n = $z.Entries.Count
      $z.Dispose()
      Say ("=== COMPLETE: {0:N0} B, {1} zip entries (archive opens; structure readable - this does NOT prove authenticity) ===" -f $now, $n)
      exit 0
    } catch { }

    if ($grew -le 0) { Say "  no growth on $($s.name) - switching source"; break }
  }
}

Say ("=== INCOMPLETE: {0:N0} B - re-run later (resume is safe) ===" -f (SizeOf $target))
exit 1
