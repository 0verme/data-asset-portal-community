import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), "utf8");
const list = read("./components/report/ReportList.tsx");
const editor = read("./components/report/ReportEditor.tsx");
const drawer = read("./components/report/ReportDetailDrawer.tsx");

test("report list and detail drawer use the frozen DAP Button adapter", () => {
  assert.match(list, /import \{ Button \} from "\.\.\/\.\.\/ui\/index\.ts"/);
  assert.match(list, /<Button className="btn primary" variant="primary" type="button" onClick=\{onNew\}>/);
  assert.match(drawer, /import \{ Button \} from "\.\.\/\.\.\/ui\/index\.ts"/);
  assert.match(drawer, /<Button className="btn" variant="secondary" type="button" onClick=\{onClose\}>/);
  assert.match(drawer, /<Button className="btn ghost-danger" variant="danger" type="button" onClick=\{\(\) => void onDelete\(report\.code\)\}>/);
});

test("report editor fields use frozen DAP adapters without raw controls", () => {
  assert.match(editor, /import \{ Checkbox, Input, Select, Textarea \} from "\.\.\/\.\.\/ui\/index\.ts"/);
  assert.equal((editor.match(/<Input/g) ?? []).length, 10);
  assert.equal((editor.match(/<Select<string>/g) ?? []).length, 4);
  assert.equal((editor.match(/<Textarea/g) ?? []).length, 4);
  assert.equal((editor.match(/<Checkbox/g) ?? []).length, 1);
  assert.doesNotMatch(editor, /<input|<select|<textarea/);
  assert.match(editor, /placeholder="请选择报表类型"/);
  assert.match(editor, /placeholder="请选择归属部门"/);
  assert.match(editor, /placeholder="请选择统计周期"/);
  assert.match(editor, /label="维护人不同"/);
  assert.match(editor, /type="date"/);
  assert.doesNotMatch(editor, /from "@cloudflare\/kumo\//);
});

test("report reference chips keep their documented native remove control", () => {
  assert.match(drawer, /className="report-ref-chip-remove"/);
  assert.equal((drawer.match(/<button/g) ?? []).length, 1);
  assert.doesNotMatch(drawer, /from "@cloudflare\/kumo\//);
});
