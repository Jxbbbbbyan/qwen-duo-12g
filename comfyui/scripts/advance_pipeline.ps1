# advance_pipeline.ps1 - idempotent, resumable pipeline advancer for the long unattended window
#
# WHY THIS EXISTS: the user chose to accept a ~40 hour WiFi download (D-182). At that timescale the
# old flow was TWO MANUAL STEPS - run post_download.ps1 after the archive lands, then separately
# start fetch_models.ps1 - so any gap between them, or any stall while nobody was watching, was pure
# wasted wall-clock on the critical path. This script advances whichever stage the filesystem says we
# are in, and is safe to call any number of times.
#
# STAGES (decided ONLY by observing the filesystem - no state file to drift out of sync):
#   S1 archive incomplete        -> make sure fetch_comfy.ps1 is running
#   S2 archive complete          -> start fetch_models.ps1 in the BACKGROUND (network-bound, the long
#                                   pole) and run post_download.ps1 in the FOREGROUND (disk/CPU-bound).
#                                   Concurrent on purpose: they compete for DIFFERENT resources, so
#                                   serialising them would leave one resource idle for no reason.
#   S3 weights incomplete        -> make sure fetch_models.ps1 is running
#   S4 weights complete          -> stop; place_models.ps1 and every gate after it stay MANUAL
#
# Deliberately NOT automated: place_models.ps1 (I-005) and everything past it. Automation here only
# covers the non-destructive, certainly-needed work: downloading and extracting.
#
# Exit codes: 0 = advanced or nothing to do (never an error); the log is the audit trail.

param(
  [string]$Root = 'C:\ComfyUI',
  [switch]$DryRun
)

$ErrorActionPreference = 'Continue'

$logDir = Join-Path $Root 'logs'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
$log = Join-Path $logDir 'advance_pipeline.log'

function Say($m) {
  $l = ("{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m)
  Write-Host $l
  Add-Content -Path $log -Value $l
}
function SizeOf($p) { if (Test-Path $p) { (Get-Item $p).Length } else { 0 } }

$archive  = Join-Path $Root 'ComfyUI_windows_portable_nvidia.7z'
$arcWant  = 2010075321
$portable = Join-Path $Root 'ComfyUI_windows_portable'
# comfyui_version.py is the authoritative version source, so its presence proves a real extraction
# happened - unlike the directory, which could exist as a half-written shell after a failed unpack.
$versionF = Join-Path $portable 'ComfyUI\comfyui_version.py'
$stage    = Join-Path $Root '_downloads'

# The exact staged filenames fetch_models.ps1 produces ($f.rel -replace '/','__'), with E-EXT-003
# byte counts. Kept as literal names on purpose: if fetch_models.ps1 ever renames these, S3 must NOT
# silently report "complete" - a mismatch here shows up as an incomplete weight total, which is loud.
$weights = @(
  @{ name = 'diffusion_models__qwen_image_2.1_turbo_int8_convrot.safetensors'; bytes = 7256787829 },
  @{ name = 'text_encoders__qwen3vl_8b_int8_convrot.safetensors';             bytes = 9350798360 },
  @{ name = 'vae__qwen_image_2.1_vae_bf16.safetensors';                       bytes = 675509688  }
)

function FetcherAlive([string]$scriptName) {
  # Same guard as ensure_fetch_running.ps1: match the -File argument specifically and exclude $PID.
  # A bare `CommandLine -match 'fetch_comfy.ps1'` also matches any shell merely MENTIONING the name,
  # which during development caused a real self-inflicted kill and, in read-only form, would make
  # this script believe a dead download is alive and therefore never restart it.
  #
  # The -Command exclusion closes the OTHER half of that bug, observed live: the harness runs our
  # commands as `pwsh -Command "<whole script text>"`, so a diagnostic command that merely mentions
  # fetch_models.ps1 matched the parent shell and reported it ALIVE while nothing was running. Here
  # that false positive would be worse than a cosmetic misreport: S2 would conclude the ~40 h weight
  # download was already under way and never start it, stalling the deployment silently. Every
  # legitimate launch in this toolchain goes through Start-Process with -File and no -Command.
  $me = $PID
  $p = Get-CimInstance Win32_Process -Filter "Name='pwsh.exe'" -ErrorAction SilentlyContinue |
       Where-Object { $_.ProcessId -ne $me -and $_.CommandLine -and
                      $_.CommandLine -notmatch '-Command|-EncodedCommand' -and
                      $_.CommandLine -match ('-File\s+\S*' + [regex]::Escape($scriptName)) }
  return ($null -ne $p)
}

function Start-Fetcher([string]$script, [string]$tag) {
  if ($DryRun) { Say ("  [dry-run] would start {0}" -f $tag); return }
  $p = Start-Process -FilePath (Get-Command pwsh).Source `
       -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $script `
       -WindowStyle Hidden -PassThru
  Say ("  started {0} as pid {1}" -f $tag, $p.Id)
}

Say ("=== advance_pipeline{0} ===" -f $(if ($DryRun) { ' [DRY RUN]' } else { '' }))

# ---------------- S1 ----------------
$asz = SizeOf $archive
$apct = if ($arcWant -gt 0) { 100.0 * $asz / $arcWant } else { 0 }
Say ("S1 archive : {0:N0} / {1:N0} B ({2:N2}%)" -f $asz, $arcWant, $apct)

if ($asz -ne $arcWant) {
  if (FetcherAlive 'fetch_comfy.ps1') { Say "  fetch_comfy.ps1 alive -> nothing to do" }
  else { Say "  fetch_comfy.ps1 NOT alive"; Start-Fetcher (Join-Path $Root 'scripts\fetch_comfy.ps1') 'fetch_comfy.ps1' }
  Say "STATE: S1 (archive incomplete)"
  exit 0
}

# ---------------- S2 ----------------
$extracted = Test-Path $versionF
Say ("S2 archive COMPLETE; extracted marker present = {0}" -f $extracted)

if (FetcherAlive 'fetch_models.ps1') { Say "  fetch_models.ps1 already alive" }
else { Say "  fetch_models.ps1 not alive - starting the ~40 h weight download now"; Start-Fetcher (Join-Path $Root 'scripts\fetch_models.ps1') 'fetch_models.ps1' }

if (-not $extracted) {
  Say "  running post_download.ps1 (disk/CPU-bound, concurrent with the weight download)"
  if ($DryRun) {
    Say "  [dry-run] would run post_download.ps1"
  } else {
    & (Get-Command pwsh).Source -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root 'scripts\post_download.ps1') 2>&1 |
      ForEach-Object { Say ("  | " + $_) }
    Say ("  post_download.ps1 exit = {0}" -f $LASTEXITCODE)
  }
} else {
  Say "  extraction already done -> skipping post_download.ps1"
}

