from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from sqlalchemy.dialects import mysql, postgresql, sqlite

from backend.app.services.system_management_service import SystemManagementService


class SystemDictionaryCoreCrudTests(unittest.TestCase):
    def setUp(self):
        self.service = SystemManagementService()
        self.row = {
            "item_id": 7,
            "category_code": "SYSTEM_STATUS",
            "category_name": "System status",
            "item_code": "ACTIVE",
            "item_name": "Active",
            "item_value": "ACTIVE",
            "item_desc": "Enabled status",
            "is_active": "Y",
            "updated_at": "2026-08-20 00:00:00",
        }
        self.item = {
            "categoryCode": "SYSTEM_STATUS",
            "code": "ACTIVE",
            "name": "Active",
            "value": "ACTIVE",
            "status": "enabled",
            "desc": "Enabled status",
        }

    def _assert_portable(self, statement):
        for dialect in (sqlite.dialect(), postgresql.dialect(), mysql.dialect()):
            with self.subTest(dialect=dialect.name):
                compiled = statement.compile(dialect=dialect)
                self.assertIn("p_code_", str(compiled))
                self.assertIn("__app__", str(compiled))
                self.assertNotIn("dwp.", str(compiled))

    def test_dictionary_list_uses_core_join_and_bound_filter(self):
        self.service._core.fetch_rows = MagicMock(return_value=[self.row])

        items = self.service.get_param_dicts("SYSTEM_STATUS")

        statement = self.service._core.fetch_rows.call_args.args[0]
        self._assert_portable(statement)
        self.assertEqual("ACTIVE", items[0]["code"])

    @patch("backend.app.services.system_management_service.operation_log_service.audit")
    def test_create_and_status_update_use_core_mutations(self, audit):
        audit.return_value.__enter__.return_value = MagicMock()
        self.service._core.fetch_rows = MagicMock(side_effect=[
            [{"category_id": 1}],
            [],
            [self.row],
        ])
        self.service._core.next_pk = MagicMock(return_value=7)
        self.service._core.execute_statements = MagicMock()

        created = self.service.create_param_dict(self.item)

        self.assertEqual("ACTIVE", created["code"])
        insert_statement = self.service._core.execute_statements.call_args.args[0][0]
        self._assert_portable(insert_statement)
        self.assertIn("INSERT", str(insert_statement.compile(dialect=sqlite.dialect())))

        self.service._core.fetch_rows = MagicMock(side_effect=[[self.row], [self.row]])
        self.service.update_param_dict_status("7", "disabled")
        update_statement = self.service._core.execute_statements.call_args.args[0][0]
        self._assert_portable(update_statement)
        self.assertIn("UPDATE", str(update_statement.compile(dialect=sqlite.dialect())))


if __name__ == "__main__":
    unittest.main()
