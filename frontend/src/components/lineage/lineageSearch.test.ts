import assert from "node:assert/strict";
import test from "node:test";

import type { LineageNode } from "../../api/lineage.ts";
import {
  describeLineageSearchCandidate,
  resolveLineageSearchMatches,
} from "./lineageSearch.ts";

function node(id: string, kind: string, name: string, namespace: string): LineageNode {
  return { id, kind, name, namespace, displayName: name, attributes: {} };
}

const exactDwmTable = node("table:dwm:M_JJQD_LIST", "table", "M_JJQD_LIST", "DWM");
const exactDwdTable = node("table:dwd:M_JJQD_LIST", "table", "M_JJQD_LIST", "DWD");
const fuzzyJob = node("task:job:M_JJQD_LIST", "task", "JOB_M_JJQD_LIST", "scheduler");

test("a unique exact table wins over fuzzy job candidates for a bare table name", () => {
  const result = resolveLineageSearchMatches("M_JJQD_LIST", [fuzzyJob, exactDwmTable]);

  assert.equal(result.directMatch?.id, exactDwmTable.id);
  assert.deepEqual(result.candidates, []);
});

test("same-name exact tables in different schemas remain explicit candidates", () => {
  const result = resolveLineageSearchMatches("m_jjqd_list", [exactDwmTable, exactDwdTable, fuzzyJob]);

  assert.equal(result.directMatch, null);
  assert.deepEqual(result.candidates.map(({ id }) => id), [exactDwmTable.id, exactDwdTable.id]);
});

test("schema-qualified exact search is case-insensitive and selects the matching table", () => {
  const result = resolveLineageSearchMatches("dwm.m_jjqd_list", [exactDwdTable, fuzzyJob, exactDwmTable]);

  assert.equal(result.directMatch?.id, exactDwmTable.id);
  assert.deepEqual(result.candidates, []);
});

test("partial searches retain single-result behavior and list ambiguous candidates", () => {
  const partial = resolveLineageSearchMatches("DWM.M_JJQD", [exactDwmTable]);
  const ambiguousPartial = resolveLineageSearchMatches("M_JJQD", [exactDwmTable, fuzzyJob]);
  const job = resolveLineageSearchMatches("JOB_M_JJQD_LIST", [fuzzyJob]);

  assert.equal(partial.directMatch?.id, exactDwmTable.id);
  assert.deepEqual(partial.candidates, []);
  assert.equal(ambiguousPartial.directMatch, null);
  assert.deepEqual(ambiguousPartial.candidates, [exactDwmTable, fuzzyJob]);
  assert.equal(job.directMatch?.id, fuzzyJob.id);
  assert.deepEqual(describeLineageSearchCandidate(exactDwmTable), {
    kindLabel: "表节点",
    namespaceLabel: "业务 Schema / namespace_name：DWM",
    nameLabel: "表名：M_JJQD_LIST",
  });
  assert.deepEqual(describeLineageSearchCandidate(fuzzyJob), {
    kindLabel: "作业节点",
    namespaceLabel: "命名空间：scheduler",
    nameLabel: "作业名：JOB_M_JJQD_LIST",
  });
});
