from __future__ import annotations

import unittest
from unittest.mock import MagicMock

from sqlalchemy.dialects import mysql, postgresql, sqlite

from backend.app.services.api_asset_service import ApiAssetService


class ApiAssetCoreCrudTests(unittest.TestCase):
    def setUp(self):
        self.service = ApiAssetService()
        self.system_row = {"system_id": 3}
        self.asset_row = {
            "api_pk": 7,
            "api_code": "ORDER_QUERY",
            "api_name": "Order query",
            "method_code": "GET",
            "path_text": "/orders",
            "version_text": "v1",
            "system_id": 3,
            "downstream_system_id": None,
            "api_type": "query",
            "status_code": "enabled",
            "owner_dept_name": "Data",
            "owner_name": "Tester",
            "maintainer_name": "Maintainer",
            "description_text": "Order query API",
            "remark_desc": "",
            "updated_by": "tester",
            "updated_at": "2026-08-20 00:00:00",
            "system_code": "ORDER",
            "system_name": "Order system",
            "system_abbr": "order",
            "system_type": "business",
        }
        self.payload = {
            "code": "ORDER_QUERY",
            "name": "Order query",
            "method": "GET",
            "path": "/orders",
            "version": "v1",
            "systemId": 3,
            "type": "query",
            "status": "enabled",
            "ownerDept": "Data",
            "ownerName": "Tester",
            "maintainerName": "Maintainer",
            "description": "Order query API",
            "remark": "",
        }

    def _assert_portable(self, statement):
        for dialect in (sqlite.dialect(), postgresql.dialect(), mysql.dialect()):
            with self.subTest(dialect=dialect.name):
                compiled = statement.compile(dialect=dialect)
                self.assertIn("p_api_", str(compiled))
                self.assertIn("__app__", str(compiled))
                self.assertNotIn("dwp.", str(compiled))

    def test_list_and_child_queries_use_bound_core_expressions(self):
        self.service._db.fetch_rows = MagicMock(side_effect=[
            [self.asset_row],
            [],
            [],
            [],
        ])

        items = self.service.get_assets(keyword="Order' OR 1=1", status="enabled")

        statements = [call.args[0] for call in self.service._db.fetch_rows.call_args_list]
        for statement in statements:
            self._assert_portable(statement)
        self.assertNotIn("Order' OR 1=1", str(statements[0].compile(dialect=sqlite.dialect())))
        self.assertEqual(items[0]["code"], "ORDER_QUERY")

    def test_core_insert_and_replace_rows_are_parameterized(self):
        item = self.service._validate_asset
        self.service._db.fetch_rows = MagicMock(return_value=[self.system_row])
        normalized = item(self.payload)
        statement = self.service._insert_asset(normalized, 7)
        self._assert_portable(statement)
        self.assertNotIn("Order query", str(statement.compile(dialect=sqlite.dialect())))

        row_statement = self.service._insert_asset(normalized, 7)
        self._assert_portable(row_statement)

    def test_status_and_soft_delete_build_core_updates(self):
        update_statement = self.service._build_status_statement("ORDER_QUERY", "disabled")
        delete_statement = self.service._build_delete_statement("ORDER_QUERY")
        self._assert_portable(update_statement)
        self._assert_portable(delete_statement)
        self.assertIn("UPDATE", str(update_statement.compile(dialect=sqlite.dialect())))


if __name__ == "__main__":
    unittest.main()
