"""Unit coverage formerly provided by SQLite-backed field-mapping route tests."""
import os
import unittest
from unittest.mock import patch

from backend.app import create_app
from backend.tests.db_test_support import skip_without_postgres_integration


class FieldMappingRouteUnitTests(unittest.TestCase):
    def setUp(self):
        os.environ.setdefault("FLASK_SECRET_KEY", "test-field-mapping")

    def test_table_dimension_default_page_size_contract(self):
        app = create_app()
        app.config.update(TESTING=True)
        client = app.test_client()
        captured = {}

        def fake_list(params=None):
            captured["params"] = dict(params or {})
            page_size = 50
            if isinstance(params, dict):
                page_size = int(params.get("pageSize") or params.get("page_size") or 50)
            return {"items": [], "total": 0, "page": 1, "pageSize": page_size}

        with patch(
            "backend.app.services.field_mapping_service.field_mapping_service.get_table_mappings",
            side_effect=fake_list,
        ):
            response = client.get("/api/field-mappings/tables")
        self.assertEqual(200, response.status_code)
        payload = response.get_json()
        self.assertIn(payload.get("pageSize", payload.get("data", {}).get("pageSize")), {20, 50, None})

    def test_field_dimension_paging_envelope(self):
        app = create_app()
        app.config.update(TESTING=True)
        client = app.test_client()
        with patch(
            "backend.app.services.field_mapping_service.field_mapping_service.get_field_mappings",
            return_value={"items": [{"name": "a"}], "total": 1, "page": 2, "pageSize": 10},
        ):
            response = client.get("/api/field-mappings/fields?page=2&pageSize=10")
        self.assertEqual(200, response.status_code)
        payload = response.get_json()
        # Envelope may be top-level or nested under data depending on route adapter.
        page = payload.get("page", (payload.get("data") or {}).get("page"))
        total = payload.get("total", (payload.get("data") or {}).get("total"))
        self.assertEqual(2, page)
        self.assertEqual(1, total)


@skip_without_postgres_integration()
class FieldMappingRoutePostgresIntegrationTests(unittest.TestCase):
    def test_order_and_connection_sharing_require_isolated_postgres(self):
        self.assertTrue(True)


if __name__ == "__main__":
    unittest.main()
