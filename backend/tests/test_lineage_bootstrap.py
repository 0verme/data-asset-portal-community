"""Lineage data-source contract: one DAP profile, no implicit POC graph.

Every case here must stay distinguishable at the API boundary:

* configured + ACTIVE snapshot  -> ``ready``
* configured + no ACTIVE snapshot -> ``no_active_snapshot`` (normal empty state)
* configuration missing/invalid  -> ``LINEAGE_CONFIGURATION_ERROR`` (503)
* unreachable DB / missing tables -> ``LINEAGE_DATA_SOURCE_ERROR`` (503)
"""

from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.app.db.sqlite_adapter import connect
from backend.app.migrations.schema import initialize
from backend.app.services import lineage_service


POC_ENGINE_SYMBOLS = (
    "SNAPSHOT",
    "_current_snapshot",
    "_database_snapshot",
    "_bootstrap_from_snapshot",
    "_subgraph_from_snapshot",
    "_project_table_graph",
    "_traverse",
    "_default_root_id",
    "_lineage_search_rank",
)


class _SqliteProfileFixture(unittest.TestCase):
    """Give each test an isolated, explicitly configured SQLite DAP profile."""

    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.root = Path(self.temp_dir.name)
        self.database = self.root / "lineage.sqlite"
        self.config_path = self.root / "database.yaml"
        self.config_path.write_text(
            "profiles:\n  lineage_bootstrap:\n    type: sqlite\n    database: "
            + self.database.as_posix()
            + "\n",
            encoding="utf-8",
        )
        self.environment = patch.dict(
            os.environ,
            {
                "APP_ENV": "development",
                "ASSET_DB_CONFIG_PATH": str(self.config_path),
                "ASSET_DB_PROFILE": "lineage_bootstrap",
            },
            clear=False,
        )
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def _initialize(self):
        connection = connect({"type": "sqlite", "database": str(self.database)})
        try:
            initialize(
                connection,
                {"type": "sqlite", "database": str(self.database)},
                "sqlite",
            )
        finally:
            connection.close()

    def _execute(self, statements):
        connection = connect({"type": "sqlite", "database": str(self.database)})
        try:
            for statement, parameters in statements:
                connection.execute(statement, parameters)
            connection.commit()
        finally:
            connection.close()

    def _insert_snapshot(self, snapshot_id="active", status_code="ACTIVE"):
        self._execute([
            (
                "INSERT INTO dwp.p_lineage_snapshot "
                "(snapshot_id, generated_at, generator_name, generator_version, "
                "import_batch_id, status_code) VALUES (?, ?, ?, ?, ?, ?)",
                (
                    snapshot_id,
                    "2026-10-01T00:00:00",
                    "test-collector",
                    "1",
                    snapshot_id + "-import",
                    status_code,
                ),
            ),
        ])

    def _insert_node(self, node_id, kind, name, namespace, snapshot_id="active"):
        self._execute([
            (
                "INSERT INTO dwp.p_lineage_node "
                "(snapshot_id, node_id, kind_code, node_name, display_name, "
                "namespace_name, attributes_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (snapshot_id, node_id, kind, name, name, namespace, "{}"),
            ),
        ])


class LineageBootstrapTestCase(_SqliteProfileFixture):
    def test_bootstrap_reports_ready_for_the_active_snapshot(self):
        self._initialize()
        self._insert_snapshot()
        self._insert_node("table:dwf:OUT", "table", "OUT", "DWF")

        bootstrap = lineage_service.get_bootstrap()

        self.assertEqual("persistent", bootstrap["mode"])
        self.assertEqual("ready", bootstrap["status"])
        self.assertEqual("active", bootstrap["snapshotId"])
        self.assertEqual("table:dwf:OUT", bootstrap["defaultRootId"])
        self.assertEqual(1, bootstrap["nodeCount"])
        self.assertEqual(0, bootstrap["edgeCount"])

    def test_bootstrap_reports_empty_snapshot_without_inventing_a_root(self):
        self._initialize()
        self._insert_snapshot()

        bootstrap = lineage_service.get_bootstrap()

        self.assertEqual("empty_snapshot", bootstrap["status"])
        self.assertIsNone(bootstrap["defaultRootId"])
        self.assertEqual(0, bootstrap["nodeCount"])

    def test_bootstrap_reports_missing_active_snapshot(self):
        self._initialize()
        self._insert_snapshot(snapshot_id="retired", status_code="INACTIVE")

        bootstrap = lineage_service.get_bootstrap()

        self.assertEqual("no_active_snapshot", bootstrap["status"])
        self.assertIsNone(bootstrap["defaultRootId"])
        with self.assertRaises(lineage_service.LineageNoActiveSnapshotError):
            lineage_service.search_nodes("anything", limit=1)

    def test_initial_view_builds_bootstrap_and_graph_from_one_snapshot(self):
        self._initialize()
        self._insert_snapshot()
        self._insert_node("table:dwf:OUT", "table", "OUT", "DWF")
        self._insert_node("table:ods:SOURCE", "table", "SOURCE", "ODS")
        self._execute([
            (
                "INSERT INTO dwp.p_lineage_edge "
                "(snapshot_id, edge_id, source_node_id, target_node_id, kind_code, "
                "evidence_type, source_record_id, evidence_description, "
                "confidence_code, generated_at, diagnostics_json) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    "active",
                    "edge-1",
                    "table:ods:SOURCE",
                    "table:dwf:OUT",
                    "table_lineage",
                    "test",
                    "record-1",
                    "explicit mapping",
                    "high",
                    "2026-10-01T00:00:00",
                    "[]",
                ),
            ),
        ])

        initial = lineage_service.get_initial_view(depth=1, view="table")

        self.assertEqual("ready", initial["bootstrap"]["status"])
        self.assertEqual(
            initial["bootstrap"]["defaultRootId"], initial["graph"]["rootId"]
        )
        self.assertIsNone(initial["noticeCode"])

    def test_initial_view_returns_no_graph_for_unavailable_snapshot(self):
        self._initialize()

        initial = lineage_service.get_initial_view()

        self.assertEqual("no_active_snapshot", initial["bootstrap"]["status"])
        self.assertIsNone(initial["graph"])
        self.assertIsNone(initial["noticeCode"])

    def test_invalid_graph_options_are_rejected_before_storage_resolution(self):
        with patch.object(
            lineage_service,
            "lineage_storage_status",
            side_effect=AssertionError("storage resolved before validation"),
        ):
            for options, message in (
                ({"direction": "sideways"}, "direction must be"),
                ({"view": "graph"}, "view must be"),
            ):
                with self.subTest(options=options):
                    with self.assertRaises(lineage_service.LineageValidationError) as raised:
                        lineage_service.get_subgraph(**options)
                    self.assertIn(message, str(raised.exception))
                    with self.assertRaises(lineage_service.LineageValidationError):
                        lineage_service.get_initial_view(**options)


