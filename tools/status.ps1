[CmdletBinding()]param([ValidateRange(1024,65535)][int]$Port=8080)
$ErrorActionPreference='Stop'
Push-Location -LiteralPath ([IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')))
try {
    docker compose ps
    if($LASTEXITCODE -ne 0){throw 'Could not inspect Docker services.'}
    $result=Invoke-RestMethod -Uri ('http://127.0.0.1:'+$Port+'/api/health') -TimeoutSec 10
    $result | Format-List
}finally{Pop-Location}
