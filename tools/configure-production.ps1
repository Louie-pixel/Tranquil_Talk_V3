[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][ValidatePattern('^(?=.{1,253}$)([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$')][string]$Domain,
    [Parameter(Mandatory=$true)][ValidatePattern('^[^\r\n]+@[^\r\n]+$')][string]$MailFrom,
    [Parameter(Mandatory=$true)][ValidatePattern('^turns?:[^\s]+$')][string]$TurnUrl
)
$ErrorActionPreference='Stop'
$projectRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$secretDirectory=Join-Path $projectRoot 'deploy\secrets'
$configFile=Join-Path $projectRoot '.env.production'
if(Test-Path -LiteralPath $configFile){throw 'Production configuration exists. Edit it deliberately; this tool does not overwrite an existing deployment.'}
if(Test-Path -LiteralPath $secretDirectory){throw 'A production secret directory already exists. Preserve existing database and relay credentials; complete configuration manually.'}
function RandomSecret {
    $bytes=New-Object byte[] 48;$rng=[Security.Cryptography.RandomNumberGenerator]::Create()
    try{$rng.GetBytes($bytes)}finally{$rng.Dispose()}
    return [Convert]::ToBase64String($bytes)
}
function ReadSecret([string]$Prompt){
    $secured=Read-Host -Prompt $Prompt -AsSecureString
    $pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secured)
    try{return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)}
}
$resend=ReadSecret 'Resend API key for your verified sender'
$turn=ReadSecret 'Existing TURN REST shared secret (must match your relay)'
if([string]::IsNullOrWhiteSpace($resend) -or $resend -match '[\r\n]' -or $turn.Length -lt 32 -or $turn -match '[\r\n]'){throw 'A valid mail key and relay secret of at least 32 characters are required.'}
New-Item -ItemType Directory -Path $secretDirectory | Out-Null
$appUser='tranquil_app';$appPassword=RandomSecret
$secrets=@{
    'jwt-secret'=(RandomSecret);'resend-key'=$resend;'turn-secret'=$turn;
    'mongo-root-user'='tranquil_operator';'mongo-root-password'=(RandomSecret);
    'mongo-app-user'=$appUser;'mongo-app-password'=$appPassword;'mongo-cluster-key'=(RandomSecret);
    'mongo-uri'=('mongodb://'+$appUser+':'+[Uri]::EscapeDataString($appPassword)+'@mongo:27017/tranquil_talk?authSource=tranquil_talk&replicaSet=rs0&serverSelectionTimeoutMS=5000')
}
$encoding=New-Object Text.UTF8Encoding($false)
foreach($name in $secrets.Keys){[IO.File]::WriteAllText((Join-Path $secretDirectory $name),$secrets[$name],$encoding)}
[IO.File]::WriteAllText($configFile,('DOMAIN='+$Domain+"`nMAIL_FROM="+$MailFrom+"`nTURN_URL="+$TurnUrl+"`nCLINIC_OSM_ENABLED=false`n"),$encoding)
Write-Host 'Production files prepared. Restrict access to deploy/secrets on your server before launch.'
Write-Host 'Keep an encrypted copy of database credentials and the cluster key. Do not regenerate them for an existing volume.'
Write-Host 'Start on your deployment host: docker compose --env-file .env.production -f compose.live.yaml up -d --build --wait'
