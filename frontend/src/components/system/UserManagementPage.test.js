import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { USER_STATUS_META } from "./constants.js";
import { SYSTEM_USERS } from "../../data/systemUsers.js";
import { PARAM_DICT_ITEMS } from "../../data/paramDicts.js";

const pagePath = fileURLToPath(new URL("./UserManagementPage.jsx", import.meta.url));

test("user management actions exclude lock and use binary status labels", async () => {
  const source = await readFile(pagePath, "utf8");

  assert.match(source, /label: "重置密码"/);
  assert.match(source, /key: "disable"[\s\S]*label: "禁用"/);
  assert.match(source, /key: "enable"[\s\S]*label: "启用"/);
  assert.doesNotMatch(source, /key: "lock"|label: "锁定"|label: "解锁"/);
  assert.match(source, /label: "禁用"/);
});

test("password reset uses a non-danger confirmation without exposing a password", async () => {
  const source = await readFile(pagePath, "utf8");

  assert.match(source, /title: "确认重置密码？"/);
  assert.match(source, /重置后，该用户的密码将恢复为当前用户名。/);
  assert.match(source, /confirmText: "确认重置"/);
  assert.doesNotMatch(source, /tempPassword|新密码/);
});

test("user status metadata is binary", () => {
  assert.deepEqual(Object.keys(USER_STATUS_META).sort(), ["disabled", "enabled"]);
  assert.equal(SYSTEM_USERS.some((user) => user.status === "locked"), false);
  assert.equal(PARAM_DICT_ITEMS.some((item) => item.categoryCode === "USER_STATUS" && item.value === "locked"), false);
});
