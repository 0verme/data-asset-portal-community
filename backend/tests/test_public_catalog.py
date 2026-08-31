"""Public catalog projection and sensitive-response regression tests."""

from __future__ import annotations

import unittest

from backend.app.fastapi.public_catalog import (
    public_navigation_menus,
    redact_public_api_asset,
    redact_public_lineage,
    redact_public_manual_code_table,
    redact_public_push_system,
    redact_public_report,
)


class PublicCatalogProjectionTests(unittest.TestCase):
    def test_anonymous_navigation_excludes_disabled_and_management_entries(self):
        menus = public_navigation_menus([
            {"code": "dwm", "status": "enabled", "adminOnly": False},
            {"code": "system", "status": "enabled", "adminOnly": True},
            {"code": "disabled", "status": "disabled", "adminOnly": False},
        ])
        self.assertEqual(["dwm"], [item["code"] for item in menus])

    def test_api_projection_removes_audit_actors_and_examples(self):
        item = redact_public_api_asset({
            "code": "ORDER_API",
            "updatedBy": "admin",
            "params": [
                {"name": "Authorization", "in": "header", "example": "Bearer secret"},
                {"name": "X-Tenant", "in": "header", "example": "internal"},
            ],
            "responseFields": [{"name": "orderId", "example": "real-order"}],
        })
        self.assertNotIn("updatedBy", item)
        self.assertEqual(["X-Tenant"], [param["name"] for param in item["params"]])
        self.assertNotIn("example", item["params"][0])
        self.assertNotIn("example", item["responseFields"][0])

    def test_push_projection_removes_connection_and_contact_details(self):
        item = redact_public_push_system({
            "id": "DOWNSTREAM",
            "host": "198.51.100.8",
            "port": 22,
            "account": "service-account",
            "auth": "secret",
            "downstreamContact": "Alice",
            "dataDeveloperContact": "Bob",
            "jobs": [{
                "id": "JOB_1",
                "sourceFileName": "orders.csv",
                "sourcePath": "/internal/source",
                "targetPath": "/internal/target",
                "delimiter": ",",
                "fields": [{"name": "order_id"}],
            }],
        })
        for key in ("host", "port", "account", "auth", "downstreamContact", "dataDeveloperContact"):
            self.assertNotIn(key, item)
        for key in ("sourcePath", "targetPath", "delimiter", "fields"):
            self.assertNotIn(key, item["jobs"][0])
        self.assertEqual("orders.csv", item["jobs"][0]["sourceFileName"])

    def test_catalog_projections_remove_audit_actors(self):
        for project in (redact_public_manual_code_table, redact_public_report):
            with self.subTest(project=project.__name__):
                item = project({"name": "public", "createdBy": "admin", "updatedBy": "admin"})
                self.assertEqual({"name": "public"}, item)

    def test_lineage_projection_removes_connection_values_and_diagnostics(self):
        item = redact_public_lineage({
            "nodes": [{
                "name": "orders",
                "attributes": {
                    "layer": "DWM",
                    "jdbcUrl": "opaque-connection-value",
                    "owner": "catalog",
                },
            }],
            "edges": [{
                "evidence": {
                    "sourceRecordId": "internal-record-1",
                    "description": "https://example.invalid/evidence",
                },
                "diagnostics": [{"host": "198.51.100.2"}],
            }],
        })
        self.assertEqual({"layer": "DWM", "owner": "catalog"}, item["nodes"][0]["attributes"])
        self.assertNotIn("sourceRecordId", item["edges"][0]["evidence"])
        self.assertNotIn("diagnostics", item["edges"][0])
        self.assertEqual("[已隐藏]", item["edges"][0]["evidence"]["description"])


if __name__ == "__main__":
    unittest.main()
