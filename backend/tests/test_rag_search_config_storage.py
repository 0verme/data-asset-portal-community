from __future__ import annotations

import os
import unittest
from unittest.mock import MagicMock, patch

from backend.app.services.system_management_service import (
    SystemDataSourceError,
    SystemManagementService,
    SystemValidationError,
)


class RagSearchConfigStorageTests(unittest.TestCase):
    def _inactive_update(self):
        return {
            "enabled": False,
            "serviceUrl": "",
            "strategy": "keyword",
            "topK": 5,
            "timeoutMs": 2000,
        }

    def test_update_refuses_to_write_when_reserved_category_is_active(self):
        service = SystemManagementService()
        service._core_fetch = MagicMock(return_value=[{
            "item_id": 1,
            "item_active": "N",
            "category_active": "Y",
        }])
        service._core_execute = MagicMock()

        with self.assertRaises(SystemDataSourceError):
            service.update_rag_search_config(self._inactive_update())

        service._core_execute.assert_not_called()

    def test_update_refuses_to_write_when_reserved_item_is_active(self):
        service = SystemManagementService()
        service._core_fetch = MagicMock(return_value=[{
            "item_id": 1,
            "item_active": "Y",
            "category_active": "N",
        }])
        service._core_execute = MagicMock()

        with self.assertRaises(SystemDataSourceError):
            service.update_rag_search_config(self._inactive_update())

        service._core_execute.assert_not_called()

    def test_browser_supplied_token_is_rejected_before_any_database_write(self):
        service = SystemManagementService()
        service._core_fetch = MagicMock()
        service._core_execute = MagicMock()

        with self.assertRaises(SystemValidationError):
            service.update_rag_search_config({
                **self._inactive_update(),
                "serviceToken": "never-store-this-browser-token",
            })

        service._core_fetch.assert_not_called()
        service._core_execute.assert_not_called()

    def test_public_config_only_reports_server_secret_presence(self):
        service = SystemManagementService()
        service._core_fetch = MagicMock(return_value=[])
        with patch.dict(os.environ, {"RAG_SEARCH_SERVICE_TOKEN": "server-only-secret"}):
            public = service.get_rag_search_config_public()

        self.assertFalse(public["enabled"])
        self.assertTrue(public["tokenConfigured"])
        self.assertNotIn("serviceToken", public)
        self.assertNotIn("token", public)
        self.assertNotIn("server-only-secret", str(public))

    def test_reserved_configuration_update_does_not_persist_secret_material(self):
        service = SystemManagementService()
        service._core_fetch = MagicMock(side_effect=[
            [{"item_id": 7, "item_active": "N", "category_active": "N"}],
            [],
            [],
        ])
        service._core_execute = MagicMock()
        from backend.app.services import system_management_service as module

        with patch.object(module.operation_log_service, "audit") as audit:
            audit.return_value.__enter__.return_value = MagicMock()
            audit.return_value.__exit__.return_value = False
            with patch.dict(os.environ, {"RAG_SEARCH_SERVICE_TOKEN": "server-only-secret"}):
                public = service.update_rag_search_config({
                    "enabled": True,
                    "serviceUrl": "https://rag.example.invalid",
                    "strategy": "hybrid",
                    "topK": 5,
                    "timeoutMs": 2000,
                })

        statement = service._core_execute.call_args.args[0][0]
        stored_values = statement.compile().params
        stored_json = next(value for key, value in stored_values.items() if key.startswith("ext_json"))
        self.assertNotIn("server-only-secret", str(stored_json))
        self.assertNotIn("serviceToken", str(stored_json))
        self.assertTrue(public["tokenConfigured"])


if __name__ == "__main__":
    unittest.main()
