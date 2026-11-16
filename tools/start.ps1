[CmdletBinding()]
param([ValidateRange(1024,65535)][int]$Port=8080)
$ErrorActionPreference='Stop'
$projectRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Push-Location -LiteralPath $projectRoot
try {
    $docker=Get-Command docker -ErrorAction SilentlyContinue
    if(-not $docker){throw 'Docker Desktop with Linux containers is required. Install/open Docker Desktop, then run this script again. The layout preview cannot run the backend.'}
    & $docker.Source info --format '{{.OSType}}' 2>$null | Out-Null
    if($LASTEXITCODE -ne 0){throw 'Docker is installed but its engine is not ready. Open Docker Desktop, wait for Linux containers to be ready, and retry.'}
    & $docker.Source compose version | Out-Null
    if($LASTEXITCODE -ne 0){throw 'Docker Compose v2 is required.'}
    if(-not (Test-Path -LiteralPath '.env')){
        $secretBytes=New-Object byte[] 48
        $generator=[Security.Cryptography.RandomNumberGenerator]::Create()
        try{$generator.GetBytes($secretBytes)}finally{$generator.Dispose()}
        $secret=[Convert]::ToBase64String($secretBytes)
        $config=[IO.File]::ReadAllText((Join-Path $projectRoot '.env.example'))
        $config=$config -replace '(?m)^JWT_SECRET=.*$',('JWT_SECRET='+$secret)
        [IO.File]::WriteAllText((Join-Path $projectRoot '.env'),$config,(New-Object Text.UTF8Encoding($false)))
        Write-Host 'Created local configuration with a generated signing key.'
    }
    # Process-scoped overrides keep existing user configuration intact.
    $priorPort=$env:APP_PORT;$priorOrigin=$env:APP_BASE_URL
    try {
        $env:APP_PORT=[string]$Port;$env:APP_BASE_URL='http://localhost:'+$Port
        & $docker.Source compose up -d --build --wait --wait-timeout 1800
        if($LASTEXITCODE -ne 0){throw 'Startup failed. Run docker compose logs app mongo mailpit to inspect the services.'}
        $health=Invoke-RestMethod -Uri ('http://127.0.0.1:'+$Port+'/api/health') -TimeoutSec 10
        if(-not $health.ready){throw 'The API did not become ready.'}
        Write-Host ('Application: http://localhost:'+$Port)
        Write-Host 'Local email inbox: http://localhost:8025 (or your configured MAILBOX_PORT)'
        Write-Host 'Create an account, request verification in Account, and open the verification email in the local inbox.'
        Write-Host 'No professional or administrator accounts are created automatically.'
    }finally{$env:APP_PORT=$priorPort;$env:APP_BASE_URL=$priorOrigin}
}finally{Pop-Location}
