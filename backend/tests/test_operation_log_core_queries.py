from __future__ import annotations

import unittest
from unittest.mock import MagicMock

from sqlalchemy.dialects import mysql, postgresql, sqlite

from backend.app.services.operation_log_service import OperationLogService


class OperationLogCoreQueryTests(unittest.TestCase):
    def test_log_page_and_detail_are_bound_core_queries(self):
        service = OperationLogService()
        row = {
            "id": 2,
            "module_name": "root",
            "operation_type": "UPDATE",
            "result_status": "success",
            "created_at": "2026-08-20 00:00:00",
            "cost_time_ms": 0,
        }
        service._db.fetch_rows = MagicMock(side_effect=[[{"total": 1}], [row]])
        result = service.get_logs({"keyword": "root' OR 1=1", "page": 1, "pageSize": 10})
        statements = [call.args[0] for call in service._db.fetch_rows.call_args_list]
        for statement in statements:
            for dialect in (sqlite.dialect(), postgresql.dialect(), mysql.dialect()):
                compiled = statement.compile(dialect=dialect)
                self.assertIn("p_operation_log", str(compiled))
                self.assertIn("__app__", str(compiled))
                self.assertNotIn("dwp.", str(compiled))
        self.assertNotIn("root' OR 1=1", str(statements[1].compile(dialect=sqlite.dialect())))
        self.assertEqual(result["total"], 1)


if __name__ == "__main__":
    unittest.main()
