#!/usr/bin/env bash
set -euo pipefail

backendDir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
rootDir="$(cd "$backendDir/.." && pwd)"
backendLogDir="$rootDir/logs/backend"
venvPython="$backendDir/.venv/bin/python"

# 后端固定端口，禁止自动切换到其他端口
backendHost="127.0.0.1"
backendPort=5099

if [ ! -x "$venvPython" ]; then
  echo "Project virtualenv python not found: $venvPython" >&2
  exit 1
fi

clear_port() {
  local port="$1"
  local pids
  # 找出监听该端口的进程 PID
  if command -v lsof >/dev/null 2>&1; then
    pids="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)"
  else
    # 回退到 fuser（部分 Linux 无 lsof）
    pids="$(fuser "$port"/tcp 2>/dev/null || true)"
  fi

  for pid in $pids; do
    [ -z "$pid" ] && continue
    echo "Port $port 被占用，结束进程 PID=$pid"
    kill -9 "$pid" 2>/dev/null || echo "无法结束占用 Port $port 的进程 PID=$pid" >&2
  done

  if [ -n "$pids" ]; then
    sleep 0.5
  fi
}

clear_port "$backendPort"

mkdir -p "$backendLogDir"

stdoutPath="$backendLogDir/backend.out.log"
stderrPath="$backendLogDir/backend.err.log"

# backend/asgi.py is the pure FastAPI/Uvicorn production entrypoint.
echo "Starting backend on port $backendPort. Logs:"
echo "  STDOUT -> $stdoutPath"
echo "  STDERR -> $stderrPath"
echo "  APP    -> $backendLogDir/app.log"
echo "  PYTHON -> $venvPython"

cd "$rootDir"
nohup "$venvPython" -m uvicorn backend.asgi:app --host "$backendHost" --port "$backendPort" >>"$stdoutPath" 2>>"$stderrPath" &
echo "Backend started, PID=$!"
