"""#414 report options: authoritative categories and legacy value preservation."""

import unittest
from unittest.mock import patch

from backend.app.services.report_service import (
    REPORT_TYPE_CATEGORY,
    REPORT_PERIOD_CATEGORY,
    REPORT_DATE_CALIBER_CATEGORY,
    REPORT_TIMELINESS_CATEGORY,
    DEPARTMENT_CATEGORY,
    ReportService,
)


class ReportOptionAuthorityTests(unittest.TestCase):
    def test_configured_values_and_persisted_values_are_combined(self):
        service = ReportService()
        dictionary = {
            REPORT_TYPE_CATEGORY: {"CUSTOM_TYPE"},
            REPORT_PERIOD_CATEGORY: {"P9"},
            REPORT_DATE_CALIBER_CATEGORY: {"CALIBER_CUSTOM"},
            REPORT_TIMELINESS_CATEGORY: {"T+9"},
            DEPARTMENT_CATEGORY: {"CUSTOM_DEPT"},
        }
        history = {
            "report_type": {"OLD_TYPE"},
            "freq_code": {"OLD_PERIOD"},
            "owner_dept_name": {"OLD_DEPT"},
        }
        with patch.object(service, "_allowed_code_values", side_effect=lambda category, fallback: dictionary[category]):
            with patch.object(service, "_legacy_values", side_effect=lambda column: history[column]):
                options = service.get_report_options()

        self.assertEqual(["CUSTOM_TYPE", "OLD_TYPE"], options["reportTypes"])
        self.assertEqual(["OLD_PERIOD", "P9"], options["periods"])
        self.assertEqual(["CALIBER_CUSTOM"], options["statCalibers"])
        self.assertEqual(["T+9"], options["dataDelays"])
        self.assertEqual(["CUSTOM_DEPT", "OLD_DEPT"], options["departments"])

    def test_empty_categories_are_not_replaced_by_demo(self):
        service = ReportService()
        with patch.object(service, "_allowed_code_values", return_value=set()):
            with patch.object(service, "_legacy_values", return_value=set()):
                options = service.get_report_options()
        self.assertTrue(all(not values for values in options.values()))


if __name__ == "__main__":
    unittest.main()
