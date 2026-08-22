# pyright: reportMissingImports=false

import os
import unittest
from contextlib import contextmanager, nullcontext
from unittest.mock import patch

from backend.app.core.capabilities import resolve_capabilities
from backend.app.fastapi_app import create_fastapi_app
from backend.app.services.portal_service import PortalService
from backend.app.services.search_provider import KeywordSearchProvider
from fastapi.testclient import TestClient


class SearchVisibilityTestCase(unittest.TestCase):
    def setUp(self):
        self.provider = KeywordSearchProvider()

    @staticmethod
    def _group(config):
        return {
            "type": config["type"],
            "label": config["label"],
            "module": config["module"],
            "count": 1,
            "items": [{"id": config["type"]}],
        }

    def _assert_empty_result(self, query, scope, expected_scope):
        with patch.object(self.provider, "_connection") as mock_connection:
            result = self.provider.search(query, scope=scope, limit=0)

        mock_connection.assert_not_called()
        self.assertEqual(
            {"query": "", "scope": expected_scope, "groups": [], "total": 0},
            result,
        )

    def _normalized_limit(self, raw_limit):
        config = self.provider.ENTITY_CONFIGS[0]
        with (
            patch.dict(
                os.environ, {"SEARCH_DEFAULT_LIMIT": "7", "SEARCH_MAX_LIMIT": "11"}
            ),
            patch.object(self.provider, "_visible_configs", return_value=[config]),
            patch.object(
                self.provider, "_connection", return_value=nullcontext(object())
            ),
            patch.object(
                self.provider,
                "_search_one_safe",
                side_effect=lambda conn, current_config, query, limit: self._group(
                    current_config
                ),
            ) as mock_search_one,
        ):
            self.provider.search("边界", scope=config["type"], limit=raw_limit)

        return mock_search_one.call_args.args[3]

    def _assert_scope_alias(self, raw_scope, expected_scope):
        with (
            patch.object(
                self.provider, "_visible_configs", return_value=[]
            ) as mock_visible_configs,
            patch.object(self.provider, "_connection") as mock_connection,
        ):
            result = self.provider.search("关键词", scope=raw_scope, limit=5)

        mock_visible_configs.assert_called_once_with(expected_scope)
        mock_connection.assert_not_called()
        self.assertEqual(
            {"query": "关键词", "scope": expected_scope, "groups": [], "total": 0},
            result,
        )

    def test_empty_query_returns_empty_contract_without_connecting(self):
        self._assert_empty_result("", "all", "all")

    def test_whitespace_query_returns_empty_contract_without_connecting(self):
        self._assert_empty_result(" \t\n", "metric", "indicator")

    def test_valid_limit_is_forwarded_as_a_number(self):
        self.assertEqual(3, self._normalized_limit("3"))

    def test_non_numeric_limit_uses_configured_default(self):
        self.assertEqual(7, self._normalized_limit("not-a-number"))

    def test_zero_limit_uses_configured_default(self):
        self.assertEqual(7, self._normalized_limit(0))

    def test_negative_limit_uses_configured_default(self):
        self.assertEqual(7, self._normalized_limit(-4))

    def test_limit_above_configured_maximum_is_clamped(self):
        self.assertEqual(11, self._normalized_limit(99))

    def test_metric_scope_alias_maps_to_indicator(self):
        self._assert_scope_alias("metric", "indicator")

    def test_api_asset_scope_alias_maps_to_api(self):
        self._assert_scope_alias("apiAsset", "api")

    def test_search_preserves_unicode_special_characters_and_long_keywords(self):
        config = next(
            item for item in self.provider.ENTITY_CONFIGS if item["type"] == "asset"
        )
        query = f"  {'资产' * 256}😀%_  "
        with (
            patch.object(self.provider, "_visible_configs", return_value=[config]),
            patch.object(
                self.provider, "_connection", return_value=nullcontext(object())
            ),
            patch.object(
                self.provider,
                "_search_one_safe",
                side_effect=lambda conn, current_config, keyword, limit: self._group(
                    current_config
                ),
            ) as mock_search_one,
        ):
            result = self.provider.search(query, scope="asset", limit=5)

        self.assertEqual(query.strip(), result["query"])
        self.assertEqual(query.strip(), mock_search_one.call_args.args[2])

    def test_like_pattern_escapes_percent_underscore_and_escape_character(self):
        self.assertEqual("%中文!%!_!!%", self.provider._like_pattern(" 中文%_! "))

    @patch(
        "backend.app.services.search_provider.system_management_service.get_enabled_menu_codes"
    )
    def test_search_all_skips_disabled_menu_modules(self, mock_enabled_menu_codes):
        mock_enabled_menu_codes.return_value = {
            "dwm",
            "upstream",
            "mapping",
            "root",
            "push",
        }

        with (
            patch.object(
                self.provider, "_connection", return_value=nullcontext(object())
            ),
            patch.object(
                self.provider,
                "_search_one_safe",
                side_effect=lambda conn, config, query, limit: self._group(config),
            ) as mock_search_one,
        ):
            result = self.provider.search("首贷", scope="all", limit=5)

        self.assertEqual(
            ["asset", "system", "field", "root", "downstream"],
            [call.args[1]["type"] for call in mock_search_one.call_args_list],
        )
        self.assertEqual(5, result["total"])
        self.assertNotIn("indicator", [group["type"] for group in result["groups"]])

    @patch(
        "backend.app.services.search_provider.system_management_service.get_enabled_menu_codes"
    )
    def test_disabled_scope_returns_empty_result(self, mock_enabled_menu_codes):
        mock_enabled_menu_codes.return_value = {
            "dwm",
            "upstream",
            "mapping",
            "root",
            "push",
        }

        with patch.object(self.provider, "_connection") as mock_connection:
            result = self.provider.search("首贷", scope="indicator", limit=5)

        mock_connection.assert_not_called()
        self.assertEqual("indicator", result["scope"])
        self.assertEqual([], result["groups"])
        self.assertEqual(0, result["total"])

    @patch(
        "backend.app.services.search_provider.system_management_service.get_enabled_menu_codes"
    )
    def test_module_alias_scope_maps_to_entity_scope(self, mock_enabled_menu_codes):
        mock_enabled_menu_codes.return_value = {"push"}

        with (
            patch.object(
                self.provider, "_connection", return_value=nullcontext(object())
            ),
            patch.object(
                self.provider,
                "_search_one_safe",
                side_effect=lambda conn, config, query, limit: self._group(config),
            ) as mock_search_one,
        ):
            result = self.provider.search("推送", scope="push", limit=5)

        self.assertEqual("downstream", result["scope"])
        self.assertEqual(
            ["downstream"],
            [call.args[1]["type"] for call in mock_search_one.call_args_list],
        )
        self.assertEqual(["downstream"], [group["type"] for group in result["groups"]])