# ---------------- S3 ----------------
$got = 0; $want = 0
foreach ($w in $weights) {
  $g = SizeOf (Join-Path $stage $w.name)
  $got += $g; $want += $w.bytes
  if ($g -ne $w.bytes) { Say ("  pending: {0}  {1:N0} / {2:N0} B" -f $w.name, $g, $w.bytes) }
}
Say ("S3 weights : {0:N0} / {1:N0} B ({2:N2}%)" -f $got, $want, (100.0 * $got / $want))

if ($got -ne $want) { Say "STATE: S3 (weights incomplete)"; exit 0 }

Say "STATE: S4 - archive and all three Turbo weights are complete."
Say "NEXT (manual, gated): verify SHA256, then pwsh -File $Root\scripts\place_models.ps1"

# ---------------- S5: the patched driver package ----------------
# Starts only once the weights are complete so it never competes with the critical-path download.
# Completeness is proved by OPENING the zip (a truncated archive throws) rather than by byte count,
# because GitHub release assets give no cheap length here and the API is rate-limited from this IP.
$patcherPkg = 'C:\driver-patch\581.94-desktop-notebook-win10-win11-64bit-international-dch.hf.zip'
$patcherOk = $false
if (Test-Path $patcherPkg) {
  Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue
  try {
    $z = [System.IO.Compression.ZipFile]::OpenRead($patcherPkg); $n = $z.Entries.Count; $z.Dispose()
    if ($n -gt 0) { $patcherOk = $true; Say ("S5 patcher : COMPLETE  {0:N0} B, {1} zip entries" -f (SizeOf $patcherPkg), $n) }
  } catch { Say ("S5 patcher : present but not a valid zip yet ({0:N0} B) - will resume" -f (SizeOf $patcherPkg)) }
}

if (-not $patcherOk) {
  if (FetcherAlive 'fetch_patcher.ps1') { Say "S5 patcher : fetch_patcher.ps1 already alive -> nothing to do" }
  else { Say "S5 patcher : not complete - starting fetch_patcher.ps1"; Start-Fetcher (Join-Path $Root 'scripts\fetch_patcher.ps1') 'fetch_patcher.ps1' }
  Say "STATE: S5 (patcher package downloading)"
  exit 0
}

Say "STATE: S6 - weights AND patcher package are complete."
Say "NEXT (manual): P104_GATE - install the card, then apply 581.94 (regular, non-NVENC) with DDU."
exit 0
