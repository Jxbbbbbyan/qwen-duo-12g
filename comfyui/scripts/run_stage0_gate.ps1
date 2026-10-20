# run_stage0_gate.ps1 - item I-012 of PLAN_v3.md, split into two phases
#
# WHY SPLIT (schedule win, see PLAN_v3_AMENDMENT_002.md):
#   Phase A (idle baseline B0) needs NO model weights at all -> it can run as soon as ComfyUI
#   is installed (right after I-003), IN PARALLEL with the 17 GB weight download.
#   Phase B (the --fast-disk A/B) needs a real model load, hence the weights.
#   Splitting removes ~5 days from the critical path to knowing B0.
#
# NOTE on the "Model storage policy" line (VC-016 / V-009):
#   comfy/storage.py:110 logs it from model_fast_disk(), which is called by
#   state_dict_fast_disk() at MODEL LOAD time - NOT at boot. So it can only be observed in
#   Phase B. Phase A cannot produce it, and this script does not pretend otherwise.
#
# Usage:
#   pwsh -File run_stage0_gate.ps1 -Phase Idle
#   pwsh -File run_stage0_gate.ps1 -Phase Load -PromptGraph <path-to-api-json>
#
# ============================================================================
# THE TEST MATRIX THIS SCRIPT IS PART OF (do not silently drop a cell)
# ============================================================================
# Two independent axes, because two different things can move data into system RAM:
#
#  a) LAUNCH axis  - handled here, both arms always include the approved profile
#                   (--fast-disk --disable-pinned-memory):
#       fastdisk_on   : approved flags, nothing extra
#       fastdisk_off  : approved flags + --disable-fast-disk
#                       (its help text says "Overrides --fast-disk", so this is the control)
#     -> verdict for VC-016 / OPEN-006: does --fast-disk actually change the backing store?
#        Observable: the "Model storage policy: fast_disk=... paths=..." line in the log
#        (printed only at MODEL LOAD time, hence Phase Load), plus Private Bytes / Gpu Shared.
#
#  b) WORKFLOW axis - NOT handled here; pass a different -PromptGraph:
#       stage0_scaffold_api.json           QwenImage21Cache.device = "auto"
#                                          (schema tooltip: "auto uses spare VRAM, then RAM")
#       stage0_scaffold_api_cacheoff.json  QwenImage21Cache.device = "off"
#                                          ("recomputes the prefix every step ... the one way
#                                            to rule the cache out")
#     -> verdict for OPEN-007: the KV cache is NOT weights, so it does not violate R-010's
#        definition, but it IS memory on a 16 GB box. Measure auto vs off.
#
# Minimum meaningful cells:
#   1. fastdisk_on  + cache=auto   the approved default profile (baseline)
#   2. fastdisk_off + cache=auto   control for VC-016
#   3. fastdisk_on  + cache=off    control for OPEN-007
# ============================================================================

param(
  [ValidateSet('Idle','Load')][string]$Phase = 'Idle',
  [int]$Port = 8188,
  [int]$MeasureSeconds = 60,
  [string]$PromptGraph = '',
  [string]$Root = 'C:\ComfyUI\ComfyUI_windows_portable',
  [string]$LogDir = 'C:\ComfyUI\logs',
  [string]$OutDir = 'C:\ComfyUI\_evidence'
)

$ErrorActionPreference = 'Continue'
New-Item -ItemType Directory -Force -Path $LogDir,$OutDir | Out-Null

$py   = Join-Path $Root 'python_embeded\python.exe'
$main = Join-Path $Root 'ComfyUI\main.py'
if (-not (Test-Path $py))   { Write-Host "FAIL: $py not found (I-002 not done?)"; exit 2 }
if (-not (Test-Path $main)) { Write-Host "FAIL: $main not found"; exit 2 }

# R-002 / D-013: the approved flag set, and the banned ones.
$approved = @('--fast-disk','--disable-pinned-memory')
$banned   = @('--gpu-only','--highvram','--disable-dynamic-vram','--disable-smart-memory','--high-ram','--lowvram','--novram','--cpu')

function Start-Comfy([string[]]$extra, [string]$label) {
  $log = Join-Path $LogDir "stage0_$label`_$(Get-Date -Format 'HHmmss').log"
  foreach ($b in $banned) { if ($extra -contains $b) { Write-Host "REFUSING: banned flag $b"; exit 4 } }
  $all = @('-s', $main) + $approved + $extra + @('--port', "$Port")
  Write-Host "launch: $py $($all -join ' ')"
  $p = Start-Process -FilePath $py -ArgumentList $all -WorkingDirectory $Root -RedirectStandardOutput $log -RedirectStandardError "$log.err" -PassThru -WindowStyle Hidden
  return @{ proc = $p; log = $log }
}

