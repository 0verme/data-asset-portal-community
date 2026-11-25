from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.app.contracts.metadata_ingestion import MetadataAsset, MetadataField
from backend.app.db.facade import normalize_sql_for_profile
from backend.app.db.providers import GaussDBProvider, MySQLProvider, PostgreSQLProvider
from backend.app.db.sqlite_adapter import connect as connect_sqlite
from backend.app.services.assets_service import AssetsService
from backend.app.services.metadata_ingestion_service import MetadataIngestionService
from backend.app.services.portal_service import PortalService
from backend.app.services.providers.registry import list_portal_stats, list_search_entities
from backend.app.services.search_provider import KeywordSearchProvider
from backend.scripts import db_to_init_sql, seed_term_roots
from scripts import sync_from_pg


class RuntimeSqlProfileSchemaTests(unittest.TestCase):
    def test_registered_portal_and_search_sql_is_unqualified(self):
        for config in list_portal_stats():
            with self.subTest(kind="portal", key=config["key"]):
                self.assertNotIn("dwp.", config["from"].lower())

        for config in list_search_entities():
            with self.subTest(kind="search", key=config["type"]):
                self.assertNotIn("dwp.", config["from"].lower())
                field_match = config.get("field_match")
                if field_match:
                    self.assertNotIn("dwp.", field_match["table"].lower())

    def test_community_postgres_profile_defaults_to_dap(self):
        import yaml

        config_path = Path(__file__).resolve().parents[1] / "configs" / "database.community.yaml"
        config = yaml.safe_load(config_path.read_text(encoding="utf-8"))
        self.assertEqual("dap", config["profiles"]["community_postgres"]["schema"])

    def test_postgres_profile_requires_explicit_schema(self):
        base = {"database": "asset_db", "user": "tester", "password": "test-only"}

        with self.assertRaisesRegex(ValueError, "Profile schema"):
            PostgreSQLProvider().validate("missing", dict(base), config_path=Path("database.yaml"))
        with self.assertRaisesRegex(ValueError, "Profile schema"):
            PostgreSQLProvider().physical_schema(dict(base))

        normalized = PostgreSQLProvider().validate(
            "named", {**base, "schema": "DaP"}, config_path=Path("database.yaml")
        )
        self.assertEqual("dap", normalized["schema"])
        self.assertEqual("dap", PostgreSQLProvider().physical_schema(normalized))

    def test_unqualified_sql_is_left_to_each_profile_connection(self):
        sql = "SELECT COUNT(*) FROM p_asset_table"
        profiles = {
            "sqlite_test": {"type": "sqlite", "database": ":memory:"},
            "postgres_test": {"type": "postgres", "schema": "dap"},
            "mysql_test": {"type": "mysql", "database": "dap_db"},
            "gauss_test": {"type": "gaussdb", "schema": "dap"},
        }
        with patch(
            "backend.app.db.facade.get_db_profile",
            side_effect=profiles.__getitem__,
        ):
            for profile in profiles:
                with self.subTest(profile=profile):
                    self.assertEqual(sql, normalize_sql_for_profile(profile, sql))

        self.assertEqual(
            "-c search_path=dap",
            PostgreSQLProvider._options(profiles["postgres_test"]),
        )
        self.assertEqual("", MySQLProvider().physical_schema(profiles["mysql_test"]))
        self.assertEqual("dap", GaussDBProvider().physical_schema(profiles["gauss_test"]))

    def test_explicit_dwp_and_external_schema_are_never_rewritten(self):
        sql = "UPDATE dwp.p_report_asset SET name = 'dwp.example' -- dwp.note"
        profiles = {
            "postgres_test": {"type": "postgres", "schema": "dap"},
            "mysql_test": {"type": "mysql", "database": "asset_db"},
            "gauss_test": {"type": "gaussdb", "schema": "dap"},
        }
        with patch(
            "backend.app.db.facade.get_db_profile",
            side_effect=profiles.__getitem__,
        ):
            for profile in profiles:
                with self.subTest(profile=profile):
                    self.assertEqual(sql, normalize_sql_for_profile(profile, sql))
                    self.assertEqual(
                        "UPDATE upstream_catalog.p_report_asset SET name = 'dwp.example'",
                        normalize_sql_for_profile(
                            profile,
                            "UPDATE upstream_catalog.p_report_asset "
                            "SET name = 'dwp.example'",
                        ),
                    )

    def test_database_export_qualifies_profile_reads_and_explicit_replay_targets(self):
        config = {"type": "gaussdb", "schema": "dap"}
        with patch("backend.scripts.db_to_init_sql.get_db_profile", return_value=config):
            self.assertEqual("dap", db_to_init_sql.profile_schema("gauss_test"))
            source_target = db_to_init_sql.profile_target("gauss_test")

        with patch(
            "backend.scripts.db_to_init_sql.fetch_rows",
            return_value=[{"asset_id": 42}],
        ) as rows:
            self.assertEqual(
                [{"asset_id": 42}],
                db_to_init_sql.load_table_rows(
                    "gauss_test", "p_asset_table", ["asset_id"], source_target
                ),
            )
        source_query = rows.call_args.args[1]
        self.assertEqual(
            'SELECT "asset_id" FROM dap."p_asset_table" ORDER BY "asset_id"',
            source_query,
        )

        pg_target = db_to_init_sql.resolve_output_target("pg", "Dap")
        self.assertEqual("dap", pg_target.schema)
        dws_target = db_to_init_sql.resolve_output_target("dws", "Dap")
        self.assertEqual('"Dap"', dws_target.rendered_schema())
        self.assertIn(
            'DELETE FROM dap."p_admin_user";',
            db_to_init_sql.build_delete_block(pg_target),
        )
        inserts = db_to_init_sql.build_insert_block(
            [("p_asset_table", ["asset_id"], [{"asset_id": 42}])], dws_target
        )
        self.assertIn(
            'INSERT INTO "Dap"."p_asset_table" ("asset_id") VALUES (42);',
            inserts,
        )

    def test_mysql_snapshot_source_is_explicitly_qualified(self):
        target = db_to_init_sql.resolve_write_target(
            {"type": "mysql", "database": "asset_db"}
        )
        with patch(
            "backend.scripts.db_to_init_sql.fetch_rows", return_value=[]
        ) as rows:
            db_to_init_sql.load_table_rows("mysql_source", "p_asset_table", ["id"], target)
        self.assertIn(
            "FROM `asset_db`.`p_asset_table`", rows.call_args.args[1]
        )

    def test_database_export_fails_closed_without_profile_schema(self):
        with patch(
            "backend.scripts.db_to_init_sql.get_db_profile",
            return_value={"type": "postgres"},
        ):
            with self.assertRaisesRegex(ValueError, "explicit Profile schema"):
                db_to_init_sql.profile_schema("postgres_test")

        with self.assertRaises(ValueError):
            db_to_init_sql.resolve_output_target("pg", "dap; DROP SCHEMA public")

    def test_database_export_output_dialect_requires_explicit_choice_for_mysql(self):
        with patch(
            "backend.scripts.db_to_init_sql.get_db_profile",
            return_value={"type": "mysql", "database": "asset_db"},
        ):
            with self.assertRaisesRegex(ValueError, "--dialect auto requires"):
                db_to_init_sql.resolve_output_dialects("mysql_source", "auto")
            self.assertEqual(
                ["pg", "dws"],
                db_to_init_sql.resolve_output_dialects("mysql_source", "both"),
            )

    def test_database_export_requires_explicit_target_schema_argument(self):
        with (
            patch.object(sys, "argv", ["db_to_init_sql.py"]),
            patch("backend.scripts.db_to_init_sql.load_runtime_env"),
            self.assertRaises(SystemExit) as error,
        ):
            db_to_init_sql.main()
        self.assertEqual(2, error.exception.code)

    def test_portal_stats_and_search_resolve_sqlite_attached_schema(self):
        with tempfile.TemporaryDirectory(prefix="profile-schema-runtime-") as temp_dir:
            config = {"type": "sqlite", "database": str(Path(temp_dir) / "app.sqlite")}
            connection = connect_sqlite(config)
            try:
                connection.executescript(
                    """
CREATE TABLE dwp.p_asset_table (
    asset_id INTEGER PRIMARY KEY,
    table_name TEXT NOT NULL,
    table_cn_name TEXT,
    layer_code TEXT,
    domain_code TEXT,
    schema_name TEXT,
    owner_name TEXT,
    grain_desc TEXT,
    cycle_desc TEXT,
    table_desc TEXT,
    is_deleted TEXT NOT NULL
);
CREATE TABLE dwp.p_asset_domain (domain_code TEXT, domain_name TEXT);
CREATE TABLE dwp.p_asset_field (
    asset_id INTEGER,
    field_order INTEGER,
    field_name TEXT,
    field_cn_name TEXT,
    field_desc TEXT,
    is_deleted TEXT NOT NULL
);
INSERT INTO dwp.p_asset_domain VALUES ('A', '主题域 A'), ('B', '主题域 B'), ('X', '已删除资产域');
INSERT INTO dwp.p_asset_table
    (asset_id, table_name, table_cn_name, layer_code, domain_code,
     schema_name, owner_name, grain_desc, cycle_desc, table_desc, is_deleted)
VALUES
    (1, 'active_asset_a', '有效资产 A', 'DWA', 'A', 'DWS_DWA', 'owner', 'grain', 'daily', 'desc', 'N'),
    (2, 'active_asset_b', '有效资产 B', 'DM', 'B', 'DWS_DM', 'owner', 'grain', 'daily', 'desc', 'N'),
    (3, 'deleted_asset', '已删除资产', 'DM', 'X', 'DWS_DM', 'owner', 'grain', 'daily', 'desc', 'Y');
"""
                )
                connection.commit()
            finally:
                connection.close()

            with (
                patch("backend.app.db.facade.get_db_profile", return_value=config),
                patch("backend.app.db.facade.get_engine", return_value=None),
                patch(
                    "backend.app.services.portal_service.system_management_service."
                    "get_enabled_menu_codes",
                    return_value={"dwm"},
                ),
            ):
                portal = PortalService()
                portal._db_profile = "sqlite_test"
                stats = {item["key"]: item["value"] for item in portal.get_stats()}

            self.assertEqual(2, stats["domain"])
            self.assertEqual(2, stats["asset_table"])

            with (
                patch("backend.app.db.facade.get_db_profile", return_value=config),
                patch("backend.app.db.facade.get_engine", return_value=None),
                patch(
                    "backend.app.services.search_provider.system_management_service."
                    "get_enabled_menu_codes",
                    return_value={"dwm"},
                ),
            ):
                search = KeywordSearchProvider()
                search._db_profile = "sqlite_test"
                result = search.search("active_asset", scope="asset", limit=10)

            self.assertEqual(2, result["total"])
            self.assertEqual(
                {"active_asset_a", "active_asset_b"},
                {item["id"] for item in result["groups"][0]["items"]},
            )
            result_ids = {item["id"] for item in result["groups"][0]["items"]}
            self.assertNotIn("deleted_asset", result_ids)

    def test_business_asset_schema_name_is_independent_of_platform_profile_schema(self):
        ingestion = MetadataIngestionService()
        explicit_dwp = ingestion._normalize_asset(
            "warehouse_collector",
            MetadataAsset(
                name="fact_sales",
                schema_name="dwp",
                fields=[MetadataField(name="sale_id", data_type="BIGINT")],
            ),
        )
        self.assertEqual("dwp", explicit_dwp["schema"])

        derived_from_qualified = ingestion._normalize_asset(
            "warehouse_collector",
            MetadataAsset(
                name="fact_orders",
                qualified_name="dwd.fact_orders",
                fields=[MetadataField(name="order_id", data_type="BIGINT")],
            ),
        )
        self.assertEqual("dwd", derived_from_qualified["schema"])

        missing_source_schema = ingestion._normalize_asset(
            "warehouse_collector",
            MetadataAsset(
                name="orphan_table",
                qualified_name="orphan_table",
                fields=[MetadataField(name="id", data_type="BIGINT")],
            ),
        )
        self.assertEqual("external", missing_source_schema["schema"])

        service = AssetsService()
        service._default_schema_prefix = ""
        with (
            patch.object(
                service,
                "_load_domain_mappings",
                return_value=({"TRADE": "交易"}, {"交易": "TRADE"}),
            ),
            patch.object(
                service,
                "get_layers",
                return_value=[{"code": "DWM", "cn": "中间层", "active": True, "count": 0}],
            ),
        ):
            validated_dwp = service._validate_table_payload(
                {
                    "name": "dwm_order_sum_1d",
                    "cn": "订单汇总日表",
                    "domain": "交易",
                    "layer": "DWM",
                    "schema": "dwp",
                    "fields": [
                        {
                            "name": "order_dt",
                            "cn": "订单日期",
                            "type": "VARCHAR(10)",
                            "nullable": False,
                            "pk": True,
                            "part": False,
                        }
                    ],
                }
            )
            validated_missing = service._validate_table_payload(
                {
                    "name": "dwm_order_sum_1d",
                    "cn": "订单汇总日表",
                    "domain": "交易",
                    "layer": "DWM",
                    "fields": [
                        {
                            "name": "order_dt",
                            "cn": "订单日期",
                            "type": "VARCHAR(10)",
                            "nullable": False,
                            "pk": True,
                            "part": False,
                        }
                    ],
                }
            )
        self.assertEqual("dwp", validated_dwp["schema"])
        self.assertEqual("", validated_missing["schema"])

        read_model = service._to_asset_table(
            {
                "asset_id": 10,
                "table_name": "dwp_member_summary",
                "table_cn_name": "会员汇总表",
                "schema_name": "dwp",
                "layer_code": "DWM",
                "domain_name": "会员",
            },
            [],
        )
        self.assertEqual("dwp", read_model["schema"])

    def test_sync_and_seed_scripts_use_dap_or_explicit_profile_schema_without_dwp_fallback(self):
        self.assertEqual("dap", sync_from_pg.resolve_sync_schema(None))
        self.assertEqual("custom_meta", sync_from_pg.resolve_sync_schema("Custom_Meta"))
        for invalid in ("", "   ", "dap; DROP SCHEMA public"):
            with self.subTest(invalid=invalid):
                with self.assertRaises(ValueError):
                    sync_from_pg.resolve_sync_schema(invalid)

        self.assertEqual(
            "postgres:127.0.0.1/asset_portal_test schema=dap",
            seed_term_roots._safe_target(
                "local_test",
                {
                    "type": "postgres",
                    "host": "127.0.0.1",
                    "database": "asset_portal_test",
                    "schema": "dap",
                },
            ),
        )
        with self.assertRaisesRegex(ValueError, "explicit Profile schema"):
            seed_term_roots._safe_target(
                "local_test",
                {
                    "type": "postgres",
                    "host": "127.0.0.1",
                    "database": "asset_portal_test",
                },
            )


if __name__ == "__main__":
    unittest.main()
