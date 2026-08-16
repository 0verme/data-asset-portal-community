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
from unittest.mock import patch

from backend.app.core.capabilities import resolve_capabilities, set_resolved_capabilities
from backend.app.services.portal_service import PortalService


class PortalStatRegistryTestCase(unittest.TestCase):
    def setUp(self):
        self.addCleanup(lambda: set_resolved_capabilities(None))

    def test_capability_disabled_modules_excluded_from_providers(self):
        caps = resolve_capabilities(
            enabled=["portal", "dwm", "root", "system"],
            disabled=[],
            strict=False,
        )
        set_resolved_capabilities(caps)
        service = PortalService()
        modules = {p.code for p in service.registered_stat_providers()}
        self.assertEqual({"dwm", "root"}, modules)
        self.assertNotIn("push", modules)
        self.assertNotIn("upstream", modules)
        self.assertNotIn("apiAsset", modules)

    @patch("backend.app.services.portal_service.system_management_service.get_enabled_menu_codes")
    def test_visible_stats_use_capability_then_menu(self, mock_menus):
        mock_menus.return_value = {"dwm", "root", "push"}
        caps = resolve_capabilities(
            enabled=["portal", "dwm", "root", "system"],
            disabled=[],
            strict=False,
        )
        set_resolved_capabilities(caps)
        service = PortalService()
        modules = [c["module"] for c in service._visible_stat_configs()]
        self.assertIn("dwm", modules)
        self.assertIn("root", modules)
        self.assertNotIn("push", modules)

    def test_zero_stats_does_not_fall_back_to_all_configs(self):
        caps = resolve_capabilities(
            enabled=["portal", "dwm", "system"],
            disabled=[],
            strict=False,
        )
        set_resolved_capabilities(caps)
        service = PortalService()
        with patch.object(service, "_visible_stat_configs", side_effect=RuntimeError("menu boom")):
            items = service.zero_stats()
        keys = {item["key"] for item in items}
        self.assertTrue(keys)
        self.assertIn("asset_table", keys)
        self.assertNotIn("downstream_system", keys)


if __name__ == "__main__":
    unittest.main()
