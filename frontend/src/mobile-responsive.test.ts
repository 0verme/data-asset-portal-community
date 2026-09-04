import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), "utf8");
const styles = read("./styles/app.css");
const pushStyles = read("./styles/push.css");
const moduleStyles = {
  report: read("./styles/report.css"),
  upstream: read("./styles/upstream.css"),
  indicator: read("./styles/indicator.css"),
  system: read("./styles/system.css"),
};
const app = read("./App.tsx");

test("mobile shell behavior is scoped to the 768px breakpoint", () => {
  const mobileSection = styles.match(/\/\* ===== Mobile ≤ 768px ===== \*\/[\s\S]*?\/\* ===== Small phone ≤ 480px ===== \*\//)?.[0] || "";

  assert.match(mobileSection, /@media \(max-width: 768px\)/);
  assert.match(mobileSection, /\.topbar > \.mainnav \{\s*display: none;/);
  assert.match(mobileSection, /\.search\.mobile-open \{ display: block; \}/);
  assert.match(mobileSection, /table\.mobile-card-table/);
  assert.match(mobileSection, /height: 100dvh;/);
  assert.doesNotMatch(styles, /@media \(min-width: 769px\)/);
});

test("mobile navigation exposes accessible state and focus targets", () => {
  assert.match(app, /aria-controls="mobile-sidebar"/);
  assert.match(app, /aria-expanded=\{sidebarOpen\}/);
  assert.match(app, /aria-controls="global-search"/);
  assert.match(app, /aria-expanded=\{mobileSearchOpen\}/);
  assert.match(app, /event\.key !== "Escape"/);
  assert.match(app, /document\.body\.style\.overflow = "hidden"/);
});

test("core list tables opt into mobile cards with field labels", () => {
  const listFiles = [
    "./components/HomePage.tsx",
    "./components/IndicatorPage.tsx",
    "./components/report/ReportList.tsx",
    "./components/RootPages.tsx",
    "./components/upstream/UpstreamList.tsx",
    "./components/push/PushSystemList.tsx",
    "./components/push/PushJobList.tsx",
    "./components/OperationLog/OperationLogTable.tsx",
    "./components/system/UserManagementPage.tsx",
    "./components/system/MenuManagementPage.tsx",
    "./components/system/ParamDictPage.tsx",
    "./components/views/ApiAssetView.tsx",
  ];

  listFiles.forEach((file) => {
    const source = read(file);
    assert.match(source, /mobile-card-table/, `${file} should opt into the mobile card table`);
    assert.match(source, /data-label=/, `${file} should label mobile card fields`);
  });
});

test("comparison and editor tables keep dedicated mobile strategies", () => {
  assert.match(read("./components/FieldMappingPage.tsx"), /className="fm-table"/);
  assert.doesNotMatch(read("./components/FieldMappingPage.tsx"), /mobile-card-table/);
  assert.match(read("./components/views/ApiAssetView.tsx"), /mobile-edit-table/);
  assert.match(read("./components/TableEditor.tsx"), /fields-edit mobile-edit-table/);
  assert.match(read("./components/push/JobEditor.tsx"), /fields-edit mobile-edit-table/);
  assert.match(styles, /\.fm-table-wrap::after/);
  assert.match(styles, /table\.mobile-edit-table/);
});

test("push module owns its desktop and responsive styles", () => {
  assert.match(pushStyles, /\.sys-grid/);
  assert.match(pushStyles, /\.file-head-card/);
  assert.match(pushStyles, /@media \(max-width: 900px\)/);
  assert.match(pushStyles, /@media \(max-width: 768px\)/);
  assert.match(pushStyles, /@media \(max-width: 480px\)/);
  assert.doesNotMatch(styles, /\.sys-grid/);
});

test("upstream detail metadata uses responsive grid columns", () => {
  assert.match(moduleStyles.upstream, /\.upstream-detail-meta\s*\{[\s\S]*grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/);
  assert.match(moduleStyles.upstream, /@media \(max-width: 1100px\)[\s\S]*\.upstream-detail-meta\s*\{[\s\S]*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(moduleStyles.upstream, /@media \(max-width: 768px\)[\s\S]*\.upstream-detail-meta\s*\{[\s\S]*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(moduleStyles.upstream, /@media \(max-width: 560px\)[\s\S]*\.upstream-detail-meta\s*\{[\s\S]*minmax\(0, 1fr\)/);
});

test("remaining governed modules own their scoped styles", () => {
  assert.match(moduleStyles.report, /\.report-detail-section/);
  assert.match(moduleStyles.upstream, /\.upstream-page/);
  assert.match(moduleStyles.indicator, /\.indicator-detail-drawer/);
  assert.match(moduleStyles.system, /\.system-modal-card/);
  assert.doesNotMatch(styles, /\.(?:report-|upstream-|indicator-|system-)/);
});
