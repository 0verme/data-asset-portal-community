import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const upstreamListPath = fileURLToPath(new URL("./upstream/UpstreamList.jsx", import.meta.url));
const upstreamDetailPath = fileURLToPath(new URL("./upstream/UpstreamDetail.jsx", import.meta.url));
const upstreamEditorPath = fileURLToPath(new URL("./upstream/UpstreamEditor.jsx", import.meta.url));
const upstreamFormErrorsPath = fileURLToPath(new URL("./upstream/upstreamFormErrors.ts", import.meta.url));
const upstreamPartsPath = fileURLToPath(new URL("./upstream/UpstreamParts.jsx", import.meta.url));
const upstreamStylesPath = fileURLToPath(new URL("../styles/upstream.css", import.meta.url));

test("upstream list offers card and list modes through shared views", async () => {
  const source = await readFile(upstreamListPath, "utf8");

  assert.match(source, /<ViewModeSwitcher value=\{view\} onChange=\{onChangeView\} modes=\{\["card", "list"\]\} \/>/);
  assert.match(source, /view === "card" \? \(/);
  assert.match(source, /<CardGridView/);
});

test("upstream cards preserve detail and row actions", async () => {
  const source = await readFile(upstreamListPath, "utf8");

  assert.match(source, /onItemClick=\{\(item\) => onOpen\(item\.id\)\}/);
  assert.match(source, /renderFootActions=\{\(item\) =>/);
  assert.match(source, /key: "view-tables"/);
  assert.match(source, /onToggle: \(\) => onToggle\(item\.id,/);
});

test("upstream unload times use the shared time input", async () => {
  const [source, formErrorsSource] = await Promise.all([
    readFile(upstreamEditorPath, "utf8"),
    readFile(upstreamFormErrorsPath, "utf8"),
  ]);

  assert.match(source, /<TimeInput/);
  assert.match(source, /unloadTimes\.map/);
  assert.match(source, /新增时间点/);
  assert.match(formErrorsSource, /至少保留一个卸数时间点/);
});

test("upstream detail renders one dynamic schedule stepper", async () => {
  const [detailSource, partsSource, styles] = await Promise.all([
    readFile(upstreamDetailPath, "utf8"),
    readFile(upstreamPartsPath, "utf8"),
    readFile(upstreamStylesPath, "utf8"),
  ]);

  assert.match(detailSource, /每日自动执行 · \{unloadTimes\.length\} 次/);
  assert.match(detailSource, /<ScheduleStepper times=\{unloadTimes\} muted=\{!enabled\} now=\{scheduleNow\} \/>/);
  assert.match(detailSource, /暂无卸数计划/);
  assert.doesNotMatch(detailSource, /ScheduleTimeline|time-chip|sched-hours|next-pill/);
  assert.match(partsSource, /steps\.map\(\(step, index\) =>/);
  assert.match(partsSource, /schedule-step-\$\{step\.status\}/);
  assert.match(styles, /\.schedule-stepper-scroll[\s\S]*overflow-x: auto/);
  assert.match(styles, /\.schedule-step-(?:completed|next|pending)/);
  assert.doesNotMatch(styles, /\.sched-(?:track|hours|mark)|\.sm-(?:flag|dot)/);
});

test("upstream detail consumes the shared field contract without ambiguous contacts", async () => {
  const [detailSource, editorSource] = await Promise.all([
    readFile(upstreamDetailPath, "utf8"),
    readFile(upstreamEditorPath, "utf8"),
  ]);

  assert.match(detailSource, /getUpstreamDetailMetadata/);
  assert.match(detailSource, /className="dh-meta upstream-detail-meta"/);
  assert.match(detailSource, /<StatusBadge status=\{status\} \/>/);
  assert.match(detailSource, /displayUpstreamValue\(system\?\.desc\)/);
  assert.doesNotMatch(detailSource, /system\.owner\}\s*\/\s*\$\{system\.dept/);
  assert.doesNotMatch(detailSource, /<DbBadge/);

  ["id", "abbr", "name", "dbType", "owner", "dept", "status", "desc"].forEach((key) => {
    assert.match(editorSource, new RegExp(`getUpstreamFieldLabel\\("${key}"\\)`));
  });
});

test("upstream save failures use one summary, inline field errors, and first-error navigation", async () => {
  const source = await readFile(upstreamEditorPath, "utf8");

  assert.match(source, /const nextErrors = validateUpstreamForm\(form\)/);
  assert.match(source, /if \(nextErrors\.length\)/);
  assert.match(source, /scrollToFirstUpstreamError\(nextErrors\)/);
  assert.match(source, /toast\.error\(`保存失败，还有 \$\{nextErrors\.length\} 项需要修改`\)/);
  assert.match(source, /data-form-field="abbr"/);
  assert.match(source, /renderFieldError\("abbr"\)/);
  assert.match(source, /messages=\{errorSummary\}/);
  assert.doesNotMatch(source, /title="请先修正以下问题"/);
  assert.match(source, /saving=\{saving\}/);
});
