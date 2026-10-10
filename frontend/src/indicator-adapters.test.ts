import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), "utf8");
const page = read("./components/IndicatorPage.tsx");
const editor = read("./components/IndicatorEditor.tsx");
const cascader = read("./components/IndicatorPathCascader.tsx");

test("indicator page buttons use the frozen DAP Button adapter", () => {
  assert.match(page, /import \{ Button \} from "\.\.\/ui\/index\.ts"/);
  assert.ok((page.match(/<Button/g) ?? []).length >= 3);
  assert.match(page, /<Button className="btn" variant="secondary" type="button" onClick=\{onClose\} aria-label="关闭指标详情">/);
  assert.match(page, /<Button className="btn" variant="secondary" type="button" onClick=\{onClose\}>/);
  assert.match(page, /<Button className="btn primary" variant="primary" type="button" onClick=\{onNew\}>/);
  assert.doesNotMatch(page, /from "@cloudflare\/kumo\//);
});

test("indicator editor fields use frozen DAP adapters", () => {
  assert.match(editor, /import \{ Input, Select, Textarea \} from "\.\.\/ui\/index\.ts"/);
  assert.equal((editor.match(/<Input/g) ?? []).length, 7);
  assert.equal((editor.match(/<Select/g) ?? []).length, 4);
  assert.equal((editor.match(/<Textarea/g) ?? []).length, 1);
  assert.doesNotMatch(editor, /<input|<select|<textarea/);
  assert.match(editor, /<Select<string \| number>/);
  assert.match(editor, /value=\{form\.sourceAssetId \|\| ""\}/);
  assert.match(editor, /value=\{form\.resultFieldId \|\| ""\}/);
  assert.match(editor, /placeholder="未指定（兼容历史指标）"/);
  assert.match(editor, /aria-label="语义生命周期"[\s\S]*?items=\{SEMANTIC_STATE_OPTIONS/);
  assert.doesNotMatch(editor, /from "@cloudflare\/kumo\//);
});

test("indicator cascader remains DAP-owned with no adapter boundary leak", () => {
  assert.match(cascader, /<button/);
  assert.doesNotMatch(cascader, /from "@cloudflare\/kumo\//);
});
