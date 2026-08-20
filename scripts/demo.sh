#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root_dir="$(cd "$script_dir/.." && pwd)"

if [ -x "$root_dir/backend/.venv/bin/python" ]; then
  python_command="$root_dir/backend/.venv/bin/python"
elif command -v python3 >/dev/null 2>&1; then
  python_command="$(command -v python3)"
elif command -v python >/dev/null 2>&1; then
  python_command="$(command -v python)"
else
  echo "Python 3.10+ was not found. Install Python and retry: $0" >&2
  exit 1
fi

exec "$python_command" "$root_dir/scripts/community_demo.py" "$@"
