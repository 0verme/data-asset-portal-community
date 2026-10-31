"""Measure field-mapping service behavior on disposable synthetic SQLite data.

This opt-in benchmark only creates a temporary SQLite database populated with
synthetic rows. Pass a task-specific scratch directory outside the repository;
the per-scale database and configuration are removed automatically.
"""

from __future__ import annotations

import argparse
import contextvars
import json
import math
import os
import platform
import sqlite3
import statistics
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Callable

from sqlalchemy.dialects import sqlite

from backend.app.db.facade import clear_engine_cache, get_engine
from backend.app.db.sqlite_adapter import connect
from backend.app.migrations.schema import initialize
from backend.app.services.field_mapping_service import FieldMappingService

PROFILE = "field_mapping_synthetic_benchmark"
QUERY_LABEL = contextvars.ContextVar("field_mapping_benchmark_query", default="unlabelled")


class InstrumentedFieldMappingService(FieldMappingService):
    """Record service SELECT statements by benchmark workload."""

    def __init__(self) -> None:
        super().__init__()
        self.statements: dict[str, list] = {}
        self.statement_lock = threading.Lock()

    def _fetch_rows(self, statement):
        with self.statement_lock:
            self.statements.setdefault(QUERY_LABEL.get(), []).append(statement)
        return super()._fetch_rows(statement)


def percentile(values: list[float], percent: float) -> float:
    return sorted(values)[max(0, math.ceil(percent * len(values)) - 1)]


def summarize(values: list[float]) -> dict[str, float | int]:
    return {
        "samples": len(values),
        "p50_ms": round(statistics.median(values), 2),
        "p95_ms": round(percentile(values, 0.95), 2),
        "min_ms": round(min(values), 2),
        "max_ms": round(max(values), 2),
    }


def create_database(
    directory: Path,
    field_count: int,
    *,
    fields_per_table: int = 10,
    systems: int = 10,
) -> tuple[Path, int]:
    database = directory / f"synthetic-{field_count}.sqlite"
    config_path = directory / f"database-{field_count}.yaml"
    config_path.write_text(
        f"profiles:\n  {PROFILE}:\n    type: sqlite\n"
        f"    database: '{database.as_posix()}'\n",
        encoding="utf-8",
    )
    os.environ["ASSET_DB_CONFIG_PATH"] = str(config_path)
    os.environ["ASSET_DB_PROFILE"] = PROFILE

    profile = {"type": "sqlite", "database": str(database)}
    connection = connect(profile)
    try:
        # Seed speed only: the temporary database is disposable and benchmark
        # queries run after all inserts have committed.
        connection.execute("PRAGMA dwp.synchronous = OFF")
        initialize(connection, profile, "sqlite")
        connection.executemany(
            "INSERT INTO dwp.p_data_source "
            "(source_id, source_code, source_name, source_type, status_code) "
            "VALUES (?, ?, ?, 'synthetic', 'enabled')",
            [(i, f"SYN{i:02d}", f"Synthetic system {i:02d}") for i in range(1, systems + 1)],
        )
        connection.executemany(
            "INSERT INTO dwp.p_upstream_system "
            "(system_pk, data_source_id, system_id, system_abbr, system_name, "
            "db_type, host_name, status_code) "
            "VALUES (?, ?, ?, ?, ?, 'SQLite', 'synthetic.invalid', 'enabled')",
            [
                (i, i, f"synthetic-{i:02d}", f"SYN{i:02d}", f"Synthetic system {i:02d}")
                for i in range(1, systems + 1)
            ],
        )
        table_count = math.ceil(field_count / fields_per_table)
        table_rows = []
        for table_no in range(table_count):
            table_pk = table_no + 1
            system_id = table_no % systems + 1
            table_name = f"table_{table_no:08d}"
            table_rows.append(
                (
                    table_pk,
                    system_id,
                    system_id,
                    table_name,
                    table_name,
                    "DWF",
                    f"dwf_{table_name}",
                    fields_per_table,
                    0,
                )
            )
        connection.executemany(
            "INSERT INTO dwp.p_field_mapping_table "
            "(table_pk, data_source_id, upstream_system_id, source_table_name, "
            "source_table_cn, target_layer_code, target_table_name, "
            "field_total_count, mapped_field_count) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            table_rows,
        )
        connection.commit()

        insert_sql = (
            "INSERT INTO dwp.p_field_mapping_field "
            "(field_pk, table_pk, source_field_name, source_field_type, "
            "source_field_comment, target_field_name, mapping_rule, field_order, "
            "is_deleted) VALUES (?, ?, ?, 'VARCHAR', ?, ?, ?, ?, 'N')"
        )
        batch = []
        for field_no in range(field_count):
            table_no, field_order = divmod(field_no, fields_per_table)
            field_order += 1
            field_name = f"field_{field_order:03d}"
            mapped = field_no % 5 < 3
            comment = "" if field_no % 10 == 0 else f"Synthetic comment {field_no % 100:02d}"
            batch.append(
                (
                    field_no + 1,
                    table_no + 1,
                    field_name,
                    comment,
                    f"target_{field_order:03d}" if mapped else None,
                    "direct" if mapped else "待补充",
                    field_order,
                )
            )
            if len(batch) >= 20_000:
                connection.executemany(insert_sql, batch)
                batch.clear()
        if batch:
            connection.executemany(insert_sql, batch)
        connection.commit()
    finally:
        connection.close()
    return database, table_count


