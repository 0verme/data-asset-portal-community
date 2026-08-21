"""Contract tests for the framework-neutral API wire format."""

from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from backend.app import create_app
from backend.app.contracts import (
    AssetPageResponse,
    ErrorEnvelope,
    IndicatorItem,
    IndicatorListResponse,
    ReportListResponse,
    ReportRequest,
    validate_contract,
)


class ApiContractTests(unittest.TestCase):
    def setUp(self):
        self._old_secret = os.environ.get("FLASK_SECRET_KEY")
        os.environ["FLASK_SECRET_KEY"] = "test-contracts"
        self.addCleanup(self._restore_secret)

    def _restore_secret(self):
        if self._old_secret is None:
            os.environ.pop("FLASK_SECRET_KEY", None)
        else:
            os.environ["FLASK_SECRET_KEY"] = self._old_secret

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

    def test_flask_report_route_output_is_declared_contract(self):
        app = create_app()
        app.config.update(TESTING=True)
        with patch(
            "backend.app.services.report_service.report_service.get_reports",
            return_value=[{"code": "R1", "name": "Report"}],
        ):
            response = app.test_client().get("/api/reports")
        self.assertEqual(200, response.status_code)
        self.assertIsInstance(
            ReportListResponse.model_validate(response.get_json()), ReportListResponse
        )

    def test_flask_indicator_route_output_is_declared_contract(self):
        app = create_app()
        app.config.update(TESTING=True)
        with patch(
            "backend.app.services.indicator_service.indicator_service.get_indicators",
            return_value=[{"id": "I1", "name": "Indicator"}],
        ):
            response = app.test_client().get("/api/indicators")
        self.assertEqual(200, response.status_code)
        contract = IndicatorListResponse.model_validate(response.get_json())
        self.assertIsInstance(contract.items[0], IndicatorItem)

    def test_asset_summary_contract_preserves_pagination_shape(self):
        app = create_app()
        app.config.update(TESTING=True)
        page = {
            "items": [{"name": "T1", "fieldCount": 0, "fields": []}],
            "page": 2,
            "pageSize": 20,
            "total": 21,
        }
        with patch(
            "backend.app.services.assets_service.assets_service.get_asset_table_page",
            return_value=page,
        ):
            response = app.test_client().get("/api/assets/tables?summary=true&page=2")
        self.assertEqual(200, response.status_code)
        self.assertEqual(2, AssetPageResponse.model_validate(response.get_json()).page)
        self.assertEqual(21, response.get_json()["total"])

    def test_auth_failure_uses_existing_error_contract(self):
        app = create_app()
        app.config.update(TESTING=True)
        response = app.test_client().get("/api/auth/me")
        contract = ErrorEnvelope.model_validate(response.get_json())
        self.assertEqual(401, response.status_code)
        self.assertEqual("UNAUTHORIZED", contract.error.code)


if __name__ == "__main__":
    unittest.main()
