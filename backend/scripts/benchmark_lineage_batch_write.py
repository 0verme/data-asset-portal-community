#!/usr/bin/env python3
"""Full-write rollback benchmark for lineage batch inserts (Issue #333).

Reads the current ACTIVE lineage snapshot, replays the complete replace
snapshot write path under a unique probe snapshot_id inside one
``database_transaction()``, prints per-stage timings, then forces a rollback.
No probe row is ever committed, so the current ACTIVE snapshot is left
untouched.

The default mode is read-only.  Internal GaussDB/DWS UAT:

    ASSET_DB_JAR_PATH=/path/to/gaussdb-jdbc.jar \\
    python backend/scripts/benchmark_lineage_batch_write.py \\
        --profile primary --config backend/configs/database.yaml --apply

The command never prints credentials or full connection strings.
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from sqlalchemy import delete, func, insert, select, update  # noqa: E402

from app.db.core import execute_core, execute_many_core, fetch_all_core  # noqa: E402
from app.db.facade import database_transaction, get_db_profile  # noqa: E402
from app.db.tables import lineage_edge, lineage_node, lineage_snapshot, operation_log  # noqa: E402
from app.services.metadata_ingestion_service import LINEAGE_INSERT_BATCH_SIZE  # noqa: E402

STAGES = ("read", "snapshot_insert", "node_insert", "edge_insert", "active_switch", "audit", "total")


class _ForcedRollback(Exception):
    """Internal control-flow exception that rolls the benchmark transaction back."""


def _read_active_snapshot(profile: str) -> tuple[dict, int]:
    columns, rows = fetch_all_core(
        profile,
        select(
            lineage_snapshot.c.snapshot_id,
            lineage_snapshot.c.generated_at,
            lineage_snapshot.c.generator_name,
            lineage_snapshot.c.generator_version,
            lineage_snapshot.c.import_batch_id,
            lineage_snapshot.c.source_key,
            lineage_snapshot.c.content_hash,
        ).where(lineage_snapshot.c.status_code == "ACTIVE"),
    )
    if not rows:
        raise RuntimeError("no ACTIVE lineage snapshot found; nothing to benchmark")
    return dict(zip(columns, rows[0], strict=True)), len(rows)


def _read_nodes(profile: str, snapshot_id: str) -> list[dict]:
    columns, rows = fetch_all_core(
        profile,
        select(
            lineage_node.c.node_id,
            lineage_node.c.kind_code,
            lineage_node.c.node_name,
            lineage_node.c.display_name,
            lineage_node.c.namespace_name,
            lineage_node.c.attributes_json,
        ).where(lineage_node.c.snapshot_id == snapshot_id),
    )
    return [dict(zip(columns, row, strict=True)) for row in rows]


def _read_edges(profile: str, snapshot_id: str) -> list[dict]:
    columns, rows = fetch_all_core(
        profile,
        select(
            lineage_edge.c.edge_id,
            lineage_edge.c.source_node_id,
            lineage_edge.c.target_node_id,
            lineage_edge.c.kind_code,
            lineage_edge.c.evidence_type,
            lineage_edge.c.source_record_id,
            lineage_edge.c.evidence_description,
            lineage_edge.c.confidence_code,
            lineage_edge.c.generated_at,
            lineage_edge.c.diagnostics_json,
        ).where(lineage_edge.c.snapshot_id == snapshot_id),
    )
    return [dict(zip(columns, row, strict=True)) for row in rows]


def _insert_batches(profile: str, statement, rows: list[dict], batch_size: int) -> None:
    for offset in range(0, len(rows), batch_size):
        execute_many_core(profile, statement, rows[offset:offset + batch_size])


def _count_snapshot_rows(profile: str, table, snapshot_id: str) -> int:
    _columns, rows = fetch_all_core(
        profile,
        select(func.count()).select_from(table).where(table.c.snapshot_id == snapshot_id),
    )
    return int(rows[0][0])


def _cleanup_probe(profile: str, probe_id: str) -> None:
    """Best-effort removal of probe rows if a rollback unexpectedly failed."""
    with database_transaction():
        execute_core(profile, delete(lineage_edge).where(lineage_edge.c.snapshot_id == probe_id))
        execute_core(profile, delete(lineage_node).where(lineage_node.c.snapshot_id == probe_id))
        execute_core(profile, delete(lineage_snapshot).where(lineage_snapshot.c.snapshot_id == probe_id))


def run_rollback_benchmark(profile: str, *, probe_id: str | None = None, batch_size: int = LINEAGE_INSERT_BATCH_SIZE) -> dict:
    """Replay a full lineage snapshot write and roll it back.

    Returns the per-stage timings plus the post-rollback residual row counts.
    Raises if probe rows survive the rollback (after a best-effort cleanup).
    """
    probe_id = probe_id or f"benchmark-probe-{uuid4().hex}"
    timings: dict[str, float] = {}
    read_started = time.perf_counter()
    active, active_count = _read_active_snapshot(profile)
    nodes = _read_nodes(profile, active["snapshot_id"])
    edges = _read_edges(profile, active["snapshot_id"])
    timings["read"] = time.perf_counter() - read_started

    started = time.perf_counter()
    try:
        with database_transaction():
            stage_started = time.perf_counter()
            execute_core(
                profile,
                insert(lineage_snapshot).values(
                    snapshot_id=probe_id,
                    generated_at=active["generated_at"],
                    generator_name=active["generator_name"],
                    generator_version=active["generator_version"],
                    import_batch_id=f"{probe_id}-import",
                    source_key=active["source_key"],
                    content_hash=active["content_hash"],
                    ingestion_id=probe_id,
                    status_code="INACTIVE",
                ),
            )
            timings["snapshot_insert"] = time.perf_counter() - stage_started

            stage_started = time.perf_counter()
            node_rows = [dict(row, snapshot_id=probe_id) for row in nodes]
            _insert_batches(profile, insert(lineage_node), node_rows, batch_size)
            timings["node_insert"] = time.perf_counter() - stage_started

            stage_started = time.perf_counter()
            edge_rows = [dict(row, snapshot_id=probe_id) for row in edges]
            _insert_batches(profile, insert(lineage_edge), edge_rows, batch_size)
            timings["edge_insert"] = time.perf_counter() - stage_started

            stage_started = time.perf_counter()
            execute_core(
                profile,
                update(lineage_snapshot)
                .where(lineage_snapshot.c.status_code == "ACTIVE")
                .values(status_code="INACTIVE"),
            )
            execute_core(
                profile,
                update(lineage_snapshot)
                .where(lineage_snapshot.c.snapshot_id == probe_id)
                .values(status_code="ACTIVE"),
            )
            timings["active_switch"] = time.perf_counter() - stage_started

            stage_started = time.perf_counter()
            execute_core(
                profile,
                insert(operation_log).values(
                    user_id="",
                    user_name="benchmark-probe",
                    dept_name="",
                    module_name="metadata-ingestion",
                    operation_type="lineage-snapshot-publish",
                    operation_object=probe_id,
                    operation_desc="rollback benchmark probe",
                    request_method="",
                    request_url="",
                    request_params=None,
                    result_status="success",
                    error_message=None,
                    ip_address="",
                    user_agent="",
                    cost_time_ms=0,
                    remark="probe-only",
                    created_at=datetime.now(timezone.utc),
                ),
            )
            timings["audit"] = time.perf_counter() - stage_started
            raise _ForcedRollback()
    except _ForcedRollback:
        pass
    timings["total"] = time.perf_counter() - started

    residual = {
        "snapshot": _count_snapshot_rows(profile, lineage_snapshot, probe_id),
        "node": _count_snapshot_rows(profile, lineage_node, probe_id),
        "edge": _count_snapshot_rows(profile, lineage_edge, probe_id),
    }
    if any(residual.values()):
        _cleanup_probe(profile, probe_id)
        raise RuntimeError(f"probe rows survived rollback and were cleaned up: {residual}")

    return {
        "probe_id": probe_id,
        "active_snapshot_id": active["snapshot_id"],
        "active_snapshot_count": active_count,
        "nodes": len(nodes),
        "edges": len(edges),
        "batch_size": batch_size,
        "timings": timings,
        "residual": residual,
    }


def _parser():
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--profile", required=True, help="Existing named DB profile; never a connection string.")
    parser.add_argument("--config", help="Existing database profile configuration file.")
    parser.add_argument("--probe-id", help="Override the generated probe snapshot id.")
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Run the full-write benchmark. Every probe write is rolled back.",
    )
    return parser


def main(argv=None) -> int:
    args = _parser().parse_args(argv)
    if args.config:
        os.environ["ASSET_DB_CONFIG_PATH"] = args.config
    os.environ.setdefault("ASSET_DB_PROFILE", args.profile)
    config = get_db_profile(args.profile)
    print(f"profile={args.profile} type={config.get('type')} rollback_only=yes")
    if not args.apply:
        active, active_count = _read_active_snapshot(args.profile)
        nodes = _count_snapshot_rows(args.profile, lineage_node, active["snapshot_id"])
        edges = _count_snapshot_rows(args.profile, lineage_edge, active["snapshot_id"])
        print(
            f"plan active_snapshot={active['snapshot_id']} active_count={active_count} "
            f"nodes={nodes} edges={edges} batch_size={LINEAGE_INSERT_BATCH_SIZE}"
        )
        print("action=dry-run pass --apply to run the full-write rollback benchmark")
        return 0

    result = run_rollback_benchmark(args.profile, probe_id=args.probe_id)
    print(
        f"active_snapshot={result['active_snapshot_id']} "
        f"nodes={result['nodes']} edges={result['edges']} batch_size={result['batch_size']}"
    )
    for stage in STAGES:
        print(f"stage={stage} seconds={result['timings'][stage]:.3f}")
    residual = result["residual"]
    print(
        f"residual_snapshot={residual['snapshot']} residual_node={residual['node']} "
        f"residual_edge={residual['edge']}"
    )
    print("rollback=OK")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"lineage batch benchmark failed: {error}", file=sys.stderr)
        raise SystemExit(1)
