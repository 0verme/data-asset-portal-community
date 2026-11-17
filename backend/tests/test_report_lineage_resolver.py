from __future__ import annotations

import unittest
from unittest.mock import MagicMock

from backend.app.services.report_service import ReportService


class ReportLineageResolverTests(unittest.TestCase):
    def setUp(self):
        self.service = ReportService()
        self.service._indicator_lookup = MagicMock(return_value={
            "METRIC_MULTI": {"indicatorId": "METRIC_MULTI", "indicatorName": "Multi", "dimension": "ord", "path": "ORD"},
            "METRIC_EMPTY": {"indicatorId": "METRIC_EMPTY", "indicatorName": "Empty", "dimension": "ord", "path": "ORD"},
        })
        self.service._indicator_source_rows = MagicMock(return_value={
            "METRIC_MULTI": [
                {"relationId": 301, "assetId": 30, "fieldId": 300, "sourceOrder": 0},
                {"relationId": 302, "assetId": 99, "fieldId": 990, "sourceOrder": 1},
            ],
        })
        self.service._field_lookup = MagicMock(return_value={
            300: {"field_id": 300, "asset_id": 30, "field_name": "event_id", "field_cn_name": "事件ID", "is_deleted": "N"},
        })
        assets = {
            10: {"assetId": 10, "tableName": "events", "schemaName": "sales", "qualifiedName": "sales.events"},
            20: {"assetId": 20, "tableName": "events", "schemaName": "archive", "qualifiedName": "archive.events"},
            30: {"assetId": 30, "tableName": "events", "schemaName": "warehouse", "qualifiedName": "warehouse.events"},
        }
        self.service._asset_lookup = MagicMock(side_effect=lambda ids=None: (
            {asset_id: assets[asset_id] for asset_id in (ids or ()) if asset_id in assets},
            {},
        ))

    def _report_item(self):
        return {
            "code": "RPT_GENERIC",
            "relatedTables": [
                {"assetId": 10, "tableName": "old_name"},
                {"assetId": 20, "tableName": "events"},
                {"assetId": 10, "tableName": "duplicate"},
                {"assetId": 77, "tableName": "deleted_events"},
                {"tableName": "legacy_unknown"},
            ],
            "relatedIndicators": [
                {"indicatorId": "METRIC_MULTI"},
                {"indicatorId": "METRIC_EMPTY"},
                {"indicatorId": "METRIC_DELETED", "indicatorName": "Deleted"},
            ],
        }

    def test_list_and_detail_resolution_counts_stable_ids_and_metric_sources(self):
        report = self._report_item()

        detail = self.service._resolve_item_relations([report.copy()])[0]
        listed = self.service._resolve_item_relations([report.copy()])[0]

        self.assertEqual(detail, listed)
        self.assertEqual(2, detail["relatedTableCount"])
        self.assertEqual(2, detail["relatedTableUnknownCount"])
        self.assertEqual("partial", detail["relatedTablesStatus"])
        self.assertEqual([10, 20, 77, None], [table.get("assetId") for table in detail["relatedTables"]])
        self.assertEqual(["sales", "archive"], [table["schemaName"] for table in detail["relatedTables"][:2]])
        self.assertEqual(2, detail["relatedIndicatorCount"])
        self.assertEqual(1, detail["relatedIndicatorUnknownCount"])
        metrics = {item["indicatorId"]: item for item in detail["relatedIndicators"]}
        self.assertEqual("partial", metrics["METRIC_MULTI"]["sourceRelationsStatus"])
        self.assertEqual(1, metrics["METRIC_MULTI"]["sourceCount"])
        self.assertEqual(1, metrics["METRIC_MULTI"]["sourceUnknownCount"])
        self.assertEqual("warehouse.events", metrics["METRIC_MULTI"]["sources"][0]["qualifiedName"])
        self.assertEqual(300, metrics["METRIC_MULTI"]["sources"][0]["fieldId"])
        self.assertEqual("unconfigured", metrics["METRIC_EMPTY"]["sourceRelationsStatus"])
        self.assertEqual("unknown", metrics["METRIC_DELETED"]["availability"])
        self.assertFalse(metrics["METRIC_DELETED"].get("sources"))
        requested_asset_ids = self.service._asset_lookup.call_args.args[0]
        self.assertEqual({10, 20, 30, 77, 99}, requested_asset_ids)

    def test_unconfigured_report_relations_are_not_reported_as_unknown(self):
        report = self.service._resolve_item_relations([{
            "relatedTables": [],
            "relatedIndicators": [],
        }])[0]

        self.assertEqual(0, report["relatedTableCount"])
        self.assertEqual(0, report["relatedIndicatorCount"])
        self.assertEqual("unconfigured", report["relatedTablesStatus"])
        self.assertEqual("unconfigured", report["relatedIndicatorsStatus"])


if __name__ == "__main__":
    unittest.main()
