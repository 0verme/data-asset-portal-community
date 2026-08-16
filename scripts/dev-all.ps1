$ErrorActionPreference = "Stop"

$scriptDir = $PSScriptRoot
$rootDir = Split-Path -Parent $scriptDir

& (Join-Path $rootDir "backend\\scripts\\dev-backend.ps1")
& (Join-Path $rootDir "frontend\\scripts\\dev-frontend.ps1")

Write-Host "Frontend and backend are starting in background."
Write-Host "Unified log root: $(Join-Path $rootDir 'logs')"
