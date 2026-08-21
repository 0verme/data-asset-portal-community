from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from sqlalchemy import delete, insert, select, update
from sqlalchemy.dialects import mysql, postgresql, sqlite

from backend.app.db.core import execute_core, fetch_all_core
from backend.app.db.facade import database_transaction
from backend.app.db.metadata import LOGICAL_SCHEMA
from backend.app.db.sqlite_adapter import connect
from backend.app.db.tables import admin_user
from backend.app.migrations.schema import initialize


class SqlAlchemyCoreDialectContractTests(unittest.TestCase):
    def test_representative_crud_compiles_for_all_sqlalchemy_backends(self):
        statements = (
            insert(admin_user).values(
                id=1,
                username="contract-user",
                password_hash="hash",
                status="ACTIVE",
                role="admin",
            ),
            select(admin_user.c.username)
            .where(admin_user.c.username == "contract-user")
            .limit(10)
            .offset(0),
            update(admin_user)
            .where(admin_user.c.username == "contract-user")
            .values(status="DISABLED"),
            delete(admin_user).where(admin_user.c.username == "contract-user"),
        )
        dialects = (sqlite.dialect(), postgresql.dialect(), mysql.dialect())
        for dialect in dialects:
            with self.subTest(dialect=dialect.name):
                for statement in statements:
                    compiled = statement.compile(
                        dialect=dialect,
                        schema_translate_map={LOGICAL_SCHEMA: None},
                    )
                    self.assertNotIn("dwp.", str(compiled).lower())
                select_sql = str(
                    statements[1].compile(
                        dialect=dialect,
                        schema_translate_map={LOGICAL_SCHEMA: None},
                    )
                )
                normalized_select = select_sql.upper()
                self.assertTrue(
                    "OFFSET" in normalized_select
                    or "LIMIT %S, %S" in normalized_select,
                    normalized_select,
                )


class SQLiteDatabaseContractTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory(prefix="db-contract-")
        self.addCleanup(self.temp_dir.cleanup)
        self.database = Path(self.temp_dir.name) / "contract.sqlite"
        self.config = {"type": "sqlite", "database": str(self.database)}
        self.connection = connect(self.config)
        self.addCleanup(self.connection.close)
        self.assertTrue(initialize(self.connection, self.config, "sqlite"))

    def test_crud_and_transaction_rollback_use_the_same_core_contract(self):
        self.connection.close()
        profile = "sqlite_contract"
        from unittest.mock import patch

        with patch("backend.app.db.facade.get_db_profile", return_value=self.config), patch(
            "backend.app.db.core.get_db_profile", return_value=self.config
        ):
            self.assertEqual(
                1,
                execute_core(
                    profile,
                    insert(admin_user).values(
                        username="contract-user",
                        password_hash="hash",
                        status="ACTIVE",
                        role="admin",
                    ),
                ),
            )
            execute_core(
                profile,
                update(admin_user)
                .where(admin_user.c.username == "contract-user")
                .values(status="DISABLED"),
            )
            with self.assertRaisesRegex(RuntimeError, "contract rollback"), database_transaction():
                execute_core(
                    profile,
                    insert(admin_user).values(
                        username="rolled-back",
                        password_hash="hash",
                        status="ACTIVE",
                        role="admin",
                    ),
                )
                raise RuntimeError("contract rollback")

            _, rows = fetch_all_core(profile, select(admin_user.c.username, admin_user.c.status))
            self.assertEqual([("contract-user", "DISABLED")], rows)
            self.assertEqual(
                1,
                execute_core(
                    profile,
                    delete(admin_user).where(admin_user.c.username == "contract-user"),
                ),
            )
            _, rows = fetch_all_core(profile, select(admin_user.c.username))
            self.assertEqual([], rows)


if __name__ == "__main__":
    unittest.main()
