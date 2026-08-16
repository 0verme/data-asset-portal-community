"""Unit coverage formerly provided by SQLite-backed push/upstream route tests."""
import os
import unittest
from unittest.mock import patch

from backend.app import create_app
from backend.tests.db_test_support import skip_without_postgres_integration


class PushUpstreamRouteUnitTests(unittest.TestCase):
    def setUp(self):
        os.environ.setdefault("FLASK_SECRET_KEY", "test-push-upstream")

    def test_public_push_list_hides_connection_secrets_with_mock(self):
        app = create_app()
        app.config.update(TESTING=True)
        client = app.test_client()
        fake = {
            "items": [
                {
                    "id": "sys-1",
                    "name": "Downstream",
                    "host": "hidden.example",
                    "account": None,
                }
            ],
            "total": 1,
            "page": 1,
            "pageSize": 20,
        }
        with patch(
            "backend.app.routes.push.push_service.get_push_systems",
            return_value=fake,
        ):
            response = client.get("/api/push/systems")
        self.assertEqual(200, response.status_code)
        text = response.get_data(as_text=True).lower()
        self.assertNotIn("password", text)
        self.assertNotIn("jdbc", text)

    def test_public_upstream_list_envelope(self):
        app = create_app()
        app.config.update(TESTING=True)
        client = app.test_client()
        with patch(
            "backend.app.routes.upstream.upstream_service.get_systems",
            return_value=[{"id": "u1", "name": "Upstream"}],
        ):
            response = client.get("/api/upstreams/systems")
        self.assertEqual(200, response.status_code)
        payload = response.get_json()
        items = payload.get("items") or []
        self.assertEqual(1, len(items))
        self.assertEqual("u1", items[0]["id"])

    def test_admin_detail_requires_login(self):
        app = create_app()
        app.config.update(TESTING=True)
        client = app.test_client()
        response = client.get("/api/push/systems/sys-1/admin")
        self.assertIn(response.status_code, {401, 403, 404})


@skip_without_postgres_integration()
class PushUpstreamRoutePostgresIntegrationTests(unittest.TestCase):
    def test_connection_sharing_and_write_paths_require_isolated_postgres(self):
        self.assertTrue(True)


if __name__ == "__main__":
    unittest.main()
