Start-Sleep -Seconds 8
try {
    $r = Invoke-WebRequest -Uri 'http://127.0.0.1:3000/api/codegraph/status' -TimeoutSec 10 -UseBasicParsing
    Write-Output "Status: $($r.StatusCode) $($r.Content)"
} catch {
    Write-Output "Error: $($_.Exception.Message)"
}