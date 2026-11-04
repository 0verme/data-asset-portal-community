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

test("system management loads active server-paged subroutes and rejects superseded dictionary generations", async () => {
  const source = await readFile(hookPath, "utf8");

  assert.match(source, /currentPage === "menus"/);
  assert.match(source, /currentPage === "param-dicts"/);
  assert.match(source, /getUserPage\(\{ keyword: query, page: userPage, pageSize: userPageSize \}\)/);
  assert.match(source, /getMenuPage\(\{ keyword: query, page: menuPage, pageSize: menuPageSize \}\)/);
  assert.match(source, /getParamDictPage\(categoryCode, \{/);
  assert.match(source, /const loadCategories = React\.useCallback\(async \(parentRequestSeq = pageRequestSeq\.current\)[\s\S]*?const nextCategories = await getParamDictCategories\(\);\s*if \(parentRequestSeq !== pageRequestSeq\.current\) return selectedCategoryCodeRef\.current;\s*setCategories\(nextCategories\)/);
  assert.match(source, /const result = await getParamDictPage\(categoryCode,\s*\{[\s\S]*?if \(requestSeq !== itemsRequestSeq\.current \|\| parentRequestSeq !== pageRequestSeq\.current\) return/);
  assert.match(source, /const categoryCode = await loadCategories\(requestSeq\);[\s\S]*?if \(requestSeq !== pageRequestSeq\.current\) return;[\s\S]*?await loadItems\(categoryCode, requestSeq\)/);
  assert.match(source, /const requestKey = `\$\{categoryCode\}\|\$\{query\.trim\(\)\}\|\$\{itemPage\}\|\$\{itemPageSize\}`/);
  assert.match(source, /currentPage !== "param-dicts" \|\| !selectedCategoryCode/);
  assert.match(source, /setUserPage\(1\)/);
  assert.match(source, /setMenuPage\(1\)/);
  assert.match(source, /setItemPage\(1\)/);
  assert.doesNotMatch(source, /Promise\.all\(\[loadUsers\(\), loadCategories\(\), loadMenus\(\)\]\)/);
});
