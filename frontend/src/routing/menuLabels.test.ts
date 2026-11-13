import assert from "node:assert/strict";
import test from "node:test";

import { MENU_ITEMS } from "../data/menus.ts";
import { getBuiltinMenuTranslationKey, resolveMenuDisplayName } from "./menuLabels.ts";

const t = (key: string, defaultValue: string): string => key === "menus.dwm" ? "Data Warehouse" : defaultValue;

test("canonical built-in menu names map by stable code without mutating menu data", () => {
  const warehouse = MENU_ITEMS.find((item) => item.code === "dwm")!;
  assert.equal(getBuiltinMenuTranslationKey(warehouse), "menus.dwm");
  assert.equal(resolveMenuDisplayName(warehouse, t), "Data Warehouse");
  assert.equal(warehouse.name, "数据仓库");
});

test("custom names and unknown menu codes remain byte-for-byte display values", () => {
  const canonical = MENU_ITEMS.find((item) => item.code === "dwm")!;
  const custom = { ...canonical, name: "Warehouse Operations" };
  const unknown = { ...canonical, code: "custom-module", name: "实例自定义名称" };
  assert.equal(getBuiltinMenuTranslationKey(custom), null);
  assert.equal(resolveMenuDisplayName(custom, t), custom.name);
  assert.equal(getBuiltinMenuTranslationKey(unknown), null);
  assert.equal(resolveMenuDisplayName(unknown, t), unknown.name);
});

test("the permission-scoped operation log shortcut receives its own label key", () => {
  const logShortcut = { code: "system", name: "操作日志", path: "/system-management/operation-logs" };
  assert.equal(getBuiltinMenuTranslationKey(logShortcut), "menus.operationLogs");
  assert.equal(resolveMenuDisplayName(logShortcut, t), "操作日志");
});
