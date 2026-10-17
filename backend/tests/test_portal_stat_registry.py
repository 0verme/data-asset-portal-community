import unittest
from unittest.mock import patch

from backend.app.services.portal_service import PortalService


class PortalStatRegistryTestCase(unittest.TestCase):
    def setUp(self):
        self.profile_patch = patch.object(PortalService, "_profile", return_value="isolated-test")
        self.profile_patch.start()
        self.addCleanup(self.profile_patch.stop)
    def test_failed_counts_are_not_zero_or_cached(self):
        service = PortalService()
        config = {"key": "asset", "label": "资产", "from": "asset"}
        with patch.object(service, "_visible_stat_configs", return_value=[config]), \
             patch("backend.app.services.portal_service.fetch_all", side_effect=RuntimeError("offline")), \
             patch.object(service, "_count", side_effect=RuntimeError("offline")):
            with self.assertRaises(RuntimeError):
                service._get_stats()
        self.assertIsNone(service._stats_cache)

    def test_expired_cache_is_not_presented_as_current_on_failure(self):
        service = PortalService()
        service._stats_cache = [{"key": "asset", "label": "资产", "value": 12}]
        service._stats_cache_signature = ("asset",)
        with patch.object(service, "_visible_stat_configs", return_value=[{"key": "asset", "from": "asset", "label": "资产"}]), \
             patch("backend.app.services.portal_service.fetch_all", side_effect=RuntimeError("offline")), \
             patch.object(service, "_count", side_effect=RuntimeError("offline")):
            with self.assertRaises(RuntimeError):
                service._get_stats()

    def test_successful_zero_is_cached(self):
        service = PortalService()
        with patch.object(service, "_visible_stat_configs", return_value=[{"key": "asset", "label": "资产", "from": "asset"}]), \
             patch("backend.app.services.portal_service.fetch_all", return_value=(['stat_key', 'stat_label', 'stat_value'], [('asset', '资产', 0)])):
            self.assertEqual(service._get_stats()[0]['value'], 0)
        self.assertEqual(service._stats_cache[0]['value'], 0)

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
