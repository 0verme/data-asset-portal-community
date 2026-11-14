import json
import unittest
from unittest.mock import MagicMock

from backend.app.contracts.ai_ask import AiAskRequest
from backend.app.contracts.rag_search import RagRecommendationsResponse
from backend.app.services.ai_ask_execution_service import AIAskExecutionService
from backend.app.services.ai_ask_service import AIAskService
from backend.app.services.retrieval_provider import LocalSearchProvider, ModeAwareRetrievalProvider


class LocalSearchProviderTests(unittest.TestCase):
    def setUp(self):
        self.search_provider = MagicMock()
        self.catalog_loader = MagicMock()
        self.provider = LocalSearchProvider(self.search_provider, self.catalog_loader)

    def test_search_uses_existing_provider_and_authoritative_table_field_ids(self):
        self.search_provider.search.return_value = {
            "groups": [{
                "type": "asset",
                "hasMore": False,
                "items": [{
                    "assetId": 71,
                    "title": "untrusted display hint",
                    "matchedFields": [{"label": "字段", "value": "贷款余额", "fieldId": 901}],
                }],
            }],
            "hasMore": False,
        }
        self.catalog_loader.return_value = [{
            "assetId": 71,
            "name": "FACT_LOAN_BALANCE",
            "cn": "贷款余额事实表",
            "desc": "权威表描述",
            "domain": "FINANCE",
            "layer": "DWS",
            "fields": [{
                "assetId": 71,
                "fieldId": 901,
                "name": "LOAN_BALANCE_AMT",
                "cn": "贷款余额",
                "description": "权威字段描述",
            }],
        }]

        result = self.provider.recommend("贷款余额", profile="strict", top_k=4)

        self.search_provider.search.assert_called_once_with(
            "贷款余额",
            scope="all",
            limit=4,
            profile="strict",
            include_field_ids=True,
        )
        self.catalog_loader.assert_called_once_with(
            [71], {71: {901}}, profile="strict", cancel_event=None
        )
        self.assertEqual("available", result.status)
        self.assertEqual(["table", "field"], [item.asset_type for item in result.recommendations])
        table, field = result.recommendations
        self.assertEqual((71, "FACT_LOAN_BALANCE", "贷款余额事实表"),
                         (table.asset_id, table.name, table.display_name))
        self.assertEqual((71, 901, "LOAN_BALANCE_AMT"),
                         (field.asset_id, field.field_id, field.name))
        self.assertEqual(71, field.related_table.asset_id)
        self.assertEqual("local", field.retrieval_source)
        self.assertEqual(["贷款余额"], field.match_evidence)

    def test_rejects_stale_field_identity_and_keeps_authoritative_table(self):
        self.search_provider.search.return_value = {
            "groups": [{
                "type": "asset",
                "items": [{
                    "assetId": 71,
                    "matchedFields": [{"value": "余额", "fieldId": 901}],
                }],
            }],
        }
        self.catalog_loader.return_value = [{
            "assetId": 71,
            "name": "FACT_LOAN_BALANCE",
            "fields": [{"assetId": 72, "fieldId": 901, "name": "BALANCE"}],
        }]

        result = self.provider.recommend("余额", profile="internal")

        self.assertEqual("degraded", result.status)
        self.assertEqual("partial_search_failure", result.reason_code)
        self.assertEqual(["table"], [item.asset_type for item in result.recommendations])
        self.assertFalse(any(item.field_id == 901 for item in result.recommendations))

    def test_marks_relevant_partial_failure_and_limit_truncation(self):
        self.search_provider.search.return_value = {
            "partial": True,
            "failedGroups": ["asset"],
            "groups": [{"type": "asset", "hasMore": True, "items": []}],
        }

        result = self.provider.recommend("loan", profile="internal")

        self.assertEqual("degraded", result.status)
        self.assertEqual("partial_search_failure", result.reason_code)
        self.assertTrue(result.results_truncated)
        self.assertEqual([], result.recommendations)
        self.catalog_loader.assert_not_called()

    def test_search_failure_is_fail_closed(self):
        self.search_provider.search.side_effect = RuntimeError("database unavailable")

        result = self.provider.recommend("loan", profile="internal")

        self.assertEqual("unavailable", result.status)
        self.assertEqual("service_unavailable", result.reason_code)
        self.assertEqual([], result.recommendations)
        self.catalog_loader.assert_not_called()

    def test_caps_authoritative_candidates_and_marks_truncation(self):
        items = []
        details = []
        for asset_id in range(1, 9):
            items.append({
                "assetId": asset_id,
                "matchedFields": [
                    {"value": f"term-{asset_id}-{field_id}", "fieldId": asset_id * 100 + field_id}
                    for field_id in range(1, 4)
                ],
            })
            details.append({
                "assetId": asset_id,
                "name": f"TABLE_{asset_id}",
                "fields": [
                    {"assetId": asset_id, "fieldId": asset_id * 100 + field_id,
                     "name": f"FIELD_{field_id}"}
                    for field_id in range(1, 4)
                ],
            })
        self.search_provider.search.return_value = {
            "groups": [{"type": "asset", "hasMore": False, "items": items}],
        }
        self.catalog_loader.return_value = details

        result = self.provider.recommend("term", profile="internal", top_k=10)

        self.assertLessEqual(len(result.recommendations), 20)
        self.assertEqual("degraded", result.status)
        self.assertTrue(result.results_truncated)
        self.assertEqual("results_truncated", result.reason_code)


