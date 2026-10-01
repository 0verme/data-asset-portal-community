"""Static schema contracts for PostgreSQL and DWS initialization DDL."""
from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

from backend.tests.db_test_support import (
    DOCS_DWS,
    DOCS_PG,
    assert_table_has_columns,
    read_sql,
)


REPO_ROOT = Path(__file__).resolve().parents[2]


class SchemaContractTests(unittest.TestCase):
    def test_pg_and_dws_module_ddl_files_exist_in_pairs(self):
        pg_files = {p.name.replace("-app-pg-ddl.sql", "") for p in DOCS_PG.glob("*-app-pg-ddl.sql")}
        dws_files = {p.name.replace("-app-dws-ddl.sql", "") for p in DOCS_DWS.glob("*-app-dws-ddl.sql")}
        self.assertTrue(pg_files)
        self.assertEqual(pg_files, dws_files)
        self.assertFalse(any("sqlite" in name for name in pg_files))

    def test_common_code_ddl_keeps_item_ids_unique_and_current_upstream_options(self):
        expected_options = {
            "MONGODB",
            "KAFKA",
            "OBJECT_STORAGE",
            "PRODUCT_OPERATIONS",
            "MEMBER_OPERATIONS",
            "TRADE_OPERATIONS",
            "STORE_OPERATIONS",
            "SUPPLY_CHAIN",
            "MARKETING",
            "FULFILLMENT",
            "CUSTOMER_SERVICE",
        }
        for docs, suffix in ((DOCS_PG, "pg"), (DOCS_DWS, "dws")):
            sql = read_sql(docs / f"common-codes-app-{suffix}-ddl.sql")
            item_ids = re.findall(
                r"INSERT INTO dwp\.p_code_item\s*\([\s\S]*?\)\s*"
                r"SELECT\s+(\d+),",
                sql,
                re.I,
            )
            self.assertEqual(len(item_ids), len(set(item_ids)), f"{suffix} item ids")
            for code in expected_options:
                self.assertIn(f"'{code}'", sql)

    def test_operation_log_uses_sequence_backed_id(self):
        for docs, suffix in ((DOCS_PG, "pg"), (DOCS_DWS, "dws")):
            sql = read_sql(docs / f"operation-logs-app-{suffix}-ddl.sql")
            self.assertIn("p_operation_log_id_seq", sql)
            assert_table_has_columns(
                sql,
                "p_operation_log",
                {"id", "module_name", "operation_type", "result_status", "created_at"},
            )
            self.assertRegex(sql, re.compile(r"nextval\s*\(\s*'dwp\.p_operation_log_id_seq'", re.I))

    def test_push_system_defines_importance_and_latest_output_time(self):
        for docs, suffix in ((DOCS_PG, "pg"), (DOCS_DWS, "dws")):
            sql = read_sql(docs / f"push-app-{suffix}-ddl.sql")
            assert_table_has_columns(
                sql,
                "p_push_system",
                {"importance_level_code", "latest_output_time"},
            )
            assert_table_has_columns(sql, "p_push_job", {"job_id", "system_id", "job_code"})
            job_body_start = sql.lower().index("create table if not exists dwp.p_push_job")
            job_slice = sql[job_body_start : job_body_start + 1500]
            self.assertNotIn("owner_name", job_slice.lower())

    def test_menu_defaults_are_canonical_and_sql_artifacts_are_reference_only(self):
        manifest = json.loads(
            (REPO_ROOT / "config" / "default-menus.json").read_text(encoding="utf-8")
        )
        self.assertEqual(11, len(manifest))
        expected_primary = {"upstream", "dwm", "mapping", "lineage", "indicator"}
        self.assertEqual(
            expected_primary,
            {menu["code"] for menu in manifest if menu["navPlacement"] == "primary"},
        )
        self.assertTrue(next(menu for menu in manifest if menu["code"] == "system")["adminOnly"])
        self.assertEqual("api", next(menu for menu in manifest if menu["code"] == "apiAsset")["icon"])

        for docs, suffix in ((DOCS_PG, "pg"), (DOCS_DWS, "dws")):
            sql = read_sql(docs / f"menus-app-{suffix}-ddl.sql")
            self.assertIn("Reference only", sql)
            self.assertIn("config/default-menus.json", sql)
            self.assertNotRegex(sql, re.compile(r"^\s*(?:CREATE|INSERT)\s", re.I | re.M))

    def test_auth_and_assets_core_tables_present(self):
        for docs, suffix in ((DOCS_PG, "pg"), (DOCS_DWS, "dws")):
            auth = read_sql(docs / f"auth-app-{suffix}-ddl.sql")
            assets = read_sql(docs / f"assets-app-{suffix}-ddl.sql")
            self.assertIn("p_admin_user", auth)
            assert_table_has_columns(auth, "p_role", {"role_code", "name", "builtin", "enabled"})
            assert_table_has_columns(auth, "p_permission", {"permission_code", "resource", "action", "name"})
            assert_table_has_columns(auth, "p_role_permission", {"role_code", "permission_code"})
            self.assertIn("idx_p_role_permission_permission", auth)
            assert_table_has_columns(assets, "p_asset_table", {"table_name", "layer_code", "domain_code"})
            assert_table_has_columns(assets, "p_asset_field", {"field_name", "asset_id"})


if __name__ == "__main__":
    unittest.main()
