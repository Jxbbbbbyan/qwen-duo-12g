#Requires -RunAsAdministrator
<#
.SYNOPSIS
    删除 fw-on.ps1 添加的出站阻断规则，把防火墙恢复到原状。

.DESCRIPTION
    与 fw-on.ps1 配对使用。删除后**逐条回读校验**规则确实已不存在，而不是只看命令有没有报错。

    判定逻辑刻意从严，避免"假成功"：
      · 回读显示"无匹配规则"（退出码 1）        → 判定已删除
      · 回读仍能查到该规则（退出码 0）            → 判定仍存在，非零退出
      · 其他任何情况（服务未启动、权限不足等）    → 判定未知，非零退出
    只有在全部规则都确认删除时才返回 0。

    重复执行是安全的（幂等）。

.PARAMETER LogPath
    结果日志路径，默认写到临时目录，与 fw-on.ps1 一致。

.EXAMPLE
    .\fw-off.ps1
    删除两条阻断规则，并确认它们已消失。

.NOTES
    需要管理员权限（UAC），且需要 PowerShell 7。
#>
[CmdletBinding()]
param(
    [string]$LogPath = (Join-Path $env:TEMP 'qwen-fw-test.txt')
)

$ErrorActionPreference = 'Stop'

$names = @('QwenBlockOut-PY', 'QwenBlockOut-LLAMA')

$lines  = [System.Collections.Generic.List[string]]::new()
$lines.Add("== fw-off @ $(Get-Date -Format o) ==")
$failed = 0

foreach ($n in $names) {
    netsh advfirewall firewall delete rule name="$n" | Out-Null
    $delExit = $LASTEXITCODE

    # 权威判据是回读，而不是 delete 的退出码（规则本来就不存在时 delete 也会返回非零）。
    $show     = (netsh advfirewall firewall show rule name="$n" 2>&1) -join ' '
    $showExit = $LASTEXITCODE

    if ($showExit -eq 0) {
        # 仍然查得到 → 确实还在
        Write-Warning "规则仍然存在：$n"
        $lines.Add("STILL-PRESENT $n (delete exit=$delExit, show exit=0)")
        $failed++
    }
    elseif ($show -match 'No rules match|没有与指定条件匹配') {
        $lines.Add("REMOVED $n (delete exit=$delExit)")
        Write-Host ("已删除：{0}" -f $n)
    }
    else {
        # 既没删掉、也没给出"无匹配"——状态未知，不能当成成功
        Write-Warning "无法确认规则状态：$n（show exit=$showExit）"
        $lines.Add("UNKNOWN $n (delete exit=$delExit, show exit=$showExit): $show")
        $failed++
    }
}

$lines.Add('result: ' + $(if ($failed -eq 0) { 'all rules confirmed removed' } else { "$failed rule(s) not confirmed removed" }))
$lines -join "`n" | Out-File -FilePath $LogPath -Encoding utf8
Write-Host ("日志：{0}" -f $LogPath)

if ($failed -ne 0) {
    Write-Error "有 $failed 条规则未能确认删除，请手动检查防火墙。"
    exit 1
}

Write-Host '全部规则已确认删除，防火墙已恢复。' -ForegroundColor Green
