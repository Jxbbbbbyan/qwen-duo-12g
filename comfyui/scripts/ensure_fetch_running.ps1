# ensure_fetch_running.ps1 - keep the weight/portable download alive across session boundaries
#
# WHY: the fetch scripts are idempotent and resume-safe, but NOTHING restarts them if the
# process dies (session end, crash, OOM). On a multi-day download that is the difference
# between finishing and silently stalling. Run this whenever the session wakes up.
#
# It is safe to run repeatedly: it only acts when the target file is incomplete AND no
# fetch process is alive.

param(
  [string]$Root = 'C:\ComfyUI'
)

$ErrorActionPreference = 'Continue'

$jobs = @(
  @{ name='portable'; script="$Root\scripts\fetch_comfy.ps1"; file="$Root\ComfyUI_windows_portable_nvidia.7z"; bytes=2010075321 },
  @{ name='weights';  script="$Root\scripts\fetch_models.ps1"; file=''; bytes=0 }
)

function FetcherAlive([string]$scriptName) {
  # Match the -File argument specifically AND exclude this process.
  # Why: a plain `CommandLine -match 'fetch_comfy.ps1'` also matches ANY shell whose command line
  # merely MENTIONS that name - including a diagnostic one-liner, or this watchdog itself if it were
  # invoked with the name in its arguments. That produced a real self-inflicted kill during
  # development (a Stop-Process filtered the same way terminated the very shell running it), and the
  # read-only variant of the same mistake would make this watchdog believe a fetcher is alive when
  # none is, so it would never restart a dead download.
  #
  # That second half was PREDICTED in this very comment and left unfixed for several rounds; it was
  # then observed live (status.ps1 reported fetch_models.ps1 ALIVE while nothing was running, because
  # the harness runs our commands as `pwsh -Command "<whole script text>"` and the parent shell's
  # command line merely mentioned the name). The -Command exclusion below closes it. Every legitimate
  # launch in this toolchain uses Start-Process with -File and no -Command.
  $me = $PID
  $p = Get-CimInstance Win32_Process -Filter "Name='pwsh.exe'" -ErrorAction SilentlyContinue |
       Where-Object { $_.ProcessId -ne $me -and $_.CommandLine -and
                      $_.CommandLine -notmatch '-Command|-EncodedCommand' -and
                      $_.CommandLine -match ('-File\s+\S*' + [regex]::Escape($scriptName)) }
  return ($null -ne $p)
}

Write-Host "=== ensure_fetch_running  @ $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ==="

foreach ($j in $jobs) {
  if ($j.name -eq 'weights') {
    # the weights job is started manually after the portable is extracted; do not auto-start it
    $alive = FetcherAlive 'fetch_models.ps1'
    Write-Host ("  weights : {0}" -f $(if ($alive) { 'running' } else { 'not running (started manually after I-002)' }))
    continue
  }

  $sz = if (Test-Path $j.file) { (Get-Item $j.file).Length } else { 0 }
  $pct = if ($j.bytes -gt 0) { [math]::Round($sz / $j.bytes * 100, 3) } else { 0 }
  $alive = FetcherAlive 'fetch_comfy.ps1'

  Write-Host ("  {0,-9}: {1:N0} / {2:N0} B = {3}%   process alive = {4}" -f $j.name, $sz, $j.bytes, $pct, $alive)

  if ($sz -eq $j.bytes) {
    Write-Host "             COMPLETE -> next: pwsh -File $Root\scripts\post_download.ps1"
  } elseif (-not $alive) {
    Write-Host "             NOT complete and NOT running -> restarting"
    $pwshPath = (Get-Command pwsh).Source
    $p = Start-Process -FilePath $pwshPath `
         -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',$j.script `
         -WindowStyle Hidden -PassThru
    Write-Host ("             restarted as pid {0} (resumes from {1:N0} B)" -f $p.Id, $sz)
  } else {
    $curl = Get-Process curl -ErrorAction SilentlyContinue
    Write-Host ("             alive; curl processes = {0}" -f $(if ($curl) { ($curl | Measure-Object).Count } else { 0 }))
  }
}

Write-Host ""
Write-Host "--- last 4 log lines ---"
$lg = Join-Path $Root 'logs\fetch_comfy.log'
if (Test-Path $lg) { Get-Content $lg -Tail 4 | ForEach-Object { Write-Host ("  " + $_) } }
