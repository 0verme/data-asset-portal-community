import assert from "node:assert/strict";
import test from "node:test";
import { parseAiAskExecutionEvent } from "./aiAskExecution.ts";

const response = {
  status: "answered",
  answer: "已根据目录核实。",
  citations: [{ assetId: 42, fieldId: 99, source: "dap_catalog" }],
  candidates: [{
    assetId: 42,
    fieldId: 99,
    assetType: "field",
    tableName: "SYNTHETIC_ACCOUNT",
    tableDisplayName: "合成账户表",
    tableDescription: "合成目录说明",
    fieldName: "BALANCE_AMT",
    fieldDisplayName: "余额金额",
    fieldDescription: "合成字段说明",
    domain: "合成域",
    layer: "DWS",
    source: "dap_catalog",
    matchReason: "由当前 DAP 目录按稳定 ID 核实。",
    relevance: "direct",
  }],
  retrievalStatus: "available",
  generationStatus: "completed",
  resultsTruncated: false,
  reasonCode: null,
  elapsedMs: 10,
};

function event(name: string, data: Record<string, unknown>, stepId?: string) {
  return {
    event: name,
    data: JSON.stringify({
      request_id: "0123456789abcdef0123456789abcdef",
      step_id: stepId ?? (name === "answer" ? "answer" : name === "keep_alive" ? "keep-alive" : "search-0123456789abcdef"),
      timestamp: "2026-01-01T00:00:00.000Z",
      message: "Synthetic progress event.",
      ...(name === "keep_alive" ? {} : { data }),
    }),
  };
}

test("execution parser validates event envelope and preserves only DAP-authorized answer contracts", () => {
  const parsed = parseAiAskExecutionEvent(event("answer", { response }));
  assert.equal(parsed.event, "answer");
  assert.equal(parsed.requestId, "0123456789abcdef0123456789abcdef");
  assert.equal((parsed.data?.["response"] as { citations: Array<{ assetId: number }> }).citations[0]?.assetId, 42);

  assert.throws(() => parseAiAskExecutionEvent({
    ...event("step_start", { query: "synthetic query" }),
    event: "model_token",
  }), /未知事件/);
  assert.throws(() => parseAiAskExecutionEvent(event("answer", {
    response: { ...response, candidates: [{ ...response.candidates[0], assetId: 100 }] },
  })), /citation/i);
  assert.throws(() => parseAiAskExecutionEvent(event("answer", { response, token: "must-not-stream" })), /包含不支持的数据/);
  assert.throws(() => parseAiAskExecutionEvent({ event: "answer", data: "{" }), /事件格式无效/);
});

test("metadata-count execution events accept exact zero and reject malformed count evidence", () => {
  const parsed = parseAiAskExecutionEvent(event(
    "step_complete",
    { intent: "metadata_count", tableCount: 0 },
    "metadata-count",
  ));
  assert.equal(parsed.stepId, "metadata-count");
  assert.equal(parsed.data?.["tableCount"], 0);
  assert.throws(() => parseAiAskExecutionEvent(event(
    "step_complete",
    { intent: "metadata_count", tableCount: -1 },
    "metadata-count",
  )), /统计进度事件格式无效/);
  assert.throws(() => parseAiAskExecutionEvent(event(
    "step_start",
    { intent: "retrieval" },
    "metadata-count",
  )), /统计进度事件格式无效/);
});

test("report-count SSE events preserve a real zero and reject table/report metric confusion", () => {
  const parsed = parseAiAskExecutionEvent(event(
    "step_complete",
    { intent: "report_count", reportCount: 0 },
    "metadata-count",
  ));
  assert.equal(parsed.data?.["reportCount"], 0);
  assert.throws(() => parseAiAskExecutionEvent(event(
    "step_complete",
    { intent: "report_count", tableCount: 1 },
    "metadata-count",
  )), /统计进度事件格式无效/);
  assert.throws(() => parseAiAskExecutionEvent(event(
    "step_complete",
    { intent: "report_count", reportCount: -1 },
    "metadata-count",
  )), /统计进度事件格式无效/);
  assert.doesNotThrow(() => parseAiAskExecutionEvent(event(
    "step_start",
    { intent: "ambiguous_count" },
    "metadata-count",
  )));
});

test("keep-alive events are accepted as metadata-free transport heartbeats", () => {
  const parsed = parseAiAskExecutionEvent(event("keep_alive", {}));
  assert.equal(parsed.event, "keep_alive");
  assert.equal(parsed.data, undefined);
  const invalidHeartbeat = { ...event("step_start", { query: "not allowed" }), event: "keep_alive" };
  assert.throws(() => parseAiAskExecutionEvent(invalidHeartbeat), /keep-alive/);
});

test("done event requires an explicit terminal status", () => {
  const parsed = parseAiAskExecutionEvent(event("done", { status: "completed", stepCount: 4 }));
  assert.equal(parsed.data?.["status"], "completed");
  assert.throws(() => parseAiAskExecutionEvent(event("done", { status: "running" })), /状态无效/);
});

test("done event accepts the backend reasonCode field and still rejects other terminal data", () => {
  const parsed = parseAiAskExecutionEvent(event("done", {
    status: "completed",
    stepCount: 5,
    reasonCode: "insufficient_evidence",
  }));
  assert.equal(parsed.data?.["reasonCode"], "insufficient_evidence");

  // 终态只允许 status/stepCount/reasonCode，errorCode 不属于 done 事件。
  assert.throws(
    () => parseAiAskExecutionEvent(event("done", { status: "completed", errorCode: "timeout" })),
    /结束事件包含不支持的数据/,
  );
  assert.throws(
    () => parseAiAskExecutionEvent(event("done", { status: "completed", reasonCode: "Bad Code" })),
    /结束事件包含不支持的数据/,
  );
  assert.throws(
    () => parseAiAskExecutionEvent(event("done", { status: "completed", stepCount: -1 })),
    /结束事件包含不支持的数据/,
  );
});

test("catalog progress events accept the directory verification fields the backend emits", () => {
  const parsed = parseAiAskExecutionEvent(event("step_start", {
    searchId: "0123456789abcdef",
    startedAt: "2026-01-01T00:00:00.000Z",
    phase: "database",
    candidateAssetCount: 2,
    candidateFieldCount: 1,
    databaseCallCount: 2,
    round: 1,
  }, "catalog-0123456789abcdef"));
  assert.equal(parsed.data?.["phase"], "database");
  assert.equal(parsed.data?.["candidateAssetCount"], 2);

  const completed = parseAiAskExecutionEvent(event("step_complete", {
    searchId: "0123456789abcdef",
    finishedAt: "2026-01-01T00:00:00.010Z",
    durationMs: 10.5,
    databaseCallCount: 2,
    verifiedAssetCount: 2,
    verifiedFieldCount: 1,
    round: 1,
    phase: "database",
  }, "catalog-0123456789abcdef"));
  assert.equal(completed.data?.["verifiedAssetCount"], 2);
});
