import unittest
from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import patch

from backend.app.services.search_provider import KeywordSearchProvider


class SearchProviderRegistryTestCase(unittest.TestCase):
    def setUp(self):
        self.provider = KeywordSearchProvider()

    @staticmethod
    def _connection_context():
        connection = SimpleNamespace(jconn=SimpleNamespace(getAutoCommit=lambda: True))
        return nullcontext(SimpleNamespace(connection=connection))

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

    def test_field_ids_are_opt_in_internal_metadata(self):
        config = next(
            item for item in self.provider._registered_configs()
            if item["type"] == "asset"
        )
        row = {
            "asset_id": 71,
            "field_name": "BALANCE_AMT",
            "field_cn_name": "余额",
            "field_desc": "",
            "matched_field_id": 901,
        }
        with patch.object(self.provider, "_fetch_rows_with_conn", return_value=[row]) as fetch:
            public_matches = self.provider._load_field_matches(
                object(), config, [{"asset_id": 71}], "%余额%", "strict"
            )
            public_sql = fetch.call_args.args[1]
            internal_matches = self.provider._load_field_matches(
                object(), config, [{"asset_id": 71}], "%余额%", "strict",
                include_field_ids=True,
            )
            internal_sql = fetch.call_args.args[1]

        self.assertNotIn("fieldId", public_matches[71][0])
        self.assertNotIn("matched_field_id", public_sql)
        self.assertEqual(901, internal_matches[71][0]["fieldId"])
        self.assertIn("f.field_id AS matched_field_id", internal_sql)

    @patch("backend.app.services.search_provider.system_management_service.get_enabled_menu_codes")
    def test_menu_status_filters_open_entities(self, mock_menus):
        mock_menus.return_value = {"dwm"}
        with (
            patch.object(
                self.provider,
                "_connection",
                return_value=self._connection_context(),
            ),
            patch.object(
                self.provider,
                "_search_one_safe",
                side_effect=lambda conn, config, query, limit, profile=None: self._group(config),
            ) as mock_search_one,
        ):
            result = self.provider.search("首贷", scope="all", limit=5)

        self.assertEqual(["asset"], [call.args[1]["type"] for call in mock_search_one.call_args_list])
        self.assertEqual(["asset"], [group["type"] for group in result["groups"]])

    @patch("backend.app.services.search_provider.system_management_service.get_enabled_menu_codes")
    def test_module_scope_uses_menu_status_not_edition(self, mock_menus):
        mock_menus.return_value = {"push"}
        with (
            patch.object(
                self.provider,
                "_connection",
                return_value=self._connection_context(),
            ),
            patch.object(
                self.provider,
                "_search_one_safe",
                side_effect=lambda conn, config, query, limit, profile=None: self._group(config),
            ) as mock_search_one,
        ):
            result = self.provider.search("推送", scope="push", limit=5)

        self.assertEqual("downstream", result["scope"])
        self.assertEqual(["downstream"], [call.args[1]["type"] for call in mock_search_one.call_args_list])


if __name__ == "__main__":
    unittest.main()
