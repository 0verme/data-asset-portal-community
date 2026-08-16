import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const pagePath = fileURLToPath(new URL("./UserManagementPage.jsx", import.meta.url));

test("password reset uses a non-danger confirmation without exposing a password", async () => {
  const source = await readFile(pagePath, "utf8");

  assert.match(source, /title: "确认重置密码？"/);
  assert.match(source, /重置后，该用户的密码将恢复为当前用户名。/);
  assert.match(source, /confirmText: "确认重置"/);
  assert.doesNotMatch(source, /tempPassword|新密码/);
});
