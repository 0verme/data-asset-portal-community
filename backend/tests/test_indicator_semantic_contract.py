"""Deterministic indicator semantic validation and service contract tests."""

from __future__ import annotations

import unittest
from typing import Any
from unittest.mock import MagicMock

# pi-lens-ignore: reportMissingImports
from sqlalchemy.dialects import mysql, postgresql, sqlite  # pyright: ignore[reportMissingImports]

from backend.app.services.indicator_service import (
    IndicatorService,
    IndicatorValidationError,
)
from backend.app.services.semantic_validator import validate_indicator_semantics

BASE_PAYLOAD = {
    "id": "ORD001",
    "name": "订单金额",
    "meaning": "有效订单的金额汇总",
    "resultTableName": "legacy.orders",
    "resultFieldName": "legacy_amount",
    "dimension": "ord",
    "caliber": "有效订单",
    "path": "ORD > 销售分析",
    "status": "enabled",
    "registrar": "tester",
    "registeredAt": "2026-08-01",
}

ASSET_ROW = {
    "asset_id": 10,
    "table_name": "DWS_ORDER_SUMMARY",
    "qualified_name": "sales.DWS_ORDER_SUMMARY",
    "is_deleted": "N",
}
FIELD_ROW = {
    "field_id": 20,
    "asset_id": 10,
    "field_name": "sales_amount",
    "is_deleted": "N",
}


class SemanticValidatorTests(unittest.TestCase):
    def test_valid_contract_normalizes_values(self):
        result = validate_indicator_semantics(
            source_asset_id="10",
            result_field_id=20,
            aggregation="sum",
            semantic_state="CERTIFIED",
            status="enabled",
            asset=ASSET_ROW,
            field=FIELD_ROW,
        )
        self.assertTrue(result.valid)
        self.assertEqual(10, result.source_asset_id)
        self.assertEqual(20, result.result_field_id)
        self.assertEqual("SUM", result.aggregation)
        self.assertEqual("certified", result.semantic_state)

    def test_field_only_reference_infers_parent_asset(self):
        result = validate_indicator_semantics(
            result_field_id=20,
            semantic_state="candidate",
            status="disabled",
            asset=ASSET_ROW,
            field=FIELD_ROW,
        )
        self.assertTrue(result.valid)
        self.assertEqual(10, result.source_asset_id)

    def test_mismatched_asset_and_field_is_rejected(self):
        result = validate_indicator_semantics(
            source_asset_id=11,
            result_field_id=20,
            asset={**ASSET_ROW, "asset_id": 11},
            field=FIELD_ROW,
            status="enabled",
        )
        self.assertFalse(result.valid)
        self.assertTrue(any(item["field"] == "resultFieldId" for item in result.errors))

    def test_missing_or_deleted_references_are_rejected(self):
        missing_asset = validate_indicator_semantics(
            source_asset_id=10,
            asset=None,
            status="enabled",
        )
        deleted_field = validate_indicator_semantics(
            result_field_id=20,
            asset=ASSET_ROW,
            field={**FIELD_ROW, "is_deleted": "Y"},
            status="enabled",
        )
        self.assertFalse(missing_asset.valid)
        self.assertFalse(deleted_field.valid)
        self.assertTrue(
            any(item["field"] == "sourceAssetId" for item in missing_asset.errors)
        )
        self.assertTrue(
            any(item["field"] == "resultFieldId" for item in deleted_field.errors)
        )

    def test_invalid_aggregation_lifecycle_and_status_are_rejected(self):
        result = validate_indicator_semantics(
            aggregation="SUM(CASE WHEN x THEN 1 END)",
            semantic_state="draft",
            status="archived",
        )
        self.assertFalse(result.valid)
        self.assertEqual(
            {"aggregation", "semanticState", "status"},
            {item["field"] for item in result.errors},
        )


