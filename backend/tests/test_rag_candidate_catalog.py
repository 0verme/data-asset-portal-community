import unittest
from contextlib import nullcontext
from unittest.mock import patch

from sqlalchemy.dialects import sqlite

from backend.app.services.assets_service import AssetsService


class RagCandidateCatalogTests(unittest.TestCase):
    def test_batch_lookup_reads_only_active_candidate_tables_and_referenced_fields(self):
        service = AssetsService()
        calls = []
        table_rows = [
            {
                "asset_id": 1, "table_name": "CUSTOMER", "table_cn_name": "客户表",
                "schema_name": "DWS", "layer_code": "DWS", "domain_code": "SYNTH",
                "owner_name": "", "grain_desc": "", "cycle_desc": "", "table_desc": "说明",
                "field_count": 1, "domain_name": "合成域",
            },
            {
                "asset_id": 2, "table_name": "ACCOUNT", "table_cn_name": "账户表",
                "schema_name": "DWS", "layer_code": "DWS", "domain_code": "SYNTH",
                "owner_name": "", "grain_desc": "", "cycle_desc": "", "table_desc": "说明",
                "field_count": 2, "domain_name": "合成域",
            },
        ]
        field_rows = [
            {
                "field_id": 10, "asset_id": 1, "field_name": "CUSTOMER_ID",
                "field_cn_name": "客户编号", "data_type": "VARCHAR", "field_order": 1,
                "nullable_flag": "N", "pk_flag": "Y", "partition_flag": "N",
                "enum_desc": "", "field_desc": "编号",
            },
            {
                "field_id": 20, "asset_id": 2, "field_name": "BALANCE",
                "field_cn_name": "余额", "data_type": "DECIMAL", "field_order": 1,
                "nullable_flag": "Y", "pk_flag": "N", "partition_flag": "N",
                "enum_desc": "", "field_desc": "金额",
            },
            {
                "field_id": 99, "asset_id": 2, "field_name": "UNREQUESTED",
                "field_cn_name": "不应返回", "data_type": "TEXT", "field_order": 2,
                "nullable_flag": "Y", "pk_flag": "N", "partition_flag": "N",
                "enum_desc": "", "field_desc": "不应加载",
            },
        ]

        def fetch(statement, *, purpose, method):
            compiled = statement.compile(
                dialect=sqlite.dialect(),
                compile_kwargs={"render_postcompile": True},
            )
            calls.append((purpose, method, str(compiled), compiled.params))
            return table_rows if "table validation" in purpose else field_rows

        with (
            patch("backend.app.services.assets_service.database_transaction", return_value=nullcontext()),
            patch.object(service, "_fetch_rows_logged", side_effect=fetch),
        ):
            result = service.get_rag_candidate_catalog(
                [1, 2, 1, -5, True],
                {1: [10, 10], 2: [20], 99: [999]},
            )

        self.assertEqual(2, len(calls))
        self.assertEqual(["RAG candidate table validation", "RAG candidate field validation"], [call[0] for call in calls])
        self.assertEqual({"get_rag_candidate_catalog"}, {call[1] for call in calls})
        self.assertIn("p_asset_table.asset_id IN", calls[0][2])
        self.assertIn("p_asset_table.is_deleted =", calls[0][2])
        self.assertIn("p_asset_field.field_id IN", calls[1][2])
        self.assertIn("p_asset_field.is_deleted =", calls[1][2])
        self.assertEqual([1, 2], [table["assetId"] for table in result])
        self.assertEqual([10], [field["fieldId"] for field in result[0]["fields"]])
        self.assertEqual([20], [field["fieldId"] for field in result[1]["fields"]])
        self.assertNotIn(99, [field["fieldId"] for table in result for field in table["fields"]])

    def test_candidate_batches_are_rejected_before_database_access_when_oversized(self):
        service = AssetsService()
        with patch.object(service, "_fetch_rows_logged") as fetch:
            with self.assertRaisesRegex(ValueError, "bounded limit"):
                service.get_rag_candidate_catalog(list(range(1, 22)))
        fetch.assert_not_called()


if __name__ == "__main__":
    unittest.main()
