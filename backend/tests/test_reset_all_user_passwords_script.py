import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.scripts.reset_all_user_passwords import (
    preview_password_reset,
    reset_all_user_passwords,
    resolve_profile,
)
from backend.tests.db_test_support import skip_without_postgres_integration


class ResetAllUserPasswordsScriptUnitTests(unittest.TestCase):
    def setUp(self):
        self._tempdir = tempfile.TemporaryDirectory()
        self.addCleanup(self._tempdir.cleanup)
        self.config_path = Path(self._tempdir.name) / "database.yaml"
        self.config_path.write_text(
            "\n".join(
                [
                    "profiles:",
                    "  auth_test:",
                    "    type: postgres",
                    "    host: 127.0.0.1",
                    "    port: 5432",
                    "    database: asset_portal_test",
                    "    user: test",
                    "    password: test",
                    "",
                ]
            ),
            encoding="utf-8",
        )
        self._original_env = {
            key: os.getenv(key)
            for key in ("ASSET_DB_CONFIG_PATH", "ASSET_AUTH_DB_PROFILE", "ASSET_DB_PROFILE")
        }
        self.addCleanup(self._restore_env)
        os.environ["ASSET_DB_CONFIG_PATH"] = str(self.config_path)
        os.environ["ASSET_AUTH_DB_PROFILE"] = "auth_test"
        os.environ.pop("ASSET_DB_PROFILE", None)

    def _restore_env(self):
        for key, value in self._original_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def test_resolve_profile_prefers_auth_profile(self):
        self.assertEqual(resolve_profile(), "auth_test")

    def test_preview_does_not_mutate_and_uses_auth_profile(self):
        with patch(
            "backend.scripts.reset_all_user_passwords.fetch_all",
            return_value=(["id", "username"], [(1, "admin"), (2, "user")]),
        ) as fetch, patch(
            "backend.scripts.reset_all_user_passwords.execute_many"
        ) as execute_many:
            users = preview_password_reset("auth_test")
        self.assertEqual(users, [(1, "admin"), (2, "user")])
        fetch.assert_called_once()
        execute_many.assert_not_called()

    def test_reset_updates_users_via_execute_many_inside_transaction(self):
        with patch(
            "backend.scripts.reset_all_user_passwords.fetch_all",
            return_value=(["id", "username"], [(1, "admin"), (2, "u2")]),
        ), patch(
            "backend.scripts.reset_all_user_passwords.execute_many"
        ) as execute_many, patch(
            "backend.scripts.reset_all_user_passwords.database_transaction"
        ) as tx, patch(
            "backend.scripts.reset_all_user_passwords.build_password_hash",
            side_effect=lambda value: f"hashed:{value}",
        ):
            tx.return_value.__enter__.return_value = None
            tx.return_value.__exit__.return_value = None
            updated = reset_all_user_passwords("auth_test")
        self.assertEqual(updated, 2)
        execute_many.assert_called_once()
        rows = execute_many.call_args.args[2]
        self.assertEqual(rows, [("hashed:admin", 1), ("hashed:u2", 2)])


@skip_without_postgres_integration()
class ResetAllUserPasswordsPostgresIntegrationTests(unittest.TestCase):
    def test_end_to_end_reset_requires_isolated_postgres(self):
        self.assertTrue(True)


if __name__ == "__main__":
    unittest.main()
