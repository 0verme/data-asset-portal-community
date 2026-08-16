#!/usr/bin/env python3
"""Explicit schema-migration command. It is never invoked by Flask startup."""
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
    "gaussdb": "dws",
}


def _parser():
    parser = argparse.ArgumentParser(description="Manage the database schema migration ledger.")
    parser.add_argument("command", choices=("status", "plan", "verify", "apply", "baseline"))
    parser.add_argument("--profile", help="Named database profile; never a connection string.")
    parser.add_argument(
        "--offline",
        action="store_true",
        help="Verify or plan manifest files without opening a database.",
    )
    parser.add_argument(
        "--dialect",
        choices=("sqlite", "postgresql", "dws"),
        help="Required with --offline.",
    )
    parser.add_argument("--config", help="Path to an existing database profile configuration file.")
    parser.add_argument("--root", type=Path, default=BACKEND / "migrations", help=argparse.SUPPRESS)
    parser.add_argument("--version", help="Declared baseline version.")
    parser.add_argument(
        "--modules",
        default="",
        help="Comma-separated enabled module codes; core migrations are always included.",
    )
    parser.add_argument("--dry-run", action="store_true", help="Show baseline registrations without writing them.")
    return parser


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

            load_runtime_env()
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
        if args.command not in {"plan", "verify"} or not args.dialect:
            raise ValueError("--offline requires plan/verify and --dialect")
        from app.migrations.manifest import load_manifest

        selected = set(modules)
        selected.add("core")
        migrations = [
            migration
            for migration in load_manifest(args.root)
            if args.dialect in migration.files
            and selected.intersection(migration.modules)
        ]
        if args.command == "verify":
            for migration in migrations:
                migration.checksum(args.dialect)
            print(
                f"verify=ok dialect={args.dialect} "
                f"migrations={','.join(item.version for item in migrations) or '-'}"
            )
            return 0
        for migration in migrations:
            print(
                f"{migration.version} {migration.name} "
                f"{migration.files[args.dialect].relative_to(args.root)} "
                f"modules={','.join(migration.modules)} "
                f"checksum={migration.checksum(args.dialect)}"
            )
        return 0
    if not args.profile:
        raise ValueError("--profile is required unless --offline is used")
    if args.config:
        os.environ["ASSET_DB_CONFIG_PATH"] = str(args.config)
    from app.db.facade import connect_with_profile, get_db_profile
    from app.migrations.runner import MigrationRunner

    config = get_db_profile(args.profile)
    try:
        dialect = PROFILE_TYPE_TO_DIALECT[config["type"]]
    except KeyError as exc:
        supported = ", ".join(sorted(PROFILE_TYPE_TO_DIALECT))
        raise ValueError(
            f"Unsupported database type for migrations: {config['type']}. "
            f"Supported profile types: {supported}."
        ) from exc

    conn = connect_with_profile(args.profile)
    try:
        runner = MigrationRunner(conn, dialect, args.root, enabled_modules=modules)
        if args.command == "status":
            try:
                state = runner.status()
            except Exception:
                print(f"dialect={dialect} ledger=unmanaged")
                return 0
            print(
                f"dialect={dialect} "
                f"applied={','.join(state.applied) or '-'} "
                f"pending={','.join(m.version for m in state.pending) or '-'} "
                f"checksum_errors={','.join(state.checksum_errors) or '-'} "
                f"unknown={','.join(state.unknown_versions) or '-'}"
            )
            return 0
        if args.command == "plan":
            state = runner.verify()
            for migration in state.pending:
                print(
                    f"{migration.version} {migration.name} "
                    f"{migration.files[dialect].relative_to(args.root)} "
                    f"modules={','.join(migration.modules)} "
                    f"transactional={migration.transactional}"
                )
            return 0
        if args.command == "verify":
            runner.verify()
            print("verify=ok")
            return 0
        if args.command == "apply":
            print("applied=" + (",".join(runner.apply()) or "-"))
            return 0
        if not args.version:
            raise ValueError("baseline requires --version")
        print("baseline=" + ",".join(runner.baseline(args.version, dry_run=args.dry_run)))
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"schema migration failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
