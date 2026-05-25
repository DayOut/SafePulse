param(
    [string]$VmHost = "192.168.50.50",
    [string]$VmUser = "voblaco",
    [string]$VmProjectDir = "/home/voblaco/SafePulse",
    [string]$Image = "voblaco/safe-pulse",
    [string]$Tag = "0.1.0",
    [switch]$Push,
    [switch]$SkipFrontendBuild,
    [switch]$SkipDockerBuild,
    [string]$VmPassword
)

$ErrorActionPreference = "Stop"

function Invoke-Step {
    param(
        [string]$Name,
        [scriptblock]$Action
    )

    Write-Host ""
    Write-Host "==> $Name" -ForegroundColor Cyan
    & $Action
}

function Invoke-Checked {
    param(
        [string]$FilePath,
        [string[]]$Arguments,
        [string]$WorkingDirectory = (Get-Location).Path
    )

    Push-Location $WorkingDirectory
    try {
        & $FilePath @Arguments
        if ($LASTEXITCODE -ne 0) {
            throw "$FilePath exited with code $LASTEXITCODE"
        }
    } finally {
        Pop-Location
    }
}

function New-AskPass {
    param([string]$Password)

    if ([string]::IsNullOrWhiteSpace($Password)) {
        return $null
    }

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

    if ($AskPassPath -and (Test-Path -LiteralPath $AskPassPath)) {
        Remove-Item -LiteralPath $AskPassPath -Force
    }

    Remove-Item Env:\SAFEPULSE_SSH_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:\SSH_ASKPASS -ErrorAction SilentlyContinue
    Remove-Item Env:\SSH_ASKPASS_REQUIRE -ErrorAction SilentlyContinue
    Remove-Item Env:\DISPLAY -ErrorAction SilentlyContinue
}

function Invoke-Remote {
    param([string]$Command)

    Invoke-Checked -FilePath "ssh" -Arguments @(
        "-o", "StrictHostKeyChecking=accept-new",
        "$VmUser@$VmHost",
        $Command
    )
}

function Send-ImageToVm {
    param([string]$ImageRef)

    $remote = "$VmUser@$VmHost"
    $sshArgs = @("-o", "StrictHostKeyChecking=accept-new", $remote, "docker load")

    $docker = New-Object System.Diagnostics.Process
    $docker.StartInfo.FileName = "docker"
    $docker.StartInfo.ArgumentList.Add("save")
    $docker.StartInfo.ArgumentList.Add($ImageRef)
    $docker.StartInfo.RedirectStandardOutput = $true
    $docker.StartInfo.UseShellExecute = $false

    $ssh = New-Object System.Diagnostics.Process
    $ssh.StartInfo.FileName = "ssh"
    foreach ($arg in $sshArgs) {
        $ssh.StartInfo.ArgumentList.Add($arg)
    }
    $ssh.StartInfo.RedirectStandardInput = $true
    $ssh.StartInfo.UseShellExecute = $false

    if (-not $docker.Start()) {
        throw "Failed to start docker save"
    }
    if (-not $ssh.Start()) {
        throw "Failed to start ssh docker load"
    }

    $docker.StandardOutput.BaseStream.CopyTo($ssh.StandardInput.BaseStream)
    $ssh.StandardInput.Close()

    $docker.WaitForExit()
    $ssh.WaitForExit()

    if ($docker.ExitCode -ne 0) {
        throw "docker save exited with code $($docker.ExitCode)"
    }
    if ($ssh.ExitCode -ne 0) {
        throw "remote docker load exited with code $($ssh.ExitCode)"
    }
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$imageRef = "${Image}:${Tag}"
$latestRef = "${Image}:latest"
$askPassPath = $null

try {
    $askPassPath = New-AskPass -Password $VmPassword

    Invoke-Step "Verify local Docker" {
        Invoke-Checked -FilePath "docker" -Arguments @("version") -WorkingDirectory $repoRoot
    }

    if (-not $SkipFrontendBuild) {
        Invoke-Step "Build frontend into wwwroot" {
            Invoke-Checked -FilePath "npm" -Arguments @("run", "build") -WorkingDirectory (Join-Path $repoRoot "web")
        }
    }

    if (-not $SkipDockerBuild) {
        Invoke-Step "Build Docker image $imageRef" {
            Invoke-Checked -FilePath "docker" -Arguments @("build", "-t", $imageRef, "-t", $latestRef, ".") -WorkingDirectory $repoRoot
        }
    }

    if ($Push) {
        Invoke-Step "Push Docker image $imageRef" {
            Invoke-Checked -FilePath "docker" -Arguments @("push", $imageRef) -WorkingDirectory $repoRoot
        }

        Invoke-Step "Push Docker image $latestRef" {
            Invoke-Checked -FilePath "docker" -Arguments @("push", $latestRef) -WorkingDirectory $repoRoot
        }
    }

    Invoke-Step "Load image on VM" {
        Send-ImageToVm -ImageRef $imageRef
    }

    Invoke-Step "Update VM compose file" {
        $remoteCommand = @"
set -e
cd "$VmProjectDir"
cp docker-compose.yml docker-compose.yml.previous
python3 - <<'PY'
from pathlib import Path
p = Path("docker-compose.yml")
s = p.read_text()
if "build: ." in s:
    s = s.replace("    build: .", "    image: $imageRef\n    restart: unless-stopped", 1)
else:
    import re
    s = re.sub(r"    image: ${Image}:[^\n]+", "    image: $imageRef", s, count=1)
p.write_text(s)
PY
docker-compose config >/tmp/safepulse-compose.yml
"@
        Invoke-Remote -Command $remoteCommand
    }

    Invoke-Step "Restart API container" {
        Invoke-Remote -Command "cd `"$VmProjectDir`" && docker-compose up -d --no-deps --force-recreate api && docker-compose ps"
    }

    Invoke-Step "Verify HTTP response" {
        Invoke-Checked -FilePath "curl.exe" -Arguments @("-I", "--max-time", "15", "http://${VmHost}:8080/") -WorkingDirectory $repoRoot
    }

    Write-Host ""
    Write-Host "Deploy complete: $imageRef is running on $VmHost." -ForegroundColor Green
}
finally {
    Clear-AskPass -AskPassPath $askPassPath
}
