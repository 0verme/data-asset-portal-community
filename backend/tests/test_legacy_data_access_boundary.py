from __future__ import annotations

import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from sqlalchemy import insert, select
from sqlalchemy.dialects import mysql, postgresql, sqlite

from backend.app.db.core import execute_core
from backend.app.db.facade import clear_engine_cache, connect_with_profile, database_transaction
from backend.app.db.tables import admin_user, push_system, system_table
from backend.app.migrations.schema import initialize
from backend.app.services.auth_service import AuthService, AuthValidationError, build_password_hash
from backend.app.services.common_code_service import CommonCodeService
from backend.app.services.indicator_path_service import IndicatorPathService
from backend.app.services.operation_log_service import OperationLogService
from backend.app.services.push_service import PushDataSourceError, PushService


ROOT = Path(__file__).resolve().parents[1]
SERVICES = ROOT / "app" / "services"
MIGRATED_SERVICES = (
    "auth_service.py",
    "common_code_service.py",
    "indicator_path_service.py",
    "operation_log_service.py",
    "push_service.py",
    "system_management_service.py",
)
DIALECTS = (sqlite.dialect(), postgresql.dialect(), mysql.dialect())


class LegacyBoundaryStaticTests(unittest.TestCase):
    def test_enabled_services_do_not_import_deprecated_facade(self):
        offenders = []
        for path in SERVICES.glob("*.py"):
            source = path.read_text(encoding="utf-8-sig")
            if "db.gaussdb" in source or "from ..db.gaussdb" in source:
                offenders.append(path.name)
        self.assertEqual([], offenders)

    def test_migrated_services_have_no_manual_quote_or_physical_schema(self):
        offenders = []
        for name in MIGRATED_SERVICES:
            source = (SERVICES / name).read_text(encoding="utf-8-sig")
            if "def _quote" in source or "_quote(" in source or "dwp." in source:
                offenders.append(name)
        self.assertEqual([], offenders)


class ParameterBindingRegressionTests(unittest.TestCase):
    def assert_bound(self, statement, malicious: str):
        for dialect in DIALECTS:
            with self.subTest(dialect=dialect.name):
                compiled = statement.compile(dialect=dialect)
                rendered = str(compiled)
                self.assertNotIn(malicious, rendered)
                values = compiled.params.values()
                self.assertTrue(
                    any(
                        value == malicious
                        or (isinstance(value, (list, tuple, set)) and malicious in value)
                        for value in values
                    ),
                    compiled.params,
                )

    def test_auth_username_is_a_bind_value_for_read_and_last_login_update(self):
        malicious = "' OR 1=1 --\\;\"; DROP TABLE p_admin_user; 中文"
        service = AuthService()
        service._db.fetch_rows = MagicMock(return_value=[])
        with patch.object(service, "_profile", return_value="test"):
            self.assertIsNone(service._fetch_user(malicious))
        read_statement = service._db.fetch_rows.call_args.args[0]
        self.assert_bound(read_statement, malicious)

        service._fetch_user = MagicMock(
            return_value={
                "username": malicious,
                "password_hash": build_password_hash("correct"),
                "display_name": "bound user",
                "status": "ACTIVE",
                "role": "admin",
            }
        )
        service._db.execute = MagicMock(return_value=1)
        with patch.object(service, "_profile", return_value="test"):
            service.authenticate(malicious, "correct")
        update_statement = service._db.execute.call_args.args[0]
        self.assert_bound(update_statement, malicious)

    def test_push_keyword_and_write_values_are_bound_for_all_sqlalchemy_dialects(self):
        malicious = "' OR 1=1 --\\;中文"
        service = PushService()
        where = service._build_system_where(keyword=malicious)
        self.assert_bound(select(push_system).where(*where), f"%{malicious.lower()}%")

        service._db.next_pk = MagicMock(side_effect=[101, 201])
        statements = service._insert_db_jobs(
            7,
            [
                {
                    "id": "JOB_1",
                    "cn": malicious,
                    "sourcePath": "/source",
                    "sourceFileName": "source.csv",
                    "targetPath": "/target",
                    "targetFileName": "target.csv",
                    "freq": "",
                    "freqType": "T+1",
                    "delimiter": "|",
                    "encoding": "UTF-8",
                    "rowCnt": "",
                    "enabled": True,
                    "desc": "description; DROP TABLE p_push_job",
                    "fields": [
                        {
                            "name": "FIELD_1",
                            "cn": "字段'",
                            "meaning": "meaning\\;",
                            "src": "DWM",
                            "type": "string",
                        }
                    ],
                }
            ],
        )
        self.assertEqual(2, len(statements))
        self.assert_bound(statements[0], malicious)
        for statement in statements:
            self.assertNotIn("DROP TABLE", str(statement.compile(dialect=sqlite.dialect())))

    def test_common_indicator_and_audit_values_are_not_embedded_in_sql(self):
        malicious = "root' OR 1=1 --\\;中文"

        common = CommonCodeService()
        common._db_profile = "test"
        common._db.fetch_rows = MagicMock(return_value=[])
        common.get_items_batch(["ROOTS"])
        common_statement = common._db.fetch_rows.call_args.args[0]
        self.assert_bound(common_statement, "ROOTS")
        self.assertNotIn(malicious, str(common_statement.compile(dialect=sqlite.dialect())))

        indicator = IndicatorPathService()
        indicator._db.fetch_rows = MagicMock(return_value=[])
        indicator.get_path_tree(malicious)
        indicator_statement = indicator._db.fetch_rows.call_args.args[0]
        self.assert_bound(indicator_statement, malicious.upper())

        audit = OperationLogService()
        audit_statement = audit._build_audit_insert_statement(
            module_name="test",
            operation_type="CREATE",
            operation_object=malicious,
            operation_desc=malicious,
        )
        self.assert_bound(audit_statement, malicious)


class SQLitePushTransactionTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory(prefix="dap-139-push-")
        self.addCleanup(self.temp_dir.cleanup)
        self.database = Path(self.temp_dir.name) / "push.sqlite"
        self.environment = patch.dict(
            os.environ,
            {
                "ASSET_DB_CONFIG_PATH": str(ROOT / "configs" / "database.community.yaml"),
                "ASSET_DB_PROFILE": "community_sqlite",
                "ASSET_DB_DATABASE": str(self.database),
            },
            clear=False,
        )
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.addCleanup(clear_engine_cache)
        connection = connect_with_profile("community_sqlite")
        try:
            self.assertTrue(initialize(connection, {"type": "sqlite", "database": str(self.database)}, "sqlite"))
        finally:
            connection.close()
        self.service = PushService()

    def test_auth_malicious_username_cannot_change_query_structure(self):
        execute_core(
            "community_sqlite",
            insert(admin_user).values(
                id=1,
                username="admin",
                password_hash=build_password_hash("correct"),
                display_name="Admin",
                status="ACTIVE",
                role="admin",
            ),
        )
        service = AuthService()
        malicious = "' OR 1=1 --\\;\"; DROP TABLE p_admin_user; 中文"
        with self.assertRaises(AuthValidationError):
            service.authenticate(malicious, "correct")
        self.assertEqual(
            "admin",
            service.authenticate("admin", "correct")["user"],
        )

    def test_mid_transaction_failure_rolls_back_all_push_writes(self):
        system = {
            "system_id": 9001,
            "system_code": "ROLLBACK_SYSTEM",
            "system_name": "Rollback system",
            "system_abbr": "ROLL",
            "description_text": "",
            "system_type": "downstream",
            "department_name": "",
            "status_code": "enabled",
            "created_by": "test",
            "updated_by": "test",
        }
        push = {
            "system_id": 9001,
            "master_system_id": 9001,
            "system_code": "ROLLBACK_SYSTEM",
            "system_name": "Rollback system",
            "system_abbr": "ROLL",
            "protocol_type": "SFTP",
            "host_name": "127.0.0.1",
            "port_no": 22,
            "account_name": "",
            "auth_type": "密钥认证",
            "contact_name": "",
            "data_developer_contact_name": "",
            "dept_name": "",
            "system_desc": "",
            "status_code": "enabled",
            "importance_level_code": "normal",
            "latest_output_time": None,
            "job_count": 0,
            "created_by": "test",
            "updated_by": "test",
        }
        with self.assertRaises(PushDataSourceError):
            with database_transaction():
                self.service._execute_statements(
                    [
                        insert(system_table).values(**system),
                        insert(push_system).values(**push),
                        insert(push_system).values(**push),
                    ]
                )

        connection = sqlite3.connect(self.database)
        try:
            self.assertEqual(0, connection.execute("SELECT COUNT(*) FROM p_system WHERE system_id = 9001").fetchone()[0])
            self.assertEqual(0, connection.execute("SELECT COUNT(*) FROM p_push_system WHERE system_id = 9001").fetchone()[0])
        finally:
            connection.close()


if __name__ == "__main__":
    unittest.main()
