import assert from "node:assert/strict";
import test from "node:test";

import {
  getEffectivePermissions,
  hasAnyPermission,
  hasPermission,
  MOCK_ROLE_PERMISSIONS,
  normalizePermissions,
  normalizeRolePermissionCodes,
  PUBLIC_PERMISSION_CODES,
} from "./permissions.ts";

test("normalizePermissions keeps registered codes sorted and unique", () => {
  assert.deepEqual(
    normalizePermissions(["indicator:write", "asset:read", "indicator:write", "unknown:write"]),
    ["asset:read", "indicator:write"],
  );
});

test("hasPermission is the single permission predicate", () => {
  const auth = { role: "indicator-maintainer", permissions: getEffectivePermissions(["indicator:read", "operation_log:read"]) };
  assert.equal(hasPermission(auth, "indicator:read"), true);
  assert.equal(hasPermission(auth, "asset:read"), true);
  assert.equal(hasPermission(auth, "indicator:write"), false);
  assert.equal(hasAnyPermission(auth, ["system:user:write", "operation_log:read"]), true);
});

test("public permissions are inherited while role payloads keep only deltas", () => {
  const effective = getEffectivePermissions(["asset:write"]);
  assert.deepEqual(effective.filter((code) => PUBLIC_PERMISSION_CODES.includes(code)), [...PUBLIC_PERMISSION_CODES].sort());
  assert.deepEqual(normalizeRolePermissionCodes(["asset:read", "asset:write"]), ["asset:write"]);
});

test("mock built-in maps remain deterministic while remote state stays explicit", () => {
  assert.equal(MOCK_ROLE_PERMISSIONS.admin.includes("system:user:write"), true);
  assert.equal(MOCK_ROLE_PERMISSIONS.maintainer.includes("system:user:write"), false);
  assert.equal(MOCK_ROLE_PERMISSIONS.maintainer.includes("asset:read"), false);
  assert.equal(hasPermission({ role: "guest", permissions: getEffectivePermissions([]) }, "asset:read"), true);
  assert.equal(hasPermission({ role: "guest", permissions: getEffectivePermissions([]) }, "asset:write"), false);
});
