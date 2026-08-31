"""P6 role CRUD, permission mapping, and single-role binding tests."""

from __future__ import annotations

# pyright: reportMissingImports=false

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.app.authorization.persistence import seed_rbac
from backend.app.db.sqlite_adapter import connect
from backend.app.migrations.schema import initialize
from backend.app.services.system_management_service import (
    SystemManagementService,
    SystemRoleAssignedError,
    SystemRoleProtectedError,
    SystemValidationError,
)


class RbacRoleManagementTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory(prefix="rbac-role-management-")
        self.addCleanup(self.temp_dir.cleanup)
        root = Path(self.temp_dir.name)
        self.database = root / "roles.sqlite"
        self.config_path = root / "database.yaml"
        self.config_path.write_text(
            "profiles:\n"
            "  primary:\n"
            "    type: sqlite\n"
            f"    database: '{self.database.as_posix()}'\n",
            encoding="utf-8",
        )
        self.environment = patch.dict(
            os.environ,
            {
                "ASSET_DB_CONFIG_PATH": str(self.config_path),
                "ASSET_DB_PROFILE": "primary",
                "ASSET_AUTH_DB_PROFILE": "primary",
            },
            clear=False,
        )
        self.environment.start()
        self.addCleanup(self.environment.stop)

        config = {"type": "sqlite", "database": str(self.database)}
        self.connection = connect(config)
        self.addCleanup(self.connection.close)
        self.assertTrue(initialize(self.connection, config, "sqlite"))
        seed_rbac(self.connection, config)
        self.connection.execute(
            "INSERT INTO dwp.p_admin_user "
            "(id, username, password_hash, display_name, role, status) "
            "VALUES (1, 'admin', 'hash', 'Administrator', 'admin', 'ACTIVE')"
        )
        self.connection.commit()
        self.service = SystemManagementService()

    def _create_role(self, code="indicator-maintainer", permissions=None):
        return self.service.create_role(
            {
                "roleCode": code,
                "name": "Indicator Maintainer",
                "description": "Can maintain indicators",
                "enabled": "enabled",
                "permissionCodes": permissions or ["indicator:write", "indicator:read"],
            }
        )

    def test_lists_registry_permissions_and_builtin_roles(self):
        permissions = self.service.get_permissions()
        self.assertEqual("asset:read", permissions[0]["code"])
        self.assertEqual(30, len(permissions))

        roles = self.service.get_roles()
        self.assertEqual(["admin", "maintainer"], [item["roleCode"] for item in roles])
        self.assertTrue(roles[0]["builtin"])
        self.assertEqual(30, len(roles[0]["permissionCodes"]))

    def test_custom_role_replaces_permission_mapping(self):
        created = self._create_role()
        self.assertEqual(
            ["indicator:read", "indicator:write"],
            created["permissionCodes"],
        )
        updated = self.service.update_role(
            "indicator-maintainer",
            {
                "name": "Indicator Reader",
                "description": "Read-only",
                "enabled": "enabled",
                "permissionCodes": ["indicator:read"],
            },
        )
        self.assertEqual(["indicator:read"], updated["permissionCodes"])
        self.assertEqual("Read-only", updated["description"])

    def test_builtin_roles_are_protected(self):
        with self.assertRaises(SystemRoleProtectedError):
            self.service.update_role(
                "admin", {"name": "Changed", "permissionCodes": []}
            )
        with self.assertRaises(SystemRoleProtectedError):
            self.service.delete_role("maintainer")
        with self.assertRaises(SystemRoleProtectedError):
            self.service.create_role(
                {"roleCode": "admin", "name": "Duplicate", "permissionCodes": []}
            )

    def test_assigned_custom_role_cannot_be_deleted(self):
        self._create_role("temporary-role")
        self.connection.execute(
            "INSERT INTO dwp.p_admin_user "
            "(id, username, password_hash, display_name, role, status) "
            "VALUES (2, 'second-admin', 'hash', 'Second administrator', 'admin', 'ACTIVE')"
        )
        self.connection.commit()
        self.service.update_user_role("admin", {"role": "temporary-role"})
        with self.assertRaises(SystemRoleAssignedError):
            self.service.delete_role("temporary-role")

    def test_single_role_binding_and_last_admin_invariant(self):
        self._create_role("indicator-maintainer")
        with self.assertRaises(SystemValidationError):
            self.service.update_user_role("admin", {"role": "indicator-maintainer"})

        self.connection.execute(
            "INSERT INTO dwp.p_admin_user "
            "(id, username, password_hash, display_name, role, status) "
            "VALUES (2, 'maintainer-user', 'hash', 'Maintainer', 'maintainer', 'ACTIVE')"
        )
        self.connection.commit()
        updated = self.service.update_user_role(
            "maintainer-user", {"role": "indicator-maintainer"}
        )
        self.assertEqual("indicator-maintainer", updated["role"])
        current = next(
            item
            for item in self.service.get_users()
            if item["username"] == "maintainer-user"
        )
        self.assertEqual("indicator-maintainer", current["role"])

    def test_unknown_permission_and_unknown_user_role_are_rejected(self):
        with self.assertRaises(SystemValidationError):
            self._create_role(permissions=["indicator:read", "not-registered:write"])
        with self.assertRaises(SystemValidationError):
            self.service.create_user(
                {
                    "username": "unknown-role",
                    "displayName": "Unknown",
                    "status": "enabled",
                    "role": "missing-role",
                }
            )


if __name__ == "__main__":
    unittest.main()
