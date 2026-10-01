from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from sqlalchemy import insert, select, update
from sqlalchemy.dialects import mysql, postgresql, sqlite

from backend.app.db.core import _compile, execute_core, fetch_all_core
from backend.app.db.sqlite_adapter import connect
from backend.app.db.tables import menu_table
from backend.app.migrations.schema import initialize
from backend.app.navigation.persistence import DEFAULT_MENUS, MenuSeedResult, seed_menus_for_profile
from backend.app.services.system_management_service import SystemManagementService
from demo.seed_loader import DEMO_MENUS


REPO_ROOT = Path(__file__).resolve().parents[2]
PROFILE_NAME = "menu_seed_test"


class MenuSeedTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        root = Path(self.temp_dir.name)
        self.database = root / "menus.sqlite"
        self.config_path = root / "database.yaml"
        self.config_path.write_text(
            "profiles:\n  menu_seed_test:\n    type: sqlite\n"
            f"    database: {self.database.as_posix()}\n",
            encoding="utf-8",
        )
        config = {"type": "sqlite", "database": str(self.database)}
        connection = connect(config)
        try:
            initialize(connection, config, "sqlite")
        finally:
            connection.close()
        self.environment = patch.dict(
            os.environ,
            {
                "ASSET_DB_CONFIG_PATH": str(self.config_path),
                "ASSET_DB_PROFILE": PROFILE_NAME,
            },
        )
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def _rows(self):
        _columns, rows = fetch_all_core(
            PROFILE_NAME,
            select(
                menu_table.c.menu_id,
                menu_table.c.menu_code,
                menu_table.c.menu_name,
                menu_table.c.menu_icon,
                menu_table.c.menu_path,
                menu_table.c.display_order,
                menu_table.c.nav_placement,
                menu_table.c.admin_only,
                menu_table.c.is_active,
                menu_table.c.menu_desc,
            ).order_by(menu_table.c.display_order),
        )
        return rows

    def test_fresh_seed_adds_all_eleven_default_menus(self):
        result = seed_menus_for_profile(PROFILE_NAME)

        self.assertEqual(MenuSeedResult(inserted=11, total=11), result)
        self.assertEqual(
            [menu["code"] for menu in DEFAULT_MENUS],
            [row[1] for row in self._rows()],
        )
        response_menus = SystemManagementService().get_menus()
        self.assertEqual(11, len(response_menus))
        self.assertEqual("api", next(menu for menu in response_menus if menu["code"] == "apiAsset")["icon"])
        self.assertTrue(next(menu for menu in response_menus if menu["code"] == "system")["adminOnly"])

    def test_reseed_is_idempotent(self):
        seed_menus_for_profile(PROFILE_NAME)

        self.assertEqual(MenuSeedResult(inserted=0, total=11), seed_menus_for_profile(PROFILE_NAME))

    def test_reseed_preserves_admin_customizations(self):
        seed_menus_for_profile(PROFILE_NAME)
        execute_core(
            PROFILE_NAME,
            update(menu_table)
            .where(menu_table.c.menu_code == "system")
            .values(display_order=999),
        )
        execute_core(
            PROFILE_NAME,
            update(menu_table)
            .where(menu_table.c.menu_code == "apiAsset")
            .values(menu_name="自定义 API 名称"),
        )

        self.assertEqual(MenuSeedResult(inserted=0, total=11), seed_menus_for_profile(PROFILE_NAME))
        rows = {row[1]: row for row in self._rows()}
        self.assertEqual(999, rows["system"][5])
        self.assertEqual("自定义 API 名称", rows["apiAsset"][2])

    def test_seed_repairs_only_a_missing_default_menu(self):
        seed_menus_for_profile(PROFILE_NAME)
        execute_core(
            PROFILE_NAME,
            menu_table.delete().where(menu_table.c.menu_code == "system"),
        )

        self.assertEqual(MenuSeedResult(inserted=1, total=11), seed_menus_for_profile(PROFILE_NAME))
        self.assertEqual(11, len(self._rows()))

    def test_insert_failure_rolls_back_the_entire_menu_seed(self):
        real_execute = execute_core
        insert_count = 0

        def fail_after_five_inserts(profile, statement):
            nonlocal insert_count
            real_execute(profile, statement)
            insert_count += 1
            if insert_count == 5:
                raise RuntimeError("injected menu insert failure")

        with patch("backend.app.navigation.persistence.execute_core", side_effect=fail_after_five_inserts):
            with self.assertRaisesRegex(RuntimeError, "injected menu insert failure"):
                seed_menus_for_profile(PROFILE_NAME)

        self.assertEqual(5, insert_count)
        self.assertEqual([], self._rows())

    def test_demo_seed_is_a_projection_of_the_canonical_manifest(self):
        expected = [
            (
                menu["id"], menu["code"], menu["name"], menu["icon"], menu["path"],
                menu["order"], menu["navPlacement"], "Y" if menu["adminOnly"] else "N",
                "Y" if menu["status"] == "enabled" else "N", menu["desc"],
            )
            for menu in DEFAULT_MENUS
        ]

        self.assertEqual(expected, DEMO_MENUS)

    def test_legacy_menu_cli_is_a_thin_wrapper_without_schema_or_dialect_sql(self):
        source = (REPO_ROOT / "backend" / "scripts" / "init_menu_data.py").read_text(encoding="utf-8")
        self.assertIn("seed_menus_for_profile", source)
        forbidden_sql = (
            "CREATE SCHEMA", "CREATE TABLE", "CREATE INDEX", "ON CONFLICT",
            "DWP.P_MENU", "DAP.P_MENU",
        )
        for forbidden in forbidden_sql:
            self.assertNotIn(forbidden, source.upper())

    def test_manifest_has_unique_ids_and_codes_and_expected_navigation(self):
        manifest = json.loads((REPO_ROOT / "config" / "default-menus.json").read_text(encoding="utf-8"))
        codes = [menu["code"] for menu in manifest]
        self.assertEqual(11, len(manifest))
        self.assertEqual(11, len(set(codes)))
        self.assertEqual(11, len({menu["id"] for menu in manifest}))
        self.assertEqual(
            {"upstream", "dwm", "mapping", "lineage", "root", "indicator", "report", "apiAsset", "push", "codeTable", "system"},
            set(codes),
        )
        self.assertTrue(all(menu["status"] == "enabled" for menu in manifest))
        self.assertTrue(next(menu for menu in manifest if menu["code"] == "system")["adminOnly"])
        self.assertEqual("api", next(menu for menu in manifest if menu["code"] == "apiAsset")["icon"])

    def test_sqlalchemy_core_menu_statements_compile_without_schema_literals(self):
        statements = (
            select(menu_table.c.menu_code).where(menu_table.c.menu_code == "system"),
            insert(menu_table).values(menu_id=1, menu_code="upstream"),
        )
        provider = SimpleNamespace(
            name="offline-test",
            physical_schema=lambda _config: "tenant_menu_schema",
        )
        with (
            patch("backend.app.db.core.get_db_profile", return_value={"type": "offline-test"}),
            patch("backend.app.db.core.get_provider", return_value=provider),
        ):
            for dialect in (sqlite.dialect(), postgresql.dialect(), mysql.dialect()):
                with self.subTest(dialect=dialect.name):
                    for statement in statements:
                        sql, _params = _compile("offline", statement, dialect=dialect)
                        self.assertIn("tenant_menu_schema.p_menu", sql)
                        self.assertNotIn("dwp.p_menu", sql)
                        self.assertNotIn("dap.p_menu", sql)

    def test_dws_profile_compiles_using_its_configured_schema(self):
        statement = insert(menu_table).values(menu_id=1, menu_code="upstream")
        dws_config = {"type": "gaussdb", "schema": "tenant_menu_schema"}
        with patch("backend.app.db.core.get_db_profile", return_value=dws_config):
            sql, _params = _compile(
                "fake_dws",
                statement,
                dialect=postgresql.dialect(paramstyle="qmark"),
            )

        self.assertIn("tenant_menu_schema.p_menu", sql)
        self.assertNotIn("dwp.p_menu", sql)
        self.assertNotIn("dap.p_menu", sql)
        self.assertNotIn("ON CONFLICT", sql.upper())


if __name__ == "__main__":
    unittest.main()
