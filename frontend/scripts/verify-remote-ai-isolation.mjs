import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

const root = new URL("../dist/assets/", import.meta.url);
const names = await readdir(root);
const markers = [
  "mock_count_unsupported",
  "识别演示目录检索意图",
  "检索本地演示表和字段",
  "【模拟演示】本结果按演示目录",
];
let inspected = 0;
for (const file of names.filter((name) => name.endsWith(".js"))) {
  const content = await readFile(new URL(file, root), "utf8");
  for (const marker of markers) {
    assert.ok(!content.includes(marker), "Mock AI adapter leaked into Remote chunk: " + file);
  }
  inspected += 1;
}
assert.ok(inspected > 0, "No Remote JS chunks found to verify.");
console.log("Remote AI isolation verified in " + inspected + " JS chunks.");
