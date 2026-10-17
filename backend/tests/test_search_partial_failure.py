import unittest
from contextlib import nullcontext
from unittest.mock import patch

from backend.app.services.search_provider import KeywordSearchProvider, SearchDataSourceError


class SearchPartialFailureTests(unittest.TestCase):
    def run_search(self, results):
        service = KeywordSearchProvider()
        configs = [{"type": "asset"}, {"type": "indicator"}]
        with patch.object(service, "_visible_configs", return_value=configs), \
             patch.object(service, "_connection", return_value=nullcontext(None)), \
             patch.object(service, "_search_one_safe", side_effect=results):
            return service.search("query", profile="internal")

    def test_successful_groups_remain_available_but_total_is_explicitly_partial(self):
        group = {"type": "asset", "count": 2, "items": [], "hasMore": False}
        result = self.run_search([group, SearchDataSourceError("offline")])
        self.assertEqual([group], result["groups"])
        self.assertEqual(2, result["total"])
        self.assertTrue(result["partial"])
        self.assertEqual(["indicator"], result["failedGroups"])

    def test_zero_success_is_still_partial_and_all_failures_are_errors(self):
        result = self.run_search([{"type": "asset", "count": 0}, SearchDataSourceError("offline")])
        self.assertTrue(result["partial"])
        self.assertEqual([], result["groups"])
        with self.assertRaises(SearchDataSourceError):
            self.run_search([SearchDataSourceError("offline"), SearchDataSourceError("offline")])

    def test_provider_failure_never_becomes_an_empty_successful_group(self):
        service = KeywordSearchProvider()
        with patch.object(service, "_search_one", side_effect=RuntimeError("private SQL")), \
             self.assertRaises(SearchDataSourceError) as raised:
            service._search_one_safe(None, {"type": "asset"}, "query", 5)
        self.assertNotIn("private SQL", raised.exception.message)
