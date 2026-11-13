import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { USER_STATUS_META } from "./constants.ts";
import { SYSTEM_USERS } from "../../data/systemUsers.ts";
import { PARAM_DICT_ITEMS } from "../../data/paramDicts.ts";

const pagePath = fileURLToPath(
  new URL("./UserManagementPage.tsx", import.meta.url),
);

test("user management actions exclude lock and use binary status labels", async () => {
  const source = await readFile(pagePath, "utf8");

  assert.match(source, /label: translate\("重置密码"\)/);
  assert.match(source, /key: "disable"[\s\S]*label: translate\("禁用"\)/);
  assert.match(source, /key: "enable"[\s\S]*label: translate\("启用"\)/);
  assert.doesNotMatch(source, /key: "lock"|label: translate\("锁定"\)|label: translate\("解锁"\)/);
  assert.match(source, /label: translate\("禁用"\)/);
});

test("password reset uses a non-danger confirmation without exposing a password", async () => {
  const source = await readFile(pagePath, "utf8");

  assert.match(source, /title: translate\("确认重置密码？"\)/);
  assert.match(source, /content: translate\("重置后，该用户的密码将恢复为当前用户名。"\)/);
  assert.match(source, /confirmText: translate\("确认重置"\)/);
  assert.doesNotMatch(source, /tempPassword|新密码/);
});

test("user status metadata is binary", () => {
  assert.deepEqual(Object.keys(USER_STATUS_META).sort(), [
    "disabled",
    "enabled",
  ]);
  assert.equal(
    SYSTEM_USERS.some((user) => user.status === "locked"),
    false,
  );
  assert.equal(
    PARAM_DICT_ITEMS.some(
      (item) => item.categoryCode === "USER_STATUS" && item.value === "locked",
    ),
    false,
  );
});
