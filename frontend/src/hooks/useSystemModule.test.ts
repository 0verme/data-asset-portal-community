import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const hookPath = fileURLToPath(new URL("./useSystemModule.ts", import.meta.url));

test("user validation allows flexible usernames and reset feedback does not disclose passwords", async () => {
  const source = await readFile(hookPath, "utf8");

  assert.match(source, /username\.length > 64/);
  assert.match(source, /\\p\{Cc\}/);
  assert.doesNotMatch(source, /\^\[A-Za-z\]\[A-Za-z0-9_.-\]/);
  assert.match(source, /密码已重置为当前用户名/);
  assert.doesNotMatch(source, /临时密码|tempPassword/);
});

test("system management loads only the active server-paged subroute and keys dictionary requests by query/page", async () => {
  const source = await readFile(hookPath, "utf8");

  assert.match(source, /currentPage === "menus"/);
  assert.match(source, /currentPage === "param-dicts"/);
  assert.match(source, /getUserPage\(\{ keyword: query, page: userPage, pageSize: userPageSize \}\)/);
  assert.match(source, /getMenuPage\(\{ keyword: query, page: menuPage, pageSize: menuPageSize \}\)/);
  assert.match(source, /getParamDictPage\(categoryCode, \{/);
  assert.match(source, /const requestKey = `\$\{categoryCode\}\|\$\{query\.trim\(\)\}\|\$\{itemPage\}\|\$\{itemPageSize\}`/);
  assert.match(source, /currentPage !== "param-dicts" \|\| !selectedCategoryCode/);
  assert.match(source, /setUserPage\(1\)/);
  assert.match(source, /setMenuPage\(1\)/);
  assert.match(source, /setItemPage\(1\)/);
  assert.doesNotMatch(source, /Promise\.all\(\[loadUsers\(\), loadCategories\(\), loadMenus\(\)\]\)/);
});