class SearchRouteAliasTestCase(unittest.TestCase):
    def setUp(self):
        app = create_fastapi_app(
            capabilities=resolve_capabilities(edition="private"),
            identity_resolver=lambda _request: None,
        )
        self.client = TestClient(app)

    @patch("backend.app.services.search_provider.search_provider.search")
    def test_route_accepts_module_query_alias(self, mock_search):
        mock_search.return_value = {
            "query": "首贷",
            "scope": "indicator",
            "groups": [],
            "total": 0,
        }

        response = self.client.get("/api/search?q=首贷&module=indicator")

        self.assertEqual(200, response.status_code)
        mock_search.assert_called_once_with("首贷", scope="indicator", limit="5")


class PortalVisibilityTestCase(unittest.TestCase):
    @patch(
        "backend.app.services.portal_service.system_management_service.get_enabled_menu_codes"
    )
    def test_portal_stats_skip_disabled_modules(self, mock_enabled_menu_codes):
        mock_enabled_menu_codes.return_value = {
            "dwm",
            "upstream",
            "mapping",
            "root",
            "push",
        }

        service = PortalService()
        visible_modules = [
            config["module"] for config in service._visible_stat_configs()
        ]

        self.assertNotIn("indicator", visible_modules)
        self.assertIn("push", visible_modules)
        self.assertIn("dwm", visible_modules)

    def test_portal_stats_queries_share_service_transaction(self):
        transaction_active = False

        @contextmanager
        def transaction():
            nonlocal transaction_active
            transaction_active = True
            try:
                yield
            finally:
                transaction_active = False

        def enabled_menu_codes():
            self.assertTrue(transaction_active)
            return {"upstream"}

        def fetch_stats(*_args, **_kwargs):
            self.assertTrue(transaction_active)
            return ["stat_key", "stat_label", "stat_value"], [("system", "源系统", 8)]

        service = PortalService()
        service._db_profile = "test"
        with (
            patch(
                "backend.app.services.portal_service.database_transaction",
                side_effect=transaction,
            ) as transaction_scope,
            patch(
                "backend.app.services.portal_service.system_management_service.get_enabled_menu_codes",
                side_effect=enabled_menu_codes,
            ),
            patch(
                "backend.app.services.portal_service.fetch_all", side_effect=fetch_stats
            ),
        ):
            items = service.get_stats()

        transaction_scope.assert_called_once_with()
        self.assertEqual([{"key": "system", "label": "源系统", "value": 8}], items)


if __name__ == "__main__":
    unittest.main()
