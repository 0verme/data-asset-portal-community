"""P2 tests for current-state DB authorization repository queries."""

# pyright: reportMissingImports=false

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.app.application.identity import Identity
from backend.app.authorization.persistence import seed_rbac
from backend.app.authorization.repository import DatabaseAuthorizationRepository
from backend.app.db.sqlite_adapter import connect
from backend.app.migrations.schema import initialize


class DatabaseAuthorizationRepositoryTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory(prefix="authorization-repository-")
        self.addCleanup(self.temp_dir.cleanup)
        self.database = Path(self.temp_dir.name) / "auth.sqlite"
        self.config = {"type": "sqlite", "database": str(self.database)}
        self.connection = connect(self.config)
        self.addCleanup(self.connection.close)
        initialize(self.connection, self.config, "sqlite")
        seed_rbac(self.connection, self.config)
        self.connection.execute(
            "INSERT INTO dwp.p_admin_user "
            "(id, username, password_hash, display_name, role, status) "
            "VALUES (1, 'alice', 'hash', 'Alice', 'admin', 'ACTIVE')"
        )
        self.connection.commit()

    def _fetch_all(self, _profile, sql, params=None):
        cursor = self.connection.cursor()
        try:
            # pi-lens-ignore: python-sql-injection
            cursor.execute(sql, params or ())
            columns = [item[0] for item in cursor.description or ()]
            return columns, cursor.fetchall()
        finally:
            cursor.close()

    def repository(self):
        return DatabaseAuthorizationRepository(profile_resolver=lambda: "test")

    def patched_repository(self):
        return patch.multiple(
            "backend.app.authorization.repository",
            get_db_profile=lambda _profile: self.config,
            fetch_all=self._fetch_all,
        )

    def test_resolves_current_role_and_permissions(self):
        repository = self.repository()
        with self.patched_repository():
            subject = repository.get_subject(Identity("admin", "alice"))
            permissions = tuple(repository.get_permissions("admin"))

        self.assertEqual("alice", subject.username)
        self.assertEqual("admin", subject.role_code)
        self.assertTrue(subject.user_enabled)
        self.assertTrue(subject.role_enabled)
        self.assertIn("system:user:write", permissions)

    def test_disabled_deleted_and_unknown_role_state_is_not_admin(self):
        repository = self.repository()
        with self.patched_repository():
            self.connection.execute(
                "UPDATE dwp.p_admin_user SET status = 'DISABLED' WHERE username = 'alice'"
            )
            self.connection.commit()
            disabled = repository.get_subject(Identity("admin", "alice"))

            self.connection.execute(
                "UPDATE dwp.p_admin_user SET status = 'ACTIVE', role = 'retired' "
                "WHERE username = 'alice'"
            )
            self.connection.commit()
            unknown = repository.get_subject(Identity("admin", "alice"))

            self.connection.execute(
                "DELETE FROM dwp.p_admin_user WHERE username = 'alice'"
            )
            self.connection.commit()
            deleted = repository.get_subject(Identity("admin", "alice"))

        self.assertFalse(disabled.user_enabled)
        self.assertTrue(disabled.role_enabled)
        self.assertEqual("retired", unknown.role_code)
        self.assertFalse(unknown.role_enabled)
        self.assertIsNone(deleted)


if __name__ == "__main__":
    unittest.main()
