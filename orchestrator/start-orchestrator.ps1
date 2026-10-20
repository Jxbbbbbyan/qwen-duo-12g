# start-orchestrator.ps1 - 以隐藏方式、脱离父进程启动总控台后端
#
# WHY DETACHED: 由桌面 .cmd 调用时，如果 node 作为子进程随 cmd 退出而死掉，
# 用户点开图标立刻就断了。Start-Process 不加 -Wait 可让它独立存活。
#
# WHY NO -RedirectStandardOutput HERE: 早先版本用重定向到文件，结果父 shell 退出后
# 子进程随之消失、且日志文件根本没生成。orchestrator.mjs 自己已经把日志写到
# C:\ComfyUI\logs\orchestrator.log，所以这里不需要、也不应该再接管道/重定向。

$orch = 'C:\ComfyUI\orchestrator\orchestrator.mjs'
$logDir = 'C:\ComfyUI\logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

if (-not (Test-Path $orch)) { Write-Error "orchestrator.mjs 不存在: $orch"; exit 2 }

# 已经在跑就不重复启动
$already = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine -match 'orchestrator\.mjs' }
if ($already) { exit 0 }

$node = (Get-Command node).Source
Start-Process -FilePath $node -ArgumentList $orch -WorkingDirectory 'C:\ComfyUI\orchestrator' -WindowStyle Hidden

exit 0
