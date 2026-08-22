# pyright: reportMissingImports=false

from __future__ import annotations

import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.app.core.capabilities import (
    resolve_capabilities,
    set_resolved_capabilities,
)
from backend.app.db.facade import connect_with_profile
from backend.app.migrations.schema import initialize, verify_database
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = ROOT.parent
COMMUNITY_CONFIG = ROOT / "configs" / "database.community.yaml"

# Full private-module table inventory, grouped by private module code from
# backend/app/core/modules.py (upstream / report / push / codeTable).
PRIVATE_TABLES = {
    # push
    "p_push_system",
    "p_push_job",
    "p_push_job_field",
    "p_push_change_log",
    # upstream
    "p_upstream_system",
    "p_upstream_unload_time",
    "p_upstream_change_log",
    # report
    "p_report_asset",
    # codeTable
    "p_manual_code_table",
}

# Search entity types whose underlying tables are private-module owned.
PRIVATE_SEARCH_TYPES = {"system", "push", "report", "codeTable"}
# Private module codes never registered as portal stat providers.
PRIVATE_MODULE_CODES = {"upstream", "report", "push", "codeTable"}


class CommunityBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.database = Path(self.temp_dir.name) / "community.sqlite"
        self.environment = patch.dict(
            os.environ,
            {
                "ASSET_DB_CONFIG_PATH": str(COMMUNITY_CONFIG),
                "ASSET_DB_PROFILE": "community_sqlite",
                "ASSET_DB_DATABASE": str(self.database),
                "ASSET_EDITION": "community",
                "FLASK_ENV": "production",
                "FLASK_SECRET_KEY": "community-boundary-test-only",
                "LINEAGE_DB_PROFILE": "",
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
            self.assertEqual(
                "0001_baseline", verify_database(connection, config, "sqlite")
            )
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
        capabilities = resolve_capabilities(
            enabled=[
                "portal",
                "dwm",
                "mapping",
                "lineage",
                "root",
                "indicator",
                "apiAsset",
                "system",
            ],
            disabled=["upstream", "push"],
            edition="community",
            strict=True,
        )
        from backend.asgi import create_native_app

        app = create_native_app(capabilities=capabilities)
        return TestClient(app), capabilities

    def test_community_schema_and_routes_exclude_private_modules(self):
        names = self.table_names()
        self.assertFalse(names & PRIVATE_TABLES)
        self.assertIn("p_system", names)
        self.assertIn("p_data_source", names)
        client, capabilities = self.client()
        enabled = set(capabilities["enabled_codes"])
        with patch(
            "backend.app.services.system_management_service."
            "system_management_service.get_enabled_menu_codes",
            return_value=enabled,
        ):
            self.assertEqual(200, client.get("/api/api-assets").status_code)
            self.assertEqual(200, client.get("/api/api-assets/systems").status_code)
            self.assertEqual(200, client.get("/api/assets/tables").status_code)
            self.assertEqual(200, client.get("/api/roots").status_code)
            self.assertEqual(200, client.get("/api/indicators").status_code)
            self.assertEqual(200, client.get("/api/lineage/bootstrap").status_code)
            self.assertEqual(200, client.get("/api/api-assets/ORDER_QUERY").status_code)
            self.assertEqual(200, client.get("/api/field-mappings/fields").status_code)
            self.assertEqual(200, client.get("/api/field-mappings/tables").status_code)
            self.assertEqual(200, client.get("/api/field-mappings/stats").status_code)
            self.assertEqual(
                200, client.get("/api/field-mappings/source-systems").status_code
            )
            self.assertEqual(200, client.get("/api/search?q=ORDER").status_code)
            self.assertEqual(200, client.get("/api/portal/stats").status_code)
        login = client.post(
            "/api/auth/login",
            json={"username": "community_demo", "password": "demo-change-me"},
        )
        self.assertEqual(200, login.status_code)
        self.assertEqual(404, client.get("/api/push").status_code)
        self.assertEqual(404, client.get("/api/upstreams").status_code)

    def test_api_asset_and_mapping_use_public_relations(self):
        from demo.seed_loader import load_dataset

        client, _ = self.client()
        api_assets = {item["code"]: item for item in load_dataset("api_assets.json")}
        systems = {item["id"]: item for item in load_dataset("systems.json")}
        sources = {item["id"]: item for item in load_dataset("data_sources.json")}
        mappings = load_dataset("mappings.json")

        order_query = api_assets["ORDER_QUERY"]
        expected_system = systems[order_query["systemId"]]
        asset = client.get("/api/api-assets/ORDER_QUERY").json()["data"]
        self.assertEqual(expected_system["id"], asset["systemId"])
        self.assertEqual(expected_system["code"], asset["system"]["code"])
        self.assertNotIn("host", asset["system"])

        source_systems = client.get("/api/field-mappings/source-systems").json()[
            "items"
        ]
        source_by_code = {item["systemCode"]: item for item in source_systems}
        for mapping in mappings:
            expected = sources[mapping["dataSourceId"]]
            self.assertIn(
                expected["code"],
                source_by_code,
                f"mapping {mapping['id']} must resolve through p_data_source",
            )

    def test_search_never_queries_private_tables_in_physically_missing_schema(self):
        # The Community database has NO private tables at all (see setUp); a
        # search over every community scope must still work and return only
        # community entity types — proving search gates by capability before SQL.
        client, _ = self.client()
        response = client.get("/api/search?q=DEMO")
        self.assertEqual(200, response.status_code)
        payload = response.json()
        for group in payload.get("groups") or []:
            self.assertNotIn(
                group.get("type"),
                PRIVATE_SEARCH_TYPES,
                f"search returned private entity type {group.get('type')}",
            )
        scopes = client.get("/api/search/scopes").json()
        for scope in scopes if isinstance(scopes, list) else scopes.get("scopes", []):
            if isinstance(scope, dict):
                self.assertNotIn(
                    scope.get("code"),
                    PRIVATE_MODULE_CODES,
                    f"search scope exposes private module {scope.get('code')}",
                )

    def test_portal_stats_exclude_private_modules_in_physically_missing_schema(self):
        client, _ = self.client()
        response = client.get("/api/portal/stats")
        self.assertEqual(200, response.status_code)
        cards = response.json()
        cards = cards.get("items") if isinstance(cards, dict) else cards
        for card in cards or []:
            self.assertNotIn(
                card.get("module"),
                PRIVATE_MODULE_CODES,
                f"portal stat card exposes private module {card.get('module')}",
            )


if __name__ == "__main__":
    unittest.main()
