from __future__ import annotations

import unittest
from unittest.mock import patch

from sqlalchemy import select
from sqlalchemy.dialects import mysql, postgresql, sqlite

from backend.app.db.tables import asset_domain, asset_table
from backend.app.services.assets_service import AssetsService


class AssetsCoreCrudTests(unittest.TestCase):
    def setUp(self):
        self.service = AssetsService()

    def test_dynamic_filters_compile_with_bound_parameters(self):
        with patch.object(
            self.service,
            "_load_domain_mappings",
            return_value=({"D01": "客户域"}, {"客户域": "D01"}),
        ):
            clauses, _ = self.service._build_asset_filters(
                keyword="订单' OR 1=1",
                domain="客户域",
                owner="owner",
            )

        statement = select(asset_table).select_from(
            asset_table.outerjoin(asset_domain, asset_domain.c.domain_code == asset_table.c.domain_code)
        )
        compiled = statement.where(*clauses).compile(dialect=sqlite.dialect())

        self.assertIn("p_asset_table", str(compiled))
        self.assertNotIn("dwp.", str(compiled))
        self.assertNotIn("订单' OR 1=1", str(compiled))
        params_text = " ".join(str(value) for value in compiled.params.values()).lower()
        self.assertIn("订单' or 1=1", params_text)

    def test_create_field_and_change_log_use_core_insert_statements(self):
        fields = [
            {"name": "order_id", "cn": "订单编号", "type": "string", "nullable": False, "pk": True, "part": False},
            {"name": "amount", "cn": "金额", "type": "decimal", "nullable": True, "pk": False, "part": False},
        ]
        with patch.object(self.service, "_get_next_id", return_value=10):
            field_statements = self.service._insert_db_fields(7, fields)
            change_statement = self.service._insert_change_log(
                7,
                "orders",
                "CREATE_TABLE",
                None,
                {"name": "orders", "owner": "owner"},
            )

        compiled_fields = [str(statement.compile(dialect=sqlite.dialect())) for statement in field_statements]
        compiled_change = change_statement.compile(dialect=sqlite.dialect())

        self.assertEqual(2, len(field_statements))
        self.assertTrue(all("INSERT INTO __app__.p_asset_field" in sql for sql in compiled_fields))
        self.assertIn("INSERT INTO __app__.p_asset_change_log", str(compiled_change))
        self.assertNotIn("orders", str(compiled_change))
        self.assertNotIn("owner", str(compiled_change))

    def test_queries_compile_for_supported_sqlalchemy_dialects(self):
        statement = select(asset_table).where(asset_table.c.table_name == "orders").limit(10)

        for dialect in (sqlite.dialect(), postgresql.dialect(), mysql.dialect()):
            with self.subTest(dialect=dialect.name):
                compiled = statement.compile(dialect=dialect)
                self.assertIn("p_asset_table", str(compiled))
                self.assertNotIn("dwp.", str(compiled))
                self.assertIn("orders", compiled.params.values())

    def test_ordering_and_pagination_are_core_expressions(self):
        ordering = self.service._normalize_asset_order("updated_at desc")
        statement = select(asset_table).order_by(*ordering).limit(20).offset(40)
        compiled = statement.compile(dialect=sqlite.dialect())

        self.assertIn("ORDER BY __app__.p_asset_table.updated_at DESC", str(compiled))
        self.assertIn("LIMIT ? OFFSET ?", str(compiled))
        self.assertEqual({"param_1": 20, "param_2": 40}, compiled.params)


if __name__ == "__main__":
    unittest.main()
