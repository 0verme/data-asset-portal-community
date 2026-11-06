import assert from "node:assert/strict";
import test from "node:test";
import { getAssetDetail, getAssetTables } from "../api/assets.ts";
import { parseAiAskExecutionEvent } from "../api/aiAskExecution.ts";
import { askMockAiWithExecution, createMockAiAnswer } from "./aiAsk.ts";

test("Mock AI uses verified catalog IDs and never creates free-form citations", async () => {
  const response = await createMockAiAnswer("订单金额在哪张表？");
  assert.ok(["answered", "partial_answer"].includes(response.status));
  assert.ok(response.candidates.length > 0);
  const tables = await getAssetTables();
  for (const item of response.candidates) {
    const table = tables.find((row) => row.name === item.tableName);
    assert.equal(item.assetId, table?.assetId);
    assert.equal((await getAssetDetail({ assetId: item.assetId })).name, item.tableName);
    if (item.fieldId != null) {
      assert.ok(table?.fields.some((field) => field.fieldId === item.fieldId && field.name === item.fieldName));
    }
  }
  assert.equal(response.citations.length, response.candidates.length);
});

test("Mock AI supports paraphrases, list queries and unknown fields without false evidence", async () => {
  const queries = ["订单金额在哪张表？", "我想找订单的金额字段", "订单金额数据在哪里"];
  for (const question of queries) {
    const result = await createMockAiAnswer(question);
    assert.ok(result.candidates.some((item) => item.tableName.includes("trade_order")), question);
  }
  const list = await createMockAiAnswer("有哪些会员相关的表？");
  assert.equal(list.status, "partial_answer");
  assert.ok(list.candidates.length > 0);
  const unknown = await createMockAiAnswer("贷款余额在哪张表？");
  assert.equal(unknown.status, "insufficient_evidence");
  assert.deepEqual(unknown.citations, []);
  const count = await createMockAiAnswer("有多少张表？");
  assert.equal(count.status, "insufficient_evidence");
});

test("Mock emits the same validated execution event envelope and supports AbortSignal", async () => {
  const events: string[] = [];
  const result = await askMockAiWithExecution("销售额在哪个表", (event) => {
    const parsed = parseAiAskExecutionEvent({
      event: event.event,
      data: JSON.stringify({
        request_id: event.requestId,
        step_id: event.stepId,
        timestamp: event.timestamp,
        message: event.message,
        ...(event.data ? { data: event.data } : {}),
      }),
    });
    events.push(parsed.event);
  });
  assert.equal(result.status, "completed");
  assert.equal(events.at(-2), "answer");
  assert.equal(events.at(-1), "done");
  const controller = new AbortController();
  const pending = askMockAiWithExecution("订单金额在哪", () => {}, "all", 10, controller.signal);
  controller.abort();
  await assert.rejects(pending, /取消|abort/i);
});
