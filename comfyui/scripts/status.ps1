# status.ps1 - one command that answers "where are we, what is next, is anything stuck?"
#
# WHY: this deployment spends most of its wall-clock waiting on a multi-day download, so it spans many
# sessions and (on this machine) far more goal rounds than the download needs. Anyone resuming - a human
# or a fresh agent - must be able to get the true state in ONE command instead of re-deriving it from
# half a dozen files and a dozen log tails. Every number here is MEASURED, never narrated.
#
# The rate is computed from the OLDEST and NEWEST progress samples that are >= 45 s apart, deliberately
# NOT from the most recent instantaneous rate: earlier in this run instantaneous rates were twice
# mistaken for steady state (CORR-011), once far too optimistic and once far too pessimistic.
#
# Exit codes: 0 = reported successfully. A WARN line marks a condition needing attention (e.g. the file
# is incomplete but no fetcher is alive) so this can also be used as a health probe.

param(
  [string]$Root = 'C:\ComfyUI'
)

$ErrorActionPreference = 'Continue'

$archive  = Join-Path $Root 'ComfyUI_windows_portable_nvidia.7z'
$arcWant  = 2010075321
$stage    = Join-Path $Root '_downloads'
$versionF = Join-Path $Root 'ComfyUI_windows_portable\ComfyUI\comfyui_version.py'

$weights = @(
  @{ name = 'diffusion_models__qwen_image_2.1_turbo_int8_convrot.safetensors'; bytes = 7256787829; log = 'fetch_models.log' },
  @{ name = 'text_encoders__qwen3vl_8b_int8_convrot.safetensors';             bytes = 9350798360; log = 'fetch_models.log' },
  @{ name = 'vae__qwen_image_2.1_vae_bf16.safetensors';                       bytes = 675509688;  log = 'fetch_models.log' }
)

function SizeOf($p) { if (Test-Path $p) { (Get-Item $p).Length } else { 0 } }

