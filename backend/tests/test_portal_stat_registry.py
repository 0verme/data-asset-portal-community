import unittest
from unittest.mock import patch

from backend.app.services.portal_service import PortalService


class PortalStatRegistryTestCase(unittest.TestCase):
    def test_registered_stats_cover_open_persistent_modules(self):
        service = PortalService()
        modules = {provider.code for provider in service.registered_stat_providers()}
        self.assertTrue({"dwm", "upstream", "push", "report", "apiAsset", "codeTable", "root", "indicator"} <= modules)

    @patch("backend.app.services.portal_service.system_management_service.get_enabled_menu_codes")
    def test_visible_stats_use_menu_status_only(self, mock_menus):
        mock_menus.return_value = {"dwm", "root", "push"}
        service = PortalService()
        modules = [config["module"] for config in service._visible_stat_configs()]
        self.assertIn("dwm", modules)
        self.assertIn("root", modules)
        self.assertIn("push", modules)
        self.assertNotIn("report", modules)

    def test_zero_stats_fallback_keeps_registered_open_stats(self):
        service = PortalService()
        with patch.object(service, "_visible_stat_configs", side_effect=RuntimeError("menu boom")):
            items = service.zero_stats()
        keys = {item["key"] for item in items}
        self.assertIn("asset_table", keys)
        self.assertIn("downstream_system", keys)
        self.assertIn("report", keys)


if __name__ == "__main__":
    unittest.main()
