import assert from "node:assert/strict";
import test from "node:test";

import type { LineageNode } from "../../api/lineage.ts";
import { toViewerGraph } from "./lineageAdapter.ts";
import { describeLineageNode } from "./lineageNodePresentation.ts";
import { lineageUnavailableState } from "./lineageUnavailableState.ts";
import { formatLineageSnapshotTime } from "./lineageSnapshotTime.ts";

const table: LineageNode = {
  id: "table:analytics:orders",
  kind: "table",
  name: "ANALYTICS.ORDERS",
  displayName: "ANALYTICS.ORDERS",
  namespace: "analytics",
  schema: "analytics",
  attributes: { layer: "warehouse" },
};

test("qualified titles and redundant display names are presented once without changing node identity", () => {
  assert.deepEqual(describeLineageNode(table), {
    title: "ANALYTICS.ORDERS",
    subtitle: undefined,
    tableName: "ORDERS",
    namespace: undefined,
  });
  assert.equal(describeLineageNode({ ...table, displayName: " ORDERS " }).subtitle, undefined);
  const other = { ...table, id: "table:billing:orders", name: "ORDERS", schema: "billing", namespace: "billing", displayName: "订单" };
  const graph = toViewerGraph({ nodes: [table, other], edges: [] });
  assert.deepEqual(graph.nodes.map(({ id, label, subtitle }) => ({ id, label, subtitle })), [
    { id: table.id, label: table.name, subtitle: undefined },
    { id: other.id, label: "billing.ORDERS", subtitle: "订单" },
  ]);
  assert.equal(table.displayName, "ANALYTICS.ORDERS");
  assert.deepEqual(graph.nodes[0]?.metadata?.["attributes"], table.attributes);
});

test("full names and meaningful subtitles survive canvas shortening, with no inferred schema", () => {
  const name = "long_identifier_".repeat(8);
  const displayName = "较长的中文业务名称".repeat(6);
  const legacy = { ...table, name, displayName, schema: undefined };
  const graph = toViewerGraph({ nodes: [legacy], edges: [] });
  const node = graph.nodes[0];
  assert.equal(describeLineageNode(legacy).namespace, "analytics");
  assert.equal(node?.metadata?.["fullLabel"], name);
  assert.equal(node?.metadata?.["fullSubtitle"], displayName);
  assert.match(node?.label ?? "", /…$/);
  assert.match(node?.subtitle ?? "", /…$/);
});

test("other asset kinds retain their identity without inheriting a viewer type", () => {
  const graph = toViewerGraph({
    nodes: ["indicator", "report", "constructor"].map((kind) => ({ ...table, id: kind, kind })),
    edges: [],
  });
  assert.deepEqual(graph.nodes.map((node) => [node.id, node.type, node.metadata?.["kind"]]), [
    ["indicator", undefined, "indicator"],
    ["report", undefined, "report"],
    ["constructor", undefined, "constructor"],
  ]);
});

test("lineage snapshot times retain UTC, offsets and unspecified timezone semantics", () => {
  assert.deepEqual(formatLineageSnapshotTime("2026-07-20T02:00:00Z"), { text: "2026-07-20 02:00:00 UTC", hasOffset: true });
  assert.deepEqual(formatLineageSnapshotTime("2026-07-20T10:00:00.123+08:00"), { text: "2026-07-20 10:00:00 +08:00", hasOffset: true });
  assert.deepEqual(formatLineageSnapshotTime("2026-07-20 10:00:00"), { text: "2026-07-20 10:00:00", hasOffset: false });
  for (const input of [null, undefined, "", "invalid", "2026-02-30T01:00:00Z", "2026-07-20T24:00:00Z", "2026-07-20T03:00:00+09:99"]) {
    assert.equal(formatLineageSnapshotTime(input), null);
  }
});

test("loading, empty and unavailable snapshots remain distinct", () => {
  assert.equal(lineageUnavailableState(true, null), "loading");
  assert.equal(lineageUnavailableState(false, null, "no_active_snapshot"), "noActiveSnapshot");
  assert.equal(lineageUnavailableState(false, null, "empty_snapshot"), "emptySnapshot");
  assert.equal(lineageUnavailableState(false, "503", "empty_snapshot"), "error");
  assert.equal(lineageUnavailableState(false, ""), "error");
});
