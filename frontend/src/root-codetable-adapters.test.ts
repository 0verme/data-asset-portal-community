import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), "utf8");
const rootPages = read("./components/RootPages.tsx");
const codeTablePage = read("./components/ManualCodeTablePage.tsx");

test("root pages use frozen DAP adapters and keep legacy classes", () => {
  assert.match(rootPages, /import \{ Button, Input, Select, Textarea \} from "\.\.\/ui\/index\.ts"/);
  assert.match(rootPages, /<Button className="btn" variant="secondary" type="button" onClick=\{onImport\}>/);
  assert.match(rootPages, /<Button className="btn primary" variant="primary" type="button" onClick=\{onNew\}>/);
  assert.match(rootPages, /<Button className="btn" variant="secondary" type="button" onClick=\{onBack\}>/);
  assert.equal((rootPages.match(/<Input/g) ?? []).length, 3);
  assert.equal((rootPages.match(/<Select<string>/g) ?? []).length, 1);
  assert.equal((rootPages.match(/<Textarea/g) ?? []).length, 2);
  assert.match(rootPages, /<Select<string> aria-label="分类" className="sel"/);
  assert.match(rootPages, /<Textarea[\s\S]*?className="paste-ta"/);
  assert.match(rootPages, /<Button className="btn primary" variant="primary" type="button" disabled=\{!summary\.new && !summary\.update\}/);
});

test("root pages keep the documented native exceptions only", () => {
  const nativeButtons = rootPages.match(/<button/g) ?? [];
  assert.equal(nativeButtons.length, 2, "only the two chip-clear micro buttons stay native");
  assert.match(rootPages, /<button type="button" onClick=\{\(\) => onSetCategory\(null\)\}>/);
  assert.match(rootPages, /<button type="button" onClick=\{onClearQuery\}>/);
  assert.match(rootPages, /ref=\{fileRef\}[\s\S]*?type="file"/);
  assert.doesNotMatch(rootPages, /from "@cloudflare\/kumo\//);
});

test("code-table page uses frozen DAP adapters without raw controls", () => {
  assert.match(codeTablePage, /import \{ Button, Input, Select, Textarea \} from "\.\.\/ui\/index\.ts"/);
  assert.equal((codeTablePage.match(/<Input/g) ?? []).length, 3);
  assert.equal((codeTablePage.match(/<Select<string>/g) ?? []).length, 3);
  assert.equal((codeTablePage.match(/<Textarea/g) ?? []).length, 1);
  assert.equal((codeTablePage.match(/<Button/g) ?? []).length, 2);
  assert.match(codeTablePage, /<Select<string> aria-label="状态筛选" className="inp code-table-status-filter"/);
  assert.match(codeTablePage, /<Select<string> aria-label="表样式" className=\{`inp\$\{hasError\("style"\)/);
  assert.doesNotMatch(codeTablePage, /<input|<select|<textarea|<button/);
  assert.doesNotMatch(codeTablePage, /from "@cloudflare\/kumo\//);
});
