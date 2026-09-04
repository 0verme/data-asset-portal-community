import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { buildReportOptionSets } from "../config/reportOptions.ts";
import { BINARY_STATUS_OPTIONS } from "../components/common/status.ts";

const sourcePath = (relativePath: string) => fileURLToPath(new URL(relativePath, import.meta.url));
const readSource = (relativePath: string) => readFile(sourcePath(relativePath), "utf8");

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
  const [reportSource, reportSidebarSource, statusSource, pushSource, upstreamSource] = sources;
  if (!reportSource || !reportSidebarSource || !statusSource || !pushSource || !upstreamSource) {
    throw new Error("Expected all option runtime sources to be readable");
  }
  const source = sources.join("\n");

  assert.doesNotMatch(source, /common-codes/);
  assert.doesNotMatch(source, /useDictOptions|getDictOptions|getCodeItems/);
  assert.match(reportSource, /buildReportOptionSets\(reportItems\)/);
  assert.match(reportSidebarSource, /Object\.keys\(reportFacets\.type\)/);
  assert.match(statusSource, /BINARY_STATUS_OPTIONS/);
  assert.doesNotMatch(pushSource, /getDictOptionsBatch/);
  assert.doesNotMatch(upstreamSource, /getDictOptions/);
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
