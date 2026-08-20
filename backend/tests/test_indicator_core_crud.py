from __future__ import annotations

import unittest
from unittest.mock import MagicMock

# pi-lens-ignore: reportMissingImports
from sqlalchemy.dialects import mysql, postgresql, sqlite

from backend.app.services.indicator_service import IndicatorService

# pyright: reportMissingImports=false


class IndicatorCoreCrudTests(unittest.TestCase):
    def setUp(self):
        self.service = IndicatorService()
        self.item = {
            "id": "CUST001",
            "name": "Customer flag",
            "meaning": "meaning",
            "resultTableName": "dws.customer",
            "resultFieldName": "flag",
            "dimension": "cus",
            "caliber": "caliber",
            "path": "CUS > flag",
            "status": "enabled",
            "registrar": "tester",
            "registeredAt": "2026-07-12",
        }
        self.service._allowed_status_values = MagicMock(return_value={"enabled", "disabled"})
        self.row = {
            "indicator_pk": 7,
            "indicator_id": "CUST001",
            "indicator_name": "Customer flag",
            "meaning_desc": "meaning",
            "result_table_name": "dws.customer",
            "result_field_name": "flag",
            "dimension_code": "cus",
            "caliber_desc": "caliber",
            "path_desc": "CUS > flag",
            "status_code": "enabled",
            "registrar_name": "tester",
            "registered_date": "2026-07-12",
        }

    def _assert_portable(self, statement):
        for dialect in (sqlite.dialect(), postgresql.dialect(), mysql.dialect()):
            with self.subTest(dialect=dialect.name):
                compiled = statement.compile(dialect=dialect)
                self.assertIn("p_indicator_", str(compiled))
                self.assertIn("__app__", str(compiled))
                self.assertNotIn("dwp.", str(compiled))

    def test_list_filters_use_bound_core_expression(self):
        self.service._db.fetch_rows = MagicMock(return_value=[self.row])

        items = self.service.get_indicators(
            keyword="Customer' OR 1=1",
            dimension="CUS",
            status="enabled",
        )

        statement = self.service._db.fetch_rows.call_args.args[0]
        self._assert_portable(statement)
        self.assertNotIn("Customer' OR 1=1", str(statement.compile(dialect=sqlite.dialect())))
        self.assertEqual(items[0]["id"], "CUST001")

    def test_create_builds_core_item_and_change_log(self):
        self.service._db.fetch_rows = MagicMock(return_value=[])
        self.service._db.next_pk = MagicMock(side_effect=[7, 8])
        self.service._db.execute_statements = MagicMock()

        self.service._create_indicator(self.item)

        statements = self.service._db.execute_statements.call_args.args[0]
        self.assertEqual(len(statements), 2)
        for statement in statements:
            self._assert_portable(statement)
        self.assertIn("INSERT", str(statements[0].compile(dialect=sqlite.dialect())))
        self.assertIn("p_indicator_change_log", str(statements[1].compile(dialect=sqlite.dialect())))

    def test_update_and_delete_use_core_mutations(self):
        self.service._db.fetch_rows = MagicMock(side_effect=[
            [{"indicator_pk": 7}],
            [self.row],
        ])
        self.service._db.next_pk = MagicMock(return_value=8)
        self.service._db.execute_statements = MagicMock()

        current, updated = self.service._update_indicator("CUST001", {**self.item, "name": "Updated"})

        self.assertEqual(current["id"], "CUST001")
        self.assertEqual(updated["name"], "Updated")
        update_statements = self.service._db.execute_statements.call_args.args[0]
        self.assertEqual(len(update_statements), 2)
        self._assert_portable(update_statements[0])
        self.assertIn("updated_at", str(update_statements[0].compile(dialect=sqlite.dialect())))

        self.service._db.fetch_rows = MagicMock(side_effect=[
            [{"indicator_pk": 7}],
            [self.row],
        ])
        self.service._db.execute_statements.reset_mock()
        self.service._delete_indicator("CUST001")
        delete_statements = self.service._db.execute_statements.call_args.args[0]
        self.assertEqual(len(delete_statements), 2)
        self._assert_portable(delete_statements[0])
        self.assertIn("is_deleted", str(delete_statements[0].compile(dialect=sqlite.dialect())))


if __name__ == "__main__":
    unittest.main()
