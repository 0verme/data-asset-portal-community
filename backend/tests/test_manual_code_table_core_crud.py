from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from sqlalchemy.dialects import mysql, postgresql, sqlite

from backend.app.services.manual_code_table_service import ManualCodeTableService


class ManualCodeTableCoreCrudTests(unittest.TestCase):
    def setUp(self):
        self.service = ManualCodeTableService()
        self.row = {
            "table_id": 7,
            "table_code": "CUSTOMER_STATUS",
            "table_name": "Customer status",
            "table_style": "status",
            "owner_name": "tester",
            "status_code": "active",
            "remark": "remark",
            "created_by": "tester",
            "created_at": "2026-08-20 00:00:00",
            "updated_by": "tester",
            "updated_at": "2026-08-20 00:00:00",
        }
        self.item = {
            "tableCode": "CUSTOMER_STATUS",
            "tableName": "Customer status",
            "style": "status",
            "owner": "tester",
            "status": "active",
            "remark": "remark",
        }

    def _assert_portable(self, statement):
        for dialect in (sqlite.dialect(), postgresql.dialect(), mysql.dialect()):
            with self.subTest(dialect=dialect.name):
                compiled = statement.compile(dialect=dialect)
                self.assertIn("p_manual_code_table", str(compiled))
                self.assertIn("__app__", str(compiled))
                self.assertNotIn("dwp.", str(compiled))

    def test_list_filters_use_bound_core_expression(self):
        self.service._db.fetch_rows = MagicMock(return_value=[self.row])

        items = self.service.get_tables(keyword="Customer' OR 1=1", style="status")

        statement = self.service._db.fetch_rows.call_args.args[0]
        self._assert_portable(statement)
        self.assertNotIn("Customer' OR 1=1", str(statement.compile(dialect=sqlite.dialect())))
        self.assertEqual(items[0]["tableCode"], "CUSTOMER_STATUS")

    @patch("backend.app.services.manual_code_table_service.operation_log_service.audit")
    def test_create_builds_core_insert(self, audit):
        audit.return_value.__enter__.return_value = MagicMock()
        self.service._db.fetch_rows = MagicMock(side_effect=[[], [self.row]])
        self.service._db.next_pk = MagicMock(return_value=7)
        self.service._db.execute_statements = MagicMock()

        created = self.service.create_table(self.item)

        self.assertEqual(created["tableCode"], "CUSTOMER_STATUS")
        statement = self.service._db.execute_statements.call_args.args[0][0]
        self._assert_portable(statement)
        self.assertIn("INSERT", str(statement.compile(dialect=sqlite.dialect())))

    @patch("backend.app.services.manual_code_table_service.operation_log_service.audit")
    def test_update_status_and_delete_use_core_mutations(self, audit):
        audit.return_value.__enter__.return_value = MagicMock()
        self.service._db.fetch_rows = MagicMock(side_effect=[
            [self.row],
            [self.row],
            [self.row],
            [self.row],
            [self.row],
            [self.row],
        ])
        self.service._db.execute_statements = MagicMock()

        self.service.update_table("7", {**self.item, "tableName": "Updated"})
        update_statement = self.service._db.execute_statements.call_args.args[0][0]
        self._assert_portable(update_statement)

        self.service.update_status("7", "disabled")
        status_statement = self.service._db.execute_statements.call_args.args[0][0]
        self._assert_portable(status_statement)

        self.service.delete_table("7")
        delete_statement = self.service._db.execute_statements.call_args.args[0][0]
        self._assert_portable(delete_statement)
        self.assertIn("DELETE", str(delete_statement.compile(dialect=sqlite.dialect())))


if __name__ == "__main__":
    unittest.main()
