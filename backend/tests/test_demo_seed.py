"""Community demo seed and push-system contract tests."""

# pyright: reportMissingImports=false

from __future__ import annotations

import json
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.app.db.facade import clear_engine_cache, connect_with_profile
from backend.app.migrations.schema import initialize, verify_database
from backend.app.services.push_service import (
    DEFAULT_PUSH_AUTH_TYPES,
    PushService,
    PushValidationError,
)
from demo.seed_loader import ADMIN_USER, DEMO_PUSH_AUTH_TYPE, LEGACY_DEMO_PUSH_AUTH_TYPE
from werkzeug.security import check_password_hash

ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = ROOT.parent
COMMUNITY_CONFIG = ROOT / "configs" / "database.community.yaml"

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
    "p_menu": 11,
    "p_upstream_system": 8,
    "p_upstream_unload_time": 31,
    "p_upstream_change_log": 8,
    "p_push_system": 6,
    "p_push_job": 6,
    "p_push_job_field": 18,
    "p_push_change_log": 6,
    "p_report_asset": 8,
    "p_manual_code_table": 3,
    "p_lineage_snapshot": 1,
    "p_lineage_node": 9,
    "p_lineage_edge": 7,
}

COUNT_QUERIES = {
    "p_asset_table": "SELECT COUNT(*) FROM p_asset_table",
    "p_asset_field": "SELECT COUNT(*) FROM p_asset_field",
    "p_code_category": "SELECT COUNT(*) FROM p_code_category",
    "p_code_item": "SELECT COUNT(*) FROM p_code_item",
    "p_indicator_path_config": "SELECT COUNT(*) FROM p_indicator_path_config",
    "p_root_item": "SELECT COUNT(*) FROM p_root_item",
    "p_indicator_item": "SELECT COUNT(*) FROM p_indicator_item",
    "p_system": "SELECT COUNT(*) FROM p_system",
    "p_data_source": "SELECT COUNT(*) FROM p_data_source",
    "p_api_asset": "SELECT COUNT(*) FROM p_api_asset",
    "p_menu": "SELECT COUNT(*) FROM p_menu",
    "p_upstream_system": "SELECT COUNT(*) FROM p_upstream_system",
    "p_upstream_unload_time": "SELECT COUNT(*) FROM p_upstream_unload_time",
    "p_upstream_change_log": "SELECT COUNT(*) FROM p_upstream_change_log",
    "p_push_system": "SELECT COUNT(*) FROM p_push_system",
    "p_push_job": "SELECT COUNT(*) FROM p_push_job",
    "p_push_job_field": "SELECT COUNT(*) FROM p_push_job_field",
    "p_push_change_log": "SELECT COUNT(*) FROM p_push_change_log",
    "p_report_asset": "SELECT COUNT(*) FROM p_report_asset",
    "p_manual_code_table": "SELECT COUNT(*) FROM p_manual_code_table",
    "p_lineage_snapshot": "SELECT COUNT(*) FROM p_lineage_snapshot",
    "p_lineage_node": "SELECT COUNT(*) FROM p_lineage_node",
    "p_lineage_edge": "SELECT COUNT(*) FROM p_lineage_edge",
}


def _load_dataset(name: str) -> list[dict]:
    path = PROJECT_ROOT / "demo" / "datasets" / name
    return json.loads(path.read_text(encoding="utf-8"))


