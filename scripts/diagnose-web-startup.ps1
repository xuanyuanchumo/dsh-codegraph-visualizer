﻿﻿# dsh web 启动耗时诊断脚本
# 用途：后台启动 dsh web，轮询 3080 端口，记录启动耗时基线并捕获日志
param(
  [int]$Port = 3080,
  [int]$TimeoutSec = 180,
  [string]$Profile = "web"
)

$logDir = Join-Path $env:TEMP "dsh-web-diag"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$outLog = Join-Path $logDir "out.log"
$errLog = Join-Path $logDir "err.log"
Remove-Item $outLog, $errLog -ErrorAction SilentlyContinue

$dshCmd = "D:\JetBrains\nvm\node_global\dsh.cmd"

Write-Host "[diagnose] 启动 dsh web (port=$Port, timeout=${TimeoutSec}s)..."

$sw = [System.Diagnostics.Stopwatch]::StartNew()
$proc = Start-Process -FilePath $dshCmd `
  -ArgumentList @("--profile", "$Profile", "--no-open", "--port", "$Port") `
  -WorkingDirectory $env:USERPROFILE `
  -RedirectStandardOutput $outLog `
  -RedirectStandardError $errLog `
  -PassThru -WindowStyle Hidden

$httpStatus = $null
$serverReady = $false
$deadline = (Get-Date).AddSeconds($TimeoutSec)

while ((Get-Date) -lt $deadline -and -not $proc.HasExited) {
  try {
    $r = Invoke-WebRequest -Uri "http://localhost:$Port/" -TimeoutSec 3 -UseBasicParsing
    if ($r.StatusCode -eq 200) {
      $httpStatus = $r.StatusCode
      $serverReady = $true
      break
    }
  } catch {
    # 未就绪，继续轮询
  }
  Start-Sleep -Milliseconds 500
}

$sw.Stop()

Write-Host "`n===== 诊断结果 ====="
Write-Host "服务器就绪:      $serverReady"
Write-Host "HTTP 状态码:     $httpStatus"
Write-Host "启动耗时(秒):    $([math]::Round($sw.Elapsed.TotalSeconds, 2))"
Write-Host "进程已退出:      $($proc.HasExited)"
if ($proc.HasExited) {
  Write-Host "退出码:          $($proc.ExitCode)"
}

Write-Host "`n===== stdout 尾部 ====="
if (Test-Path $outLog) { Get-Content $outLog -Tail 40 }
Write-Host "`n===== stderr 尾部 ====="
if (Test-Path $errLog) { Get-Content $errLog -Tail 40 }

# 清理：关闭服务器
if (-not $proc.HasExited) {
  Write-Host "`n[diagnose] 关闭 dsh web 进程 (PID=$($proc.Id))..."
  Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
}

Write-Host "`n日志文件: $outLog / $errLog"