# pyright: reportMissingImports=false

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from backend.app.db.sqlite_adapter import connect
from backend.app.fastapi.routers.upstream import _upstream_error_response
from backend.app.migrations.schema import initialize
from backend.app.services.common_code_service import CommonCodeCategoryNotFoundError
from backend.app.services.upstream_service import (
    UpstreamService,
    UpstreamSystemReferencedError,
)
from sqlalchemy.dialects import mysql, postgresql, sqlite


class UpstreamOptionContractTestCase(unittest.TestCase):
    def test_missing_dictionary_categories_use_canonical_fallback_aliases(self):
        service = UpstreamService()
        payload = {
            "id": "up_fallback",
            "abbr": "FALLBACK",
            "name": "Fallback upstream",
            "dbType": "POSTGRESQL",
            "host": "fallback.demo.invalid",
            "unloadTimes": ["02:00"],
            "status": "enabled",
            "dept": "SUPPLY_CHAIN",
        }

        with patch.object(service, "_get_allowed_status_values", return_value={"enabled", "disabled"}), \
                patch(
                    "backend.app.services.upstream_service.common_code_service.get_items",
                    side_effect=CommonCodeCategoryNotFoundError("missing"),
                ):
            normalized = service._normalize_payload(payload)

        self.assertEqual("PostgreSQL", normalized["dbType"])
        self.assertEqual("供应链部", normalized["dept"])


class UpstreamDeleteRelationshipTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory(prefix="upstream-delete-relationship-")
        self.addCleanup(self.temp_dir.cleanup)
        root = Path(self.temp_dir.name)
        self.database = root / "upstream.sqlite"
        self.config_path = root / "database.yaml"
        self.config_path.write_text(
            "profiles:\n"
            "  primary:\n"
            "    type: sqlite\n"
            f"    database: '{self.database.as_posix()}'\n",
            encoding="utf-8",
        )
        environment = patch.dict(
            os.environ,
            {
                "ASSET_DB_CONFIG_PATH": str(self.config_path),
                "ASSET_DB_PROFILE": "primary",
            },
            clear=False,
        )
        environment.start()
        self.addCleanup(environment.stop)

        config = {"type": "sqlite", "database": str(self.database)}
        self.connection = connect(config)
        self.addCleanup(self.connection.close)
        self.assertTrue(initialize(self.connection, config, "sqlite"))
        self.connection.execute(
            "INSERT INTO dwp.p_data_source "
            "(source_id, source_code, source_name, source_type) "
            "VALUES (1, 'upstream-db', 'Upstream DB', 'POSTGRESQL')"
        )
        self.connection.execute(
            "INSERT INTO dwp.p_upstream_system "
            "(system_pk, data_source_id, system_id, system_abbr, system_name, db_type, host_name) "
            "VALUES (7, 1, 'upstream_system', 'UP', 'Upstream System', 'POSTGRESQL', 'db.demo.invalid')"
        )
        self.connection.execute(
            "INSERT INTO dwp.p_upstream_unload_time (time_pk, system_pk, unload_time) "
            "VALUES (9, 7, '01:00')"
        )
        self.connection.execute(
            "INSERT INTO dwp.p_field_mapping_table "
            "(table_pk, data_source_id, upstream_system_id, source_table_name, is_deleted) "
            "VALUES (11, 1, 7, 'source_table', 'Y')"
        )
        self.connection.commit()
        self.service = UpstreamService()
        self.service._db_profile = "primary"

    def test_referenced_hard_delete_is_rejected_without_changing_rows(self):
        with self.assertRaises(UpstreamSystemReferencedError) as context:
            self.service.delete_system("upstream_system")

        self.assertIn("field mappings still reference it", str(context.exception))
        self.assertEqual(409, _upstream_error_response(context.exception).status_code)
        self.assertEqual(
            1,
            self.connection.execute(
                "SELECT COUNT(*) FROM dwp.p_upstream_system WHERE system_pk = 7"
            ).fetchone()[0],
        )
        self.assertEqual(
            1,
            self.connection.execute(
                "SELECT COUNT(*) FROM dwp.p_field_mapping_table "
                "WHERE table_pk = 11 AND is_deleted = 'Y'"
            ).fetchone()[0],
        )
        self.assertEqual(
            1,
            self.connection.execute(
                "SELECT COUNT(*) FROM dwp.p_upstream_unload_time "
                "WHERE time_pk = 9 AND system_pk = 7"
            ).fetchone()[0],
        )


class UpstreamStatusUpdateTestCase(unittest.TestCase):
    def test_status_update_does_not_require_or_rewrite_connection_metadata(self):
        service = UpstreamService()
        public_detail = {
            "id": "up_aml",
            "abbr": "AML",
            "name": "AML system",
            "dbType": "PostgreSQL",
            "unloadTimes": ["23:00"],
            "status": "enabled",
            "owner": "system",
            "dept": "Core Systems",
            "desc": "",
        }
        service.get_system_detail = MagicMock(return_value=public_detail)
        service._fetch_rows_logged = MagicMock(return_value=[{"system_pk": 7}])
        service._next_id = MagicMock(return_value=11)
        service._execute = MagicMock()

        audit = MagicMock()
        audit.__enter__.return_value = audit
        audit.__exit__.return_value = False
        with patch.object(service, "_get_allowed_status_values", return_value={"enabled", "disabled"}), \
                patch("backend.app.services.upstream_service.operation_log_service.audit", return_value=audit):
            result = service.patch_status("up_aml", "disabled")

        service.get_system_detail.assert_called_once_with("up_aml")
        statements = service._execute.call_args.args[0]
        status_statement = str(statements[0].compile(dialect=sqlite.dialect()))
        self.assertIn("p_upstream_system", status_statement)
        self.assertIn("status_code", status_statement)
        self.assertNotIn("host_name", status_statement)
        self.assertFalse(any("DELETE" in str(statement.compile(dialect=sqlite.dialect())) for statement in statements))
        for dialect in (sqlite.dialect(), postgresql.dialect(), mysql.dialect()):
            for statement in statements:
                statement.compile(dialect=dialect)
        self.assertEqual(result["status"], "disabled")


if __name__ == "__main__":
    unittest.main()
