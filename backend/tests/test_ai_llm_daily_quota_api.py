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
from backend.app.services.ai_llm_provider import get_effective_ai_llm_config
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

    def test_llm_settings_persist_hot_reload_and_keep_api_key_server_only(self):
        client = self._client({"system:param:read", "system:param:write"})
        with patch.dict(os.environ, {"AI_LLM_API_KEY": ""}, clear=False):
            initial = client.get("/api/system/ai-llm-daily-quota")
            self.assertEqual(200, initial.status_code, initial.text)
            data = initial.json()["data"]
            self.assertFalse(data["enabled"])
            self.assertFalse(data["apiKeyConfigured"])
            self.assertEqual(30000, data["timeoutMs"])
            self.assertEqual(3072, data["maxTokens"])
            self.assertFalse(data["disableThinking"])

            # Enabling without AI_LLM_API_KEY must fail closed.
            missing_key = client.put("/api/system/ai-llm-daily-quota", json={
                "enabled": True,
                "baseUrl": "https://llm.example.invalid/v1",
                "model": "deepseek-chat",
            })
            self.assertEqual(422, missing_key.status_code, missing_key.text)

        # Reject any secret keys in browser payload.
        for secret_field in ("apiKey", "api_key", "token", "authorization"):
            with self.subTest(secret_field=secret_field):
                rejected = client.put("/api/system/ai-llm-daily-quota", json={
                    "dailyLimit": 50,
                    secret_field: "sk-must-not-be-accepted",
                })
                self.assertEqual(422, rejected.status_code, rejected.text)

        # Reject non-loopback HTTP baseUrl.
        bad_url = client.put("/api/system/ai-llm-daily-quota", json={
            "baseUrl": "http://llm.example.invalid:8000/v1",
        })
        self.assertEqual(422, bad_url.status_code, bad_url.text)

        # Save complete settings with AI_LLM_API_KEY configured in backend env.
        with patch.dict(os.environ, {"AI_LLM_API_KEY": "sk-test-secret-value"}, clear=False):
            updated = client.put("/api/system/ai-llm-daily-quota", json={
                "dailyLimit": 88,
                "enabled": True,
                "baseUrl": "https://llm.example.invalid/v1/",
                "model": "deepseek-chat",
                "timeoutMs": 15000,
                "maxTokens": 2048,
                "disableThinking": True,
            })
            self.assertEqual(200, updated.status_code, updated.text)
            body = updated.json()["data"]
            self.assertTrue(body["enabled"])
            self.assertEqual("https://llm.example.invalid/v1", body["baseUrl"])
            self.assertEqual("deepseek-chat", body["model"])
            self.assertEqual(15000, body["timeoutMs"])
            self.assertEqual(2048, body["maxTokens"])
            self.assertTrue(body["disableThinking"])
            self.assertEqual(88, body["dailyLimit"])
            self.assertTrue(body["apiKeyConfigured"])
            self.assertNotIn("sk-test-secret-value", updated.text)

            # Hot-reload check: runtime config reflects DB changes immediately.
            effective = get_effective_ai_llm_config()
            self.assertIsNotNone(effective)
            assert effective is not None
            self.assertTrue(effective.enabled)
            self.assertEqual("https://llm.example.invalid/v1", effective.base_url)
            self.assertEqual("deepseek-chat", effective.model)
            self.assertEqual(15000, effective.timeout_ms)
            self.assertEqual(2048, effective.max_tokens)
            self.assertTrue(effective.disable_thinking)
            self.assertEqual("sk-test-secret-value", effective.api_key)

            # Disabling in DB overrides AI_ASK_ENABLED=true in env immediately.
            with patch.dict(os.environ, {"AI_ASK_ENABLED": "true"}, clear=False):
                disabled = client.put("/api/system/ai-llm-daily-quota", json={"enabled": False})
                self.assertEqual(200, disabled.status_code, disabled.text)
                effective_after = get_effective_ai_llm_config()
                self.assertIsNotNone(effective_after)
                assert effective_after is not None
                self.assertFalse(effective_after.enabled)

        # Secret never persisted in ext_json or audit log.
        stored_ext = self.connection.execute(
            "SELECT ext_json FROM dwp.p_code_item WHERE item_code = 'AI_LLM_DAILY_LIMIT'"
        ).fetchone()[0]
        self.assertNotIn("sk-test-secret-value", str(stored_ext))
        audit_row = self.connection.execute(
            "SELECT request_params FROM dwp.p_operation_log ORDER BY id DESC LIMIT 1"
        ).fetchone()[0]
        self.assertNotIn("sk-test-secret-value", str(audit_row))


if __name__ == "__main__":
    unittest.main()
