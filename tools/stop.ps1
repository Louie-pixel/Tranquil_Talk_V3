[CmdletBinding()]param()
$ErrorActionPreference='Stop'
Push-Location -LiteralPath ([IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')))
try {
    docker compose stop
    if($LASTEXITCODE -ne 0){throw 'Could not stop Docker services.'}
    Write-Host 'Services stopped. Database and local inbox volumes are preserved.'
}finally{Pop-Location}
