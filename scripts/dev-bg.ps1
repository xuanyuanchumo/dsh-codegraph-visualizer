﻿$root = Split-Path -Parent $PSScriptRoot
$existing = Get-NetTCPConnection -LocalPort 3080 -State Listen -ErrorAction SilentlyContinue
if ($existing) {
  Write-Output "ALREADY_LISTENING pid=$($existing[0].OwningProcess)"
  exit 0
}
$p = Start-Process -FilePath "node" -ArgumentList (Join-Path $root "scripts/dev-server.mjs") -WorkingDirectory $root -WindowStyle Hidden -PassThru
Start-Sleep -Seconds 3
if ($p.HasExited) {
  Write-Output "EXITED code=$($p.ExitCode)"
} else {
  Write-Output "STARTED pid=$($p.Id)"
}