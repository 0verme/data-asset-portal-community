from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from sqlalchemy.dialects import mysql, postgresql, sqlite

from backend.app.services.system_management_service import SystemManagementService


class SystemUserCoreCrudTests(unittest.TestCase):
    def setUp(self):
        self.service = SystemManagementService()
        self.row = {
            "id": 7,
            "username": "admin",
            "display_name": "Administrator",
            "status": "ACTIVE",
            "role": "admin",
            "last_login_at": None,
            "created_at": "2026-08-20 00:00:00",
        }
        self.payload = {
            "username": "admin",
            "displayName": "Administrator",
            "status": "enabled",
            "role": "admin",
        }

    def _assert_portable(self, statement):
        for dialect in (sqlite.dialect(), postgresql.dialect(), mysql.dialect()):
            with self.subTest(dialect=dialect.name):
                compiled = statement.compile(dialect=dialect)
                self.assertIn("p_admin_user", str(compiled))
                self.assertIn("__app__", str(compiled))
                self.assertNotIn("dwp.", str(compiled))

    def test_user_list_uses_core_expression_and_bound_filters(self):
        self.service._core.fetch_rows = MagicMock(return_value=[self.row])

        users = self.service.get_users()

        statement = self.service._core.fetch_rows.call_args.args[0]
        self._assert_portable(statement)
        self.assertEqual("admin", users[0]["username"])

    @patch("backend.app.services.system_management_service.operation_log_service.audit")
    def test_create_and_status_update_use_core_mutations(self, audit):
        audit.return_value.__enter__.return_value = MagicMock()
        self.service._core.fetch_rows = MagicMock(side_effect=[[], [self.row]])
        self.service._core.next_pk = MagicMock(return_value=7)
        self.service._core.execute_statements = MagicMock()

        created = self.service.create_user(self.payload)

        self.assertEqual("admin", created["username"])
        insert_statement = self.service._core.execute_statements.call_args.args[0][0]
        self._assert_portable(insert_statement)
        self.assertIn("INSERT", str(insert_statement.compile(dialect=sqlite.dialect())))

        self.service._core.fetch_rows = MagicMock(side_effect=[
            [self.row],
            [self.row],
            [{"count": 1}],
            [self.row],
        ])
        self.service.update_user_status("admin", "disabled")
        update_statement = self.service._core.execute_statements.call_args.args[0][0]
        self._assert_portable(update_statement)
        self.assertIn("UPDATE", str(update_statement.compile(dialect=sqlite.dialect())))


if __name__ == "__main__":
    unittest.main()
