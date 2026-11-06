import assert from "node:assert/strict";
import test from "node:test";

import type { AiAskExecutionEvent } from "./aiAskExecution.ts";
import {
  httpRequestCountLabel,
  receivedTerminalEvent,
  requestCountEvidence,
  searchRequestNote,
} from "./aiAskExecutionSummary.ts";

function event(name: AiAskExecutionEvent["event"], stepId = "search-1"): AiAskExecutionEvent {
  return {
    event: name,
    requestId: "0123456789abcdef0123456789abcdef",
    stepId,
    timestamp: "2026-01-01T00:00:00.000Z",
    message: "",
  };
}

test("requestCountEvidence only trusts reported non-negative integers", () => {
  assert.deepEqual(requestCountEvidence({ requestCount: 0 }), { reported: true, count: 0 });
  assert.deepEqual(requestCountEvidence({ requestCount: 3 }), { reported: true, count: 3 });
  for (const value of [undefined, null, "2", 1.5, -1, Number.NaN, Number.POSITIVE_INFINITY, true]) {
    assert.deepEqual(
      requestCountEvidence({ requestCount: value }),
      { reported: false, count: null },
      `requestCount=${String(value)} 不能当作已上报的请求次数`,
    );
  }
  assert.deepEqual(requestCountEvidence(undefined), { reported: false, count: null });
});

test("httpRequestCountLabel never renders an unknown request count as zero", () => {
  assert.equal(httpRequestCountLabel({ requestCount: 3 }), "实际 HTTP 检索请求 3 次");
  assert.equal(httpRequestCountLabel({ requestCount: 0 }), "实际 HTTP 检索请求 0 次");
  assert.equal(httpRequestCountLabel({}), "实际 HTTP 检索请求次数未上报");
  assert.equal(httpRequestCountLabel(undefined), "实际 HTTP 检索请求次数未上报");
});

test("searchRequestNote separates an explicit zero request from missing evidence", () => {
  assert.equal(searchRequestNote({ requestCount: 2 }), null);
  assert.equal(searchRequestNote({ requestCount: 0 }), "未向 RAG HTTP Search API 发出请求。");
  assert.equal(
    searchRequestNote({}),
    "该步骤未上报请求次数；不能据此判断后端是否发起检索。",
  );
});

test("receivedTerminalEvent distinguishes backend completion from an interrupted stream", () => {
  assert.equal(receivedTerminalEvent([]), false);
  assert.equal(receivedTerminalEvent([event("step_start"), event("answer", "answer")]), false);
  assert.equal(receivedTerminalEvent([event("answer", "answer"), event("done", "done")]), true);
});
