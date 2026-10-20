# chat-launch.ps1 - 启动"千问3.8 对话总控台"（端口 8091）
#
# 与出图总控台的启动器逻辑相同（.cmd 只留纯 ASCII，中文都放这里），
# 但目标端口与后端脚本不同。

$script = 'C:\ComfyUI\orchestrator\chat-console.mjs'
$log    = 'C:\ComfyUI\logs\chat-launch.log'
$url    = 'http://127.0.0.1:8091'

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

Say "=== 启动千问3.8 对话总控台 ==="

if (Alive) {
  Say "已在运行，直接打开界面"
  Start-Process $url
  exit 0
}

if (-not (Test-Path $script)) { Write-Host "缺少 $script"; exit 2 }

# 已在跑就不重复启动
$already = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine -match 'chat-console\.mjs' }
if (-not $already) {
  Say "拉起后端（Qwen3.8 加载约 1-2 分钟）"
  Start-Process -FilePath (Get-Command node).Source -ArgumentList $script `
    -WorkingDirectory 'C:\ComfyUI\orchestrator' -WindowStyle Hidden
}

Say "等待界面就绪…"
$ok = $false
for ($i = 0; $i -lt 90; $i++) {
  if (Alive) { $ok = $true; break }
  Start-Sleep -Seconds 2
}

if (-not $ok) {
  Say "后端未在约 3 分钟内就绪"
  Write-Host "请查看 C:\ComfyUI\logs\chat-console.log"
  exit 1
}

Say "就绪，打开浏览器"
Start-Process $url
exit 0
