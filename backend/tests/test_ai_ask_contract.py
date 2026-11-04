from __future__ import annotations

import unittest

from pydantic import ValidationError

from backend.app.contracts.ai_ask import (
    AiAskCandidate,
    AiAskCitation,
    AiAskRequest,
    AiAskResponse,
    AiGeneratedAnswer,
)


class AiAskContractTests(unittest.TestCase):
    def test_request_normalizes_query_and_applies_bounded_single_turn_contract(self):
        request = AiAskRequest.model_validate({"query": "  贷款余额在哪个表？  ", "scope": "all", "topK": 10})
        self.assertEqual("贷款余额在哪个表？", request.query)
        self.assertEqual(10, request.top_k)
        self.assertFalse(hasattr(request, "conversation_id"))

    def test_request_rejects_empty_unknown_scope_extras_and_out_of_range_top_k(self):
        cases = [
            {"query": "   "},
            {"query": "贷款余额", "scope": "field"},
            {"query": "贷款余额", "topK": 0},
            {"query": "贷款余额", "topK": 11},
            {"query": "贷款余额", "conversation_id": "not-supported"},
            {"query": "x" * 501},
        ]
        for payload in cases:
            with self.subTest(payload=str(payload)[:40]), self.assertRaises(ValidationError):
                AiAskRequest.model_validate(payload)

    def test_candidate_requires_current_table_field_identity_and_source(self):
        valid = AiAskCandidate(
            assetId=7,
            fieldId=11,
            assetType="field",
            tableName="ACCOUNT_BALANCE",
            tableDisplayName="账户余额表",
            tableDescription="余额信息",
            fieldName="BALANCE_AMT",
            fieldDisplayName="余额金额",
            fieldDescription="余额字段",
            domain="账户域",
            layer="DWS",
            source="dap_catalog",
            matchReason="已由目录校验",
        )
        self.assertEqual(11, valid.field_id)
        with self.assertRaises(ValidationError):
            AiAskCandidate.model_validate({
                **valid.model_dump(by_alias=True),
                "fieldId": None,
            })
        with self.assertRaises(ValidationError):
            AiAskCandidate.model_validate({
                **valid.model_dump(by_alias=True),
                "source": "rag_service",
            })

    def test_model_contract_is_selection_only_and_rejects_free_text(self):
        no_evidence = AiGeneratedAnswer.model_validate({
            "questionType": "general",
            "claims": [],
        })
        self.assertEqual([], no_evidence.claims)
        with self.assertRaises(ValidationError):
            AiGeneratedAnswer.model_validate({
                "questionType": "general",
                "claims": [],
                "answer": "unvalidated free text",
            })
        with self.assertRaises(ValidationError):
            AiGeneratedAnswer.model_validate({"questionType": "general", "claims": "bad"})

    def test_answered_response_requires_stable_candidate_bound_citations(self):
        candidate = {
            "assetId": 7,
            "fieldId": 11,
            "assetType": "field",
            "tableName": "ACCOUNT_BALANCE",
            "tableDisplayName": "账户余额表",
            "tableDescription": "余额信息",
            "fieldName": "BALANCE_AMT",
            "fieldDisplayName": "余额金额",
            "fieldDescription": "余额字段",
            "domain": "账户域",
            "layer": "DWS",
            "source": "dap_catalog",
            "matchReason": "已由目录校验",
            "relevance": "direct",
        }
        response = AiAskResponse.model_validate({
            "status": "answered",
            "answer": "发现符合条件的已登记候选资产。",
            "candidates": [candidate],
            "citations": [{"assetId": 7, "fieldId": 11, "source": "dap_catalog"}],
            "retrievalStatus": "available",
            "generationStatus": "completed",
            "resultsTruncated": False,
        })
        self.assertEqual(7, response.citations[0].asset_id)
        self.assertEqual("direct", response.candidates[0].relevance)
        partial = AiAskResponse.model_validate({
            **response.model_dump(by_alias=True),
            "status": "partial_answer",
            "reasonCode": "partial_results",
            "resultsTruncated": True,
            "answer": "本次只确认部分资产。",
        })
        self.assertEqual("partial_answer", partial.status)
        self.assertTrue(partial.results_truncated)
        with self.assertRaises(ValidationError):
            AiAskResponse.model_validate({
                **response.model_dump(by_alias=True),
                "resultsTruncated": True,
            })
        with self.assertRaises(ValidationError):
            AiAskResponse.model_validate({
                **response.model_dump(by_alias=True),
                "citations": [],
            })
        with self.assertRaises(ValidationError):
            AiAskResponse.model_validate({
                **response.model_dump(by_alias=True),
                "candidates": [],
            })
        with self.assertRaises(ValidationError):
            AiAskResponse.model_validate({
                **response.model_dump(by_alias=True),
                "candidates": [{**candidate, "relevance": "related"}],
            })
        with self.assertRaises(ValidationError):
            AiAskCitation.model_validate({"assetId": True, "source": "dap_catalog"})

    def test_failure_contract_distinguishes_retrieval_generation_and_no_evidence(self):
        retrieval_failure = AiAskResponse(
            status="retrieval_unavailable",
            answer="检索暂不可用。",
            retrievalStatus="unavailable",
            generationStatus="not_run",
            reasonCode="retrieval_unavailable",
        )
        no_evidence = AiAskResponse(
            status="insufficient_evidence",
            answer="当前元数据不足以确认。",
            retrievalStatus="available",
            generationStatus="not_run",
            reasonCode="insufficient_evidence",
        )
        generation_failure = AiAskResponse(
            status="generation_unavailable",
            answer="AI 问答暂不可用。",
            retrievalStatus="available",
            generationStatus="unavailable",
            reasonCode="llm_timeout",
        )
        self.assertEqual("unavailable", retrieval_failure.retrieval_status)
        self.assertEqual("not_run", no_evidence.generation_status)
        self.assertEqual("llm_timeout", generation_failure.reason_code)
        with self.assertRaises(ValidationError):
            AiAskResponse(
                status="retrieval_unavailable",
                answer="error",
                retrievalStatus="available",
                generationStatus="not_run",
            )


if __name__ == "__main__":
    unittest.main()
