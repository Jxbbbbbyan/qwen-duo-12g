# post_boot_resume.ps1 - registered in the Startup folder so a reboot never strands the deployment
#
# WHY: nothing on this machine auto-starts. Before this script existed, a reboot would have left the
# weight download stopped, the pipeline frozen, and the patched-driver download unstarted - exactly
# the silent-stall failure that already cost a full day earlier in this project.
#
# BEHAVIOUR:
#   - If everything is already downloaded (weights + patcher), it removes its own Startup shortcut
#     and exits, so it does not linger forever.
#   - Otherwise it resumes the download (idempotent) and restarts the stage advancer.
#
# It deliberately does NOT start llama-server: that occupies 11.4 GiB of VRAM and would collide with
# ComfyUI. Starting the model is a decision for the user, not something a boot script should assume.

$Root = 'C:\ComfyUI'
$log  = Join-Path $Root 'logs\post_boot_resume.log'
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null

function Say($m) {
  $l = "{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m
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

Say "=== post_boot_resume start ==="

$wOk = WeightsComplete
$pOk = PatcherComplete
Say ("weights complete = {0} ; patcher complete = {1}" -f $wOk, $pOk)

if ($wOk -and $pOk) {
  Say "everything is already downloaded -> removing the Startup shortcut and exiting"
  $startup = [Environment]::GetFolderPath('Startup')
  $cmd = Join-Path $startup 'resume-qwen-download.cmd'
  if (Test-Path $cmd) { Remove-Item $cmd -Force -ErrorAction SilentlyContinue; Say "removed $cmd" }
  exit 0
}

# 1) resume the weight download if needed (idempotent: it only acts when incomplete and not running)
if (-not $wOk) {
  Say "running ensure_fetch_running.ps1"
  & pwsh -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root 'scripts\ensure_fetch_running.ps1') *>&1 |
    ForEach-Object { Say ("  | " + $_) }
} else {
  Say "weights already complete -> patcher handled by the advancer"
}

# 2) restart the stage advancer so S5 (patcher) is reached automatically
$alive = Get-CimInstance Win32_Process -Filter "Name='pwsh.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine -notmatch '-Command|-EncodedCommand' -and $_.CommandLine -match '-File\s+\S*run_unattended\.ps1' }
if ($alive) {
  Say "run_unattended.ps1 already running -> nothing to do"
} else {
  Say "starting run_unattended.ps1"
  Start-Process -FilePath (Get-Command pwsh).Source `
    -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $Root 'scripts\run_unattended.ps1') `
    -WindowStyle Hidden
}

Say "=== post_boot_resume done ==="
exit 0
