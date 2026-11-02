from __future__ import annotations

import unittest

from backend.app.migrations.rag_search_config_seed import (
    RAG_CONFIG_CATEGORY_CODE,
    RAG_CONFIG_DEFAULTS,
    RAG_CONFIG_DEFAULT_JSON,
    plan_rag_search_config_seed,
)


class RagSearchConfigSeedTests(unittest.TestCase):
    def test_seed_is_disabled_and_uses_existing_ext_json_storage(self):
        plan = plan_rag_search_config_seed([], [])

        self.assertTrue(plan.safe)
        self.assertEqual(1, len(plan.categories))
        self.assertEqual(1, len(plan.items))
        self.assertEqual("N", plan.categories[0]["is_active"])
        self.assertEqual("N", plan.items[0]["is_active"])
        self.assertEqual(RAG_CONFIG_DEFAULT_JSON, plan.items[0]["ext_json"])
        self.assertFalse(RAG_CONFIG_DEFAULTS["enabled"])
        self.assertEqual(RAG_CONFIG_CATEGORY_CODE, plan.items[0]["category_code"])

    def test_existing_configuration_is_preserved_without_reseed(self):
        category = {
            "category_id": 11,
            "category_code": RAG_CONFIG_CATEGORY_CODE,
            "category_name": "RAG 搜索配置",
            "is_active": "N",
        }
        item = {
            "item_id": 19,
            "category_code": RAG_CONFIG_CATEGORY_CODE,
            "item_code": "DEFAULT",
            "item_name": "RAG 相关资产推荐",
            "item_value": "reserved-rag-config",
            "ext_json": '{"enabled":false,"serviceUrl":"https://rag.example.invalid"}',
            "is_active": "N",
        }

        plan = plan_rag_search_config_seed([category], [item])

        self.assertTrue(plan.safe)
        self.assertEqual((), plan.categories)
        self.assertEqual((), plan.items)
        self.assertEqual('{"enabled":false,"serviceUrl":"https://rag.example.invalid"}', item["ext_json"])

    def test_duplicate_or_active_reserved_rows_fail_closed(self):
        category = {
            "category_id": 11,
            "category_code": RAG_CONFIG_CATEGORY_CODE,
            "category_name": "RAG 搜索配置",
            "is_active": "Y",
        }
        plan = plan_rag_search_config_seed([category], [])
        self.assertFalse(plan.safe)
        self.assertIn("inactive", plan.error or "")

        duplicate = plan_rag_search_config_seed([category, category], [])
        self.assertFalse(duplicate.safe)
        self.assertIn("duplicated", duplicate.error or "")


if __name__ == "__main__":
    unittest.main()
