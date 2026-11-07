import assert from "node:assert/strict";
import test from "node:test";

import { groupSteps, type AiAskRawStep } from "./aiAskStepSummary.ts";

function stage(id: string, rawSteps: readonly unknown[]) {
  const result = groupSteps(rawSteps).find((item) => item.id === id);
  assert.ok(result, `missing stage ${id}`);
  return result;
}

function groupedStage(id: string, grouped: ReturnType<typeof groupSteps>) {
  const result = grouped.find((item) => item.id === id);
  assert.ok(result, `missing stage ${id}`);
  return result;
}

test("groups known execution step identifiers into four ordered business stages", () => {
  const steps: AiAskRawStep[] = [
    { id: "planning", status: "completed", data: { keyConcepts: ["订单表"] } },
    { id: "search-a1", status: "completed", data: { resultCount: 7 } },
    { id: "catalog-a1", status: "completed", data: { verifiedAssetCount: 4 } },
    { id: "rag-round-1", status: "completed" },
    { id: "merge", status: "running" },
    { id: "asset-12", status: "completed", data: { source: "dap_authoritative_metadata" } },
    { id: "field-12-34", status: "completed", data: { source: "dap_authoritative_metadata" } },
    { id: "generating", status: "running" },
    { id: "execution", status: "failed", data: { errorCode: "timeout" } },
    { id: "future-unrecognized", status: "completed", data: { candidateCount: 100 } },
  ];

  const grouped = groupSteps(steps);
  assert.deepEqual(grouped.map(({ id }) => id), ["understanding", "retrieval", "verification", "answer"]);
  assert.equal(grouped[0]?.label, "理解问题");
  assert.deepEqual(grouped[0]?.concepts, ["订单表"]);
  assert.equal(grouped[0]?.status, "completed");
  assert.equal(grouped[1]?.status, "running");
  assert.equal(grouped[1]?.candidateCount, null, "a raw hit count is not the fused candidate count");
  assert.equal(grouped[2]?.status, "running", "catalog checks precede authoritative detail verification");
  assert.equal(grouped[2]?.verifiedTableCount, 1);
  assert.equal(grouped[2]?.verifiedFieldCount, 1);
  assert.equal(grouped[3]?.status, "running");
});

test("uses structured fusion and authoritative verification counters only", () => {
  const grouped = groupSteps([
    { id: "merge", status: "completed", message: "found 999 candidates", data: { deduplicatedCount: 7 } },
    {
      id: "verification",
      status: "completed",
      message: "read 999 tables and verified 999 fields",
      data: { verifiedTableCount: 4, verifiedFieldCount: 7 },
    },
  ]);

  assert.equal(groupedStage("retrieval", grouped).candidateCount, 7);
  assert.equal(groupedStage("verification", grouped).verifiedTableCount, 4);
  assert.equal(groupedStage("verification", grouped).verifiedFieldCount, 7);
});

test("uses ordered selected IDs as real candidate count when the aggregate count is absent", () => {
  assert.equal(
    stage("retrieval", [{ id: "merge", status: "completed", data: { selectedAssetIds: [7, 8, 9] } }]).candidateCount,
    3,
  );
  assert.equal(
    stage("retrieval", [{ id: "merge", status: "completed", data: { selectedAssetIds: [7, "8"] } }]).candidateCount,
    null,
  );
});

test("does not invent zero verification counts when no verified detail data exists", () => {
  const grouped = groupSteps([
    { id: "catalog-search-1", status: "completed", data: { verifiedAssetCount: 0, verifiedFieldCount: 0 } },
    { id: "merge", status: "completed", data: { deduplicatedCount: 0 } },
  ]);

  assert.equal(groupedStage("verification", grouped).verifiedTableCount, null);
  assert.equal(groupedStage("verification", grouped).verifiedFieldCount, null);
});

test("uses only completed authoritative asset and field details for streaming counts", () => {
  const grouped = groupSteps([
    { id: "merge", status: "completed", data: { deduplicatedCount: 2 } },
    { id: "asset-10", status: "completed", data: { source: "dap_authoritative_metadata" } },
    { id: "asset-11", status: "running", data: { source: "dap_authoritative_metadata" } },
    { id: "asset-12", status: "completed", data: { source: "index" } },
    { id: "field-10-20", status: "completed", data: { source: "dap_authoritative_metadata" } },
    { id: "field-10-21", status: "failed", data: { source: "dap_authoritative_metadata" } },
  ]);

  assert.equal(groupedStage("verification", grouped).verifiedTableCount, 1);
  assert.equal(groupedStage("verification", grouped).verifiedFieldCount, 1);
  assert.equal(groupedStage("verification", grouped).status, "failed");
});

test("special, unknown, malformed, or empty steps never throw or affect the four stages", () => {
  for (const raw of [undefined, null, [], "not-an-array", [null, {}, { id: 1, status: "completed" }]]) {
    const grouped = groupSteps(raw as readonly unknown[] | null | undefined);
    assert.equal(grouped.length, 4);
    assert.ok(grouped.every((item) => item.status === "pending"));
  }

  const grouped = groupSteps([
    { id: "metadata-count", status: "completed", data: { tableCount: 42 } },
    { id: "execution", status: "failed", data: { errorCode: "timeout" } },
    { id: "organizing", status: "completed" },
    { id: "unrecognized-type", status: "completed" },
  ]);
  assert.ok(grouped.every((item) => item.status === "pending"));
});

test("recognizes mock progress and propagates failures only to their mapped stage", () => {
  const grouped = groupSteps([
    { id: "analyzing", status: "failed" },
    { id: "retrieving", status: "completed" },
    { id: "generating", status: "completed" },
  ]);

  assert.equal(groupedStage("understanding", grouped).status, "failed");
  assert.equal(groupedStage("retrieval", grouped).status, "completed");
  assert.equal(groupedStage("verification", grouped).status, "pending");
  assert.equal(groupedStage("answer", grouped).status, "completed");
});
