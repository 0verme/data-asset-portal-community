from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from backend.app.application import Identity
from backend.app.authorization.core import AuthorizationService, AuthorizationSubject
from backend.app.db.sqlite_adapter import connect
from backend.app.fastapi_app import create_fastapi_app
from backend.app.migrations.schema import initialize
from backend.app.services.ai_llm_daily_quota import current_business_date
from backend.app.services.system_management_service import SystemManagementService


class AiLlmDailyQuotaApiTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory(prefix="ai-llm-daily-quota-api-")
        self.addCleanup(self.temp_dir.cleanup)
        root = Path(self.temp_dir.name)
        self.database = root / "system.sqlite"
        self.config_path = root / "database.yaml"
        self.config_path.write_text(
            "profiles:\n"
            "  primary:\n"
            "    type: sqlite\n"
            f"    database: '{self.database.as_posix()}'\n",
            encoding="utf-8",
        )
        self.environment = patch.dict(os.environ, {
            "ASSET_DB_CONFIG_PATH": str(self.config_path),
            "ASSET_DB_PROFILE": "primary",
            "ASSET_AUTH_DB_PROFILE": "primary",
        }, clear=False)
        self.environment.start()
        self.addCleanup(self.environment.stop)
        config = {"type": "sqlite", "database": str(self.database)}
        self.connection = connect(config)
        self.addCleanup(self.connection.close)
        self.assertTrue(initialize(self.connection, config, "sqlite"))
        self.connection.execute(
            "INSERT INTO dwp.p_code_category "
            "(category_id, category_code, category_name, category_desc, display_order, "
            "is_active, created_by, updated_by) "
            "VALUES (9001, 'AI_LLM_QUOTA_CONFIG', 'AI 问答配置', 'Reserved', 999, 'N', 'system', 'system')"
        )
        self.connection.execute(
            "INSERT INTO dwp.p_code_item "
            "(item_id, category_code, item_code, item_name, item_value, item_desc, "
            "display_order, is_active, created_by, updated_by) "
            "VALUES (9001, 'AI_LLM_QUOTA_CONFIG', 'AI_LLM_DAILY_LIMIT', '每日 AI 问答上限', '50', 'Global', 1, 'N', 'system', 'system')"
        )
        self.connection.execute(
            "INSERT INTO dwp.p_ai_llm_daily_usage (scope_key, business_date, used_count) "
            "VALUES ('GLOBAL', ?, 4)",
            (current_business_date().isoformat(),),
        )
        self.connection.commit()
        self.service = SystemManagementService()

    def _client(self, permissions):
        repository = MagicMock()
        repository.get_subject.return_value = AuthorizationSubject("quota-admin", "admin")
        repository.get_permissions.return_value = set(permissions)
        authorization = AuthorizationService(repository)
        return TestClient(create_fastapi_app(
            identity_resolver=lambda _request: Identity("quota-admin", "admin", "Quota Admin"),
            authorization_service_instance=authorization,
            system_management_service_instance=self.service,
        ))

    def test_read_and_update_use_system_permissions_and_required_operation_audit(self):
        client = self._client({"system:param:read", "system:param:write"})
        current = client.get("/api/system/ai-llm-daily-quota")
        self.assertEqual(200, current.status_code, current.text)
        self.assertEqual(50, current.json()["data"]["dailyLimit"])
        self.assertEqual(4, current.json()["data"]["used"])
        self.assertEqual("Asia/Shanghai", current.json()["data"]["timezone"])

        updated = client.put("/api/system/ai-llm-daily-quota", json={"dailyLimit": 17})
        self.assertEqual(200, updated.status_code, updated.text)
        self.assertEqual(17, updated.json()["data"]["dailyLimit"])
        self.assertEqual(4, updated.json()["data"]["used"])
        setting = self.connection.execute(
            "SELECT item_value FROM dwp.p_code_item WHERE item_code = 'AI_LLM_DAILY_LIMIT'"
        ).fetchone()
        audit = self.connection.execute(
            "SELECT module_name, operation_object, request_params FROM dwp.p_operation_log "
            "ORDER BY id DESC LIMIT 1"
        ).fetchone()
        self.assertEqual(("17",), setting)
        self.assertEqual("系统配置", audit[0])
        self.assertEqual("AI_LLM_DAILY_LIMIT", audit[1])
        self.assertIn('"dailyLimit": 17', audit[2])
        self.assertNotIn("secret", audit[2].lower())

    def test_read_only_permission_cannot_update_and_generic_dictionary_hides_reserved_config(self):
        client = self._client({"system:param:read"})
        denied = client.put("/api/system/ai-llm-daily-quota", json={"dailyLimit": 70})
        self.assertEqual(403, denied.status_code, denied.text)
        self.assertEqual([], self.service.get_param_dicts(category_code="AI_LLM_QUOTA_CONFIG"))
        self.assertEqual([], [
            item for item in self.service.get_param_dict_categories()
            if item["code"] == "AI_LLM_QUOTA_CONFIG"
        ])
        value = self.connection.execute(
            "SELECT item_value FROM dwp.p_code_item WHERE item_code = 'AI_LLM_DAILY_LIMIT'"
        ).fetchone()
        self.assertEqual(("50",), value)

    def test_invalid_limits_are_rejected_without_mutation(self):
        client = self._client({"system:param:read", "system:param:write"})
        for invalid in (0, -1, True, "1.5", 2_147_483_648):
            with self.subTest(value=invalid):
                response = client.put("/api/system/ai-llm-daily-quota", json={"dailyLimit": invalid})
                self.assertEqual(422, response.status_code, response.text)
        value = self.connection.execute(
            "SELECT item_value FROM dwp.p_code_item WHERE item_code = 'AI_LLM_DAILY_LIMIT'"
        ).fetchone()
        self.assertEqual(("50",), value)
        audits = self.connection.execute(
            "SELECT COUNT(*) FROM dwp.p_operation_log WHERE operation_object = 'AI_LLM_DAILY_LIMIT'"
        ).fetchone()[0]
        self.assertEqual(0, audits)


if __name__ == "__main__":
    unittest.main()
