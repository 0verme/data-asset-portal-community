from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

from sqlalchemy import create_engine, insert
from sqlalchemy.exc import IntegrityError

from backend.app.db.metadata import LOGICAL_SCHEMA
from backend.app.db.tables import search_hot_keyword
from backend.app.migrations.search_hot_keyword_seed import plan_search_hot_keyword_seed
from backend.app.repositories.search_hot_keyword_repository import (
    SearchHotKeywordRepository,
)
from backend.app.services.search_hot_keyword_service import SearchHotKeywordService

REPO_ROOT = Path(__file__).resolve().parents[2]
MIGRATE = REPO_ROOT / "backend" / "scripts" / "schema_migrate.py"
PREVIOUS_REVISION = "0011_push_job_freq_desc_capacity"


class _SqliteCoreAccess:
    def __init__(self, connection):
        self.connection = connection

    def fetch_rows(self, statement):
        return [dict(row._mapping) for row in self.connection.execute(statement)]


class SearchHotKeywordRepositoryTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://")
        self.connection = self.engine.connect().execution_options(
            schema_translate_map={LOGICAL_SCHEMA: None}
        )
        search_hot_keyword.create(self.connection)
        self.repository = SearchHotKeywordRepository(_SqliteCoreAccess(self.connection))
        self.service = SearchHotKeywordService(self.repository)

    def tearDown(self):
        self.connection.close()
        self.engine.dispose()

    def _insert(self, **values):
        defaults = {
            "created_at": datetime(2026, 1, 1),
            "updated_at": datetime(2026, 1, 1),
        }
        defaults.update(values)
        self.connection.execute(insert(search_hot_keyword).values(**defaults))

    def test_enabled_rows_are_sorted_by_order_then_id_and_disabled_rows_are_hidden(self):
        self._insert(id=12, keyword="同序后", category="all", sort_order=10, enabled="Y")
        self._insert(id=3, keyword="同序先", category="all", sort_order=10, enabled="Y")
        self._insert(id=1, keyword="靠后", category="all", sort_order=20, enabled="Y")
        self._insert(id=2, keyword="已停用", category="all", sort_order=0, enabled="N")

        items = self.service.get_hot_keywords()

        self.assertEqual(
            ["同序先", "同序后", "靠后"],
            [item["keyword"] for item in items],
        )
        self.assertEqual([3, 12, 1], [item["id"] for item in items])
        self.assertEqual(
            {"id", "keyword", "category", "sortOrder"},
            set(items[0]),
        )

    def test_empty_table_returns_an_empty_list(self):
        self.assertEqual([], self.service.get_hot_keywords())

    def test_same_keyword_can_be_reused_by_category_but_not_duplicated_within_one_category(self):
        self._insert(id=1, keyword="资产", category="asset", sort_order=10, enabled="Y")
        self.connection.commit()

        with self.assertRaises(IntegrityError):
            self._insert(id=2, keyword="资产", category="asset", sort_order=20, enabled="Y")
        self.connection.rollback()

        self._insert(id=3, keyword="资产", category="field", sort_order=30, enabled="Y")
        self.connection.commit()
        self.assertEqual(
            ["资产", "资产"],
            [item["keyword"] for item in self.service.get_hot_keywords()],
        )

    def test_keyword_must_not_be_empty_and_long_boundary_values_are_supported(self):
        with self.assertRaises(IntegrityError):
            self._insert(id=1, keyword="", category="all", sort_order=10, enabled="Y")
        self.connection.rollback()

        keyword = "长" * 255
        self._insert(id=2, keyword=keyword, category="all", sort_order=10, enabled="Y")
        self.connection.commit()
        self.assertEqual(keyword, self.service.get_hot_keywords()[0]["keyword"])


class SearchHotKeywordSeedPlanTests(unittest.TestCase):
    def test_seed_is_additive_and_preserves_disabled_customization(self):
        plan = plan_search_hot_keyword_seed(
            [
                {"id": 41, "keyword": "资产", "category": "all", "enabled": "N"},
                {"id": 90, "keyword": "业务自定义", "category": "asset", "enabled": "Y"},
            ]
        )

        self.assertEqual(["系统", "字段"], [item["keyword"] for item in plan])
        self.assertEqual([91, 92], [item["id"] for item in plan])
        self.assertTrue(all(item["enabled"] == "Y" for item in plan))


class SearchHotKeywordMigrationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="search-hot-keywords-321-")
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.database = self.root / "portal.sqlite"
        self.config = self.root / "database.yaml"
        self.config.write_text(
            "profiles:\n  hot_keywords_test:\n    type: sqlite\n"
            f"    database: {self.database.as_posix()}\n",
            encoding="utf-8",
        )
        self.profile_config = {"type": "sqlite", "database": str(self.database)}

    def _run_apply(self):
        environment = dict(os.environ)
        environment["APP_SECRET_KEY"] = "search-hot-keyword-test-secret"
        environment["ASSET_DB_CONFIG_PATH"] = str(self.config)
        environment["ASSET_DB_PROFILE"] = "hot_keywords_test"
        return subprocess.run(
            [
                sys.executable,
                str(MIGRATE),
                "apply",
                "--profile",
                "hot_keywords_test",
                "--config",
                str(self.config),
            ],
            cwd=REPO_ROOT,
            env=environment,
            capture_output=True,
            text=True,
            timeout=180,
        )

    def _rows(self):
        from backend.app.db.sqlite_adapter import connect

        connection = connect(self.profile_config)
        try:
            return connection.execute(
                "SELECT id, keyword, category, sort_order, enabled "
                "FROM dwp.p_search_hot_keyword ORDER BY sort_order, id"
            ).fetchall()
        finally:
            connection.close()

    def test_fresh_sqlite_apply_seeds_neutral_defaults_idempotently(self):
        result = self._run_apply()
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual(
            [("资产", "all", 10), ("系统", "all", 20), ("字段", "all", 30)],
            [(row[1], row[2], row[3]) for row in self._rows()],
        )

        repeated = self._run_apply()
        self.assertEqual(0, repeated.returncode, repeated.stderr)
        self.assertEqual(3, len(self._rows()))

    def test_0011_sqlite_upgrade_creates_a_missing_table_and_seeds_it(self):
        initial = self._run_apply()
        self.assertEqual(0, initial.returncode, initial.stderr)

        from backend.app.db.sqlite_adapter import connect

        connection = connect(self.profile_config)
        try:
            connection.execute("DROP TABLE dwp.p_search_hot_keyword")
            connection.execute(
                "UPDATE dwp.alembic_version SET version_num = ?",
                (PREVIOUS_REVISION,),
            )
            connection.commit()
        finally:
            connection.close()

        upgraded = self._run_apply()
        self.assertEqual(0, upgraded.returncode, upgraded.stderr)
        self.assertEqual(3, len(self._rows()))


if __name__ == "__main__":
    unittest.main()
