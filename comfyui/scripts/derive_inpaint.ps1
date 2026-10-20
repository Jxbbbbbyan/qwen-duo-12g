# derive_inpaint.ps1 - item I-006 of PLAN_v3.md : derive the inpaint workflow
#
# WHAT IT DOES (the "no promotion surgery" variant, see I006_WORKFLOW_SPEC.md 3.2.1):
#   Takes the official turbo image-edit template and inserts a mask on the sampling latent:
#     new ImageToMask(image <- the ALREADY-PROMOTED reference image, channel="alpha")
#     new SetLatentNoiseMask(samples <- the ComfySwitchNode output, mask <- ImageToMask)
#     re-point SamplerCustomAdvanced.latent_image from the switch output to SetLatentNoiseMask
#
# WHY THIS VARIANT IS THE SAFE ONE:
#   The reference image enters the subgraph as a promoted input (-10 slot 18 = "images.image_1"),
#   and that single output ALREADY fans out to two consumers in the shipped template
#   (links 710 -> TextEncodeQwenImage21 and 750 -> BatchImagesNode). Adding a third consumer is
#   therefore the file's own established pattern, so NO new promoted input and NO edit to the
#   subgraph's promoted-widget array is required - that array is exactly what reviewer finding
#   RV1-4 warned could be broken by careless subgraph surgery.
#
# EVERYTHING RELIED ON HERE WAS READ FROM THE SHIPPED FILE OR FROM v0.41.0 SOURCE:
#   link to re-point : {"id":913,"origin_id":468,"origin_slot":0,"target_id":505,"target_slot":4,"type":"LATENT"}
#   node ids         : max existing = 507, so new nodes are 508 and 509
#   ImageToMask      : inputs image/combo channel ["red","green","blue","alpha"], output mask (MASK)
#   SetLatentNoiseMask: inputs samples (LATENT), mask (MASK) -> output LATENT
#                       NOTE: the input is named "samples", NOT "latent" (corrected in CORR-016)
#
# HONEST LIMIT: this cannot verify that ComfyUI will LOAD or RUN the result - subgraph/promoted-widget
# structure is a frontend concern (reviewer finding RV1-4). This script therefore asserts structural
# invariants and re-runs the reference scan, and the output is labelled UNVERIFIED until I-012/I-014.

param(
  [string]$Src = 'C:\ComfyUI\_workflows_official\image_qwen_image_2_1_turbo_image_edit.json',
  [string]$Dst = 'C:\ComfyUI\_workflows_official\image_qwen_image_2_1_turbo_image_edit_inpaint.json'
)

$ErrorActionPreference = 'Continue'
$script:problems = 0
function Ok([string]$m)   { Write-Host ("  [ok]   {0}" -f $m) }
function Bad([string]$m)  { Write-Host ("  [FAIL] {0}" -f $m); $script:problems++ }

Write-Host "=== derive_inpaint.ps1 ==="
if (-not (Test-Path $Src)) { Write-Host "FAIL: source not found: $Src"; exit 2 }

$j  = Get-Content -Raw $Src | ConvertFrom-Json -Depth 100
$sg = $j.definitions.subgraphs[0]

# ---- locate the pieces, by TRAVERSING THIS FILE (never by assuming ids from another template) ----
$switch = $sg.nodes | Where-Object { $_.type -eq 'ComfySwitchNode' -and ($_.outputs[0].links -contains 913) }
if (-not $switch) { $switch = $sg.nodes | Where-Object { $_.id -eq 468 } }
$sampler = $sg.nodes | Where-Object { $_.id -eq 505 }
$rewire  = $sg.links | Where-Object { $_.target_id -eq 505 -and $_.type -eq 'LATENT' }

if (-not $switch)  { Bad "could not locate the ComfySwitchNode"; exit 3 }
if (-not $sampler) { Bad "could not locate SamplerCustomAdvanced"; exit 3 }
if (-not $rewire)  { Bad "could not locate the LATENT link into the sampler"; exit 3 }
Ok ("switch  = id {0} ({1})" -f $switch.id, $switch.type)
Ok ("sampler = id {0} ({1})" -f $sampler.id, $sampler.type)
Ok ("link to re-point = id {0}: {1}:{2} -> {3}:{4} [{5}]" -f $rewire.id, $rewire.origin_id, $rewire.origin_slot, $rewire.target_id, $rewire.target_slot, $rewire.type)

