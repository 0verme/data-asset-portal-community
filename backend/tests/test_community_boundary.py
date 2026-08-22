# pyright: reportMissingImports=false

from __future__ import annotations

import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.app.core.capabilities import resolve_capabilities, set_resolved_capabilities
from backend.app.db.facade import connect_with_profile
from backend.app.migrations.schema import initialize, verify_database
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
COMMUNITY_CONFIG = ROOT / "configs" / "database.community.yaml"


class RepositoryOpenBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.database = Path(self.temp_dir.name) / "repository.sqlite"
        self.environment = patch.dict(
            os.environ,
            {
                "ASSET_DB_CONFIG_PATH": str(COMMUNITY_CONFIG),
                "ASSET_DB_PROFILE": "community_sqlite",
                "ASSET_DB_DATABASE": str(self.database),
                "FLASK_ENV": "production",
                "FLASK_SECRET_KEY": "repository-open-boundary-test-only",
                "LINEAGE_DB_PROFILE": "community_sqlite",
            },
            clear=False,
        )
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.addCleanup(lambda: set_resolved_capabilities(None))

        connection = connect_with_profile("community_sqlite")
        try:
            config = {"type": "sqlite", "database": str(self.database)}
            self.assertTrue(initialize(connection, config, "sqlite"))
            self.assertEqual("0001_baseline", verify_database(connection, config, "sqlite"))
        finally:
            connection.close()
        from demo.seed_sqlite import seed

        seed(self.database)

    def table_names(self):
        connection = sqlite3.connect(self.database)
        try:
            return {
                row[0]
                for row in connection.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                )
            }
        finally:
            connection.close()

    def client(self):
        from backend.asgi import create_native_app

        return TestClient(create_native_app(capabilities=resolve_capabilities()))

    def test_schema_contains_every_seeded_repository_module_table(self):
        from demo.seed_loader import community_seed_plan

        self.assertTrue(set(community_seed_plan()) <= self.table_names())
        self.assertIn("p_lineage_snapshot", self.table_names())
        self.assertIn("p_upstream_system", self.table_names())
        self.assertIn("p_push_system", self.table_names())
        self.assertIn("p_report_asset", self.table_names())
        self.assertIn("p_manual_code_table", self.table_names())

    def test_every_repository_route_is_registered_and_diagnostic(self):
        client = self.client()
        requests = {
            "upstream": "/api/upstreams/systems",
            "push": "/api/push/systems",
            "report": "/api/reports",
            "codeTable": "/api/manual-code-tables",
            "lineage": "/api/lineage/bootstrap",
            "apiAsset": "/api/api-assets/systems",
            "mapping": "/api/field-mappings/fields",
            "root": "/api/roots",
            "indicator": "/api/indicators",
            "dwm": "/api/assets/tables",
        }
        for code, path in requests.items():
            with self.subTest(code=code):
                response = client.get(path)
                self.assertEqual(200, response.status_code, response.text)

        capabilities = client.get("/api/capabilities")
        self.assertEqual(200, capabilities.status_code)
        self.assertNotIn("edition", capabilities.json())
        self.assertTrue(all(item["enabled"] for item in capabilities.json()["modules"]))

    def test_open_modules_are_present_in_search_and_portal_stats(self):
        client = self.client()
        for scope, query in (("upstream", "up_"), ("push", "DEMO_"), ("report", "RPT_"), ("codeTable", "ORDER_STATUS")):
            with self.subTest(scope=scope):
                search = client.get(f"/api/search?q={query}&scope={scope}")
                self.assertEqual(200, search.status_code)
                modules = {group.get("module") for group in search.json().get("groups", [])}
                self.assertIn(scope, modules)

        stats = client.get("/api/portal/stats")
        self.assertEqual(200, stats.status_code)
        keys = {item["key"] for item in stats.json().get("items", [])}
        self.assertTrue({"system", "downstream_system", "report", "code_table"} <= keys)

    def test_seeded_admin_contract_still_works(self):
        response = self.client().post(
            "/api/auth/login",
            json={"username": "community_demo", "password": "demo-change-me"},
        )
        self.assertEqual(200, response.status_code)


if __name__ == "__main__":
    unittest.main()
