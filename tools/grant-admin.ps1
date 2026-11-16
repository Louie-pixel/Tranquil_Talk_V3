[CmdletBinding()]param([Parameter(Mandatory=$true)][string]$Email)
$ErrorActionPreference='Stop'
if($Email -notmatch '^[^\s@]+@[^\s@]+\.[^\s@]+$'){throw 'Provide the email of an existing operator account whose ownership you have verified.'}
Push-Location -LiteralPath ([IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')))
try {
    docker compose exec -T app /app/TranquilBackend --grant-admin $Email
    if($LASTEXITCODE -ne 0){throw 'Administrator setup failed. The account must already exist.'}
}finally{Pop-Location}
