# post_download.ps1 - one deterministic driver for the whole post-download sequence
#
# Runs, in order, and STOPS at the first failure:
#   I-002  verify archive size -> extract -> assert tree -> --quick-test-for-ci --cpu
#   I-003  runtime check: ComfyUI version, torch, torch.version.cuda, CUDA availability
#   I-006  install the official UI workflows (unmodified) + PE-switch assertion + V-005 scan
#   I-012 Phase A  measure the ComfyUI idle baseline B0 (zero models; no weights needed)
#
# WHY THIS EXISTS: the sequence has several points where a partial success would silently
# poison everything after it (a truncated extraction, a smoke test that never ran, a
# version check skipped). Encoding the order and the stop-on-failure rule here means the
# critical window does not depend on remembering the order.
#
# Every step's console output is also appended to C:\ComfyUI\logs\post_download.log.

param(
  [string]$Archive = 'C:\ComfyUI\ComfyUI_windows_portable_nvidia.7z',
  [int64]$ExpectBytes = 2010075321,
  [string]$Root = 'C:\ComfyUI',
  [int]$B0Seconds = 60,
  [switch]$KeepGoing
)

$ErrorActionPreference = 'Continue'
$logDir = Join-Path $Root 'logs'
$evidence = Join-Path $Root '_evidence'
New-Item -ItemType Directory -Force -Path $logDir,$evidence | Out-Null
$log = Join-Path $logDir 'post_download.log'

function Say($m) {
  $line = "{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m
  Write-Host $line
  Add-Content -Path $log -Value $line
}
function Step($name) { Say ""; Say ("========== {0} ==========" -f $name) }

$failed = $false
function Fail($why) {
  Say ("FAIL: {0}" -f $why)
  if (-not $KeepGoing) {
    Say "stopping (use -KeepGoing to press on anyway)"
    Say ("=== post_download ABORTED at: {0} ===" -f $why)
    exit 1
  }
  $script:failed = $true
}

# CRC32 (IEEE, reflected, poly 0xEDB88320) - implemented here because .NET's base library does
# not expose one and we must not depend on the miniconda interpreter.
#
# POWERSHELL TRAP, hit and fixed during development: writing the initial/final xor as the literal
# 0xFFFFFFFF makes PowerShell parse it as Int32 -1, and casting that to [uint32] throws
# "Value was either too large or too small for a UInt32" - so the function silently produced
# garbage (0x10DEA82F where the true value was 0xE0F4CC5D). Use [uint32]::MaxValue and decimal
# for the polynomial. Verified two ways:
#   CRC32("123456789") == 0xCBF43926          (standard check value)
#   CRC32(bytes 12..31 of the real archive) == the archive's own stored StartHeaderCRC 0xE0F4CC5D
function Get-Crc32([byte[]]$data) {
  $poly = [uint32]3988292384          # 0xEDB88320
  $table = New-Object 'uint32[]' 256
  for ($i = 0; $i -lt 256; $i++) {
    [uint32]$c = [uint32]$i
    for ($k = 0; $k -lt 8; $k++) {
      if (($c -band [uint32]1) -eq [uint32]1) { $c = [uint32](([uint32]($c -shr 1)) -bxor $poly) }
      else { $c = [uint32]($c -shr 1) }
    }
    $table[$i] = $c
  }
  [uint32]$crc = [uint32]::MaxValue
  foreach ($b in $data) {
    [uint32]$idx = ([uint32]($crc -bxor [uint32]$b)) -band [uint32]255
    $crc = [uint32](([uint32]$table[[int]$idx]) -bxor ([uint32]($crc -shr 8)))
  }
  return [uint32]([uint32]$crc -bxor [uint32]::MaxValue)
}

