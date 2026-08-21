#!/usr/bin/env python3
"""Initialize the current schema baseline and coordinate Alembic revisions."""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

PROFILE_TYPE_TO_DIALECT = {
    "sqlite": "sqlite",
    "postgres": "postgresql",
    "mysql": "mysql",
    "gaussdb": "dws",
}


def _parser():
    parser = argparse.ArgumentParser(description="Manage the database schema baseline and Alembic revision.")
    parser.add_argument("command", choices=("status", "plan", "verify", "apply", "baseline"))
    parser.add_argument("--profile", help="Named database profile; never a connection string.")
    parser.add_argument("--offline", action="store_true", help="Verify or plan baseline files without connecting.")
    parser.add_argument(
        "--dialect", choices=("sqlite", "postgresql", "mysql", "dws"),
        help="Required with --offline.",
    )
    parser.add_argument("--config", help="Path to an existing database profile configuration file.")
    parser.add_argument("--root", type=Path, default=BACKEND / "schema", help=argparse.SUPPRESS)
    parser.add_argument("--version", help="Baseline revision; only 0001_baseline is supported.")
    parser.add_argument("--modules", default="", help=argparse.SUPPRESS)
    parser.add_argument("--dry-run", action="store_true", help="Validate baseline stamping without writing it.")
    return parser


def _load_runtime():
    try:
        from app.settings import load_runtime_env

        load_runtime_env()
    except Exception:
        pass
    try:
        from app.core.profiles import apply_runtime_profile

        apply_runtime_profile()
    except Exception:
        pass


def _offline(args):
    from app.migrations.schema import BASELINE_REVISION, baseline_path, verify_baselines

    if args.command not in {"plan", "verify"} or not args.dialect:
        raise ValueError("--offline requires plan/verify and --dialect")
    tables = verify_baselines(args.root)
    path = baseline_path(args.dialect, args.root)
    if args.command == "verify":
        print(
            f"verify=ok dialect={args.dialect} revision={BASELINE_REVISION} "
            f"tables={len(tables)}"
        )
    else:
        print(f"{BASELINE_REVISION} {path.relative_to(args.root)} tables={len(tables)}")
    return 0


def _alembic_upgrade(profile: str):
    from alembic import command
    from alembic.config import Config

    config = Config(str(BACKEND / "alembic.ini"))
    os.environ["ASSET_DB_PROFILE"] = profile
    command.upgrade(config, "head")


def main(argv=None):
    args = _parser().parse_args(argv)
    # Mirror Flask startup: load backend/.env.local the same way run.py does,
    # then apply the runtime profile (e.g. community) so the same environment
    # variables (ASSET_RUNTIME_PROFILE) configure both the database profile
    # file and the enabled module set. This keeps the README Community
    # quick-start commands (`.env.local` + `schema_migrate.py apply`) working
    # as written in a clean clone.
    if args.command != "baseline":
        try:
            from app.settings import load_runtime_env

            demo_bootstrap = os.environ.get("COMMUNITY_DEMO_BOOTSTRAP") == "1"
            load_runtime_env(overwrite=not demo_bootstrap)
        except Exception:
            pass  # offline / non-profile invocations are unaffected
        try:
            from app.core.profiles import apply_runtime_profile

            apply_runtime_profile()
        except Exception:
            pass  # offline / non-profile invocations are unaffected
    modules = [item.strip() for item in args.modules.split(",") if item.strip()]
    if not modules:
        # Fall back to the module set the runtime profile declared (e.g.
        # community.yaml), so `apply --profile community_sqlite` matches the
        # Community schema contract without repeating the list by hand.
        declared = (os.getenv("ASSET_ENABLED_MODULES") or "").strip()
        modules = [item.strip() for item in declared.split(",") if item.strip()]
    if args.offline:
        return _offline(args)
    if not args.profile:
        raise ValueError("--profile is required unless --offline is used")
    if args.config:
        os.environ["ASSET_DB_CONFIG_PATH"] = str(Path(args.config).resolve())
    _load_runtime()

    from app.db.facade import connect_with_profile, get_db_profile
    from app.migrations.schema import (
        BASELINE_REVISION,
        current_revision,
        initialize,
        stamp_existing,
        verify_database,
    )

    config = get_db_profile(args.profile)
    try:
        dialect = PROFILE_TYPE_TO_DIALECT[config["type"]]
    except KeyError as exc:
        raise ValueError(f"unsupported database type for schema management: {config['type']}") from exc

    connection = connect_with_profile(args.profile)
    try:
        revision = current_revision(connection, config)
        if args.command == "status":
            print(f"dialect={dialect} revision={revision or 'unmanaged'}")
            return 0
        if args.command == "plan":
            if revision is None:
                print(f"{BASELINE_REVISION} {dialect}.sql")
            return 0
        if args.command == "verify":
            verified = verify_database(connection, config, dialect, args.root)
            if verified is None:
                raise RuntimeError("database schema is present but Alembic baseline is not stamped")
            print(f"verify=ok revision={verified}")
            return 0
        if args.command == "baseline":
            version = args.version or BASELINE_REVISION
            if version != BASELINE_REVISION:
                raise ValueError(f"baseline version must be {BASELINE_REVISION}")
            verify_database(connection, config, dialect, args.root)
            if args.dry_run:
                print(f"baseline={BASELINE_REVISION} dry_run=true")
            else:
                print(f"baseline={stamp_existing(connection, config, dialect, args.root)}")
            return 0
        created = initialize(connection, config, dialect, args.root)
    finally:
        connection.close()

    if config["type"] != "gaussdb":
        _alembic_upgrade(args.profile)
    print(f"applied={BASELINE_REVISION if created else '-'}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"schema migration failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