class CommunityDemoSeedTests(unittest.TestCase):
    """Repository demo seed must be deterministic, idempotent and complete."""

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
                "APP_ENV": "production",
                "APP_SECRET_KEY": os.urandom(24).hex(),
                "LINEAGE_DB_PROFILE": "",
            },
            clear=False,
        )
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.addCleanup(clear_engine_cache)
        connection = connect_with_profile("community_sqlite")
        try:
            config = {"type": "sqlite", "database": str(self.database)}
            self.assertTrue(initialize(connection, config, "sqlite"))
            self.assertEqual("0001_baseline", verify_database(connection, config, "sqlite"))
        finally:
            if connection is not None:
                connection.close()

    def _seed(self):
        from demo.seed_sqlite import seed
        seed(self.database)

    def test_seed_creates_demo_admin_with_hashed_password(self):
        self.assertEqual("admin", ADMIN_USER["username"])
        self.assertEqual("12346", ADMIN_USER["password"])
        self.assertEqual("admin", ADMIN_USER["role"])
        self.assertEqual("ACTIVE", ADMIN_USER["status"])

        self._seed()
        connection = sqlite3.connect(self.database)
        try:
            row = connection.execute(
                "SELECT username, password_hash, role, status "
                "FROM p_admin_user WHERE id = ?",
                (ADMIN_USER["id"],),
            ).fetchone()
        finally:
            connection.close()

        self.assertIsNotNone(row)
        username, password_hash, role, status = row
        self.assertEqual("admin", username)
        self.assertNotEqual("12346", password_hash)
        self.assertTrue(check_password_hash(password_hash, "12346"))
        self.assertEqual("admin", role)
        self.assertEqual("ACTIVE", status)

    def _counts(self):
        connection = sqlite3.connect(self.database)
        try:
            # pi-lens-ignore: python-sql-injection
            return {
                table: connection.execute(COUNT_QUERIES[table]).fetchone()[0]
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

    def test_demo_indicators_use_stable_refs_when_the_field_matches_exactly(self):
        self._seed()
        connection = sqlite3.connect(self.database)
        try:
            rows = connection.execute(
                "SELECT i.indicator_id, i.source_asset_id, i.result_field_id, f.asset_id "
                "FROM p_indicator_item i "
                "LEFT JOIN p_asset_field f ON f.field_id = i.result_field_id "
                "ORDER BY i.indicator_pk"
            ).fetchall()
        finally:
            connection.close()

        self.assertEqual(16, len(rows))
        self.assertTrue(all(row[1] is not None for row in rows))
        self.assertTrue(all(row[3] == row[1] for row in rows if row[2] is not None))
        unresolved = {row[0] for row in rows if row[2] is None}
        self.assertEqual(
            {"MEM00002", "MEM00003", "INV00001", "INV00002", "SVC00002"},
            unresolved,
        )

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

    def test_seed_contains_every_repository_module_table(self):
        self._seed()
        from demo.seed_loader import community_seed_plan

        connection = sqlite3.connect(self.database)
        try:
            names = {row[0] for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )}
        finally:
            connection.close()
        self.assertTrue(set(community_seed_plan()) <= names)
        indicators = _load_dataset("indicators.json")
        asset_tables = {item["table"] for item in _load_dataset("assets.json")}
        for indicator in indicators:
            self.assertIn(indicator["table"], asset_tables, indicator["code"])

    def test_mapping_rows_reference_upstream_system_primary_keys(self):
        self._seed()
        connection = sqlite3.connect(self.database)
        try:
            rows = connection.execute(
                "SELECT t.upstream_system_id, u.system_pk, u.system_abbr "
                "FROM p_field_mapping_table t "
                "JOIN p_upstream_system u ON u.system_pk = t.upstream_system_id "
                "ORDER BY t.table_pk"
            ).fetchall()
            foreign_keys = connection.execute(
                "PRAGMA foreign_key_list(p_field_mapping_table)"
            ).fetchall()
        finally:
            connection.close()
        self.assertEqual(8, len(rows))
        self.assertTrue(all(row[0] == row[1] for row in rows))
        self.assertEqual({"MEM", "PIM", "OMS", "POS", "IMS", "MKT", "FUL", "SVC"}, {row[2] for row in rows})
        self.assertTrue(any(row[2] == "p_upstream_system" and row[3] == "upstream_system_id" for row in foreign_keys))

    def test_manual_code_table_seed_uses_binary_status_values(self):
        self._seed()
        connection = sqlite3.connect(self.database)
        try:
            statuses = connection.execute(
                "SELECT table_code, status_code FROM p_manual_code_table ORDER BY table_id"
            ).fetchall()
        finally:
            connection.close()
        self.assertEqual(
            [
                ("ORDER_STATUS", "enabled"),
                ("CHANNEL_TYPE", "enabled"),
                ("DELIVERY_MODE", "disabled"),
            ],
            statuses,
        )

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

    def test_fresh_demo_push_auth_matches_contract_and_edit_succeeds(self):
        self._seed()
        connection = sqlite3.connect(self.database)
        try:
            rows = connection.execute(
                "SELECT system_code, auth_type FROM p_push_system ORDER BY system_code"
            ).fetchall()
        finally:
            connection.close()

        self.assertEqual({DEMO_PUSH_AUTH_TYPE}, {row[1] for row in rows})
        self.assertTrue(all(row[1] in DEFAULT_PUSH_AUTH_TYPES for row in rows))

        service = PushService()
        current = service.get_push_system_admin_detail("DEMO_BI")
        current["name"] = "零售经营看板（已编辑）"
        service.update_push_system("DEMO_BI", current)

        updated = service.get_push_system_admin_detail("DEMO_BI")
        self.assertEqual("零售经营看板（已编辑）", updated["name"])
        self.assertEqual(DEMO_PUSH_AUTH_TYPE, updated["auth"])

    def test_seed_repairs_legacy_demo_auth_idempotently_and_preserves_valid_auth(self):
        self._seed()
        connection = sqlite3.connect(self.database)
        try:
            connection.execute(
                "UPDATE p_push_system SET auth_type = ? "
                "WHERE system_code = 'DEMO_BI'",
                (LEGACY_DEMO_PUSH_AUTH_TYPE,),
            )
            connection.execute(
                "UPDATE p_push_system SET auth_type = ?, created_by = ? "
                "WHERE system_code = 'DEMO_REPL'",
                ("账号密码", "operator"),
            )
            connection.commit()
        finally:
            connection.close()

        self._seed()
        connection = sqlite3.connect(self.database)
        try:
            repaired = connection.execute(
                "SELECT system_code, auth_type, created_by FROM p_push_system "
                "WHERE system_code IN ('DEMO_BI', 'DEMO_REPL') ORDER BY system_code"
            ).fetchall()
        finally:
            connection.close()

        self.assertEqual(
            [
                ("DEMO_BI", DEMO_PUSH_AUTH_TYPE, "demo"),
                ("DEMO_REPL", "账号密码", "operator"),
            ],
            repaired,
        )

        self._seed()
        connection = sqlite3.connect(self.database)
        try:
            self.assertEqual(
                repaired,
                connection.execute(
                    "SELECT system_code, auth_type, created_by FROM p_push_system "
                    "WHERE system_code IN ('DEMO_BI', 'DEMO_REPL') ORDER BY system_code"
                ).fetchall(),
            )
        finally:
            connection.close()

    def test_push_update_keeps_auth_validation_strict(self):
        self._seed()
        service = PushService()
        current = service.get_push_system_admin_detail("DEMO_BI")
        current["auth"] = LEGACY_DEMO_PUSH_AUTH_TYPE

        with self.assertRaises(PushValidationError) as error:
            service.update_push_system("DEMO_BI", current)

        self.assertEqual(
            [
                {
                    "field": "auth",
                    "message": f"auth 不在允许范围内: {LEGACY_DEMO_PUSH_AUTH_TYPE}",
                }
            ],
            error.exception.details,
        )
        self.assertEqual(
            DEMO_PUSH_AUTH_TYPE,
            service.get_push_system_admin_detail("DEMO_BI")["auth"],
        )


if __name__ == "__main__":
    unittest.main()
