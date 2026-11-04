import assert from "node:assert/strict";
import test from "node:test";

import {
  askAi,
  parseAiAskAvailability,
  parseAiAskResponse,
} from "./aiAsk.ts";

const validCandidate = {
  assetId: 42,
  fieldId: 99,
  assetType: "field",
  tableName: "SYNTHETIC_ACCOUNT",
  tableDisplayName: "合成账户表",
  tableDescription: "合成表说明",
  fieldName: "BALANCE_AMT",
  fieldDisplayName: "余额金额",
  fieldDescription: "合成字段说明",
  domain: "合成域",
  layer: "DWS",
  source: "dap_catalog",
  matchReason: "字段、父表和稳定 ID 已由当前 DAP 目录校验。",
  relevance: "direct",
};

const validResponse = {
  status: "answered",
  answer: "请查看下方已校验候选。",
  citations: [{ assetId: 42, fieldId: 99, source: "dap_catalog" }],
  candidates: [validCandidate],
  retrievalStatus: "available",
  generationStatus: "completed",
  resultsTruncated: false,
  reasonCode: null,
  elapsedMs: 10,
};

test("AI availability response exposes only the feature boolean", () => {
  assert.deepEqual(parseAiAskAvailability({ enabled: false, baseUrl: "must-not-be-used" }), { enabled: false });
  assert.throws(() => parseAiAskAvailability({ enabled: "true" }), /Invalid AI ask availability/);
});

test("AI ask response preserves DAP stable IDs and validates citations against candidates", () => {
  const parsed = parseAiAskResponse(validResponse);
  assert.equal(parsed.status, "answered");
  assert.equal(parsed.citations[0]?.assetId, 42);
  assert.equal(parsed.candidates[0]?.fieldId, 99);
  assert.equal(parsed.resultsTruncated, false);

  assert.throws(
    () => parseAiAskResponse({
      ...validResponse,
      citations: [{ assetId: 99, fieldId: 42, source: "dap_catalog" }],
    }),
    /Invalid AI ask citation/,
  );
  assert.throws(
    () => parseAiAskResponse({
      ...validResponse,
      citations: [{ assetId: 42, fieldId: 100, source: "dap_catalog" }],
    }),
    /Invalid AI ask citation/,
  );
});

test("AI ask parser rejects malformed field parent identity, source and duplicate citations", () => {
  assert.throws(
    () => parseAiAskResponse({
      ...validResponse,
      candidates: [{ ...validCandidate, fieldId: null }],
    }),
    /Invalid AI ask field candidate/,
  );
  assert.throws(
    () => parseAiAskResponse({
      ...validResponse,
      candidates: [{ ...validCandidate, source: "rag_service" }],
    }),
    /Invalid AI ask candidate/,
  );
  assert.throws(
    () => parseAiAskResponse({
      ...validResponse,
      citations: [validResponse.citations[0], validResponse.citations[0]],
    }),
    /Duplicate AI ask citation/,
  );
  assert.throws(
    () => parseAiAskResponse({
      ...validResponse,
      status: "partial_answer",
      answer: "仅确认部分资产。",
      reasonCode: "partial_results",
      citations: [],
    }),
    /must contain verified citations/,
  );
  assert.equal(parseAiAskResponse({
    ...validResponse,
    status: "partial_answer",
    answer: "仅确认部分资产，不代表完整清单。",
    resultsTruncated: true,
    reasonCode: "partial_results",
  }).resultsTruncated, true);
  assert.throws(
    () => parseAiAskResponse({ ...validResponse, resultsTruncated: true }),
    /explicit partial-answer status/,
  );
  assert.throws(
    () => parseAiAskResponse({ ...validResponse, resultsTruncated: undefined }),
    /Invalid AI ask response/,
  );
});

test("failure and no-evidence statuses remain explicit and cannot carry model citations", () => {
  for (const response of [
    {
      status: "insufficient_evidence",
      answer: "当前元数据不足以确认。",
      citations: [],
      candidates: [],
      retrievalStatus: "available",
      generationStatus: "not_run",
      resultsTruncated: false,
      reasonCode: "insufficient_evidence",
      elapsedMs: 4,
    },
    {
      status: "retrieval_unavailable",
      answer: "检索暂不可用。",
      citations: [],
      candidates: [],
      retrievalStatus: "unavailable",
      generationStatus: "not_run",
      resultsTruncated: false,
      reasonCode: "retrieval_unavailable",
      elapsedMs: 4,
    },
    {
      status: "generation_unavailable",
      answer: "模型暂不可用。",
      citations: [],
      candidates: [],
      retrievalStatus: "available",
      generationStatus: "unavailable",
      resultsTruncated: false,
      reasonCode: "llm_timeout",
      elapsedMs: 4,
    },
  ]) {
    assert.equal(parseAiAskResponse(response).status, response.status);
  }
  assert.throws(
    () => parseAiAskResponse({
      ...validResponse,
      status: "generation_unavailable",
    }),
    /Unanswered AI response/,
  );
});

test("mock mode explicitly refuses AI instead of inventing an answer", async () => {
  const response = await askAi("贷款余额在哪个表？");
  assert.equal(response.status, "generation_unavailable");
  assert.equal(response.generationStatus, "disabled");
  assert.deepEqual(response.candidates, []);
  assert.deepEqual(response.citations, []);
});
