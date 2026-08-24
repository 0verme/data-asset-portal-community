import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.app.application import actor_scope, configured_system_actor
from backend.app.db.gaussdb import get_db_profile
from backend.app.settings import get_float_env, get_int_env, get_page_size_limits
from backend.app.services.common_code_service import common_code_service
from backend.app.services.system_management_service import SystemManagementService


class RuntimeSettingsTestCase(unittest.TestCase):
    _ENV_KEYS = (
        "APP_PAGE_SIZE_DEFAULT", "APP_PAGE_SIZE_MAX", "APP_SLOW_SERVICE_SECONDS",
        "ASSET_DB_CONFIG_PATH", "ASSET_DB_HOST", "ASSET_DB_PORT", "ASSET_DB_DATABASE",
        "ASSET_DB_USER", "ASSET_DB_PASSWORD", "ASSET_DB_DSN", "ASSET_DB_JDBC_URL",
        "ASSET_OPERATOR",
    )

    def setUp(self):
        self._original_env = {key: os.getenv(key) for key in self._ENV_KEYS}
        self.addCleanup(self._restore_env)
        for key in self._ENV_KEYS:
            os.environ.pop(key, None)

    def _restore_env(self):
        for key, value in self._original_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def test_invalid_runtime_numbers_use_defaults_and_bounds_are_applied(self):
        os.environ["APP_PAGE_SIZE_DEFAULT"] = "invalid"
        os.environ["APP_PAGE_SIZE_MAX"] = "0"
        os.environ["APP_SLOW_SERVICE_SECONDS"] = "-1"

        self.assertEqual((20, 200), get_page_size_limits(20))
        self.assertEqual(3.0, get_float_env("APP_SLOW_SERVICE_SECONDS", 3.0, minimum=0.0))
        self.assertEqual(30, get_int_env("MISSING_SETTING", 30, minimum=1))

    def test_database_environment_values_override_yaml_and_yaml_remains_supported(self):
        with tempfile.TemporaryDirectory() as directory:
            config_path = Path(directory) / "database.yaml"
            config_path.write_text(
                "profiles:\n  test:\n    type: postgres\n    host: yaml-host\n    port: 5432\n"
                "    database: yaml-db\n    user: yaml-user\n    password: yaml-password\n",
                encoding="utf-8",
            )
            os.environ["ASSET_DB_CONFIG_PATH"] = str(config_path)
            self.assertEqual("yaml-host", get_db_profile("test")["host"])

            os.environ.update({
                "ASSET_DB_HOST": "env-host",
                "ASSET_DB_PORT": "6543",
                "ASSET_DB_DATABASE": "env-db",
                "ASSET_DB_USER": "env-user",
                "ASSET_DB_PASSWORD": "env-password",
            })
            profile = get_db_profile("test")
            self.assertEqual("env-host", profile["host"])
            self.assertEqual(6543, profile["port"])
            self.assertEqual("env-db", profile["database"])
            self.assertEqual("env-user", profile["user"])
            self.assertEqual("env-password", profile["password"])

    def test_system_management_sql_uses_explicit_configured_system_actor(self):
        os.environ["ASSET_OPERATOR"] = "batch-agent"
        service = SystemManagementService()
        statements = []
        service._core_execute = lambda items: statements.extend(items)
        service._ensure_db_category_exists = lambda _: 1
        service.get_param_dict_categories = lambda: [{"code": "test"}]

        with patch.object(common_code_service, "invalidate") as invalidate:
            with actor_scope(configured_system_actor()):
                service._update_param_category_status("test", "enabled")

        compiled = statements[0].compile()
        self.assertIn("updated_by", str(compiled))
        self.assertEqual("batch-agent", compiled.params["updated_by"])
        self.assertEqual("Y", compiled.params["is_active"])
        invalidate.assert_called_once_with(["test"])


if __name__ == "__main__":
    unittest.main()
