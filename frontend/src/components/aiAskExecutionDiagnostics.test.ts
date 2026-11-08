import assert from "node:assert/strict";
import test from "node:test";

import type { AiAskExecutionEvent } from "../api/aiAskExecution.ts";
import { formatSafeAiAskDiagnostics } from "./aiAskExecutionDiagnostics.ts";

function event(overrides: Partial<AiAskExecutionEvent> = {}): AiAskExecutionEvent {
  return {
    event: "step_error",
    requestId: "0123456789abcdef0123456789abcdef",
    stepId: "asset-987654",
    timestamp: "2026-01-01T00:00:00.000Z",
    message: "secret prompt; Authorization: bearer-secret",
    data: {
      errorCode: "asset_verification_unavailable",
      requestCount: 2,
      query: "sensitive user question",
      keyConcepts: ["private concept"],
      hits: [{ assetId: 987654, name: "private table", matchedTerms: ["private term"] }],
      assetId: 987654,
      token: "bearer-secret",
      authorization: "bearer-secret",
      stageTimings: { httpSearchMs: 12.5, injectedSecret: "do-not-copy" },
    },
    ...overrides,
  };
}

test("copies only sanitized diagnostic fields and excludes prompts, names, and credentials", () => {
  const copied = formatSafeAiAskDiagnostics([event()], "failed", "sensitive user question");
  const parsed = JSON.parse(copied) as {
    status: string;
    queryLength: number;
    requestId: string;
    events: Array<{ step: string; data: Record<string, unknown> }>;
  };

  assert.equal(parsed.status, "failed");
  assert.equal(parsed.queryLength, "sensitive user question".length);
  assert.equal(parsed.requestId, "0123456789abcdef0123456789abcdef");
  assert.equal(parsed.events[0]?.step, "asset");
  assert.deepEqual(parsed.events[0]?.data, {
    requestCount: 2,
    errorCode: "asset_verification_unavailable",
    stageTimings: { httpSearchMs: 12.5 },
    conceptCountObserved: 1,
    hitCountObserved: 1,
  });
  for (const secret of [
    "sensitive user question", "secret prompt", "Authorization", "bearer-secret",
    "private concept", "private table", "private term", "987654", "injectedSecret", "token",
  ]) {
    assert.equal(copied.includes(secret), false, `copied diagnostics leaked ${secret}`);
  }
});

test("redacts dynamic identifiers and bounds diagnostic event volume", () => {
  const events = Array.from({ length: 205 }, (_, index) => event({
    event: "step_complete",
    stepId: index === 0 ? "search-0123456789abcdef" : `future-private-step-${index}`,
    data: { resultCount: index },
  }));
  const parsed = JSON.parse(formatSafeAiAskDiagnostics(events, "completed", "")) as {
    eventCount: number;
    omittedEvents: number;
    events: Array<{ step: string }>;
  };

  assert.equal(parsed.eventCount, 205);
  assert.equal(parsed.events.length, 200);
  assert.equal(parsed.omittedEvents, 5);
  assert.equal(parsed.events[0]?.step, "search");
  assert.ok(parsed.events.slice(1).every((item) => item.step === "other"));
  assert.doesNotMatch(JSON.stringify(parsed), /future-private-step|search-0123456789abcdef/);
});
