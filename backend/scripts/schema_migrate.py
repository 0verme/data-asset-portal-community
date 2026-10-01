#!/usr/bin/env python3
"""Initialize the current schema baseline and coordinate Alembic revisions."""

# pyright: reportMissingImports=false
# pyright: reportAttributeAccessIssue=false

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
    parser.add_argument("command", choices=("head", "status", "plan", "verify", "apply", "baseline"))
    parser.add_argument("--profile", help="Named database profile; never a connection string.")
    parser.add_argument("--offline", action="store_true", help="Verify or plan baseline files without connecting.")
    parser.add_argument(
        "--dialect", choices=("sqlite", "postgresql", "mysql", "dws"),
        help="Required with --offline.",
    )
    parser.add_argument("--config", help="Path to an existing database profile configuration file.")
    parser.add_argument("--root", type=Path, default=BACKEND / "schema", help=argparse.SUPPRESS)
    parser.add_argument("--version", help="Baseline revision; only 0001_baseline is supported.")
    parser.add_argument("--dry-run", action="store_true", help="Validate baseline stamping without writing it.")
    return parser


def _script_directory():
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    return ScriptDirectory.from_config(Config(str(BACKEND / "alembic.ini")))


def repository_alembic_head() -> str:
    """Return the repository's configured Alembic head revision."""
    head = _script_directory().get_current_head()
    if head is None:
        raise RuntimeError("repository has no Alembic migration head")
    return head


def _validate_known_revision(revision: str | None) -> None:
    if revision is None:
        return
    try:
        known = _script_directory().get_revision(revision)
    except Exception as exc:
        raise RuntimeError(
            f"database revision {revision!r} is not known to this repository; "
            "refusing to guess or modify the database"
        ) from exc
    if known is None:
        raise RuntimeError(
            f"database revision {revision!r} is not known to this repository; "
            "refusing to guess or modify the database"
        )


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
    if args.command == "head":
        print(repository_alembic_head())
        return 0
    # Mirror native startup: load backend/.env.local using the same environment
    # profile handling as the runtime, then apply the named database profile.
    # This keeps the local quick-start commands reproducible in a clean clone.
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
    from app.migrations.dws_runner import apply_revisions, plan_revisions, revision_chain

    config = get_db_profile(args.profile)
    try:
        dialect = PROFILE_TYPE_TO_DIALECT[config["type"]]
    except KeyError as exc:
        raise ValueError(f"unsupported database type for schema management: {config['type']}") from exc

    connection = connect_with_profile(args.profile)
    applied_results = []
    try:
        revision = current_revision(connection, config)
        _validate_known_revision(revision)
        head = repository_alembic_head()
        if args.command == "status":
            if dialect == "dws":
                print(
                    f"dialect={dialect} revision={revision or 'unmanaged'} "
                    f"head={head}"
                )
            else:
                print(f"dialect={dialect} revision={revision or 'unmanaged'}")
            return 0
        if args.command == "plan":
            if dialect == "dws":
                if revision is None:
                    print(f"{BASELINE_REVISION} dws.sql")
                    for pending_revision in revision_chain(BASELINE_REVISION, head):
                        print(f"{pending_revision} after-baseline")
                    return 0
                items = plan_revisions(
                    connection, config, revision, head, root=args.root
                )
                if not items:
                    print(f"up-to-date {head}")
                for item in items:
                    print(f"{item.revision} {item.action}")
                return 0
            if revision is None:
                print(f"{BASELINE_REVISION} {dialect}.sql")
                lower = BASELINE_REVISION
            else:
                lower = revision
            if lower != head:
                pending = list(_script_directory().iterate_revisions(head, lower))
                for migration in reversed(pending):
                    print(migration.revision)
            elif revision is not None:
                print(f"up-to-date {head}")
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
        start_revision = revision or BASELINE_REVISION
        created = initialize(connection, config, dialect, args.root)
        if dialect == "dws":
            applied_results = apply_revisions(
                connection,
                config,
                start_revision,
                head,
                root=args.root,
            )
            # The whole physical schema must match the repository head contract
            # after the last verified revision.
            verify_database(connection, config, dialect, args.root)
    finally:
        if connection is not None:
            connection.close()

    if config["type"] != "gaussdb":
        _alembic_upgrade(args.profile)
    from app.authorization.persistence import seed_rbac_for_profile
    from app.navigation.persistence import seed_menus_for_profile

    seeded = seed_rbac_for_profile(args.profile)
    print(
        f"rbac_seed=inserted:{seeded.inserted} "
        f"roles:{seeded.roles_inserted} permissions:{seeded.permissions_inserted} "
        f"mappings:{seeded.mappings_inserted}"
    )
    menu_seed = seed_menus_for_profile(args.profile)
    print(f"menu_seed=inserted:{menu_seed.inserted} total:{menu_seed.total}")
    if dialect == "dws":
        applied_revision = applied_results[-1].revision if applied_results else ("-" if not created else BASELINE_REVISION)
    else:
        applied_revision = BASELINE_REVISION if created else "-"
    print(f"applied={applied_revision}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"schema migration failed: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
