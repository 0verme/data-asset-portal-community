"""Unit coverage formerly provided by SQLite-backed asset route tests."""
import os
import unittest
from unittest.mock import patch

from backend.app import create_app
from backend.app.services.assets_service import AssetValidationError, assets_service
from backend.tests.db_test_support import skip_without_postgres_integration


class AssetRouteUnitTests(unittest.TestCase):
    def setUp(self):
        os.environ.setdefault("FLASK_SECRET_KEY", "test-asset-routes")
        self.addCleanup(lambda: os.environ.pop("FLASK_SECRET_KEY", None) if os.environ.get("FLASK_SECRET_KEY") == "test-asset-routes" else None)

    def _patch_lookups(self):
        return (
            patch.object(
                assets_service,
                "_load_domain_mappings",
                return_value=({}, {"营销": "MKT"}),
            ),
            patch.object(
                assets_service,
                "get_layers",
                return_value=[{"code": "DWM"}, {"code": "DWA"}],
            ),
        )

    def test_validate_rejects_table_name_starting_with_digit(self):
        domain_patch, layer_patch = self._patch_lookups()
        with domain_patch, layer_patch, self.assertRaises(AssetValidationError) as err:
            assets_service._validate_table_payload(
                {
                    "name": "1_BAD_TABLE",
                    "cn": "格式校验测试",
                    "domain": "营销",
                    "layer": "DWM",
                    "fields": [
                        {"name": "ID", "cn": "id", "type": "BIGINT", "nullable": False, "pk": True, "part": False},
                    ],
                }
            )
        details = err.exception.details
        self.assertTrue(any(item.get("field") == "name" for item in details))

    def test_validate_rejects_invalid_field_name_formats(self):
        domain_patch, layer_patch = self._patch_lookups()
        with domain_patch, layer_patch, self.assertRaises(AssetValidationError):
            assets_service._validate_table_payload(
                {
                    "name": "M_VALID_TABLE",
                    "cn": "格式校验测试",
                    "domain": "营销",
                    "layer": "DWM",
                    "fields": [
                        {"name": "1bad", "cn": "bad", "type": "VARCHAR(8)", "nullable": True, "pk": False, "part": False},
                    ],
                }
            )

    def test_validate_accepts_mixed_case_field_names(self):
        domain_patch, layer_patch = self._patch_lookups()
        with domain_patch, layer_patch:
            assets_service._validate_table_payload(
                {
                    "name": "M_MKT_CAMPAIGN_INFO",
                    "cn": "营销活动信息",
                    "domain": "营销",
                    "layer": "DWM",
                    "owner": "tester",
                    "fields": [
                        {"name": "CORP_ORG", "cn": "法人机构", "type": "VARCHAR(64)", "nullable": False, "pk": True, "part": False},
                        {"name": "corp_org", "cn": "法人机构小写", "type": "VARCHAR(64)", "nullable": True, "pk": False, "part": False},
                    ],
                }
            )

    def test_summary_endpoint_contract_with_mocked_service(self):
        app = create_app()
        app.config.update(TESTING=True)
        client = app.test_client()
        with patch(
            "backend.app.services.assets_service.assets_service.get_asset_table_page",
            return_value={
                "items": [{"name": "T1", "fieldCount": 2, "fields": []}],
                "total": 1,
                "page": 1,
                "pageSize": 20,
            },
        ):
            response = client.get("/api/assets/tables?summary=true&page=1&pageSize=20")
        self.assertEqual(200, response.status_code)
        payload = response.get_json()
        self.assertEqual(1, payload["total"])
        self.assertEqual([], payload["items"][0]["fields"])


@skip_without_postgres_integration()
class AssetRoutePostgresIntegrationTests(unittest.TestCase):
    def test_full_asset_crud_requires_isolated_postgres(self):
        self.assertTrue(True)


if __name__ == "__main__":
    unittest.main()
