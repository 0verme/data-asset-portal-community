from __future__ import annotations

import os
import unittest
from pathlib import Path
from unittest.mock import patch

from sqlalchemy import delete, insert, select
from sqlalchemy.exc import IntegrityError

from backend.app.db.core import execute_core, fetch_all_core
from backend.app.db.facade import clear_engine_cache, database_transaction, execute_many
from backend.app.db.tables import admin_user


MYSQL_PROFILE = "TEST_MYSQL_DATABASE_PROFILE"
MYSQL_CONFIG = "TEST_MYSQL_DATABASE_CONFIG_PATH"


def mysql_configured() -> bool:
    return bool(os.getenv(MYSQL_PROFILE) and Path(os.getenv(MYSQL_CONFIG, "")).is_file())


@unittest.skipUnless(mysql_configured(), "set dedicated MySQL integration profile/config")
class MySQLIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.profile = os.environ[MYSQL_PROFILE]
        self.environment = patch.dict(
            os.environ,
            {
                "ASSET_DB_PROFILE": self.profile,
                "ASSET_DB_CONFIG_PATH": os.environ[MYSQL_CONFIG],
            },
            clear=False,
        )
        self.environment.start()
        clear_engine_cache()
        execute_core(self.profile, delete(admin_user).where(admin_user.c.username.like("contract-%")))

    def tearDown(self):
        clear_engine_cache()
        self.environment.stop()

    def test_crud_batch_pagination_unique_constraint_and_rollback(self):
        execute_many(
            self.profile,
            "INSERT INTO __app__.p_admin_user "
            "(id, username, password_hash, status, role) VALUES (?, ?, ?, ?, ?)",
            [
                (910001, "contract-a", "hash", "ACTIVE", "admin"),
                (910002, "contract-b", "hash", "ACTIVE", "admin"),
            ],
        )
        execute_core(
            self.profile,
            insert(admin_user).values(
                id=910005,
                username="contract-中文😀",
                password_hash="hash",
                display_name="演示用户😀",
                last_login_at=None,
                status="ACTIVE",
                role="admin",
            ),
        )
        columns, rows = fetch_all_core(
            self.profile,
            select(admin_user.c.username, admin_user.c.display_name, admin_user.c.last_login_at)
            .where(admin_user.c.username == "contract-中文😀"),
        )
        self.assertEqual(["username", "display_name", "last_login_at"], columns)
        self.assertEqual([("contract-中文😀", "演示用户😀", None)], rows)
        columns, rows = fetch_all_core(
            self.profile,
            select(admin_user.c.username)
            .where(admin_user.c.username.like("contract-%"))
            .order_by(admin_user.c.username)
            .limit(1)
            .offset(1),
        )
        self.assertEqual(["username"], columns)
        self.assertEqual([("contract-b",)], rows)

        with self.assertRaises(IntegrityError):
            execute_core(
                self.profile,
                insert(admin_user).values(
                    id=910003,
                    username="contract-a",
                    password_hash="hash",
                    status="ACTIVE",
                    role="admin",
                ),
            )

        with self.assertRaisesRegex(RuntimeError, "force rollback"), database_transaction():
            execute_core(
                self.profile,
                insert(admin_user).values(
                    id=910004,
                    username="contract-rollback",
                    password_hash="hash",
                    status="ACTIVE",
                    role="admin",
                ),
            )
            raise RuntimeError("force rollback")
        _, rows = fetch_all_core(
            self.profile,
            select(admin_user.c.username).where(admin_user.c.username == "contract-rollback"),
        )
        self.assertEqual([], rows)


if __name__ == "__main__":
    unittest.main()
