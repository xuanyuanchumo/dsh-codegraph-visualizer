try {
    $r = Invoke-WebRequest -Uri 'http://127.0.0.1:3080/api/codegraph/status' -TimeoutSec 5 -UseBasicParsing
    Write-Output "Status: $($r.StatusCode) $($r.Content)"
} catch {
    Write-Output "Error: $($_.Exception.Message)"
}
