from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from sqlalchemy.dialects import mysql, postgresql, sqlite

from backend.app.services.root_service import RootService


class RootCoreCrudTests(unittest.TestCase):
    def setUp(self):
        self.service = RootService()
        self.row = {
            "root_id": 7,
            "root_abbr": "customer",
            "root_en_name": "Customer",
            "root_cn_name": "客户",
            "category_name": "business",
            "root_desc": "Customer-related fields",
            "is_deleted": "N",
        }
        self.item = {
            "abbr": "customer",
            "en": "Customer",
            "cn": "客户",
            "cat": "business",
            "desc": "Customer-related fields",
        }

    def _assert_portable(self, statement):
        for dialect in (sqlite.dialect(), postgresql.dialect(), mysql.dialect()):
            with self.subTest(dialect=dialect.name):
                compiled = statement.compile(dialect=dialect)
                self.assertIn("p_root_", str(compiled))
                self.assertIn("__app__", str(compiled))
                self.assertNotIn("dwp.", str(compiled))

    def test_list_and_category_queries_use_bound_core_expressions(self):
        self.service._db.fetch_rows = MagicMock(return_value=[self.row])

        items = self.service.get_roots(keyword="Customer' OR 1=1", cat="business")

        statement = self.service._db.fetch_rows.call_args.args[0]
        self._assert_portable(statement)
        self.assertNotIn("Customer' OR 1=1", str(statement.compile(dialect=sqlite.dialect())))
        self.assertEqual(items[0]["abbr"], "customer")

        self.service._db.fetch_rows.reset_mock()
        self.service._db.fetch_rows.return_value = [{"category_name": "business", "item_count": 1}]
        self.service.get_root_categories()
        category_statement = self.service._db.fetch_rows.call_args.args[0]
        self._assert_portable(category_statement)
        self.assertIn("count", str(category_statement.compile(dialect=sqlite.dialect())).lower())

    @patch("backend.app.services.root_service.operation_log_service.audit")
    def test_create_builds_core_insert_and_change_log(self, audit):
        audit.return_value.__enter__.return_value = MagicMock()
        self.service._db.fetch_rows = MagicMock(return_value=[])
        self.service._db.next_pk = MagicMock(side_effect=[7, 11])
        self.service._db.execute_statements = MagicMock()

        created = self.service.create_root(self.item)

        self.assertEqual(created["abbr"], "customer")
        statements = self.service._db.execute_statements.call_args.args[0]
        self.assertEqual(len(statements), 2)
        for statement in statements:
            self._assert_portable(statement)
        self.assertIn("INSERT", str(statements[0].compile(dialect=sqlite.dialect())))

    @patch("backend.app.services.root_service.operation_log_service.audit")
    def test_update_and_delete_use_core_mutations(self, audit):
        audit.return_value.__enter__.return_value = MagicMock()
        self.service._db.fetch_rows = MagicMock(side_effect=[
            [{"root_id": 7}],
            [self.row],
            [{"root_id": 7}],
            [self.row],
        ])
        self.service._db.next_pk = MagicMock(side_effect=[11, 12])
        self.service._db.execute_statements = MagicMock()

        self.service.update_root("customer", {**self.item, "cn": "客户信息"})
        update_statements = self.service._db.execute_statements.call_args.args[0]
        self._assert_portable(update_statements[0])
        self.assertIn("UPDATE", str(update_statements[0].compile(dialect=sqlite.dialect())))

        self.service.delete_root("customer")
        delete_statements = self.service._db.execute_statements.call_args.args[0]
        self._assert_portable(delete_statements[0])
        self.assertIn("UPDATE", str(delete_statements[0].compile(dialect=sqlite.dialect())))


if __name__ == "__main__":
    unittest.main()
