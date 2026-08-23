import io
import unittest
from unittest.mock import MagicMock, patch

from backend.scripts import create_admin
from backend.app.services.system_management_service import (
    SystemManagementService,
    SystemUserAlreadyExistsError,
    SystemValidationError,
)


class CreateBootstrapAdminServiceTests(unittest.TestCase):
    def setUp(self):
        self.service = SystemManagementService()

    def test_rejects_blank_and_whitespace_passwords(self):
        for password in ("", "   ", None):
            with self.subTest(password=repr(password)):
                with self.assertRaises(SystemValidationError):
                    self.service.create_bootstrap_admin("admin", "Administrator", password)

    def test_creates_admin_with_supplied_password_hash(self):
        self.service._core.fetch_rows = MagicMock(return_value=[])
        self.service._core.next_pk = MagicMock(return_value=1)
        self.service._core.execute_statements = MagicMock()
        with patch(
            "backend.app.services.system_management_service.build_password_hash",
            return_value="hashed-secret",
        ) as build_hash:
            created = self.service.create_bootstrap_admin(
                "admin", "Administrator", "not-a-default-password"
            )
        self.assertEqual("admin", created)
        build_hash.assert_called_once_with("not-a-default-password")
        insert_statement = self.service._core.execute_statements.call_args.args[0][0]
        compiled = str(insert_statement.compile(compile_kwargs={"literal_binds": False}))
        self.assertIn("p_admin_user", compiled)

    def test_duplicate_username_is_explicit(self):
        self.service._core.fetch_rows = MagicMock(return_value=[{"id": 1}])
        with self.assertRaises(SystemUserAlreadyExistsError):
            self.service.create_bootstrap_admin("admin", "Administrator", "secret")


class CreateAdminCliTests(unittest.TestCase):
    @patch.object(create_admin.system_management_service, "create_bootstrap_admin", return_value="admin")
    @patch("builtins.input", side_effect=["admin", "Administrator"])
    @patch("getpass.getpass", side_effect=["not-a-default-password", "not-a-default-password"])
    def test_success_does_not_print_password(self, getpass, input_mock, create):
        output = io.StringIO()
        with patch("sys.stdout", output):
            self.assertEqual(0, create_admin.main())
        self.assertIn("Admin user 'admin' created successfully.", output.getvalue())
        self.assertNotIn("not-a-default-password", output.getvalue())
        create.assert_called_once_with("admin", "Administrator", "not-a-default-password")

    @patch.object(create_admin.system_management_service, "create_bootstrap_admin")
    @patch("builtins.input", side_effect=["admin", "Administrator"])
    @patch("getpass.getpass", side_effect=["one", "two"])
    def test_mismatched_password_does_not_create(self, getpass, input_mock, create):
        with patch("sys.stderr", new_callable=io.StringIO) as error:
            self.assertEqual(1, create_admin.main())
        create.assert_not_called()
        self.assertIn("does not match", error.getvalue())

    @patch.object(create_admin.system_management_service, "create_bootstrap_admin", side_effect=SystemUserAlreadyExistsError("User already exists: admin"))
    @patch("builtins.input", side_effect=["admin", "Administrator"])
    @patch("getpass.getpass", side_effect=["secret", "secret"])
    def test_duplicate_is_explicit_failure(self, getpass, input_mock, create):
        with patch("sys.stderr", new_callable=io.StringIO) as error:
            self.assertEqual(1, create_admin.main())
        self.assertIn("admin already exists", error.getvalue())


if __name__ == "__main__":
    unittest.main()
