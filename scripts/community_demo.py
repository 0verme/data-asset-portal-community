#!/usr/bin/env python3
"""One-command Community Demo bootstrap.

This module intentionally orchestrates the existing migration, seed, Flask and
Vite entry points.  It never reads an external database configuration and never
writes the user's .env files.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import secrets
import shutil
import signal
import socket
import stat
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Mapping


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
BACKEND_PORT = 5099
FRONTEND_PORT = 5173
COMMUNITY_MODULES = "portal,dwm,mapping,lineage,root,indicator,apiAsset,system"
PYTHON_MINIMUM = (3, 10)
NODE_MINIMUM = (22, 13, 0)


class BootstrapError(RuntimeError):
    """An actionable bootstrap failure."""


@dataclass(frozen=True)
class DemoPaths:
    root: Path
    runtime: Path
    database: Path
    database_config: Path
    secret: Path
    frontend_env: Path
    backend_venv: Path

    @classmethod
    def for_root(cls, root: Path = ROOT) -> "DemoPaths":
        root = root.resolve()
        runtime = root / ".demo" / "community-demo"
        return cls(
            root=root,
            runtime=runtime,
            database=runtime / "community.sqlite",
            database_config=runtime / "database.yaml",
            secret=runtime / "flask-secret.key",
            frontend_env=runtime / "frontend.env",
            backend_venv=root / "backend" / ".venv",
        )

    @property
    def backend_python(self) -> Path:
        name = "python.exe" if os.name == "nt" else "python"
        return self.backend_venv / ("Scripts" if os.name == "nt" else "bin") / name


def _ensure_directory(path: Path) -> None:
    for candidate in (path.parent, path):
        if candidate.exists() and candidate.is_symlink():
            raise BootstrapError(f"Refusing to use symlinked demo runtime directory: {candidate}")
    path.mkdir(parents=True, exist_ok=True)


def _write_generated_file(path: Path, content: str, *, private: bool = False) -> None:
    if path.exists() and path.is_symlink():
        raise BootstrapError(f"Refusing to overwrite symlinked generated file: {path}")
    _ensure_directory(path.parent)
    fd, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        if private and os.name != "nt":
            os.chmod(temporary, stat.S_IRUSR | stat.S_IWUSR)
        os.replace(temporary, path)
        if private and os.name != "nt":
            os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)
    finally:
        temporary.unlink(missing_ok=True)


def _load_or_create_secret(path: Path) -> str:
    if path.exists():
        if path.is_symlink():
            raise BootstrapError(f"Refusing to read symlinked demo secret: {path}")
        value = path.read_text(encoding="utf-8").strip()
        if len(value) >= 48:
            return value
    value = secrets.token_urlsafe(48)
    _write_generated_file(path, value + "\n", private=True)
    return value


def prepare_demo_runtime(paths: DemoPaths) -> str:
    """Create only bootstrap-owned files and return the persisted secret."""
    _ensure_directory(paths.runtime)
    database_literal = json.dumps(str(paths.database.resolve()))
    _write_generated_file(
        paths.database_config,
        "defaults:\n"
        "  type: sqlite\n"
        "profiles:\n"
        "  community_sqlite:\n"
        "    type: sqlite\n"
        f"    database: {database_literal}\n",
    )
    _write_generated_file(
        paths.frontend_env,
        "VITE_API_MODE=remote\n"
        "VITE_API_BASE_URL=/api\n"
        f"VITE_BACKEND_URL=http://127.0.0.1:{BACKEND_PORT}\n",
    )
    return _load_or_create_secret(paths.secret)


def _is_database_environment_key(key: str) -> bool:
    upper = key.upper()
    if upper in {
        "DATABASE_URL",
        "DATABASE_PROFILE",
        "SQLALCHEMY_DATABASE_URI",
        "PGHOST",
        "PGPORT",
        "PGDATABASE",
        "PGUSER",
        "PGPASSWORD",
        "PGSERVICE",
        "MYSQL_HOST",
        "MYSQL_PORT",
        "MYSQL_DATABASE",
        "MYSQL_USER",
        "MYSQL_PASSWORD",
    }:
        return True
    return (
        upper.startswith("ASSET_DB_")
        or upper.startswith("DB_")
        or upper.startswith("PG_")
        or upper.startswith("MYSQL_")
    )


def build_demo_environment(
    base_environment: Mapping[str, str] | None,
    paths: DemoPaths,
    secret: str,
) -> dict[str, str]:
    """Build a child environment with an explicit SQLite-only boundary."""
    environment = {
        key: value
        for key, value in (base_environment or os.environ).items()
        if not _is_database_environment_key(key)
        and not key.upper().startswith("VITE_")
        and key.upper() not in {
            "ASSET_RUNTIME_PROFILE",
            "ASSET_EDITION",
            "ASSET_ENABLED_MODULES",
            "ASSET_DISABLED_MODULES",
            "FLASK_ENV",
            "FLASK_DEBUG",
            "FLASK_HOST",
            "FLASK_PORT",
            "FLASK_SECRET_KEY",
            "FLASK_CORS_ORIGINS",
            "COMMUNITY_DEMO_BOOTSTRAP",
        }
    }
    environment.update(
        {
            "COMMUNITY_DEMO_BOOTSTRAP": "1",
            "ASSET_RUNTIME_PROFILE": "community",
            "ASSET_EDITION": "community",
            "ASSET_ENABLED_MODULES": COMMUNITY_MODULES,
            "ASSET_DISABLED_MODULES": "upstream,push,report,codeTable",
            "ASSET_DB_CONFIG_PATH": str(paths.database_config.resolve()),
            "ASSET_DB_PROFILE": "community_sqlite",
            "ASSET_AUTH_DB_PROFILE": "community_sqlite",
            "ASSET_DB_TYPE": "sqlite",
            "ASSET_DB_DATABASE": str(paths.database.resolve()),
            "FLASK_ENV": "development",
            "FLASK_DEBUG": "false",
            "FLASK_HOST": "127.0.0.1",
            "FLASK_PORT": str(BACKEND_PORT),
            "FLASK_SECRET_KEY": secret,
            "FLASK_CORS_ORIGINS": f"http://127.0.0.1:{FRONTEND_PORT},http://localhost:{FRONTEND_PORT}",
            "VITE_API_MODE": "remote",
            "VITE_API_BASE_URL": "/api",
            "VITE_BACKEND_URL": f"http://127.0.0.1:{BACKEND_PORT}",
        }
    )
    return environment


def _run(command: list[str], *, cwd: Path, environment: Mapping[str, str], label: str) -> None:
    print(f"[demo] {label}", flush=True)
    try:
        result = subprocess.run(command, cwd=cwd, env=dict(environment), check=False)
    except OSError as error:
        raise BootstrapError(f"{label} failed to start: {error}") from error
    if result.returncode != 0:
        raise BootstrapError(f"{label} failed with exit code {result.returncode}.")


def _run_capture(command: list[str], *, cwd: Path) -> tuple[int, str, str]:
    try:
        result = subprocess.run(
            command,
            cwd=cwd,
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError as error:
        raise BootstrapError(f"Unable to execute {command[0]}: {error}") from error
    return result.returncode, result.stdout.strip(), result.stderr.strip()


def _parse_version(value: str, tool: str) -> tuple[int, ...]:
    match = re.search(r"(\d+)\.(\d+)(?:\.(\d+))?", value)
    if not match:
        raise BootstrapError(f"Could not determine {tool} version from: {value}")
    return tuple(int(item or 0) for item in match.groups())


def check_python() -> None:
    if sys.version_info[:2] < PYTHON_MINIMUM:
        required = ".".join(map(str, PYTHON_MINIMUM))
        raise BootstrapError(
            f"Python {required}+ is required, but {sys.version.split()[0]} is active. "
            "Install a supported Python and retry the demo command."
        )


def find_node_and_npm() -> tuple[str, str]:
    node = shutil.which("node")
    if not node:
        raise BootstrapError(
            "Node.js was not found. Community Demo requires Node.js >= 22.13.0. "
            "Install Node.js from https://nodejs.org/ and retry the demo command."
        )
    code, stdout, stderr = _run_capture([node, "--version"], cwd=ROOT)
    if code != 0:
        raise BootstrapError(f"Node.js version check failed: {stderr or stdout}")
    version = _parse_version(stdout, "Node.js")
    if version < NODE_MINIMUM:
        raise BootstrapError(
            f"Node.js {'.'.join(map(str, NODE_MINIMUM))}+ is required, but {stdout}. "
            "Upgrade Node.js and retry the demo command."
        )
    npm = shutil.which("npm")
    if not npm:
        raise BootstrapError(
            "npm was not found. Install npm bundled with a supported Node.js release "
            "and retry the demo command."
        )
    npm_code, npm_stdout, npm_stderr = _run_capture([npm, "--version"], cwd=ROOT)
    if npm_code != 0:
        raise BootstrapError(f"npm version check failed: {npm_stderr or npm_stdout}")
    npm_version = _parse_version(npm_stdout, "npm")
    if npm_version < (10, 0, 0):
        raise BootstrapError(
            f"npm 10+ is required, but {npm_stdout}. Upgrade npm with a supported Node.js release "
            "and retry the demo command."
        )
    return node, npm


def ensure_backend_python(paths: DemoPaths) -> Path:
    check_python()
    python = paths.backend_python
    if not python.is_file():
        print(f"[demo] backend virtualenv not found; creating {paths.backend_venv}", flush=True)
        _run(
            [sys.executable, "-m", "venv", str(paths.backend_venv)],
            cwd=paths.root,
            environment=os.environ,
            label="Create backend virtualenv",
        )
    code, _stdout, _stderr = _run_capture(
        [str(python), "-c", "import flask, flask_cors, psycopg, yaml, werkzeug"],
        cwd=paths.root,
    )
    if code != 0:
        print("[demo] backend dependencies are missing; installing backend/requirements.txt", flush=True)
        _run(
            [str(python), "-m", "pip", "install", "-r", str(paths.root / "backend" / "requirements.txt")],
            cwd=paths.root,
            environment=os.environ,
            label="Install backend dependencies",
        )
    return python


def _npm_environment() -> dict[str, str]:
    environment = dict(os.environ)
    # npm skips devDependencies when NODE_ENV=production or omit=dev is
    # inherited from a user's shell.  The local Vite server is a devDependency.
    environment["NODE_ENV"] = "development"
    environment.pop("NPM_CONFIG_PRODUCTION", None)
    environment.pop("NPM_CONFIG_OMIT", None)
    return environment


def ensure_frontend_dependencies(paths: DemoPaths, npm: str) -> None:
    vite_entry = paths.root / "frontend" / "node_modules" / ".bin" / ("vite.cmd" if os.name == "nt" else "vite")
    if vite_entry.is_file():
        return
    print("[demo] frontend dependencies are missing; running npm ci in frontend/", flush=True)
    _run(
        [npm, "ci"],
        cwd=paths.root / "frontend",
        environment=_npm_environment(),
        label="Install frontend dependencies",
    )


def initialize_demo(paths: DemoPaths) -> tuple[dict[str, str], Path]:
    check_python()
    node, npm = find_node_and_npm()
    python = ensure_backend_python(paths)
    ensure_frontend_dependencies(paths, npm)
    secret = prepare_demo_runtime(paths)
    environment = build_demo_environment(os.environ, paths, secret)
    print(f"[demo] using Node.js {node} and backend Python {python}", flush=True)
    _run(
        [
            str(python),
            str(paths.root / "backend" / "scripts" / "schema_migrate.py"),
            "apply",
            "--profile",
            "community_sqlite",
            "--config",
            str(paths.database_config),
            "--modules",
            COMMUNITY_MODULES,
        ],
        cwd=paths.root,
        environment=environment,
        label="Apply Community SQLite migrations",
    )
    _run(
        [
            str(python),
            str(paths.root / "demo" / "seed_sqlite.py"),
            "--database",
            str(paths.database),
        ],
        cwd=paths.root,
        environment=environment,
        label="Seed Community demo data",
    )
    verify_demo_database(paths.database)
    return environment, python


def verify_demo_database(database: Path) -> dict[str, int]:
    """Verify canonical seed volumes and the Community-only physical boundary."""
    import sqlite3

    from demo.seed_loader import ADMIN_USER, community_seed_plan

    if not database.is_file():
        raise BootstrapError(f"Demo database was not created: {database}")
    connection = sqlite3.connect(database)
    try:
        tables = {
            row[0]
            for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        private_markers = ("push", "upstream", "report", "code_table", "manual_code")
        private = sorted(name for name in tables if any(marker in name for marker in private_markers))
        if private:
            raise BootstrapError(f"Community SQLite contains private tables: {', '.join(private)}")
        counts: dict[str, int] = {}
        for table, spec in community_seed_plan().items():
            count = connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            expected = len(spec["rows"])
            if count != expected:
                raise BootstrapError(f"Unexpected Community demo count for {table}: {count} (expected {expected})")
            counts[table] = count
        admin_count = connection.execute(
            "SELECT COUNT(*) FROM p_admin_user WHERE username = ?", (ADMIN_USER["username"],)
        ).fetchone()[0]
        if admin_count != 1:
            raise BootstrapError(f"Community demo account count is {admin_count} (expected 1)")
        counts[f"p_admin_user:{ADMIN_USER['username']}"] = admin_count
        print(
            "[demo] verified Community data: "
            f"p_asset_table={counts['p_asset_table']}, "
            f"p_asset_field={counts['p_asset_field']}, "
            f"p_api_asset={counts['p_api_asset']}, "
            f"{ADMIN_USER['username']}=1",
            flush=True,
        )
        return counts
    finally:
        connection.close()


def _port_is_open(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as connection:
        connection.settimeout(0.2)
        return connection.connect_ex(("127.0.0.1", port)) == 0


def check_ports() -> None:
    conflicts = []
    for port, service in ((BACKEND_PORT, "backend"), (FRONTEND_PORT, "frontend")):
        if _port_is_open(port):
            conflicts.append(f"{service} port {port}")
    if conflicts:
        raise BootstrapError(
            "Port conflict detected: "
            + ", ".join(conflicts)
            + ". Stop the service that owns the port or choose a clean local machine before retrying; "
            "the bootstrap will not terminate unknown processes."
        )


def _popen_kwargs() -> dict[str, Any]:
    if os.name == "nt":
        return {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP}
    return {"start_new_session": True}


def _terminate_process(process, label: str) -> None:
    if process.poll() is not None:
        return
    print(f"[demo] stopping {label} (owned PID={process.pid})", flush=True)
    if os.name == "nt":
        # The PID is the process created by this bootstrap; /T only cleans its
        # child tree.  Never use image-wide taskkill or kill unrelated PIDs.
        subprocess.run(
            ["taskkill", "/PID", str(process.pid), "/T", "/F"],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    else:
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            return
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        if os.name != "nt":
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        process.wait(timeout=5)


def _wait_for_http(url: str, process, label: str, timeout: float = 30) -> None:
    deadline = time.monotonic() + timeout
    last_error = "not reachable"
    while time.monotonic() < deadline:
        return_code = process.poll()
        if return_code is not None:
            raise BootstrapError(f"{label} exited before readiness check (exit code {return_code}).")
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                if 200 <= response.status < 500:
                    return
                last_error = f"HTTP {response.status}"
        except urllib.error.HTTPError as error:
            if 400 <= error.code < 500:
                return
            last_error = f"HTTP {error.code}"
        except (OSError, urllib.error.URLError) as error:
            last_error = str(error)
        time.sleep(0.25)
    raise BootstrapError(f"{label} did not become ready at {url}: {last_error}")


def run_demo(paths: DemoPaths, environment: Mapping[str, str], python: Path) -> None:
    check_ports()
    processes = []
    backend_command = [str(python), str(paths.root / "backend" / "run.py")]
    frontend_command = [
        shutil.which("npm") or "npm",
        "run",
        "dev",
        "--",
        "--host",
        "127.0.0.1",
        "--port",
        str(FRONTEND_PORT),
        "--strictPort",
    ]
    try:
        print("[demo] starting backend", flush=True)
        backend = subprocess.Popen(backend_command, cwd=paths.root / "backend", env=dict(environment), **_popen_kwargs())
        processes.append(("backend", backend))
        _wait_for_http(f"http://127.0.0.1:{BACKEND_PORT}/api/portal/stats", backend, "Backend")

        print("[demo] starting frontend", flush=True)
        frontend = subprocess.Popen(
            frontend_command,
            cwd=paths.root / "frontend",
            env=dict(environment),
            **_popen_kwargs(),
        )
        processes.append(("frontend", frontend))
        _wait_for_http(f"http://127.0.0.1:{FRONTEND_PORT}/", frontend, "Frontend")

        print("\nCommunity Demo ready\n", flush=True)
        print(f"Frontend:    http://127.0.0.1:{FRONTEND_PORT}/", flush=True)
        print(f"Backend/API: http://127.0.0.1:{BACKEND_PORT}", flush=True)
        from demo.seed_loader import ADMIN_USER

        print("Demo account:", flush=True)
        print(f"  username: {ADMIN_USER['username']}", flush=True)
        print(f"  password: {ADMIN_USER['password']}", flush=True)
        print(f"Database:    {paths.database}", flush=True)
        print("\nStop: Ctrl+C\n", flush=True)
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n[demo] Ctrl+C received", flush=True)
    except Exception:
        for label, process in reversed(processes):
            _terminate_process(process, label)
        raise
    finally:
        for label, process in reversed(processes):
            _terminate_process(process, label)


def _parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Initialize and run the local SQLite Community Demo. Generated files live under .demo/community-demo/."
    )
    parser.add_argument(
        "--init-only",
        action="store_true",
        help="Validate tools, prepare SQLite, apply migrations, seed data, and exit without starting servers.",
    )
    return parser.parse_args(argv)


def main(argv: Iterable[str] | None = None) -> int:
    args = _parse_args(argv)
    paths = DemoPaths.for_root()
    try:
        environment, python = initialize_demo(paths)
        if args.init_only:
            print("Community Demo initialization complete (--init-only).", flush=True)
            return 0
        run_demo(paths, environment, python)
        return 0
    except BootstrapError as error:
        print(f"Community Demo bootstrap failed: {error}", file=sys.stderr)
        return 1
    except Exception as error:
        print(f"Community Demo bootstrap failed unexpectedly: {error}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\nCommunity Demo bootstrap interrupted.", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
