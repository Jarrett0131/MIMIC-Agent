param(
  [ValidateSet("offline", "live", "auto")]
  [string]$Mode = "offline",
  [string]$AgentServerUrl = "http://127.0.0.1:3001",
  [switch]$Quiet
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$scriptPath = Join-Path $repoRoot "evaluation\scripts\run-llm-compare.js"

$arguments = @($scriptPath, "--mode", $Mode, "--agent-server-url", $AgentServerUrl)

if ($Quiet.IsPresent) {
  $arguments += "--quiet"
}

node @arguments
