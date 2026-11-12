"""Single-profile contract tests for authentication and database-backed RBAC."""

from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient
from sqlalchemy import select

from backend.app.application import Identity
from backend.app.authorization.core import AuthorizationService
from backend.app.authorization.persistence import seed_rbac
from backend.app.authorization.repository import DatabaseAuthorizationRepository
from backend.app.db import facade
from backend.app.db.core import _compile_statement
from backend.app.db.facade import clear_engine_cache, resolve_db_profile_name
from backend.app.db.sqlite_adapter import connect
from backend.app.fastapi.auth import get_native_session_identity
from backend.app.fastapi_app import create_fastapi_app
from backend.app.migrations.schema import initialize
from backend.app.services.auth_service import (
    AuthConfigurationError,
    AuthDataSourceUnavailableError,
    AuthService,
    AuthValidationError,
    build_password_hash,
)
from backend.app.db.tables import admin_user


class AppDbProfileResolverTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory(prefix="app-db-profile-contract-")
        self.addCleanup(self.temp_dir.cleanup)
        root = Path(self.temp_dir.name)
        self.config_path = root / "database.yaml"
        self.config_path.write_text(
            "profiles:\n"
            "  app:\n"
            "    type: sqlite\n"
            f"    database: '{(root / 'app.sqlite').as_posix()}'\n"
            "  other:\n"
            "    type: sqlite\n"
            f"    database: '{(root / 'other.sqlite').as_posix()}'\n"
            "  primary:\n"
            "    type: sqlite\n"
            f"    database: '{(root / 'primary.sqlite').as_posix()}'\n"
            "  invalid:\n"
            "    type: sqlite\n",
            encoding="utf-8",
        )
        self.environment = patch.dict(
            os.environ,
            {
                "ASSET_DB_CONFIG_PATH": str(self.config_path),
                "ASSET_DB_PROFILE": "app",
                "APP_ENV": "development",
                "APP_SECRET_KEY": "isolated-profile-test-secret",
            },
            clear=True,
        )
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.warning_state = patch.object(facade, "_LEGACY_AUTH_PROFILE_WARNING_EMITTED", False)
        self.warning_state.start()
        self.addCleanup(self.warning_state.stop)

    def test_one_profile_is_required_even_when_primary_exists(self):
        os.environ.pop("ASSET_DB_PROFILE", None)
        os.environ.pop("ASSET_AUTH_DB_PROFILE", None)
        with self.assertRaisesRegex(RuntimeError, "ASSET_DB_PROFILE"):
            resolve_db_profile_name()

        os.environ["ASSET_AUTH_DB_PROFILE"] = "other"
        with self.assertRaisesRegex(RuntimeError, "cannot be used as a replacement"):
            resolve_db_profile_name()

    def test_unknown_application_or_legacy_profile_fails_closed(self):
        os.environ["ASSET_DB_PROFILE"] = "does_not_exist"
        with self.assertRaisesRegex(KeyError, "does_not_exist"):
            resolve_db_profile_name()

        os.environ["ASSET_DB_PROFILE"] = "app"
        os.environ["ASSET_AUTH_DB_PROFILE"] = "does_not_exist"
        with self.assertRaisesRegex(KeyError, "deprecated ASSET_AUTH_DB_PROFILE"):
            resolve_db_profile_name()

    def test_legacy_profile_conflict_is_configuration_error(self):
        os.environ["ASSET_AUTH_DB_PROFILE"] = "other"
        with self.assertRaisesRegex(ValueError, "conflicts with ASSET_DB_PROFILE"):
            resolve_db_profile_name()

        with self.assertRaises(AuthConfigurationError):
            AuthService().authenticate("nobody", "password")

    def test_matching_legacy_profile_only_warns_and_never_selects(self):
        os.environ["ASSET_AUTH_DB_PROFILE"] = "app"
        with self.assertLogs("backend.app.db.facade", level="WARNING") as captured:
            self.assertEqual("app", resolve_db_profile_name())
        self.assertTrue(any("deprecated" in message for message in captured.output))
        self.assertNotIn("isolated-profile-test-secret", " ".join(captured.output))

    def test_selected_profile_configuration_is_validated(self):
        os.environ["ASSET_DB_PROFILE"] = "invalid"
        with self.assertRaisesRegex(ValueError, "requires database"):
            resolve_db_profile_name()

    def test_authorization_configuration_error_is_not_a_denial_or_missing_user(self):
        os.environ.pop("ASSET_DB_PROFILE", None)
        os.environ["ASSET_AUTH_DB_PROFILE"] = "app"
        repository = DatabaseAuthorizationRepository()
        with self.assertRaises(RuntimeError):
            repository.get_subject(Identity("admin", "alice"))

    def test_unavailable_database_is_not_reported_as_invalid_credentials(self):
        with (
            patch("backend.app.db.core.get_engine", return_value=None),
            patch(
                "backend.app.db.core.connect_with_profile",
                side_effect=ConnectionError("synthetic database unavailable"),
            ),
            self.assertRaises(AuthDataSourceUnavailableError),
        ):
            AuthService().authenticate("alice", "wrong-password")


class AuthAndRbacSingleDatabaseIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory(prefix="auth-rbac-single-profile-")
        self.addCleanup(self.temp_dir.cleanup)
        root = Path(self.temp_dir.name)
        self.app_database = root / "app.sqlite"
        self.other_database = root / "other.sqlite"
        self.config_path = root / "database.yaml"
        self.config_path.write_text(
            "profiles:\n"
            "  app:\n"
            "    type: sqlite\n"
            f"    database: '{self.app_database.as_posix()}'\n"
            "  other:\n"
            "    type: sqlite\n"
            f"    database: '{self.other_database.as_posix()}'\n"
            "  primary:\n"
            "    type: sqlite\n"
            f"    database: '{(root / 'primary.sqlite').as_posix()}'\n",
            encoding="utf-8",
        )
        self.environment = patch.dict(
            os.environ,
            {
                "ASSET_DB_CONFIG_PATH": str(self.config_path),
                "ASSET_DB_PROFILE": "app",
                "APP_ENV": "development",
                "APP_SECRET_KEY": "isolated-auth-rbac-session-secret",
            },
            clear=True,
        )
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.addCleanup(clear_engine_cache)
        self._initialize_profile(self.app_database, "app-only-password", "asset:read")
        self._initialize_profile(self.other_database, "other-only-password", "system:user:write")

    def _initialize_profile(self, database: Path, password: str, permission: str):
        config = {"type": "sqlite", "database": str(database)}
        connection = connect(config)
        try:
            initialize(connection, config, "sqlite")
            seed_rbac(connection, config)
            connection.execute(
                "INSERT INTO dwp.p_role "
                "(role_code, name, description, builtin, enabled, created_at, updated_at) "
                "VALUES ('profile_sensitive', 'Profile Sensitive', '', 'N', 'Y', "
                "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            )
            connection.execute(
                "INSERT INTO dwp.p_role_permission (role_code, permission_code) "
                "VALUES ('profile_sensitive', ?)" ,
                (permission,),
            )
            connection.execute(
                "INSERT INTO dwp.p_admin_user "
                "(id, username, password_hash, display_name, role, status) "
                "VALUES (1, 'alice', ?, 'Alice', 'profile_sensitive', 'ACTIVE')",
                (build_password_hash(password),),
            )
            if database == self.other_database:
                connection.execute(
                    "INSERT INTO dwp.p_admin_user "
                    "(id, username, password_hash, display_name, role, status) "
                    "VALUES (2, 'other_only', ?, 'Other Only', 'admin', 'ACTIVE')",
                    (build_password_hash("other-only-user-password"),),
                )
            connection.commit()
        finally:
            connection.close()

    def test_login_session_rbac_and_mutations_all_use_asset_profile(self):
        auth_service = AuthService()
        repository = DatabaseAuthorizationRepository()
        authorization = AuthorizationService(repository)
        operation_logs = MagicMock()
        client = TestClient(
            create_fastapi_app(
                identity_resolver=get_native_session_identity,
                auth_service_instance=auth_service,
                authorization_service_instance=authorization,
                operation_log_service_instance=operation_logs,
            )
        )

        login = client.post(
            "/api/auth/login",
            json={"username": "alice", "password": "app-only-password"},
        )
        self.assertEqual(200, login.status_code, login.text)
        self.assertEqual("profile_sensitive", login.json()["data"]["role"])
        self.assertIn("asset:read", login.json()["data"]["permissions"])
        self.assertNotIn("system:user:write", login.json()["data"]["permissions"])

        restored = client.get("/api/auth/me")
        self.assertEqual(200, restored.status_code, restored.text)
        self.assertEqual("alice", restored.json()["data"]["user"])
        self.assertIn("asset:read", restored.json()["data"]["permissions"])
        self.assertNotIn("system:user:write", restored.json()["data"]["permissions"])

        subject = repository.get_subject(Identity("profile_sensitive", "alice"))
        self.assertEqual("profile_sensitive", subject.role_code)
        self.assertTrue(subject.user_enabled)
        self.assertEqual(("asset:read",), tuple(repository.get_permissions("profile_sensitive")))
        self.assertIsNone(repository.get_subject(Identity("admin", "other_only")))
        with self.assertRaises(AuthValidationError):
            auth_service.authenticate("other_only", "other-only-user-password")

        # The login timestamp write is applied to the selected DAP database.
        for database, expected in ((self.app_database, True), (self.other_database, False)):
            config = {"type": "sqlite", "database": str(database)}
            connection = connect(config)
            try:
                row = connection.execute(
                    "SELECT last_login_at FROM dwp.p_admin_user WHERE username = 'alice'"
                ).fetchone()
            finally:
                connection.close()
            self.assertEqual(expected, bool(row and row[0]))

        # Current user and role state are re-read from the same Profile on each
        # session recovery; disabling either fails closed.
        connection = connect({"type": "sqlite", "database": str(self.app_database)})
        try:
            connection.execute(
                "UPDATE dwp.p_admin_user SET status='DISABLED' WHERE username='alice'"
            )
            connection.commit()
        finally:
            connection.close()
        self.assertEqual(401, client.get("/api/auth/me").status_code)

        connection = connect({"type": "sqlite", "database": str(self.app_database)})
        try:
            connection.execute(
                "UPDATE dwp.p_admin_user SET status='ACTIVE' WHERE username='alice'"
            )
            connection.execute(
                "UPDATE dwp.p_role SET enabled='N' WHERE role_code='profile_sensitive'"
            )
            connection.commit()
        finally:
            connection.close()
        self.assertFalse(
            authorization.authorize(
                Identity("profile_sensitive", "alice"), "asset:read"
            ).allowed
        )
        role_disabled_session = client.get("/api/auth/me")
        self.assertEqual(200, role_disabled_session.status_code)
        self.assertNotIn("asset:read", role_disabled_session.json()["data"]["permissions"])

        logout = client.post("/api/auth/logout")
        self.assertEqual(200, logout.status_code)
        self.assertEqual(401, client.get("/api/auth/me").status_code)

    def test_database_authorization_uses_dynamic_physical_schema(self):
        config = {"type": "gaussdb", "schema": "metadata_catalog"}
        with patch("backend.app.authorization.repository.get_db_profile", return_value=config), patch(
            "backend.app.authorization.repository.fetch_all", return_value=([], [])
        ) as query:
            repository = DatabaseAuthorizationRepository(profile_resolver=lambda: "app")
            repository.get_subject(Identity("admin", "alice"))
        self.assertEqual("app", query.call_args.args[0])
        self.assertIn("metadata_catalog.p_admin_user", query.call_args.args[1])

        with patch("backend.app.db.core.get_db_profile", return_value=config):
            sql, _compiled, _provider = _compile_statement("app", select(admin_user))
        self.assertIn("metadata_catalog.p_admin_user", sql)


if __name__ == "__main__":
    unittest.main()
