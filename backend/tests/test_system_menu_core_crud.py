from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from sqlalchemy.dialects import mysql, postgresql, sqlite

from backend.app.services.system_management_service import SystemManagementService


class SystemMenuCoreCrudTests(unittest.TestCase):
    def setUp(self):
        self.service = SystemManagementService()
        self.row = {
            "menu_id": 7,
            "menu_code": "root",
            "menu_name": "Root",
            "menu_icon": "grid",
            "menu_path": "/roots",
            "display_order": 10,
            "nav_placement": "primary",
            "admin_only": "N",
            "is_active": "Y",
            "menu_desc": "Root menu",
            "updated_at": "2026-08-20 00:00:00",
        }
        self.payload = {
            "code": "root",
            "name": "Root",
            "icon": "grid",
            "path": "/roots",
            "order": 10,
            "navPlacement": "primary",
            "adminOnly": False,
            "status": "enabled",
            "desc": "Root menu",
        }

    def _assert_portable(self, statement):
        for dialect in (sqlite.dialect(), postgresql.dialect(), mysql.dialect()):
            with self.subTest(dialect=dialect.name):
                compiled = statement.compile(dialect=dialect)
                self.assertIn("p_menu", str(compiled))
                self.assertIn("__app__", str(compiled))
                self.assertNotIn("dwp.", str(compiled))

    def test_menu_list_uses_core_query(self):
        self.service._core.fetch_rows = MagicMock(return_value=[self.row])

        menus = self.service.get_menus()

        statement = self.service._core.fetch_rows.call_args.args[0]
        self._assert_portable(statement)
        self.assertEqual("root", menus[0]["code"])

    @patch("backend.app.services.system_management_service.operation_log_service.audit")
    def test_create_builds_core_insert(self, audit):
        audit.return_value.__enter__.return_value = MagicMock()
        self.service._core.fetch_rows = MagicMock(side_effect=[[], [self.row]])
        self.service._core.next_pk = MagicMock(return_value=7)
        self.service._core.execute_statements = MagicMock()

        created = self.service.create_menu(self.payload)

        self.assertEqual("root", created["code"])
        statement = self.service._core.execute_statements.call_args.args[0][0]
        self._assert_portable(statement)
        self.assertIn("INSERT", str(statement.compile(dialect=sqlite.dialect())))


if __name__ == "__main__":
    unittest.main()
