import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), "utf8");
const controls = read("./components/fieldMapping/FieldMappingControls.tsx");
const page = read("./components/FieldMappingPage.tsx");
const lineage = read("./components/LineagePage.tsx");
const wideTable = read("./components/fieldMapping/FieldMappingWideTable.tsx");

test("field mapping query keeps four text filters and the native empty-comment condition", () => {
  assert.match(controls, /import \{ Button, Input, Tooltip \} from "\.\.\/\.\.\/ui\/index\.ts"/);
  assert.equal((controls.match(/<Input/g) ?? []).length, 4);
  assert.equal((controls.match(/<Button/g) ?? []).length, 2);
  assert.equal((controls.match(/<Select/g) ?? []).length, 0);
  assert.equal((controls.match(/<select/g) ?? []).length, 1, "only emptyComment remains native");
  assert.equal((controls.match(/<button/g) ?? []).length, 2, "collapse and help triggers stay native");
  assert.match(controls, /aria-label=\{t\("filters\.helpLabel"\)\}/);
  assert.match(controls, /t\("filters\.sourceTable"\)[\s\S]*t\("filters\.sourceField"\)[\s\S]*t\("filters\.targetTable"\)[\s\S]*t\("filters\.targetField"\)/);
  assert.doesNotMatch(controls, /aria-label="源系统"/);
  assert.doesNotMatch(page, /setDraftSourceSystem/);
});

test("field mapping page uses adapters for actions and pagination", () => {
  assert.match(page, /import \{ Button, TablePagination \} from "\.\.\/ui\/index\.ts"/);
  assert.equal((page.match(/<Button/g) ?? []).length, 6);
  assert.equal((page.match(/<Select<string>/g) ?? []).length, 0);
  assert.match(page, /<TablePagination[\s\S]*?pageSizeOptions=\{FIELD_MAPPING_PAGE_SIZE_OPTIONS\}/);
  assert.equal((page.match(/<button/g) ?? []).length, 1, "dimension tabs stay native");
});

test("lineage chrome uses adapters while the viewer stays untouched", () => {
  assert.match(lineage, /import \{ Button, Input, Select \} from "\.\.\/ui\/index\.ts"/);
  assert.equal((lineage.match(/<Select<string>/g) ?? []).length, 3);
  assert.equal((lineage.match(/<Input/g) ?? []).length, 1);
  assert.equal((lineage.match(/<Button/g) ?? []).length, 3);
  assert.equal((lineage.match(/<button/g) ?? []).length, 1, "candidate list items stay native");
  assert.match(lineage, /<LineageCanvas/);
  assert.doesNotMatch(lineage, /from "@cloudflare\/kumo\//);
});

test("wide table keeps its own layout implementation", () => {
  assert.doesNotMatch(wideTable, /<Input|<Select|<Button/);
  assert.match(wideTable, /fm-table/);
});
