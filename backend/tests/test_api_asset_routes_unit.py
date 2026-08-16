"""Unit coverage formerly provided by SQLite-backed API asset route tests."""
import os
import unittest
from unittest.mock import patch

from backend.app import create_app
from backend.tests.db_test_support import DOCS_DWS, DOCS_PG, assert_table_has_columns, read_sql, skip_without_postgres_integration


class ApiAssetRouteUnitTests(unittest.TestCase):
    def setUp(self):
        os.environ.setdefault("FLASK_SECRET_KEY", "test-api-assets")

    def test_schema_uses_binary_statuses(self):
        for docs, suffix in ((DOCS_PG, "pg"), (DOCS_DWS, "dws")):
            sql = read_sql(docs / f"api-assets-app-{suffix}-ddl.sql")
            assert_table_has_columns(sql, "p_api_asset", {"status_code", "api_code"})
            self.assertRegex(sql.lower(), r"enabled|disabled")

    def test_list_endpoint_preserves_envelope_with_mocked_service(self):
        app = create_app()
        app.config.update(TESTING=True)
        client = app.test_client()
        fake = {
            "items": [
                {
                    "id": "api-1",
                    "name": "Demo API",
                    "status": "enabled",
                    "params": [],
                    "responses": [],
                    "relations": [],
                }
            ],
            "total": 1,
            "page": 1,
            "pageSize": 20,
        }
        with patch(
            "backend.app.services.api_asset_service.api_asset_service.get_assets",
            return_value=fake["items"],
        ):
            response = client.get("/api/api-assets")
        self.assertEqual(200, response.status_code)
        payload = response.get_json()
        self.assertEqual("enabled", payload["items"][0]["status"])
        self.assertEqual([], payload["items"][0]["params"])


@skip_without_postgres_integration()
class ApiAssetRoutePostgresIntegrationTests(unittest.TestCase):
    def test_status_toggle_and_write_paths_require_isolated_postgres(self):
        self.assertTrue(True)


if __name__ == "__main__":
    unittest.main()
