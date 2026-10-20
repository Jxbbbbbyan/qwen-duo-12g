#Requires -RunAsAdministrator
<#
.SYNOPSIS
    为"离线验证"临时添加出站阻断规则：只针对指定程序，不是整机断网。

.DESCRIPTION
    用途：证明整条流水线在**没有对外网络**的情况下也能跑通。做法是给实际执行推理的程序
    （ComfyUI 的嵌入式 python.exe 与 llama-server.exe）加上 Windows 防火墙出站阻断规则，
    然后照常跑一遍"提示词生成 → 出图"。

    重要边界：
      · 规则是**按程序**生效的，只覆盖 -Program 里列出的可执行文件；
        它不是"阻断所有程序"，也没有关闭防火墙；Node.js 总控台本身不在阻断范围内。
      · 回环地址（127.0.0.1 / localhost）不经过 Windows 防火墙的出站过滤，
        所以总控台 ↔ llama-server ↔ ComfyUI 之间的本地通信照常工作。
      · 因此本流程能证明的是"推理路径不依赖对外网络"，不是"整机断网仍可运行"。
      · 规则会持久化在防火墙里，**验证完请务必执行 fw-off.ps1 删除**。

.PARAMETER Program
    要阻断出站的程序路径。默认是两个真实执行推理的可执行文件，请按自己的安装位置修改。

.PARAMETER LogPath
    结果日志路径，默认写到临时目录，避免污染仓库或安装目录。

.EXAMPLE
    .\fw-on.ps1
    按默认路径添加两条阻断规则，并逐条回读确认方向/动作/程序都正确。

.NOTES
    需要管理员权限（UAC），且需要 PowerShell 7。验证完成后用 .\fw-off.ps1 清理。
#>
[CmdletBinding()]
param(
    [string[]]$Program = @(
        'C:\ComfyUI\ComfyUI_windows_portable\python_embeded\python.exe',
        'D:\llm\bin\llama.cpp\llama-server.exe'
    ),
    [string]$LogPath = (Join-Path $env:TEMP 'qwen-fw-test.txt')
)

$ErrorActionPreference = 'Stop'

$map = @(
    @{ Name = 'QwenBlockOut-PY';    Path = $Program[0] }
    @{ Name = 'QwenBlockOut-LLAMA'; Path = $Program[1] }
)

$lines     = [System.Collections.Generic.List[string]]::new()
$installed = 0
$lines.Add("== fw-on @ $(Get-Date -Format o) ==")

foreach ($r in $map) {
    if (-not (Test-Path -LiteralPath $r.Path)) {
        $lines.Add("SKIP $($r.Name): 程序不存在 -> $($r.Path)")
        Write-Warning "程序不存在，跳过：$($r.Path)"
        continue
    }

    # 幂等：先删同名旧规则。删不掉不算错（可能本来就不存在），真正的判据是下面的回读。
    netsh advfirewall firewall delete rule name="$($r.Name)" | Out-Null

    netsh advfirewall firewall add rule name="$($r.Name)" dir=out action=block program="$($r.Path)" enable=yes | Out-Null
    if ($LASTEXITCODE -ne 0) {
        $lines.Add("FAIL $($r.Name): netsh add 退出码 $LASTEXITCODE")
        throw "添加防火墙规则失败：$($r.Name)（netsh 退出码 $LASTEXITCODE），通常是权限不足。"
    }

    # 回读必须同时确认：规则名、方向 Out、动作 Block、已启用、以及那个程序路径。
    # 只确认"名字存在"不足以证明规则真的在阻断出站。
    # verbose 才会稳定打印 Program 字段 / verbose is needed to reliably print the Program field
    $show     = (netsh advfirewall firewall show rule name="$($r.Name)" verbose) -join "`n"
    $showExit = $LASTEXITCODE
    $okName   = $show -match [regex]::Escape($r.Name)
    $okDir    = $show -match '方向\s*:\s*出|Direction\s*:\s*Out'
    $okAction = $show -match '操作\s*:\s*阻止|Action\s*:\s*Block'
    # 若该版本 netsh 没打印 Program 字段，就不要因此判失败（只验证打印出来的部分）
    # If this netsh build does not print a Program field at all, do not fail on it.
    $hasProg  = $show -match 'Program|程序'
    $okProg   = if ($hasProg) { $show -match [regex]::Escape($r.Path) } else { $true }
    $okOn     = $show -match '已启用\s*:\s*是|Enabled\s*:\s*Yes'

    if ($showExit -ne 0 -or -not ($okName -and $okDir -and $okAction -and $okProg -and $okOn)) {
        $lines.Add("FAIL $($r.Name): 回读校验未通过 (name=$okName dir=$okDir action=$okAction prog=$okProg enabled=$okOn exit=$showExit)")
        throw "规则 $($r.Name) 回读校验失败：期望 方向=出 / 操作=阻止 / 已启用=是 / 程序=$($r.Path)。"
    }

    $installed++
    $lines.Add("OK   $($r.Name) -> $($r.Path)")
    Write-Host ("已阻断出站：{0}  ->  {1}" -f $r.Name, $r.Path) -ForegroundColor Yellow
}

if ($installed -eq 0) {
    $lines.Add('FAIL: 一条规则都没有装上，无法进行离线验证。')
    $lines -join "`n" | Out-File -FilePath $LogPath -Encoding utf8
    throw '未安装任何规则（-Program 里的路径都不存在？），本次离线验证无法进行。'
}

$lines.Add("提示：验证完成后执行 fw-off.ps1 清理规则。")
$lines -join "`n" | Out-File -FilePath $LogPath -Encoding utf8
Write-Host ("已安装 {0} 条阻断规则；日志：{1}" -f $installed, $LogPath)
Write-Host '现在可以照常跑一遍完整流程。完成后务必执行 .\fw-off.ps1。' -ForegroundColor Yellow
