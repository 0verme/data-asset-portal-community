import unittest
from contextlib import nullcontext
from unittest.mock import patch

from backend.app.services.search_provider import KeywordSearchProvider


class SearchProviderRegistryTestCase(unittest.TestCase):
    def setUp(self):
        self.provider = KeywordSearchProvider()

    def _group(self, config):
        return {
            "type": config["type"],
            "label": config["label"],
            "module": config["module"],
            "count": 1,
            "items": [{"id": config["type"]}],
        }

    def test_registered_configs_include_all_repository_entities(self):
        modules = {config["module"] for config in self.provider._registered_configs()}
        self.assertTrue({"dwm", "upstream", "mapping", "root", "indicator", "push", "report", "apiAsset", "codeTable"} <= modules)

    @patch("backend.app.services.search_provider.system_management_service.get_enabled_menu_codes")
    def test_menu_status_filters_open_entities(self, mock_menus):
        mock_menus.return_value = {"dwm"}
        with patch.object(self.provider, "_connection", return_value=nullcontext(object())), patch.object(
            self.provider,
            "_search_one_safe",
            side_effect=lambda conn, config, query, limit: self._group(config),
        ) as mock_search_one:
            result = self.provider.search("首贷", scope="all", limit=5)

        self.assertEqual(["asset"], [call.args[1]["type"] for call in mock_search_one.call_args_list])
        self.assertEqual(["asset"], [group["type"] for group in result["groups"]])

    @patch("backend.app.services.search_provider.system_management_service.get_enabled_menu_codes")
    def test_module_scope_uses_menu_status_not_edition(self, mock_menus):
        mock_menus.return_value = {"push"}
        with patch.object(self.provider, "_connection", return_value=nullcontext(object())), patch.object(
            self.provider,
            "_search_one_safe",
            side_effect=lambda conn, config, query, limit: self._group(config),
        ) as mock_search_one:
            result = self.provider.search("推送", scope="push", limit=5)

        self.assertEqual("downstream", result["scope"])
        self.assertEqual(["downstream"], [call.args[1]["type"] for call in mock_search_one.call_args_list])


if __name__ == "__main__":
    unittest.main()
