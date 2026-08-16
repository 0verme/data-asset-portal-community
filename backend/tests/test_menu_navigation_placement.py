import re
import unittest
from pathlib import Path

from backend.app.services.system_management_service import SystemManagementService, SystemValidationError
from backend.tests.db_test_support import DOCS_DWS, DOCS_PG, read_sql


class MenuNavigationPlacementTests(unittest.TestCase):
    def test_payload_defaults_to_more_and_rejects_invalid_placement(self):
        service = SystemManagementService()
        payload = {"code": "report", "name": "Report", "status": "enabled"}

        self.assertEqual(service._normalize_menu_payload(payload)["navPlacement"], "more")
        with self.assertRaises(SystemValidationError) as error:
            service._normalize_menu_payload({**payload, "navPlacement": "sidebar"})
        self.assertEqual(error.exception.details[0]["field"], "navPlacement")

    def test_pg_and_dws_initial_schema_define_current_navigation_layout(self):
        expected_primary = {"upstream", "dwm", "mapping", "lineage", "indicator"}
        expected_present = expected_primary | {
            "root", "report", "apiAsset", "push", "codeTable", "system",
        }
        for docs, suffix in ((DOCS_PG, "pg"), (DOCS_DWS, "dws")):
            sql = read_sql(docs / f"menus-app-{suffix}-ddl.sql")
            for code in expected_present:
                self.assertIn(f"'{code}'", sql)
            for code in expected_primary:
                self.assertRegex(
                    sql,
                    re.compile(rf"'{re.escape(code)}'[\s\S]{{0,220}}'primary'", re.I),
                )


if __name__ == "__main__":
    unittest.main()
