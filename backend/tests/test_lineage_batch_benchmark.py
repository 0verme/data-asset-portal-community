"""SQLite coverage for the lineage full-write rollback benchmark (#333)."""

from __future__ import annotations

import contextlib
import io
import os
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

from sqlalchemy import insert, select

from backend.app.db.core import execute_core, fetch_all_core
from backend.app.db.facade import database_transaction
from backend.app.db.sqlite_adapter import connect
from backend.app.db.tables import lineage_edge, lineage_node, lineage_snapshot
from backend.app.migrations.schema import initialize
from backend.scripts import benchmark_lineage_batch_write as benchmark

PROFILE = "benchmark_test"
SNAPSHOT_ID = "active-snapshot"


class LineageBatchBenchmarkSqliteTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.database = Path(self.temp_dir.name) / "benchmark.sqlite"
        self.config = Path(self.temp_dir.name) / "database.yaml"
        self.config.write_text(
            "profiles:\n  "
            + PROFILE
            + ":\n    type: sqlite\n    database: "
            + self.database.as_posix()
            + "\n",
            encoding="utf-8",
        )
        self.environment = patch.dict(
            os.environ,
            {
                "ASSET_DB_CONFIG_PATH": str(self.config),
                "ASSET_DB_PROFILE": PROFILE,
            },
            clear=False,
        )
        self.environment.start()
        self.addCleanup(self.environment.stop)
        connection = connect({"type": "sqlite", "database": str(self.database)})
        try:
            initialize(connection, {"type": "sqlite", "database": str(self.database)}, "sqlite")
        finally:
            connection.close()
        self._seed_active_snapshot()

    def _seed_active_snapshot(self):
        with database_transaction():
            execute_core(
                PROFILE,
                insert(lineage_snapshot).values(
                    snapshot_id=SNAPSHOT_ID,
                    generated_at=datetime(2026, 10, 3, 9, 0, 0),
                    generator_name="seed",
                    generator_version="1.0",
                    import_batch_id="seed-import",
                    source_key="seed-source",
                    content_hash="seed-hash",
                    ingestion_id="seed-ingestion",
                    status_code="ACTIVE",
                ),
            )
            execute_core(
                PROFILE,
                insert(lineage_node).values(
                    snapshot_id=SNAPSHOT_ID,
                    node_id="node:1",
                    kind_code="table",
                    node_name="orders",
                    display_name="orders",
                    namespace_name="public",
                    attributes_json="{}",
                ),
            )
            execute_core(
                PROFILE,
                insert(lineage_node).values(
                    snapshot_id=SNAPSHOT_ID,
                    node_id="node:2",
                    kind_code="table",
                    node_name="orders_daily",
                    display_name="orders_daily",
                    namespace_name="public",
                    attributes_json="{}",
                ),
            )
            execute_core(
                PROFILE,
                insert(lineage_edge).values(
                    snapshot_id=SNAPSHOT_ID,
                    edge_id="edge:1",
                    source_node_id="node:1",
                    target_node_id="node:2",
                    kind_code="table_lineage",
                    evidence_type="mapping",
                    source_record_id="record:1",
                    evidence_description="fixture",
                    confidence_code="high",
                    generated_at=datetime(2026, 10, 3, 9, 0, 0),
                    diagnostics_json="[]",
                ),
            )

    def _snapshot_rows(self):
        _columns, rows = fetch_all_core(
            PROFILE,
            select(lineage_snapshot.c.snapshot_id, lineage_snapshot.c.status_code),
        )
        return sorted(rows)

    def test_rollback_benchmark_leaves_no_probe_rows(self):
        result = benchmark.run_rollback_benchmark(PROFILE, probe_id="benchmark-probe-test")

        self.assertEqual(SNAPSHOT_ID, result["active_snapshot_id"])
        self.assertEqual(1, result["active_snapshot_count"])
        self.assertEqual(2, result["nodes"])
        self.assertEqual(1, result["edges"])
        self.assertEqual({"snapshot": 0, "node": 0, "edge": 0}, result["residual"])
        for stage in benchmark.STAGES:
            self.assertIn(stage, result["timings"])
        self.assertEqual([(SNAPSHOT_ID, "ACTIVE")], self._snapshot_rows())

    def test_cli_dry_run_does_not_write(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            exit_code = benchmark.main(["--profile", PROFILE])

        self.assertEqual(0, exit_code)
        self.assertIn("action=dry-run", output.getvalue())
        self.assertEqual([(SNAPSHOT_ID, "ACTIVE")], self._snapshot_rows())

    def test_cli_apply_reports_stages_and_rolls_back(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            exit_code = benchmark.main(
                ["--profile", PROFILE, "--apply", "--probe-id", "benchmark-probe-cli"]
            )

        self.assertEqual(0, exit_code)
        text = output.getvalue()
        self.assertIn("rollback=OK", text)
        self.assertIn("stage=node_insert", text)
        self.assertIn("residual_snapshot=0 residual_node=0 residual_edge=0", text)
        self.assertEqual([(SNAPSHOT_ID, "ACTIVE")], self._snapshot_rows())


if __name__ == "__main__":
    unittest.main()
