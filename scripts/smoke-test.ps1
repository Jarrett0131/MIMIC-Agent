param(
  [string]$AgentServerUrl = "http://127.0.0.1:3001",
  [string]$DataServiceUrl = "http://127.0.0.1:8000"
)

$ErrorActionPreference = "Stop"

function Write-Step([string]$Message) {
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Ok([string]$Message) {
  Write-Host "OK  $Message" -ForegroundColor Green
}

function Assert-True($Condition, [string]$Message) {
  if (-not $Condition) {
    throw $Message
  }
}

function Invoke-JsonGet([string]$Url) {
  return Invoke-RestMethod -Uri $Url -Method Get -TimeoutSec 15
}

function Invoke-Ask([hashtable]$Payload) {
  return Invoke-RestMethod `
    -Uri "$AgentServerUrl/ask" `
    -Method Post `
    -ContentType "application/json" `
    -Body ($Payload | ConvertTo-Json -Depth 8) `
    -TimeoutSec 30
}

function Assert-AskResult(
  [string]$Label,
  $Response,
  [string]$ExpectedRoute,
  [string]$ExpectedTool
) {
  Assert-True ($Response.success -eq $true) "$Label failed: success=false"

  $actualRoute = if ($Response.routing -and $Response.routing.route_type) {
    [string]$Response.routing.route_type
  } elseif ($Response.question_type) {
    [string]$Response.question_type
  } else {
    ""
  }

  $actualTool = if ($Response.tool_trace -and $Response.tool_trace.Count -gt 0) {
    [string]$Response.tool_trace[0].tool
  } else {
    ""
  }

  Assert-True ($actualRoute -eq $ExpectedRoute) "$Label route mismatch: expected '$ExpectedRoute', got '$actualRoute'"
  Assert-True ($actualTool -eq $ExpectedTool) "$Label tool mismatch: expected '$ExpectedTool', got '$actualTool'"
  Assert-True ([string]::IsNullOrWhiteSpace([string]$Response.answer) -eq $false) "$Label returned an empty answer"

  Write-Ok "$Label passed ($actualRoute -> $actualTool)"
}

Write-Step "Checking health endpoints"
$dataHealth = Invoke-JsonGet "$DataServiceUrl/health"
$agentHealth = Invoke-JsonGet "$AgentServerUrl/health"

Assert-True ($dataHealth.status -eq "ok") "data-service health check failed"
Assert-True (($agentHealth.status -eq "ok") -or ($agentHealth.status -eq "degraded")) "agent-server health check failed"

Write-Ok "data-service health: $($dataHealth.status)"
Write-Ok "agent-server health: $($agentHealth.status)"

Write-Step "Running structured question"
$structuredResponse = Invoke-Ask @{
  hadm_id = 20626031
  question = "latest glucose lab result"
  context = @{
    hadm_id = 20626031
    last_question_type = $null
  }
}
Assert-AskResult `
  -Label "Structured question" `
  -Response $structuredResponse `
  -ExpectedRoute "lab_query" `
  -ExpectedTool "fetchRecentLabs"

Write-Step "Running RAG question"
$ragResponse = Invoke-Ask @{
  hadm_id = 20626031
  question = "what does pulse measure?"
  context = @{
    hadm_id = 20626031
    last_question_type = $null
  }
}
Assert-AskResult `
  -Label "RAG question" `
  -Response $ragResponse `
  -ExpectedRoute "metric_explanation" `
  -ExpectedTool "retrieveKnowledge"

Write-Step "Running follow-up question"
$followUpResponse = Invoke-Ask @{
  hadm_id = 20297618
  question = "And patient info?"
  context = @{
    hadm_id = 20297618
    last_question_type = "diagnosis_query"
  }
}
Assert-AskResult `
  -Label "Follow-up question" `
  -Response $followUpResponse `
  -ExpectedRoute "patient_info" `
  -ExpectedTool "fetchPatient"

Write-Host ""
Write-Host "Smoke test summary" -ForegroundColor Cyan
Write-Host "  health:     passed"
Write-Host "  structured: passed"
Write-Host "  rag:        passed"
Write-Host "  follow-up:  passed"
