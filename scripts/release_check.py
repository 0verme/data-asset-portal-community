#!/usr/bin/env python3
"""Local pre-release quality gate — mirrors the CI jobs without GitHub.

Usage (from the repository root):

    python scripts/release_check.py fast    # guard + backend unit + migration verify
    python scripts/release_check.py full    # fast + frontend ci/test/build + fresh SQLite + packaging

`full` additionally runs the PostgreSQL integration suite when
TEST_DATABASE_PROFILE and TEST_DATABASE_CONFIG_PATH point at an ephemeral
PostgreSQL test database (never production / the default database.yaml).

Exit code is 0 only when every enabled check passes.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

# The runner may live on a GBK Windows console while checks print CJK and
# UTF-8 text; force UTF-8 stdout/stderr so progress stays readable.
for _stream in (sys.stdout, sys.stderr):
    try:
        if _stream.encoding and _stream.encoding.lower() not in {"utf-8", "utf8"}:
            _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"

COMMUNITY_MODULES = "portal,dwm,mapping,lineage,root,indicator,apiAsset,system"

CHECKS: list[tuple[str, str]] = []


def check(name: str, description: str):
    def decorator(fn):
        CHECKS.append((name, description, fn))
        return fn
    return decorator


def python() -> str:
    """Preferred interpreter: backend venv, else system python."""
    candidates = [
        BACKEND / ".venv" / "Scripts" / "python.exe",  # Windows
        BACKEND / ".venv" / "bin" / "python",          # POSIX
    ]
    for candidate in candidates:
        if candidate.is_file():
            return str(candidate)
    return sys.executable


def npm() -> str:
    exe = "npm.cmd" if os.name == "nt" else "npm"
    return shutil.which(exe) or "npm"


def run(cmd, cwd=None, check_result=True, label=None, env=None) -> subprocess.CompletedProcess:
    print(f"\n$ {label or ' '.join(str(c) for c in cmd)}")
    run_env = dict(os.environ)
    if env:
        run_env.update(env)
    # UTF-8 with replace: the local runner may live on a GBK Windows console
    # while subprocesses emit UTF-8 (e.g. npm progress or CJK seed output).
    result = subprocess.run(
        cmd, cwd=cwd or ROOT, capture_output=True, text=True,
        encoding="utf-8", errors="replace", env=run_env,
    )
    if result.stdout:
        print(result.stdout.rstrip())
    if result.stderr:
        print(result.stderr.rstrip())
    if check_result and result.returncode != 0:
        raise SystemExit(f"[FAIL] {label or cmd} exited with {result.returncode}")
    return result


def npm_env() -> dict:
    """Isolate npm from host NODE_ENV=production pollution.

    Some Windows developer machines export NODE_ENV=production globally,
    which makes npm ci omit devDependencies and the frontend build fail.
    The CI runner has no such pollution; this keeps the local gate honest.
    """
    env = dict(os.environ)
    env["NODE_ENV"] = "development"
    env.pop("npm_config_omit", None)
    env.pop("npm_config_production", None)
    env.pop("npm_config_include", None)
    return env


@check("Public Data Guard", "demo/validate_demo_data.py --strict (BLOCKER + SUSPICIOUS must be 0)")
def _public_data_guard():
    run([python(), "demo/validate_demo_data.py", "--strict"])


@check("Backend unit tests", "unittest discover -s backend/tests (0 failures, 0 errors)")
def _backend_unit_tests():
    run([python(), "-m", "unittest", "discover", "-s", "backend/tests"])


@check("Packaging contracts", "test_packaging_contracts.py (clean-clone reproducibility)")
def _packaging_contracts():
    run([python(), "-m", "unittest", "discover", "-s", "backend/tests", "-p", "test_packaging_contracts.py"])


@check("Migration offline verify", "schema_migrate.py verify --offline (sqlite/postgresql/mysql/dws)")
def _migration_verify_offline():
    for dialect in ("sqlite", "postgresql", "mysql", "dws"):
        run(
            [python(), "backend/scripts/schema_migrate.py", "verify", "--offline", "--dialect", dialect],
            label=f"migration verify --dialect {dialect}",
        )


@check("Fresh SQLite migration + seed + repeat apply", "Community contract on a temp SQLite db")
def _sqlite_fresh_flow():
    with tempfile.TemporaryDirectory(prefix="release-check-") as tmp:
        db = Path(tmp) / "community.db"
        config = Path(tmp) / "sqlite-config.yaml"
        config.write_text(
            "defaults:\n  type: sqlite\nprofiles:\n  ci_sqlite:\n    type: sqlite\n"
            f"    database: {db.as_posix()}\n",
            encoding="utf-8",
        )
        run([python(), "backend/scripts/schema_migrate.py", "apply", "--profile", "ci_sqlite",
             "--config", str(config), "--modules", COMMUNITY_MODULES], label="sqlite apply (fresh)")
        run([python(), "backend/scripts/schema_migrate.py", "verify", "--profile", "ci_sqlite",
             "--config", str(config), "--modules", COMMUNITY_MODULES], label="sqlite verify")
        run([python(), "demo/seed_sqlite.py", "--database", str(db)], label="sqlite seed")
        result = run([python(), "backend/scripts/schema_migrate.py", "apply", "--profile", "ci_sqlite",
                      "--config", str(config), "--modules", COMMUNITY_MODULES], label="sqlite repeat apply")
        if "applied=-" not in result.stdout:
            raise SystemExit("[FAIL] sqlite repeat apply was not a no-op")


@check("PostgreSQL integration", "full suite with TEST_DATABASE_PROFILE (skips enabled)")
def _postgres_integration():
    profile = (os.getenv("TEST_DATABASE_PROFILE") or "").strip()
    config = (os.getenv("TEST_DATABASE_CONFIG_PATH") or "").strip()
    if not (profile and config and Path(config).is_file()):
        print("\n[SKIP] TEST_DATABASE_PROFILE/TEST_DATABASE_CONFIG_PATH not set — "
              "PostgreSQL integration skipped (16 unit-level skips expected).")
        return
    run([python(), "-m", "unittest", "discover", "-s", "backend/tests"], label="backend tests (PG integration)")


@check("Frontend tests", "npm test")
def _frontend_tests():
    run([npm(), "test"], cwd=FRONTEND, label="npm test", env=npm_env())


@check("Frontend npm ci + build", "npm ci && npm run build")
def _frontend_ci_build():
    # Windows DrvFs + workspace symlinks can transiently lock files when npm
    # rebuilds node_modules from a subprocess; clean first and retry once.
    node_modules = FRONTEND / "node_modules"
    shutil.rmtree(node_modules, ignore_errors=True)
    try:
        run([npm(), "ci"], cwd=FRONTEND, label="npm ci", env=npm_env())
    except SystemExit:
        shutil.rmtree(node_modules, ignore_errors=True)
        print("\n[retry] npm ci transient failure on local filesystem — retrying once")
        run([npm(), "ci"], cwd=FRONTEND, label="npm ci (retry)", env=npm_env())
    run([npm(), "run", "build"], cwd=FRONTEND, label="npm run build", env=npm_env())


@check("Frontend audit gate", "npm audit --audit-level=high")
def _frontend_audit():
    run([npm(), "audit", "--audit-level=high"], cwd=FRONTEND, label="npm audit", env=npm_env())


FAST = ("Public Data Guard", "Backend unit tests", "Migration offline verify", "Packaging contracts",
        "Frontend tests")
FULL = ("Public Data Guard", "Backend unit tests", "Migration offline verify", "Packaging contracts",
        "Fresh SQLite migration + seed + repeat apply", "Frontend npm ci + build", "Frontend tests",
        "Frontend audit gate", "PostgreSQL integration")


def main(argv):
    mode = argv[0] if argv else "fast"
    if mode == "fast":
        wanted = FAST
    elif mode == "full":
        wanted = FULL
    else:
        raise SystemExit(f"unknown mode: {mode} (use fast or full)")

    by_name = {name: (description, fn) for name, description, fn in CHECKS}
    print(f"data-asset-portal release check — mode={mode}\n" + "=" * 60)
    for name in wanted:
        description, fn = by_name[name]
        print(f"\n=== {name} — {description} ===")
        fn()
    print("\n" + "=" * 60)
    print(f"ALL RELEASE CHECKS PASSED (mode={mode})")


if __name__ == "__main__":
    main(sys.argv[1:])
