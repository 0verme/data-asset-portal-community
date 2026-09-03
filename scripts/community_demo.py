#!/usr/bin/env python3
"""One-command Community Demo bootstrap.

This module intentionally orchestrates the existing migration, seed, ASGI
(FastAPI/Uvicorn) and Vite entry points.  It never reads an
external database configuration and never writes the user's .env files.
"""

from __future__ import annotations

import argparse
import contextlib
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
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from pathlib import Path
from subprocess import TimeoutExpired
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
DEFAULT_BACKEND_PORT = 15099
DEFAULT_FRONTEND_PORT = 5173
PYTHON_MINIMUM = (3, 10)
NODE_MINIMUM = (22, 13, 0)
LINEAGE_WORKSPACE_ENTRYPOINTS = (
    "packages/lineage-viewer/dist/lineage-viewer.js",
    "packages/lineage-viewer/dist/define.js",
    "packages/lineage-viewer/dist/index.d.ts",
    "packages/lineage-viewer/dist/define.d.ts",
    "packages/lineage-viewer-react/dist/index.js",
    "packages/lineage-viewer-react/dist/index.d.ts",
    "packages/lineage-viewer-domain-adapter/dist/index.js",
    "packages/lineage-viewer-domain-adapter/dist/index.d.ts",
)


def _print_demo_admin() -> None:
    from demo.seed_loader import ADMIN_USER

    print("Demo administrator:", flush=True)
    print(f"  Username: {ADMIN_USER['username']}", flush=True)
    print(f"  Password: {ADMIN_USER['password']}", flush=True)
    print(
        "WARNING: Demo credentials only. Change them for real deployments.",
        flush=True,
    )


class BootstrapError(RuntimeError):
    """An actionable bootstrap failure."""


@dataclass(frozen=True)
class DemoPaths:
    root: Path
    runtime: Path
    database: Path
    database_config: Path
    secret: Path
    backend_venv: Path

    @classmethod
    def for_root(cls, root: Path = ROOT) -> DemoPaths:
        root = root.resolve()
        runtime = root / ".demo" / "community-demo"
        return cls(
            root=root,
            runtime=runtime,
            database=runtime / "community.sqlite",
            database_config=runtime / "database.yaml",
            secret=runtime / "session-secret.key",
            backend_venv=root / "backend" / ".venv",
        )

    @property
    def backend_python(self) -> Path:
        name = "python.exe" if os.name == "nt" else "python"
        return self.backend_venv / ("Scripts" if os.name == "nt" else "bin") / name


def _is_redirected_path(path: Path) -> bool:
    is_junction = getattr(path, "is_junction", None)
    return path.is_symlink() or bool(is_junction and is_junction())


def _ensure_directory(path: Path) -> None:
    for candidate in (path.parent, path):
        if candidate.exists() and _is_redirected_path(candidate):
            raise BootstrapError(
                f"Refusing to use redirected demo runtime path: {candidate}"
            )
    path.mkdir(parents=True, exist_ok=True)


def _resolve_demo_database(paths: DemoPaths) -> Path:
    if paths.database.exists() and _is_redirected_path(paths.database):
        raise BootstrapError(
            f"Refusing to use redirected demo database path: {paths.database}"
        )
    database = paths.database.resolve()
    try:
        database.relative_to(paths.runtime.resolve())
    except ValueError as error:
        raise BootstrapError(
            f"Demo database must remain under the runtime directory: {database}"
        ) from error
    return database


def _write_generated_file(path: Path, content: str, *, private: bool = False) -> None:
    if path.exists() and _is_redirected_path(path):
        raise BootstrapError(f"Refusing to overwrite redirected generated path: {path}")
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
        if _is_redirected_path(path):
            raise BootstrapError(f"Refusing to read redirected demo secret: {path}")
        value = path.read_text(encoding="utf-8").strip()
        if len(value) >= 48:
            return value
    value = secrets.token_urlsafe(48)
    _write_generated_file(path, value + "\n", private=True)
    return value