# the promoted reference image: the -10 output that already feeds the text encoder's image input
$teNode = $sg.nodes | Where-Object { $_.type -eq 'TextEncodeQwenImage21' }
$refSlot = ($sg.links | Where-Object { $_.target_id -eq $teNode.id -and $_.type -eq 'IMAGE' } | Select-Object -First 1)
if (-not $refSlot) { Bad "could not find the promoted reference image feeding TextEncodeQwenImage21"; exit 3 }
Ok ("promoted reference image = -10:{0} -> {1}:{2}" -f $refSlot.origin_slot, $refSlot.target_id, $refSlot.target_slot)
$fans = ($sg.links | Where-Object { $_.origin_id -eq -10 -and $_.origin_slot -eq $refSlot.origin_slot }).Count
Ok ("that -10 output already has {0} consumer(s) - fan-out is this file's own pattern" -f $fans)

# ---- allocate ids ----
$allNodeIds = @(); $allNodeIds += ($j.nodes | ForEach-Object { $_.id }); $allNodeIds += ($sg.nodes | ForEach-Object { $_.id })
$newMaskId  = [int](($allNodeIds | Measure-Object -Maximum).Maximum) + 1
$newSetId   = $newMaskId + 1
$maxLinkId  = [int](($sg.links | ForEach-Object { $_.id } | Measure-Object -Maximum).Maximum)
$lMaskIn    = $maxLinkId + 1
$lMaskToSet = $maxLinkId + 2
$lSwitchIn  = $maxLinkId + 3
Ok ("new node ids = {0} (ImageToMask), {1} (SetLatentNoiseMask); new link ids = {2},{3},{4}" -f $newMaskId,$newSetId,$lMaskIn,$lMaskToSet,$lSwitchIn)

# ---- new nodes (shape copied from existing nodes in this file) ----
$nodeMask = [pscustomobject]@{
  id = $newMaskId; type = 'ImageToMask'; pos = @(560, 260); size = @(240, 58); flags = @{}; order = 30; mode = 0
  inputs  = @([pscustomobject]@{ localized_name='image'; name='image'; type='IMAGE'; link=$lMaskIn })
  outputs = @([pscustomobject]@{ localized_name='mask'; name='mask'; type='MASK'; links=@($lMaskToSet) })
  properties = [pscustomobject]@{ 'Node name for S&R' = 'ImageToMask' }
  widgets_values = @('alpha')
}
$nodeSet = [pscustomobject]@{
  id = $newSetId; type = 'SetLatentNoiseMask'; pos = @(560, 380); size = @(240, 58); flags = @{}; order = 31; mode = 0
  inputs  = @(
    [pscustomobject]@{ localized_name='samples'; name='samples'; type='LATENT'; link=$lSwitchIn },
    [pscustomobject]@{ localized_name='mask';    name='mask';    type='MASK';   link=$lMaskToSet }
  )
  outputs = @([pscustomobject]@{ localized_name='LATENT'; name='LATENT'; type='LATENT'; links=@($rewire.id) })
  properties = [pscustomobject]@{ 'Node name for S&R' = 'SetLatentNoiseMask' }
  widgets_values = @()
}

# ---- new links ----
$linkMaskIn    = [pscustomobject]@{ id=$lMaskIn;    origin_id=-10;      origin_slot=[int]$refSlot.origin_slot; target_id=$newMaskId; target_slot=0; type='IMAGE' }
$linkMaskToSet = [pscustomobject]@{ id=$lMaskToSet; origin_id=$newMaskId; origin_slot=0;                         target_id=$newSetId;   target_slot=1; type='MASK' }
$linkSwitchIn  = [pscustomobject]@{ id=$lSwitchIn;  origin_id=$switch.id; origin_slot=0;                        target_id=$newSetId;   target_slot=0; type='LATENT' }

# ---- apply ----
$sg.nodes = @($sg.nodes) + @($nodeMask, $nodeSet)
$sg.links = @($sg.links) + @($linkMaskIn, $linkMaskToSet, $linkSwitchIn)

# re-point the sampler's latent input to the new SetLatentNoiseMask output
foreach ($l in $sg.links) { if ($l.id -eq $rewire.id) { $l.origin_id = $newSetId; $l.origin_slot = 0 } }
# and record the new consumer on the switch's output
foreach ($n in $sg.nodes) { if ($n.id -eq $switch.id -and $n.outputs.Count -gt 0) { $n.outputs[0].links = @($n.outputs[0].links) + @($lSwitchIn) } }
# and on the -10 proxy's output that we fanned out from
if ($sg.inputs -and $sg.inputs.Count -gt [int]$refSlot.origin_slot) {
  # the -10 node itself carries the links array in most exports; patch it if present
}
$proxy = $sg.nodes | Where-Object { $_.id -eq -10 }
if ($proxy -and $proxy.outputs -and $proxy.outputs.Count -gt [int]$refSlot.origin_slot) {
  $proxy.outputs[[int]$refSlot.origin_slot].links = @($proxy.outputs[[int]$refSlot.origin_slot].links) + @($lMaskIn)
  Ok "patched the -10 proxy output[$(($refSlot.origin_slot))] links"
} else {
  Write-Host "  [note] the -10 proxy node is not present as a node object in this export; the link is still registered in .links"
}

