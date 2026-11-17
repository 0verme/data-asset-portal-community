from __future__ import annotations

import unittest
from unittest.mock import MagicMock

from sqlalchemy.dialects import mysql, postgresql, sqlite

from backend.app.services.indicator_service import IndicatorService


class IndicatorSourceLineageTests(unittest.TestCase):
    def setUp(self):
        self.service = IndicatorService()

    def test_details_resolve_multiple_sources_and_preserve_unavailable_ids(self):
        items = [
            {"_indicatorPk": 1, "id": "METRIC_MULTI", "sourceAssetId": None, "resultFieldId": None},
            {"_indicatorPk": 2, "id": "METRIC_EMPTY", "sourceAssetId": None, "resultFieldId": None},
            {"_indicatorPk": 3, "id": "METRIC_MISSING", "sourceAssetId": 99, "resultFieldId": 990},
        ]
        self.service._fetch_rows = MagicMock(return_value=[
            {
                "indicator_pk": 1, "source_pk": 11, "source_asset_id": 10, "source_field_id": 101,
                "source_order": 0, "source_table_name": "events", "source_qualified_name": "sales.events",
                "source_schema_name": "sales", "source_field_name": "event_id", "source_field_cn": "事件ID",
            },
            {
                "indicator_pk": 1, "source_pk": 12, "source_asset_id": 20, "source_field_id": 202,
                "source_order": 1, "source_table_name": "events", "source_qualified_name": "archive.events",
                "source_schema_name": "archive", "source_field_name": "event_id", "source_field_cn": "归档事件ID",
            },
            {
                "indicator_pk": 3, "source_pk": 31, "source_asset_id": 99, "source_field_id": 990,
                "source_order": 0, "source_table_name": None, "source_qualified_name": None,
                "source_schema_name": None, "source_field_name": None, "source_field_cn": None,
            },
        ])

        resolved = self.service._resolve_item_sources(items)

        multi, empty, missing = resolved
        self.assertEqual("configured", multi["sourceRelationsStatus"])
        self.assertEqual(2, multi["sourceCount"])
        self.assertEqual([10, 20], [source["assetId"] for source in multi["sources"]])
        self.assertEqual(["sales", "archive"], [source["schemaName"] for source in multi["sources"]])
        self.assertEqual("unconfigured", empty["sourceRelationsStatus"])
        self.assertEqual(0, empty["sourceCount"])
        self.assertEqual("unknown", missing["sourceRelationsStatus"])
        self.assertEqual(0, missing["sourceCount"])
        self.assertEqual(1, missing["sourceUnknownCount"])
        self.assertEqual(99, missing["sources"][0]["assetId"])
        self.assertEqual(990, missing["sources"][0]["fieldId"])
        self.assertEqual("unknown", missing["sources"][0]["availability"])
        self.assertNotIn("_indicatorPk", multi)

    def test_create_persists_one_stable_row_per_source(self):
        item = {
            "id": "METRIC_MULTI",
            "name": "Multi source metric",
            "meaning": "",
            "resultTableName": "events",
            "resultFieldName": "event_id",
            "sourceAssetId": 10,
            "resultFieldId": 101,
            "sources": [
                {"assetId": 10, "fieldId": 101, "availability": "available"},
                {"assetId": 20, "fieldId": 202, "availability": "available"},
            ],
            "aggregation": "SUM",
            "semanticState": "candidate",
            "dimension": "ord",
            "caliber": "",
            "caliberFormula": "",
            "caliberSql": "",
            "path": "",
            "status": "enabled",
            "registrar": "tester",
            "registeredAt": "2026-01-01",
        }
        self.service._normalize_payload = MagicMock(return_value=item)
        self.service.get_indicators = MagicMock(return_value=[])
        self.service._next_id = MagicMock(side_effect=[1, 2, 3])
        self.service._execute = MagicMock()

        self.service._create_indicator({"id": "METRIC_MULTI"})

        statements = self.service._execute.call_args.args[0]
        self.assertEqual(4, len(statements))
        source_values = [
            statement.compile(dialect=sqlite.dialect()).params
            for statement in statements
            if "p_indicator_source" in str(statement)
        ]
        self.assertEqual([(10, 101, 0), (20, 202, 1)], [
            (values["source_asset_id"], values["source_field_id"], values["source_order"])
            for values in source_values
        ])

    def test_search_uses_current_source_relations_and_formula_documentation(self):
        clauses = self.service._build_indicator_filters(keyword="sales amount")
        statement = self.service._item_statement().where(*clauses)
        for dialect in (sqlite.dialect(), postgresql.dialect(), mysql.dialect()):
            sql = str(statement.compile(dialect=dialect)).lower()
            self.assertIn("p_indicator_source", sql)
            self.assertIn("p_asset_table", sql)
            self.assertIn("p_asset_field", sql)
            self.assertIn("caliber_formula", sql)
            self.assertIn("caliber_sql", sql)
            self.assertIn("source_field_id", sql)


if __name__ == "__main__":
    unittest.main()
