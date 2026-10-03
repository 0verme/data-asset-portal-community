"""Persistent default-root selection semantics and bounded query shape.

These tests pin the product priority that the previous GaussDB/DWS
implementation also had, while proving the new set-based candidate queries stay
deterministic and bounded for every fallback stage.
"""

from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.app.db.service import CoreAccess
from backend.app.db.sqlite_adapter import connect
from backend.app.migrations.schema import initialize
from backend.app.services.lineage_database_reader import LineageDatabaseReader


class LineageDefaultRootTests(unittest.TestCase):
    SNAPSHOT = "snapshot"

    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.database = Path(self.temp_dir.name) / "lineage.sqlite"
        self.config_path = Path(self.temp_dir.name) / "database.yaml"
        self.config_path.write_text(
            "profiles:\n  lineage_test:\n    type: sqlite\n    database: "
            + self.database.as_posix()
            + "\n",
            encoding="utf-8",
        )
        self.environment = patch.dict(
            os.environ,
            {
                "ASSET_DB_CONFIG_PATH": str(self.config_path),
                "ASSET_DB_PROFILE": "lineage_test",
                "LINEAGE_DB_PROFILE": "lineage_test",
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
        self.reader = LineageDatabaseReader(
            CoreAccess(profile_getter=lambda: "lineage_test", error_factory=RuntimeError)
        )

    def _seed(self, nodes, edges, snapshot_id=SNAPSHOT):
        connection = connect({"type": "sqlite", "database": str(self.database)})
        try:
            connection.execute(
                "INSERT INTO dwp.p_lineage_snapshot "
                "(snapshot_id, generated_at, generator_name, generator_version, import_batch_id, status_code) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (snapshot_id, "2026-10-03T00:00:00", "test-collector", "1", "import", "ACTIVE"),
            )
            connection.executemany(
                "INSERT INTO dwp.p_lineage_node "
                "(snapshot_id, node_id, kind_code, node_name, display_name, namespace_name, attributes_json) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                [
                    (snapshot_id, node_id, kind, name or node_id, name or node_id, namespace, "{}")
                    for node_id, kind, namespace, name in nodes
                ],
            )
            connection.executemany(
                "INSERT INTO dwp.p_lineage_edge "
                "(snapshot_id, edge_id, source_node_id, target_node_id, kind_code, evidence_type, "
                "source_record_id, evidence_description, confidence_code, generated_at, diagnostics_json) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [
                    (
                        snapshot_id,
                        edge_id,
                        source,
                        target,
                        "table_lineage",
                        "test",
                        edge_id,
                        edge_id,
                        "high",
                        "2026-10-03T00:00:00",
                        "[]",
                    )
                    for edge_id, source, target in edges
                ],
            )
            connection.commit()
        finally:
            connection.close()

    @staticmethod
    def _table(node_id, layer):
        return (node_id, "table", layer, None)

    @staticmethod
    def _task(node_id, layer):
        return (node_id, "task", layer, None)

    def _root_with_observations(self):
        original_fetch_rows = CoreAccess.fetch_rows
        observed = []

        def track(db, statement):
            rows = original_fetch_rows(db, statement)
            observed.append((str(statement), len(rows)))
            return rows

        with patch.object(CoreAccess, "fetch_rows", track):
            root_id = self.reader.default_root_id(self.SNAPSHOT)
        return root_id, observed

    def test_connected_table_beats_disconnected_table_and_connected_task(self):
        self._seed(
            [
                self._table("table:dwf:disconnected", "DWF"),
                self._table("table:other:connected", "OTHER"),
                self._task("task:other:connected", "DWF"),
            ],
            [
                ("e-in", "task:other:connected", "table:other:connected"),
                ("e-out", "table:other:connected", "task:other:connected"),
            ],
        )
        self.assertEqual("table:other:connected", self.reader.default_root_id(self.SNAPSHOT))

    def test_layer_ranking_applies_among_connected_tables(self):
        self._seed(
            [
                self._table("table:dwp:c", "DWS_DWP"),
                self._table("table:dwm:b", "DWM"),
                self._table("table:dwf:a", "DWF"),
                self._task("task:in", "ODS"),
                self._task("task:out", "ODS"),
            ],
            [
                ("e-in-a", "task:in", "table:dwf:a"),
                ("e-out-a", "table:dwf:a", "task:out"),
                ("e-in-b", "task:in", "table:dwm:b"),
                ("e-out-b", "table:dwm:b", "task:out"),
                ("e-in-c", "task:in", "table:dwp:c"),
                ("e-out-c", "table:dwp:c", "task:out"),
            ],
        )
        self.assertEqual("table:dwf:a", self.reader.default_root_id(self.SNAPSHOT))

    def test_dws_namespace_alias_ranks_with_base_layer(self):
        self._seed(
            [
                self._table("table:dws_dwf:a", "DWS_DWF"),
                self._table("table:dwm:b", "DWM"),
                self._task("task:in", "ODS"),
                self._task("task:out", "ODS"),
            ],
            [
                ("e-in-a", "task:in", "table:dws_dwf:a"),
                ("e-out-a", "table:dws_dwf:a", "task:out"),
                ("e-in-b", "task:in", "table:dwm:b"),
                ("e-out-b", "table:dwm:b", "task:out"),
            ],
        )
        self.assertEqual("table:dws_dwf:a", self.reader.default_root_id(self.SNAPSHOT))

    def test_incoming_only_and_outgoing_only_tables_fall_back_by_layer(self):
        self._seed(
            [
                self._table("table:dwm:incoming_only", "DWM"),
                self._table("table:dwf:outgoing_only", "DWF"),
                self._task("task:in", "ODS"),
                self._task("task:out", "ODS"),
            ],
            [
                ("e-in", "task:in", "table:dwm:incoming_only"),
                ("e-out", "table:dwf:outgoing_only", "task:out"),
            ],
        )
        self.assertEqual("table:dwf:outgoing_only", self.reader.default_root_id(self.SNAPSHOT))

    def test_non_table_fallback_prefers_connected_node_before_layer(self):
        self._seed(
            [
                self._task("task:other:connected", "OTHER"),
                ("push:dwf:disconnected", "push_job", "DWF", None),
                self._task("task:dwf:disconnected", "DWF"),
            ],
            [
                ("e-in", "task:other:connected", "task:other:connected"),
                ("e-out", "task:other:connected", "task:other:connected"),
            ],
        )
        self.assertEqual("task:other:connected", self.reader.default_root_id(self.SNAPSHOT))

    def test_disconnected_fallback_is_deterministic_by_node_id(self):
        self._seed(
            [
                self._table("table:dwf:b", "DWF"),
                self._table("table:dwf:a", "DWF"),
            ],
            [],
        )
        self.assertEqual("table:dwf:a", self.reader.default_root_id(self.SNAPSHOT))

    def test_duplicate_and_high_degree_edges_do_not_change_root(self):
        nodes = [
            self._table("table:dwm:heavy", "DWM"),
            self._table("table:dwf:light", "DWF"),
            self._task("task:in", "ODS"),
            self._task("task:out", "ODS"),
        ]
        edges = [
            (f"heavy-in-{index}", "task:in", "table:dwm:heavy")
            for index in range(250)
        ]
        edges += [
            (f"heavy-out-{index}", "table:dwm:heavy", "task:out")
            for index in range(250)
        ]
        edges += [
            ("light-in", "task:in", "table:dwf:light"),
            ("light-out", "table:dwf:light", "task:out"),
        ]
        self._seed(nodes, edges)
        self.assertEqual("table:dwf:light", self.reader.default_root_id(self.SNAPSHOT))

    def test_empty_snapshot_returns_none(self):
        self._seed([], [])
        self.assertIsNone(self.reader.default_root_id(self.SNAPSHOT))

    def test_connected_table_hit_is_one_bounded_single_row_query(self):
        nodes = [self._table(f"table:dwf:{index:04d}", "DWF") for index in range(120)]
        nodes += [
            self._table("table:other:connected", "OTHER"),
            self._task("task:in", "ODS"),
        ]
        self._seed(
            nodes,
            [
                ("e-in", "task:in", "table:other:connected"),
                ("e-out", "table:other:connected", "task:in"),
            ],
        )
        root_id, observed = self._root_with_observations()
        self.assertEqual("table:other:connected", root_id)
        self.assertEqual(1, len(observed))
        self.assertLessEqual(observed[0][1], 1)
        self.assertIn("distinct", observed[0][0].lower())
        self.assertIn("limit", observed[0][0].lower())

    def test_table_fallback_without_edges_uses_two_bounded_queries(self):
        self._seed(
            [self._table(f"table:dwf:{index:04d}", "DWF") for index in range(120)],
            [],
        )
        root_id, observed = self._root_with_observations()
        self.assertEqual("table:dwf:0000", root_id)
        self.assertEqual(2, len(observed))
        self.assertTrue(all(count <= 1 for _sql, count in observed))
        self.assertTrue(all("limit" in sql.lower() for sql, _count in observed))

    def test_connected_non_table_fallback_uses_three_bounded_queries(self):
        self._seed(
            [
                self._task("task:other:connected", "OTHER"),
                self._task("task:dwf:disconnected", "DWF"),
            ],
            [
                ("e-in", "task:other:connected", "task:other:connected"),
                ("e-out", "task:other:connected", "task:other:connected"),
            ],
        )
        root_id, observed = self._root_with_observations()
        self.assertEqual("task:other:connected", root_id)
        self.assertEqual(3, len(observed))
        self.assertTrue(all(count <= 1 for _sql, count in observed))

    def test_any_node_fallback_uses_four_bounded_queries(self):
        self._seed(
            [
                self._task("task:dwf:b", "DWF"),
                self._task("task:dwf:a", "DWF"),
            ],
            [],
        )
        root_id, observed = self._root_with_observations()
        self.assertEqual("task:dwf:a", root_id)
        self.assertEqual(4, len(observed))
        self.assertTrue(all(count <= 1 for _sql, count in observed))
        self.assertTrue(all("limit" in sql.lower() for sql, _count in observed))


if __name__ == "__main__":
    unittest.main()
