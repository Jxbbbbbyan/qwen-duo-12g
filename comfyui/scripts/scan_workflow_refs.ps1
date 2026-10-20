# scan_workflow_refs.ps1 - implements V-005 / VC-004 for PLAN_v3.md
#
# Purpose: prove that the OFFICIAL workflow templates reference NO file we did not download,
# ON THE EXECUTABLE PATH. Prose (MarkdownNote bodies) must be excluded - that was exactly the
# misreading corrected by reviewer finding RV1-4 (see PLAN_v1_reviewer_comments.md).
#
# ComfyUI template files are subgraph-based:
#   - the executable graph lives in definitions.subgraphs[].nodes
#   - node parameters are in each node's widgets_values array
#   - a top-level instance node of type <uuid> mirrors the inner widgets in its own
#     widgets_values ("promoted widgets"), and its string values are ALSO effectively live
#     bindings, so they are checked too.
#
# Usage: pwsh -File scan_workflow_refs.ps1 -Dir <dir-with-template-json>

param(
  [string]$Dir = 'C:\ComfyUI\_workflows_official'
)

$ErrorActionPreference = 'Continue'

# Files this deployment deliberately DOES download (E-EXT-003 + the conditional base DiT).
$downloaded = @(
  'qwen_image_2.1_int8_convrot.safetensors',
  'qwen_image_2.1_turbo_int8_convrot.safetensors',
  'qwen3vl_8b_int8_convrot.safetensors',
  'qwen_image_2.1_vae_bf16.safetensors'
)

$allRefs  = New-Object System.Collections.ArrayList
$liveRefs = New-Object System.Collections.ArrayList   # from widgets_values (executable path)
$proseRefs= New-Object System.Collections.ArrayList   # from MarkdownNote text only
$switches = New-Object System.Collections.ArrayList

function Walk($node, $file, $inProse) {
  if ($null -eq $node) { return }

  if ($node -is [System.Management.Automation.PSCustomObject]) {
    $props = $node.PSObject.Properties.Name
    $type  = if ($props -contains 'type') { $node.type } else { $null }

    # record ComfySwitchNode state (I-006 requires the prompt-enhancer switch to be OFF)
    if ($type -eq 'ComfySwitchNode' -and ($props -contains 'widgets_values')) {
      [void]$switches.Add([pscustomobject]@{ file=$file; id=$node.id; widgets=($node.widgets_values | ConvertTo-Json -Compress -Depth 6) })
    }

    $isProse = $inProse -or ($type -eq 'MarkdownNote')

    if ($props -contains 'widgets_values') {
      $wv = $node.widgets_values
      foreach ($v in $wv) {
        if ($v -is [string]) {
          foreach ($m in [regex]::Matches($v, '[\w\.\-/]+\.(?:safetensors|gguf|ckpt|pt|bin|pth)')) {
            $rec = [pscustomobject]@{ file=$file; type=$type; id=$node.id; ref=$m.Value }
            [void]$allRefs.Add($rec)
            if ($isProse) { [void]$proseRefs.Add($rec) } else { [void]$liveRefs.Add($rec) }
          }
        }
      }
    }

    foreach ($p in $node.PSObject.Properties) { Walk $p.Value $file $isProse }
  }
  elseif ($node -is [System.Collections.IEnumerable] -and $node -isnot [string]) {
    foreach ($i in $node) { Walk $i $file $inProse }
  }
}

$files = Get-ChildItem -Path $Dir -Filter '*.json' -File -ErrorAction SilentlyContinue | Sort-Object Name
if (-not $files) { Write-Output "no JSON in $Dir"; exit 2 }

foreach ($f in $files) {
  try {
    $j = Get-Content -Raw -LiteralPath $f.FullName | ConvertFrom-Json -Depth 100
    Walk $j $f.Name $false
  } catch { Write-Output "!! parse failed: $($f.Name) :: $($_.Exception.Message)" }
}

function Uniq($list) { $list | ForEach-Object { $_.ref } | Sort-Object -Unique }
function Offenders($list) { $list | Where-Object { $r = $_.ref -replace '.*[\\/]',''; -not ($downloaded -contains $r) } }

Write-Output "=============================================================="
Write-Output " V-005 workflow reference scan   (dir: $Dir)"
Write-Output "=============================================================="
Write-Output ""
Write-Output "--- ALL filename references found (any context) ---"
Uniq $allRefs | ForEach-Object { "    $_" }
Write-Output ""
Write-Output "--- references on the EXECUTABLE PATH (widgets_values, prose excluded) ---"
$live = Uniq $liveRefs
if ($live) { $live | ForEach-Object { "    $_" } } else { "    (none)" }
Write-Output ""
Write-Output "--- references in PROSE ONLY (MarkdownNote bodies; NOT executable) ---"
$pr = Uniq $proseRefs
if ($pr) { $pr | ForEach-Object { "    $_" } } else { "    (none)" }
Write-Output ""

$off = Offenders $liveRefs
Write-Output "--- OFFENDERS: executable-path references to files we do NOT download ---"
if ($off) {
  $off | ForEach-Object { "  !! $($_.file)  node=$($_.type)#$($_.id)  ref=$($_.ref)" }
  Write-Output ""
  Write-Output "VC-004 RESULT: FAIL  (count = $($off.Count))"
} else {
  Write-Output "    (none)"
  Write-Output ""
  Write-Output "VC-004 RESULT: PASS  (executable-path undownloaded refs = 0)"
}

Write-Output ""
Write-Output "--- ComfySwitchNode instances (prompt-enhancer gate, I-006) ---"
if ($switches) {
  $switches | ForEach-Object { "  $($_.file)  id=$($_.id)  widgets=$($_.widgets)" }
} else { "  (none found)" }
Write-Output ""
Write-Output "downloaded set used for the check:"
$downloaded | ForEach-Object { "    $_" }
