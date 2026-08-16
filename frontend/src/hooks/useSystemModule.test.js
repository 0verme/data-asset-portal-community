import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const hookPath = fileURLToPath(new URL("./useSystemModule.js", import.meta.url));

test("user validation allows flexible usernames and reset feedback does not disclose passwords", async () => {
  const source = await readFile(hookPath, "utf8");

  assert.match(source, /username\.length > 64/);
  assert.match(source, /\\p\{Cc\}/);
  assert.doesNotMatch(source, /\^\[A-Za-z\]\[A-Za-z0-9_.-\]/);
  assert.match(source, /密码已重置为当前用户名/);
  assert.doesNotMatch(source, /临时密码|tempPassword/);
});

test("system management loads and caches only the current subroute", async () => {
  const source = await readFile(hookPath, "utf8");

  assert.match(source, /currentPage === "menus"/);
  assert.match(source, /currentPage === "param-dicts"/);
  assert.match(source, /loadedPagesRef\.current\.has\(currentPage\)/);
  assert.match(source, /loadedPagesRef\.current\.add\(currentPage\)/);
  assert.match(source, /currentPage !== "param-dicts" \|\| !selectedCategoryCode/);
  assert.match(source, /loadedItemsCategoryRef\.current === selectedCategoryCode/);
  assert.doesNotMatch(source, /Promise\.all\(\[loadUsers\(\), loadCategories\(\), loadMenus\(\)\]\)/);
});
