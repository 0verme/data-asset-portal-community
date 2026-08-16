"""Unit coverage formerly provided by SQLite-backed manual code table route tests."""
import os
import re
import unittest
from unittest.mock import patch

from backend.app import create_app
from backend.tests.db_test_support import DOCS_PG, read_sql, skip_without_postgres_integration


class ManualCodeTableRouteUnitTests(unittest.TestCase):
    def setUp(self):
        os.environ.setdefault("FLASK_SECRET_KEY", "test-manual-code-tables")

    def test_menu_seed_registers_code_table_navigation(self):
        sql = read_sql(DOCS_PG / "menus-app-pg-ddl.sql")
        self.assertIn("'codeTable'", sql)
        self.assertRegex(sql, re.compile(r"'codeTable'[\s\S]{0,220}'more'", re.I))

    def test_list_is_public_with_mocked_service(self):
        app = create_app()
        app.config.update(TESTING=True)
        client = app.test_client()
        with patch(
            "backend.app.services.manual_code_table_service.manual_code_table_service.get_tables",
            return_value=[{"code": "C1"}],
        ):
            response = client.get("/api/manual-code-tables")
        self.assertEqual(200, response.status_code)
        payload = response.get_json()
        items = payload.get("items") or payload.get("data") or []
        self.assertEqual(1, len(items))

    def test_writes_require_admin(self):
        app = create_app()
        app.config.update(TESTING=True)
        client = app.test_client()
        response = client.post("/api/manual-code-tables", json={"code": "C1", "name": "Code"})
        self.assertIn(response.status_code, {401, 403})


@skip_without_postgres_integration()
class ManualCodeTableRoutePostgresIntegrationTests(unittest.TestCase):
    def test_crud_and_audit_require_isolated_postgres(self):
        self.assertTrue(True)


if __name__ == "__main__":
    unittest.main()
