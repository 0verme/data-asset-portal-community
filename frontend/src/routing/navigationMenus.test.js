import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { loadNavigationMenus } from "./navigationMenus.js";

test("navigation loading preserves the exact API menu collection and order", async () => {
  const expected = [
    { code: "report", order: 55 },
    { code: "upstream", order: 10 },
  ];

  assert.equal(await loadNavigationMenus(async () => expected), expected);
});

test("navigation loading accepts an empty API menu collection", async () => {
  assert.deepEqual(await loadNavigationMenus(async () => []), []);
});

test("navigation loading propagates request failures and rejects malformed payloads", async () => {
  await assert.rejects(
    loadNavigationMenus(async () => {
      throw new Error("temporary backend failure");
    }),
    /temporary backend failure/,
  );
  await assert.rejects(loadNavigationMenus(async () => ({ items: [] })), /Invalid navigation menu payload/);
});

test("app exposes retry states without using built-in menu fallback data", () => {
  const appSource = readFileSync(new URL("../App.jsx", import.meta.url), "utf8");
  const apiSource = readFileSync(new URL("../api/menus.js", import.meta.url), "utf8");
  const loaderSource = readFileSync(new URL("./navigationMenus.js", import.meta.url), "utf8");

  assert.match(appSource, /const \[navMenus, setNavMenus\] = useState\(\[\]\)/);
  assert.match(appSource, /菜单加载失败，点击重试/);
  assert.match(appSource, /onClick=\{loadMenus\}/);
  assert.match(apiSource, /suppressUnauthorizedEvent: true/);
  assert.doesNotMatch(loaderSource, /MENU_ITEMS|getPublicMenuFallback/);
});
