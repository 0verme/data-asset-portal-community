"""Issue #414: dictionary outages must not silently authorize defaults."""

import unittest
from unittest.mock import patch

from backend.app.services.common_code_service import CommonCodeDataSourceError
from backend.app.services.upstream_service import UpstreamDataSourceError, UpstreamService
from backend.app.services.push_service import PushDataSourceError, PushService
from backend.app.services.report_service import ReportDataSourceError, ReportService


class DictionaryOutageContractTests(unittest.TestCase):
    def test_upstream_dynamic_department_rejects_outage(self):
        service = UpstreamService()
        with patch("backend.app.services.upstream_service.common_code_service.get_items",
                   side_effect=CommonCodeDataSourceError("unavailable")):
            with self.assertRaises(UpstreamDataSourceError):
                service._get_option_contract("UPSTREAM_DEPT", {"DEMO": "demo"})

    def test_push_frequency_rejects_outage(self):
        service = PushService()
        with patch("backend.app.services.push_service.common_code_service.get_item_values",
                   side_effect=CommonCodeDataSourceError("unavailable")):
            with self.assertRaises(PushDataSourceError):
                service._get_allowed_values("FREQ_TYPE", {"T+1"})

    def test_report_type_rejects_outage(self):
        service = ReportService()
        with patch("backend.app.services.report_service.common_code_service.get_item_values",
                   side_effect=CommonCodeDataSourceError("unavailable")):
            with self.assertRaises(ReportDataSourceError):
                service._allowed_code_values("REPORT_TYPE", {"经营分析"})


if __name__ == "__main__":
    unittest.main()
