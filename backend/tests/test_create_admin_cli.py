import io
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from backend.scripts import create_admin
from backend.app.services.system_management_service import (
    SystemDataSourceError,
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
    def setUp(self):
        self._original_profile = os.environ.get("ASSET_DB_PROFILE")
        self._original_runtime = os.environ.get("ASSET_RUNTIME_PROFILE")
        self.addCleanup(self._restore_env)

    def _restore_env(self):
        for key, value in (
            ("ASSET_DB_PROFILE", self._original_profile),
            ("ASSET_RUNTIME_PROFILE", self._original_runtime),
        ):
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    @patch.object(create_admin, "_load_runtime")
    @patch.object(create_admin.system_management_service, "create_bootstrap_admin", return_value="admin")
    @patch("builtins.input", side_effect=["admin", "Administrator"])
    @patch("getpass.getpass", side_effect=["not-a-default-password", "not-a-default-password"])
    def test_success_does_not_print_password(self, getpass, input_mock, create, load_runtime):
        output = io.StringIO()
        with patch("sys.stdout", output):
            self.assertEqual(0, create_admin.main())
        load_runtime.assert_called_once_with()
        self.assertIn("Admin user 'admin' created successfully.", output.getvalue())
        self.assertNotIn("not-a-default-password", output.getvalue())
        create.assert_called_once_with("admin", "Administrator", "not-a-default-password")

    @patch.object(create_admin, "_load_runtime")
    @patch.object(create_admin.system_management_service, "create_bootstrap_admin")
    @patch("builtins.input", side_effect=["admin", "Administrator"])
    @patch("getpass.getpass", side_effect=["one", "two"])
    def test_mismatched_password_does_not_create(self, getpass, input_mock, create, load_runtime):
        with patch("sys.stderr", new_callable=io.StringIO) as error:
            self.assertEqual(1, create_admin.main())
        create.assert_not_called()
        self.assertIn("does not match", error.getvalue())

    @patch.object(create_admin, "_load_runtime")
    @patch.object(create_admin.system_management_service, "create_bootstrap_admin", side_effect=SystemUserAlreadyExistsError("User already exists: admin"))
    @patch("builtins.input", side_effect=["admin", "Administrator"])
    @patch("getpass.getpass", side_effect=["secret", "secret"])
    def test_duplicate_is_explicit_failure(self, getpass, input_mock, create, load_runtime):
        with patch("sys.stderr", new_callable=io.StringIO) as error:
            self.assertEqual(1, create_admin.main())
        self.assertIn("admin already exists", error.getvalue())

    def test_loads_asset_db_profile_from_env_local_when_process_env_absent(self):
        """Regression: .env.local-only deployments must resolve ASSET_DB_PROFILE."""
        import app.settings as app_settings
        import backend.app.settings as backend_settings

        seen = {}

        def _capture(username, display_name, password):
            seen["ASSET_DB_PROFILE"] = os.environ.get("ASSET_DB_PROFILE")
            return username

        with tempfile.TemporaryDirectory() as directory:
            env_file = Path(directory) / ".env.local"
            env_file.write_text(
                "ASSET_DB_PROFILE=cli_env_local_profile\n",
                encoding="utf-8",
            )
            os.environ.pop("ASSET_DB_PROFILE", None)
            # create_admin may import settings as app.* or backend.app.* depending on sys.path.
            with (
                patch.object(app_settings, "_ENV_FILES", (env_file,)),
                patch.object(backend_settings, "_ENV_FILES", (env_file,)),
                patch.object(
                    create_admin.system_management_service,
                    "create_bootstrap_admin",
                    side_effect=_capture,
                ),
                patch("builtins.input", side_effect=["admin", "Administrator"]),
                patch("getpass.getpass", side_effect=["secret", "secret"]),
                patch("sys.stdout", new_callable=io.StringIO),
            ):
                self.assertIsNone(os.environ.get("ASSET_DB_PROFILE"))
                self.assertEqual(0, create_admin.main())

        self.assertEqual("cli_env_local_profile", seen.get("ASSET_DB_PROFILE"))

    def test_missing_profile_is_not_reported_as_schema_uninitialized(self):
        missing = RuntimeError("Missing required database profile env var: ASSET_DB_PROFILE")
        wrapped = SystemDataSourceError("数据库服务暂不可用，请稍后重试")
        wrapped.__cause__ = missing

        with (
            patch.object(create_admin, "_load_runtime"),
            patch.object(
                create_admin.system_management_service,
                "create_bootstrap_admin",
                side_effect=wrapped,
            ),
            patch("builtins.input", side_effect=["admin", "Administrator"]),
            patch("getpass.getpass", side_effect=["secret", "secret"]),
            patch("sys.stderr", new_callable=io.StringIO) as error,
        ):
            self.assertEqual(1, create_admin.main())

        text = error.getvalue()
        self.assertIn("Database configuration is not ready", text)
        self.assertNotIn("schema is not initialized", text)
        self.assertNotIn("migration", text.lower())

    def test_operational_data_source_failure_still_points_at_migration(self):
        operational = Exception("relation p_admin_user does not exist")
        wrapped = SystemDataSourceError("数据库查询失败")
        wrapped.__cause__ = operational

        with (
            patch.object(create_admin, "_load_runtime"),
            patch.object(
                create_admin.system_management_service,
                "create_bootstrap_admin",
                side_effect=wrapped,
            ),
            patch("builtins.input", side_effect=["admin", "Administrator"]),
            patch("getpass.getpass", side_effect=["secret", "secret"]),
            patch("sys.stderr", new_callable=io.StringIO) as error,
        ):
            self.assertEqual(1, create_admin.main())

        text = error.getvalue()
        self.assertIn("schema is not initialized", text)
        self.assertIn("migration", text.lower())
        self.assertNotIn("relation p_admin_user", text)


if __name__ == "__main__":
    unittest.main()
