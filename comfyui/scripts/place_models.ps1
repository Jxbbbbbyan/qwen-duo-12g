# place_models.ps1 - item I-005 of PLAN_v3.md
#
# Moves the verified weight files from the staging area (C:\ComfyUI\_downloads\) into the
# portable's model directories, mapping by the path prefix recorded at download time, and
# re-asserts the exact byte count from E-EXT-003 for each file.
#
# Why copy-then-delete instead of move: a move interrupted mid-file can leave neither a
# complete source nor a complete destination. Copy + verify + delete is recoverable.
#
# Expected E-EXT-003 byte counts (live-verified against ModelScope on 2026-10-16):
#   diffusion_models/qwen_image_2.1_turbo_int8_convrot.safetensors  7,256,787,829
#   diffusion_models/qwen_image_2.1_int8_convrot.safetensors        7,256,783,064   (I-013, conditional)
#   text_encoders/qwen3vl_8b_int8_convrot.safetensors               9,350,798,360
#   vae/qwen_image_2.1_vae_bf16.safetensors                           675,509,688

param(
  [string]$Stage = 'C:\ComfyUI\_downloads',
  [string]$ComfyRoot = 'C:\ComfyUI\ComfyUI_windows_portable\ComfyUI',
  [switch]$KeepSource
)

$ErrorActionPreference = 'Continue'

$expect = @{
  'diffusion_models__qwen_image_2.1_turbo_int8_convrot.safetensors' = @{ dest='models\diffusion_models\qwen_image_2.1_turbo_int8_convrot.safetensors'; bytes=7256787829 }
  'diffusion_models__qwen_image_2.1_int8_convrot.safetensors'       = @{ dest='models\diffusion_models\qwen_image_2.1_int8_convrot.safetensors';       bytes=7256783064 }
  'text_encoders__qwen3vl_8b_int8_convrot.safetensors'              = @{ dest='models\text_encoders\qwen3vl_8b_int8_convrot.safetensors';              bytes=9350798360 }
  'vae__qwen_image_2.1_vae_bf16.safetensors'                        = @{ dest='models\vae\qwen_image_2.1_vae_bf16.safetensors';                        bytes=675509688  }
}

if (-not (Test-Path $Stage)) { Write-Host "FAIL: staging dir not found: $Stage"; exit 2 }
if (-not (Test-Path $ComfyRoot)) { Write-Host "FAIL: ComfyUI root not found: $ComfyRoot (I-002 not done?)"; exit 2 }

Write-Host "=== place_models.ps1 : $Stage -> $ComfyRoot ==="
$ok = 0; $bad = 0; $missing = 0

foreach ($k in $expect.Keys) {
  $src = Join-Path $Stage $k
  $info = $expect[$k]
  $dst = Join-Path $ComfyRoot $info.dest
  $dstDir = Split-Path $dst -Parent

  if (-not (Test-Path $src)) { Write-Host "  MISSING  $k  (not downloaded yet)"; $missing++; continue }
  $sz = (Get-Item $src).Length
  if ($sz -ne $info.bytes) {
    Write-Host ("  BAD SIZE {0}  got {1:N0} expected {2:N0}" -f $k, $sz, $info.bytes); $bad++; continue
  }

  New-Item -ItemType Directory -Force -Path $dstDir | Out-Null
  if ((Test-Path $dst) -and ((Get-Item $dst).Length -eq $info.bytes)) {
    Write-Host "  already placed: $($info.dest)"
  } else {
    Copy-Item -LiteralPath $src -Destination $dst -Force
  }

  $dsz = if (Test-Path $dst) { (Get-Item $dst).Length } else { -1 }
  if ($dsz -eq $info.bytes) {
    Write-Host ("  OK       {0,-58} {1,15:N0} B" -f $info.dest, $dsz)
    $ok++
    # 只在目标与源"完全相同"时才删源：仅比字节数会让同尺寸的坏副本毁掉好源
    # Delete the source only when the destination is IDENTICAL, not merely the same size:
    # a same-size corrupt copy must never destroy the good source.
    if (-not $KeepSource) {
      # 失败关闭 / fail closed：任何一次哈希读取失败都保留源文件。
      # 之前两次都失败时 $hs 与 $hd 同时为 $null，$hs -eq $hd 为真，会在"完全没验证"的情况下删源。
      # If either read fails the hash is $null; two $nulls compare equal, which would delete the
      # source having verified nothing. Require both hashes to exist AND match.
      $hs = $null; $hd = $null
      try { $hs = (Get-FileHash -LiteralPath $src -Algorithm SHA256 -ErrorAction Stop).Hash } catch { $hs = $null }
      try { $hd = (Get-FileHash -LiteralPath $dst -Algorithm SHA256 -ErrorAction Stop).Hash } catch { $hd = $null }
      if ($hs -and $hd -and ($hs -eq $hd)) {
        Remove-Item -LiteralPath $src -Force -ErrorAction SilentlyContinue
      } elseif ($hs -and $hd) {
        Write-Host ("  SOURCE KEPT  {0}  (SHA256 differs between source and destination)" -f $info.dest)
      } else {
        Write-Host ("  SOURCE KEPT  {0}  (could not hash both files - keeping the source)" -f $info.dest)
      }
    }
  } else {
    Write-Host ("  COPY MISMATCH {0}  dest={1}" -f $info.dest, $dsz); $bad++
  }
}

Write-Host ""
Write-Host "=== RESULT: placed=$ok  bad=$bad  not-yet-downloaded=$missing ==="

Write-Host ""
Write-Host "=== final layout under $ComfyRoot\models ==="
foreach ($sub in @('diffusion_models','text_encoders','vae')) {
  $d = Join-Path $ComfyRoot "models\$sub"
  if (Test-Path $d) {
    $files = Get-ChildItem $d -File -ErrorAction SilentlyContinue
    Write-Host "  models\$sub : $($files.Count) file(s)"
    $files | ForEach-Object { Write-Host ("     {0,-58} {1,15:N0} B" -f $_.Name, $_.Length) }
  } else { Write-Host "  models\$sub : (absent)" }
}

if ($bad -gt 0) { exit 3 }
if ($missing -gt 0) { exit 4 }
exit 0
