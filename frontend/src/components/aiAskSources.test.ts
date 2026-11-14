import assert from "node:assert/strict";
import test from "node:test";

import type { AiAskCandidate, AiAskCitation } from "../api/aiAsk.ts";
import { selectVerifiedCitedCandidates } from "./aiAskSources.ts";

function candidate(assetId: number, fieldId: number | null = null): AiAskCandidate {
  return {
    assetId,
    fieldId,
    assetType: fieldId === null ? "table" : "field",
    name: fieldId === null ? `table_${assetId}` : `field_${fieldId}`,
    displayName: fieldId === null ? `表 ${assetId}` : `字段 ${fieldId}`,
    description: "",
    tableName: `table_${assetId}`,
    tableDisplayName: `表 ${assetId}`,
    tableDescription: "",
    fieldName: fieldId === null ? null : `field_${fieldId}`,
    fieldDisplayName: fieldId === null ? null : `字段 ${fieldId}`,
    fieldDescription: "",
    domain: "测试主题域",
    layer: "DWS",
    source: "dap_catalog",
    matchReason: "经目录核实",
    relevance: "direct",
  };
}

function citation(assetId: number, fieldId: number | null = null): AiAskCitation {
  return { assetId, assetType: fieldId === null ? "table" : "field", fieldId, source: "dap_catalog" };
}

test("source section includes only DAP catalog candidates explicitly cited by the answer", () => {
  const citedTable = candidate(12);
  const citedField = candidate(12, 34);
  const uncited = candidate(99);
  const untrustedSource = { ...candidate(88), source: "unknown" } as unknown as AiAskCandidate;

  assert.deepEqual(
    selectVerifiedCitedCandidates(
      [citedTable, citedField, uncited, untrustedSource],
      [citation(12), citation(12, 34), { assetId: 88, assetType: "table", fieldId: null, source: "dap_catalog" }],
    ),
    [citedTable, citedField],
  );
});

test("type-qualified citations do not collide when catalog codes are equal", () => {
  const report: AiAskCandidate = { ...candidate(1), assetId: "SHARED-001", assetType: "report" };
  const indicator: AiAskCandidate = { ...report, assetType: "indicator" };
  const api: AiAskCandidate = { ...report, assetType: "api" };
  const citations: AiAskCitation[] = [
    { assetId: "SHARED-001", assetType: "indicator", fieldId: null, source: "dap_catalog" },
    { assetId: "SHARED-001", assetType: "api", fieldId: null, source: "dap_catalog" },
  ];
  assert.deepEqual(selectVerifiedCitedCandidates([report, indicator, api], citations), [indicator, api]);
});

test("field citations do not accidentally cite their containing table", () => {
  const table = candidate(42);
  const field = candidate(42, 7);

  assert.deepEqual(selectVerifiedCitedCandidates([table, field], [citation(42, 7)]), [field]);
  assert.deepEqual(selectVerifiedCitedCandidates([table, field], []), []);
});
