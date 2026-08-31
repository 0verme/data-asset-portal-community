"""P6 role CRUD, permission mapping, and single-role binding tests."""

from __future__ import annotations

# pyright: reportMissingImports=false

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from backend.app.application import Identity
from backend.app.authorization.core import AuthorizationService, AuthorizationSubject
from backend.app.authorization.permissions import PUBLIC_PERMISSION_CODES
from backend.app.authorization.persistence import seed_rbac
from backend.app.db.sqlite_adapter import connect
from backend.app.fastapi_app import create_fastapi_app
from backend.app.migrations.schema import initialize
from backend.app.services.system_management_service import (
    SystemManagementService,
    SystemRoleAssignedError,
    SystemRoleNotFoundError,
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
        repository = MagicMock()
        repository.get_subject.return_value = AuthorizationSubject("admin", "admin")
        repository.get_permissions.return_value = {
            "system:role:read",
            "system:role:write",
        }
        authorization = AuthorizationService(repository)
        self.client = TestClient(
            create_fastapi_app(
                identity_resolver=lambda _request: Identity(
                    "admin", "admin", "Administrator"
                ),
                authorization_service_instance=authorization,
                system_management_service_instance=self.service,
            )
        )

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
        assignable = self.service.get_role_assignable_permissions()
        self.assertEqual(22, len(assignable))
        self.assertFalse(
            PUBLIC_PERMISSION_CODES & {item["code"] for item in assignable}
        )

        roles = self.service.get_roles()
        self.assertEqual(["admin", "maintainer"], [item["roleCode"] for item in roles])
        self.assertTrue(roles[0]["builtin"])
        self.assertEqual(22, len(roles[0]["permissionCodes"]))
        self.assertEqual(14, len(roles[1]["permissionCodes"]))

    def test_permission_api_keeps_full_registry_and_filters_role_candidates(self):
        full = self.client.get("/api/system/permissions")
        assignable = self.client.get("/api/system/permissions?assignableOnly=true")

        self.assertEqual(200, full.status_code)
        self.assertEqual(200, assignable.status_code)
        self.assertEqual(30, len(full.json()["items"]))
        assignable_codes = {item["code"] for item in assignable.json()["items"]}
        self.assertEqual(22, len(assignable_codes))
        self.assertFalse(PUBLIC_PERMISSION_CODES & assignable_codes)

    def test_custom_role_replaces_permission_mapping(self):
        created = self._create_role()
        self.assertEqual(["indicator:write"], created["permissionCodes"])
        updated = self.service.update_role(
            "indicator-maintainer",
            {
                "name": "Indicator Reader",
                "description": "Read-only",
                "enabled": "enabled",
                "permissionCodes": ["indicator:read"],
            },
        )
        self.assertEqual([], updated["permissionCodes"])
        self.assertEqual("Read-only", updated["description"])

    def test_historical_public_mapping_is_hidden_from_role_payload(self):
        self._create_role("legacy-role", ["asset:write"])
        self.connection.execute(
            "INSERT INTO dwp.p_role_permission (role_code, permission_code) "
            "VALUES ('legacy-role', 'asset:read')"
        )
        self.connection.commit()

        role = next(
            item
            for item in self.service.get_roles()
            if item["roleCode"] == "legacy-role"
        )
        self.assertEqual(["asset:write"], role["permissionCodes"])

    def test_builtin_roles_are_protected(self):
        with self.assertRaises(SystemRoleProtectedError):
            self.service.update_role(
                "admin", {"name": "Changed", "permissionCodes": []}
            )
        for role_code in ("admin", "maintainer"):
            with (
                self.subTest(role_code=role_code),
                self.assertRaises(SystemRoleProtectedError),
            ):
                self.service.delete_role(role_code)
        with self.assertRaises(SystemRoleProtectedError):
            self.service.create_role(
                {"roleCode": "admin", "name": "Duplicate", "permissionCodes": []}
            )

    def test_delete_unknown_role_is_not_found(self):
        with self.assertRaises(SystemRoleNotFoundError):
            self.service.delete_role("missing-role")

    def test_unassigned_custom_role_deletes_role_and_permission_mappings(self):
        self._create_role("temporary-role")
        self.assertEqual(
            1,
            self.connection.execute(
                "SELECT COUNT(*) FROM dwp.p_role_permission WHERE role_code = 'temporary-role'"
            ).fetchone()[0],
        )

        self.service.delete_role("temporary-role")

        self.assertIsNone(
            self.connection.execute(
                "SELECT role_code FROM dwp.p_role WHERE role_code = 'temporary-role'"
            ).fetchone()
        )
        self.assertEqual(
            0,
            self.connection.execute(
                "SELECT COUNT(*) FROM dwp.p_role_permission WHERE role_code = 'temporary-role'"
            ).fetchone()[0],
        )

    def test_custom_role_without_permissions_can_be_deleted(self):
        self.service.create_role(
            {
                "roleCode": "empty-role",
                "name": "Empty role",
                "description": "",
                "enabled": "enabled",
                "permissionCodes": [],
            }
        )

        self.service.delete_role("empty-role")

        self.assertIsNone(
            self.connection.execute(
                "SELECT role_code FROM dwp.p_role WHERE role_code = 'empty-role'"
            ).fetchone()
        )

    def test_delete_rolls_back_permission_mapping_if_role_delete_fails(self):
        self._create_role("transactional-role")
        execute = self.service._core_execute

        def fail_after_mapping(statements):
            execute([statements[0]])
            raise RuntimeError("role delete failed")

        with (
            patch.object(self.service, "_core_execute", side_effect=fail_after_mapping),
            self.assertRaisesRegex(RuntimeError, "role delete failed"),
        ):
            self.service.delete_role("transactional-role")

        self.assertIsNotNone(
            self.connection.execute(
                "SELECT role_code FROM dwp.p_role WHERE role_code = 'transactional-role'"
            ).fetchone()
        )
        self.assertEqual(
            1,
            self.connection.execute(
                "SELECT COUNT(*) FROM dwp.p_role_permission WHERE role_code = 'transactional-role'"
            ).fetchone()[0],
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
        with self.assertRaises(SystemRoleAssignedError) as context:
            self.service.delete_role("temporary-role")
        self.assertIn("1 user(s)", str(context.exception))
        self.assertIsNotNone(
            self.connection.execute(
                "SELECT role_code FROM dwp.p_role WHERE role_code = 'temporary-role'"
            ).fetchone()
        )
        self.assertEqual(
            1,
            self.connection.execute(
                "SELECT COUNT(*) FROM dwp.p_role_permission WHERE role_code = 'temporary-role'"
            ).fetchone()[0],
        )

    def test_delete_role_api_returns_not_found(self):
        response = self.client.delete("/api/system/roles/missing-role")
        self.assertEqual(404, response.status_code)
        self.assertEqual("SYSTEM_ROLE_NOT_FOUND", response.json()["error"]["code"])

    def test_delete_role_api_deletes_unassigned_custom_role(self):
        self._create_role("api-delete-role")

        response = self.client.delete("/api/system/roles/api-delete-role")

        self.assertEqual(200, response.status_code, response.text)
        self.assertEqual("Role deleted", response.json()["message"])
        self.assertIsNone(
            self.connection.execute(
                "SELECT role_code FROM dwp.p_role WHERE role_code = 'api-delete-role'"
            ).fetchone()
        )

    def test_delete_role_api_rejects_builtin_role(self):
        response = self.client.delete("/api/system/roles/admin")
        self.assertEqual(409, response.status_code)
        self.assertEqual("SYSTEM_ROLE_PROTECTED", response.json()["error"]["code"])
        self.assertIsNotNone(
            self.connection.execute(
                "SELECT role_code FROM dwp.p_role WHERE role_code = 'admin'"
            ).fetchone()
        )

    def test_delete_role_api_rejects_assigned_custom_role(self):
        self._create_role("api-assigned-role")
        self.connection.execute(
            "INSERT INTO dwp.p_admin_user "
            "(id, username, password_hash, display_name, role, status) "
            "VALUES (2, 'assigned-user', 'hash', 'Assigned user', 'api-assigned-role', 'ACTIVE')"
        )
        self.connection.commit()

        response = self.client.delete("/api/system/roles/api-assigned-role")

        self.assertEqual(409, response.status_code)
        self.assertEqual("SYSTEM_ROLE_ASSIGNED", response.json()["error"]["code"])
        self.assertIn("1 user(s)", response.json()["error"]["message"])
        self.assertIsNotNone(
            self.connection.execute(
                "SELECT role_code FROM dwp.p_role WHERE role_code = 'api-assigned-role'"
            ).fetchone()
        )
        self.assertEqual(
            1,
            self.connection.execute(
                "SELECT COUNT(*) FROM dwp.p_role_permission WHERE role_code = 'api-assigned-role'"
            ).fetchone()[0],
        )

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
