import assert from "node:assert/strict";
import test from "node:test";

import { getMockHint, login, resolveMockPassword } from "../auth.ts";

test("mock login uses the unified default demo credential", async () => {
  assert.equal(getMockHint(), "admin / 123456");

  const session = await login({ username: "admin", password: "123456" });
  assert.equal(session.user, "admin");
});

test("the previous frontend mock password is no longer accepted by default", async () => {
  await assert.rejects(
    login({ username: "admin", password: "community-demo-password" }),
    /账号或密码不正确/,
  );
});

test("VITE_MOCK_AUTH_PASSWORD continues to override the default", () => {
  assert.equal(
    resolveMockPassword({ VITE_MOCK_AUTH_PASSWORD: "custom-mock-password" }),
    "custom-mock-password",
  );
  assert.equal(resolveMockPassword({}), "123456");
});
