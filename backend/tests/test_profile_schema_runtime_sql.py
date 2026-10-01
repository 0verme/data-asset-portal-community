from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.app.db.facade import normalize_sql_for_profile
from backend.app.db.providers import GaussDBProvider, MySQLProvider, PostgreSQLProvider
from backend.app.db.sqlite_adapter import connect as connect_sqlite
from backend.app.services.portal_service import PortalService
from backend.app.services.providers.registry import list_portal_stats, list_search_entities
from backend.app.services.search_provider import KeywordSearchProvider
from backend.scripts import db_to_init_sql


class RuntimeSqlProfileSchemaTests(unittest.TestCase):
    def test_registered_portal_and_search_sql_is_unqualified(self):
        for config in list_portal_stats():
            with self.subTest(kind="portal", key=config["key"]):
                self.assertNotIn("dwp.", config["from"].lower())

        for config in list_search_entities():
            with self.subTest(kind="search", key=config["type"]):
                self.assertNotIn("dwp.", config["from"].lower())
                field_match = config.get("field_match")
                if field_match:
                    self.assertNotIn("dwp.", field_match["table"].lower())

    def test_unqualified_sql_is_left_to_each_profile_connection(self):
        sql = "SELECT COUNT(*) FROM p_asset_table"
        profiles = {
            "sqlite_test": {"type": "sqlite", "database": ":memory:"},
            "postgres_test": {"type": "postgres", "schema": "dap"},
            "mysql_test": {"type": "mysql", "database": "dap_db"},
            "gauss_test": {"type": "gaussdb", "schema": "dap"},
        }
        with patch(
            "backend.app.db.facade.get_db_profile",
            side_effect=profiles.__getitem__,
        ):
            for profile in profiles:
                with self.subTest(profile=profile):
                    self.assertEqual(sql, normalize_sql_for_profile(profile, sql))

        self.assertEqual(
            "-c search_path=dap",
            PostgreSQLProvider._options(profiles["postgres_test"]),
        )
        self.assertEqual("", MySQLProvider().physical_schema(profiles["mysql_test"]))
        self.assertEqual("dap", GaussDBProvider().physical_schema(profiles["gauss_test"]))

    def test_database_export_uses_profile_schema_and_unqualified_replay_sql(self):
        config = {"type": "gaussdb", "schema": "dap"}
        with patch("backend.scripts.db_to_init_sql.get_db_profile", return_value=config):
            self.assertEqual("dap", db_to_init_sql.profile_schema("gauss_test"))

        self.assertTrue(
            all("dwp." not in table.lower() for table in db_to_init_sql.TABLES)
        )
        self.assertFalse(
            any(
                "dwp." in statement.lower()
                for statement in db_to_init_sql.build_delete_block()
            )
        )
        with patch(
            "backend.scripts.db_to_init_sql.fetch_rows",
            return_value=[{"column_name": "asset_id"}],
        ) as rows:
            self.assertEqual(
                ["asset_id"],
                db_to_init_sql.load_table_columns("gauss_test", "dap", "p_asset_table"),
            )
        query, params = rows.call_args.args[1], rows.call_args.kwargs["params"]
        self.assertNotIn("dwp.", query.lower())
        self.assertEqual(["dap", "p_asset_table"], params)

    def test_portal_stats_and_search_resolve_sqlite_attached_schema(self):
        with tempfile.TemporaryDirectory(prefix="profile-schema-runtime-") as temp_dir:
            config = {"type": "sqlite", "database": str(Path(temp_dir) / "app.sqlite")}
            connection = connect_sqlite(config)
            try:
                connection.executescript(
                    """
CREATE TABLE dwp.p_asset_table (
    asset_id INTEGER PRIMARY KEY,
    table_name TEXT NOT NULL,
    table_cn_name TEXT,
    layer_code TEXT,
    domain_code TEXT,
    schema_name TEXT,
    owner_name TEXT,
    grain_desc TEXT,
    cycle_desc TEXT,
    table_desc TEXT,
    is_deleted TEXT NOT NULL
);
CREATE TABLE dwp.p_asset_domain (domain_code TEXT, domain_name TEXT);
CREATE TABLE dwp.p_asset_field (
    asset_id INTEGER,
    field_order INTEGER,
    field_name TEXT,
    field_cn_name TEXT,
    field_desc TEXT,
    is_deleted TEXT NOT NULL
);
INSERT INTO dwp.p_asset_domain VALUES ('A', '主题域 A'), ('B', '主题域 B'), ('X', '已删除资产域');
INSERT INTO dwp.p_asset_table
    (asset_id, table_name, table_cn_name, layer_code, domain_code,
     schema_name, owner_name, grain_desc, cycle_desc, table_desc, is_deleted)
VALUES
    (1, 'active_asset_a', '有效资产 A', 'DWA', 'A', 'DWS_DWA', 'owner', 'grain', 'daily', 'desc', 'N'),
    (2, 'active_asset_b', '有效资产 B', 'DM', 'B', 'DWS_DM', 'owner', 'grain', 'daily', 'desc', 'N'),
    (3, 'deleted_asset', '已删除资产', 'DM', 'X', 'DWS_DM', 'owner', 'grain', 'daily', 'desc', 'Y');
"""
                )
                connection.commit()
            finally:
                connection.close()

            with (
                patch("backend.app.db.facade.get_db_profile", return_value=config),
                patch("backend.app.db.facade.get_engine", return_value=None),
                patch(
                    "backend.app.services.portal_service.system_management_service."
                    "get_enabled_menu_codes",
                    return_value={"dwm"},
                ),
            ):
                portal = PortalService()
                portal._db_profile = "sqlite_test"
                stats = {item["key"]: item["value"] for item in portal.get_stats()}

            self.assertEqual(2, stats["domain"])
            self.assertEqual(2, stats["asset_table"])

            with (
                patch("backend.app.db.facade.get_db_profile", return_value=config),
                patch("backend.app.db.facade.get_engine", return_value=None),
                patch(
                    "backend.app.services.search_provider.system_management_service."
                    "get_enabled_menu_codes",
                    return_value={"dwm"},
                ),
            ):
                search = KeywordSearchProvider()
                search._db_profile = "sqlite_test"
                result = search.search("active_asset", scope="asset", limit=10)

            self.assertEqual(2, result["total"])
            self.assertEqual(
                {"active_asset_a", "active_asset_b"},
                {item["id"] for item in result["groups"][0]["items"]},
            )
            result_ids = {item["id"] for item in result["groups"][0]["items"]}
            self.assertNotIn("deleted_asset", result_ids)


if __name__ == "__main__":
    unittest.main()
