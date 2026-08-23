import io
import unittest
from unittest.mock import patch

from backend.scripts import create_admin
from backend.app.services.system_management_service import SystemUserAlreadyExistsError


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
