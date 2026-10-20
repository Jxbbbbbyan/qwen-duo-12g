# fetch_models.ps1 - download the Qwen-Image 2.1 int8_convrot weights
# Plan: dsh-plans/2026-10-16-qwen-image-21-local-deploy/PLAN_v3.md  (item I-004, and I-013)
#
# Default: downloads ONLY the Turbo-path three-file set (17,283,095,837 B total).
# The base DiT (7,256,783,064 B) is item I-013 and is CONDITIONAL on I-012 passing, so it is
# OPT-IN via -IncludeBaseDit and MUST NOT be fetched otherwise. It used to have NO fetcher at
# all - place_models.ps1 was ready to place it while nothing could obtain it, and no script
# carried its SHA256 - so the conditional item was unimplementable. Fixed here.
# bf16 weights and the prompt-enhancer (PE) files are PROHIBITED (NG-007).
#
# -ListOnly prints the effective manifest and downloads nothing (safe to run any time).

param(
  [switch]$IncludeBaseDit,
  [switch]$ListOnly
)
#
# Same --max-time watchdog as fetch_comfy.ps1, for the same measured reason:
# a long-lived connection decays (19.9 KB/s) while a fresh one sustains 78-107 KB/s.

$ErrorActionPreference = 'Continue'
$stage = 'C:\ComfyUI\_downloads'
$log   = 'C:\ComfyUI\logs\fetch_models.log'

New-Item -ItemType Directory -Force -Path $stage | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null

function Say($m) {
  $line = "{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m
  Write-Output $line
  Add-Content -Path $log -Value $line
}
function SizeOf($p) { if (Test-Path $p) { (Get-Item $p).Length } else { 0 } }

# E-EXT-003: exact bytes + FULL SHA256 (verified against HF LFS sha256).
$files = @(
  [pscustomobject]@{ rel='diffusion_models/qwen_image_2.1_turbo_int8_convrot.safetensors'; bytes=7256787829; sha='8144a0182964aa8403ad6dbc011db837304167d235161b9aabaa8532e967314c' },
  [pscustomobject]@{ rel='text_encoders/qwen3vl_8b_int8_convrot.safetensors';            bytes=9350798360; sha='8bfd0f6e12abf2d2d697ecc888e5e90b0d6741d6708f05799f53afa560452e8f' },
  [pscustomobject]@{ rel='vae/qwen_image_2.1_vae_bf16.safetensors';                     bytes=675509688;  sha='bb21f7473051e1ac368515dd3f2e15cd44d7a11748ee8823e1ddca3e4876b7c9' }
)

# I-013: the base DiT, for the 25-step quality comparison. OPT-IN ONLY - the plan makes it
# conditional on I-012 passing, so it must never be fetched by default.
if ($IncludeBaseDit) {
  $files += [pscustomobject]@{ rel='diffusion_models/qwen_image_2.1_int8_convrot.safetensors'; bytes=7256783064; sha='cb74113cb03faecd79611b01fd7fd642f0aa60d6f0b95086abee214d75eaa57d' }
}

if ($ListOnly) {
  Write-Output ("manifest ({0} file(s), {1:N0} B):" -f $files.Count, (($files | Measure-Object bytes -Sum).Sum))
  foreach ($f in $files) {
    Write-Output ("  {0,-64} {1,15:N0} B" -f $f.rel, $f.bytes)
    Write-Output ("  {0,-64} sha256 {1}" -f '', $f.sha)
  }
  Write-Output "  -ListOnly: nothing downloaded."
  exit 0
}

function Sources($rel) {
  $enc = [uri]::EscapeDataString($rel)
  @(
    @{ name='modelscope'; url="https://modelscope.cn/api/v1/models/Comfy-Org/Qwen-Image-2.1/repo?Revision=master&FilePath=$enc" },
    @{ name='hf-mirror';  url="https://hf-mirror.com/Comfy-Org/Qwen-Image-2.1/resolve/main/$rel" }
  )
}

$totalWant = ($files | Measure-Object bytes -Sum).Sum
Say ("=== fetch_models.ps1 start : {0} file(s), {1:N0} B expected   {2}===" -f $files.Count, $totalWant, $(if ($IncludeBaseDit) { '[I-013 base DiT INCLUDED]' } else { '[Turbo set only - base DiT is opt-in via -IncludeBaseDit]' }))

foreach ($f in $files) {
  $dest = Join-Path $stage ($f.rel -replace '/', '__')
  Say "--- $($f.rel)  (expected $($f.bytes) B) -> $dest"

  foreach ($s in (Sources $f.rel)) {
    $have = SizeOf $dest
    if ($have -eq $f.bytes) { break }
    Say "  source $($s.name) (resuming from $have B)"

    $stall = 0; $round = 0
    while ($true) {
      $round++
      $have = SizeOf $dest
      if ($have -eq $f.bytes) { break }
      if ($have -gt $f.bytes) { Say "  !! oversize; restarting"; Remove-Item $dest -Force; $have = 0 }

      curl.exe -sS -L --retry 2 --retry-delay 3 --retry-all-errors --max-time 90 -C - -o "$dest" "$($s.url)" 2>&1 |
        ForEach-Object { if ($_ -match '\S') { Add-Content -Path $log -Value ("  curl: " + $_) } }

      $now = SizeOf $dest
      $grew = $now - $have
      if ($round % 40 -eq 0) { Say ("    [{0} round {1}] {2:N0} / {3:N0} B ({4:N2}%)" -f $s.name, $round, $now, $f.bytes, ($now/$f.bytes*100)) }

      if ($grew -le 0) { $stall++ } else { $stall = 0 }
      if ($stall -ge 3) { Say "    no progress - trying next source"; break }
      Start-Sleep -Seconds 2
    }
  }

  $fin = SizeOf $dest
  if ($fin -eq $f.bytes) {
    Say "  size OK. hashing ..."
    $h = (Get-FileHash -Path $dest -Algorithm SHA256).Hash.ToLower()
    if ($h -eq $f.sha) {
      Say "  SHA256 OK  $h"
    } else {
      Say "  !! SHA256 MISMATCH got=$h want=$($f.sha)"
      # 失败关闭：已知损坏的文件不能被下游当作"就绪" / fail closed: a known-bad file must not be
      # treated as ready downstream. Delete it and re-run to fetch a clean copy.
      throw "SHA256 mismatch for $($f.rel) - refusing to continue (fail closed)."
    }
  } else {
    Say "  !! INCOMPLETE: $($f.rel)  ($fin / $($f.bytes) B)"
  }
}
Say "=== fetch_models.ps1 done ==="
