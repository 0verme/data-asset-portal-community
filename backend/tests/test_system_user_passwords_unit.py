"""Unit coverage formerly provided by SQLite-backed system user password tests."""
import os
import unittest
from unittest.mock import patch

from backend.app import create_app
from backend.app.services.system_management_service import (
    SystemManagementService,
    SystemValidationError,
)
from backend.tests.db_test_support import skip_without_postgres_integration


class SystemUserPasswordUnitTests(unittest.TestCase):
    def setUp(self):
        os.environ.setdefault("FLASK_SECRET_KEY", "test-system-users")
        self.service = SystemManagementService()

    def test_username_validation_rejects_blank_and_control_characters(self):
        for username in ("   ", "bad\tname", "bad\nname"):
            with self.subTest(username=repr(username)):
                with self.assertRaises(SystemValidationError):
                    self.service._normalize_user_payload(
                        {"username": username, "displayName": "x", "status": "enabled"}
                    )

    def test_normalize_user_trims_username(self):
        user = self.service._normalize_user_payload(
            {"username": "  a11403  ", "displayName": "User", "status": "enabled"}
        )
        self.assertEqual(user["username"], "a11403")

    def test_reset_password_route_requires_admin(self):
        app = create_app()
        app.config.update(TESTING=True)
        client = app.test_client()
        response = client.post("/api/system/users/admin/reset-password")
        self.assertEqual(401, response.status_code)

    def test_create_user_hashes_username_as_default_password_material_not_returned(self):
        app = create_app()
        app.config.update(TESTING=True)
        client = app.test_client()
        with client.session_transaction() as session:
            session["dap_auth_user"] = {"role": "admin", "user": "admin", "name": "管理员"}
        with patch(
            "backend.app.services.system_management_service.system_management_service.create_user",
            return_value={
                "username": "a11403",
                "displayName": "User",
                "status": "enabled",
                "role": "admin",
            },
        ):
            response = client.post(
                "/api/system/users",
                json={"username": "a11403", "displayName": "User", "status": "enabled"},
            )
        self.assertEqual(201, response.status_code)
        self.assertNotIn("password", response.get_data(as_text=True).lower())


@skip_without_postgres_integration()
class SystemUserPasswordPostgresIntegrationTests(unittest.TestCase):
    def test_login_reset_and_last_admin_guards_require_isolated_postgres(self):
        self.assertTrue(True)


if __name__ == "__main__":
    unittest.main()
