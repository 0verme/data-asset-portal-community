import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.app.application import actor_scope, configured_system_actor
from backend.app.db.facade import get_db_profile
from backend.app.settings import (
    clear_process_db_timeout_overrides,
    get_db_connect_timeout_seconds,
    get_db_statement_timeout_ms,
    get_float_env,
    get_int_env,
    get_page_size_limits,
    set_process_db_timeout_overrides,
)
from backend.app.services.common_code_service import common_code_service
from backend.app.services.system_management_service import SystemManagementService


class RuntimeSettingsTestCase(unittest.TestCase):
    _ENV_KEYS = (
        "ASSET_DB_CONFIG_PATH", "ASSET_DB_HOST", "ASSET_DB_PORT", "ASSET_DB_DATABASE",
        "ASSET_DB_USER", "ASSET_DB_PASSWORD", "ASSET_DB_DSN", "ASSET_DB_JDBC_URL",
        "ASSET_OPERATOR",
    )

    def setUp(self):
        self._original_env = {key: os.getenv(key) for key in self._ENV_KEYS}
        self.addCleanup(self._restore_env)
        self.addCleanup(clear_process_db_timeout_overrides)
        clear_process_db_timeout_overrides()
        for key in self._ENV_KEYS:
            os.environ.pop(key, None)

    def _restore_env(self):
        for key, value in self._original_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def test_invalid_runtime_numbers_use_defaults_and_bounds_are_applied(self):
        self.assertEqual((20, 200), get_page_size_limits(20))
        self.assertEqual((200, 200), get_page_size_limits(500))
        self.assertEqual(3.0, get_float_env("MISSING_FLOAT_SETTING", 3.0, minimum=0.0))
        self.assertEqual(30, get_int_env("MISSING_SETTING", 30, minimum=1))

    def test_database_yaml_is_ssot_and_only_password_secret_can_override(self):
        with tempfile.TemporaryDirectory() as directory:
            config_path = Path(directory) / "database.yaml"
            config_path.write_text(
                "profiles:\n  test:\n    type: postgres\n    host: yaml-host\n    port: 5432\n"
                "    database: yaml-db\n    schema: dap\n    user: yaml-user\n    password: yaml-password\n",
                encoding="utf-8",
            )
            os.environ["ASSET_DB_CONFIG_PATH"] = str(config_path)
            self.assertEqual("yaml-host", get_db_profile("test")["host"])
            self.assertEqual("dap", get_db_profile("test")["schema"])

            os.environ.update({
                "ASSET_DB_HOST": "env-host",
                "ASSET_DB_PORT": "6543",
                "ASSET_DB_DATABASE": "env-db",
                "ASSET_DB_USER": "env-user",
                "ASSET_DB_PASSWORD": "env-password",
            })
            profile = get_db_profile("test")
            self.assertEqual("yaml-host", profile["host"])
            self.assertEqual(5432, profile["port"])
            self.assertEqual("yaml-db", profile["database"])
            self.assertEqual("yaml-user", profile["user"])
            self.assertEqual("env-password", profile["password"])
            self.assertEqual("dap", profile["schema"])

    def test_process_db_timeout_overrides_tighten_profile_in_isolated_worker(self):
        with tempfile.TemporaryDirectory() as directory:
            config_path = Path(directory) / "database.yaml"
            config_path.write_text(
                "profiles:\n  primary:\n    type: postgres\n    host: primary-host\n"
                "    database: assetdb\n    schema: dap\n    user: sample\n    password: placeholder\n",
                encoding="utf-8",
            )
            os.environ["ASSET_DB_CONFIG_PATH"] = str(config_path)
            self.assertEqual(30, get_db_connect_timeout_seconds())
            self.assertEqual(120000, get_db_statement_timeout_ms())
            set_process_db_timeout_overrides(
                connect_timeout=5,
                socket_timeout=10,
                statement_timeout_ms=10000,
            )
            profile = get_db_profile("primary")
            self.assertEqual(5, profile["connect_timeout"])
            self.assertEqual(10, profile["socket_timeout"])
            self.assertEqual(10000, profile["statement_timeout_ms"])

    def test_system_management_sql_uses_immutable_system_actor(self):
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
        self.assertEqual("system", compiled.params["updated_by"])
        self.assertEqual("Y", compiled.params["is_active"])
        invalidate.assert_called_once_with(["test"])


if __name__ == "__main__":
    unittest.main()
