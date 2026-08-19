from __future__ import annotations

import json
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.app.db.facade import connect_with_profile
from backend.app.migrations.runner import MigrationRunner

ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = ROOT.parent
MIGRATIONS = ROOT / "migrations"
COMMUNITY_CONFIG = ROOT / "configs" / "database.community.yaml"

COMMUNITY_MODULES = ["portal", "dwm", "mapping", "lineage", "root", "indicator", "apiAsset", "system"]

PRIVATE_TABLES = {
    "p_push_system", "p_push_job", "p_push_job_field", "p_push_change_log",
    "p_upstream_system", "p_upstream_unload_time", "p_upstream_change_log",
    "p_report_asset",
    "p_manual_code_table",
}

# Expected deterministic demo volumes (aligned with demo/validate_demo_data.py).
EXPECTED_COUNTS = {
    "p_asset_table": 30,
    "p_asset_field": 251,
    "p_code_category": 9,
    "p_code_item": 33,
    "p_indicator_path_config": 10,
    "p_root_item": 40,
    "p_indicator_item": 16,
    "p_system": 8,
    "p_data_source": 8,
    "p_api_asset": 10,
}


def _load_dataset(name: str) -> list[dict]:
    path = PROJECT_ROOT / "demo" / "datasets" / name
    return json.loads(path.read_text(encoding="utf-8"))


class CommunityDemoSeedTests(unittest.TestCase):
    """Community demo seed must be deterministic, idempotent and Community-only."""

    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.database = Path(self.temp_dir.name) / "community.sqlite"
        self.environment = patch.dict(
            os.environ,
            {
                "ASSET_DB_CONFIG_PATH": str(COMMUNITY_CONFIG),
                "ASSET_DB_PROFILE": "community_sqlite",
                "ASSET_DB_DATABASE": str(self.database),
                "ASSET_EDITION": "community",
                "FLASK_ENV": "production",
                "FLASK_SECRET_KEY": "demo-seed-test-only",
                "LINEAGE_DB_PROFILE": "",
            },
            clear=False,
        )
        self.environment.start()
        self.addCleanup(self.environment.stop)
        connection = connect_with_profile("community_sqlite")
        try:
            runner = MigrationRunner(
                connection,
                "sqlite",
                MIGRATIONS,
                enabled_modules=COMMUNITY_MODULES,
            )
            self.assertEqual(["0002", "0003", "0004", "0005", "0006"], runner.apply())
            self.assertFalse(runner.verify().pending)
        finally:
            connection.close()

    def _seed(self):
        from demo.seed_sqlite import seed
        seed(self.database)

    def _counts(self):
        connection = sqlite3.connect(self.database)
        try:
            return {
                table: connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
                for table in EXPECTED_COUNTS
            }
        finally:
            connection.close()

    def _field_rows(self):
        connection = sqlite3.connect(self.database)
        try:
            return connection.execute(
                "SELECT field_id, asset_id, field_name, field_cn_name, data_type, "
                "field_order, nullable_flag, pk_flag, partition_flag "
                "FROM p_asset_field ORDER BY field_id"
            ).fetchall()
        finally:
            connection.close()

    def test_seed_is_idempotent(self):
        self._seed()
        first = self._counts()
        self._seed()
        second = self._counts()
        self.assertEqual(first, second)
        for table, count in EXPECTED_COUNTS.items():
            self.assertEqual(second[table], count, f"unexpected volume for {table}")

    def test_field_plan_matches_assets_and_field_count(self):
        self._seed()
        assets = _load_dataset("assets.json")
        fields = _load_dataset("fields.json")
        asset_names = {item["table"] for item in assets}
        self.assertEqual(len(assets), EXPECTED_COUNTS["p_asset_table"])
        self.assertEqual({spec["table"] for spec in fields}, asset_names)

        connection = sqlite3.connect(self.database)
        try:
            asset_id_by_name = {
                row[0]: row[1]
                for row in connection.execute(
                    "SELECT table_name, asset_id FROM p_asset_table"
                )
            }
            declared_counts = {
                row[0]: row[1]
                for row in connection.execute(
                    "SELECT table_name, field_count FROM p_asset_table"
                )
            }
            field_count_by_asset = {}
            for row in self._field_rows():
                field_count_by_asset[row[1]] = field_count_by_asset.get(row[1], 0) + 1
        finally:
            connection.close()

        for spec in fields:
            table = spec["table"]
            asset_id = asset_id_by_name[table]
            self.assertEqual(
                len(spec["fields"]),
                field_count_by_asset.get(asset_id, 0),
                f"field rows for {table}",
            )
            self.assertEqual(declared_counts[table], len(spec["fields"]), table)

    def test_fields_have_unique_names_per_table_and_valid_pk_rules(self):
        self._seed()
        fields = _load_dataset("fields.json")
        for spec in fields:
            names = [field["name"] for field in spec["fields"]]
            self.assertEqual(len(names), len(set(names)), spec["table"])
            for field in spec["fields"]:
                self.assertTrue(field["name"].strip(), spec["table"])
                self.assertTrue(field["cn"].strip(), spec["table"])
                self.assertTrue(field["type"].strip(), spec["table"])
                if field.get("pk"):
                    self.assertFalse(field.get("nullable"), f"pk must be non-nullable: {spec['table']}.{field['name']}")

        # Persisted flags mirror the JSON contract.
        rows = self._field_rows()
        self.assertEqual(len(rows), EXPECTED_COUNTS["p_asset_field"])
        for row in rows:
            field_id, _asset_id, _name, _cn, _type, _order, nullable, pk, part = row
            self.assertIn(nullable, {"Y", "N"}, f"nullable flag {field_id}")
            self.assertIn(pk, {"Y", "N"}, f"pk flag {field_id}")
            self.assertIn(part, {"Y", "N"}, f"partition flag {field_id}")
            if pk == "Y":
                self.assertEqual(nullable, "N", f"pk field {field_id} must be non-nullable")

    def test_seed_never_touches_private_tables(self):
        self._seed()
        connection = sqlite3.connect(self.database)
        try:
            names = {row[0] for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )}
        finally:
            connection.close()
        self.assertFalse(names & PRIVATE_TABLES)
        # Every indicator result table must exist in the asset catalog.
        indicators = _load_dataset("indicators.json")
        asset_tables = {item["table"] for item in _load_dataset("assets.json")}
        for indicator in indicators:
            self.assertIn(indicator["table"], asset_tables, indicator["code"])

    def test_common_codes_and_paths_are_stable(self):
        self._seed()
        connection = sqlite3.connect(self.database)
        try:
            item_codes = connection.execute(
                "SELECT category_code, item_code FROM p_code_item"
            ).fetchall()
            paths = connection.execute(
                "SELECT path_code, parent_id, path_level, full_path FROM p_indicator_path_config"
            ).fetchall()
        finally:
            connection.close()
        self.assertEqual(len({(c, i) for c, i in item_codes}), len(item_codes))
        self.assertEqual(len({p[0] for p in paths}), len(paths))
        roots = [p for p in paths if p[1] is None]
        self.assertEqual(len(roots), 1)
        for path in paths:
            self.assertEqual(path[3].split("/")[-1], path[0], f"full_path tail for {path[0]}")


if __name__ == "__main__":
    unittest.main()
