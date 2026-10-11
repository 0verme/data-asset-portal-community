"""Community demo seed and push-system contract tests."""

# pyright: reportMissingImports=false

from __future__ import annotations

import json
import os
import sqlite3
from contextlib import redirect_stdout
from io import StringIO
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.app.db.facade import clear_engine_cache, connect_with_profile
from backend.app.migrations.schema import initialize, verify_database
from backend.app.services.common_code_service import common_code_service
from backend.app.services.push_service import (
    DEFAULT_PUSH_AUTH_TYPES,
    PushService,
    PushValidationError,
)
from backend.app.services.upstream_service import (
    UpstreamService,
    UpstreamValidationError,
)
from demo.indicator_path_contract import (
    flatten_indicator_path_tree,
    indicator_path_contract_errors,
)
from demo.seed_loader import (
    ADMIN_USER,
    DEMO_PUSH_AUTH_TYPE,
    LEGACY_DEMO_PUSH_AUTH_TYPE,
    load_dataset,
)
from demo.seed_postgres import main as render_demo_seed_sql
from werkzeug.security import check_password_hash, generate_password_hash

ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = ROOT.parent
COMMUNITY_CONFIG = ROOT / "configs" / "database.community.yaml"

# Expected deterministic demo volumes (aligned with demo/validate_demo_data.py).
EXPECTED_COUNTS = {
    "p_asset_table": 30,
    "p_asset_field": 251,
    "p_code_category": 11,
    "p_code_item": 49,
    "p_indicator_path_config": 62,
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
        common_code_service.invalidate()

    def test_seed_creates_demo_admin_with_hashed_password(self):
        self.assertEqual("admin", ADMIN_USER["username"])
        self.assertEqual("123456", ADMIN_USER["password"])
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
        self.assertNotEqual("123456", password_hash)
        self.assertTrue(check_password_hash(password_hash, "123456"))
        self.assertEqual("admin", role)
        self.assertEqual("ACTIVE", status)

    def test_reseeding_does_not_reset_existing_demo_admin_password(self):
        self._seed()
        legacy_password_hash = generate_password_hash("12346")
        connection = sqlite3.connect(self.database)
        try:
            connection.execute(
                "UPDATE p_admin_user SET password_hash = ? WHERE id = ?",
                (legacy_password_hash, ADMIN_USER["id"]),
            )
            connection.commit()
        finally:
            connection.close()

        self._seed()
        connection = sqlite3.connect(self.database)
        try:
            password_hash = connection.execute(
                "SELECT password_hash FROM p_admin_user WHERE id = ?",
                (ADMIN_USER["id"],),
            ).fetchone()[0]
        finally:
            connection.close()

        self.assertEqual(legacy_password_hash, password_hash)
        self.assertTrue(check_password_hash(password_hash, "12346"))
        self.assertFalse(check_password_hash(password_hash, "123456"))

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

    def test_upstream_option_catalog_matches_form_values(self):
        self._seed()
        connection = sqlite3.connect(self.database)
        try:
            db_types = connection.execute(
                "SELECT item_code, item_name, item_value FROM p_code_item "
                "WHERE category_code = 'UPSTREAM_DB_TYPE' ORDER BY display_order"
            ).fetchall()
            depts = connection.execute(
                "SELECT item_code, item_name, item_value FROM p_code_item "
                "WHERE category_code = 'UPSTREAM_DEPT' ORDER BY display_order"
            ).fetchall()
        finally:
            connection.close()

        self.assertEqual(
            [
                ("POSTGRESQL", "PostgreSQL", "PostgreSQL"),
                ("MYSQL", "MySQL", "MySQL"),
                ("ORACLE", "Oracle", "Oracle"),
                ("SQL_SERVER", "SQL Server", "SQL Server"),
                ("MONGODB", "MongoDB", "MongoDB"),
                ("KAFKA", "Kafka", "Kafka"),
                ("OBJECT_STORAGE", "Object Storage", "Object Storage"),
                ("OTHER", "其他", "其他"),
            ],
            db_types,
        )
        self.assertEqual(
            [
                ("PRODUCT_OPERATIONS", "商品运营部", "商品运营部"),
                ("MEMBER_OPERATIONS", "会员运营部", "会员运营部"),
                ("TRADE_OPERATIONS", "交易运营部", "交易运营部"),
                ("STORE_OPERATIONS", "门店运营部", "门店运营部"),
                ("SUPPLY_CHAIN", "供应链部", "供应链部"),
                ("MARKETING", "市场营销部", "市场营销部"),
                ("FULFILLMENT", "履约运营部", "履约运营部"),
                ("CUSTOMER_SERVICE", "客户服务部", "客户服务部"),
            ],
            depts,
        )

    def test_upstream_create_read_edit_and_historical_values(self):
        self._seed()
        service = UpstreamService()
        payload = {
            "id": "uo_ccbs",
            "abbr": "UO_CCBS",
            "name": "uo_ccbs",
            "dbType": "PostgreSQL",
            "host": "uo_ccbs.demo.invalid",
            "db": "UO_CCBS",
            "schema": "PUBLIC",
            "unloadTimes": ["02:00"],
            "status": "enabled",
            "owner": "uo_ccbs",
            "dept": "供应链部",
            "desc": "uo_ccbs",
        }

        created = service._create_system(payload)
        self.assertEqual("PostgreSQL", created["dbType"])
        self.assertEqual("供应链部", created["dept"])
        self.assertEqual(
            {"dbType": "PostgreSQL", "dept": "供应链部"},
            {
                key: service.get_system_detail("uo_ccbs")[key]
                for key in ("dbType", "dept")
            },
        )

        current = service.get_system_admin_detail("uo_ccbs")
        current.update({"dbType": "MySQL", "dept": "商品运营部"})
        _before, updated = service._update_system("uo_ccbs", current)
        self.assertEqual("MySQL", updated["dbType"])
        self.assertEqual("商品运营部", updated["dept"])
        self.assertEqual("MySQL", service.get_system_admin_detail("uo_ccbs")["dbType"])
        self.assertEqual("商品运营部", service.get_system_admin_detail("uo_ccbs")["dept"])

        connection = sqlite3.connect(self.database)
        try:
            connection.execute(
                "UPDATE p_upstream_system SET db_type = ?, dept_name = ? WHERE system_id = ?",
                ("POSTGRESQL", "SUPPLY_CHAIN", "uo_ccbs"),
            )
            connection.commit()
        finally:
            connection.close()

        historical = service.get_system_admin_detail("uo_ccbs")
        self.assertEqual("PostgreSQL", historical["dbType"])
        self.assertEqual("供应链部", historical["dept"])
        normalized = service._normalize_payload(
            {**payload, "id": "uo_ccbs", "dbType": "postgresql", "dept": "SUPPLY_CHAIN"},
            current=historical,
        )
        self.assertEqual("PostgreSQL", normalized["dbType"])
        self.assertEqual("供应链部", normalized["dept"])

    def test_upstream_invalid_options_remain_rejected(self):
        self._seed()
        service = UpstreamService()
        payload = {
            "id": "uo_invalid",
            "abbr": "UO_INVALID",
            "name": "invalid",
            "dbType": "PostgreSQL",
            "host": "invalid.demo.invalid",
            "unloadTimes": ["02:00"],
            "status": "enabled",
            "dept": "供应链部",
        }

        with self.assertRaises(UpstreamValidationError) as db_error:
            service._normalize_payload({**payload, "dbType": "__INVALID__"})
        self.assertEqual(
            [{"field": "dbType", "message": "“__INVALID__”不是有效选项"}],
            db_error.exception.details,
        )

        with self.assertRaises(UpstreamValidationError) as dept_error:
            service._normalize_payload({**payload, "dept": "__INVALID__"})
        self.assertEqual(
            [{"field": "dept", "message": "“__INVALID__”不是有效选项"}],
            dept_error.exception.details,
        )

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
                "SELECT id, path_code, parent_id, path_level, full_path, dimension_code "
                "FROM p_indicator_path_config ORDER BY id"
            ).fetchall()
        finally:
            connection.close()
        self.assertEqual(len({(c, i) for c, i in item_codes}), len(item_codes))
        self.assertEqual(len({p[1] for p in paths}), len(paths))
        self.assertEqual(62, len(paths))
        roots = [path for path in paths if path[2] is None]
        self.assertEqual(8, len(roots))
        root_dimensions = {path[5] for path in roots}
        self.assertEqual(
            {"prd", "mem", "ord", "str", "inv", "mkt", "ful", "svc"},
            root_dimensions,
        )
        by_id = {path[0]: path for path in paths}
        for path in paths:
            self.assertEqual(path[4].split("/")[-1], path[1], f"full_path tail for {path[1]}")
            self.assertEqual(len(path[4].split("/")), path[3], f"path_level for {path[1]}")
            self.assertIn(path[5], root_dimensions)
            if path[2] is not None:
                parent = by_id[path[2]]
                self.assertEqual(path[3], parent[3] + 1, path[1])
                self.assertEqual(path[4], f"{parent[4]}/{path[1]}", path[1])
                self.assertEqual(path[5], parent[5], path[1])

    def test_demo_indicator_paths_match_seed_tree_and_dimension_codes(self):
        path_tree = _load_dataset("indicator_paths.json")
        indicators = _load_dataset("indicators.json")
        self.assertEqual([], indicator_path_contract_errors(path_tree, indicators))
        self.assertEqual(16, len(indicators))

        self._seed()
        connection = sqlite3.connect(self.database)
        try:
            seeded = connection.execute(
                "SELECT indicator_id, dimension_code, path_desc "
                "FROM p_indicator_item ORDER BY indicator_pk"
            ).fetchall()
        finally:
            connection.close()
        expected = [
            (item["code"], item["code"][:3].lower(), item["pathDesc"])
            for item in indicators
        ]
        self.assertEqual(expected, seeded)

    def test_path_contract_reports_indicator_and_missing_node(self):
        path_tree = _load_dataset("indicator_paths.json")
        indicators = _load_dataset("indicators.json")
        indicators[0]["pathDesc"] = "PRD > Missing Group > 规模"

        errors = indicator_path_contract_errors(path_tree, indicators)

        self.assertEqual(1, len(errors))
        self.assertIn("PRD00001", errors[0])
        self.assertIn("Missing Group", errors[0])

    def test_seed_rejects_unmatched_indicator_path_before_writes(self):
        original_load = load_dataset

        def load_with_invalid_indicator_path(name):
            data = original_load(name)
            if name == "indicators.json":
                data[0]["pathDesc"] = "PRD > Missing Group > 规模"
            return data

        with patch("demo.seed_loader.load_dataset", side_effect=load_with_invalid_indicator_path):
            with self.assertRaisesRegex(ValueError, "indicator PRD00001: missing path node"):
                self._seed()

        connection = sqlite3.connect(self.database)
        try:
            self.assertEqual(0, connection.execute("SELECT COUNT(*) FROM p_system").fetchone()[0])
            self.assertEqual(0, connection.execute("SELECT COUNT(*) FROM p_indicator_path_config").fetchone()[0])
        finally:
            connection.close()

    def test_seed_rejects_legacy_indicator_path_description_without_overwrite(self):
        self._seed()
        legacy_path_desc = "PRD 商品维度 > 商品运营 > 规模"
        connection = sqlite3.connect(self.database)
        try:
            connection.execute(
                "UPDATE p_indicator_item SET path_desc = ? WHERE indicator_pk = 1",
                (legacy_path_desc,),
            )
            connection.commit()
        finally:
            connection.close()

        with self.assertRaisesRegex(
            ValueError, r"p_indicator_item row \(indicator_pk=1\) conflicts"
        ):
            self._seed()

        connection = sqlite3.connect(self.database)
        try:
            self.assertEqual(
                legacy_path_desc,
                connection.execute(
                    "SELECT path_desc FROM p_indicator_item WHERE indicator_pk = 1"
                ).fetchone()[0],
            )
            self.assertEqual(8, connection.execute("SELECT COUNT(*) FROM p_system").fetchone()[0])
        finally:
            connection.close()

    def test_postgres_and_dws_seed_sql_share_the_canonical_path_contract(self):
        path_tree = _load_dataset("indicator_paths.json")
        indicators = _load_dataset("indicators.json")
        path_codes = [
            row["pathCode"] for row in flatten_indicator_path_tree(path_tree)
        ]

        for dialect in ("postgres", "dws"):
            with self.subTest(dialect=dialect):
                output = StringIO()
                with patch("sys.argv", ["seed_postgres.py", "--dialect", dialect]):
                    with redirect_stdout(output):
                        render_demo_seed_sql()
                sql = output.getvalue()
                path_start = sql.index("INSERT INTO dwp.p_indicator_path_config ")
                path_end = sql.index(";", path_start)
                path_insert = sql[path_start:path_end]
                indicator_start = sql.index("INSERT INTO dwp.p_indicator_item ")
                indicator_end = sql.index(";", indicator_start)
                indicator_insert = sql[indicator_start:indicator_end]

                self.assertIn("-- Existing indicator path/indicator rows are insert-only", sql)
                self.assertIn("ON CONFLICT (id) DO NOTHING", path_insert)
                self.assertIn("ON CONFLICT (indicator_pk) DO NOTHING", indicator_insert)
                self.assertFalse(any(f"'{code}'" not in path_insert for code in path_codes))
                self.assertFalse(
                    any(item["pathDesc"] not in indicator_insert for item in indicators)
                )
                self.assertNotIn("UPDATE", path_insert.upper())
                self.assertNotIn("DELETE", path_insert.upper())

    def test_postgres_seed_rejects_unmatched_paths_before_emitting_sql(self):
        original_load = load_dataset

        def load_with_invalid_indicator_path(name):
            data = original_load(name)
            if name == "indicators.json":
                data[0]["pathDesc"] = "PRD > Missing Group > 规模"
            return data

        output = StringIO()
        with patch("demo.seed_loader.load_dataset", side_effect=load_with_invalid_indicator_path):
            with patch("sys.argv", ["seed_postgres.py", "--dialect", "postgres"]):
                with redirect_stdout(output):
                    with self.assertRaisesRegex(
                        ValueError, "indicator PRD00001: missing path node"
                    ):
                        render_demo_seed_sql()
        self.assertEqual("", output.getvalue())

    def test_seed_preserves_and_rejects_legacy_path_rows_before_writes(self):
        connection = sqlite3.connect(self.database)
        try:
            connection.execute(
                "INSERT INTO p_indicator_path_config "
                "(id, parent_id, path_code, path_name, dimension_code, path_level, "
                "full_path, sort_order, status, remark) "
                "VALUES (1, NULL, 'RETL', '零售经营分析', 'retail', 1, 'RETL', 1, 'enabled', 'legacy demo row')"
            )
            connection.commit()
        finally:
            connection.close()

        with self.assertRaisesRegex(
            ValueError, r"p_indicator_path_config row \(id=1\) conflicts"
        ):
            self._seed()

        connection = sqlite3.connect(self.database)
        try:
            self.assertEqual(0, connection.execute("SELECT COUNT(*) FROM p_system").fetchone()[0])
            self.assertEqual(
                [("RETL",)],
                connection.execute(
                    "SELECT path_code FROM p_indicator_path_config WHERE id = 1"
                ).fetchall(),
            )
            self.assertEqual(0, connection.execute("SELECT COUNT(*) FROM p_indicator_item").fetchone()[0])
        finally:
            connection.close()

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
