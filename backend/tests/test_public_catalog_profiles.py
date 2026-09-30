"""Configurable anonymous catalog profiles and export policy tests."""

from __future__ import annotations

import os
import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from backend.app.application import Identity
from backend.app.authorization.core import AuthorizationService
from backend.app.fastapi_app import create_fastapi_app
from backend.app.settings import (
    get_public_catalog_config,
    get_public_catalog_export_enabled,
    get_public_catalog_profile,
)


class PublicCatalogProfileSettingsTests(unittest.TestCase):
    def test_defaults_and_case_normalization(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual("internal", get_public_catalog_profile())
            self.assertFalse(get_public_catalog_export_enabled())
            self.assertEqual(
                {"profile": "internal", "exportEnabled": False},
                get_public_catalog_config(),
            )

        with patch.dict(
            os.environ,
            {"PUBLIC_CATALOG_PROFILE": "STRICT", "PUBLIC_CATALOG_EXPORT_ENABLED": "yes"},
            clear=True,
        ):
            self.assertEqual("strict", get_public_catalog_profile())
            self.assertTrue(get_public_catalog_export_enabled())

    def test_invalid_profile_fails_instead_of_widening_public_access(self):
        with patch.dict(os.environ, {"PUBLIC_CATALOG_PROFILE": "open"}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "PUBLIC_CATALOG_PROFILE"):
                get_public_catalog_profile()
            with self.assertRaisesRegex(RuntimeError, "PUBLIC_CATALOG_PROFILE"):
                create_fastapi_app(identity_resolver=lambda _request: None)

    def test_disabled_profile_blocks_guest_reads_but_allows_authenticated_catalog_reads(self):
        assets = MagicMock()
        assets.get_asset_tables.return_value = []
        system = MagicMock()
        system.get_menus.return_value = [{"code": "dwm", "status": "enabled"}]
        with patch.dict(
            os.environ,
            {"PUBLIC_CATALOG_PROFILE": "disabled", "PUBLIC_CATALOG_EXPORT_ENABLED": "true"},
            clear=True,
        ):
            guest_client = TestClient(
                create_fastapi_app(
                    identity_resolver=lambda _request: None,
                    assets_service_instance=assets,
                    system_management_service_instance=system,
                    authorization_service_instance=AuthorizationService(),
                )
            )
            guest_read = guest_client.get("/api/assets/tables")
            self.assertEqual(401, guest_read.status_code)
            assets.get_asset_tables.assert_not_called()

            self.assertEqual([], guest_client.get("/api/system/menus").json()["items"])
            system.get_menus.assert_not_called()
            self.assertEqual(
                {"profile": "disabled", "exportEnabled": True},
                guest_client.get("/api/public-catalog/config").json(),
            )

            admin_client = TestClient(
                create_fastapi_app(
                    identity_resolver=lambda _request: Identity("admin", "admin", "Admin"),
                    assets_service_instance=assets,
                    authorization_service_instance=AuthorizationService(),
                )
            )
            self.assertEqual(200, admin_client.get("/api/assets/tables").status_code)
            assets.get_asset_tables.assert_called_once()

    def test_disabled_profile_rejects_each_anonymous_business_read_family(self):
        paths = (
            "/api/portal/stats",
            "/api/search?q=customer",
            "/api/assets/tables",
            "/api/field-mappings/source-systems",
            "/api/field-mappings/export?view=field",
            "/api/lineage/bootstrap",
            "/api/roots",
            "/api/indicators",
            "/api/reports",
            "/api/api-assets",
            "/api/manual-code-tables",
            "/api/upstreams/systems",
            "/api/push/systems",
        )
        with patch.dict(os.environ, {"PUBLIC_CATALOG_PROFILE": "disabled"}, clear=True):
            client = TestClient(
                create_fastapi_app(
                    identity_resolver=lambda _request: None,
                    authorization_service_instance=AuthorizationService(),
                )
            )
            for path in paths:
                with self.subTest(path=path):
                    response = client.get(path)
                    self.assertEqual(401, response.status_code, response.text)
            self.assertEqual(200, client.get("/api/capabilities").status_code)
            self.assertEqual(200, client.get("/api/public-catalog/config").status_code)
            self.assertEqual([], client.get("/api/system/menus").json()["items"])

    def test_field_mapping_export_has_backend_gate_and_uses_public_data(self):
        for profile, export_enabled in (
            ("internal", "false"),
            ("internal", "true"),
            ("strict", "true"),
            ("disabled", "true"),
        ):
            with self.subTest(profile=profile, enabled=export_enabled):
                service = MagicMock()
                service.get_field_mappings.return_value = {
                    "items": [{
                        "systemName": "订单源",
                        "systemCode": "ORD",
                        "srcTable": "SOURCE_ORDERS",
                        "srcField": "ORDER_ID",
                        "srcType": "varchar",
                        "srcComment": "业务订单号",
                        "targetTable": "DWF_ORDER",
                        "targetField": "ORDER_ID",
                        "mappingRule": "直接映射",
                        "password": "should-never-export",
                    }],
                    "total": 1,
                    "page": 1,
                    "pageSize": 50,
                }
                with patch.dict(
                    os.environ,
                    {
                        "PUBLIC_CATALOG_PROFILE": profile,
                        "PUBLIC_CATALOG_EXPORT_ENABLED": export_enabled,
                    },
                    clear=True,
                ):
                    client = TestClient(
                        create_fastapi_app(
                            identity_resolver=lambda _request: None,
                            field_mapping_service_instance=service,
                            authorization_service_instance=AuthorizationService(),
                        )
                    )
                    response = client.get("/api/field-mappings/export?view=field")

                if profile == "disabled" or export_enabled == "false":
                    self.assertEqual(401, response.status_code, response.text)
                    service.get_field_mappings.assert_not_called()
                else:
                    self.assertEqual(200, response.status_code, response.text)
                    self.assertTrue(response.headers["content-type"].startswith("text/csv"))
                    self.assertIn("源系统", response.text)
                    self.assertIn("订单源 · ORD", response.text)
                    self.assertNotIn("should-never-export", response.text)
                    service.get_field_mappings.assert_called_once()

    def test_field_mapping_table_export_formats_labels_and_neutralizes_formulas(self):
        service = MagicMock()
        service.get_table_mappings.return_value = {
            "items": [{
                "systemName": "订单源",
                "systemCode": "ORD",
                "srcTable": "=CMD()",
                "srcTableCn": "订单表",
                "targetTable": "DWF_ORDER",
                "loadMode": "full",
                "fieldCount": 2,
                "mappedCount": 2,
                "emptyCommentCount": 0,
                "emptyCommentRate": 0,
                "updatedAt": "2026-06-09",
            }],
            "total": 1,
            "page": 1,
            "pageSize": 50,
        }
        with patch.dict(
            os.environ,
            {"PUBLIC_CATALOG_PROFILE": "internal", "PUBLIC_CATALOG_EXPORT_ENABLED": "true"},
            clear=True,
        ):
            client = TestClient(
                create_fastapi_app(
                    identity_resolver=lambda _request: None,
                    field_mapping_service_instance=service,
                    authorization_service_instance=AuthorizationService(),
                )
            )
            response = client.get("/api/field-mappings/export?view=table")

        self.assertEqual(200, response.status_code, response.text)
        self.assertIn("订单源 · ORD", response.text)
        self.assertIn("'=CMD()", response.text)
        self.assertIn("全量", response.text)
        service.get_table_mappings.assert_called_once()

    def test_anonymous_export_is_independently_gated_and_uses_profile_projection(self):
        for profile, export_enabled, expected_owner in (
            ("internal", "false", False),
            ("internal", "true", True),
            ("strict", "true", False),
            ("disabled", "true", False),
        ):
            with self.subTest(profile=profile, enabled=export_enabled):
                service = MagicMock()
                service.get_tables.return_value = [{
                    "id": "1",
                    "tableCode": "DIM_ORDER",
                    "tableName": "=CMD()",
                    "style": "dim",
                    "owner": "Alice",
                    "status": "enabled",
                    "remark": "业务字典",
                    "updatedAt": "2026-06-09",
                }]
                with patch.dict(
                    os.environ,
                    {
                        "PUBLIC_CATALOG_PROFILE": profile,
                        "PUBLIC_CATALOG_EXPORT_ENABLED": export_enabled,
                    },
                    clear=True,
                ):
                    client = TestClient(
                        create_fastapi_app(
                            identity_resolver=lambda _request: None,
                            manual_code_table_service_instance=service,
                            authorization_service_instance=AuthorizationService(),
                        )
                    )
                    response = client.get("/api/manual-code-tables/export")

                if profile == "disabled" or export_enabled == "false":
                    self.assertEqual(401, response.status_code, response.text)
                    service.get_tables.assert_not_called()
                else:
                    self.assertEqual(200, response.status_code, response.text)
                    self.assertEqual(expected_owner, "Alice" in response.text)
                    self.assertIn("'=CMD()", response.text)
                    service.get_tables.assert_called_once()


if __name__ == "__main__":
    unittest.main()