function Get-Rate([string]$logName, [int]$minSpanSec = 0, [switch]$Closest) {
  $p = Join-Path $Root ('logs\' + $logName)
  if (-not (Test-Path $p)) { return $null }
  $samples = @()
  foreach ($l in (Get-Content $p -Tail 400 -ErrorAction SilentlyContinue)) {
    $m = [regex]::Match($l, '^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\s+.*?([\d,]+) / ([\d,]+) B')
    if ($m.Success) {
      $samples += [pscustomobject]@{
        t = [datetime]::ParseExact($m.Groups[1].Value, 'yyyy-MM-dd HH:mm:ss', $null)
        have = [int64]($m.Groups[2].Value -replace ',', '')
      }
    }
  }
  if ($samples.Count -lt 2) { return $null }
  $last = $samples[-1]
  # -Closest picks the NEWEST sample that is still >= minSpanSec old, i.e. a window of roughly minSpanSec.
  # Without it we take the OLDEST available, i.e. a long-run average. Both are reported because they
  # answer different questions ("is it slowing down now?" vs "what is the honest ETA?").
  $cands = @($samples | Where-Object { ($last.t - $_.t).TotalSeconds -ge $minSpanSec })
  if ($cands.Count -eq 0) { $cands = @($samples[0]) }
  $first = if ($Closest) { $cands[-1] } else { $cands[0] }
  $dt = ($last.t - $first.t).TotalSeconds
  if ($dt -le 0) { return $null }
  $d = $last.have - $first.have
  if ($d -le 0) { return $null }
  return [pscustomobject]@{ rateKBps = ($d / $dt / 1KB); spanMin = ($dt / 60); have = $last.have }
}

function Fmt-Eta([double]$rateKBps, [int64]$remaining) {
  if ($rateKBps -le 0 -or $remaining -le 0) { return 'n/a' }
  $h = ($remaining / 1KB) / $rateKBps / 3600
  if ($h -ge 48) { return ("{0:N1} days" -f ($h / 24)) }
  if ($h -ge 1)  { return ("{0:N1} h" -f $h) }
  return ("{0:N0} min" -f ($h * 60))
}

function Proc-Alive([string]$scriptName) {
  # Two exclusions, both learned from real incidents rather than theory:
  #  1. exclude $PID            - a Stop-Process filtered by a bare name match once killed the very
  #                               shell running it (self-inflicted kill).
  #  2. exclude -Command shells - the harness runs our commands as `pwsh -Command "<whole script text>"`,
  #                               so a diagnostic command that merely MENTIONS fetch_models.ps1 makes the
  #                               parent shell match and the script reports ALIVE when nothing is
  #                               running. Every legitimate fetcher launch uses `-File` and no -Command,
  #                               so this discriminates cleanly.
  $me = $PID
  $p = Get-CimInstance Win32_Process -Filter "Name='pwsh.exe'" -ErrorAction SilentlyContinue |
       Where-Object { $_.ProcessId -ne $me -and $_.CommandLine -and
                      $_.CommandLine -notmatch '-Command|-EncodedCommand' -and
                      $_.CommandLine -match ('-File\s+\S*' + [regex]::Escape($scriptName)) }
  return ($null -ne $p)
}

Write-Host "================================================================"
Write-Host (" Qwen-Image 2.1 deployment status   " + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
Write-Host "================================================================"
Write-Host ""

# ---------------- archive ----------------
$asz = SizeOf $archive
$apct = 100.0 * $asz / $arcWant
Write-Host "[1] ComfyUI portable archive (I-002)"
if ($asz -eq $arcWant) {
  Write-Host ("    COMPLETE  {0:N0} B" -f $asz)
} else {
  Write-Host ("    {0:N0} / {1:N0} B = {2:N2}%   remaining {3:N2} GiB" -f $asz, $arcWant, $apct, (($arcWant - $asz) / 1GB))
  # two windows on purpose: the recent one answers "is it slowing down NOW?", the overall one is the
  # honest basis for an ETA. A single figure hid the difference and read as a 253-minute average.
  $rr = Get-Rate 'fetch_comfy.log' 480 -Closest
  $ro = Get-Rate 'fetch_comfy.log'
  if ($rr) { Write-Host ("    recent  {0,7:N1} KB/s over {1,6:N1} min" -f $rr.rateKBps, $rr.spanMin) }
  if ($ro) {
    Write-Host ("    overall {0,7:N1} KB/s over {1,6:N1} min  -> ETA {2}  (data only, never a gate)" -f `
      $ro.rateKBps, $ro.spanMin, (Fmt-Eta $ro.rateKBps ($arcWant - $asz)))
  }
  if (-not $rr -and -not $ro) { Write-Host "    rate: not enough progress samples yet" }
}
Write-Host ""

# ---------------- extraction ----------------
$extracted = Test-Path $versionF
Write-Host "[2] Extraction (I-002 STEP 1b)"
Write-Host ("    comfyui_version.py present = {0}" -f $extracted)
if (Test-Path $versionF) {
  $v = (Select-String -Path $versionF -Pattern '__version__\s*=\s*"([^"]+)"' | Select-Object -First 1)
  if ($v) { Write-Host ("    version = " + $v.Matches[0].Groups[1].Value) }
}
Write-Host ""

# ---------------- weights ----------------
Write-Host "[3] Model weights (I-004)"
$wtot = 0; $wwant = 0
foreach ($w in $weights) {
  $s = SizeOf (Join-Path $stage $w.name)
  $wtot += $s; $wwant += $w.bytes
  $mark = if ($s -eq $w.bytes) { 'OK     ' } elseif ($s -gt 0) { 'partial' } else { 'pending' }
  Write-Host ("    {0}  {1,15:N0} / {2,15:N0} B  {3}" -f $mark, $s, $w.bytes, $w.name)
}
Write-Host ("    total {0:N0} / {1:N0} B = {2:N2}%" -f $wtot, $wwant, (100.0 * $wtot / $wwant))
if ($wtot -gt 0 -and $wtot -ne $wwant) {
  $r = Get-Rate 'fetch_models.log'
  if ($r) { Write-Host ("    measured {0:N1} KB/s -> ETA {1}" -f $r.rateKBps, (Fmt-Eta $r.rateKBps ($wwant - $wtot))) }
}
Write-Host ""

# ---------------- processes ----------------
Write-Host "[4] Processes"
$fc = Proc-Alive 'fetch_comfy.ps1'
$fm = Proc-Alive 'fetch_models.ps1'
$ru = Proc-Alive 'run_unattended.ps1'
$pd = Proc-Alive 'post_download.ps1'
Write-Host ("    fetch_comfy.ps1      {0}" -f $(if ($fc) { 'ALIVE' } else { 'not running' }))
Write-Host ("    fetch_models.ps1     {0}" -f $(if ($fm) { 'ALIVE' } else { 'not running' }))
Write-Host ("    run_unattended.ps1   {0}" -f $(if ($ru) { 'ALIVE' } else { 'NOT running  <-- download will not auto-advance' }))
Write-Host ("    post_download.ps1    {0}" -f $(if ($pd) { 'ALIVE' } else { 'not running' }))
Write-Host ""

# ---------------- stage + next action ----------------
Write-Host "[5] Stage"
$warn = @()
if ($asz -ne $arcWant) {
  Write-Host "    S1 - archive incomplete"
  Write-Host "    next: nothing to do; the archive must finish first"
  if (-not $fc) { $warn += "archive incomplete but fetch_comfy.ps1 is NOT running" }
} elseif (-not $extracted) {
  Write-Host "    S2 - archive complete, not extracted"
  Write-Host "    next: advance_pipeline.ps1 starts fetch_models.ps1 and runs post_download.ps1"
  if (-not $fm) { $warn += "S2 but fetch_models.ps1 is NOT running" }
} elseif ($wtot -ne $wwant) {
  Write-Host "    S3 - extracting done, weights incomplete"
  Write-Host "    next: nothing to do; weights must finish"
  if (-not $fm) { $warn += "weights incomplete but fetch_models.ps1 is NOT running" }
} else {
  Write-Host "    S4 - archive + all three Turbo weights complete"
  Write-Host "    next (manual, gated): verify SHA256, then scripts\place_models.ps1"
}
if (-not $ru) { $warn += "run_unattended.ps1 is not running - re-run it to keep stages auto-advancing" }

Write-Host ""
if ($warn.Count -eq 0) {
  Write-Host "WARN: none."
} else {
  foreach ($w in $warn) { Write-Host ("WARN: " + $w) }
}
Write-Host ""
Write-Host "advance now: pwsh -File $Root\scripts\advance_pipeline.ps1 -DryRun"
exit 0
