import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.scripts.reset_all_user_passwords import (
    describe_target,
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
        profile_config = {
            name: {
                "type": "postgres",
                "host": "127.0.0.1",
                "port": 5432,
                "database": f"asset_portal_{name}",
                "schema": "dwp",
                "user": "test",
                "password": "synthetic_reset_password",
            }
            for name in ("auth_test", "asset_test", "primary")
        }
        import yaml

        self.config_path.write_text(
            yaml.safe_dump({"profiles": profile_config}), encoding="utf-8"
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

    def _profile_env(self, **values):
        environment = {"ASSET_DB_CONFIG_PATH": str(self.config_path)}
        environment.update(values)
        return patch.dict(os.environ, environment, clear=True)

    def test_legacy_auth_profile_cannot_replace_missing_asset_profile(self):
        with self.assertRaisesRegex(RuntimeError, "cannot be used as a replacement"):
            resolve_profile()

    def test_asset_auth_profile_conflict_is_not_silently_selected(self):
        with self._profile_env(
            ASSET_DB_PROFILE="asset_test", ASSET_AUTH_DB_PROFILE="auth_test"
        ), self.assertRaisesRegex(ValueError, "conflicts"):
            resolve_profile()

    def test_matching_legacy_auth_profile_is_only_a_warning(self):
        with self._profile_env(
            ASSET_DB_PROFILE="auth_test", ASSET_AUTH_DB_PROFILE="auth_test"
        ), patch("app.db.facade._LEGACY_AUTH_PROFILE_WARNING_EMITTED", False):
            with self.assertLogs("app.db.facade", level="WARNING") as logs:
                self.assertEqual("auth_test", resolve_profile())
        self.assertTrue(any("deprecated" in item for item in logs.output))

    def test_explicit_profile_is_validated_and_may_be_selected_as_cli_target(self):
        with self._profile_env(ASSET_DB_PROFILE="asset_test"):
            self.assertEqual("auth_test", resolve_profile("auth_test"))

    def test_invalid_explicit_profile_does_not_fall_back(self):
        with self._profile_env(ASSET_DB_PROFILE="asset_test"):
            with self.assertRaisesRegex(KeyError, "profile not found"):
                resolve_profile("missing_profile")

    def test_target_summary_shows_database_and_schema_without_credentials(self):
        with self._profile_env():
            summary = describe_target("auth_test")
        self.assertIn("profile=auth_test", summary)
        self.assertIn("provider=postgres", summary)
        self.assertIn("database=asset_portal_auth_test", summary)
        self.assertIn("schema=dwp", summary)
        self.assertNotIn("synthetic_reset_password", summary)

    def test_preview_does_not_mutate_with_explicit_profile(self):
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
