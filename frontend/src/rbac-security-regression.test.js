import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  hasAnyPermission,
  hasPermission,
  MOCK_ROLE_PERMISSIONS,
  normalizePermissions,
} from "./auth/permissions.ts";

const here = fileURLToPath(new URL(".", import.meta.url));

test("guest, builtin, maintainer, and custom role permission matrix is explicit", () => {
  const guest = { role: "guest", permissions: [] };
  const admin = { role: "admin", permissions: MOCK_ROLE_PERMISSIONS.admin };
  const maintainer = { role: "maintainer", permissions: MOCK_ROLE_PERMISSIONS.maintainer };
  const custom = { role: "indicator-reader", permissions: ["indicator:read"] };

  assert.equal(hasPermission(guest, "asset:read"), false);
  assert.equal(hasPermission(admin, "system:role:write"), true);
  assert.equal(hasPermission(maintainer, "operation_log:read"), true);
  assert.equal(hasPermission(maintainer, "system:role:write"), false);
  assert.equal(hasPermission(custom, "indicator:read"), true);
  assert.equal(hasAnyPermission(custom, ["system:role:read", "indicator:read"]), true);
});

test("permission refresh fails closed after revocation and ignores unknown codes", () => {
  const before = { role: "custom", permissions: normalizePermissions(["indicator:write"]) };
  const after = { role: "custom", permissions: normalizePermissions(["indicator:read", "future:write"]) };
  assert.equal(hasPermission(before, "indicator:write"), true);
  assert.equal(hasPermission(after, "indicator:write"), false);
  assert.deepEqual(after.permissions, ["indicator:read"]);
});

test("frontend security boundary keeps API authorization server-owned", async () => {
  const [app, sidebar, auth, moduleContent, searchPortal] = await Promise.all([
    readFile(`${here}/App.jsx`, "utf8"),
    readFile(`${here}/components/sidebar/SystemSidebar.jsx`, "utf8"),
    readFile(`${here}/hooks/useAuthSession.js`, "utf8"),
    readFile(`${here}/components/app/ModuleContent.jsx`, "utf8"),
    readFile(`${here}/components/SearchPortalPage.jsx`, "utf8"),
  ]);
  assert.match(app, /systemLandingRoute/);
  assert.match(app, /accessible\[systemRoute\.page\]/);
  assert.match(sidebar, /canViewRoles/);
  assert.match(auth, /system:role:write/);
  assert.match(app, /businessAccessReady/);
  assert.match(app, /if \(!businessAccessReady\)/);
  assert.match(moduleContent, /登录后访问业务目录/);
  assert.match(searchPortal, /authenticated = true/);
  assert.match(searchPortal, /请先登录后搜索/);
});
