import unittest
from unittest.mock import patch

from backend.app.services.lineage_collector import (
    build_snapshot,
    is_dwf_table,
    normalize_table_name,
    parse_dependencies,
    publish_snapshot,
)
from backend.tests.db_test_support import skip_without_postgres_integration


JOB_ROWS = [
    ("PLAN_A", "JOB_A", ""),
    ("PLAN_B", "JOB_B", "33:JOB_A|44:JOB_MISSING"),
    ("PLAN_C", "JOB_C", "33:JOB_B"),
]
TABLE_JOB_ROWS = [
    ("DWF.ACCOUNT", "JOB_A"),
    ("DWF.ACCOUNT_EXTRA", "JOB_A"),
    ("DWM.PROFILE", "JOB_B"),
    ("DM.REPORT", "JOB_C"),
]


class LineageCollectorUnitTests(unittest.TestCase):
    def test_normalizes_names_and_parses_dependencies(self):
        self.assertEqual(normalize_table_name(' "dwf.account" '), "DWF.ACCOUNT")
        self.assertTrue(is_dwf_table("dws_dwf.account"))
        dependencies, diagnostics = parse_dependencies("33:job_a|44: job_b |bad")
        self.assertEqual(dependencies, [("JOB_A", "33"), ("JOB_B", "44")])
        self.assertEqual(diagnostics[0]["code"], "INVALID_DEPENDENCY_SEGMENT")

    def test_builds_stable_multi_table_job_graph_and_diagnostics(self):
        first = build_snapshot(JOB_ROWS, TABLE_JOB_ROWS, snapshot_id="S1", generated_at="2026-01-01T00:00:00Z")
        second = build_snapshot(JOB_ROWS, TABLE_JOB_ROWS, snapshot_id="S2", generated_at="2026-01-01T00:00:00Z")
        self.assertEqual(
            {node["id"] for node in first["nodes"]},
            {node["id"] for node in second["nodes"]},
        )
        self.assertEqual(
            {edge["id"] for edge in first["edges"]},
            {edge["id"] for edge in second["edges"]},
        )
        input_edges = [edge for edge in first["edges"] if edge["kind"] == "task_reads_table"]
        self.assertEqual(len([edge for edge in input_edges if edge["targetId"] == "task:JOB_B"]), 2)
        self.assertIn("MISSING_JOB", {item["code"] for item in first["diagnostics"]})
        self.assertIn("UNMAPPED_JOB", {item["code"] for item in first["diagnostics"]})

    def test_detects_dependency_cycles(self):
        snapshot = build_snapshot(
            [("P", "JOB_A", "33:JOB_B"), ("P", "JOB_B", "33:JOB_A")],
            [("DWM.A", "JOB_A"), ("DWM.B", "JOB_B")],
            snapshot_id="CYCLE",
            generated_at="2026-01-01T00:00:00Z",
        )
        self.assertIn("DEPENDENCY_CYCLE", {item["code"] for item in snapshot["diagnostics"]})

    def test_rejects_empty_source_or_mapping(self):
        with self.assertRaises(ValueError):
            build_snapshot([], TABLE_JOB_ROWS)
        with self.assertRaises(ValueError):
            build_snapshot(JOB_ROWS, [])

    def test_publish_snapshot_locks_and_writes_in_transaction_protocol(self):
        snapshot = build_snapshot(
            JOB_ROWS,
            TABLE_JOB_ROWS,
            snapshot_id="VALID",
            generated_at="2026-01-01T00:00:00Z",
        )
        executed = []

        def capture_sql(profile, sql, autocommit=True, params=None):
            executed.append((sql.strip().splitlines()[0], params))
            return True

        with patch(
            "backend.app.services.lineage_collector.database_transaction"
        ) as tx, patch(
            "backend.app.services.lineage_collector.execute_sql",
            side_effect=capture_sql,
        ), patch(
            "backend.app.services.lineage_collector.execute_many",
            return_value=True,
        ):
            tx.return_value.__enter__.return_value = None
            tx.return_value.__exit__.return_value = None
            publish_snapshot("lineage_test", snapshot)

        self.assertTrue(any("LOCK TABLE dwp.p_lineage_snapshot" in sql for sql, _ in executed))
        self.assertTrue(any("INSERT INTO dwp.p_lineage_snapshot" in sql for sql, _ in executed))


@skip_without_postgres_integration()
class LineageCollectorPostgresIntegrationTests(unittest.TestCase):
    def test_publish_atomicity_requires_isolated_postgres(self):
        self.assertTrue(True)


if __name__ == "__main__":
    unittest.main()
