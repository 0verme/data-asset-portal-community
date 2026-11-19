import assert from "node:assert/strict";
import test from "node:test";
import type { AiAskExecutionEvent } from "../../api/aiAskExecution.ts";
import { resolveDataOrbStatus } from "./resolveDataOrbStatus.ts";

function event(
  name: AiAskExecutionEvent["event"],
  stepId: string,
  data?: Record<string, unknown>,
): AiAskExecutionEvent {
  return {
    event: name, stepId, requestId: "01234567", timestamp: "2026-01-01T00:00:00Z", message: "",
    ...(data ? { data } : {}),
  };
}

const running = {
  aiActive: true, aiLoading: true, aiExecutionStatus: "running", aiExecutionEvents: [],
  typing: true, focused: true,
} as const;

test("idle, focus and typing ignore historical progress when the search tab owns the hero", () => {
  const search = { ...running, aiActive: false, aiExecutionEvents: [event("done", "done", { status: "failed" })] };
  assert.equal(resolveDataOrbStatus(search), "typing");
  assert.equal(resolveDataOrbStatus({ ...search, typing: false }), "focused");
  assert.equal(resolveDataOrbStatus({ ...search, typing: false, focused: false }), "idle");
});

test("only active Ask AI steps override processing, with explicit generation taking precedence", () => {
  const nested = [
    event("step_start", "rag-round-1"),
    event("step_start", "search-0123456789abcdef"),
    event("step_error", "search-0123456789abcdef"),
  ];
  assert.equal(resolveDataOrbStatus(running), "processing");
  assert.equal(resolveDataOrbStatus({ ...running, aiExecutionEvents: nested }), "retrieving");
  const generating = [...nested, event("step_start", "generating")];
  assert.equal(resolveDataOrbStatus({ ...running, aiExecutionEvents: generating }), "generating");
  assert.equal(resolveDataOrbStatus({
    ...running, aiExecutionEvents: [...generating, event("step_error", "generating")],
  }), "retrieving");
  assert.equal(resolveDataOrbStatus({
    ...running, aiExecutionEvents: [...nested, event("step_complete", "rag-round-1"), event("step_complete", "generating")],
  }), "processing");
});

test("Remote verification and statistics, and Mock retrieval and organizing follow real step IDs", () => {
  for (const step of [
    "search-0123456789abcdef", "catalog-0123456789abcdef", "verification", "asset-42",
    "asset-report-0", "field-42-99", "metadata-count", "retrieving",
  ]) {
    assert.equal(resolveDataOrbStatus({ ...running, aiExecutionEvents: [event("step_start", step)] }), "retrieving", step);
  }
  for (const step of ["planning", "analyzing", "organizing", "generate", "unknown"]) {
    assert.equal(resolveDataOrbStatus({ ...running, aiExecutionEvents: [event("step_start", step)] }), "processing", step);
  }
});

test("done beats loading, local terminal failures or cancellation beat completion, and a retry has a fresh event history", () => {
  for (const status of ["completed", "failed", "cancelled"] as const) {
    const terminal = { ...running, aiExecutionEvents: [event("done", "done", { status })] };
    assert.equal(resolveDataOrbStatus(terminal), status);
    assert.equal(resolveDataOrbStatus({ ...running, aiLoading: false, aiExecutionStatus: status }), status);
  }
  const completed = { ...running, aiExecutionEvents: [event("done", "done", { status: "completed" })] };
  assert.equal(resolveDataOrbStatus({ ...completed, aiExecutionStatus: "cancelled" }), "cancelled");
  assert.equal(resolveDataOrbStatus({ ...completed, aiExecutionStatus: "failed" }), "failed");
  assert.equal(resolveDataOrbStatus({ ...completed, aiExecutionEvents: [] }), "processing");
});

test("unknown events, invalid terminal data and an answer alone do not imply a phase or outcome", () => {
  const unknown = "custom" as AiAskExecutionEvent["event"];
  const aiExecutionEvents = [
    event(unknown, "generating"), event("keep_alive", "generating"),
    event("answer", "answer"), event("done", "done", { status: "other" }), event("done", "done"),
  ];
  assert.equal(resolveDataOrbStatus({ ...running, aiExecutionEvents }), "processing");
});
