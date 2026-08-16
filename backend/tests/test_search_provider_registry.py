# Copyright 2025 Jearhe
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

import unittest
from contextlib import nullcontext
from unittest.mock import patch

from backend.app.core.capabilities import resolve_capabilities, set_resolved_capabilities
from backend.app.services.search_provider import KeywordSearchProvider


class SearchProviderRegistryTestCase(unittest.TestCase):
    def setUp(self):
        self.provider = KeywordSearchProvider()
        self.addCleanup(lambda: set_resolved_capabilities(None))

    def _group(self, config):
        return {
            "type": config["type"],
            "label": config["label"],
            "module": config["module"],
            "count": 1,
            "items": [{"id": config["type"]}],
        }

    def test_disabled_module_not_in_registered_configs(self):
        caps = resolve_capabilities(
            enabled=["portal", "dwm", "root", "system"],
            disabled=[],
            strict=False,
        )
        set_resolved_capabilities(caps)
        modules = {c["module"] for c in self.provider._registered_configs()}
        self.assertEqual({"dwm", "root"}, modules)
        self.assertNotIn("push", modules)
        self.assertNotIn("upstream", modules)
        self.assertNotIn("mapping", modules)

    @patch("backend.app.services.search_provider.system_management_service.get_enabled_menu_codes")
    def test_search_skips_capability_disabled_even_if_menu_enabled(self, mock_menus):
        mock_menus.return_value = {"dwm", "upstream", "mapping", "root", "indicator", "push"}
        caps = resolve_capabilities(
            enabled=["portal", "dwm", "root", "system"],
            disabled=[],
            strict=False,
        )
        set_resolved_capabilities(caps)

        with patch.object(self.provider, "_connection", return_value=nullcontext(object())), patch.object(
            self.provider,
            "_search_one_safe",
            side_effect=lambda conn, config, query, limit: self._group(config),
        ) as mock_search_one:
            result = self.provider.search("首贷", scope="all", limit=5)

        searched = [call.args[1]["type"] for call in mock_search_one.call_args_list]
        self.assertEqual(["asset", "root"], searched)
        self.assertNotIn("downstream", searched)
        self.assertNotIn("system", [g["type"] for g in result["groups"] if g["count"]])

    @patch("backend.app.services.search_provider.system_management_service.get_enabled_menu_codes")
    def test_menu_still_filters_within_enabled_capabilities(self, mock_menus):
        mock_menus.return_value = {"dwm"}
        caps = resolve_capabilities(enabled=None, disabled=[], strict=False)
        set_resolved_capabilities(caps)

        with patch.object(self.provider, "_connection", return_value=nullcontext(object())), patch.object(
            self.provider,
            "_search_one_safe",
            side_effect=lambda conn, config, query, limit: self._group(config),
        ) as mock_search_one:
            self.provider.search("首贷", scope="all", limit=5)

        self.assertEqual(["asset"], [call.args[1]["type"] for call in mock_search_one.call_args_list])


if __name__ == "__main__":
    unittest.main()
