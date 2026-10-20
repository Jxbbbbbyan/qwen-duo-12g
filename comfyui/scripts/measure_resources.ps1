# measure_resources.ps1 - the measurement instrument for PLAN_v3.md
#   required by VC-009 / VC-017 (items I-008 and I-012)
#
# It implements the definition frozen in R-010 of PLAN_v3.md:
#
#   "Weights reside in system RAM"  ==  the ComfyUI process's COMMITTED/ANONYMOUS memory
#   (\Process(...)\Private Bytes) or its GPU SHARED memory
#   (\GPU Process Memory(...)\Shared Usage) grows with the size of the weights.
#   mmap'd FILE-BACKED pages counted in the standby cache are NOT a violation
#   (they are immediately reclaimable and are not commit).
#
# So the primary metrics are Private Bytes and GPU Shared Usage. Working Set is recorded
# for context ONLY - it includes file-backed pages and would produce false positives.
#
# The verdict is expressed as a DELTA against the idle baseline B0 (not an absolute),
# because Python + torch + the CUDA context already consume several GB before any weights load
# (that was criticizer question CQ3).
#
# Usage:
#   pwsh -File measure_resources.ps1 -FindComfy -BaselineSeconds 0 -DurationSec 300
#   pwsh -File measure_resources.ps1 -ProcessName msedge -DurationSec 10 -IntervalSec 2

param(
  [string]$ProcessName = 'python',
  [switch]$FindComfy,
  [int]$DurationSec = 300,
  [int]$IntervalSec = 5,
  [string]$OutCsv = 'C:\ComfyUI\logs\resources.csv',
  [string]$Label = 'run'
)

$ErrorActionPreference = 'Continue'
New-Item -ItemType Directory -Force -Path (Split-Path $OutCsv) | Out-Null

function Resolve-Target {
  $procs = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue
  if (-not $procs) { return $null }
  if (-not $FindComfy) { return ($procs | Sort-Object WorkingSet64 -Descending | Select-Object -First 1) }
  foreach ($p in $procs) {
    $ci = Get-CimInstance Win32_Process -Filter "ProcessId=$($p.Id)" -ErrorAction SilentlyContinue
    if ($ci -and $ci.CommandLine -and $ci.CommandLine -match 'ComfyUI' -and $ci.CommandLine -match 'main\.py') { return $p }
  }
  return $null
}

function Sample-GpuShared($procId) {
  # Returns $null when the counter could NOT be read - NEVER 0.0. Returning 0.0 on failure would
  # read as "used no shared GPU memory", i.e. a FALSE PASS for VC-009/VC-017 - exactly the
  # "green while failing" class the criticizer raised as CQ2. "not measured" != "measured zero".
  $sum = 0.0; $any = $false
  try {
    $s = Get-Counter -Counter "\GPU Process Memory(pid_$procId*)\Shared Usage" -ErrorAction Stop |
         Select-Object -ExpandProperty CounterSamples
    foreach ($x in $s) { $any = $true; if ($x.CookedValue -gt 0) { $sum += $x.CookedValue } }
  } catch { return $null }
  if (-not $any) { return $null }
  return $sum
}

function Sample-GpuDedicated($procId) {
  $sum = 0.0; $any = $false
  try {
    $s = Get-Counter -Counter "\GPU Process Memory(pid_$procId*)\Dedicated Usage" -ErrorAction Stop |
         Select-Object -ExpandProperty CounterSamples
    foreach ($x in $s) { $any = $true; if ($x.CookedValue -gt 0) { $sum += $x.CookedValue } }
  } catch { return $null }
  if (-not $any) { return $null }
  return $sum
}

