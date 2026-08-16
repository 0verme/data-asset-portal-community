$ErrorActionPreference = "Stop"

$frontendDir = Split-Path -Parent $PSScriptRoot
$rootDir = Split-Path -Parent $frontendDir
$frontendLogDir = Join-Path $rootDir "logs/frontend"

New-Item -ItemType Directory -Path $frontendLogDir -Force | Out-Null

$stdoutPath = Join-Path $frontendLogDir "frontend.out.log"
$stderrPath = Join-Path $frontendLogDir "frontend.err.log"

Write-Host "Starting frontend. Logs:"
Write-Host "  STDOUT -> $stdoutPath"
Write-Host "  STDERR -> $stderrPath"

Start-Process -FilePath "cmd.exe" `
  -ArgumentList "/c", "npm run dev 1>> `"$stdoutPath`" 2>> `"$stderrPath`"" `
  -WorkingDirectory $frontendDir `
  -WindowStyle Hidden
