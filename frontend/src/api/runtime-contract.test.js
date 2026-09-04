import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { buildReportOptionSets } from "../config/reportOptions.ts";
import { BINARY_STATUS_OPTIONS } from "../components/common/status.ts";

const sourcePath = (relativePath) => fileURLToPath(new URL(relativePath, import.meta.url));
const readSource = (relativePath) => readFile(sourcePath(relativePath), "utf8");

const optionRuntimeSources = [
  "../components/report/ReportEditor.tsx",
  "../components/sidebar/ReportSidebar.tsx",
  "../hooks/useStatusOptions.ts",
  "../hooks/usePushModule.ts",
  "../hooks/useUpstreamModule.ts",
];

test("the retired common-code client and hook are removed", () => {
  assert.equal(existsSync(sourcePath("./commonCodes.js")), false);
  assert.equal(existsSync(sourcePath("../hooks/useDictOptions.js")), false);
});

test("runtime option loaders do not call the retired common-codes API", async () => {
  const sources = await Promise.all(optionRuntimeSources.map(readSource));
  const source = sources.join("\n");

  assert.doesNotMatch(source, /common-codes/);
  assert.doesNotMatch(source, /useDictOptions|getDictOptions|getCodeItems/);
  assert.match(sources[0], /buildReportOptionSets\(reportItems\)/);
  assert.match(sources[1], /Object\.keys\(reportFacets\.type\)/);
  assert.match(sources[2], /BINARY_STATUS_OPTIONS/);
  assert.doesNotMatch(sources[3], /getDictOptionsBatch/);
  assert.doesNotMatch(sources[4], /getDictOptions/);
});

test("report type options prefer the current report asset values", () => {
  const options = buildReportOptionSets([
    { type: "监管报送" },
    { type: "经营分析" },
  ]).reportTypes;

  assert.deepEqual(options.map((item) => item.value), ["监管报送", "经营分析"]);
});

test("system status options use the shared enabled/disabled contract", () => {
  assert.deepEqual(BINARY_STATUS_OPTIONS, [
    { value: "enabled", name: "启用" },
    { value: "disabled", name: "禁用" },
  ]);
});