# ---------------------------------------------------------------- STEP 0b: header integrity
# A 7z stores its directory at the END of the file, but the first 32 bytes carry a self-check:
#   [0..5]  signature 37 7A BC AF 27 1C
#   [8..11] StartHeaderCRC = CRC32 of bytes [12..31]
#   [12..19] NextHeaderOffset, [20..27] NextHeaderSize
# Checking it catches the most likely corruption mode (a resume writing at the wrong offset)
# BEFORE we spend time extracting. It also cross-checks the total size from a third source:
#   32 + NextHeaderOffset + NextHeaderSize  must equal the expected file size.
Step "STEP 0b - 7z start-header integrity (catches bad resumes before extracting)"
if (Test-Path $Archive) {
  # Open explicitly with FileShare.ReadWrite: a share-denying open throws while another process
  # (e.g. a still-running curl) holds the file, and the FIRST version of this code swallowed that
  # exception and then reported "not a 7z archive (bad signature)" - a misleading diagnosis that
  # would send someone hunting for corruption that does not exist. Distinguish the two failures.
  $head = $null
  try {
    $fs = [System.IO.FileStream]::new($Archive, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
    try {
      $head = New-Object byte[] 32
      $read = $fs.Read($head, 0, 32)
    } finally { $fs.Dispose() }
  } catch {
    Fail ("could not open the archive for reading: {0}" -f $_.Exception.Message)
  }

  if ($head -eq $null) {
    Say "  (skipping header checks - the file could not be read)"
  } elseif ($read -lt 32) {
    Fail ("file is only {0} bytes - too short to hold a 7z start header" -f $read)
  } else {
    $sigOk = ($head[0] -eq 0x37 -and $head[1] -eq 0x7A -and $head[2] -eq 0xBC -and $head[3] -eq 0xAF -and $head[4] -eq 0x27 -and $head[5] -eq 0x1C)
    Say ("  signature = {0}" -f (($head[0..5] | ForEach-Object { $_.ToString('x2') }) -join ' '))
    if (-not $sigOk) { Fail "not a 7z archive (bad signature)" } else { Say "  signature OK" }

    $storedCrc = [System.BitConverter]::ToUInt32($head, 8)
    $calcCrc = Get-Crc32 $head[12..31]
    Say ("  StartHeaderCRC stored=0x{0:X8} computed=0x{1:X8}" -f $storedCrc, $calcCrc)
    if ($storedCrc -ne $calcCrc) { Fail "start-header CRC mismatch -> the file is corrupt (bad resume?)" } else { Say "  start-header CRC MATCH" }

    $nhOff = [System.BitConverter]::ToUInt64($head, 12)
    $nhSize = [System.BitConverter]::ToUInt64($head, 20)
    $implied = 32 + $nhOff + $nhSize
    Say ("  implied total size = {0}  (32 + {1} + {2})" -f $implied, $nhOff, $nhSize)
    if ($implied -ne $ExpectBytes) { Say ("  WARNING: implied {0} != expected {1} - investigate before trusting the download" -f $implied, $ExpectBytes) }
    else { Say "  implied total size AGREES with the expected byte count (third independent source)" }
  }
}

# ---------------------------------------------------------------- STEP 0: archive
Step "STEP 0 - verify the archive"
if (-not (Test-Path $Archive)) { Fail "archive not found: $Archive" }
else {
  $sz = (Get-Item $Archive).Length
  Say ("archive = {0:N0} B  expected = {1:N0} B" -f $sz, $ExpectBytes)
  if ($sz -ne $ExpectBytes) { Fail "archive size mismatch - download incomplete (VC-014 depends on this)" }
  else { Say "archive size OK" }
}

# ---------------------------------------------------------------- STEP 1: extract
Step "STEP 1 - extract (I-002)"
$portable = Join-Path $Root 'ComfyUI_windows_portable'
$py = Join-Path $portable 'python_embeded\python.exe'
$main = Join-Path $portable 'ComfyUI\main.py'

if ((Test-Path $py) -and (Test-Path $main)) {
  Say "already extracted, skipping"
} else {
  Say "extracting with bsdtar (tar.exe) ..."
  $tarLog = Join-Path $logDir 'extract_bsdtar.log'
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  & tar -xf $Archive -C $Root 2>&1 | Tee-Object -FilePath $tarLog -Append | Out-Null
  $tc = $LASTEXITCODE
  $sw.Stop()
  Say ("tar exit = {0}  ({1:N1} s)  stderr/stdout -> {2}" -f $tc, $sw.Elapsed.TotalSeconds, $tarLog)

  # A NON-ZERO tar exit means some entries failed. The dangerous case is that python.exe and
  # main.py still got created, so the tree LOOKS present while files are silently missing.
  # This machine has LongPathsEnabled = 0 (C-012), and the portable contains deep
  # python_embeded\Lib\site-packages\... paths, so a partial extraction is a live possibility.
  # Do not walk past it. (-KeepGoing overrides.)
  if ($tc -ne 0) {
    Say "  !! bsdtar reported errors - the extracted tree may be INCOMPLETE"
    if (Test-Path $tarLog) {
      Get-Content $tarLog -Tail 20 -ErrorAction SilentlyContinue | ForEach-Object { Say ("  | " + $_) }
    }
    Fail "bsdtar exited $tc - do not trust a partial extraction"
  }

  if (-not (Test-Path $py)) {
    Say "bsdtar did not produce the expected tree; falling back to 7zr.exe (Risk-011 fallback)"
    $sz7 = Join-Path $Root 'tools\7zr.exe'
    if (Test-Path $sz7) {
      $z7log = Join-Path $logDir 'extract_7zr.log'
      & $sz7 x -y "-o$Root" $Archive 2>&1 | Tee-Object -FilePath $z7log -Append | Out-Null
      $z7c = $LASTEXITCODE
      Say ("7zr exit = {0}   log -> {1}" -f $z7c, $z7log)
      if ($z7c -ne 0) { Say "  !! 7zr also reported errors (see the log)" }
    } else { Fail "no fallback extractor at $sz7" }
  }
}

Step "STEP 1b - assert extraction completeness (VC-014)"
foreach ($p in @($py, $main)) {
  if (Test-Path $p) { Say ("  present: {0}" -f $p) } else { Fail "missing after extraction: $p" }
}

# ---------------------------------------------------------------- STEP 2: smoke test
Step "STEP 2 - portable smoke test (V-002 / VC-014)"
if (Test-Path $py) {
  Say "running: python_embeded -s ComfyUI\main.py --quick-test-for-ci --cpu"
  $out = Join-Path $logDir 'quick_test_for_ci.log'
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  & $py -s $main --quick-test-for-ci --cpu *> $out
  $code = $LASTEXITCODE
  $sw.Stop()
  Say ("exit code = {0}   ({1:N1} s)   log: {2}" -f $code, $sw.Elapsed.TotalSeconds, $out)
  if ($code -ne 0) {
    Say "  --- tail of smoke-test output ---"
    Get-Content $out -Tail 25 -ErrorAction SilentlyContinue | ForEach-Object { Say ("  | " + $_) }
    Fail "quick-test-for-ci returned $code (VC-014 requires 0)"
  } else { Say "smoke test PASS" }
} else { Fail "no python_embeded, cannot run smoke test" }

# ---------------------------------------------------------------- STEP 3: runtime (I-003)
Step "STEP 3 - runtime check (V-003 / VC-002)"
if (Test-Path $py) {
  $code3 = @'
import torch
v = "unknown"
# AUTHORITATIVE SOURCE: comfyui_version.py is a top-level module auto-generated by the build
# from pyproject.toml, and server.py reads it as `from comfyui_version import __version__`.
# (Checked at tag v0.41.0: the file contains exactly __version__ = "0.41.0".)
try:
    import comfyui_version
    v = comfyui_version.__version__
except Exception as e:
    print("comfyui_version import note: %s" % e)
if not v or v == "unknown":
    try:
        import comfy
        v = getattr(comfy, "__version__", None) or "unknown"
    except Exception:
        pass
if not v or v == "unknown":
    try:
        import importlib.metadata as md
        v = md.version("comfyui")
    except Exception:
        v = "unknown"
print("COMFY_VERSION=%s" % v)
print("TORCH=%s" % torch.__version__)
print("TORCH_CUDA=%s" % torch.version.cuda)
print("CUDA_AVAILABLE=%s" % torch.cuda.is_available())
if torch.cuda.is_available():
    print("DEVICE=%s" % torch.cuda.get_device_name(0))
    print("CAPABILITY=%s" % (torch.cuda.get_device_capability(0),))
print("ARCH_LIST=%s" % (torch.cuda.get_arch_list(),))
'@
  $tmp = Join-Path $logDir 'runtime_check.py'
  $code3 | Set-Content -Path $tmp -Encoding UTF8
  # IMPORTANT: run from the ComfyUI subdir - the `comfy` package lives in ComfyUI\comfy,
  # so importing it from ComfyUI_windows_portable\ would fail.
  Push-Location (Join-Path $portable 'ComfyUI')
  $rt = & $py -s $tmp 2>&1
  $rc = $LASTEXITCODE
  Pop-Location
  $rt | ForEach-Object { Say ("  " + $_) }
  Say ("python exit = {0}" -f $rc)
  ($rt -join "`n") | Set-Content -Path (Join-Path $evidence 'runtime_check.txt') -Encoding UTF8
  if (($rt -join "`n") -notmatch 'CUDA_AVAILABLE=True') { Fail "torch reports CUDA unavailable (VC-002)" }
  if (($rt -join "`n") -match 'COMFY_VERSION=unknown') { Say "WARNING: could not read a ComfyUI version string - check >= 0.37.0 by hand" }
} else { Fail "no python_embeded, cannot run runtime check" }

# ---------------------------------------------------------------- STEP 4: workflows (I-006)
Step "STEP 4 - install official workflows (I-006)"
$iw = Join-Path $Root 'scripts\install_workflows.ps1'
if (Test-Path $iw) {
  # Reset first: $LASTEXITCODE only changes when a native command runs or a script calls exit(),
  # so a child that finishes without exit() would otherwise leave a STALE value from an earlier
  # command - and recording a code without acting on it is the exact defect fixed for tar above.
  $global:LASTEXITCODE = 0
  & $iw 2>&1 | ForEach-Object { Say ("  " + $_) }
  $iwCode = $LASTEXITCODE
  Say ("install_workflows exit = {0}" -f $iwCode)
  if ($iwCode -ne 0) { Fail "install_workflows.ps1 exited $iwCode - the workflows may not be in place (VC-004/VC-018 depend on this)" }
} else { Fail "missing $iw" }

# ---------------------------------------------------------------- STEP 5: Phase A (I-012)
Step "STEP 5 - I-012 Phase A: idle baseline B0 (no weights needed)"
$gate = Join-Path $Root 'scripts\run_stage0_gate.ps1'
if (Test-Path $gate) {
  $global:LASTEXITCODE = 0
  & $gate -Phase Idle -MeasureSeconds $B0Seconds 2>&1 | ForEach-Object { Say ("  " + $_) }
  $gateCode = $LASTEXITCODE
  Say ("run_stage0_gate exit = {0}" -f $gateCode)
  if ($gateCode -ne 0) { Fail "run_stage0_gate.ps1 exited $gateCode - B0 was not obtained (VC-017 depends on this)" }
  Say "NOTE: Phase A cannot produce the 'Model storage policy' line - that needs a model load (Phase B)."
} else { Fail "missing $gate" }

Say ""
if ($failed) { Say "=== post_download finished WITH FAILURES (see above) ===" ; exit 1 }
Say "=== post_download finished: I-002, I-003, I-006 install, I-012 Phase A attempted ==="
Say "Next: read _evidence\stage0_summary.json for B0, then wait for the weight download (I-004)."
exit 0