def query_plan(statement, engine) -> list[str]:
    compiled = statement.compile(dialect=sqlite.dialect())
    sql = str(compiled).replace("__app__.", "dwp.")
    params = tuple(compiled.params[name] for name in compiled.positiontup)
    with engine.connect() as connection:
        rows = connection.exec_driver_sql("EXPLAIN QUERY PLAN " + sql, params).fetchall()
    return [str(row[3]) for row in rows]


def run_scale(field_count: int, samples: int, scratch_dir: Path) -> dict:
    with tempfile.TemporaryDirectory(
        prefix=f"field-mapping-{field_count}-", dir=scratch_dir
    ) as temporary:
        directory = Path(temporary)
        seed_started = time.perf_counter()
        database, table_count = create_database(directory, field_count)
        seed_seconds = round(time.perf_counter() - seed_started, 2)
        clear_engine_cache()
        service = InstrumentedFieldMappingService()
        engine = get_engine(PROFILE)

        def measure(label: str, operation: Callable[[], object]):
            previous_count = len(service.statements.get(label, []))
            token = QUERY_LABEL.set(label)
            started = time.perf_counter()
            try:
                value = operation()
            finally:
                duration_ms = (time.perf_counter() - started) * 1000
                QUERY_LABEL.reset(token)
            query_count = len(service.statements.get(label, [])) - previous_count
            return duration_ms, query_count, value

        def repeated(
            label: str,
            operation: Callable[[], object],
            count: int,
        ):
            durations, query_counts, value = [], [], None
            for _ in range(count):
                duration, query_count, value = measure(label, operation)
                durations.append(duration)
                query_counts.append(query_count)
            return durations, query_counts, value

        metrics: dict[str, object] = {}
        stats_reads, stats_queries, _ = repeated(
            "stats_reads", lambda: service.get_stats({}), samples
        )
        metrics["stats_reads"] = {
            **summarize(stats_reads),
            "db_selects_per_call": stats_queries,
        }

        workloads = {
            "source_systems": service.get_source_systems,
            "fields_page_1": lambda: service.get_field_mappings(
                {"page": 1, "pageSize": 50}
            ),
            "fields_page_1000": lambda: service.get_field_mappings(
                {"page": 1000, "pageSize": 50}
            ),
            "tables_page_1": lambda: service.get_table_mappings(
                {"page": 1, "pageSize": 50}
            ),
            "tables_page_1000": lambda: service.get_table_mappings(
                {"page": 1000, "pageSize": 50}
            ),
            "fields_table_pk": lambda: service.get_field_mappings(
                {"tablePk": "123", "page": 1, "pageSize": 50}
            ),
            "stats_table_pk": lambda: service.get_stats({"tablePk": "123"}),
            "fields_source_system": lambda: service.get_field_mappings(
                {"sourceSystemId": "3", "page": 1, "pageSize": 50}
            ),
            "fields_source_field_substring": lambda: service.get_field_mappings(
                {"srcField": "field_003", "page": 1, "pageSize": 50}
            ),
        }
        for name, operation in workloads.items():
            durations, query_counts, value = repeated(
                name,
                operation,
                samples,
            )
            metric = {**summarize(durations), "db_selects_per_call": query_counts}
            if name.endswith("page_1"):
                metric["returned_items"] = len(value["items"])
                metric["total"] = value["total"]
            metrics[name] = metric

        parallel_durations, parallel_stats_queries, parallel_table_queries = [], [], []
        for _ in range(samples):
            def run_one(label: str, operation: Callable[[], object]):
                return measure(label, operation)

            started = time.perf_counter()
            with ThreadPoolExecutor(max_workers=2) as pool:
                stats_future = pool.submit(run_one, "parallel_stats", lambda: service.get_stats({}))
                tables_future = pool.submit(
                    run_one,
                    "parallel_tables",
                    lambda: service.get_table_mappings({"page": 1, "pageSize": 50}),
                )
                stats_result = stats_future.result()
                table_result = tables_future.result()
            parallel_durations.append((time.perf_counter() - started) * 1000)
            parallel_stats_queries.append(stats_result[1])
            parallel_table_queries.append(table_result[1])
        metrics["parallel_stats_plus_table_page"] = {
            **summarize(parallel_durations),
            "stats_db_selects": parallel_stats_queries,
            "table_db_selects": parallel_table_queries,
            "combined_db_selects": [
                stats + tables
                for stats, tables in zip(
                    parallel_stats_queries, parallel_table_queries, strict=True
                )
            ],
        }

        probe_table = max(1, min(table_count, 123))
        filters = {
            "table_pk": {"tablePk": str(probe_table)},
            "source_system_id": {"sourceSystemId": "3"},
            "keyword_no_match": {"keyword": "synthetic-no-match-403"},
        }
        consistency = {}
        for name, params in filters.items():
            field_page = service.get_field_mappings(params)
            stats = service.get_stats(params)
            table_page = service.get_table_mappings(params)
            result = {
                "field_total": field_page["total"],
                "stats_field_count": stats["fieldCount"],
                "table_total": table_page["total"],
                "stats_table_count": stats["sourceTableCount"],
            }
            result["fields_match"] = result["field_total"] == result["stats_field_count"]
            result["tables_match"] = result["table_total"] == result["stats_table_count"]
            if not result["fields_match"] or not result["tables_match"]:
                raise AssertionError(f"Count mismatch for {name}: {result}")
            consistency[name] = result
        metrics["filter_count_consistency"] = consistency

        plans: dict[str, list[list[str]]] = {}

        def capture_plan(label: str, operation: Callable[[], object]) -> None:
            previous_count = len(service.statements.get(label, []))
            token = QUERY_LABEL.set(label)
            try:
                operation()
            finally:
                QUERY_LABEL.reset(token)
            statements = service.statements.get(label, [])[previous_count:]
            plans[label] = [query_plan(statement, engine) for statement in statements]

        capture_plan("stats_unfiltered", lambda: service.get_stats({}))
        capture_plan(
            "fields_unfiltered",
            lambda: service.get_field_mappings({"page": 1, "pageSize": 50}),
        )
        capture_plan(
            "tables_unfiltered",
            lambda: service.get_table_mappings({"page": 1, "pageSize": 50}),
        )
        capture_plan("fields_table_pk", lambda: service.get_field_mappings({"tablePk": "123"}))
        capture_plan(
            "fields_source_system",
            lambda: service.get_field_mappings({"sourceSystemId": "3"}),
        )
        result = {
            "field_count": field_count,
            "table_count": table_count,
            "source_system_count": 10,
            "database_bytes": database.stat().st_size,
            "seed_seconds": seed_seconds,
            "application_stats_cache": (
                "instance TTL cache" if hasattr(service, "clear_stats_cache") else "none"
            ),
            "query_plans": plans,
            "metrics": metrics,
        }
        clear_engine_cache()
        return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scales", default="100000,500000,1000000")
    parser.add_argument("--samples", type=int, default=5)
    parser.add_argument(
        "--scratch-dir",
        type=Path,
        required=True,
        help="task-specific directory outside the repository for disposable SQLite data",
    )
    args = parser.parse_args()
    try:
        scales = [int(value) for value in args.scales.split(",") if value.strip()]
    except ValueError as exc:
        parser.error(f"scales must be comma-separated positive integers: {exc}")
    if args.samples < 2 or args.samples > 30:
        parser.error("--samples must be between 2 and 30")
    if not scales or any(value < 1 for value in scales):
        parser.error("scales must contain positive integers")
    scratch_dir = args.scratch_dir.expanduser().resolve()
    scratch_dir.mkdir(parents=True, exist_ok=True)

    results = {
        "environment": {
            "provider": "SQLite",
            "dataset": "deterministic synthetic; no production data or external database",
            "python_version": platform.python_version(),
            "platform": platform.platform(),
            "cpu_count": os.cpu_count(),
            "sqlite_version": sqlite3.sqlite_version,
            "samples_per_workload": args.samples,
        },
        "scales": [run_scale(scale, args.samples, scratch_dir) for scale in scales],
    }
    print(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