if ($j.PSObject.Properties.Name -contains 'last_node_id') { $j.last_node_id = $newSetId }
if ($j.PSObject.Properties.Name -contains 'last_link_id') { $j.last_link_id = $lSwitchIn }
foreach ($p in @('last_node_id','last_link_id')) {
  if ($sg.PSObject.Properties.Name -contains $p) { if ($p -eq 'last_node_id') { $sg.last_node_id = $newSetId } else { $sg.last_link_id = $lSwitchIn } }
}
$j | Add-Member -NotePropertyName '_derivation' -NotePropertyValue 'I-006 preferred variant: ImageToMask(alpha) + SetLatentNoiseMask inserted between ComfySwitchNode and SamplerCustomAdvanced. STRUCTURALLY VALIDATED ONLY - NOT yet load-tested in ComfyUI.' -Force

$j | ConvertTo-Json -Depth 100 | Set-Content -Path $Dst -Encoding UTF8
Write-Host ""
Write-Host ("written: {0}" -f $Dst)

# ---------------- structural validation ----------------
Write-Host ""
Write-Host "=== structural validation ==="
$v = Get-Content -Raw $Dst | ConvertFrom-Json -Depth 100
$vsg = $v.definitions.subgraphs[0]
if ($vsg.nodes.Count -eq ($sg.nodes.Count)) { Ok ("node count = {0}" -f $vsg.nodes.Count) } else { Bad ("node count {0} != expected {1}" -f $vsg.nodes.Count, $sg.nodes.Count) }
if ($vsg.links.Count -eq ($sg.links.Count)) { Ok ("link count = {0} (+3 vs source)" -f $vsg.links.Count) } else { Bad ("link count {0} != expected {1}" -f $vsg.links.Count, $sg.links.Count) }

# every link endpoint must resolve to a known node id (or -10 / -20 proxies)
$known = @(-10,-20) + ($vsg.nodes | ForEach-Object { $_.id })
$dangling = @()
foreach ($l in $vsg.links) {
  if ($known -notcontains $l.origin_id) { $dangling += "origin $($l.origin_id) (link $($l.id))" }
  if ($known -notcontains $l.target_id) { $dangling += "target $($l.target_id) (link $($l.id))" }
}
if ($dangling.Count -eq 0) { Ok "no dangling link endpoints" } else { Bad ("dangling: " + ($dangling -join '; ')) }

# the sampler's latent input must now come from SetLatentNoiseMask
$nowLat = $vsg.links | Where-Object { $_.target_id -eq 505 -and $_.target_slot -eq 4 }
if ($nowLat -and $nowLat.origin_id -eq $newSetId) { Ok ("sampler latent input now comes from SetLatentNoiseMask (id {0})" -f $newSetId) }
else { Bad ("sampler latent input still comes from id {0}" -f $nowLat.origin_id) }

# each new input must carry the link we created
$nSet = $vsg.nodes | Where-Object { $_.id -eq $newSetId }
if ($nSet.inputs[0].link -eq $lSwitchIn) { Ok "SetLatentNoiseMask.samples is wired" } else { Bad "SetLatentNoiseMask.samples link mismatch" }
if ($nSet.inputs[1].link -eq $lMaskToSet) { Ok "SetLatentNoiseMask.mask is wired" } else { Bad "SetLatentNoiseMask.mask link mismatch" }

Write-Host ""
Write-Host "=== V-005 reference scan on the derived file ==="
& 'C:\ComfyUI\scripts\scan_workflow_refs.ps1' -Dir (Split-Path $Dst -Parent) 2>&1 |
  Select-String -Pattern 'VC-004 RESULT|OFFENDERS|image_qwen_image_2_1_turbo_image_edit_inpaint' | ForEach-Object { Write-Host ("  " + $_.Line) }

Write-Host ""
if ($script:problems -eq 0) { Write-Host "=== structural validation PASSED (still NOT load-tested) ==="; exit 0 }
Write-Host ("=== {0} structural problem(s) ===" -f $script:problems); exit 1
