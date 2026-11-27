import assert from "node:assert/strict";
import test from "node:test";

import { getMockHint, login } from "../auth.ts";

test("mock login uses the unified fixed demo credential", async () => {
  assert.equal(getMockHint(), "admin / 123456");

  const session = await login({ username: "admin", password: "123456" });
  assert.equal(session.user, "admin");
  assert.equal(session.name, "管理员");
  assert.equal(session.role, "admin");
});

test("the previous frontend mock password is no longer accepted", async () => {
  await assert.rejects(
    login({ username: "admin", password: "community-demo-password" }),
    /账号或密码不正确/,
  );
});
