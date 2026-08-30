$root = "D:\Projects\TraeProjects\dsh-codegraph-visualizer"
$existing = Get-NetTCPConnection -LocalPort 3080 -State Listen -ErrorAction SilentlyContinue
if ($existing) {
  Write-Output "ALREADY_LISTENING pid=$($existing[0].OwningProcess)"
  exit 0
}
$logDir = Join-Path $root "dsh-web-run"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$p = Start-Process -FilePath "cmd.exe" -ArgumentList @("/c", "dsh", "web") -WorkingDirectory $root -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logDir "out.log") -RedirectStandardError (Join-Path $logDir "err.log")
Write-Output "STARTED pid=$($p.Id)"