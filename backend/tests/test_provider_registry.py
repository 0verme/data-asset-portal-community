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
from backend.app.core.modules import MODULES
from backend.app.services.providers import list_portal_stats, list_search_entities
from backend.app.services.search_provider import KeywordSearchProvider


class ProviderRegistryTestCase(unittest.TestCase):
    def test_search_entities_cover_manifest_search_flags(self):
        registered_modules = {item["module"] for item in list_search_entities()}
        for code, meta in MODULES.items():
            if meta.get("search_provider"):
                self.assertIn(
                    code,
                    registered_modules,
                    f"module {code} declares search_provider but has no registered entity",
                )
            else:
                self.assertNotIn(
                    code,
                    registered_modules,
                    f"module {code} has search entity but search_provider=False",
                )

    def test_portal_stats_cover_manifest_stat_flags(self):
        registered_modules = {item["module"] for item in list_portal_stats()}
        for code, meta in MODULES.items():
            if meta.get("portal_stat_provider"):
                self.assertIn(
                    code,
                    registered_modules,
                    f"module {code} declares portal_stat_provider but has no registered stat",
                )
            else:
                self.assertNotIn(
                    code,
                    registered_modules,
                    f"module {code} has portal stat but portal_stat_provider=False",
                )

    def test_new_entities_registered(self):
        by_type = {item["type"]: item for item in list_search_entities()}
        self.assertEqual("report", by_type["report"]["module"])
        self.assertEqual("apiAsset", by_type["api"]["module"])
        self.assertEqual("codeTable", by_type["codeTable"]["module"])
        stat_keys = {item["key"] for item in list_portal_stats()}
        self.assertIn("code_table", stat_keys)
        self.assertIn("report", stat_keys)
        self.assertIn("api_asset", stat_keys)

    def test_search_includes_new_entities_when_enabled(self):
        set_resolved_capabilities(
            resolve_capabilities(
                enabled=["portal", "report", "apiAsset", "codeTable", "push", "system"],
                disabled=[],
                strict=False,
            )
        )
        self.addCleanup(lambda: set_resolved_capabilities(None))
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

    def test_disabled_capability_skips_new_entities(self):
        set_resolved_capabilities(
            resolve_capabilities(
                enabled=["portal", "dwm", "system"],
                disabled=[],
                strict=False,
            )
        )
        self.addCleanup(lambda: set_resolved_capabilities(None))
        provider = KeywordSearchProvider()
        modules = {c["module"] for c in provider._registered_configs()}
        self.assertEqual({"dwm"}, modules)
        self.assertNotIn("report", modules)
        self.assertNotIn("apiAsset", modules)
        self.assertNotIn("codeTable", modules)


if __name__ == "__main__":
    unittest.main()
