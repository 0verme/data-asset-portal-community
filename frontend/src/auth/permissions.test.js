import assert from "node:assert/strict";
import test from "node:test";

import {
  hasAnyPermission,
  hasPermission,
  MOCK_ROLE_PERMISSIONS,
  normalizePermissions,
} from "./permissions.ts";

test("normalizePermissions keeps registered codes sorted and unique", () => {
  assert.deepEqual(
    normalizePermissions(["indicator:write", "asset:read", "indicator:write", "unknown:write"]),
    ["asset:read", "indicator:write"],
  );
});

test("hasPermission is the single permission predicate", () => {
  const auth = { role: "indicator-maintainer", permissions: ["indicator:read", "operation_log:read"] };
  assert.equal(hasPermission(auth, "indicator:read"), true);
  assert.equal(hasPermission(auth, "indicator:write"), false);
  assert.equal(hasAnyPermission(auth, ["system:user:write", "operation_log:read"]), true);
});

test("mock built-in maps remain deterministic while remote state stays explicit", () => {
  assert.equal(MOCK_ROLE_PERMISSIONS.admin.includes("system:user:write"), true);
  assert.equal(MOCK_ROLE_PERMISSIONS.maintainer.includes("system:user:write"), false);
  assert.equal(hasPermission({ role: "guest", permissions: [] }, "asset:read"), false);
});
