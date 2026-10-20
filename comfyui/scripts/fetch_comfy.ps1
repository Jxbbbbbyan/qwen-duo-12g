# fetch_comfy.ps1 - download the ComfyUI Windows portable (nvidia build)
# Plan: dsh-plans/2026-10-16-qwen-image-21-local-deploy/PLAN_v3.md  (item I-002, Risk-007)
#
# Expected exact size: 2,010,075,321 B (from the GitHub release API).
#
# TWO MEASURED FACTS DRIVE THIS DESIGN (this machine, 2026-10-16):
#
# 1) The link ceiling is ~110 KB/s and it is NOT per-flow throttling.
#    1 stream = 116.1 KB/s, 4 concurrent streams = 109.4 KB/s aggregate.
#    => concurrency/multi-threaded downloaders buy NOTHING. Do not bother with aria2.
#
# 2) Throughput is extremely UNSTABLE, both over time and across sources.
#    Same URL, different times: 107.6, 98.0, 78.4, 13.5 KB/s.
#    Same moment, different sources: gh-proxy.com 41.9 vs direct-github 4.7 KB/s.
#    A long-lived connection also decays: it held 19.9 KB/s where a fresh one got 78.4.
#    => (a) bound every connection's lifetime and resume with `-C -`
#       (b) re-RACE the sources whenever progress stalls, instead of trusting a fixed order.

$ErrorActionPreference = 'Continue'
$asset = 'https://github.com/Comfy-Org/ComfyUI/releases/download/v0.41.0/ComfyUI_windows_portable_nvidia.7z'
$want  = 2010075321
$dest  = 'C:\ComfyUI\ComfyUI_windows_portable_nvidia.7z'
$log   = 'C:\ComfyUI\logs\fetch_comfy.log'
$tmp   = 'C:\ComfyUI\_probe'

New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

function Say($m) {
  $line = "{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m
  Write-Output $line
  Add-Content -Path $log -Value $line
}
function SizeOf($p) { if (Test-Path $p) { (Get-Item $p).Length } else { 0 } }

$candidates = @(
  @{ name='gh-proxy.com'; url="https://gh-proxy.com/$asset" },
  @{ name='ghfast.top';   url="https://ghfast.top/$asset" },
  @{ name='direct';       url=$asset },
  @{ name='ghproxy.net';  url="https://ghproxy.net/$asset" }
)

function Measure-Source($c, $secs = 12) {
  $o = Join-Path $tmp ("probe_" + ($c.name -replace '[^\w]','_') + ".bin")
  if (Test-Path $o) { Remove-Item $o -Force -ErrorAction SilentlyContinue }
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  curl.exe -sS -L --max-time $secs -r 0-8388607 -o $o $c.url 2>&1 | Out-Null
  $sw.Stop()
  $len = SizeOf $o
  Remove-Item $o -Force -ErrorAction SilentlyContinue
  if ($sw.Elapsed.TotalSeconds -le 0) { return 0 }
  return ($len / 1KB / $sw.Elapsed.TotalSeconds)
}

function Pick-Fastest($cands) {
  $best = $null; $bestRate = -1
  foreach ($c in $cands) {
    $r = Measure-Source $c
    Say ("  probe {0,-14} {1,7:N1} KB/s" -f $c.name, $r)
    if ($r -gt $bestRate) { $bestRate = $r; $best = $c }
  }
  Say ("  -> picked {0} ({1:N1} KB/s)" -f $best.name, $bestRate)
  $best.rate = $bestRate
  return $best
}

Say "=== fetch_comfy.ps1 start : want $want B, resuming from $(SizeOf $dest) B ==="

$outer = 0
while ((SizeOf $dest) -ne $want -and $outer -lt 500) {
  $outer++
  $s = Pick-Fastest $candidates
  Say "--- round $outer using $($s.name) (have $(SizeOf $dest) B)"

  # RE-RACE EARLY WHEN A SOURCE FAILS TO LIVE UP TO ITS PROBE.
  # Observed on this machine: `direct` probed 97.4 KB/s at 19:28:31 but then delivered only
  # ~3.5 KB/s for minutes, i.e. an 8-12 s probe does NOT predict sustained throughput for a
  # source that bursts then throttles. Waiting the full 6 inner rounds wasted ~10 minutes.
  # So compare each completed round's observed rate against the probe and bail out if it is far off.
  $probeRate = if ($s.rate) { $s.rate } else { 0 }
  $slowStreak = 0
  $stall = 0; $inner = 0
  while ($inner -lt 6) {
    $inner++
    $have = SizeOf $dest
    if ($have -eq $want) { break }
    if ($have -gt $want) { Say "  !! oversize; restarting"; Remove-Item $dest -Force; $have = 0 }

    $t0 = Get-Date
    curl.exe -sS -L --retry 1 --retry-delay 3 --retry-all-errors --max-time 90 -C - -o "$dest" "$($s.url)" 2>&1 |
      ForEach-Object { if ($_ -match '\S') { Add-Content -Path $log -Value ("  curl: " + $_) } }
    $dt = ((Get-Date) - $t0).TotalSeconds

    $now = SizeOf $dest
    $grew = $now - $have
    $obsRate = if ($dt -gt 0) { $grew / 1KB / $dt } else { 0 }
    Say ("  [{0} #{1}] {2:N0} / {3:N0} B ({4:N2}%)  +{5:N0} B  = {6:N1} KB/s (probe said {7:N1})" -f `
      $s.name, $inner, $now, $want, ($now/$want*100), $grew, $obsRate, $probeRate)

    if ($grew -le 0) { $stall++ } else { $stall = 0 }
    if ($stall -ge 2) { Say "  stalled on $($s.name) - re-racing sources"; break }

    if ($probeRate -gt 5 -and $obsRate -lt ($probeRate * 0.25)) {
      $slowStreak++
      Say ("  !! $($s.name) delivered only {0:N1} KB/s vs a {1:N1} KB/s probe ({2}/2)" -f $obsRate, $probeRate, $slowStreak)
      if ($slowStreak -ge 2) { Say "  source underperforms its probe - re-racing early instead of waiting out the round"; break }
    } else { $slowStreak = 0 }

    Start-Sleep -Seconds 1
  }
  if ((SizeOf $dest) -eq $want) { break }
}

$final = SizeOf $dest
if ($final -eq $want) { Say "=== SIZE OK: $final B ===" } else { Say "=== INCOMPLETE: $final / $want B ===" }
