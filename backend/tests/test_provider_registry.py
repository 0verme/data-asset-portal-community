# pyright: reportMissingImports=false

import unittest
from contextlib import nullcontext
from unittest.mock import patch

from backend.app.core.modules import MODULES
from backend.app.services.providers import list_portal_stats, list_search_entities
from backend.app.services.search_provider import KeywordSearchProvider


class ProviderRegistryTestCase(unittest.TestCase):
    def test_search_entities_cover_manifest_search_flags(self):
        registered_modules = {item["module"] for item in list_search_entities()}
        for code, meta in MODULES.items():
            if meta.get("search_provider"):
                self.assertIn(code, registered_modules)
            else:
                self.assertNotIn(code, registered_modules)

    def test_portal_stats_cover_manifest_stat_flags(self):
        registered_modules = {item["module"] for item in list_portal_stats()}
        for code, meta in MODULES.items():
            if meta.get("portal_stat_provider"):
                self.assertIn(code, registered_modules)
            else:
                self.assertNotIn(code, registered_modules)

    def test_open_module_entities_and_stats_are_registered(self):
        by_type = {item["type"]: item for item in list_search_entities()}
        self.assertEqual("report", by_type["report"]["module"])
        self.assertEqual("apiAsset", by_type["api"]["module"])
        self.assertEqual("codeTable", by_type["codeTable"]["module"])
        stat_keys = {item["key"] for item in list_portal_stats()}
        self.assertTrue({"code_table", "report", "api_asset"} <= stat_keys)

    def test_search_keeps_open_entities_and_applies_menu_status(self):
        provider = KeywordSearchProvider()
        with patch(
            "backend.app.services.search_provider.system_management_service.get_enabled_menu_codes",
            return_value={"report", "apiAsset", "codeTable", "push"},
        ), patch.object(provider, "_connection", return_value=nullcontext(object())), patch.object(
            provider,
            "_search_one_safe",
            side_effect=lambda conn, config, query, limit: {
                "type": config["type"],
                "label": config["label"],
                "module": config["module"],
                "count": 1,
                "items": [{"id": config["type"]}],
            },
        ) as mock_search:
            result = provider.search("支付", scope="all", limit=5)

        searched = [call.args[1]["type"] for call in mock_search.call_args_list]
        self.assertEqual(["downstream", "report", "api", "codeTable"], searched)
        self.assertEqual(4, result["total"])
        self.assertIn("report", {item["module"] for item in provider._registered_configs()})


if __name__ == "__main__":
    unittest.main()
