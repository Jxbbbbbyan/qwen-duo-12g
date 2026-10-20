# install_workflows.ps1 - item I-006 of PLAN_v3.md
#
# Installs the OFFICIAL Qwen-Image 2.1 workflow templates into ComfyUI UNMODIFIED
# (the default chosen after reviewer finding RV1-4 overturned the earlier "crop them" order),
# then proves the install is what we verified:
#   - asserts every ComfySwitchNode (the prompt-enhancer gate) is OFF
#   - runs the V-005 reference scan and reports the executable-path offenders
#   - records SHA256 of each delivered file, so VC-018 ("the verified file IS the delivered
#     file") can be checked later against the same hashes
#
# Run AFTER I-002 (portable extracted). Idempotent.

param(
  [string]$Stage = 'C:\ComfyUI\_workflows_official',
  [string]$Dest  = 'C:\ComfyUI\ComfyUI_windows_portable\ComfyUI\user\default\workflows',
  [string]$Fallback = 'C:\ComfyUI\workflows',
  [string]$Manifest = 'C:\ComfyUI\_workflows_official\DELIVERED_HASHES.txt'
)

$ErrorActionPreference = 'Continue'

# NOTE ON THE PATH, and why a fallback copy exists:
#   `user/default/` IS confirmed from backend source: folder_paths.py:73 sets
#   user_directory = <base>/user, and user_manager.py serves /userdata/{file} from
#   get_public_user_directory(<user id>) = <base>/user/<user_id>/ (docstring example uses "default").
#   BUT the `workflows/` SUBdirectory name is a FRONTEND convention - the backend has no such
#   constant, so it could not be confirmed from source. Therefore we also drop a plainly-named
#   copy in C:\ComfyUI\workflows\ so the templates can always be opened manually in the UI
#   (ComfyUI can load a workflow JSON from an arbitrary path), independent of the convention.

if (-not (Test-Path $Dest)) {
  New-Item -ItemType Directory -Force -Path $Dest | Out-Null
}
if (-not (Test-Path $Fallback)) {
  New-Item -ItemType Directory -Force -Path $Fallback | Out-Null
}

$want = @(
  'image_qwen_image_2_1_turbo_t2i.json',
  'image_qwen_image_2_1_turbo_image_edit.json',
  'image_qwen_image_2_1_t2i.json',
  'image_qwen_image_2_1_image_edit.json'
)

# The derived inpaint workflow (I-006 / AC-003). It is produced by derive_inpaint.ps1, so it may
# legitimately be absent; install it when present rather than failing. Without this entry the
# derived workflow would sit in the staging dir forever and never reach the user.
$optional = @(
  'image_qwen_image_2_1_turbo_image_edit_inpaint.json'
)

Write-Output "=== install_workflows.ps1 : official templates ==="
Write-Output "    primary  : $Dest"
Write-Output "    fallback : $Fallback"
$rows = New-Object System.Collections.ArrayList
$all = @($want) + @($optional)
foreach ($w in $all) {
  $src = Join-Path $Stage $w
  $isOptional = $optional -contains $w
  if (-not (Test-Path $src)) {
    if ($isOptional) { Write-Output "  (optional, absent - skipped): $w"; continue }
    Write-Output "  MISSING in stage: $w"; continue
  }
  Copy-Item -LiteralPath $src -Destination (Join-Path $Dest $w) -Force
  Copy-Item -LiteralPath $src -Destination (Join-Path $Fallback $w) -Force
  $h = (Get-FileHash -LiteralPath (Join-Path $Dest $w) -Algorithm SHA256).Hash.ToLower()
  $h2 = (Get-FileHash -LiteralPath (Join-Path $Fallback $w) -Algorithm SHA256).Hash.ToLower()
  $sz = (Get-Item (Join-Path $Dest $w)).Length
  $match = if ($h -eq $h2) { 'both copies identical' } else { '!! COPIES DIFFER' }
  [void]$rows.Add([pscustomobject]@{ file=$w; bytes=$sz; sha256=$h; optional=$isOptional })
  Write-Output ("  installed {0,-52} {1,8} B  {2}  ({3}){4}" -f $w, $sz, $h.Substring(0,16), $match, $(if($isOptional){' [derived]'}else{''}))
}


# Manifest for the VC-018 consistency claim (delivered file == verified file).
$rows | ForEach-Object { "{0}  {1}  {2}" -f $_.sha256, $_.bytes, $_.file } | Set-Content -Path $Manifest -Encoding UTF8
Write-Output "  hashes written to $Manifest"

Write-Output ""
Write-Output "=== assert the prompt-enhancer switch is OFF in every installed workflow ==="
$allOff = $true
foreach ($r in $rows) {
  $p = Join-Path $Dest $r.file
  $t = Get-Content -Raw -LiteralPath $p
  # the switch is a boolean widget; every observed instance carries widgets_values false
  $offCount = ([regex]::Matches($t, '"type"\s*:\s*"ComfySwitchNode"')).Count
  $trueCount = ([regex]::Matches($t, '"widgets_values"\s*:\s*\[\s*true\s*\]')).Count
  $falseCount = ([regex]::Matches($t, '"widgets_values"\s*:\s*\[\s*false\s*\]')).Count
  Write-Output ("  {0,-46} switchNodes={1}  bare-true={2}  bare-false={3}" -f $r.file, $offCount, $trueCount, $falseCount)
  if ($trueCount -gt 0) { $allOff = $false }
}
Write-Output ""
if ($allOff) { Write-Output "  PE-switch assertion: PASS (no bare-true switch widget found)" }
else { Write-Output "  PE-switch assertion: FAIL - a switch is ON; the PE weight (8.82 GiB) is NOT downloaded" }

Write-Output ""
Write-Output "=== V-005 reference scan on the DELIVERED directory ==="
$scan = 'C:\ComfyUI\scripts\scan_workflow_refs.ps1'
if (Test-Path $scan) { & $scan -Dir $Dest } else { Write-Output "  scan script not found: $scan" }