class LocalAIAskIntegrationTests(unittest.TestCase):
    @staticmethod
    def _search_and_catalog():
        search_provider = MagicMock()
        search_provider.search.return_value = {
            "groups": [{
                "type": "asset",
                "items": [{
                    "assetId": 71,
                    "matchedFields": [{"value": "余额", "fieldId": 901}],
                }],
            }],
        }
        catalog_loader = MagicMock(return_value=[{
            "assetId": 71,
            "name": "FACT_BALANCE",
            "cn": "余额事实表",
            "fields": [{
                "assetId": 71,
                "fieldId": 901,
                "name": "BALANCE_AMT",
                "cn": "余额金额",
                "description": "余额字段",
            }],
        }])
        return search_provider, catalog_loader

    @staticmethod
    def _external_that_must_not_be_used():
        external = MagicMock()
        external.is_configured.side_effect = AssertionError("Local must not inspect External")
        external.recommend.side_effect = AssertionError("Local must not call External")
        external.load_candidate_catalog.side_effect = AssertionError("Local must use the DAP catalog reader")
        return external

    def test_local_keyword_candidates_reach_existing_configured_llm_and_citations(self):
        search_provider, catalog_loader = self._search_and_catalog()
        local = LocalSearchProvider(search_provider, catalog_loader)
        external = self._external_that_must_not_be_used()
        retrieval = ModeAwareRetrievalProvider(
            local,
            external,
            lambda: {"enabled": True, "retrievalMode": "local"},
        )

        class ConfiguredLLM:
            def __init__(self):
                self.calls = []

            @staticmethod
            def is_enabled():
                return True

            def complete_json(self, *, system_prompt, user_payload, cancel_event=None):
                self.calls.append(user_payload)
                return json.dumps({
                    "questionType": "field_explanation",
                    "claims": [{"assetId": 71, "fieldId": 901, "relevance": "direct"}],
                })

        llm = ConfiguredLLM()
        service = AIAskService(retrieval, llm)
        response = service.ask(AiAskRequest(query="余额字段在哪张表？"), profile="strict")

        self.assertEqual("answered", response.status)
        self.assertEqual("local", response.candidates[0].retrieval_source)
        self.assertEqual(["余额"], response.candidates[0].match_evidence)
        self.assertEqual([(71, 901)], [(item.asset_id, item.field_id) for item in response.citations])
        self.assertEqual(1, len(llm.calls))
        self.assertNotIn("retrievalSource", llm.calls[0]["candidates"][0])
        self.assertNotIn("matchEvidence", llm.calls[0]["candidates"][0])
        external.is_configured.assert_not_called()
        external.recommend.assert_not_called()
        external.load_candidate_catalog.assert_not_called()
        search_provider.search.assert_called_once_with(
            "余额字段在哪张表？", scope="all", limit=10,
            profile="strict", include_field_ids=True,
        )

    def test_local_provider_is_reused_by_the_existing_multiround_executor(self):
        search_provider, catalog_loader = self._search_and_catalog()
        local = LocalSearchProvider(search_provider, catalog_loader)
        external = self._external_that_must_not_be_used()
        retrieval = ModeAwareRetrievalProvider(
            local,
            external,
            lambda: {"enabled": False},
        )

        class PlanningAndAnswerLLM:
            def __init__(self):
                self.calls = []

            @staticmethod
            def is_enabled():
                return True

            def complete_json(self, *, system_prompt, user_payload, cancel_event=None):
                self.calls.append((system_prompt, user_payload))
                if len(self.calls) == 1:
                    return json.dumps({
                        "queryType": "natural_language",
                        "keyConcepts": ["余额"],
                        "queries": ["余额字段在哪张表？"],
                        "supplementalQuery": None,
                    })
                return json.dumps({
                    "questionType": "field_explanation",
                    "claims": [{"assetId": 71, "fieldId": 901, "relevance": "direct"}],
                })

        llm = PlanningAndAnswerLLM()
        base_service = AIAskService(retrieval, llm)
        execution_service = AIAskExecutionService(base_service, assets_service=MagicMock())
        events = []
        response = execution_service.ask(
            AiAskRequest(query="余额字段在哪张表？"),
            profile="strict",
            request_id="local-mode-test",
            event_callback=lambda event, payload: events.append((event, payload)),
        )

        self.assertIn(response.status, {"answered", "partial_answer"})
        self.assertEqual("local", response.candidates[0].retrieval_source)
        self.assertEqual([(71, 901)], [(item.asset_id, item.field_id) for item in response.citations])
        self.assertEqual(1, search_provider.search.call_count)
        self.assertEqual(2, catalog_loader.call_count)
        search_complete = next(
            payload for event, payload in events
            if event == "step_complete" and str(payload.get("step_id", "")).startswith("search-")
        )
        self.assertEqual("local", search_complete["data"]["retrievalMode"])
        self.assertEqual(0, search_complete["data"]["requestCount"])
        prompt_candidates = llm.calls[-1][1]["candidates"]
        self.assertNotIn("retrievalSource", prompt_candidates[0])
        self.assertNotIn("matchEvidence", prompt_candidates[0])
        external.is_configured.assert_not_called()
        external.recommend.assert_not_called()
        external.load_candidate_catalog.assert_not_called()


