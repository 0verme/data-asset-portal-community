from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = ROOT.parent
DEMO_ROOT = PROJECT_ROOT / "demo"
DATASET_ROOT = DEMO_ROOT / "datasets"
GENERATOR = DEMO_ROOT / "generate_demo_sql.py"
MANIFEST_PATH = DEMO_ROOT / "manifest.json"


class DemoSqlManifestCoverageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        cls.dataset_entries = [Path(entry) for entry in cls.manifest["datasets"]]
        cls.dataset_names = [entry.stem for entry in cls.dataset_entries]

    def test_manifest_entries_are_unique_valid_and_present(self):
        self.assertEqual(3, self.manifest["version"])
        self.assertTrue(self.manifest["theme"].strip())
        self.assertTrue(self.dataset_entries)
        self.assertEqual(len(self.dataset_names), len(set(self.dataset_names)))

        for relative in self.dataset_entries:
            self.assertFalse(relative.is_absolute(), relative)
            self.assertEqual(Path("datasets"), relative.parent, relative)
            self.assertEqual(".json", relative.suffix, relative)
            source = (DEMO_ROOT / relative).resolve()
            self.assertTrue(DATASET_ROOT.resolve() in source.parents, relative)
            self.assertTrue(source.is_file(), f"missing manifest dataset: {relative}")

    def test_every_dataset_source_is_listed_in_manifest(self):
        manifest_paths = {entry.as_posix() for entry in self.dataset_entries}
        source_paths = {
            path.relative_to(DEMO_ROOT).as_posix()
            for path in DATASET_ROOT.glob("*.json")
        }

        self.assertEqual(source_paths, manifest_paths)

    def test_generator_covers_manifest_and_preserves_include_order(self):
        with tempfile.TemporaryDirectory(prefix="demo-sql-manifest-") as directory:
            output = Path(directory)
            result = subprocess.run(
                [sys.executable, str(GENERATOR), "--output", str(output)],
                cwd=PROJECT_ROOT,
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(0, result.returncode, result.stderr)

            expected_files = {f"{name}.sql" for name in self.dataset_names}
            expected_files.add("all-datasets.sql")
            actual_files = {path.name for path in output.glob("*.sql")}
            self.assertEqual(expected_files, actual_files)

            include_lines = [
                line
                for line in (output / "all-datasets.sql").read_text(encoding="utf-8").splitlines()
                if line.startswith("\\i ")
            ]
            expected_includes = [f"\\i {name}.sql" for name in self.dataset_names]
            self.assertEqual(expected_includes, include_lines)


if __name__ == "__main__":
    unittest.main()
