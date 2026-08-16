import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("asset home uses paged summaries while detail fields load on navigation", async () => {
  const [api, hook, home, view] = await Promise.all([
    read("./api/assets.js"),
    read("./hooks/useAssetModule.js"),
    read("./components/HomePage.jsx"),
    read("./components/views/AssetView.jsx"),
  ]);

  assert.match(api, /summary: true/);
  assert.match(hook, /getAssetTablePage\(/);
  assert.doesNotMatch(hook, /getAssetFields\(/);
  assert.match(hook, /setDetailFields\(asset\.fields \|\| \[\]\)/);
  assert.match(home, /fieldCount\(table\)/);
  assert.match(view, /第 \{page\} \/ \{pageCount\} 页/);
});
