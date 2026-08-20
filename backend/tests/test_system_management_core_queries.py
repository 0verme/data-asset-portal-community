from __future__ import annotations

import unittest
from unittest.mock import MagicMock

from sqlalchemy.dialects import mysql, postgresql, sqlite

from backend.app.services.system_management_service import SystemManagementService


class SystemManagementCoreQueryTests(unittest.TestCase):
    def setUp(self):
        self.service = SystemManagementService()

    def _assert_portable(self, statement, table_name):
        for dialect in (sqlite.dialect(), postgresql.dialect(), mysql.dialect()):
            with self.subTest(dialect=dialect.name):
                compiled = statement.compile(dialect=dialect)
                self.assertIn(table_name, str(compiled))
                self.assertIn("__app__", str(compiled))
                self.assertNotIn("dwp.", str(compiled))

    def test_parameter_and_menu_reads_use_core(self):
        self.service._core.fetch_rows = MagicMock(return_value=[])
        self.service.get_param_dict_categories()
        category_statement = self.service._core.fetch_rows.call_args.args[0]
        self._assert_portable(category_statement, "p_code_category")

        self.service.get_param_dicts("SYSTEM_STATUS")
        item_statement = self.service._core.fetch_rows.call_args.args[0]
        self._assert_portable(item_statement, "p_code_item")

        self.service.get_menus()
        menu_statement = self.service._core.fetch_rows.call_args.args[0]
        self._assert_portable(menu_statement, "p_menu")

    def test_core_mutations_compile_for_parameter_and_menu_tables(self):
        self.service._core.execute_statements = MagicMock()
        self.service._core.fetch_rows = MagicMock(side_effect=[
            [{"category_id": 3}],
            [{"category_id": 3}],
            [],
            [{
                "item_id": 7,
                "category_code": "SYSTEM_STATUS",
                "category_name": "System status",
                "item_code": "ACTIVE",
                "item_name": "Active",
                "item_value": "active",
                "item_desc": "",
                "is_active": "Y",
                "updated_at": "",
            }],
        ])
        self.service._core.next_pk = MagicMock(return_value=7)
        self.service._ensure_db_category_exists("SYSTEM_STATUS")
        self.service._create_param_dict({
            "categoryCode": "SYSTEM_STATUS",
            "code": "ACTIVE",
            "name": "Active",
            "value": "active",
            "status": "enabled",
        })
        insert_statement = self.service._core.execute_statements.call_args.args[0][0]
        self._assert_portable(insert_statement, "p_code_item")

        self.service._core.fetch_rows = MagicMock(side_effect=[
            [],
            [{"next_order": 10}],
            [{
                "menu_id": 7,
                "menu_code": "home",
                "menu_name": "Home",
                "menu_icon": "grid",
                "menu_path": "/",
                "display_order": 10,
                "nav_placement": "primary",
                "admin_only": "N",
                "is_active": "Y",
                "menu_desc": "",
                "updated_at": "",
            }],
        ])
        self.service._core.next_pk = MagicMock(return_value=7)
        self.service._create_menu({
            "code": "home",
            "name": "Home",
            "path": "/",
            "status": "enabled",
            "navPlacement": "primary",
        })
        menu_statement = self.service._core.execute_statements.call_args.args[0][0]
        self._assert_portable(menu_statement, "p_menu")


if __name__ == "__main__":
    unittest.main()
