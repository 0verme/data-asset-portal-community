from __future__ import annotations

import re
import unittest
from pathlib import Path


PORTABLE_CORE_SERVICES = (
    "assets_service.py",
    "api_asset_service.py",
    "field_mapping_service.py",
    "indicator_service.py",
    "manual_code_table_service.py",
    "report_service.py",
    "root_service.py",
)
SERVICES = Path(__file__).resolve().parents[1] / "app" / "services"


class DatabasePortabilityStaticTests(unittest.TestCase):
    def _sources(self):
        return {
            SERVICES / name: (SERVICES / name).read_text(encoding="utf-8")
            for name in PORTABLE_CORE_SERVICES
        }

    def test_core_services_do_not_hardcode_physical_schema(self):
        offenders = [str(path) for path, text in self._sources().items() if "dwp." in text.lower()]
        self.assertEqual([], offenders)

    def test_core_services_do_not_convert_placeholder_styles(self):
        pattern = re.compile(r"\.replace\(\s*['\"]\?['\"]\s*,\s*['\"](?:%s|:\w+)['\"]")
        offenders = [str(path) for path, text in self._sources().items() if pattern.search(text)]
        self.assertEqual([], offenders)

    def test_core_services_do_not_branch_on_database_family(self):
        pattern = re.compile(
            r"\b(?:if|elif|match|case)\b[^\n]{0,120}"
            r"\b(?:sqlite|postgres(?:ql)?|mysql|gaussdb|dws)\b",
            re.I,
        )
        offenders = [str(path) for path, text in self._sources().items() if pattern.search(text)]
        self.assertEqual([], offenders)


if __name__ == "__main__":
    unittest.main()
