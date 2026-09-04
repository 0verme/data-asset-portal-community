import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const canvasPath = fileURLToPath(
  new URL("./lineage/LineageCanvas.tsx", import.meta.url),
);
const adapterPath = fileURLToPath(
  new URL("./lineage/lineageAdapter.ts", import.meta.url),
);
const stylesPath = fileURLToPath(new URL("../styles/app.css", import.meta.url));
const pagePath = fileURLToPath(new URL("./LineagePage.tsx", import.meta.url));
const apiPath = fileURLToPath(new URL("../api/lineage.ts", import.meta.url));
const packagePath = fileURLToPath(
  new URL("../../package.json", import.meta.url),
);

test("lineage layout keeps the graph independent from the detail panel", async () => {
  const styles = await readFile(stylesPath, "utf8");

  assert.match(
    styles,
    /\.lineage-layout \{[^}]*grid-template-columns: minmax\(0, 1fr\) minmax\(300px, 340px\);[^}]*align-items: start;/,
  );
  assert.match(
    styles,
    /\.lineage-canvas \{[^}]*display: flex;[^}]*height: clamp\(420px, 62vh, 720px\);[^}]*overflow: hidden;/,
  );
  assert.match(
    styles,
    /\.lineage-canvas > lineage-viewer \{[^}]*flex: 1;[^}]*height: 100%;[^}]*min-height: 0;/,
  );
  assert.match(
    styles,
    /\.lineage-view-tool \{[^}]*border-radius: var\(--radius-sm\);/,
  );
});

test("initial lineage view uses the shared root-neighborhood fit", async () => {
  const canvas = await readFile(canvasPath, "utf8");

  assert.match(canvas, /getRootNeighborhoodNodeIds/);
  assert.match(
    canvas,
    /const ROOT_NEIGHBORHOOD_FIT_OPTIONS = \{ padding: 48, maxScale: 1 \}/,
  );
  assert.match(canvas, /fitOnLoad: false/);
  assert.match(canvas, /initialFit=\{rootNodeIds\}/);
  assert.match(canvas, /initialFitOptions=\{ROOT_NEIGHBORHOOD_FIT_OPTIONS\}/);
  assert.doesNotMatch(
    canvas,
    /document\.createElement|replaceChildren|destroy\(\)/,
  );
});

test("viewport controls remain host-owned and accessible", async () => {
  const canvas = await readFile(canvasPath, "utf8");

  assert.match(canvas, /aria-label="缩小"/);
  assert.match(canvas, /aria-label="放大"/);
  assert.match(canvas, /aria-label="定位根节点邻域"/);
  assert.match(canvas, /aria-label="适应全部"/);
  assert.match(canvas, /viewerRef\.current\?\.fitView\(\)/);
});

test("domain adapter bounds labels and preserves viewer metadata", async () => {
  const adapter = await readFile(adapterPath, "utf8");

  assert.match(adapter, /@lineage-viewer\/domain-adapter/);
  assert.match(adapter, /maxLabelLength: 24/);
  assert.match(adapter, /maxSubtitleLength: 24/);
  assert.match(adapter, /push_delivery/);
});

test("lineage packages are fixed at 1.1.0 and vendor sync is removed", async () => {
  const packageJson = JSON.parse(await readFile(packagePath, "utf8"));

  assert.equal(packageJson.dependencies["lineage-viewer"], "1.1.0");
  assert.equal(
    packageJson.dependencies["@lineage-viewer/domain-adapter"],
    "1.1.0",
  );
  assert.equal(packageJson.dependencies["@lineage-viewer/react"], "1.1.0");
  assert.equal(packageJson.scripts["sync:lineage-viewer"], undefined);
});

test("lineage search accepts table and task nodes", async () => {
  const [page, api] = await Promise.all([
    readFile(pagePath, "utf8"),
    readFile(apiPath, "utf8"),
  ]);

  assert.match(page, /findLineageNodes/);
  assert.match(page, /表或作业名称查询/);
  assert.match(page, /aria-label="血缘节点候选项"/);
  assert.match(page, /candidate\.kind === "task" \? "detail"/);
  assert.match(
    api,
    /\[["']table["'],\s*["']task["']\]\.includes\(node\.kind\)/,
  );
  assert.doesNotMatch(api, /findLineageTables/);
});

test("lineage filters wait for an explicit query", async () => {
  const page = await readFile(pagePath, "utf8");

  assert.match(
    page,
    /const \[pendingFilters, setPendingFilters\] = React\.useState/,
  );
  assert.match(page, /value=\{pendingFilters\.view\}/);
  assert.match(page, /value=\{pendingFilters\.direction\}/);
  assert.match(page, /value=\{pendingFilters\.depth\}/);
  assert.match(page, /setPendingFilters\(\(current\) =>/);
  assert.doesNotMatch(page, /const changeRoute =/);
  assert.doesNotMatch(page, /onChange=\{\(event\) => changeRoute/);
  assert.match(
    page,
    /if \(!nodeName\) \{[\s\S]*await loadGraph\(\{[\s\S]*\.\.\.pendingFilters/,
  );
  assert.match(page, /onRetry=\{\(\) => (?:void )?loadGraph\(route\)\}/);
});

test("lineage initialization uses one coalesced initial-view request", async () => {
  const [page, api] = await Promise.all([
    readFile(pagePath, "utf8"),
    readFile(apiPath, "utf8"),
  ]);

  assert.match(page, /getLineageInitialView/);
  assert.doesNotMatch(page, /getLineageBootstrap|getLineageSubgraph/);
  assert.match(page, /requestSequenceRef\.current \+= 1/);
  assert.match(api, /createInFlightRequestGroup/);
  assert.match(api, /\/lineage\/initial-view/);
});

test("lineage page supports table and detail views with snapshot diagnostics", async () => {
  const [page, styles] = await Promise.all([
    readFile(pagePath, "utf8"),
    readFile(stylesPath, "utf8"),
  ]);

  assert.match(page, /<option value="table">表级简图<\/option>/);
  assert.match(page, /<option value="detail">作业详图<\/option>/);
  assert.match(page, /view: nextRoute\.view/);
  assert.match(page, /快照诊断/);
  assert.match(styles, /\.lineage-diagnostics \{[^}]*var\(--warn-line\)/);
});