function Sample-System {
  $r = [ordered]@{ availMB = $null; pagesIn = $null; committedMB = $null }
  try {
    $s = Get-Counter -Counter '\Memory\Available MBytes','\Memory\Pages Input/sec','\Memory\Committed Bytes' -ErrorAction Stop |
         Select-Object -ExpandProperty CounterSamples
    foreach ($x in $s) {
      switch -Regex ($x.Path) {
        'available mbytes'  { $r.availMB     = [math]::Round($x.CookedValue,1) }
        'pages input/sec'   { $r.pagesIn     = [math]::Round($x.CookedValue,2) }
        'committed bytes'   { $r.committedMB = [math]::Round($x.CookedValue/1MB,1) }
      }
    }
  } catch { }
  return [pscustomobject]$r
}

function Sample-GpuTotal {
  try {
    $o = & nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits 2>$null
    if ($o) { return [int]($o | Select-Object -First 1) }
  } catch { }
  return $null
}

Write-Output "=== measure_resources.ps1  label=$Label ==="
$t = Resolve-Target
if (-not $t) {
  Write-Output "FAIL: no target process found (name='$ProcessName', FindComfy=$FindComfy)"
  Write-Output "      Pass -FindComfy once ComfyUI is running, or -ProcessName <name>."
  exit 2
}
Write-Output "target: $($t.ProcessName) pid=$($t.Id)"
Write-Output "metrics per R-010: PrivateBytes (primary), GpuShared (primary), WorkingSet (context), PagesIn, AvailMB, GpuTotal"
Write-Output ""

