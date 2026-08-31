from __future__ import annotations

import unittest
from unittest.mock import MagicMock

from sqlalchemy.dialects import mysql, postgresql, sqlite

from backend.app.services.field_mapping_service import FieldMappingService


class FieldMappingCoreQueryTests(unittest.TestCase):
    def setUp(self):
        self.service = FieldMappingService()
        self.field_row = {
            "upstream_system_id": 3,
            "system_code": "CRM",
            "system_name": "CRM",
            "system_abbr": "mysql",
            "source_table_name": "customer",
            "source_table_cn": "客户",
            "target_layer_code": "DWF",
            "target_table_name": "dwf_customer",
            "load_mode": "full",
            "source_field_name": "customer_id",
            "source_field_type": "varchar",
            "source_field_comment": "identifier",
            "target_field_name": "customer_id",
            "mapping_rule": "direct",
            "updated_at": "2026-08-20 00:00:00",
        }
        self.table_row = {
            "upstream_system_id": 3,
            "system_code": "CRM",
            "system_name": "CRM",
            "system_abbr": "mysql",
            "source_table_name": "customer",
            "source_table_cn": "客户",
            "target_layer_code": "DWF",
            "target_table_name": "dwf_customer",
            "load_mode": "full",
            "field_count": 2,
            "mapped_count": 1,
            "empty_comment_count": 0,
            "updated_at": "2026-08-20 00:00:00",
        }

    def _assert_portable(self, statement):
        for dialect in (sqlite.dialect(), postgresql.dialect(), mysql.dialect()):
            with self.subTest(dialect=dialect.name):
                compiled = statement.compile(dialect=dialect)
                self.assertIn("p_field_mapping", str(compiled))
                self.assertIn("p_data_source", str(compiled))
                self.assertIn("p_upstream_system", str(compiled))
                self.assertIn("__app__", str(compiled))
                self.assertNotIn("dwp.", str(compiled))

    def test_field_page_uses_core_select_and_bound_filters(self):
        self.service._db.fetch_rows = MagicMock(side_effect=[[{"total": 1}], [self.field_row]])

        result = self.service._get_field_mappings(
            {"keyword": "customer' OR 1=1", "page": 1, "pageSize": 10}
        )

        statements = [call.args[0] for call in self.service._db.fetch_rows.call_args_list]
        for statement in statements:
            self._assert_portable(statement)
        self.assertNotIn("customer' OR 1=1", str(statements[1].compile(dialect=sqlite.dialect())))
        self.assertEqual(result["items"][0]["srcField"], "customer_id")

    def test_source_system_filter_uses_upstream_primary_key(self):
        self.service._db.fetch_rows = MagicMock(return_value=[{
            "source_system_count": 1,
            "source_table_count": 1,
            "field_count": 1,
            "mapped_field_count": 1,
            "empty_comment_count": 0,
        }])

        self.service.get_stats({"sourceSystemId": "103"})
        statement = self.service._db.fetch_rows.call_args.args[0]
        compiled = str(statement.compile(dialect=sqlite.dialect()))
        self.assertIn("p_upstream_system.system_pk", compiled)
        self.assertNotRegex(compiled, r"p_data_source\.source_id\s*=\s*[?:%]")

    def test_stats_and_table_page_use_core_aggregates(self):
        self.service._db.fetch_rows = MagicMock(return_value=[{
            "source_system_count": 1,
            "source_table_count": 1,
            "field_count": 2,
            "mapped_field_count": 1,
            "empty_comment_count": 1,
        }])
        stats = self.service.get_stats({"srcSystem": "CRM"})
        stats_statement = self.service._db.fetch_rows.call_args.args[0]
        self._assert_portable(stats_statement)
        self.assertEqual(stats["coverage"], 50)

        self.service._stats_cache.clear()
        self.service._db.fetch_rows = MagicMock(side_effect=[[{"total": 1}], [self.table_row]])
        result = self.service._get_table_mappings({"page": 1, "pageSize": 10})
        statements = [call.args[0] for call in self.service._db.fetch_rows.call_args_list]
        for statement in statements:
            self._assert_portable(statement)
        self.assertEqual(result["items"][0]["fieldCount"], 2)


if __name__ == "__main__":
    unittest.main()
