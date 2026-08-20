from __future__ import annotations

import unittest
from unittest.mock import MagicMock

# pi-lens-ignore: reportMissingImports
from sqlalchemy.dialects import mysql, postgresql, sqlite

from backend.app.services.report_service import ReportService

# pyright: reportMissingImports=false


class ReportCoreCrudTests(unittest.TestCase):
    def setUp(self):
        self.service = ReportService()
        self.item = {
            "code": "RPT_PAY_DAILY",
            "name": "Payment daily report",
            "alias": "",
            "type": "经营分析",
            "domain": "支付",
            "freq": "日",
            "statPeriod": "日",
            "statCaliber": "当日",
            "dataDelay": "T+0",
            "status": "enabled",
            "effectiveDate": "2026-07-12",
            "expireDate": "",
            "purpose": "purpose",
            "statObject": "object",
            "businessScopeTags": "scope",
            "filterCondition": "",
            "specialRule": "",
            "ownerDept": "运营管理部",
            "ownerName": "tester",
            "maintainerName": "tester",
            "relatedTables": [],
            "relatedIndicators": [],
            "remark": "remark",
        }
        self.row = {
            "report_code": "RPT_PAY_DAILY",
            "report_name": "Payment daily report",
            "report_alias": "",
            "report_type": "经营分析",
            "domain_name": "支付",
            "freq_code": "日",
            "stat_period_code": "日",
            "date_caliber_code": "当日",
            "data_timeliness_code": "T+0",
            "status_code": "enabled",
            "owner_dept_name": "运营管理部",
            "owner_name": "tester",
            "related_tables_json": [],
            "related_indicators_json": [],
        }
        self.service._allowed_status_values = MagicMock(return_value={"enabled", "disabled"})
        self.service._allowed_code_values = MagicMock(
            side_effect=lambda category, fallback: {
                "REPORT_TYPE": {"经营分析"},
                "REPORT_STAT_PERIOD": {"日"},
                "UPSTREAM_DEPT": {"运营管理部"},
            }.get(category, set(fallback))
        )
        self.service._legacy_values = MagicMock(return_value=set())
        self.service._domain_names = MagicMock(return_value={"支付"})
        self.service._asset_lookup = MagicMock(return_value={})
        self.service._indicator_lookup = MagicMock(return_value={})

    def _assert_portable(self, statement):
        for dialect in (sqlite.dialect(), postgresql.dialect(), mysql.dialect()):
            with self.subTest(dialect=dialect.name):
                compiled = statement.compile(dialect=dialect)
                self.assertIn("p_report_asset", str(compiled))
                self.assertIn("__app__", str(compiled))
                self.assertNotIn("dwp.", str(compiled))

    def test_list_filters_use_bound_core_expression(self):
        self.service._db.fetch_rows = MagicMock(return_value=[self.row])

        items = self.service.get_reports(
            keyword="Payment' OR 1=1",
            report_type="经营分析",
            domain="支付",
            status="enabled",
            owner_dept="运营管理部",
        )

        statement = self.service._db.fetch_rows.call_args.args[0]
        self._assert_portable(statement)
        self.assertNotIn("Payment' OR 1=1", str(statement.compile(dialect=sqlite.dialect())))
        self.assertEqual(items[0]["code"], "RPT_PAY_DAILY")

    def test_create_builds_core_insert(self):
        self.service._db.fetch_rows = MagicMock(side_effect=[[], [self.row]])
        self.service._db.next_pk = MagicMock(return_value=7)
        self.service._db.execute_statements = MagicMock()

        created = self.service._create_report(self.item)

        self.assertEqual(created["code"], "RPT_PAY_DAILY")
        statement = self.service._db.execute_statements.call_args.args[0][0]
        self._assert_portable(statement)
        self.assertIn("INSERT", str(statement.compile(dialect=sqlite.dialect())))

    def test_update_and_delete_use_core_mutations(self):
        self.service._db.fetch_rows = MagicMock(side_effect=[[self.row], [{"report_pk": 7}], [self.row]])
        self.service._db.execute_statements = MagicMock()

        current, updated = self.service._update_report(
            "RPT_PAY_DAILY", {**self.item, "name": "Updated report"}
        )

        self.assertEqual(current["code"], "RPT_PAY_DAILY")
        self.assertEqual(updated["code"], "RPT_PAY_DAILY")
        update_statement = self.service._db.execute_statements.call_args.args[0][0]
        self._assert_portable(update_statement)
        self.assertIn("updated_at", str(update_statement.compile(dialect=sqlite.dialect())))

        self.service._db.fetch_rows = MagicMock(side_effect=[[{"report_pk": 7}], [self.row]])
        self.service._db.execute_statements.reset_mock()
        self.service._delete_report("RPT_PAY_DAILY")
        delete_statement = self.service._db.execute_statements.call_args.args[0][0]
        self._assert_portable(delete_statement)
        self.assertIn("is_deleted", str(delete_statement.compile(dialect=sqlite.dialect())))


if __name__ == "__main__":
    unittest.main()
