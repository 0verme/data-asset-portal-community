"""P1 persistence, seed, and compatibility tests."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from backend.app.authorization.permissions import (
    BUILTIN_ROLE_PERMISSION_CODES,
    MAINTAINER_ROLE,
    PERMISSION_CODES,
    PERMISSION_DEFINITIONS,
)
from backend.app.authorization.persistence import seed_rbac
from backend.app.db.sqlite_adapter import connect
from backend.app.migrations.schema import initialize


class RbacPersistenceTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory(prefix="rbac-persistence-")
        self.addCleanup(self.temp_dir.cleanup)
        self.database = Path(self.temp_dir.name) / "rbac.sqlite"
        self.config = {"type": "sqlite", "database": str(self.database)}
        self.connection = connect(self.config)
        self.addCleanup(self.connection.close)
        self.assertTrue(initialize(self.connection, self.config, "sqlite"))

    def test_seed_is_deterministic_and_maps_builtin_roles(self):
        first = seed_rbac(self.connection, self.config)
        self.assertEqual(2, first.roles_inserted)
        self.assertEqual(len(PERMISSION_DEFINITIONS), first.permissions_inserted)
        self.assertEqual(
            len(BUILTIN_ROLE_PERMISSION_CODES["admin"])
            + len(BUILTIN_ROLE_PERMISSION_CODES[MAINTAINER_ROLE]),
            first.mappings_inserted,
        )

        second = seed_rbac(self.connection, self.config)
        self.assertEqual(0, second.inserted)
        self.assertEqual(
            len(PERMISSION_CODES),
            self.connection.execute("SELECT COUNT(*) FROM dwp.p_permission").fetchone()[0],
        )
        self.assertEqual(
            len(BUILTIN_ROLE_PERMISSION_CODES["admin"]),
            self.connection.execute(
                "SELECT COUNT(*) FROM dwp.p_role_permission WHERE role_code = 'admin'"
            ).fetchone()[0],
        )
        self.assertEqual(
            len(BUILTIN_ROLE_PERMISSION_CODES[MAINTAINER_ROLE]),
            self.connection.execute(
                "SELECT COUNT(*) FROM dwp.p_role_permission WHERE role_code = 'maintainer'"
            ).fetchone()[0],
        )

    def test_repeat_seed_preserves_custom_role_and_mapping(self):
        seed_rbac(self.connection, self.config)
        self.connection.execute(
            "INSERT INTO dwp.p_role "
            "(role_code, name, description, builtin, enabled) "
            "VALUES ('indicator-maintainer', '指标维护员', 'custom description', 'N', 'Y')"
        )
        self.connection.execute(
            "INSERT INTO dwp.p_role_permission (role_code, permission_code) "
            "VALUES ('indicator-maintainer', 'indicator:read')"
        )
        self.connection.commit()

        result = seed_rbac(self.connection, self.config)

        self.assertEqual(0, result.inserted)
        self.assertEqual(
            ("custom description",),
            self.connection.execute(
                "SELECT description FROM dwp.p_role "
                "WHERE role_code = 'indicator-maintainer'"
            ).fetchone(),
        )
        self.assertEqual(
            ("indicator:read",),
            self.connection.execute(
                "SELECT permission_code FROM dwp.p_role_permission "
                "WHERE role_code = 'indicator-maintainer'"
            ).fetchone(),
        )

    def test_existing_admin_and_maintainer_role_codes_remain_compatible(self):
        self.connection.execute(
            "INSERT INTO dwp.p_admin_user "
            "(id, username, password_hash, display_name, role, status) "
            "VALUES (101, 'legacy-admin', 'hash', 'Legacy admin', 'admin', 'ACTIVE')"
        )
        self.connection.execute(
            "INSERT INTO dwp.p_admin_user "
            "(id, username, password_hash, display_name, role, status) "
            "VALUES (102, 'legacy-maintainer', 'hash', 'Legacy maintainer', 'maintainer', 'ACTIVE')"
        )
        self.connection.commit()

        seed_rbac(self.connection, self.config)

        rows = self.connection.execute(
            "SELECT username, role FROM dwp.p_admin_user ORDER BY id"
        ).fetchall()
        self.assertEqual(
            [("legacy-admin", "admin"), ("legacy-maintainer", "maintainer")],
            rows,
        )

    def test_unknown_role_has_no_default_mapping(self):
        seed_rbac(self.connection, self.config)
        self.connection.execute(
            "INSERT INTO dwp.p_admin_user "
            "(id, username, password_hash, display_name, role, status) "
            "VALUES (103, 'unknown-role', 'hash', 'Unknown', 'retired', 'ACTIVE')"
        )
        self.connection.commit()

        role = self.connection.execute(
            "SELECT role FROM dwp.p_admin_user WHERE username = 'unknown-role'"
        ).fetchone()
        permissions = self.connection.execute(
            "SELECT rp.permission_code FROM dwp.p_role_permission rp "
            "WHERE rp.role_code = ?",
            (role[0],),
        ).fetchall()
        self.assertEqual(("retired",), role)
        self.assertEqual([], permissions)


if __name__ == "__main__":
    unittest.main()
