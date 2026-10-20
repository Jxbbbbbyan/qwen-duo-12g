# run_unattended.ps1 - loop advance_pipeline.ps1 forever so a multi-day download never idles
#
# WHY: advance_pipeline.ps1 is a SINGLE PASS. Nothing else guarantees that pass happens at the moment
# the archive finishes - and that moment is exactly when the ~40 hour weight download should begin.
# Missing it by an hour is an hour lost on the critical path; missing it overnight is worse because
# the machine sits idle with a fully downloaded archive and no download running.
#
# This is meant to be started DETACHED (Start-Process -WindowStyle Hidden) so it survives this
# session. It is safe to start more than once: advance_pipeline.ps1 only ever starts a fetcher that
# is not already alive, so duplicate loops cannot produce duplicate downloads. If you are unsure
# whether it is running, just start it again.
#
# Logs: C:\ComfyUI\logs\advance_pipeline.log   (one block per pass)

param(
  [int]$IntervalSec = 600,
  [string]$Root = 'C:\ComfyUI'
)

$ErrorActionPreference = 'Continue'
$script = Join-Path $Root 'scripts\advance_pipeline.ps1'
$pwshPath = (Get-Command pwsh).Source

while ($true) {
  try {
    & $pwshPath -NoProfile -ExecutionPolicy Bypass -File $script 2>&1 | Out-Null
  } catch {
    # never let one bad pass kill the loop; advance_pipeline logs its own detail
  }
  Start-Sleep -Seconds $IntervalSec
}
