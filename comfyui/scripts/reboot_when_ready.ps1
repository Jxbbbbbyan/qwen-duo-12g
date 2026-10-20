# reboot_when_ready.ps1 - reboot once the Qwen-Image 2.1 weights are fully downloaded
#
# WHY: the 32 GB pagefile was written to the registry, and pagefile changes only take effect on
# reboot. The user asked for that reboot to happen once the download is done, rather than at an
# arbitrary moment that would interrupt the transfer.
#
# SAFETY, in order of importance:
#   - It waits for EXACT byte counts, not "looks done", so a half-written file never triggers it.
#   - It always gives a grace window (default 60 s) so `shutdown /a` can abort it.
#   - It refuses to reboot if a fetch process is in the middle of a file? No - resume is safe, so it
#     does not wait for that; but it does log everything so the reason is never a mystery.
#   - Default lifetime is 24 h; after that it logs and exits WITHOUT rebooting rather than firing
#     hours later when everyone has forgotten it exists.
#
# Usage:
#   pwsh -File reboot_when_ready.ps1                   # watch and report ONLY (default, dry run)
#   pwsh -File reboot_when_ready.ps1 -ConfirmReboot    # actually schedule the reboot
#   shutdown /a                                        # abort a pending reboot
#
# SAFETY CHANGE: rebooting is now opt-IN via -ConfirmReboot. The original version rebooted by
# default and offered -NoReboot to opt out - unacceptable for a public repo, where the safe
# default must be "do not reboot someone else's machine".

param(
  [string]$Root = 'C:\ComfyUI',
  [int]$PollSec = 60,
  [int]$GraceSec = 60,
  [int]$MaxHours = 24,
  [switch]$WaitPatcher,
  [switch]$ConfirmReboot
)

$ErrorActionPreference = 'Continue'

# 校验参数，避免把"0 秒宽限"这种危险配置传下去 / validate so a 0-second grace window can't slip through
if ($GraceSec -lt 30) { throw "GraceSec must be >= 30 seconds (got $GraceSec); a shorter abort window is unsafe." }
if ($MaxHours -le 0) { throw "MaxHours must be positive (got $MaxHours)." }
$log = Join-Path $Root 'logs\reboot_when_ready.log'
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null

function Say($m) {
  $l = "{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m
  Write-Host $l
  Add-Content -Path $log -Value $l
}
function SizeOf($p) { if (Test-Path $p) { (Get-Item $p).Length } else { 0 } }

$stage = Join-Path $Root '_downloads'
$weights = @(
  @{ name = 'diffusion_models__qwen_image_2.1_turbo_int8_convrot.safetensors'; bytes = 7256787829 },
  @{ name = 'text_encoders__qwen3vl_8b_int8_convrot.safetensors';             bytes = 9350798360 },
  @{ name = 'vae__qwen_image_2.1_vae_bf16.safetensors';                       bytes = 675509688  }
)
$patcherPkg = 'C:\driver-patch\581.94-desktop-notebook-win10-win11-64bit-international-dch.hf.zip'

function WeightsComplete {
  foreach ($w in $weights) { if ((SizeOf (Join-Path $stage $w.name)) -ne $w.bytes) { return $false } }
  return $true
}
function PatcherComplete {
  if (-not (Test-Path $patcherPkg)) { return $false }
  Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue
  try {
    $z = [System.IO.Compression.ZipFile]::OpenRead($patcherPkg); $n = $z.Entries.Count; $z.Dispose()
    return ($n -gt 0)
  } catch { return $false }
}

Say ("=== reboot_when_ready armed (WaitPatcher={0}, ConfirmReboot={1}, MaxHours={2}) ===" -f [bool]$WaitPatcher, [bool]$ConfirmReboot, $MaxHours)

$deadline = (Get-Date).AddHours($MaxHours)
while ((Get-Date) -lt $deadline) {
  $wOk = WeightsComplete
  $pOk = PatcherComplete
  if ($wOk -and (-not $WaitPatcher -or $pOk)) {
    Say ("READY: weights={0} patcher={1}" -f $wOk, $pOk)
    if (-not $ConfirmReboot) { Say "DRY RUN: -ConfirmReboot not specified -> NOT rebooting"; exit 0 }
    Say ("issuing reboot in {0}s (abort with: shutdown /a)" -f $GraceSec)
    $r = shutdown.exe /r /t $GraceSec /c "Pagefile 32GB takes effect; downloads resume at logon" 2>&1
    Say ("shutdown exit={0} out={1}" -f $LASTEXITCODE, ($r -join ' '))
    if ($LASTEXITCODE -ne 0) {
      Say "reboot command failed - trying without the comment"
      shutdown.exe /r /t $GraceSec 2>&1 | ForEach-Object { Say ("  " + $_) }
      Say ("retry exit={0}" -f $LASTEXITCODE)
    }
    exit 0
  }
  Start-Sleep -Seconds $PollSec
}

Say "=== gave up after $MaxHours h WITHOUT rebooting (weights=$wOk patcher=$pOk) ==="
exit 2
