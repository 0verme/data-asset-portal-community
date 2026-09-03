$ErrorActionPreference = "Stop"

$backendDir = Split-Path -Parent $PSScriptRoot
$rootDir = Split-Path -Parent $backendDir
$backendLogDir = Join-Path $rootDir "logs/backend"
$venvPython = Join-Path $backendDir ".venv\\Scripts\\python.exe"

# 后端固定端口，禁止自动切换到其他端口
$backendHost = "127.0.0.1"
$backendPort = 15099

if (-not (Test-Path $venvPython)) {
  throw "Project virtualenv python not found: $venvPython"
}

function Clear-Port {
  param([int]$Port)

  # 找出监听该端口的进程 PID（TCP Listen）
  $listenPids = @()
  try {
    $listenPids = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop |
      Select-Object -ExpandProperty OwningProcess -Unique
  } catch {
    # 旧系统无 Get-NetTCPConnection 时回退到 netstat
    $listenPids = netstat -ano -p tcp |
      Select-String ":$Port\s+.*LISTENING" |
      ForEach-Object { ($_ -split '\s+')[-1] } |
      Sort-Object -Unique
  }

  foreach ($processId in $listenPids) {
    if (-not $processId) { continue }
    try {
      $proc = Get-Process -Id $processId -ErrorAction Stop
      Write-Host "Port $Port 被占用，结束进程 PID=$processId ($($proc.ProcessName))"
      Stop-Process -Id $processId -Force -ErrorAction Stop
    } catch {
      Write-Warning "无法结束占用 Port $Port 的进程 PID=$processId : $($_.Exception.Message)"
    }
  }

  if ($listenPids -and @($listenPids).Count -gt 0) {
    Start-Sleep -Milliseconds 500
  }
}

Clear-Port -Port $backendPort

New-Item -ItemType Directory -Path $backendLogDir -Force | Out-Null

$stdoutPath = Join-Path $backendLogDir "backend.out.log"
$stderrPath = Join-Path $backendLogDir "backend.err.log"

# backend/asgi.py is the pure FastAPI/Uvicorn production entrypoint.
Write-Host "Starting backend on port $backendPort. Logs:"
Write-Host "  STDOUT -> $stdoutPath"
Write-Host "  STDERR -> $stderrPath"
Write-Host "  APP    -> $(Join-Path $backendLogDir 'app.log')"
Write-Host "  PYTHON -> $venvPython"

Start-Process -FilePath $venvPython `
  -ArgumentList "-m", "uvicorn", "backend.asgi:app", "--host", $backendHost, "--port", $backendPort `
  -WorkingDirectory $rootDir `
  -RedirectStandardOutput $stdoutPath `
  -RedirectStandardError $stderrPath `
  -WindowStyle Hidden
