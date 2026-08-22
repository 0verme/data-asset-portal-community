"""Contract tests for the native FastAPI API wire format."""

# pyright: reportMissingImports=false

from __future__ import annotations

import unittest
from unittest.mock import MagicMock

from backend.app.application import Identity
from backend.app.contracts import (
    AssetPageResponse,
    ErrorEnvelope,
    IndicatorItem,
    IndicatorListResponse,
    ReportListResponse,
    ReportRequest,
    validate_contract,
)
from backend.app.core.capabilities import resolve_capabilities
from backend.app.fastapi_app import create_fastapi_app
from fastapi.testclient import TestClient


class ApiContractTests(unittest.TestCase):
    def setUp(self):
        self.report_service = MagicMock()
        self.indicator_service = MagicMock()
        self.assets_service = MagicMock()
        self.app = create_fastapi_app(
            capabilities=resolve_capabilities(edition="private"),
            identity_resolver=lambda _request: Identity("admin", "admin", "Admin"),
            report_service_instance=self.report_service,
            indicator_service_instance=self.indicator_service,
            assets_service_instance=self.assets_service,
        )
        self.client = TestClient(self.app)

    def test_report_success_keeps_legacy_and_nullable_wire_fields(self):
        payload = {
            "code": "R1",
            "name": "Report",
            "legacyFreq": "日",
            "legacyTimeCaliber": "自然日",
            "dateCaliber": "自然日",
            "dataTimeliness": "T+1",
            "relatedTables": [],
            "relatedIndicators": [],
            "remark": None,
        }
        original = {"items": [payload]}
        returned = validate_contract(original, ReportListResponse)
        self.assertIs(original, returned)
        self.assertEqual(
            "日", ReportListResponse.model_validate(returned).items[0].legacyFreq
        )
        self.assertIsNone(ReportListResponse.model_validate(returned).items[0].remark)

    def test_report_request_accepts_missing_fields_and_legacy_extra_fields(self):
        request = ReportRequest.model_validate({"code": "R1", "legacyFreq": "日"})
        self.assertEqual("R1", request.code)
        self.assertIsNone(request.relatedTables)
        self.assertEqual("日", request.model_extra["legacyFreq"])

    def test_native_report_route_output_is_declared_contract(self):
        self.report_service.get_reports.return_value = [
            {"code": "R1", "name": "Report"}
        ]
        response = self.client.get("/api/reports")
        self.assertEqual(200, response.status_code)
        self.assertIsInstance(
            ReportListResponse.model_validate(response.json()), ReportListResponse
        )

    def test_native_indicator_route_output_is_declared_contract(self):
        self.indicator_service.get_indicators.return_value = [
            {"id": "I1", "name": "Indicator"}
        ]
        response = self.client.get("/api/indicators")
        self.assertEqual(200, response.status_code)
        contract = IndicatorListResponse.model_validate(response.json())
        self.assertIsInstance(contract.items[0], IndicatorItem)

    def test_asset_summary_contract_preserves_pagination_shape(self):
        page = {
            "items": [{"name": "T1", "fieldCount": 0, "fields": []}],
            "page": 2,
            "pageSize": 20,
            "total": 21,
        }
        self.assets_service.get_asset_table_page.return_value = page
        response = self.client.get("/api/assets/tables?summary=true&page=2")
        self.assertEqual(200, response.status_code)
        self.assertEqual(2, AssetPageResponse.model_validate(response.json()).page)
        self.assertEqual(21, response.json()["total"])

    def test_anonymous_auth_failure_uses_existing_error_contract(self):
        app = create_fastapi_app(
            capabilities=resolve_capabilities(edition="community"),
            identity_resolver=lambda _request: None,
        )
        response = TestClient(app).get("/api/auth/me")
        contract = ErrorEnvelope.model_validate(response.json())
        self.assertEqual(401, response.status_code)
        self.assertEqual("UNAUTHORIZED", contract.error.code)


if __name__ == "__main__":
    unittest.main()
