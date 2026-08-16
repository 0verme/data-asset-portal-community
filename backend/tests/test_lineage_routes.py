import unittest
from unittest.mock import patch

from backend.app import create_app
from backend.app.services.lineage_service import LineageNoActiveSnapshotError


class LineageRouteTestCase(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict("os.environ", {"FLASK_ENV": "development", "LINEAGE_DB_PROFILE": "", "FLASK_SECRET_KEY": "lineage-route-test"}, clear=False)
        self.environment.start()
        self.addCleanup(self.environment.stop)
        app = create_app()
        app.config.update(TESTING=True)
        self.client = app.test_client()

    def test_returns_controlled_table_subgraph(self):
        response = self.client.get("/api/lineage/subgraph?rootId=table:dwf:DWF_MEMBER_PROFILE&depth=2&view=detail")
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()["data"]
        self.assertEqual(payload["rootId"], "table:dwf:DWF_MEMBER_PROFILE")
        self.assertEqual(payload["snapshot"]["generator"]["name"], "portal-controlled-poc")
        self.assertGreaterEqual(len(payload["nodes"]), 3)

    def test_table_view_projects_jobs_and_uses_table_hops(self):
        response = self.client.get(
            "/api/lineage/subgraph?rootId=table:dwf:DWF_MEMBER_PROFILE&direction=downstream&depth=1&view=table"
        )
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()["data"]
        self.assertEqual(payload["view"], "table")
        self.assertEqual({node["kind"] for node in payload["nodes"]}, {"table"})
        self.assertEqual(len(payload["nodes"]), 2)
        self.assertEqual(payload["edges"][0]["viaJobs"], ["JOB_BUILD_MEMBER_PROFILE"])

    def test_detail_view_does_not_charge_job_nodes_as_depth(self):
        response = self.client.get(
            "/api/lineage/subgraph?rootId=table:dwf:DWF_MEMBER_PROFILE&direction=downstream&depth=1&view=detail"
        )
        payload = response.get_json()["data"]
        self.assertEqual({node["kind"] for node in payload["nodes"]}, {"table", "task"})
        self.assertIn("table:dwm:DWM_MEMBER_PROFILE", {node["id"] for node in payload["nodes"]})

    def test_upstream_stops_at_dwf_boundary(self):
        response = self.client.get(
            "/api/lineage/subgraph?rootId=table:dwf:DWF_MEMBER_PROFILE&direction=upstream&depth=5&view=detail"
        )
        payload = response.get_json()["data"]
        self.assertEqual([node["id"] for node in payload["nodes"]], ["table:dwf:DWF_MEMBER_PROFILE"])

    def test_bootstrap_reports_poc_mode_and_its_available_default_root(self):
        response = self.client.get("/api/lineage/bootstrap")
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()["data"]
        self.assertEqual(payload["mode"], "poc")
        self.assertEqual(payload["status"], "ready")
        self.assertEqual(payload["defaultRootId"], "table:dwf:DWF_MEMBER_PROFILE")
        self.assertGreater(payload["nodeCount"], 0)

    def test_initial_view_returns_bootstrap_and_graph_together(self):
        response = self.client.get(
            "/api/lineage/initial-view?direction=downstream&depth=1&view=table&maxNodes=100"
        )
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()["data"]
        self.assertEqual(payload["bootstrap"]["status"], "ready")
        self.assertEqual(payload["graph"]["rootId"], payload["bootstrap"]["defaultRootId"])
        self.assertEqual(payload["graph"]["view"], "table")
        self.assertIsNone(payload["noticeCode"])

    def test_initial_view_recovers_stale_and_task_roots_without_another_request(self):
        stale = self.client.get(
            "/api/lineage/initial-view?rootId=table:missing:UNKNOWN&direction=both&depth=2&view=table"
        ).get_json()["data"]
        self.assertEqual(stale["noticeCode"], "ROOT_NOT_IN_SNAPSHOT")
        self.assertEqual(stale["graph"]["rootId"], stale["bootstrap"]["defaultRootId"])

        task = self.client.get(
            "/api/lineage/initial-view?rootId=task:load_member&direction=both&depth=2&view=table"
        ).get_json()["data"]
        self.assertEqual(task["noticeCode"], "TABLE_VIEW_REQUIRES_TABLE_ROOT")
        self.assertEqual(task["graph"]["view"], "table")

    def test_initial_view_rejects_invalid_query(self):
        response = self.client.get("/api/lineage/initial-view?direction=sideways")
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.get_json()["error"]["code"], "LINEAGE_VALIDATION_FAILED")

    def test_initial_view_returns_no_graph_for_empty_or_missing_snapshot(self):
        empty_snapshot = {
            "snapshotId": "empty",
            "generatedAt": "2026-07-30T00:00:00Z",
            "generator": {"name": "test", "version": "1"},
            "nodes": [],
            "edges": [],
            "diagnostics": [],
        }
        with patch(
            "backend.app.services.lineage_service._current_snapshot",
            return_value=empty_snapshot,
        ):
            empty = self.client.get("/api/lineage/initial-view").get_json()["data"]
        self.assertEqual(empty["bootstrap"]["status"], "empty_snapshot")
        self.assertIsNone(empty["graph"])

        with patch(
            "backend.app.services.lineage_service._current_snapshot",
            side_effect=LineageNoActiveSnapshotError("missing"),
        ):
            missing = self.client.get("/api/lineage/initial-view").get_json()["data"]
        self.assertEqual(missing["bootstrap"]["status"], "no_active_snapshot")
        self.assertIsNone(missing["graph"])

    def test_subgraph_without_root_uses_current_snapshot_default(self):
        response = self.client.get("/api/lineage/subgraph")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["data"]["rootId"], "table:dwf:DWF_MEMBER_PROFILE")

    def test_rejects_invalid_query(self):
        response = self.client.get("/api/lineage/subgraph?direction=sideways")
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.get_json()["error"]["code"], "LINEAGE_VALIDATION_FAILED")

    def test_rejects_invalid_view_and_task_root_in_table_view(self):
        for query in ("view=invalid", "rootId=task:load_member&view=table"):
            response = self.client.get(f"/api/lineage/subgraph?{query}")
            self.assertEqual(response.status_code, 422)
            self.assertEqual(response.get_json()["error"]["code"], "LINEAGE_VALIDATION_FAILED")

    def test_rejects_out_of_range_subgraph_parameters(self):
        for query in ("depth=6", "depth=-1", "maxNodes=0", "maxNodes=301"):
            response = self.client.get(f"/api/lineage/subgraph?{query}")
            self.assertEqual(response.status_code, 422)
            self.assertEqual(response.get_json()["error"]["code"], "LINEAGE_VALIDATION_FAILED")

    def test_applies_valid_depth_and_max_nodes(self):
        response = self.client.get("/api/lineage/subgraph?rootId=table:dwf:DWF_MEMBER_PROFILE&direction=downstream&depth=1&maxNodes=2")
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()["data"]
        self.assertEqual(payload["rootId"], "table:dwf:DWF_MEMBER_PROFILE")
        self.assertEqual(len(payload["nodes"]), 2)

    def test_reports_unknown_root_id_with_consistent_not_found_error(self):
        response = self.client.get("/api/lineage/subgraph?rootId=table:missing:UNKNOWN")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.get_json()["error"]["code"], "LINEAGE_NOT_FOUND")

    def test_searches_assets_by_exact_name(self):
        response = self.client.get("/api/lineage/assets?name=DWF_MEMBER_PROFILE")
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()["data"]
        self.assertEqual([item["id"] for item in payload], ["table:dwf:DWF_MEMBER_PROFILE"])
        self.assertEqual(set(payload[0]), {"id", "kind", "name", "displayName", "namespace", "attributes"})

    def test_searches_task_nodes_by_name(self):
        response = self.client.get("/api/lineage/assets?name=JOB_LOAD_MEMBER")
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()["data"]
        self.assertEqual([item["id"] for item in payload], ["task:load_member"])
        self.assertEqual(payload[0]["kind"], "task")

    def test_search_is_case_insensitive(self):
        response = self.client.get("/api/lineage/assets?name=dwf_member_profile")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["data"][0]["name"], "DWF_MEMBER_PROFILE")

    def test_search_supports_partial_matches_and_multiple_candidates(self):
        response = self.client.get("/api/lineage/assets?name=member")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.get_json()["data"]), 6)

    def test_task_root_supports_each_traversal_direction(self):
        root = "task:build_member_profile"
        for direction in ("upstream", "downstream", "both"):
            response = self.client.get(f"/api/lineage/subgraph?rootId={root}&direction={direction}&depth=2&view=detail")
            self.assertEqual(response.status_code, 200)
            payload = response.get_json()["data"]
            self.assertEqual(payload["rootId"], root)
            self.assertGreater(len(payload["edges"]), 0)

    def test_search_returns_empty_list_when_no_assets_match(self):
        response = self.client.get("/api/lineage/assets?name=missing")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["data"], [])

    def test_search_rejects_invalid_name(self):
        for name in ("", "x" * 101):
            response = self.client.get(f"/api/lineage/assets?name={name}")
            self.assertEqual(response.status_code, 422)
            self.assertEqual(response.get_json()["error"]["code"], "LINEAGE_VALIDATION_FAILED")

    def test_requires_a_profile_outside_development(self):
        with patch.dict("os.environ", {"FLASK_ENV": "production", "LINEAGE_DB_PROFILE": ""}, clear=False):
            response = self.client.get("/api/lineage/subgraph")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.get_json()["error"]["code"], "LINEAGE_CONFIGURATION_ERROR")
