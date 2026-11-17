# pyright: reportMissingImports=false
# pi-lens-ignore: I001
from __future__ import annotations

import unittest
from unittest.mock import patch

# pi-lens-ignore: reportMissingImports
from sqlalchemy import select  # pyright: ignore[reportMissingImports]
# pi-lens-ignore: reportMissingImports
from sqlalchemy.dialects import mysql, postgresql, sqlite  # pyright: ignore[reportMissingImports]

# pi-lens-ignore: reportMissingImports
from backend.app.db.tables import asset_domain, asset_table  # pyright: ignore[reportMissingImports]
# pi-lens-ignore: reportMissingImports
from backend.app.services.assets_service import AssetsService  # pyright: ignore[reportMissingImports]


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

    def test_asset_and_field_projections_keep_stable_ids(self):
        table = self.service._to_asset_table(
            {
                "asset_id": 7,
                "table_name": "orders",
                "table_cn_name": "订单表",
                "schema_name": "warehouse_a",
                "layer_code": "DWM",
                "owner_name": None,
                "grain_desc": None,
                "cycle_desc": None,
                "table_desc": None,
                "field_count": 0,
                "active_field_count": 1,
            },
            [{"fieldId": 8, "assetId": 7, "name": "amount"}],
        )
        self.assertEqual(7, table["assetId"])
        self.assertEqual(8, table["fields"][0]["fieldId"])
        self.assertEqual(7, table["fields"][0]["assetId"])
        self.assertEqual(1, table["fieldCount"])
        self.assertEqual("warehouse_a", table["schema"])

    def test_asset_projection_distinguishes_zero_and_unknown_counts(self):
        row = {
            "asset_id": 7,
            "table_name": "orders",
            "table_cn_name": "订单表",
            "schema_name": "",
            "layer_code": "DWD",
            "field_count": 12,
        }
        self.service._default_schema_prefix = ""

        zero = self.service._to_asset_table({**row, "active_field_count": 0}, [])
        unknown = self.service._to_asset_table(row, [])

        self.assertEqual(0, zero["fieldCount"])
        self.assertIsNone(unknown["fieldCount"])
        self.assertEqual("", unknown["schema"])

    def test_asset_creation_does_not_infer_schema_without_explicit_configuration(self):
        self.service._default_schema_prefix = ""
        with (
            patch.object(self.service, "_load_domain_mappings", return_value=({}, {"交易": "D01"})),
            patch.object(self.service, "get_layers", return_value=[{"code": "DWD"}]),
        ):
            table = self.service._validate_table_payload({
                "name": "DWD_TRADE_ORDER",
                "cn": "订单表",
                "domain": "交易",
                "layer": "DWD",
                "fields": [{
                    "name": "order_id", "cn": "订单号", "type": "integer",
                    "nullable": False, "pk": True, "part": False,
                }],
            })

        self.assertEqual("", table["schema"])

    def test_configured_schema_prefix_remains_an_explicit_fallback(self):
        self.service._default_schema_prefix = "warehouse_"
        self.assertEqual("warehouse_DWD", self.service._normalize_layer_schema("DWD"))

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

    def test_read_description_preserves_presence_independently_of_cn(self):
        base = {
            "asset_id": 7, "field_id": 8, "field_name": "amount", "field_cn_name": "中文名称",
            "data_type": "DECIMAL", "nullable_flag": "Y", "pk_flag": "N", "partition_flag": "N",
            "enum_desc": None,
        }
        for extra in ({}, {"field_desc": None}, {"field_desc": ""}, {"field_desc": "source description"}):
            with self.subTest(extra=extra), patch.object(self.service, "_fetch_rows", return_value=[{**base, **extra}]):
                field = self.service._load_field_rows([7])[7][0]
                self.assertEqual("中文名称", field["cn"])
                self.assertEqual("field_desc" in extra, "description" in field)
                if "field_desc" in extra:
                    self.assertEqual(extra["field_desc"], field["description"])

    def test_queries_compile_for_supported_sqlalchemy_dialects(self):
        statement = (
            select(asset_table, self.service._active_field_count_expression())
            .select_from(asset_table)
            .where(asset_table.c.table_name == "orders")
            .limit(10)
        )

        dialects = (
            ("sqlite", sqlite.dialect()),
            ("postgresql", postgresql.dialect()),
            ("mysql", mysql.dialect()),
            ("dws", postgresql.dialect(paramstyle="qmark")),
        )
        for name, dialect in dialects:
            with self.subTest(dialect=name):
                compiled = statement.compile(dialect=dialect)
                self.assertIn("p_asset_table", str(compiled))
                self.assertIn("p_asset_field", str(compiled))
                self.assertIn("is_deleted", str(compiled))
                self.assertNotIn("dwp.", str(compiled))
                self.assertIn("orders", compiled.params.values())
                self.assertIn("N", compiled.params.values())

    def test_ordering_and_pagination_are_core_expressions(self):
        ordering = self.service._normalize_asset_order("updated_at desc")
        statement = select(asset_table).order_by(*ordering).limit(20).offset(40)
        compiled = statement.compile(dialect=sqlite.dialect())

        self.assertIn("ORDER BY __app__.p_asset_table.updated_at DESC", str(compiled))
        self.assertIn("LIMIT ? OFFSET ?", str(compiled))
        self.assertEqual({"param_1": 20, "param_2": 40}, compiled.params)


if __name__ == "__main__":
    unittest.main()
