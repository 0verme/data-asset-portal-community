"""Public catalog projection and sensitive-response regression tests."""

from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from backend.app.fastapi.public_catalog import (
    public_navigation_menus,
    redact_public_api_asset,
    redact_public_lineage,
    redact_public_manual_code_table,
    redact_public_push_system,
    redact_public_report,
    redact_public_upstream_system,
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
                {"name": "pageSize", "in": "query", "defaultValue": 50, "sampleValue": 20},
            ],
            "responseFields": [{"name": "orderId", "example": "real-order"}],
        })
        self.assertNotIn("updatedBy", item)
        self.assertEqual(
            ["X-Tenant", "pageSize"],
            [param["name"] for param in item["params"]],
        )
        self.assertNotIn("example", item["params"][0])
        self.assertNotIn("defaultValue", item["params"][1])
        self.assertNotIn("sampleValue", item["params"][1])
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
        }, profile="strict")
        for key in ("host", "port", "account", "auth", "downstreamContact", "dataDeveloperContact"):
            self.assertNotIn(key, item)
        for key in ("sourcePath", "targetPath", "delimiter"):
            self.assertNotIn(key, item["jobs"][0])
        self.assertEqual([{"name": "order_id"}], item["jobs"][0]["fields"])
        self.assertEqual("orders.csv", item["jobs"][0]["sourceFileName"])

    def test_catalog_projections_remove_audit_actors(self):
        for project in (redact_public_manual_code_table, redact_public_report):
            with self.subTest(project=project.__name__):
                item = project({"name": "public", "createdBy": "admin", "updatedBy": "admin"})
                self.assertEqual({"name": "public"}, item)

    def test_upstream_projection_hides_connection_values_in_every_profile(self):
        source = {
            "id": "WAREHOUSE",
            "dbType": "PostgreSQL",
            "host": "198.51.100.4",
            "port": 5432,
            "db": "catalog",
            "schema": "private_schema",
            "account": "svc_reader",
            "password": "not-public",
            "owner": "Alice",
            "ownerDepartment": "Data Office",
            "description": "database=warehouse user=svc_reader path=/internal/config",
        }
        internal = redact_public_upstream_system(source, profile="internal")
        strict = redact_public_upstream_system(source, profile="strict")

        self.assertEqual("PostgreSQL", internal["dbType"])
        self.assertEqual("Alice", internal["owner"])
        self.assertEqual("Data Office", strict["ownerDepartment"])
        self.assertNotIn("warehouse", internal["description"])
        self.assertNotIn("svc_reader", internal["description"])
        self.assertNotIn("/internal/config", internal["description"])
        for key in ("host", "port", "db", "schema", "account", "password"):
            self.assertNotIn(key, internal)
            self.assertNotIn(key, strict)
        self.assertNotIn("owner", strict)

    def test_internal_profile_keeps_business_contacts_but_hides_sensitive_fields(self):
        item = redact_public_push_system({
            "owner": "Alice",
            "downstreamContact": "Bob",
            "ownerEmail": "alice@demo.invalid",
            "ownerPhone": "owner-phone",
            "ownerDepartment": "Data Office",
            "host": "198.51.100.9",
            "databaseUser": "svc_reader",
            "password": "not-public",
            "diagnostics": {"lastError": "trace"},
        }, profile="internal")

        self.assertEqual("Alice", item["owner"])
        self.assertEqual("Bob", item["downstreamContact"])
        self.assertEqual("alice@demo.invalid", item["ownerEmail"])
        self.assertEqual("owner-phone", item["ownerPhone"])
        self.assertEqual("Data Office", item["ownerDepartment"])
        for key in ("host", "databaseUser", "password", "diagnostics"):
            self.assertNotIn(key, item)

    def test_strict_profile_hides_person_identity_but_keeps_organization_metadata(self):
        item = redact_public_manual_code_table({
            "owner": "Alice",
            "maintainerName": "Bob",
            "contactName": "Carol",
            "email": "contact@demo.invalid",
            "phone": "contact-phone",
            "createdBy": "admin",
            "ownerDepartment": "Data Office",
            "ownerTeam": "Catalog",
            "ownershipType": "business",
        }, profile="strict")

        self.assertEqual({
            "ownerDepartment": "Data Office",
            "ownerTeam": "Catalog",
            "ownershipType": "business",
        }, item)

    def test_disabled_profile_hides_anonymous_navigation(self):
        with patch.dict(os.environ, {"PUBLIC_CATALOG_PROFILE": "disabled"}):
            self.assertEqual([], public_navigation_menus([
                {"code": "dwm", "status": "enabled", "adminOnly": False},
            ]))

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
