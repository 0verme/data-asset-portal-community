"""Public Catalog + Authenticated Management regression tests."""

from __future__ import annotations

import unittest
from unittest.mock import MagicMock

from fastapi.testclient import TestClient

from backend.app.application import Identity
from backend.app.authorization.core import AuthorizationService, AuthorizationSubject
from backend.app.authorization.permissions import BUILTIN_ROLE_PERMISSION_CODES
from backend.app.fastapi_app import create_fastapi_app


PUBLIC_READS = (
    "/api/assets/tables",
    "/api/indicators",
    "/api/portal/stats",
    "/api/search?q=customer",
    "/api/lineage/bootstrap",
    "/api/field-mappings/fields",
    "/api/system/menus",
    "/api/roots",
    "/api/reports",
    "/api/api-assets",
    "/api/manual-code-tables",
    "/api/upstreams/systems",
    "/api/push/systems",
)


class PublicCatalogApiTests(unittest.TestCase):
    def setUp(self):
        self.current_identity: Identity | None = None
        self.subjects = {
            "normal": AuthorizationSubject("normal", "catalog-reader"),
            "no-permission": AuthorizationSubject("no-permission", "catalog-reader"),
            "admin": AuthorizationSubject("admin", "admin"),
        }
        self.permission_sets = {
            "catalog-reader": set(),
            "admin": BUILTIN_ROLE_PERMISSION_CODES["admin"],
        }
        repository = MagicMock()
        repository.get_subject.side_effect = lambda identity: self.subjects.get(identity.user)
        repository.get_permissions.side_effect = lambda role: self.permission_sets.get(role, set())
        self.repository = repository
        self.authorization = AuthorizationService(repository)

        self.assets = MagicMock()
        self.assets.get_asset_tables.return_value = []
        self.indicators = MagicMock()
        self.indicators.get_indicators.return_value = []
        self.portal = MagicMock()
        self.portal.get_stats.return_value = []
        self.search = MagicMock()
        self.search.search.return_value = {"query": "customer", "scope": "all", "groups": [], "total": 0}
        self.lineage = MagicMock()
        self.lineage.get_bootstrap.return_value = {}
        self.mapping = MagicMock()
        self.mapping.get_field_mappings.return_value = {"items": []}
        self.root = MagicMock()
        self.root.get_roots.return_value = []
        self.report = MagicMock()
        self.report.get_reports.return_value = []
        self.api_asset = MagicMock()
        self.api_asset.get_assets.return_value = []
        self.manual_code_table = MagicMock()
        self.manual_code_table.get_tables.return_value = []
        self.upstream = MagicMock()
        self.upstream.get_systems.return_value = []
        self.push = MagicMock()
        self.push.get_push_systems.return_value = []
        self.system = MagicMock()
        self.system.get_menus.return_value = [
            {"code": "dwm", "status": "enabled", "adminOnly": False},
            {"code": "system", "status": "enabled", "adminOnly": True},
            {"code": "disabled", "status": "disabled", "adminOnly": False},
        ]
        self.system.get_roles.return_value = []
        self.indicators.create_indicator.return_value = {"id": "I1", "name": "Indicator"}

        self.app = create_fastapi_app(
            identity_resolver=lambda _request: self.current_identity,
            authorization_service_instance=self.authorization,
            assets_service_instance=self.assets,
            indicator_service_instance=self.indicators,
            portal_service_instance=self.portal,
            search_provider_instance=self.search,
            lineage_service_instance=self.lineage,
            field_mapping_service_instance=self.mapping,
            root_service_instance=self.root,
            report_service_instance=self.report,
            api_asset_service_instance=self.api_asset,
            manual_code_table_service_instance=self.manual_code_table,
            upstream_service_instance=self.upstream,
            push_service_instance=self.push,
            system_management_service_instance=self.system,
        )
        self.client = TestClient(self.app)

    def test_anonymous_public_business_reads_return_200(self):
        self.current_identity = None
        for path in PUBLIC_READS:
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(200, response.status_code, response.text)
                self.assertNotIn("password", response.text.lower())
                self.assertNotIn("authorization", response.text.lower())

        self.assets.get_asset_tables.assert_called_once()
        self.indicators.get_indicators.assert_called_once()
        self.portal.get_stats.assert_called_once()
        self.search.search.assert_called_once()
        self.lineage.get_bootstrap.assert_called_once()
        self.mapping.get_field_mappings.assert_called_once()
        self.root.get_roots.assert_called_once()
        self.report.get_reports.assert_called_once()
        self.api_asset.get_assets.assert_called_once()
        self.manual_code_table.get_tables.assert_called_once()
        self.upstream.get_systems.assert_called_once()
        self.push.get_push_systems.assert_called_once()

    def test_anonymous_navigation_is_public_but_management_menu_is_filtered(self):
        response = self.client.get("/api/system/menus")
        self.assertEqual(200, response.status_code)
        self.assertEqual(["dwm"], [item["code"] for item in response.json()["items"]])
        self.system.get_menus.assert_called_once_with()

    def test_anonymous_detail_reads_complete_the_public_browse_chain(self):
        self.current_identity = None
        self.assets.get_asset_detail.return_value = {"name": "TABLE_1", "fields": []}
        self.assets.get_asset_fields.return_value = []
        self.assets.get_asset_ddl.return_value = {"ddl": "CREATE TABLE TABLE_1"}
        self.indicators.get_indicator_detail.return_value = {"id": "I1", "name": "Indicator"}
        self.root.get_root_detail.return_value = {"abbr": "ord", "cn": "订单", "cat": "业务", "en": "order"}
        self.report.get_report_detail.return_value = {"code": "R1", "name": "Report"}
        self.api_asset.get_asset.return_value = {"code": "API_1", "name": "API", "params": [], "responseFields": [], "relations": []}
        self.manual_code_table.get_table.return_value = {
            "id": "1", "tableCode": "DIM_ORDER", "tableName": "Orders", "style": "dim", "status": "enabled",
        }
        self.upstream.get_system_detail.return_value = {"id": "UP_1", "name": "Upstream", "unloadTimes": []}
        self.push.get_push_system_detail.return_value = {"id": "PUSH_1", "name": "Push", "jobs": []}
        self.lineage.get_subgraph.return_value = {"nodes": [], "edges": []}

        paths = (
            "/api/assets/tables/TABLE_1",
            "/api/assets/tables/TABLE_1/fields",
            "/api/assets/tables/TABLE_1/ddl",
            "/api/indicators/I1",
            "/api/roots/ord",
            "/api/reports/R1",
            "/api/api-assets/API_1",
            "/api/manual-code-tables/1",
            "/api/upstreams/systems/UP_1",
            "/api/push/systems/PUSH_1",
            "/api/lineage/subgraph",
        )
        for path in paths:
            with self.subTest(path=path):
                self.assertEqual(200, self.client.get(path).status_code)

    def test_anonymous_detail_responses_apply_required_redaction(self):
        self.current_identity = None
        self.api_asset.get_assets.return_value = [{
            "code": "ORDER_API",
            "name": "Orders",
            "method": "GET",
            "path": "/orders",
            "status": "enabled",
            "updatedBy": "admin",
            "params": [
                {"name": "Authorization", "in": "header", "example": "Bearer secret"},
                {"name": "orderId", "in": "query", "example": "100"},
            ],
            "responseFields": [{"name": "orderId", "example": "real-order"}],
            "relations": [],
        }]
        self.api_asset.get_asset.return_value = self.api_asset.get_assets.return_value[0]
        listed_api = self.client.get("/api/api-assets")
        detailed_api = self.client.get("/api/api-assets/ORDER_API")
        for response in (listed_api, detailed_api):
            self.assertEqual(200, response.status_code, response.text)
            text = response.text
            self.assertNotIn("updatedBy", text)
            self.assertNotIn("Authorization", text)
            self.assertNotIn("Bearer secret", text)
            self.assertNotIn('"example"', text)

        self.push.get_push_systems.return_value = [{
            "id": "PUSH_1",
            "name": "Public push",
            "host": "198.51.100.8",
            "port": 22,
            "account": "service-account",
            "auth": "secret",
            "downstreamContact": "Alice",
            "dataDeveloperContact": "Bob",
            "jobs": [{"id": "JOB_1", "cn": "Orders", "sourcePath": "/private", "fields": []}],
        }]
        self.push.get_push_system_detail.return_value = self.push.get_push_systems.return_value[0]
        for response in (
            self.client.get("/api/push/systems"),
            self.client.get("/api/push/systems/PUSH_1"),
        ):
            self.assertEqual(200, response.status_code, response.text)
            for value in ("198.51.100.8", "service-account", "Alice", "Bob", "/private"):
                self.assertNotIn(value, response.text)

        self.manual_code_table.get_tables.return_value = [{
            "id": "1", "tableCode": "DIM_ORDER", "tableName": "Orders", "style": "dim",
            "status": "enabled", "createdBy": "admin", "updatedBy": "admin",
        }]
        manual = self.client.get("/api/manual-code-tables")
        self.assertEqual(200, manual.status_code)
        self.assertNotIn("createdBy", manual.text)
        self.assertNotIn("updatedBy", manual.text)

        self.report.get_reports.return_value = [{"code": "RPT_ORDER", "name": "Orders", "updatedBy": "admin"}]
        report = self.client.get("/api/reports")
        self.assertEqual(200, report.status_code)
        self.assertNotIn("updatedBy", report.text)

        self.lineage.get_subgraph.return_value = {
            "nodes": [{"name": "orders", "attributes": {"jdbcUrl": "opaque-connection-value"}}],
            "edges": [{"evidence": {"sourceRecordId": "private-record", "description": "https://internal.example/evidence"}, "diagnostics": [{"host": "198.51.100.2"}]}],
        }
        lineage = self.client.get("/api/lineage/subgraph")
        self.assertEqual(200, lineage.status_code)
        for value in ("jdbcUrl", "private-record", "198.51.100.2"):
            self.assertNotIn(value, lineage.text)

    def test_authenticated_user_keeps_existing_catalog_access(self):
        self.current_identity = Identity("catalog-reader", "normal", "Normal")
        for path in PUBLIC_READS:
            with self.subTest(path=path):
                self.assertEqual(200, self.client.get(path).status_code)
        self.assertEqual(
            {"dwm", "system", "disabled"},
            {item["code"] for item in self.client.get("/api/system/menus").json()["items"]},
        )

    def test_anonymous_admin_reads_and_all_write_methods_remain_protected(self):
        self.current_identity = None
        for path in (
            "/api/system/users",
            "/api/system/roles",
            "/api/system/permissions",
            "/api/system/param-dicts",
            "/api/operation-logs",
            "/api/metadata/ingestions/ing-1",
            "/api/upstreams/systems/UPSTREAM/admin-detail",
            "/api/push/systems/PUSH/admin-detail",
        ):
            with self.subTest(method="GET", path=path):
                response = self.client.get(path)
                self.assertEqual(401, response.status_code, response.text)
                self.assertEqual("UNAUTHORIZED", response.json()["error"]["code"])

        for method, path in (
            ("POST", "/api/indicators"),
            ("PUT", "/api/indicators/I1"),
            ("PATCH", "/api/indicators/I1/status"),
            ("DELETE", "/api/indicators/I1"),
            ("POST", "/api/system/menus"),
        ):
            with self.subTest(method=method, path=path):
                response = self.client.request(method, path, json={})
                self.assertEqual(401, response.status_code, response.text)
                self.assertEqual("UNAUTHORIZED", response.json()["error"]["code"])

        self.system.get_roles.assert_not_called()
        self.indicators.create_indicator.assert_not_called()

    def test_authenticated_missing_permission_is_denied_without_mutation(self):
        self.current_identity = Identity("catalog-reader", "no-permission", "No permission")
        self.assertEqual(200, self.client.get("/api/indicators").status_code)
        sensitive = self.client.get("/api/system/roles")
        self.assertEqual(403, sensitive.status_code)
        self.assertEqual("FORBIDDEN", sensitive.json()["error"]["code"])
        self.system.get_roles.assert_not_called()

        mutation = self.client.post("/api/indicators", json={"name": "blocked"})
        self.assertEqual(403, mutation.status_code)
        self.assertEqual("FORBIDDEN", mutation.json()["error"]["code"])
        self.indicators.create_indicator.assert_not_called()

    def test_admin_can_read_sensitive_data_and_mutate_where_permitted(self):
        self.current_identity = Identity("admin", "admin", "Admin")
        self.assertEqual(200, self.client.get("/api/system/roles").status_code)
        self.assertEqual(201, self.client.post("/api/indicators", json={"name": "Indicator"}).status_code)
        self.indicators.create_indicator.assert_called_once()


if __name__ == "__main__":
    unittest.main()
