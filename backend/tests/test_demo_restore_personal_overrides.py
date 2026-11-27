from __future__ import annotations

import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
RESTORE = REPO / "deploy" / "demo" / "restore-personal-overrides.py"


class DemoRestorePersonalOverridesTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        root = Path(directory.name)
        self.database = root / "demo.sqlite"
        config = root / "database.yaml"
        config.write_text(
            f"profiles:\n  public_demo:\n    type: sqlite\n    database: '{self.database.as_posix()}'\n",
            encoding="utf-8",
        )
        self.overrides = root / "personal-overrides.json"
        self.secret = "fixture-only-rag-credential"
        self.env = {
            **os.environ,
            "ASSET_DB_CONFIG_PATH": str(config),
            "ASSET_DB_PROFILE": "public_demo",
            "RAG_SEARCH_SERVICE_TOKEN": self.secret,
        }
        result = self.run_python("backend/scripts/schema_migrate.py", "apply", "--profile", "public_demo")
        self.assertEqual(result.returncode, 0, result.stderr)

    def run_python(self, *args):
        return subprocess.run(
            [sys.executable, *args], cwd=REPO, env=self.env,
            capture_output=True, text=True, timeout=30, check=False,
        )

    def restore(self, override):
        self.overrides.write_text(json.dumps({"rag": override}), encoding="utf-8")
        result = self.run_python(str(RESTORE), "--overrides", str(self.overrides))
        self.assertNotIn(self.secret, result.stdout + result.stderr)
        return result

    def stored(self):
        with closing(sqlite3.connect(self.database)) as connection:
            table, = connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%code_item'"
            ).fetchone()
            row = connection.execute(
                f'SELECT item_id, item_code, ext_json FROM "{table}" WHERE category_code=?',
                ("RAG_SEARCH_CONFIG",),
            ).fetchone()
        self.assertEqual(row[1], "DEFAULT")
        self.assertNotIn(self.secret, row[2])
        return row[0], json.loads(row[2])

    def test_legacy_override_preserves_omitted_mode_and_is_idempotent(self):
        item_id, _ = self.stored()
        legacy = {
            "enabled": True, "serviceUrl": "http://localhost:18081",
            "strategy": "hybrid", "topK": 5, "timeoutMs": 2000,
        }
        for _ in range(2):
            result = self.restore(legacy)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(self.stored(), (item_id, legacy))

        runtime = self.run_python("-c", """
from backend.app.services.system_management_service import system_management_service
config = system_management_service.get_rag_search_config_public()
assert config['enabled'] and config['retrievalMode'] == 'external' and config['tokenConfigured']
assert 'token' not in config and 'serviceToken' not in config
""")
        self.assertEqual(runtime.returncode, 0, runtime.stderr)

    def test_partial_override_preserves_explicit_mode_and_rejects_invalid_input(self):
        result = self.restore({"enabled": True, "retrievalMode": "local", "topK": 9})
        self.assertEqual(result.returncode, 0, result.stderr)
        before = self.stored()
        result = self.restore({"timeoutMs": 3500})
        self.assertEqual(result.returncode, 0, result.stderr)
        expected = (before[0], {**before[1], "timeoutMs": 3500})
        self.assertEqual(self.stored(), expected)

        for invalid in ({"retrievalMode": None}, {"topK": 0}):
            with self.subTest(fields=sorted(invalid)):
                result = self.restore(invalid)
                self.assertEqual(result.returncode, 1)
                self.assertIn("ValidationError", result.stderr)
                self.assertEqual(self.stored(), expected)
