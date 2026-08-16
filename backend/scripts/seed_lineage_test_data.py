#!/usr/bin/env python3
"""Seed or remove the deterministic lineage graph from a safe database profile."""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from app.db.gaussdb import database_transaction, execute_sql, get_db_profile
from app.services.lineage_test_data import SNAPSHOT_ID, build_test_snapshot, test_snapshot_counts


def _parser():
    parser = argparse.ArgumentParser(description=__doc__)
    command = parser.add_mutually_exclusive_group(required=True)
    command.add_argument("--dry-run", action="store_true")
    command.add_argument("--apply", action="store_true")
    command.add_argument("--cleanup", action="store_true")
    parser.add_argument("--profile", required=True, help="Existing named DB profile; never a connection string.")
    parser.add_argument("--config", help="Existing database profile configuration file.")
    return parser


def _safe_profile(name, config):
    db_type = str(config.get("type", "")).lower()
    host = str(config.get("host", "")).lower()
    database = str(config.get("database", ""))
    jdbc_url = str(config.get("jdbc_url", "")).lower()
    profile = name.lower()
    production_markers = ("prod", "production")
    haystack = f"{profile} {database.lower()} {host} {jdbc_url}"
    if any(marker in haystack for marker in production_markers):
        raise RuntimeError("refusing lineage test data: production marker detected")
    if db_type not in {"postgres", "gaussdb"}:
        raise RuntimeError(
            "refusing lineage test data: only postgres or gaussdb profiles are allowed"
        )
    if not any(marker in haystack for marker in ("dev", "test", "local")):
        raise RuntimeError(
            "refusing lineage test data: profile/host/database must explicitly mark "
            "dev, test, or local"
        )
    if db_type == "postgres":
        return f"postgres:{host}/{database}"
    return f"gaussdb:{jdbc_url}"


def _delete_snapshot(profile):
    # Delete dependants explicitly so re-seed works even when FK cascade is unavailable.
    execute_sql(profile, "DELETE FROM dwp.p_lineage_edge WHERE snapshot_id = ?", autocommit=False, params=[SNAPSHOT_ID])
    execute_sql(profile, "DELETE FROM dwp.p_lineage_node WHERE snapshot_id = ?", autocommit=False, params=[SNAPSHOT_ID])
    execute_sql(profile, "DELETE FROM dwp.p_lineage_snapshot WHERE import_batch_id = ?", autocommit=False, params=[SNAPSHOT_ID])


def _apply(profile, snapshot):
    with database_transaction():
        _delete_snapshot(profile)
        execute_sql(profile, """
INSERT INTO dwp.p_lineage_snapshot (snapshot_id, generated_at, generator_name, generator_version, import_batch_id, status_code)
VALUES (?, ?, ?, ?, ?, 'ACTIVE')
""", autocommit=False, params=[snapshot["snapshotId"], snapshot["generatedAt"], snapshot["generator"]["name"], snapshot["generator"]["version"], SNAPSHOT_ID])
        for node in snapshot["nodes"]:
            execute_sql(profile, """
INSERT INTO dwp.p_lineage_node (snapshot_id, node_id, kind_code, node_name, display_name, namespace_name, attributes_json)
VALUES (?, ?, ?, ?, ?, ?, ?)
""", autocommit=False, params=[SNAPSHOT_ID, node["id"], node["kind"], node["name"], node["displayName"], node["namespace"], json.dumps(node["attributes"], ensure_ascii=False, sort_keys=True)])
        for edge in snapshot["edges"]:
            evidence = edge["evidence"]
            execute_sql(profile, """
INSERT INTO dwp.p_lineage_edge (snapshot_id, edge_id, source_node_id, target_node_id, kind_code, evidence_type, source_record_id, evidence_description, confidence_code, generated_at, diagnostics_json)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
""", autocommit=False, params=[SNAPSHOT_ID, edge["id"], edge["sourceId"], edge["targetId"], edge["kind"], evidence["type"], evidence["sourceRecordId"], evidence["description"], edge["confidence"], edge["generatedAt"], json.dumps(edge["diagnostics"], ensure_ascii=False)])


def main(argv=None):
    args = _parser().parse_args(argv)
    if args.config:
        os.environ["ASSET_DB_CONFIG_PATH"] = args.config
    config = get_db_profile(args.profile)
    target = _safe_profile(args.profile, config)
    counts = test_snapshot_counts()
    print(f"target={target} snapshot={SNAPSHOT_ID} tables={counts['tables']} tasks={counts['tasks']} edges={counts['edges']} evidence={counts['edges']}")
    if args.dry_run:
        print("action=dry-run existing TEST_LIN_ snapshot will be replaced on apply")
        return 0
    if args.cleanup:
        with database_transaction(): _delete_snapshot(args.profile)
        print("action=cleanup deleted_snapshots=1")
        return 0
    _apply(args.profile, build_test_snapshot())
    print(f"action=apply inserted_snapshots=1 inserted_nodes={counts['tables'] + counts['tasks']} inserted_edges={counts['edges']} inserted_evidence={counts['edges']}")
    return 0


if __name__ == "__main__":
    try: raise SystemExit(main())
    except Exception as error:
        print(f"lineage seed failed: {error}", file=sys.stderr); raise SystemExit(1)