function Wait-Ready($log, $timeoutSec = 300) {
  $deadline = (Get-Date).AddSeconds($timeoutSec)
  while ((Get-Date) -lt $deadline) {
    try { $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/system_stats" -TimeoutSec 4 -UseBasicParsing; if ($r.StatusCode -eq 200) { return $true } } catch { }
    if ((Test-Path $log) -and (Select-String -Path $log -Pattern 'Traceback|Error' -Quiet -ErrorAction SilentlyContinue)) {
      Write-Host "  (log shows an error while waiting; continuing to poll)"
    }
    Start-Sleep -Seconds 3
  }
  return $false
}

function Stop-Comfy($proc) {
  # Best-effort kill, but VERIFY it: if the previous server survives, the next launch cannot bind
  # the port and the failure surfaces as a confusing Wait-Ready timeout in the NEXT config -
  # pointing the investigation at the wrong place. Report the real state instead.
  try {
    $kids = Get-CimInstance Win32_Process -Filter "ParentProcessId=$($proc.Id)" -ErrorAction SilentlyContinue
    foreach ($k in $kids) { Stop-Process -Id $k.ProcessId -Force -ErrorAction SilentlyContinue }
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
  } catch {
    Write-Host ("  [stop] kill raised: {0}" -f $_.Exception.Message)
  }
  Start-Sleep -Seconds 3
  $still = Get-Process -Id $proc.Id -ErrorAction SilentlyContinue
  if ($still) {
    Write-Host ("  [stop] !! pid {0} is STILL ALIVE after the stop attempt - the next config may fail to bind port {1}" -f $proc.Id, $Port)
    return $false
  }
  # also check the port is actually free
  $busy = $false
  try { $c = New-Object System.Net.Sockets.TcpClient; $c.Connect('127.0.0.1', $Port); $busy = $true; $c.Close() } catch { $busy = $false }
  if ($busy) { Write-Host ("  [stop] !! port {0} is STILL ACCEPTING CONNECTIONS after the stop attempt" -f $Port); return $false }
  Write-Host "  [stop] process gone and port free"
  return $true
}

# Two configurations: approved flags ON, and --fast-disk disabled (the A/B control).
$configs = @(
  @{ label='fastdisk_on';  extra=@() },
  @{ label='fastdisk_off'; extra=@('--disable-fast-disk') }
)

$summary = New-Object System.Collections.ArrayList

foreach ($c in $configs) {
  Write-Host ""
  Write-Host "======================== $($c.label) ========================"
  $h = Start-Comfy $c.extra $c.label
  $ready = Wait-Ready $h.log
  Write-Host "ready = $ready  (log: $($h.log))"

  if (-not $ready) {
    Write-Host "!! server did not become ready; tail:"
    if (Test-Path $h.log) { Get-Content $h.log -Tail 20 | ForEach-Object { "   $_" } }
    Stop-Comfy $h.proc
    [void]$summary.Add([pscustomobject]@{ config=$c.label; ready=$false; log=$h.log })
    continue
  }

  # ---- Phase A: idle baseline B0 (zero models loaded) ----
  Write-Host "-- measuring idle baseline B0 for $MeasureSeconds s --"
  $csv = Join-Path $OutDir "stage0_$($c.label).csv"
  & 'C:\ComfyUI\scripts\measure_resources.ps1' -FindComfy -DurationSec $MeasureSeconds -IntervalSec 5 -OutCsv $csv -Label $c.label 2>&1 |
    ForEach-Object { "   $_" }

  # ---- Phase B hook: the storage-policy line only exists after a model load ----
  $policy = ''
  if ($Phase -eq 'Load') {
    if (-not $PromptGraph -or -not (Test-Path $PromptGraph)) {
      Write-Host "!! Phase Load requires -PromptGraph <api json>; skipping the load portion"
    } else {
      Write-Host "-- submitting prompt graph: $PromptGraph --"
      $body = @{ prompt = (Get-Content -Raw $PromptGraph | ConvertFrom-Json) } | ConvertTo-Json -Depth 100 -Compress
      try {
        $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/prompt" -Method Post -Body $body -ContentType 'application/json' -TimeoutSec 60 -UseBasicParsing
        Write-Host "   /prompt -> $($resp.StatusCode)"
      } catch { Write-Host "   /prompt FAILED: $($_.Exception.Message)" }
      Start-Sleep -Seconds 10
      Write-Host "-- measuring under load for $MeasureSeconds s --"
      & 'C:\ComfyUI\scripts\measure_resources.ps1' -FindComfy -DurationSec $MeasureSeconds -IntervalSec 5 -OutCsv $csv -Label "$($c.label)_load" 2>&1 |
        ForEach-Object { "   $_" }
    }
  }

  # capture the storage policy line (VC-016 / V-009) if it appeared
  if (Test-Path $h.log) {
    $m = Select-String -Path $h.log -Pattern 'Model storage policy' | Select-Object -Last 1
    if ($m) { $policy = $m.Line.Trim(); Write-Host "STORAGE POLICY: $policy" }
    else { Write-Host "STORAGE POLICY: (not present in this log)" }
  }

  Stop-Comfy $h.proc
  [void]$summary.Add([pscustomobject]@{ config=$c.label; ready=$true; policy=$policy; log=$h.log; csv=$csv })
}

Write-Host ""
Write-Host "======================== STAGE-0 SUMMARY ========================"
$summary | Format-List
$summary | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $OutDir 'stage0_summary.json') -Encoding UTF8
Write-Host "written: $(Join-Path $OutDir 'stage0_summary.json')"
