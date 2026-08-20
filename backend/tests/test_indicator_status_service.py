import unittest
from unittest.mock import MagicMock, patch

from sqlalchemy.dialects import sqlite

from backend.app.services.indicator_service import IndicatorService, IndicatorValidationError

# pyright: reportMissingImports=false


class IndicatorStatusUpdateTestCase(unittest.TestCase):
    def setUp(self):
        self.service = IndicatorService()
        self.current = {
            "id": "CUST001", "name": "Customer flag", "meaning": "meaning",
            "resultTableName": "dws.customer", "resultFieldName": "flag",
            "dimension": "cus", "caliber": "caliber", "path": "CUS > flag",
            "status": "enabled", "registrar": "tester", "registeredAt": "2026-07-12",
        }
        self.service.get_indicator_detail = MagicMock(return_value=self.current)
        self.service._fetch_rows = MagicMock(return_value=[{"indicator_pk": 3}])
        self.service._next_id = MagicMock(return_value=9)
        self.service._execute = MagicMock()

    def test_status_update_only_changes_status_column(self):
        audit = MagicMock()
        audit.__enter__.return_value = audit
        audit.__exit__.return_value = False
        with patch.object(self.service, "_allowed_status_values", return_value={"enabled", "disabled"}), \
                patch("backend.app.services.indicator_service.operation_log_service.audit", return_value=audit):
            result = self.service.patch_status("CUST001", "disabled")

        statements = self.service._execute.call_args.args[0]
        compiled = statements[0].compile(dialect=sqlite.dialect())
        self.assertIn("UPDATE __app__.p_indicator_item", str(compiled))
        self.assertIn("status_code", compiled.params)
        self.assertEqual(compiled.params["status_code"], "disabled")
        self.assertNotIn("indicator_name", str(compiled))
        self.assertEqual(result["status"], "disabled")
        self.assertEqual(result["name"], self.current["name"])

    def test_invalid_status_is_rejected_before_update(self):
        with patch.object(self.service, "_allowed_status_values", return_value={"enabled", "disabled"}), \
                self.assertRaises(IndicatorValidationError):
            self.service.patch_status("CUST001", "archived")
        self.service._execute.assert_not_called()


if __name__ == "__main__":
    unittest.main()
