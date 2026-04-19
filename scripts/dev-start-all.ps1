param(
  [switch]$SkipFrontend,
  [switch]$SkipHealthCheck
)

$ErrorActionPreference = "Stop"

function Write-Step([string]$Message) {
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Ok([string]$Message) {
  Write-Host "OK  $Message" -ForegroundColor Green
}

function Write-WarnLine([string]$Message) {
  Write-Host "WARN $Message" -ForegroundColor Yellow
}

function Get-RepoRoot {
  return Split-Path -Parent $PSScriptRoot
}

function Get-PythonCommand {
  if (Get-Command python -ErrorAction SilentlyContinue) {
    return "python"
  }

  if (Get-Command py -ErrorAction SilentlyContinue) {
    return "py -3"
  }

  throw "Python was not found. Install Python or add it to PATH before running this script."
}

function Assert-PathExists([string]$Path, [string]$Label) {
  if (-not (Test-Path -LiteralPath $Path)) {
    throw "$Label not found: $Path"
  }
}

function Start-ServiceWindow(
  [string]$Name,
  [string]$WorkingDirectory,
  [string]$Command
) {
  $script = @"
Set-Location -LiteralPath '$WorkingDirectory'
Write-Host '[$Name] working directory: $WorkingDirectory' -ForegroundColor Cyan
$Command
"@

  $process = Start-Process -FilePath "powershell" `
    -ArgumentList @("-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $script) `
    -PassThru

  Write-Ok "Started $Name in a new PowerShell window (PID $($process.Id))."
  return $process
}

function Wait-ForUrl(
  [string]$Name,
  [string]$Url,
  [int]$TimeoutSeconds = 40
) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)

  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
        Write-Ok "$Name is reachable: $Url"
        return $true
      }
    } catch {
      Start-Sleep -Seconds 2
    }
  }

  Write-WarnLine "$Name did not become reachable in time: $Url"
  return $false
}

$repoRoot = Get-RepoRoot
$dataServiceDir = Join-Path $repoRoot "data-service"
$agentServerDir = Join-Path $repoRoot "agent-server"
$frontendDir = Join-Path $repoRoot "frontend"

Assert-PathExists $dataServiceDir "data-service directory"
Assert-PathExists $agentServerDir "agent-server directory"
Assert-PathExists $frontendDir "frontend directory"

$pythonCommand = Get-PythonCommand

Write-Step "Starting data-service"
$null = Start-ServiceWindow `
  -Name "data-service" `
  -WorkingDirectory $dataServiceDir `
  -Command "$pythonCommand run.py"

Write-Step "Starting agent-server"
$null = Start-ServiceWindow `
  -Name "agent-server" `
  -WorkingDirectory $agentServerDir `
  -Command "npm run dev"

if (-not $SkipFrontend) {
  Write-Step "Starting frontend"
  $null = Start-ServiceWindow `
    -Name "frontend" `
    -WorkingDirectory $frontendDir `
    -Command "npm run dev"
}

if (-not $SkipHealthCheck) {
  Write-Step "Waiting for service health checks"
  Wait-ForUrl -Name "data-service" -Url "http://127.0.0.1:8000/health" | Out-Null
  Wait-ForUrl -Name "agent-server" -Url "http://127.0.0.1:3001/health" | Out-Null

  if (-not $SkipFrontend) {
    Wait-ForUrl -Name "frontend" -Url "http://localhost:5173" | Out-Null
  }
}

Write-Host ""
Write-Host "Started services:" -ForegroundColor Cyan
Write-Host "  data-service: http://127.0.0.1:8000"
Write-Host "  agent-server: http://127.0.0.1:3001"
if (-not $SkipFrontend) {
  Write-Host "  frontend:     http://localhost:5173"
}

Write-Host ""
Write-Host "Tips:" -ForegroundColor Cyan
Write-Host "  1. Fill agent-server/.env if you want live LLM rewrite and answer enhancement."
Write-Host "  2. Run scripts/smoke-test.ps1 after health checks pass."
Write-Host "  3. Use -SkipFrontend if you only need backend services."
