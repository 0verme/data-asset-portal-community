import unittest
from unittest.mock import patch

from backend.app.services import lineage_service


class LineageBootstrapTestCase(unittest.TestCase):
    def test_default_root_is_deterministic_and_prefers_connected_tables(self):
        snapshot = {
            "nodes": [
                {"id": "table:ods:SOURCE", "kind": "table", "namespace": "ods", "attributes": {}},
                {"id": "table:dwf:SECOND", "kind": "table", "namespace": "dwf", "attributes": {}},
                {"id": "table:dwf:FIRST", "kind": "table", "namespace": "dwf", "attributes": {}},
                {"id": "task:load", "kind": "task", "namespace": "scheduler", "attributes": {}},
            ],
            "edges": [
                {"sourceId": "table:ods:SOURCE", "targetId": "task:load"},
                {"sourceId": "task:load", "targetId": "table:dwf:FIRST"},
                {"sourceId": "table:dwf:FIRST", "targetId": "table:dwf:SECOND"},
                {"sourceId": "table:dwf:SECOND", "targetId": "task:load"},
            ],
        }
        self.assertEqual(lineage_service._default_root_id(snapshot), "table:dwf:FIRST")

    def test_bootstrap_reports_empty_snapshot_without_inventing_a_root(self):
        snapshot = {"snapshotId": "empty", "generatedAt": "2026-07-13T20:00:00Z", "generator": {"name": "test", "version": "1"}, "nodes": [], "edges": []}
        with patch.object(lineage_service, "lineage_storage_status", return_value={"mode": "persistent"}), patch.object(lineage_service, "_current_snapshot", return_value=snapshot):
            bootstrap = lineage_service.get_bootstrap()
        self.assertEqual(bootstrap["status"], "empty_snapshot")
        self.assertIsNone(bootstrap["defaultRootId"])

    def test_bootstrap_reports_missing_active_snapshot(self):
        with patch.object(lineage_service, "lineage_storage_status", return_value={"mode": "persistent"}), patch.object(lineage_service, "_current_snapshot", side_effect=lineage_service.LineageNoActiveSnapshotError("missing")):
            bootstrap = lineage_service.get_bootstrap()
        self.assertEqual(bootstrap["status"], "no_active_snapshot")
        self.assertIsNone(bootstrap["defaultRootId"])

    def test_initial_view_builds_bootstrap_and_graph_from_one_snapshot(self):
        snapshot = lineage_service.SNAPSHOT
        with (
            patch.object(lineage_service, "lineage_storage_status", return_value={"mode": "persistent"}),
            patch.object(lineage_service, "_current_snapshot", return_value=snapshot) as current_snapshot,
        ):
            initial = lineage_service.get_initial_view(depth=1, view="table")

        current_snapshot.assert_called_once_with()
        self.assertEqual(initial["bootstrap"]["status"], "ready")
        self.assertEqual(initial["graph"]["rootId"], initial["bootstrap"]["defaultRootId"])
        self.assertIsNone(initial["noticeCode"])

    def test_initial_view_returns_no_graph_for_unavailable_snapshot(self):
        with (
            patch.object(lineage_service, "lineage_storage_status", return_value={"mode": "persistent"}),
            patch.object(
                lineage_service,
                "_current_snapshot",
                side_effect=lineage_service.LineageNoActiveSnapshotError("missing"),
            ),
        ):
            initial = lineage_service.get_initial_view()

        self.assertEqual(initial["bootstrap"]["status"], "no_active_snapshot")
        self.assertIsNone(initial["graph"])


if __name__ == "__main__":
    unittest.main()