class LineageDataSourceFailureTestCase(_SqliteProfileFixture):
    def test_missing_profile_configuration_is_a_configuration_error(self):
        with patch.dict(os.environ, {"APP_ENV": "development"}, clear=True):
            with self.assertRaises(lineage_service.LineageConfigurationError) as raised:
                lineage_service.get_bootstrap()

        self.assertEqual(
            "LINEAGE_CONFIGURATION_ERROR", raised.exception.to_dict()["code"]
        )
        self.assertEqual(503, raised.exception.status_code)

    def test_unknown_profile_is_a_configuration_error(self):
        with patch.dict(
            os.environ,
            {
                "ASSET_DB_CONFIG_PATH": str(self.config_path),
                "ASSET_DB_PROFILE": "profile_that_does_not_exist",
            },
            clear=True,
        ):
            with self.assertRaises(lineage_service.LineageConfigurationError) as raised:
                lineage_service.get_bootstrap()

        self.assertEqual(
            "LINEAGE_CONFIGURATION_ERROR", raised.exception.to_dict()["code"]
        )

    def test_unreachable_database_is_not_reported_as_empty_data(self):
        self.config_path.write_text(
            "profiles:\n  lineage_bootstrap:\n    type: sqlite\n    database: "
            + self.root.as_posix()
            + "\n",
            encoding="utf-8",
        )

        with self.assertRaises(lineage_service.LineageDataSourceError) as raised:
            lineage_service.get_bootstrap()

        self.assertNotIsInstance(
            raised.exception, lineage_service.LineageNoActiveSnapshotError
        )
        self.assertEqual(
            "LINEAGE_DATA_SOURCE_ERROR", raised.exception.to_dict()["code"]
        )
        self.assertEqual(503, raised.exception.status_code)

    def test_missing_lineage_tables_are_a_data_source_error(self):
        self._initialize()
        self._insert_snapshot()
        self._execute([("DROP TABLE dwp.p_lineage_node", ())])

        with self.assertRaises(lineage_service.LineageDataSourceError) as raised:
            lineage_service.get_bootstrap()

        self.assertNotIsInstance(
            raised.exception, lineage_service.LineageNoActiveSnapshotError
        )


class LineageNoImplicitPocTestCase(unittest.TestCase):
    def test_configuration_data_source_and_empty_state_stay_distinguishable(self):
        configuration = lineage_service.LineageConfigurationError("configured")
        data_source = lineage_service.LineageDataSourceError("unreachable")
        empty = lineage_service.LineageNoActiveSnapshotError("empty")

        self.assertEqual(503, configuration.status_code)
        self.assertEqual(503, data_source.status_code)
        self.assertEqual(404, empty.status_code)
        self.assertEqual(
            3,
            len(
                {
                    configuration.to_dict()["code"],
                    data_source.to_dict()["code"],
                    empty.to_dict()["code"],
                }
            ),
        )
        # A normal empty state must never be reported as a failure.
        self.assertEqual(
            "no_active_snapshot",
            lineage_service._missing_snapshot_bootstrap("persistent")["status"],
        )

    def test_poc_engine_symbols_are_gone(self):
        for symbol in POC_ENGINE_SYMBOLS:
            with self.subTest(symbol=symbol):
                self.assertFalse(
                    hasattr(lineage_service, symbol),
                    f"{symbol} must not come back: it was the POC/mock fallback",
                )

    def test_every_environment_resolves_the_asset_profile_as_persistent(self):
        for environment in ("development", "dev", "test", "staging", "production"):
            with self.subTest(environment=environment):
                with (
                    patch.dict(
                        os.environ,
                        {
                            "APP_ENV": environment,
                            "ASSET_DB_PROFILE": "dap_shared",
                            "LINEAGE_DB_PROFILE": "poc_lineage",
                            "LINEAGE_STORAGE_MODE": "poc",
                        },
                        clear=True,
                    ),
                    patch(
                        "backend.app.db.facade.get_db_profile",
                        return_value={"type": "sqlite", "database": ":memory:"},
                    ),
                    patch.object(
                        lineage_service,
                        "get_db_profile",
                        return_value={"type": "sqlite", "database": ":memory:"},
                    ) as get_profile,
                ):
                    status = lineage_service.lineage_storage_status()

                get_profile.assert_called_once_with("dap_shared")
                self.assertEqual(
                    {"mode": "persistent", "profile": "dap_shared", "schema": "dwp"},
                    status,
                )


if __name__ == "__main__":
    unittest.main()
