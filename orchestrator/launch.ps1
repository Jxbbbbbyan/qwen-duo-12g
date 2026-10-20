# launch.ps1 - 千问总控台的真正启动逻辑
#
# 为什么要有这个文件：批处理 (.cmd) 由 cmd.exe 按系统 ANSI 代码页(中文系统是 GBK)解析，
# 直接在里面写中文会变成乱码并被当作命令执行，导致"双击没反应"。
# 所以 .cmd 只保留纯 ASCII 的一行调用，所有中文提示与判断都在这里（pwsh 7 默认 UTF-8）。

$orch   = 'C:\ComfyUI\orchestrator\orchestrator.mjs'
$starter= 'C:\ComfyUI\orchestrator\start-orchestrator.ps1'
$url    = 'http://127.0.0.1:8090'
$log    = 'C:\ComfyUI\logs\launch.log'

function Say($m) {
  $line = "{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m
  Write-Host $line
  try { Add-Content -Path $log -Value $line -Encoding utf8 } catch {}
}

function Alive {
  try {
    $r = Invoke-WebRequest "$url/api/status" -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop
    return ($r.StatusCode -eq 200)
  } catch { return $false }
}

Say "=== 启动总控台 ==="

if (Alive) {
  Say "后端已在运行，直接打开界面"
  Start-Process $url
  exit 0
}

Say "后端未运行，正在启动（Qwen3.8 会随之加载，约 1-2 分钟）"
& pwsh -NoProfile -ExecutionPolicy Bypass -File $starter

Say "等待界面就绪…"
$ok = $false
for ($i = 0; $i -lt 90; $i++) {
  if (Alive) { $ok = $true; break }
  Start-Sleep -Seconds 2
}

if (-not $ok) {
  Say "后端未在约 3 分钟内就绪"
  Write-Host ""
  Write-Host "请查看日志： C:\ComfyUI\logs\orchestrator.log"
  Write-Host "常见原因：8090 端口被一个残留的旧 node 进程占用。"
  exit 1
}

Say "后端就绪，打开浏览器"
Start-Process $url
exit 0
