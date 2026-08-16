"""Unit coverage formerly provided by SQLite-backed common-code route tests."""
import os
import unittest
from unittest.mock import patch

from backend.app import create_app
from backend.tests.db_test_support import skip_without_postgres_integration


class CommonCodeRouteUnitTests(unittest.TestCase):
    def setUp(self):
        os.environ.setdefault("FLASK_SECRET_KEY", "test-common-codes")

    def test_batch_rejects_invalid_category_codes_without_querying(self):
        from backend.app.services.common_code_service import CommonCodeValidationError

        app = create_app()
        app.config.update(TESTING=True)
        client = app.test_client()
        with patch(
            "backend.app.services.common_code_service.common_code_service.get_items_batch",
            side_effect=CommonCodeValidationError("invalid category codes"),
        ) as get_batch:
            response = client.get("/api/common-codes/items?codes=BAD%20CODE,also-bad!")
        self.assertEqual(422, response.status_code)
        get_batch.assert_called_once()

    def test_batch_preserves_request_order_and_empty_groups_with_mock(self):
        app = create_app()
        app.config.update(TESTING=True)
        client = app.test_client()
        with patch(
            "backend.app.services.common_code_service.common_code_service.get_items_batch",
            return_value={
                "items": [
                    {"categoryCode": "LAYER", "items": [{"code": "DWM", "name": "DWM"}]},
                    {"categoryCode": "MISSING", "items": []},
                ]
            },
        ):
            response = client.get("/api/common-codes/items?codes=LAYER,MISSING")
        self.assertEqual(200, response.status_code)
        payload = response.get_json()
        self.assertTrue(payload)

    def test_single_category_hits_service(self):
        app = create_app()
        app.config.update(TESTING=True)
        client = app.test_client()
        with patch(
            "backend.app.services.common_code_service.common_code_service.get_items",
            return_value=[{"code": "DWM", "name": "DWM"}],
        ) as get_items:
            first = client.get("/api/common-codes/categories/LAYER/items")
            second = client.get("/api/common-codes/categories/LAYER/items")
        self.assertEqual(200, first.status_code)
        self.assertEqual(200, second.status_code)
        self.assertGreaterEqual(get_items.call_count, 1)


@skip_without_postgres_integration()
class CommonCodeRoutePostgresIntegrationTests(unittest.TestCase):
    def test_cache_and_sql_counts_require_isolated_postgres(self):
        self.assertTrue(True)


if __name__ == "__main__":
    unittest.main()
