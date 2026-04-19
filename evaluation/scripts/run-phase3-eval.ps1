param(
  [ValidateSet("offline", "live", "auto")]
  [string]$Mode = "offline",
  [string]$AgentServerUrl = "http://127.0.0.1:3001",
  [switch]$NoExperiment
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$scriptPath = Join-Path $repoRoot "evaluation\scripts\run-phase3-eval.js"

$arguments = @($scriptPath, "--mode", $Mode, "--agent-server-url", $AgentServerUrl)

if ($NoExperiment.IsPresent) {
  $arguments += "--no-experiment"
}

node @arguments