def prepare_demo_runtime(paths: DemoPaths) -> str:
    """Create only bootstrap-owned files and return the persisted secret."""
    _ensure_directory(paths.runtime)
    database_path = _resolve_demo_database(paths)
    database_literal = json.dumps(str(database_path))
    _write_generated_file(
        paths.database_config,
        "defaults:\n"
        "  type: sqlite\n"
        "profiles:\n"
        "  community_sqlite:\n"
        "    type: sqlite\n"
        f"    database: {database_literal}\n",
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
    return upper.startswith(("ASSET_DB_", "DB_", "PG_", "MYSQL_"))


def _validate_port(value: int | str, *, option: str = "port") -> int:
    try:
        port = int(value)
    except (TypeError, ValueError) as error:
        raise BootstrapError(
            f"{option} must be an integer between 1 and 65535 (got {value!r})."
        ) from error
    if not 1 <= port <= 65535:
        raise BootstrapError(
            f"{option} must be between 1 and 65535 (got {port})."
        )
    return port


def _parse_port(value: str) -> int:
    try:
        return _validate_port(value)
    except BootstrapError as error:
        raise argparse.ArgumentTypeError(str(error)) from error


def build_demo_environment(
    base_environment: Mapping[str, str] | None,
    paths: DemoPaths,
    secret: str,
    backend_port: int = DEFAULT_BACKEND_PORT,
    frontend_port: int = DEFAULT_FRONTEND_PORT,
) -> dict[str, str]:
    """Build a child environment with an explicit SQLite-only boundary."""
    backend_port = _validate_port(backend_port, option="backend port")
    frontend_port = _validate_port(frontend_port, option="frontend port")
    environment = {
        key: value
        for key, value in (base_environment or os.environ).items()
        if not _is_database_environment_key(key)
        and not key.upper().startswith("VITE_")
        and key.upper()
        not in {
            "ASSET_RUNTIME_PROFILE",
            "APP_ENV",
            "APP_DEBUG",
            "APP_SECRET_KEY",
            "APP_CORS_ORIGINS",
            "LINEAGE_DB_PROFILE",
            "COMMUNITY_DEMO_BOOTSTRAP",
        }
    }
    environment.update(
        {
            "COMMUNITY_DEMO_BOOTSTRAP": "1",
            "ASSET_RUNTIME_PROFILE": "community",
            "ASSET_DB_CONFIG_PATH": str(paths.database_config.resolve()),
            "ASSET_DB_PROFILE": "community_sqlite",
            "ASSET_AUTH_DB_PROFILE": "community_sqlite",
            "ASSET_DB_TYPE": "sqlite",
            "ASSET_DB_DATABASE": str(paths.database.resolve()),
            "APP_ENV": "development",
            "APP_DEBUG": "false",
            "APP_SECRET_KEY": secret,
            "APP_CORS_ORIGINS": f"http://127.0.0.1:{frontend_port},http://localhost:{frontend_port}",
            "LINEAGE_DB_PROFILE": "community_sqlite",
            "VITE_API_MODE": "remote",
            "VITE_API_BASE_URL": "/api",
            "VITE_BACKEND_URL": f"http://127.0.0.1:{backend_port}",
        }
    )
    return environment


def _run(
    command: list[str], *, cwd: Path, environment: Mapping[str, str], label: str
) -> None:
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
    try:
        return tuple(int(item or 0) for item in match.groups())
    except (TypeError, ValueError) as error:
        raise BootstrapError(
            f"Could not determine {tool} version from: {value}"
        ) from error


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
        print(
            f"[demo] backend virtualenv not found; creating {paths.backend_venv}",
            flush=True,
        )
        _run(
            [sys.executable, "-m", "venv", str(paths.backend_venv)],
            cwd=paths.root,
            environment=os.environ,
            label="Create backend virtualenv",
        )
    code, _stdout, _stderr = _run_capture(
        [
            str(python),
            "-c",
            "import fastapi, itsdangerous, psycopg, uvicorn, yaml, werkzeug",
        ],
        cwd=paths.root,
    )
    if code != 0:
        print(
            "[demo] backend dependencies are missing; installing backend/requirements.txt",
            flush=True,
        )
        _run(
            [
                str(python),
                "-m",
                "pip",
                "install",
                "-r",
                str(paths.root / "backend" / "requirements.txt"),
            ],
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
    vite_entry = (
        paths.root
        / "frontend"
        / "node_modules"
        / ".bin"
        / ("vite.cmd" if os.name == "nt" else "vite")
    )
    if vite_entry.is_file():
        return
    print(
        "[demo] frontend dependencies are missing; running npm ci in frontend/",
        flush=True,
    )
    _run(
        [npm, "ci"],
        cwd=paths.root / "frontend",
        environment=_npm_environment(),
        label="Install frontend dependencies",
    )


def _missing_lineage_workspace_entries(paths: DemoPaths) -> list[str]:
    frontend_root = paths.root / "frontend"
    return [
        relative_path
        for relative_path in LINEAGE_WORKSPACE_ENTRYPOINTS
        if not (frontend_root / relative_path).is_file()
    ]


def ensure_lineage_workspace(paths: DemoPaths, npm: str) -> None:
    missing = _missing_lineage_workspace_entries(paths)
    if not missing:
        return

    print(
        "[demo] lineage workspace package entries are missing; running npm run build:lineage",
        flush=True,
    )
    _run(
        [npm, "run", "build:lineage"],
        cwd=paths.root / "frontend",
        environment=_npm_environment(),
        label="Build lineage workspace packages",
    )
    missing = _missing_lineage_workspace_entries(paths)
    if missing:
        raise BootstrapError(
            "Lineage workspace build did not produce required entries: "
            + ", ".join(missing)
        )


def initialize_demo(
    paths: DemoPaths,
    backend_port: int = DEFAULT_BACKEND_PORT,
    frontend_port: int = DEFAULT_FRONTEND_PORT,
) -> tuple[dict[str, str], Path]:
    backend_port = _validate_port(backend_port, option="backend port")
    frontend_port = _validate_port(frontend_port, option="frontend port")
    check_python()
    node, npm = find_node_and_npm()
    python = ensure_backend_python(paths)
    ensure_frontend_dependencies(paths, npm)
    ensure_lineage_workspace(paths, npm)
    secret = prepare_demo_runtime(paths)
    environment = build_demo_environment(
        os.environ, paths, secret, backend_port, frontend_port
    )
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
    """Verify the complete deterministic repository seed contract."""
    import sqlite3

    from demo.seed_loader import ADMIN_USER, community_seed_plan

    if not database.is_file():
        raise BootstrapError(f"Demo database was not created: {database}")
    connection = sqlite3.connect(database)
    try:
        tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }
        plan = community_seed_plan()
        missing = sorted(set(plan) - tables)
        if missing:
            raise BootstrapError(
                f"Demo database is missing canonical module tables: {', '.join(missing)}"
            )
        counts: dict[str, int] = {}
        for table, spec in plan.items():
            count = connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            expected = len(spec["rows"])
            if count != expected:
                raise BootstrapError(
                    f"Unexpected demo count for {table}: {count} (expected {expected})"
                )
            counts[table] = count
        admin_count = connection.execute(
            "SELECT COUNT(*) FROM p_admin_user WHERE username = ?",
            (ADMIN_USER["username"],),
        ).fetchone()[0]
        if admin_count != 1:
            raise BootstrapError(
                f"Demo account count is {admin_count} (expected 1)"
            )
        counts[f"p_admin_user:{ADMIN_USER['username']}"] = admin_count
        print(
            "[demo] verified repository data: "
            f"menus={counts['p_menu']}, "
            f"assets={counts['p_asset_table']}, "
            f"upstream={counts['p_upstream_system']}, "
            f"push={counts['p_push_system']}, "
            f"reports={counts['p_report_asset']}, "
            f"lineage_nodes={counts['p_lineage_node']}, "
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


def check_ports(
    backend_port: int = DEFAULT_BACKEND_PORT,
    frontend_port: int = DEFAULT_FRONTEND_PORT,
) -> None:
    backend_port = _validate_port(backend_port, option="backend port")
    frontend_port = _validate_port(frontend_port, option="frontend port")
    conflicts = []
    for port, service in ((backend_port, "backend"), (frontend_port, "frontend")):
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
    except TimeoutExpired:
        if os.name != "nt":
            with contextlib.suppress(ProcessLookupError):
                os.killpg(process.pid, signal.SIGKILL)
        process.wait(timeout=5)


def _wait_for_http(url: str, process, label: str, timeout: float = 30) -> None:
    deadline = time.monotonic() + timeout
    last_error = "not reachable"
    while time.monotonic() < deadline:
        return_code = process.poll()
        if return_code is not None:
            raise BootstrapError(
                f"{label} exited before readiness check (exit code {return_code})."
            )
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


def run_demo(
    paths: DemoPaths,
    environment: Mapping[str, str],
    python: Path,
    backend_port: int = DEFAULT_BACKEND_PORT,
    frontend_port: int = DEFAULT_FRONTEND_PORT,
) -> None:
    backend_port = _validate_port(backend_port, option="backend port")
    frontend_port = _validate_port(frontend_port, option="frontend port")
    check_ports(backend_port, frontend_port)
    processes = []
    backend_command = [
        str(python),
        "-m",
        "uvicorn",
        "backend.asgi:app",
        "--host",
        "127.0.0.1",
        "--port",
        str(backend_port),
    ]
    frontend_command = [
        shutil.which("npm") or "npm",
        "run",
        "dev",
        "--",
        "--host",
        "127.0.0.1",
        "--port",
        str(frontend_port),
        "--strictPort",
    ]
    try:
        print("[demo] starting backend", flush=True)
        backend = subprocess.Popen(
            backend_command, cwd=paths.root, env=dict(environment), **_popen_kwargs()
        )
        processes.append(("backend", backend))
        _wait_for_http(
            f"http://127.0.0.1:{backend_port}/healthz", backend, "Backend"
        )

        print("[demo] starting frontend", flush=True)
        frontend = subprocess.Popen(
            frontend_command,
            cwd=paths.root / "frontend",
            env=dict(environment),
            **_popen_kwargs(),
        )
        processes.append(("frontend", frontend))
        _wait_for_http(f"http://127.0.0.1:{frontend_port}/", frontend, "Frontend")

        print("\nCommunity Demo ready\n", flush=True)
        print(f"Frontend:    http://127.0.0.1:{frontend_port}/", flush=True)
        print(f"Backend/API: http://127.0.0.1:{backend_port}", flush=True)
        _print_demo_admin()
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
        description="Initialize and run the local SQLite Community Demo. Generated files live under .demo/community-demo/.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "--init-only",
        action="store_true",
        help="Validate tools, prepare SQLite, apply migrations, seed data, and exit without starting servers.",
    )
    parser.add_argument(
        "--backend-port",
        type=_parse_port,
        default=DEFAULT_BACKEND_PORT,
        help="Local backend/Uvicorn listening port.",
    )
    parser.add_argument(
        "--frontend-port",
        type=_parse_port,
        default=DEFAULT_FRONTEND_PORT,
        help="Local frontend/Vite listening port.",
    )
    return parser.parse_args(argv)


def main(argv: Iterable[str] | None = None) -> int:
    args = _parse_args(argv)
    paths = DemoPaths.for_root()
    try:
        environment, python = initialize_demo(
            paths, args.backend_port, args.frontend_port
        )
        if args.init_only:
            print("Community Demo initialization complete (--init-only).", flush=True)
            _print_demo_admin()
            return 0
        run_demo(
            paths,
            environment,
            python,
            args.backend_port,
            args.frontend_port,
        )
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
