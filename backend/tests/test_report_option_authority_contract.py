"""#414 report options: authoritative categories and legacy value preservation."""

import os
import unittest
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from backend.app.application.identity import Identity
from backend.app.authorization.core import (
    AuthorizationDecision,
    AuthorizationService,
    AuthorizationSubject,
)
from backend.app.fastapi_app import create_fastapi_app
from backend.app.services.common_code_service import (
    CommonCodeDataSourceError,
    common_code_service,
)
from backend.app.services.report_service import (
    REPORT_TYPE_CATEGORY,
    REPORT_PERIOD_CATEGORY,
    REPORT_DATE_CALIBER_CATEGORY,
    REPORT_TIMELINESS_CATEGORY,
    DEPARTMENT_CATEGORY,
    ReportDataSourceError,
    ReportService,
)


class ReportOptionAuthorityTests(unittest.TestCase):
    def test_authoritative_options_are_available_without_historical_reports(self):
        service = ReportService()
        dictionary = {
            REPORT_TYPE_CATEGORY: {"CUSTOM_TYPE"},
            REPORT_PERIOD_CATEGORY: {"P9"},
            REPORT_DATE_CALIBER_CATEGORY: {"CALIBER_CUSTOM"},
            REPORT_TIMELINESS_CATEGORY: {"T+9"},
            DEPARTMENT_CATEGORY: {"CUSTOM_DEPT"},
        }
        with patch.object(service, "_allowed_code_values", side_effect=lambda category, fallback: dictionary[category]):
            with patch.object(service, "_legacy_values", return_value=set()):
                options = service.get_report_options()

        self.assertEqual(["CUSTOM_TYPE"], options["reportTypes"])
        self.assertEqual(["P9"], options["periods"])
        self.assertEqual(["CALIBER_CUSTOM"], options["statCalibers"])
        self.assertEqual(["T+9"], options["dataDelays"])
        self.assertEqual(["CUSTOM_DEPT"], options["departments"])

    def test_configured_and_historical_values_are_sorted_and_deduplicated(self):
        service = ReportService()
        dictionary = {
            REPORT_TYPE_CATEGORY: {"CUSTOM_TYPE", "SHARED_TYPE"},
            REPORT_PERIOD_CATEGORY: {"P9", "SHARED_PERIOD"},
            REPORT_DATE_CALIBER_CATEGORY: {"CALIBER_CUSTOM"},
            REPORT_TIMELINESS_CATEGORY: {"T+9"},
            DEPARTMENT_CATEGORY: {"CUSTOM_DEPT", "SHARED_DEPT"},
        }
        history = {
            "report_type": {"OLD_TYPE", "SHARED_TYPE"},
            "freq_code": {"OLD_PERIOD", "SHARED_PERIOD"},
            "owner_dept_name": {"OLD_DEPT", "SHARED_DEPT"},
        }
        with patch.object(service, "_allowed_code_values", side_effect=lambda category, fallback: dictionary[category]):
            with patch.object(service, "_legacy_values", side_effect=lambda column: history[column]):
                options = service.get_report_options()

        self.assertEqual(["CUSTOM_TYPE", "OLD_TYPE", "SHARED_TYPE"], options["reportTypes"])
        self.assertEqual(["OLD_PERIOD", "P9", "SHARED_PERIOD"], options["periods"])
        self.assertEqual(["CALIBER_CUSTOM"], options["statCalibers"])
        self.assertEqual(["T+9"], options["dataDelays"])
        self.assertEqual(["CUSTOM_DEPT", "OLD_DEPT", "SHARED_DEPT"], options["departments"])

    def test_empty_categories_are_not_replaced_by_demo(self):
        service = ReportService()
        with patch.object(service, "_allowed_code_values", return_value=set()):
            with patch.object(service, "_legacy_values", return_value=set()):
                options = service.get_report_options()
        self.assertTrue(all(not values for values in options.values()))

    def test_dictionary_outage_is_an_error_not_an_empty_options_response(self):
        service = ReportService()
        with patch.object(
            common_code_service,
            "get_item_values",
            side_effect=CommonCodeDataSourceError("isolated dictionary outage"),
        ):
            with self.assertRaises(ReportDataSourceError):
                service.get_report_options()

    def test_all_option_reads_use_the_selected_asset_database_profile(self):
        selected_profile = "report_options_profile"
        with patch.dict(os.environ, {"ASSET_DB_PROFILE": selected_profile}):
            service = ReportService()
        with patch.object(common_code_service, "_db_profile", selected_profile):
            common_code_service.invalidate()
            observed_profiles = []

            def fetch_from_profile(profile, _statement):
                observed_profiles.append(profile)
                return [], []

            try:
                with patch("backend.app.db.service.fetch_all_core", side_effect=fetch_from_profile):
                    options = service.get_report_options()
            finally:
                common_code_service.invalidate()

        self.assertTrue(all(not values for values in options.values()))
        self.assertTrue(observed_profiles)
        self.assertEqual({selected_profile}, set(observed_profiles))

    @staticmethod
    def _authorized_client(report_service):
        subject = AuthorizationSubject("report-editor", "report_editor")
        authenticated = AuthorizationDecision(
            authenticated=True,
            allowed=True,
            subject=subject,
            reason="authenticated",
        )
        authorization = MagicMock(spec=AuthorizationService)
        authorization.repository = MagicMock()
        authorization.authenticate.return_value = authenticated
        authorization.authorize.return_value = AuthorizationDecision(
            authenticated=True,
            allowed=True,
            permission="report:write",
            subject=subject,
            reason="permission_granted",
        )
        app = create_fastapi_app(
            identity_resolver=lambda _request: Identity(
                "report_editor", "report-editor", "Report Editor"
            ),
            authorization_service_instance=authorization,
            report_service_instance=report_service,
        )
        return TestClient(app), authorization

    def test_report_writer_can_load_options_and_create_a_report(self):
        report_service = MagicMock()
        report_service.get_report_options.return_value = {
            "reportTypes": ["CLIMATE_SUMMARY"],
            "periods": ["P7"],
            "statCalibers": ["source_event"],
            "dataDelays": ["T+9"],
            "departments": ["North region"],
        }
        report_service.create_report.return_value = {
            "code": "RPT_CLIMATE_001",
            "name": "Climate summary",
        }
        client, authorization = self._authorized_client(report_service)

        options = client.get("/api/reports/options")
        created = client.post(
            "/api/reports",
            json={"code": "RPT_CLIMATE_001", "name": "Climate summary"},
        )

        self.assertEqual(200, options.status_code)
        self.assertEqual(["CLIMATE_SUMMARY"], options.json()["options"]["reportTypes"])
        self.assertEqual(201, created.status_code)
        self.assertEqual("RPT_CLIMATE_001", created.json()["data"]["code"])
        self.assertEqual(
            ["report:write", "report:write"],
            [call.args[1] for call in authorization.authorize.call_args_list],
        )

    def test_report_options_datasource_failure_returns_service_error(self):
        report_service = MagicMock()
        report_service.get_report_options.side_effect = ReportDataSourceError(
            "报表字典数据源暂不可用"
        )
        client, _authorization = self._authorized_client(report_service)

        response = client.get("/api/reports/options")

        self.assertEqual(503, response.status_code)
        self.assertEqual(
            "REPORT_DATA_SOURCE_ERROR", response.json()["error"]["code"]
        )


if __name__ == "__main__":
    unittest.main()