class ModeAwareRetrievalProviderTests(unittest.TestCase):
    def _provider(self, config):
        local = MagicMock()
        local.is_configured.return_value = True
        external = MagicMock()
        external.is_configured.return_value = True
        external.load_candidate_catalog.return_value = []
        provider = ModeAwareRetrievalProvider(local, external, lambda: config)
        return provider, local, external

    def test_missing_mode_preserves_enabled_external_and_disabled_defaults_local(self):
        external_mode, _, _ = self._provider({"enabled": True, "serviceUrl": "https://rag.example.invalid"})
        local_mode, _, _ = self._provider({"enabled": False})
        self.assertEqual("external", external_mode.selected_mode())
        self.assertEqual("local", local_mode.selected_mode())

    def test_explicit_mode_overrides_legacy_enabled_flag(self):
        local_mode, _, _ = self._provider({"enabled": True, "retrievalMode": "local"})
        external_mode, _, _ = self._provider({"enabled": False, "retrievalMode": "external"})
        self.assertEqual("local", local_mode.selected_mode())
        self.assertEqual("external", external_mode.selected_mode())

    def test_explicit_local_does_not_check_or_call_external_service(self):
        provider, local, external = self._provider({"enabled": True, "retrievalMode": "local"})
        external.is_configured.side_effect = AssertionError("must not inspect External readiness")
        local.recommend.return_value = RagRecommendationsResponse(
            query="q", status="available", recommendations=[], count=0
        )

        self.assertTrue(provider.is_configured())
        result = provider.recommend("q", profile="internal")

        self.assertEqual("available", result.status)
        local.recommend.assert_called_once_with("q", profile="internal")
        external.is_configured.assert_not_called()
        external.recommend.assert_not_called()

    def test_invalid_mode_fails_closed_without_selecting_a_provider(self):
        provider, local, external = self._provider({
            "enabled": False,
            "retrievalMode": "unsupported",
        })

        self.assertFalse(provider.is_configured())
        result = provider.recommend("q", profile="internal")

        self.assertEqual("unavailable", result.status)
        self.assertEqual("invalid_response", result.reason_code)
        local.recommend.assert_not_called()
        external.recommend.assert_not_called()

    def test_explicit_external_failure_never_falls_back_to_local(self):
        provider, local, external = self._provider({"enabled": False, "retrievalMode": "external"})
        external.recommend.side_effect = RuntimeError("remote unavailable")

        with self.assertRaisesRegex(RuntimeError, "remote unavailable"):
            provider.recommend("q", profile="internal")

        external.recommend.assert_called_once_with("q", profile="internal")
        local.recommend.assert_not_called()


if __name__ == "__main__":
    unittest.main()
