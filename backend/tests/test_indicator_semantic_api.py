"""FastAPI wire-contract coverage for additive indicator semantics."""

# pyright: reportMissingImports=false
from __future__ import annotations

import unittest
from unittest.mock import MagicMock

from backend.app.application import Identity
from backend.app.contracts import IndicatorItem, IndicatorListResponse, IndicatorRequest
from backend.app.core.capabilities import resolve_capabilities
from backend.app.fastapi_app import create_fastapi_app
from backend.app.services.indicator_service import IndicatorValidationError
from fastapi.testclient import TestClient

INDICATOR = {
    "id": "ORD001",
    "name": "订单金额",
    "meaning": "有效订单的金额汇总",
    "resultTableName": "DWS_ORDER_SUMMARY",
    "resultFieldName": "sales_amount",
    "sourceAssetId": 10,
    "sourceAssetName": "DWS_ORDER_SUMMARY",
    "sourceAssetQualifiedName": "sales.DWS_ORDER_SUMMARY",
    "resultFieldId": 20,
    "aggregation": "SUM",
    "semanticState": "candidate",
    "dimension": "ord",
    "caliber": "有效订单",
    "path": "ORD > 销售分析",
    "status": "enabled",
    "registrar": "tester",
    "registeredAt": "2026-08-01",
}


class IndicatorSemanticApiTests(unittest.TestCase):
    def setUp(self):
        self.indicators = MagicMock()
        self.app = create_fastapi_app(
            capabilities=resolve_capabilities(),
            identity_resolver=lambda _request: Identity("admin", "admin", "Admin"),
            indicator_service_instance=self.indicators,
        )
        self.client = TestClient(self.app)

    def test_request_contract_accepts_camel_and_legacy_snake_aliases(self):
        request = IndicatorRequest.model_validate(
            {
                "id": "ORD001",
                "source_asset_id": 10,
                "result_field_id": 20,
                "aggregation_code": "SUM",
                "semantic_state": "candidate",
            }
        )
        self.assertEqual(10, request.sourceAssetId)
        self.assertEqual(20, request.resultFieldId)
        self.assertEqual("SUM", request.aggregation)
        self.assertEqual("candidate", request.semanticState)

    def test_list_and_detail_return_stable_references_additively(self):
        self.indicators.get_indicators.return_value = [INDICATOR]
        self.indicators.get_indicator_detail.return_value = INDICATOR

        listing = self.client.get("/api/indicators")
        detail = self.client.get("/api/indicators/ORD001")

        self.assertEqual(200, listing.status_code)
        self.assertEqual(200, detail.status_code)
        self.assertIsInstance(
            IndicatorListResponse.model_validate(listing.json()), IndicatorListResponse
        )
        self.assertEqual(10, listing.json()["items"][0]["sourceAssetId"])
        self.assertEqual(20, detail.json()["data"]["resultFieldId"])
        self.assertEqual("DWS_ORDER_SUMMARY", detail.json()["data"]["resultTableName"])
        self.assertIsInstance(IndicatorItem.model_validate(detail.json()["data"]), IndicatorItem)

    def test_create_and_update_round_trip_semantic_payload(self):
        self.indicators.create_indicator.return_value = INDICATOR
        self.indicators.update_indicator.return_value = {**INDICATOR, "aggregation": "AVG"}
        payload = {
            "id": "ORD001",
            "name": "订单金额",
            "meaning": "有效订单的金额汇总",
            "sourceAssetId": 10,
            "resultFieldId": 20,
            "aggregation": "SUM",
            "semanticState": "candidate",
            "dimension": "ord",
            "caliber": "有效订单",
            "path": "ORD > 销售分析",
            "status": "enabled",
            "registrar": "tester",
            "registeredAt": "2026-08-01",
        }

        created = self.client.post("/api/indicators", json=payload)
        updated = self.client.put(
            "/api/indicators/ORD001", json={**payload, "aggregation": "AVG"}
        )

        self.assertEqual(201, created.status_code)
        self.assertEqual(200, updated.status_code)
        self.assertEqual(10, self.indicators.create_indicator.call_args.args[0]["sourceAssetId"])
        self.assertEqual(20, self.indicators.update_indicator.call_args.args[1]["resultFieldId"])
        self.assertEqual("AVG", updated.json()["data"]["aggregation"])

    def test_validation_error_uses_existing_error_contract(self):
        self.indicators.create_indicator.side_effect = IndicatorValidationError(
            [{"field": "resultFieldId", "message": "result field does not exist: 99"}]
        )
        response = self.client.post("/api/indicators", json={"id": "ORD001"})
        self.assertEqual(422, response.status_code)
        self.assertEqual("INDICATOR_VALIDATION_FAILED", response.json()["error"]["code"])
        self.assertEqual("resultFieldId", response.json()["error"]["details"][0]["field"])


if __name__ == "__main__":
    unittest.main()
