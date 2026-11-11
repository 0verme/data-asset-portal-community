from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from sqlalchemy.dialects import mysql, postgresql, sqlite

from backend.app.services.manual_code_table_service import (
    ManualCodeTableService,
    ManualCodeTableValidationError,
    TABLE_STATUSES,
)


class ManualCodeTableCoreCrudTests(unittest.TestCase):
    def setUp(self):
        self.service = ManualCodeTableService()
        self.row = {
            "table_id": 7,
            "table_code": "CUSTOMER_STATUS",
            "table_name": "Customer status",
            "table_style": "status",
            "owner_name": "tester",
            "status_code": "enabled",
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
            "status": "enabled",
            "remark": "remark",
        }

    def test_binary_status_contract_rejects_legacy_values(self):
        self.assertEqual({"enabled", "disabled"}, TABLE_STATUSES)
        self.assertEqual("enabled", self.service._normalize_payload({**self.item, "status": None})["status"])
        for status in ("active", "draft", "inactive"):
            with self.subTest(status=status), self.assertRaises(ManualCodeTableValidationError):
                self.service._normalize_payload({**self.item, "status": status})

    def _assert_portable(self, statement):
        for dialect in (sqlite.dialect(), postgresql.dialect(), mysql.dialect()):
            with self.subTest(dialect=dialect.name):
                compiled = statement.compile(dialect=dialect)
                self.assertIn("p_manual_code_table", str(compiled))
                self.assertIn("__app__", str(compiled))
                self.assertNotIn("dwp.", str(compiled))

    def test_paginated_table_list_has_filtered_count_and_global_statistics(self):
        stats = {"total": 10, "enabled": 7, "disabled": 3, "styleCount": 4}
        self.service._db.fetch_rows = MagicMock(side_effect=[
            [{"total": 3}], [self.row], [stats],
            [{"value": "status", "count": 4}, {"value": "enum", "count": 2}],
            [{"value": "enabled", "count": 5}, {"value": "disabled", "count": 2}],
        ])

        result = self.service.get_tables_page(
            keyword="customer", style="status", status="enabled", page="2", page_size="1"
        )

        self.assertEqual((3, 2, 1), (result["total"], result["page"], result["pageSize"]))
        self.assertEqual(stats, result["stats"])
        self.assertEqual(["CUSTOMER_STATUS"], [item["tableCode"] for item in result["items"]])
        count_statement, page_statement, stats_statement, style_facet_statement, status_facet_statement = [
            call.args[0] for call in self.service._db.fetch_rows.call_args_list
        ]
        for statement in (count_statement, page_statement, stats_statement, style_facet_statement, status_facet_statement):
            self._assert_portable(statement)
        for statement in (count_statement, page_statement):
            compiled = str(statement.compile(dialect=sqlite.dialect()))
            self.assertIn("table_style", compiled)
            self.assertIn("status_code", compiled)
            self.assertIn("table_name", compiled)
        page_sql = str(page_statement.compile(dialect=sqlite.dialect())).upper()
        self.assertIn("LIMIT", page_sql)
        self.assertIn("OFFSET", page_sql)
        style_facet_sql = str(style_facet_statement.compile(dialect=sqlite.dialect()))
        status_facet_sql = str(status_facet_statement.compile(dialect=sqlite.dialect()))
        self.assertIn("status_code", style_facet_sql)
        self.assertIn("table_style", status_facet_sql)
        self.assertEqual({"styleTotal": 6, "styles": {"status": 4, "enum": 2}, "statusTotal": 7,
                          "statuses": {"enabled": 5, "disabled": 2}}, result["facets"])

    def test_legacy_list_remains_complete_without_database_limit(self):
        self.service._db.fetch_rows = MagicMock(return_value=[self.row, {**self.row, "table_id": 8, "table_code": "ORDER_STATUS"}])

        self.assertEqual(2, len(self.service.get_tables()))
        statement = self.service._db.fetch_rows.call_args.args[0]
        self._assert_portable(statement)
        self.assertNotIn("LIMIT", str(statement.compile(dialect=sqlite.dialect())).upper())

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
        self.service._db.fetch_rows = MagicMock(side_effect=[[self.row]] * 10)
        self.service._db.execute_statements = MagicMock()

        self.service.update_table("7", {**self.item, "tableName": "Updated"})
        update_statement = self.service._db.execute_statements.call_args.args[0][0]
        self._assert_portable(update_statement)

        self.service.update_status("7", "enabled")
        enable_statement = self.service._db.execute_statements.call_args.args[0][0]
        self._assert_portable(enable_statement)
        self.assertEqual("启用", audit.call_args_list[1].kwargs["operation_type"])

        self.service.update_status("7", "disabled")
        disable_statement = self.service._db.execute_statements.call_args.args[0][0]
        self._assert_portable(disable_statement)
        self.assertEqual("禁用", audit.call_args_list[2].kwargs["operation_type"])

        self.service.delete_table("7")
        delete_statement = self.service._db.execute_statements.call_args.args[0][0]
        self._assert_portable(delete_statement)
        self.assertIn("DELETE", str(delete_statement.compile(dialect=sqlite.dialect())))


if __name__ == "__main__":
    unittest.main()
