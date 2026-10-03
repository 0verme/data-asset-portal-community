from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.app.db.service import CoreAccess
from backend.app.db.sqlite_adapter import connect
from backend.app.migrations.schema import initialize
from backend.app.services import lineage_service


class PersistentLineageReadTests(unittest.TestCase):
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
            self._seed(connection)
        finally:
            connection.close()

    @staticmethod
    def _seed(connection):
        connection.execute(
            "INSERT INTO dwp.p_lineage_snapshot "
            "(snapshot_id, generated_at, generator_name, generator_version, import_batch_id, status_code) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            ("active", "2026-10-01T00:00:00", "test-collector", "1", "active-import", "ACTIVE"),
        )
        connection.execute(
            "INSERT INTO dwp.p_lineage_snapshot "
            "(snapshot_id, generated_at, generator_name, generator_version, import_batch_id, status_code) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            ("inactive", "2026-09-01T00:00:00", "old-collector", "1", "inactive-import", "INACTIVE"),
        )
        nodes = {
            "table:input_a": ("table", "INPUT_A", "ODS", {}),
            "table:input_b": ("table", "INPUT_B", "ODS", {}),
            "table:out_a": ("table", "OUT_A", "DWM", {}),
            "table:out_b": ("table", "OUT_B", "DWM", {}),
            "task:shared": ("task", "JOB_SHARED", "scheduler", {}),
            "task:alternate": ("task", "JOB_ALTERNATE", "scheduler", {}),
            "table:above_dwf": ("table", "ABOVE_DWF", "ODS", {}),
            "task:load_dwf": ("task", "JOB_LOAD_DWF", "scheduler", {}),
            "table:dwf_boundary": (
                "table", "DWF.BOUNDARY", "DWF", {"dwfBoundary": True}
            ),
            "task:load_root": ("task", "JOB_LOAD_ROOT", "scheduler", {}),
            "table:lineage_root": ("table", "LINEAGE_ROOT", "DWM", {}),
            "table:match_one": ("table", "MATCHING_ONE", "ODS", {}),
            "table:match_two": ("table", "MATCHING_TWO", "ODS", {}),
            "table:match_three": ("table", "MATCHING_THREE", "ODS", {}),
        }
        connection.executemany(
            "INSERT INTO dwp.p_lineage_node "
            "(snapshot_id, node_id, kind_code, node_name, display_name, namespace_name, attributes_json) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            [
                ("active", node_id, kind, name, name, namespace, json.dumps(attributes))
                for node_id, (kind, name, namespace, attributes) in nodes.items()
            ]
            + [("inactive", "table:inactive-match", "table", "MATCHING_INACTIVE", "MATCHING_INACTIVE", "ODS", "{}")],
        )
        edges = [
            ("e-in-a-1", "table:input_a", "task:shared", "reads", "input-record-a1", "input-a1", "[]"),
            ("e-in-a-2", "table:input_a", "task:shared", "reads", "input-record-a2", "input-a2", "[]"),
            ("e-in-b", "table:input_b", "task:shared", "reads", "input-record-b", "input-b", "[]"),
            ("e-shared-out-a", "task:shared", "table:out_a", "writes", "output-a", "output-a", "[]"),
            ("e-shared-out-b", "task:shared", "table:out_b", "writes", "output-b", "output-b", "[]"),
            ("e-in-a-alt", "table:input_a", "task:alternate", "reads", "input-alt", "input-alt", "[]"),
            ("e-alt-out-a", "task:alternate", "table:out_a", "writes", "output-alt", "output-alt", "[]"),
            ("e-shared-cycle", "table:out_a", "task:shared", "reads", "cycle", "cycle", "[]"),
            ("e-direct-self", "table:input_a", "table:input_a", "table_lineage", "self", "self", "[]"),
            ("e-above-dwf", "table:above_dwf", "task:load_dwf", "reads", "above", "above", "[]"),
            ("e-load-dwf", "task:load_dwf", "table:dwf_boundary", "writes", "dwf", "dwf", "[]"),
            ("e-dwf-root", "table:dwf_boundary", "task:load_root", "reads", "dwf-root", "dwf-root", "[]"),
            ("e-load-root", "task:load_root", "table:lineage_root", "writes", "root", "root", "[]"),
        ]
        connection.executemany(
            "INSERT INTO dwp.p_lineage_edge "
            "(snapshot_id, edge_id, source_node_id, target_node_id, kind_code, evidence_type, "
            "source_record_id, evidence_description, confidence_code, generated_at, diagnostics_json) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
                ("active", edge_id, source, target, kind, "test", record_id, description, "high", "2026-10-01T00:00:00", diagnostics)
                for edge_id, source, target, kind, record_id, description, diagnostics in edges
            ],
        )
        connection.commit()

    def test_bootstrap_and_initial_view_do_not_load_the_full_snapshot(self):
        original_fetch_rows = CoreAccess.fetch_rows
        statements = []

        def track(db, statement):
            rows = original_fetch_rows(db, statement)
            statements.append((str(statement), len(rows)))
            return rows

        with (
            patch.object(CoreAccess, "fetch_rows", track),
            patch.object(lineage_service, "_database_snapshot", side_effect=AssertionError("full snapshot loaded")),
        ):
            bootstrap = lineage_service.get_bootstrap()
            initial = lineage_service.get_initial_view(
                root_id="table:input_a", direction="downstream", depth=1, max_nodes=20
            )

        self.assertEqual("ready", bootstrap["status"])
        self.assertEqual(14, bootstrap["nodeCount"])
        self.assertEqual(13, bootstrap["edgeCount"])
        self.assertEqual("table:dwf_boundary", bootstrap["defaultRootId"])
        self.assertEqual("table:input_a", initial["graph"]["rootId"])
        self.assertLess(sum(count for _sql, count in statements), 50)
        self.assertTrue(all(count < bootstrap["nodeCount"] for _sql, count in statements))

    def test_search_is_active_snapshot_scoped_limited_and_does_not_read_edges(self):
        original_fetch_rows = CoreAccess.fetch_rows
        statements = []

        def track(db, statement):
            rows = original_fetch_rows(db, statement)
            statements.append((str(statement), len(rows)))
            return rows

        with patch.object(CoreAccess, "fetch_rows", track):
            results = lineage_service.search_nodes("matching", limit=2)

        self.assertEqual(2, len(results))
        self.assertTrue(all(node["kind"] == "table" for node in results))
        self.assertNotIn("table:inactive-match", {node["id"] for node in results})
        search_sql = next(sql for sql, count in statements if count == 2 and "node_name" in sql)
        self.assertIn("kind_code", search_sql)
        self.assertIn("snapshot_id", search_sql)
        self.assertNotIn("p_lineage_edge", search_sql)
        self.assertTrue(all("p_lineage_edge" not in sql for sql, _count in statements))

    def test_search_treats_percent_underscore_and_escape_char_literally(self):
        literals = [
            ("table:escape:underscore", "F_ACCR_DAY_SUM_R"),
            ("table:escape:percent", "ABC%DEF"),
            ("table:escape:bang", "ABC!DEF"),
            ("table:escape:combo", "A!B_C%D"),
        ]
        decoys = [
            ("table:escape:wildcard-underscore", "FXACCRXDAYXSUMXR"),
            ("table:escape:wildcard-percent", "ABCZZZDEF"),
            ("table:escape:wildcard-bang", "ABCDEF"),
            ("table:escape:wildcard-combo", "AXBXCZD"),
        ]
        connection = connect({"type": "sqlite", "database": str(self.database)})
        try:
            connection.executemany(
                "INSERT INTO dwp.p_lineage_node "
                "(snapshot_id, node_id, kind_code, node_name, display_name, namespace_name, attributes_json) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                [
                    ("active", node_id, "table", name, name, "ODS", "{}")
                    for node_id, name in [*literals, *decoys]
                ],
            )
            connection.commit()
        finally:
            connection.close()

        original_fetch_rows = CoreAccess.fetch_rows
        statements = []

        def track(db, statement):
            rows = original_fetch_rows(db, statement)
            statements.append(str(statement))
            return rows

        cases = {
            "F_ACCR_DAY_SUM_R": "table:escape:underscore",
            "ABC%DEF": "table:escape:percent",
            "ABC!DEF": "table:escape:bang",
            "A!B_C%D": "table:escape:combo",
        }
        with patch.object(CoreAccess, "fetch_rows", track):
            for query, expected_id in cases.items():
                with self.subTest(query=query):
                    matches = lineage_service.search_nodes(query, limit=100)
                    self.assertEqual([expected_id], [node["id"] for node in matches])

        executed = [sql for sql in statements if "node_name" in sql]
        self.assertEqual(len(cases), len(executed))
        self.assertTrue(all("ESCAPE '!'" in sql for sql in executed))
        self.assertTrue(all("ESCAPE '\\'" not in sql for sql in executed))
        self.assertTrue(all("f!_accr" not in sql for sql in executed))
        self.assertTrue(all("ABC%DEF" not in sql for sql in executed))

    def test_detail_bfs_supports_directions_depth_cycles_missing_root_and_node_limit(self):
        downstream = lineage_service.get_subgraph(
            "table:input_a", "downstream", 1, 20, "detail"
        )
        self.assertEqual(
            {"table:input_a", "task:shared", "task:alternate", "table:out_a", "table:out_b"},
            {node["id"] for node in downstream["nodes"]},
        )
        self.assertFalse(downstream["truncated"])

        upstream = lineage_service.get_subgraph(
            "table:out_a", "upstream", 1, 20, "detail"
        )
        self.assertIn("task:shared", {node["id"] for node in upstream["nodes"]})
        self.assertIn("table:input_a", {node["id"] for node in upstream["nodes"]})

        both = lineage_service.get_subgraph("table:out_a", "both", 1, 20, "detail")
        self.assertIn("table:out_b", {node["id"] for node in both["nodes"]})
        self.assertLessEqual(len(both["nodes"]), 20)

        limited = lineage_service.get_subgraph(
            "table:input_a", "downstream", 2, 2, "detail"
        )
        self.assertEqual(2, len(limited["nodes"]))
        self.assertTrue(limited["truncated"])
        with self.assertRaises(lineage_service.LineageNotFoundError):
            lineage_service.get_subgraph("missing-root", view="detail")

    def test_table_projection_keeps_via_jobs_multi_input_output_shared_paths_and_self_loops(self):
        graph = lineage_service.get_subgraph(
            "table:input_a", "downstream", 1, 20, "table"
        )
        self.assertEqual(
            {"table:input_a", "table:out_a", "table:out_b"},
            {node["id"] for node in graph["nodes"]},
        )
        projected = {
            (edge["sourceId"], edge["targetId"]): edge
            for edge in graph["edges"]
            if edge["kind"] == "table_lineage"
        }
        self.assertEqual(
            ["JOB_ALTERNATE", "JOB_SHARED"],
            projected[("table:input_a", "table:out_a")]["viaJobs"],
        )
        self.assertEqual(
            ["JOB_SHARED"],
            projected[("table:input_a", "table:out_b")]["viaJobs"],
        )
        self.assertIn(
            ("table:input_a", "table:input_a"),
            {(edge["sourceId"], edge["targetId"]) for edge in graph["edges"]},
        )

        other_input = lineage_service.get_subgraph(
            "table:input_b", "downstream", 1, 20, "table"
        )
        self.assertIn(
            ("table:input_b", "table:out_a"),
            {(edge["sourceId"], edge["targetId"]) for edge in other_input["edges"]},
        )

    def test_dwf_upstream_boundary_stops_before_older_tables(self):
        graph = lineage_service.get_subgraph(
            "table:lineage_root", "upstream", 3, 20, "table"
        )
        ids = {node["id"] for node in graph["nodes"]}
        self.assertIn("table:dwf_boundary", ids)
        self.assertNotIn("table:above_dwf", ids)

    def test_large_snapshot_reads_remain_bounded_at_twenty_thousand_nodes_and_fifty_thousand_edges(self):
        connection = connect({"type": "sqlite", "database": str(self.database)})
        try:
            node_count = 20_000
            edge_count = 50_000
            synthetic_nodes = [
                (
                    "active",
                    f"table:synthetic:{index:05d}",
                    "table",
                    f"SYNTH_TABLE_{index:05d}",
                    f"SYNTH_TABLE_{index:05d}",
                    "DWM",
                    "{}",
                )
                for index in range(node_count)
            ]
            connection.executemany(
                "INSERT INTO dwp.p_lineage_node "
                "(snapshot_id, node_id, kind_code, node_name, display_name, namespace_name, attributes_json) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                synthetic_nodes,
            )
            synthetic_edges = [
                (
                    "active",
                    f"synthetic-edge:{index:05d}",
                    "table:synthetic:00000",
                    f"table:synthetic:{1000 + index % 18_000:05d}",
                    "table_lineage",
                    "synthetic",
                    f"record:{index}",
                    "synthetic bounded-read fixture",
                    "high",
                    "2026-10-01T00:00:00",
                    "[]",
                )
                for index in range(edge_count)
            ]
            connection.executemany(
                "INSERT INTO dwp.p_lineage_edge "
                "(snapshot_id, edge_id, source_node_id, target_node_id, kind_code, evidence_type, "
                "source_record_id, evidence_description, confidence_code, generated_at, diagnostics_json) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                synthetic_edges,
            )
            connection.commit()
        finally:
            connection.close()

        original_fetch_rows = CoreAccess.fetch_rows
        observed = []

        def track(db, statement):
            rows = original_fetch_rows(db, statement)
            observed.append((str(statement), len(rows)))
            return rows

        with (
            patch.object(CoreAccess, "fetch_rows", track),
            patch.object(lineage_service, "_database_snapshot", side_effect=AssertionError("full snapshot loaded")),
        ):
            bootstrap = lineage_service.get_bootstrap()
            matches = lineage_service.search_nodes("SYNTH_TABLE", limit=100)
            graph = lineage_service.get_subgraph(
                "table:synthetic:00000", "downstream", 1, 25, "detail"
            )

        self.assertEqual(20_014, bootstrap["nodeCount"])
        self.assertEqual(50_013, bootstrap["edgeCount"])
        self.assertEqual(100, len(matches))
        self.assertEqual(25, len(graph["nodes"]))
        self.assertTrue(graph["truncated"])
        self.assertLessEqual(len(observed), 10)
        self.assertLessEqual(sum(count for _sql, count in observed), 500)
        self.assertLessEqual(max(count for _sql, count in observed), 400)

    def test_empty_active_snapshot_and_missing_active_snapshot_bootstrap(self):
        connection = connect({"type": "sqlite", "database": str(self.database)})
        try:
            connection.execute("UPDATE dwp.p_lineage_snapshot SET status_code = 'INACTIVE'")
            connection.execute(
                "INSERT INTO dwp.p_lineage_snapshot "
                "(snapshot_id, generated_at, generator_name, generator_version, import_batch_id, status_code) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                ("empty", "2026-10-02T00:00:00", "empty", "1", "empty-import", "ACTIVE"),
            )
            connection.commit()
        finally:
            connection.close()
        self.assertEqual("empty_snapshot", lineage_service.get_bootstrap()["status"])
        self.assertEqual(0, lineage_service.get_bootstrap()["edgeCount"])

        connection = connect({"type": "sqlite", "database": str(self.database)})
        try:
            connection.execute("UPDATE dwp.p_lineage_snapshot SET status_code = 'INACTIVE'")
            connection.commit()
        finally:
            connection.close()
        self.assertEqual("no_active_snapshot", lineage_service.get_bootstrap()["status"])
        with self.assertRaises(lineage_service.LineageNoActiveSnapshotError):
            lineage_service.search_nodes("anything")


if __name__ == "__main__":
    unittest.main()
