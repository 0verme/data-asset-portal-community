# Copyright 2025 Jearhe
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

import ast
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LINEAGE_PKG = ROOT / "backend" / "app" / "services" / "lineage"
LINEAGE_ROUTES = ROOT / "backend" / "app" / "fastapi" / "routers" / "lineage.py"
LINEAGE_SERVICE = ROOT / "backend" / "app" / "services" / "lineage_service.py"
LINEAGE_COLLECTOR = ROOT / "backend" / "app" / "services" / "lineage_collector.py"


def _imported_modules(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    names = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                names.add(alias.name)
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            names.add(module)
    return names


class LineageBoundaryTestCase(unittest.TestCase):
    def test_reader_package_exists(self):
        self.assertTrue((LINEAGE_PKG / "reader.py").is_file())
        self.assertTrue((LINEAGE_PKG / "repository.py").is_file())
        self.assertTrue((LINEAGE_PKG / "collector_protocol.py").is_file())
        self.assertTrue(LINEAGE_COLLECTOR.is_file())

    def test_native_router_imports_reader_not_collector(self):
        imports = _imported_modules(LINEAGE_ROUTES)
        joined = " ".join(imports)
        self.assertIn("services.lineage", joined)
        self.assertFalse(any("lineage_collector" in name for name in imports))

    def test_reader_module_does_not_import_collector(self):
        imports = _imported_modules(LINEAGE_PKG / "reader.py")
        self.assertFalse(any("lineage_collector" in name for name in imports))
        # Implementation is the display service, not the private collector.
        self.assertTrue(any("lineage_service" in name for name in imports))

    def test_package_init_does_not_import_collector(self):
        imports = _imported_modules(LINEAGE_PKG / "__init__.py")
        self.assertTrue(any("reader" in name for name in imports))
        self.assertFalse(any("lineage_collector" in name for name in imports))

    def test_lineage_service_reader_does_not_import_collector(self):
        imports = _imported_modules(LINEAGE_SERVICE)
        self.assertFalse(any("lineage_collector" in name for name in imports))
        text = LINEAGE_SERVICE.read_text(encoding="utf-8")
        self.assertNotIn("p_job_hjj", text)
        self.assertNotIn("p_program_hjj", text)


if __name__ == "__main__":
    unittest.main()
