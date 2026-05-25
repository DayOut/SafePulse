param(
    [string]$VmHost = "192.168.50.50",
    [string]$VmUser = "voblaco",
    [string]$VmProjectDir = "/home/voblaco/SafePulse",
    [string]$VmPassword,
    [string]$MongoUsername = "safepulse",
    [string]$MongoPassword,
    [string]$MongoExpressUsername = "admin",
    [string]$MongoExpressPassword
)

$ErrorActionPreference = "Stop"

function Invoke-Step {
    param([string]$Name, [scriptblock]$Action)
    Write-Host ""
    Write-Host "==> $Name" -ForegroundColor Cyan
    & $Action
}

function Invoke-Checked {
    param([string]$FilePath, [string[]]$Arguments, [string]$WorkingDirectory = (Get-Location).Path)
    Push-Location $WorkingDirectory
    try {
        & $FilePath @Arguments
        if ($LASTEXITCODE -ne 0) { throw "$FilePath exited with code $LASTEXITCODE" }
    } finally {
        Pop-Location
    }
}

function New-AskPass {
    param([string]$Password)
    if ([string]::IsNullOrWhiteSpace($Password)) { return $null }
    $askPassPath = Join-Path ([System.IO.Path]::GetTempPath()) ("safepulse-ssh-askpass-{0}.cmd" -f ([guid]::NewGuid().ToString("N")))
    Set-Content -LiteralPath $askPassPath -Value '@echo %SAFEPULSE_SSH_PASSWORD%' -NoNewline
    $env:SAFEPULSE_SSH_PASSWORD = $Password
    $env:SSH_ASKPASS = $askPassPath
    $env:SSH_ASKPASS_REQUIRE = "force"
    $env:DISPLAY = "safepulse"
    return $askPassPath
}

function Clear-AskPass {
    param([string]$AskPassPath)
    if ($AskPassPath -and (Test-Path -LiteralPath $AskPassPath)) { Remove-Item -LiteralPath $AskPassPath -Force }
    Remove-Item Env:\SAFEPULSE_SSH_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:\SSH_ASKPASS -ErrorAction SilentlyContinue
    Remove-Item Env:\SSH_ASKPASS_REQUIRE -ErrorAction SilentlyContinue
    Remove-Item Env:\DISPLAY -ErrorAction SilentlyContinue
}

function Invoke-Remote {
    param([string]$Command)
    Invoke-Checked -FilePath "ssh" -Arguments @("-o", "StrictHostKeyChecking=accept-new", "$VmUser@$VmHost", $Command)
}

function Invoke-Scp {
    param([string]$LocalPath, [string]$RemotePath)
    Invoke-Checked -FilePath "scp" -Arguments @("-o", "StrictHostKeyChecking=accept-new", $LocalPath, "${VmUser}@${VmHost}:${RemotePath}")
}

function New-RandomPassword {
    $bytes = [System.Security.Cryptography.RandomNumberGenerator]::GetBytes(24)
    return [System.Convert]::ToBase64String($bytes) -replace '[+/=]', ''
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$askPassPath = $null

if ([string]::IsNullOrWhiteSpace($MongoPassword)) {
    $MongoPassword = New-RandomPassword
    Write-Host ""
    Write-Host "Generated MongoDB password: $MongoPassword" -ForegroundColor Yellow
    Write-Host "Save this — it will be written to .env on the VM and not shown again." -ForegroundColor Red
}
if ([string]::IsNullOrWhiteSpace($MongoExpressPassword)) {
    $MongoExpressPassword = New-RandomPassword
    Write-Host "Generated mongo-express password (user: $MongoExpressUsername): $MongoExpressPassword" -ForegroundColor Yellow
}

try {
    $askPassPath = New-AskPass -Password $VmPassword

    Invoke-Step "Create MongoDB root user on running instance" {
        $eval = "db.getSiblingDB('admin').createUser({user:'$MongoUsername',pwd:'$MongoPassword',roles:[{role:'root',db:'admin'}]})"
        Invoke-Remote -Command "docker exec safepulse-mongo mongosh --quiet --eval `"$eval`""
    }

    Invoke-Step "Append credentials to .env on VM" {
        $lines = "MONGO_ROOT_USERNAME=$MongoUsername`nMONGO_ROOT_PASSWORD=$MongoPassword`nMONGO_EXPRESS_USERNAME=$MongoExpressUsername`nMONGO_EXPRESS_PASSWORD=$MongoExpressPassword"
        Invoke-Remote -Command "printf '\n# MongoDB auth\n$lines\n' >> $VmProjectDir/.env"
    }

    Invoke-Step "Copy updated docker-compose.yml to VM" {
        # Get the currently running image tag so we can preserve it after SCP
        $currentImage = (Invoke-Remote -Command "docker inspect safepulse-api --format '{{.Config.Image}}'" 2>&1) | Select-Object -Last 1
        if ([string]::IsNullOrWhiteSpace($currentImage)) { $currentImage = "voblaco/safe-pulse:latest" }
        $currentImage = $currentImage.Trim()

        Invoke-Scp -LocalPath (Join-Path $repoRoot "docker-compose.yml") -RemotePath "$VmProjectDir/docker-compose.yml"
        Invoke-Remote -Command @"
cd "$VmProjectDir"
python3 - <<'PY'
from pathlib import Path
p = Path("docker-compose.yml")
s = p.read_text()
if "build: ." in s:
    s = s.replace("    build: .", "    image: $currentImage\n    restart: unless-stopped", 1)
p.write_text(s)
PY
"@
    }

    Invoke-Step "Restart all containers" {
        Invoke-Remote -Command "cd `"$VmProjectDir`" && docker-compose up -d --force-recreate && docker-compose ps"
    }

    Invoke-Step "Verify HTTP response" {
        Invoke-Checked -FilePath "curl.exe" -Arguments @("-I", "--max-time", "15", "http://${VmHost}:8080/")
    }

    Write-Host ""
    Write-Host "MongoDB auth enabled. Credentials written to .env on VM." -ForegroundColor Green
    Write-Host "mongo-express ($MongoExpressUsername / $MongoExpressPassword) at http://${VmHost}:8081/" -ForegroundColor Green
}
finally {
    Clear-AskPass -AskPassPath $askPassPath
}
