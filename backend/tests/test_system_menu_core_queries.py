from __future__ import annotations

import unittest
from unittest.mock import MagicMock

from sqlalchemy.dialects import mysql, postgresql, sqlite

from backend.app.services.system_management_service import SystemManagementService


class SystemMenuCoreQueryTests(unittest.TestCase):
    def setUp(self):
        self.service = SystemManagementService()

    def _assert_portable(self, statement):
        for dialect in (sqlite.dialect(), postgresql.dialect(), mysql.dialect()):
            with self.subTest(dialect=dialect.name):
                compiled = statement.compile(dialect=dialect)
                self.assertIn("p_menu", str(compiled))
                self.assertIn("__app__", str(compiled))
                self.assertNotIn("dwp.", str(compiled))

    def test_menu_list_uses_core_select(self):
        self.service._core.fetch_rows = MagicMock(return_value=[])
        self.service.get_menus()
        self._assert_portable(self.service._core.fetch_rows.call_args.args[0])

    def test_menu_create_and_update_use_core_mutations(self):
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
        self.service._core.execute_statements = MagicMock()

        self.service._create_menu({
            "code": "home",
            "name": "Home",
            "path": "/",
            "status": "enabled",
            "navPlacement": "primary",
        })
        statement = self.service._core.execute_statements.call_args.args[0][0]
        self._assert_portable(statement)
        self.assertIn("INSERT", str(statement.compile(dialect=sqlite.dialect())))


if __name__ == "__main__":
    unittest.main()
