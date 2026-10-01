#!/usr/bin/env python3
"""Probe DWS baseline DDL safely without applying or stamping the schema."""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import TextIO

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from app.core.profiles import apply_runtime_profile
from app.db.base import redact_sensitive_text
from app.db.facade import connect_with_profile, get_db_profile
from app.migrations.schema import (
    SCHEMA_ROOT,
    _assert_dws_schema_exists,
    _has_user_tables,
    _split_sql_statements,
    render_baseline_for_profile,
)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Check GaussDB/DWS baseline DDL compatibility and roll back all changes."
    )
    parser.add_argument("--profile", required=True, help="Named GaussDB database profile")
    parser.add_argument("--config", help="Path to an existing database profile configuration file")
    parser.add_argument("--root", type=Path, default=SCHEMA_ROOT, help=argparse.SUPPRESS)
    return parser


def _load_runtime() -> None:
    try:
        from app.settings import load_runtime_env

        demo_bootstrap = os.environ.get("COMMUNITY_DEMO_BOOTSTRAP") == "1"
        load_runtime_env(overwrite=not demo_bootstrap)
    except Exception:
        pass
    try:
        apply_runtime_profile()
    except Exception:
        pass


def _execute(connection, sql: str) -> None:
    cursor = connection.cursor()
    try:
        cursor.execute(sql)
    finally:
        cursor.close()


def _database_version(connection) -> str:
    cursor = connection.cursor()
    try:
        cursor.execute("SELECT version()")
        row = cursor.fetchone()
    finally:
        cursor.close()
    if not row or row[0] is None:
        raise RuntimeError("SELECT version() returned no database version")
    return str(row[0])


def _assert_transactional_connection(connection) -> None:
    java_connection = getattr(connection, "jconn", None)
    get_auto_commit = getattr(java_connection, "getAutoCommit", None)
    if not callable(get_auto_commit):
        raise RuntimeError("could not verify GaussDB transaction mode; preflight refused")
    try:
        auto_commit = bool(get_auto_commit())
    except Exception as exc:
        raise RuntimeError("could not verify GaussDB transaction mode; preflight refused") from exc
    if auto_commit:
        raise RuntimeError("GaussDB auto-commit is enabled; preflight refused")


def _preview(statement: str, limit: int = 220) -> str:
    compact = " ".join(statement.split())
    return compact if len(compact) <= limit else compact[: limit - 3] + "..."


def _run_statements(connection, config: dict, root: Path) -> tuple[list[dict], int]:
    sql = render_baseline_for_profile(config, "dws", root)
    statements = _split_sql_statements(sql)
    results: list[dict] = []

    for index, statement in enumerate(statements, start=1):
        savepoint = f"dap_dws_preflight_{index:03d}"
        _execute(connection, f"SAVEPOINT {savepoint}")
        try:
            _execute(connection, statement)
        except Exception as exc:
            message = redact_sensitive_text(exc, config)
            try:
                _execute(connection, f"ROLLBACK TO SAVEPOINT {savepoint}")
            except Exception as rollback_exc:
                rollback_message = redact_sensitive_text(rollback_exc, config)
                raise RuntimeError(
                    f"statement {index:03d} failed and savepoint rollback failed: "
                    f"{message}; {rollback_message}"
                ) from None
            results.append(
                {"index": index, "statement": statement, "error": message}
            )
        else:
            results.append({"index": index, "statement": statement, "error": None})
    return results, len(statements)


def _print_report(results: list[dict], total: int, output: TextIO) -> bool:
    passed = sum(result["error"] is None for result in results)
    failures = [result for result in results if result["error"] is not None]
    print("\n=== PREFLIGHT ===", file=output)
    for result in results:
        status = "PASS" if result["error"] is None else "FAIL"
        print(
            f"{status} {result['index']:03d} | {_preview(result['statement'])}",
            file=output,
        )

    print("\n=== SUMMARY ===", file=output)
    print(f"TOTAL : {total}", file=output)
    print(f"PASS  : {passed}", file=output)
    print(f"FAIL  : {len(failures)}", file=output)
    if failures:
        print("\n=== ALL FAILURES ===", file=output)
        for result in failures:
            print(f"\n[{result['index']:03d}] {_preview(result['statement'])}", file=output)
            print(result["error"], file=output)
    return not failures


def run_preflight(
    profile: str,
    config: dict,
    connector,
    *,
    root: Path = SCHEMA_ROOT,
    output: TextIO | None = None,
    error_output: TextIO | None = None,
) -> int:
    """Run a guarded, all-errors DWS preflight and always roll back its transaction."""
    output = output or sys.stdout
    error_output = error_output or sys.stderr
    if config.get("type") != "gaussdb":
        print(
            f"DWS schema preflight requires a GaussDB profile; got {config.get('type')!r}",
            file=error_output,
        )
        return 2

    try:
        connection = connector()
    except Exception as exc:
        print(
            "DWS schema preflight connection failed: "
            + redact_sensitive_text(exc, config),
            file=error_output,
        )
        return 2

    results: list[dict] = []
    total = 0
    fatal_error: Exception | None = None
    rollback_error: Exception | None = None
    report_ready = False
    try:
        _assert_transactional_connection(connection)
        version = redact_sensitive_text(_database_version(connection), config)
        print("=== DWS VERSION ===", file=output)
        print(f"DWS version: {version}", file=output)

        _assert_dws_schema_exists(connection, config)
        if _has_user_tables(connection, config):
            raise RuntimeError(
                "target schema already contains user tables; preflight refused"
            )

        results, total = _run_statements(connection, config, root)
        report_ready = True
    except Exception as exc:
        fatal_error = exc
    finally:
        try:
            connection.rollback()
        except Exception as exc:
            rollback_error = exc
        try:
            connection.close()
        except Exception as exc:
            if fatal_error is None:
                fatal_error = exc

    if fatal_error is not None:
        print(
            "DWS schema preflight failed: "
            + redact_sensitive_text(fatal_error, config),
            file=error_output,
        )
        exit_code = 2
    if rollback_error is not None:
        print(
            "DWS schema preflight final rollback failed: "
            + redact_sensitive_text(rollback_error, config),
            file=error_output,
        )
        exit_code = 2
    if report_ready:
        all_statements_passed = _print_report(results, total, output)
        if fatal_error is not None or rollback_error is not None:
            exit_code = 2
        else:
            exit_code = 0 if all_statements_passed else 1
    return exit_code


def main(argv=None) -> int:
    args = _parser().parse_args(argv)
    _load_runtime()
    if args.config:
        os.environ["ASSET_DB_CONFIG_PATH"] = str(Path(args.config).resolve())

    try:
        config = get_db_profile(args.profile)
    except Exception as exc:
        print(
            "DWS schema preflight profile loading failed: "
            + redact_sensitive_text(exc),
            file=sys.stderr,
        )
        return 2

    return run_preflight(
        args.profile,
        config,
        lambda: connect_with_profile(args.profile),
        root=args.root,
    )


if __name__ == "__main__":
    raise SystemExit(main())
