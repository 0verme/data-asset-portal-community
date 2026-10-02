#!/usr/bin/env python3
"""Preflight DWS metadata SQL and semantic SchemaModel reflection."""

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
from app.db.registry import get_provider
from app.migrations.schema import (
    ReflectionQuery,
    _execute_reflection_query,
    _reflection_metadata_queries,
    baseline_schema,
    reflect_schema,
)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Execute DWS schema verification catalog SQL and build a reflected "
            "SchemaModel without changing the schema."
        )
    )
    parser.add_argument("--profile", required=True, help="Named GaussDB profile")
    parser.add_argument("--config", help="Path to an existing database profile configuration file")
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


def _preview(sql: str, limit: int = 220) -> str:
    compact = " ".join(sql.split())
    return compact if len(compact) <= limit else compact[: limit - 3] + "..."


def _execute_readonly(connection, query: ReflectionQuery) -> None:
    cursor = connection.cursor()
    try:
        _execute_reflection_query(cursor, query)
    finally:
        cursor.close()


def run_preflight(
    profile: str,
    config: dict,
    connector,
    *,
    output: TextIO | None = None,
    error_output: TextIO | None = None,
) -> int:
    """Run SQL and semantic reflection stages, reporting independent failures."""
    output = output or sys.stdout
    error_output = error_output or sys.stderr
    try:
        provider = get_provider(config.get("type", ""))
    except Exception as exc:
        print("DWS metadata preflight provider check failed: " + str(exc), file=error_output)
        return 2
    if provider.name != "gaussdb":
        print(
            f"DWS metadata preflight requires a GaussDB profile; got {config.get('type')!r}",
            file=error_output,
        )
        return 2

    try:
        queries = _reflection_metadata_queries(config)
    except Exception as exc:
        print(
            "DWS metadata preflight query preparation failed: "
            + redact_sensitive_text(exc, config),
            file=error_output,
        )
        return 2

    try:
        connection = connector()
    except Exception as exc:
        print(
            "DWS metadata preflight connection failed: "
            + redact_sensitive_text(exc, config),
            file=error_output,
        )
        return 2

    results: list[tuple[ReflectionQuery, str | None]] = []
    fatal_error: str | None = None
    rollback_error: str | None = None
    semantic_status = "SKIPPED"
    semantic_error: str | None = None
    try:
        for query in queries:
            try:
                _execute_readonly(connection, query)
            except Exception as exc:
                message = redact_sensitive_text(exc, config)
                results.append((query, message))
                # A failed SELECT can leave a transactional server in an
                # aborted state. Roll it back before probing the next query.
                try:
                    connection.rollback()
                except Exception as rollback_exc:
                    fatal_error = redact_sensitive_text(rollback_exc, config)
                    break
            else:
                results.append((query, None))

        if fatal_error is None and all(error is None for _, error in results):
            try:
                reflected = reflect_schema(connection, config, baseline_schema("dws"))
                if not reflected.tables:
                    raise RuntimeError(
                        "GaussDB semantic reflection returned no application tables"
                    )
            except Exception as exc:
                semantic_status = "FAIL"
                semantic_error = redact_sensitive_text(exc, config)
            else:
                semantic_status = f"PASS (tables={len(reflected.tables)})"
    except Exception as exc:
        fatal_error = redact_sensitive_text(exc, config)
    finally:
        try:
            connection.rollback()
        except Exception as exc:
            rollback_error = redact_sensitive_text(exc, config)
        try:
            connection.close()
        except Exception as exc:
            if fatal_error is None:
                fatal_error = redact_sensitive_text(exc, config)

    print("=== DWS VERIFY METADATA PREFLIGHT ===", file=output)
    for query, error in results:
        status = "PASS" if error is None else "FAIL"
        print(f"{query.name:<28} {status}", file=output)
        if error is not None:
            print(f"  SQL: {_preview(query.sql)}", file=output)
            print(f"  ERROR: {error}", file=output)

    passed = sum(error is None for _, error in results)
    failed = sum(error is not None for _, error in results)
    print("=== SQL SUMMARY ===", file=output)
    print(f"TOTAL : {len(queries)}", file=output)
    print(f"PASS  : {passed}", file=output)
    print(f"FAIL  : {failed}", file=output)
    print("=== DWS SEMANTIC REFLECTION PREFLIGHT ===", file=output)
    if semantic_status == "FAIL":
        print("SchemaModel normalization  FAIL", file=output)
        print("  ERROR: " + (semantic_error or "unknown reflection failure"), file=output)
    elif semantic_status == "SKIPPED":
        print("SchemaModel normalization  SKIPPED (metadata SQL did not fully pass)", file=output)
    else:
        print(f"SchemaModel normalization  {semantic_status}", file=output)
    if fatal_error is not None:
        print("DWS metadata preflight stopped: " + fatal_error, file=error_output)
    if rollback_error is not None:
        print("DWS metadata preflight final rollback failed: " + rollback_error, file=error_output)
    if fatal_error is not None or rollback_error is not None:
        return 2
    return 0 if failed == 0 and semantic_status.startswith("PASS") else 1


def main(argv=None) -> int:
    args = _parser().parse_args(argv)
    _load_runtime()
    if args.config:
        os.environ["ASSET_DB_CONFIG_PATH"] = str(Path(args.config).resolve())

    try:
        config = get_db_profile(args.profile)
    except Exception as exc:
        print(
            "DWS metadata preflight profile loading failed: "
            + redact_sensitive_text(exc),
            file=sys.stderr,
        )
        return 2

    return run_preflight(
        args.profile,
        config,
        lambda: connect_with_profile(args.profile),
    )


if __name__ == "__main__":
    raise SystemExit(main())
