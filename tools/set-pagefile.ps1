#Requires -RunAsAdministrator
<#
.SYNOPSIS
    将 Windows 页面文件设为固定大小，使约 15 GB 的模型能在 16 GB 内存的机器上完成"提交"。

.DESCRIPTION
    背景：Qwen3.8-27B 的 GGUF 约 14.30 GiB。加载它时进程的提交量会超过"物理内存 + 原有页面
    文件"之和，Windows 会直接拒绝分配——表现为加载瞬间失败，而不是变慢。把页面文件放大到
    32768 MB 后，提交上限提升到 47.94 GiB（本机实测）。

    本脚本的执行顺序是刻意设计的：
      1. 解析并**校验参数**（尺寸非法就直接拒绝，不会带着坏值往下走）
      2. 检查目标盘剩余空间（不够就拒绝）
      3. 打印目标值并要求**交互确认**（或用 -Force 显式跳过）
      4. **确认之后**才备份当前值到带时间戳的 JSON，绝不覆盖已有备份
      5. 写入注册表，回读校验；**回读不一致则非零退出**
      6. 打印可直接粘贴的回滚命令

    这是对整机生效的系统级修改，会影响同机所有程序，且必须重启才生效。

.PARAMETER Drive
    页面文件所在盘符，默认 C:。

.PARAMETER SizeMB
    固定大小（初始 = 最大），默认 32768 MB。合法范围 128–1048576。

.PARAMETER Force
    跳过交互确认，用于无人值守。使用前请确认你清楚后果。

.EXAMPLE
    .\set-pagefile.ps1
    交互确认后，把 C: 设为 32 GB 固定页面文件。

.EXAMPLE
    .\set-pagefile.ps1 -Drive D: -SizeMB 40960 -Force

.NOTES
    需要管理员权限（UAC），且需要 PowerShell 7。
    修改后必须重启才生效。

    想把页面文件改回"系统托管"，请用图形界面操作，不要依赖本脚本：
    Win+R → SystemPropertiesPerformance → 高级 → 虚拟内存 → 更改 → 勾选"自动管理所有驱动器的分页文件大小"。
    原因是"系统托管"由 Win32_ComputerSystem.AutomaticManagedPagefile 控制，
    单清空注册表里的 PagingFiles 并不等价于恢复系统托管。

    回滚：脚本结束时会打印可直接粘贴的恢复命令；原始值同时留存在带时间戳的 JSON 备份里。
#>
[CmdletBinding()]
param(
    [string]$Drive  = 'C:',
    [int]   $SizeMB = 32768,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

$key = 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Memory Management'

# ── 1. 参数校验 ──────────────────────────────────────────────────────────────
if ($SizeMB -lt 128 -or $SizeMB -gt 1048576) {
    throw "SizeMB 超出合法范围 128–1048576（收到 $SizeMB）。"
}

$letter = ($Drive -replace '[:\\]', '')
if (-not $letter -or $letter.Length -gt 1 -or $letter -notmatch '^[A-Za-z]$') {
    throw "无法解析盘符：'$Drive'。请传入单个盘符，例如 'C:'。"
}
$letter = $letter.ToUpper()

$target     = @("$letter`:\pagefile.sys $SizeMB $SizeMB")
$targetText = $target -join ' | '

$current = @((Get-ItemProperty -Path $key -Name PagingFiles -ErrorAction Stop).PagingFiles)
$curText = if ($current.Count -eq 0 -or -not $current[0]) { '<空 / empty（不等于系统托管）>' } else { ($current -join ' | ') }

# ── 2. 空间检查 ──────────────────────────────────────────────────────────────
$free = (Get-PSDrive -Name $letter -ErrorAction Stop).Free
$need = [int64]$SizeMB * 1MB
Write-Host ("[1/5] 当前 PagingFiles : {0}" -f $curText)
Write-Host ("[2/5] {0}: 剩余 {1:N1} GiB，页面文件需要 {2:N1} GiB" -f $letter, ($free / 1GB), ($need / 1GB))
if ($free -lt [int64]($need * 1.1)) {
    throw ("剩余空间不足：建议至少留出 {0:N1} GiB 余量（页面文件 {1:N1} GiB + 10%）。请先清理磁盘，或用 -Drive 指定其他盘。" -f (($need * 1.1) / 1GB), ($need / 1GB))
}

# ── 3. 确认 ──────────────────────────────────────────────────────────────────
Write-Host ("[3/5] 即将写入 : {0}" -f $targetText)
if (-not $Force) {
    Write-Host '      这是对整机生效的修改，且需要重启。' -ForegroundColor Yellow
    $ans = Read-Host '      确认继续？输入 yes 继续'
    if ($ans -ne 'yes') { Write-Host '      已取消，未做任何修改。'; exit 1 }
}

# ── 4. 备份（确认之后才写，且绝不覆盖已有备份） ──────────────────────────────
$stamp  = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = Join-Path $PSScriptRoot "pagefile-backup-$stamp.json"
[ordered]@{
    capturedAt  = (Get-Date).ToString('o')
    machine     = $env:COMPUTERNAME
    pagingFiles = $current
    note        = '原始 PagingFiles 值，用于回滚 / original PagingFiles value for rollback'
} | ConvertTo-Json -Depth 4 | Set-Content -Path $backup -Encoding utf8
Write-Host ("[4/5] 备份已写入 : {0}" -f $backup)

# ── 5. 写入、回读校验、回滚说明 ──────────────────────────────────────────────
Set-ItemProperty -Path $key -Name PagingFiles -Value $target -ErrorAction Stop
$now     = @((Get-ItemProperty -Path $key -Name PagingFiles -ErrorAction Stop).PagingFiles)
$nowText = if ($now.Count -eq 0 -or -not $now[0]) { '<空 / empty>' } else { ($now -join ' | ') }
Write-Host ("[5/5] 写入后回读 : {0}" -f $nowText)

Write-Host ''
Write-Host '回滚（管理员 PowerShell 中粘贴执行）：' -ForegroundColor Cyan
if ($current.Count -eq 0 -or -not $current[0]) {
    Write-Host "  Set-ItemProperty -Path '$key' -Name PagingFiles -Value @()"
    Write-Host '  # 注意：这只会清空自定义列表；要恢复"系统托管"请用 GUI（见本脚本 .NOTES）'
} else {
    $literals = ($current | ForEach-Object { "'" + ($_ -replace "'", "''") + "'" }) -join ','
    Write-Host "  Set-ItemProperty -Path '$key' -Name PagingFiles -Value @($literals)"
}
Write-Host "  # 或从本次备份还原 / or restore from this run's backup:"
Write-Host "  Set-ItemProperty -Path '$key' -Name PagingFiles -Value @((Get-Content '$backup' -Raw | ConvertFrom-Json).pagingFiles)"
Write-Host ''

if ($nowText -ne $targetText) {
    Write-Error "回读值与预期不一致：期望 '$targetText'，实际 '$nowText'。请人工核对 $key"
    exit 2
}

Write-Host '完成。重启后生效。' -ForegroundColor Green
