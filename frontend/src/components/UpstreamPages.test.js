import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const upstreamListPath = fileURLToPath(new URL("./upstream/UpstreamList.jsx", import.meta.url));
const upstreamDetailPath = fileURLToPath(new URL("./upstream/UpstreamDetail.jsx", import.meta.url));
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
