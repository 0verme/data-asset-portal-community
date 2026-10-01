import json
import unittest
from pathlib import Path

from backend.app.navigation.persistence import DEFAULT_MENUS
from backend.app.services.system_management_service import SystemManagementService, SystemValidationError


REPO_ROOT = Path(__file__).resolve().parents[2]


class MenuNavigationPlacementTests(unittest.TestCase):
    def test_payload_defaults_to_more_and_rejects_invalid_placement(self):
        service = SystemManagementService()
        payload = {"code": "report", "name": "Report", "status": "enabled"}

        self.assertEqual(service._normalize_menu_payload(payload)["navPlacement"], "more")
        with self.assertRaises(SystemValidationError) as error:
            service._normalize_menu_payload({**payload, "navPlacement": "sidebar"})
        self.assertEqual(error.exception.details[0]["field"], "navPlacement")

    def test_canonical_manifest_defines_the_eleven_default_menu_contract(self):
        manifest = json.loads((REPO_ROOT / "config" / "default-menus.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest, list(DEFAULT_MENUS))
        self.assertEqual(11, len(manifest))
        primary_codes = {menu["code"] for menu in manifest if menu["navPlacement"] == "primary"}
        self.assertEqual({"upstream", "dwm", "mapping", "lineage", "indicator"}, primary_codes)
        self.assertTrue(all(menu["status"] == "enabled" for menu in manifest))
        self.assertTrue(next(menu for menu in manifest if menu["code"] == "system")["adminOnly"])

    def test_old_postgres_and_dws_menu_sql_artifacts_are_reference_only(self):
        for path in (
            REPO_ROOT / "docs" / "pg" / "menus-app-pg-ddl.sql",
            REPO_ROOT / "docs" / "dws" / "menus-app-dws-ddl.sql",
        ):
            with self.subTest(path=path):
                sql = path.read_text(encoding="utf-8")
                self.assertIn("Reference only", sql)
                self.assertIn("config/default-menus.json", sql)
                executable_sql = "\n".join(
                    line for line in sql.splitlines() if not line.lstrip().startswith("--")
                )
                self.assertNotIn("CREATE TABLE", executable_sql.upper())
                self.assertNotIn("CREATE SCHEMA", executable_sql.upper())
                self.assertNotIn("INSERT INTO", executable_sql.upper())


if __name__ == "__main__":
    unittest.main()
