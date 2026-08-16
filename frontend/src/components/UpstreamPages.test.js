import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const upstreamListPath = fileURLToPath(new URL("./upstream/UpstreamList.jsx", import.meta.url));
const upstreamEditorPath = fileURLToPath(new URL("./upstream/UpstreamEditor.jsx", import.meta.url));

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
  const source = await readFile(upstreamEditorPath, "utf8");

  assert.match(source, /<TimeInput/);
  assert.match(source, /form\.unloadTimes\.map/);
  assert.match(source, /新增时间点/);
  assert.match(source, /至少保留一个卸数时间点/);
});