class IndicatorSemanticServiceTests(unittest.TestCase):
    def setUp(self):
        self.service: Any = IndicatorService()
        self.service._allowed_status_values = MagicMock(
            return_value={"enabled", "disabled"}
        )
        self.service._resolve_semantic_asset = MagicMock(return_value=ASSET_ROW)
        self.service._resolve_semantic_field = MagicMock(return_value=FIELD_ROW)

    def test_create_stable_references_refresh_legacy_snapshots(self):
        payload = {
            **BASE_PAYLOAD,
            "sourceAssetId": 10,
            "resultFieldId": 20,
            "resultTableName": "wrong_table",
            "resultFieldName": "wrong_field",
            "aggregation": "sum",
        }
        item = self.service._normalize_payload(payload)
        self.assertEqual(10, item["sourceAssetId"])
        self.assertEqual(20, item["resultFieldId"])
        self.assertEqual("SUM", item["aggregation"])
        self.assertEqual("DWS_ORDER_SUMMARY", item["resultTableName"])
        self.assertEqual("sales_amount", item["resultFieldName"])
        self.assertEqual("sales.DWS_ORDER_SUMMARY", item["sourceAssetQualifiedName"])

    def test_field_only_reference_is_deterministically_inferred(self):
        item = self.service._normalize_payload(
            {**BASE_PAYLOAD, "resultFieldId": 20, "sourceAssetId": None}
        )
        self.assertEqual(10, item["sourceAssetId"])
        self.assertEqual(20, item["resultFieldId"])
        self.service._resolve_semantic_asset.assert_called_once_with(10)

    def test_missing_asset_field_and_mismatched_field_fail(self):
        self.service._resolve_semantic_asset.return_value = None
        with self.assertRaises(IndicatorValidationError) as missing_asset:
            self.service._normalize_payload({**BASE_PAYLOAD, "sourceAssetId": 99})
        self.assertTrue(
            any(
                item["field"] == "sourceAssetId"
                for item in missing_asset.exception.details
            )
        )

        self.service._resolve_semantic_asset.return_value = ASSET_ROW
        self.service._resolve_semantic_field.return_value = None
        with self.assertRaises(IndicatorValidationError) as missing_field:
            self.service._normalize_payload(
                {**BASE_PAYLOAD, "sourceAssetId": 10, "resultFieldId": 99}
            )
        self.assertTrue(
            any(
                item["field"] == "resultFieldId"
                for item in missing_field.exception.details
            )
        )

        self.service._resolve_semantic_field.return_value = {
            **FIELD_ROW,
            "asset_id": 11,
        }
        with self.assertRaises(IndicatorValidationError) as mismatch:
            self.service._normalize_payload(
                {**BASE_PAYLOAD, "sourceAssetId": 10, "resultFieldId": 20}
            )
        self.assertTrue(
            any("belong" in item["message"] for item in mismatch.exception.details)
        )

    def test_invalid_aggregation_and_semantic_state_fail(self):
        with self.assertRaises(IndicatorValidationError) as error:
            self.service._normalize_payload(
                {
                    **BASE_PAYLOAD,
                    "aggregation": "sum(case when x then 1 end)",
                    "semanticState": "draft",
                }
            )
        self.assertEqual(
            {"aggregation", "semanticState"},
            {item["field"] for item in error.exception.details},
        )

    def test_legacy_payload_remains_compatible_without_stable_references(self):
        self.service._resolve_semantic_asset.reset_mock()
        self.service._resolve_semantic_field.reset_mock()
        item = self.service._normalize_payload(BASE_PAYLOAD)
        self.assertIsNone(item["sourceAssetId"])
        self.assertIsNone(item["resultFieldId"])
        self.assertIsNone(item["aggregation"])
        self.assertEqual("candidate", item["semanticState"])
        self.service._resolve_semantic_asset.assert_not_called()
        self.service._resolve_semantic_field.assert_not_called()

    def test_update_preserves_omitted_stable_fields_and_allows_explicit_clearing(self):
        current = {
            **BASE_PAYLOAD,
            "sourceAssetId": 10,
            "sourceAssetName": ASSET_ROW["table_name"],
            "sourceAssetQualifiedName": ASSET_ROW["qualified_name"],
            "resultFieldId": 20,
            "aggregation": "SUM",
            "semanticState": "candidate",
        }
        preserved = self.service._normalize_payload(
            {**BASE_PAYLOAD, "name": "更新后的订单金额"},
            defaults=current,
        )
        self.assertEqual(10, preserved["sourceAssetId"])
        self.assertEqual(20, preserved["resultFieldId"])
        self.assertEqual("SUM", preserved["aggregation"])

        cleared = self.service._normalize_payload(
            {
                **BASE_PAYLOAD,
                "sourceAssetId": None,
                "resultFieldId": None,
                "aggregation": None,
            },
            defaults=current,
        )
        self.assertIsNone(cleared["sourceAssetId"])
        self.assertIsNone(cleared["resultFieldId"])
        self.assertIsNone(cleared["aggregation"])

    def test_insert_statement_contains_portable_semantic_columns(self):
        item = self.service._normalize_payload(
            {
                **BASE_PAYLOAD,
                "sourceAssetId": 10,
                "resultFieldId": 20,
                "aggregation": "AVG",
            }
        )
        statement = self.service._insert_item(item, 1)
        for dialect in (sqlite.dialect(), postgresql.dialect(), mysql.dialect()):
            compiled = statement.compile(dialect=dialect)
            with self.subTest(dialect=dialect.name):
                self.assertIn("source_asset_id", str(compiled))
                self.assertIn("result_field_id", str(compiled))
                self.assertEqual(10, compiled.params["source_asset_id"])
                self.assertEqual(20, compiled.params["result_field_id"])

    def test_read_contract_preserves_legacy_fields_and_exposes_semantic_fields(self):
        row = {
            "indicator_id": "ORD001",
            "indicator_name": "订单金额",
            "meaning_desc": "有效订单的金额汇总",
            "result_table_name": "legacy.orders",
            "result_field_name": "legacy_amount",
            "source_asset_id": None,
            "result_field_id": None,
            "aggregation_code": None,
            "semantic_state": None,
            "dimension_code": "ord",
            "caliber_desc": "有效订单",
            "path_desc": "ORD > 销售分析",
            "status_code": "disabled",
            "registrar_name": "tester",
            "registered_date": "2026-08-01",
        }
        item = self.service._row_to_item(row)
        self.assertEqual("legacy.orders", item["resultTableName"])
        self.assertEqual("legacy_amount", item["resultFieldName"])
        self.assertIsNone(item["sourceAssetId"])
        self.assertEqual("candidate", item["semanticState"])
        self.assertEqual("disabled", item["status"])


if __name__ == "__main__":
    unittest.main()
