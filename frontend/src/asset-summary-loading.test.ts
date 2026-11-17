import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("asset home uses paged summaries while detail fields load on navigation", async () => {
  const [api, hook, home, detail, view] = await Promise.all([
    read("./api/assets.ts"),
    read("./hooks/useAssetModule.ts"),
    read("./components/HomePage.tsx"),
    read("./components/DetailPage.tsx"),
    read("./components/views/AssetView.tsx"),
  ]);

  assert.match(api, /summary: true/);
  assert.match(hook, /getAssetTablePage\(/);
  assert.doesNotMatch(hook, /getAssetFields\(/);
  assert.match(hook, /setDetailFields\(asset\.fields \|\| \[\]\)/);
  assert.match(home, /fieldCount\(table\)/);
  assert.match(home, /assetId \?\? table\.name/);
  assert.match(home, /AssetBusinessMeaning/);
  assert.doesNotMatch(home, /table\.fields\.length/);
  assert.match(home, /fieldCount\(table\) \?\? "—"/);
  assert.match(detail, /getAssetFieldCount\(asset\.fieldCount\)/);
  assert.match(detail, /getQualifiedAssetTableName\(asset\.name, asset\.schema\)/);
  assert.doesNotMatch(detail, /dwm\.\$\{asset\.name\}/);
  assert.match(hook, /pageSize,/);
  assert.match(view, /<TablePagination[\s\S]*?ariaLabel=\{t\("tablePagination"\)\}/);
});
