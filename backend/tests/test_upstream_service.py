import unittest
from unittest.mock import MagicMock, patch

from sqlalchemy.dialects import mysql, postgresql, sqlite

from backend.app.services.upstream_service import UpstreamService


class UpstreamStatusUpdateTestCase(unittest.TestCase):
    def test_status_update_does_not_require_or_rewrite_connection_metadata(self):
        service = UpstreamService()
        public_detail = {
            "id": "up_aml",
            "abbr": "AML",
            "name": "AML system",
            "dbType": "PostgreSQL",
            "unloadTimes": ["23:00"],
            "status": "enabled",
            "owner": "system",
            "dept": "Core Systems",
            "desc": "",
        }
        service.get_system_detail = MagicMock(return_value=public_detail)
        service._fetch_rows_logged = MagicMock(return_value=[{"system_pk": 7}])
        service._next_id = MagicMock(return_value=11)
        service._execute = MagicMock()

        audit = MagicMock()
        audit.__enter__.return_value = audit
        audit.__exit__.return_value = False
        with patch.object(service, "_get_allowed_status_values", return_value={"enabled", "disabled"}), \
                patch("backend.app.services.upstream_service.operation_log_service.audit", return_value=audit):
            result = service.patch_status("up_aml", "disabled")

        service.get_system_detail.assert_called_once_with("up_aml")
        statements = service._execute.call_args.args[0]
        status_statement = str(statements[0].compile(dialect=sqlite.dialect()))
        self.assertIn("p_upstream_system", status_statement)
        self.assertIn("status_code", status_statement)
        self.assertNotIn("host_name", status_statement)
        self.assertFalse(any("DELETE" in str(statement.compile(dialect=sqlite.dialect())) for statement in statements))
        for dialect in (sqlite.dialect(), postgresql.dialect(), mysql.dialect()):
            for statement in statements:
                statement.compile(dialect=dialect)
        self.assertEqual(result["status"], "disabled")


if __name__ == "__main__":
    unittest.main()
