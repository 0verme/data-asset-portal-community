"""Static schema contracts for PostgreSQL and DWS initialization DDL."""
from __future__ import annotations

import re
import unittest

from backend.tests.db_test_support import (
    DOCS_DWS,
    DOCS_PG,
    assert_table_has_columns,
    read_sql,
)


class SchemaContractTests(unittest.TestCase):
    def test_pg_and_dws_module_ddl_files_exist_in_pairs(self):
        pg_files = {p.name.replace("-app-pg-ddl.sql", "") for p in DOCS_PG.glob("*-app-pg-ddl.sql")}
        dws_files = {p.name.replace("-app-dws-ddl.sql", "") for p in DOCS_DWS.glob("*-app-dws-ddl.sql")}
        self.assertTrue(pg_files)
        self.assertEqual(pg_files, dws_files)
        self.assertFalse(any("sqlite" in name for name in pg_files))

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

    def test_menu_seed_defines_current_navigation_layout(self):
        expected = {
            "upstream": "primary",
            "dwm": "primary",
            "mapping": "primary",
            "lineage": "primary",
            "indicator": "primary",
            "codeTable": "more",
        }
        for docs, suffix in ((DOCS_PG, "pg"), (DOCS_DWS, "dws")):
            sql = read_sql(docs / f"menus-app-{suffix}-ddl.sql")
            for code, placement in expected.items():
                self.assertRegex(
                    sql,
                    re.compile(
                        rf"'{re.escape(code)}'[\s\S]{{0,200}}'{re.escape(placement)}'",
                        re.I,
                    ),
                    f"{suffix} menu {code} should seed nav_placement={placement}",
                )
            # Defaults to more when nav_placement omitted in seed for some rows.
            for code in ("root", "report", "apiAsset", "push", "system"):
                self.assertIn(f"'{code}'", sql)

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