$rows = New-Object System.Collections.ArrayList
$deadline = (Get-Date).AddSeconds($DurationSec)
$i = 0
$missGpuShared = 0; $missGpuDed = 0; $missSys = 0
while ((Get-Date) -lt $deadline) {
  $i++
  $p = Get-Process -Id $t.Id -ErrorAction SilentlyContinue
  if (-not $p) { Write-Output "process exited at sample $i"; break }

  $sys = Sample-System
  $gs  = Sample-GpuShared $t.Id
  $gd  = Sample-GpuDedicated $t.Id
  if ($null -eq $gs) { $missGpuShared++ }
  if ($null -eq $gd) { $missGpuDed++ }
  if ($null -eq $sys.availMB) { $missSys++ }

  $row = [pscustomobject]@{
    t          = (Get-Date).ToString('HH:mm:ss')
    label      = $Label
    pid        = $t.Id
    privateMB  = [math]::Round($p.PrivateMemorySize64/1MB,1)
    workingMB  = [math]::Round($p.WorkingSet64/1MB,1)
    gpuSharedMB= $(if ($null -eq $gs) { $null } else { [math]::Round($gs/1MB,2) })
    gpuDedMB   = $(if ($null -eq $gd) { $null } else { [math]::Round($gd/1MB,2) })
    availMB    = $sys.availMB
    pagesIn    = $sys.pagesIn
    gpuTotalMB = Sample-GpuTotal
  }
  [void]$rows.Add($row)
  Write-Output ("[{0,3}] {1}  private={2,9:N1} MB  gpuShared={3}  gpuDed={4}  working={5,9:N1} MB  avail={6,7} MB  pagesIn={7}" -f `
    $i, $row.t, $row.privateMB,
    $(if ($null -eq $row.gpuSharedMB) { '  NOT-MEASURED' } else { ('{0,7:N2} MB' -f $row.gpuSharedMB) }),
    $(if ($null -eq $row.gpuDedMB)    { 'NOT-MEASURED' } else { ('{0,7:N2} MB' -f $row.gpuDedMB) }),
    $row.workingMB,
    $(if ($null -eq $row.availMB) { 'NOT-MEAS' } else { ('{0,7:N0}' -f $row.availMB) }),
    $(if ($null -eq $row.pagesIn) { 'NOT-MEAS' } else { ('{0,7:N1}' -f $row.pagesIn) }))
  Start-Sleep -Seconds $IntervalSec
}

if ($rows.Count -eq 0) { Write-Output "no samples collected"; exit 3 }

$rows | Export-Csv -Path $OutCsv -NoTypeInformation -Append -Encoding UTF8

$first = $rows[0]; $last = $rows[$rows.Count-1]
function Peak($col) {
  $vals = @($rows | ForEach-Object { $_.$col } | Where-Object { $null -ne $_ })
  if ($vals.Count -eq 0) { return $null }
  return ($vals | Measure-Object -Maximum).Maximum
}
function MinOf($col) {
  $vals = @($rows | ForEach-Object { $_.$col } | Where-Object { $null -ne $_ })
  if ($vals.Count -eq 0) { return $null }
  return ($vals | Measure-Object -Minimum).Minimum
}
function Fmt($v, $fmt) { if ($null -eq $v) { return 'NOT MEASURED' } else { return ($fmt -f $v) } }

$peakPrivate = Peak 'privateMB'
$peakShared  = Peak 'gpuSharedMB'
$peakDed     = Peak 'gpuDedMB'
$peakWorking = Peak 'workingMB'
$minAvail    = MinOf 'availMB'
$maxPagesIn  = Peak 'pagesIn'
$peakGpuTot  = Peak 'gpuTotalMB'

Write-Output ""
Write-Output "=== INSTRUMENT AVAILABILITY (a metric that could not be read is NOT the same as zero) ==="
Write-Output ("  GpuShared    : {0} of {1} samples readable{2}" -f ($rows.Count - $missGpuShared), $rows.Count, $(if ($missGpuShared -gt 0) { "  <-- $missGpuShared FAILED" } else { '' }))
Write-Output ("  GpuDedicated : {0} of {1} samples readable{2}" -f ($rows.Count - $missGpuDed), $rows.Count, $(if ($missGpuDed -gt 0) { "  <-- $missGpuDed FAILED" } else { '' }))
Write-Output ("  SystemMemory : {0} of {1} samples readable{2}" -f ($rows.Count - $missSys), $rows.Count, $(if ($missSys -gt 0) { "  <-- $missSys FAILED" } else { '' }))
Write-Output ""

Write-Output "=== SUMMARY  (label=$Label, $($rows.Count) samples) ==="
Write-Output ("  PrivateBytes   first={0}   last={1}   peak={2}" -f (Fmt $first.privateMB '{0:N1} MB'), (Fmt $last.privateMB '{0:N1} MB'), (Fmt $peakPrivate '{0:N1} MB'))
Write-Output ("  GpuShared      first={0}   last={1}   peak={2}" -f (Fmt $first.gpuSharedMB '{0:N2} MB'), (Fmt $last.gpuSharedMB '{0:N2} MB'), (Fmt $peakShared '{0:N2} MB'))
Write-Output ("  GpuDedicated   peak={0}" -f (Fmt $peakDed '{0:N2} MB'))
Write-Output ("  WorkingSet     peak={0}   (context only - includes file-backed pages)" -f (Fmt $peakWorking '{0:N1} MB'))
Write-Output ("  AvailMB        first={0}   min={1}" -f (Fmt $first.availMB '{0:N0}'), (Fmt $minAvail '{0:N0}'))
Write-Output ("  PagesIn/sec    peak={0}     (hard-fault signal)" -f (Fmt $maxPagesIn '{0:N1}'))
Write-Output ("  GPU total used peak={0}" -f (Fmt $peakGpuTot '{0} MB'))
Write-Output ""
Write-Output "  verdict rule (VC-017): loading the 8.71 GiB text encoder must NOT raise"
Write-Output "  PrivateBytes or GpuShared by anything close to 1 GiB. Rows: $OutCsv"

# A PRIMARY instrument that never produced a reading makes VC-009/VC-017 UNEVALUABLE. Say so with a
# distinct exit code instead of letting a missing measurement masquerade as a clean result.
$primaryMissing = @()
if ($peakPrivate -eq $null) { $primaryMissing += 'PrivateBytes' }
if ($peakShared  -eq $null) { $primaryMissing += 'GpuShared' }
if ($primaryMissing.Count -gt 0) {
  Write-Output ""
  Write-Output ("  !! UNEVALUABLE: primary instrument(s) never produced a reading: {0}" -f ($primaryMissing -join ', '))
  Write-Output "     VC-009 / VC-017 CANNOT be judged from this run. Do not record it as a pass."
  exit 5
}
exit 0
