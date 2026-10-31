from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.app.db.facade import clear_engine_cache
from backend.app.db.sqlite_adapter import connect
from backend.app.migrations.schema import initialize
from backend.app.services.field_mapping_service import FieldMappingService

PROFILE = "field_mapping_stats_consistency"


class FieldMappingStatsConsistencyTests(unittest.TestCase):
    def setUp(self):
        scratch_root = os.environ.get("DAP_403_TEST_ROOT")
        if scratch_root:
            Path(scratch_root).mkdir(parents=True, exist_ok=True)
        self.temp_dir = tempfile.TemporaryDirectory(
            prefix="field-mapping-stats-consistency-", dir=scratch_root
        )
        self.addCleanup(self.temp_dir.cleanup)
        root = Path(self.temp_dir.name)
        self.database = root / "synthetic.sqlite"
        self.config_path = root / "database.yaml"
        self.config_path.write_text(
            f"profiles:\n  {PROFILE}:\n    type: sqlite\n    database: '{self.database.as_posix()}'\n",
            encoding="utf-8",
        )
        self.environment = patch.dict(
            os.environ,
            {
                "ASSET_DB_CONFIG_PATH": str(self.config_path),
                "ASSET_DB_PROFILE": PROFILE,
            },
            clear=False,
        )
        self.environment.start()
        self.addCleanup(self.environment.stop)
        clear_engine_cache()
        self.addCleanup(clear_engine_cache)

        connection = connect({"type": "sqlite", "database": str(self.database)})
        try:
            self.assertTrue(
                initialize(
                    connection,
                    {"type": "sqlite", "database": str(self.database)},
                    "sqlite",
                )
            )
            connection.execute(
                "INSERT INTO dwp.p_data_source "
                "(source_id, source_code, source_name, source_type, status_code) "
                "VALUES (1, 'SYN', 'Synthetic', 'synthetic', 'enabled')"
            )
            connection.execute(
                "INSERT INTO dwp.p_upstream_system "
                "(system_pk, data_source_id, system_id, system_abbr, system_name, "
                "db_type, host_name, status_code) "
                "VALUES (101, 1, 'synthetic-1', 'SYN', 'Synthetic', 'SQLite', "
                "'synthetic.invalid', 'enabled')"
            )
            connection.execute(
                "INSERT INTO dwp.p_field_mapping_table "
                "(table_pk, data_source_id, upstream_system_id, source_table_name, "
                "target_layer_code, target_table_name, field_total_count, mapped_field_count) "
                "VALUES (201, 1, 101, 'synthetic_table', 'DWF', 'dwf_synthetic', 1, 1)"
            )
            connection.execute(
                "INSERT INTO dwp.p_field_mapping_field "
                "(field_pk, table_pk, source_field_name, source_field_type, "
                "source_field_comment, target_field_name, mapping_rule, field_order) "
                "VALUES (301, 201, 'field_1', 'TEXT', 'synthetic', 'target_1', 'direct', 1)"
            )
            connection.commit()
        finally:
            connection.close()

        self.service_a = FieldMappingService(db_profile=PROFILE)
        # A second service instance models a separate application worker's memory.
        self.service_b = FieldMappingService(db_profile=PROFILE)

    def test_external_sql_write_is_visible_to_all_service_instances(self):
        self.assertEqual(1, self.service_a.get_stats()["fieldCount"])
        self.assertEqual(1, self.service_b.get_stats()["fieldCount"])

        external_writer = connect({"type": "sqlite", "database": str(self.database)})
        try:
            external_writer.execute(
                "INSERT INTO dwp.p_field_mapping_field "
                "(field_pk, table_pk, source_field_name, source_field_type, "
                "source_field_comment, target_field_name, mapping_rule, field_order) "
                "VALUES (302, 201, 'field_2', 'TEXT', '', NULL, 'pending', 2)"
            )
            external_writer.commit()
        finally:
            external_writer.close()

        for service in (self.service_a, self.service_b):
            with self.subTest(service=service):
                self.assertEqual(2, service.get_stats()["fieldCount"])
                self.assertEqual(2, service.get_field_mappings({"pageSize": 50})["total"])
                self.assertEqual(
                    2,
                    service.get_table_mappings({"pageSize": 50})["items"][0]["fieldCount"],
                )

    def test_high_cardinality_searches_do_not_reuse_or_retain_cached_stats(self):
        calls = 0
        fetch_rows = self.service_a._fetch_rows

        def count_queries(statement):
            nonlocal calls
            calls += 1
            return fetch_rows(statement)

        self.service_a._fetch_rows = count_queries
        for index in range(30):
            result = self.service_a.get_stats({"keyword": f"synthetic-no-match-{index}"})
            self.assertEqual(0, result["fieldCount"])

        self.assertEqual(30, calls)
        self.assertFalse(hasattr(self.service_a, "_stats_cache"))


if __name__ == "__main__":
    unittest.main()
