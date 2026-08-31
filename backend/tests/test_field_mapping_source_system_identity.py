from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.app.db.sqlite_adapter import connect
from backend.app.fastapi_app import create_fastapi_app
from backend.app.migrations.schema import initialize
from backend.app.services.field_mapping_service import FieldMappingService


class FieldMappingSourceSystemIdentityTests(unittest.TestCase):
    """A display-name collision must not change mapping ownership."""

    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory(prefix="field-mapping-source-system-")
        self.addCleanup(self.temp_dir.cleanup)
        root = Path(self.temp_dir.name)
        self.database = root / "mapping.sqlite"
        self.config = root / "database.yaml"
        self.config.write_text(
            "profiles:\n  mapping:\n    type: sqlite\n"
            f"    database: {self.database.as_posix()}\n",
            encoding="utf-8",
        )
        self.environment = patch.dict(
            os.environ,
            {
                "ASSET_DB_CONFIG_PATH": str(self.config),
                "ASSET_DB_PROFILE": "mapping",
                "APP_SECRET_KEY": "field-mapping-test-only",
            },
            clear=False,
        )
        self.environment.start()
        self.addCleanup(self.environment.stop)

        connection = connect({"type": "sqlite", "database": str(self.database)})
        try:
            self.assertTrue(initialize(connection, {"type": "sqlite", "database": str(self.database)}, "sqlite"))
            connection.executescript(
                """
                INSERT INTO p_data_source
                    (source_id, source_code, source_name, source_type, status_code)
                VALUES
                    (1, 'MEM', '会员档案数据源', 'relational', 'enabled'),
                    (2, 'MEM_TEST', '会员档案数据源', 'relational', 'enabled');
                INSERT INTO p_upstream_system
                    (system_pk, data_source_id, system_id, system_abbr, system_name, db_type, host_name, status_code)
                VALUES
                    (101, 1, 'up_member', 'MEM', '会员档案数据源', 'PostgreSQL', 'member.demo.invalid', 'enabled'),
                    (102, 2, 'up_member_test', 'MEM_TEST', '会员档案数据源', 'PostgreSQL', 'member-test.demo.invalid', 'enabled');
                INSERT INTO p_field_mapping_table
                    (table_pk, data_source_id, upstream_system_id, source_table_name, source_table_cn,
                     target_layer_code, target_table_name, field_total_count, mapped_field_count)
                VALUES
                    (201, 1, 101, 'MEMBER_A', '会员 A', 'DWD', 'DWD_A', 1, 1),
                    (202, NULL, 102, 'MEMBER_B', '会员 B', 'DWD', 'DWD_B', 1, 0);
                INSERT INTO p_field_mapping_field
                    (field_pk, table_pk, source_field_name, source_field_type, source_field_comment,
                     target_field_name, mapping_rule, field_order)
                VALUES
                    (301, 201, 'A_ID', 'INTEGER', 'A id', 'a_id', '直接映射', 1),
                    (302, 202, 'B_ID', 'INTEGER', '', '', '待补充', 1);
                """
            )
            connection.commit()
        finally:
            connection.close()
        self.service = FieldMappingService()

    def test_each_same_name_system_has_independent_field_table_stats_and_options(self):
        options = self.service.get_source_systems()
        self.assertEqual([101, 102], [item["id"] for item in options])
        self.assertEqual(["会员档案数据源", "会员档案数据源"], [item["name"] for item in options])
        self.assertEqual(["MEM", "MEM_TEST"], [item["systemCode"] for item in options])

        expected_tables = {"101": "MEMBER_A", "102": "MEMBER_B"}
        for source_system_id, expected_table in expected_tables.items():
            with self.subTest(source_system_id=source_system_id):
                fields = self.service.get_field_mappings(
                    {"sourceSystemId": source_system_id, "pageSize": 20}
                )
                tables = self.service.get_table_mappings(
                    {"sourceSystemId": source_system_id, "pageSize": 20}
                )
                stats = self.service.get_stats({"sourceSystemId": source_system_id})
                self.assertEqual(1, fields["total"])
                self.assertEqual([expected_table], [item["srcTable"] for item in fields["items"]])
                self.assertEqual(1, tables["total"])
                self.assertEqual([expected_table], [item["srcTable"] for item in tables["items"]])
                self.assertEqual(1, stats["sourceSystemCount"])

    def test_name_filter_is_not_an_identity_shortcut(self):
        result = self.service.get_field_mappings(
            {"srcSystem": "会员档案数据源", "pageSize": 20}
        )
        self.assertEqual(2, result["total"])
        self.assertEqual({"MEMBER_A", "MEMBER_B"}, {item["srcTable"] for item in result["items"]})

    def test_fastapi_uses_source_system_id_for_the_wire_filter(self):
        app = create_fastapi_app(
            identity_resolver=lambda _request: None,
            field_mapping_service_instance=self.service,
        )
        response = TestClient(app).get(
            "/api/field-mappings/fields",
            params={"sourceSystemId": "102", "pageSize": "20"},
        )
        self.assertEqual(200, response.status_code, response.text)
        self.assertEqual(["MEMBER_B"], [item["srcTable"] for item in response.json()["items"]])
        self.assertEqual(102, response.json()["items"][0]["sourceSystemId"])
        self.assertEqual("MEM_TEST", response.json()["items"][0]["systemCode"])


if __name__ == "__main__":
    unittest.main()
