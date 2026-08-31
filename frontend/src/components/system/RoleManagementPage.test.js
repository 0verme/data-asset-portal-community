import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = fileURLToPath(new URL(".", import.meta.url));
const readSource = (name) => readFile(`${here}/${name}`, "utf8");

test("role management consumes role and permission APIs", async () => {
  const [api, hook, page] = await Promise.all([
    readFile(`${here}/../../api/systemRoles.js`, "utf8"),
    readFile(`${here}/../../hooks/useRoleModule.js`, "utf8"),
    readFile(`${here}/RoleManagementPage.jsx`, "utf8"),
  ]);
  assert.match(api, /\/system\/roles/);
  assert.match(api, /\/system\/permissions/);
  assert.match(api, /assignableOnly/);
  assert.match(api, /getRoleAssignablePermissions/);
  assert.match(api, /Built-in role cannot be deleted/);
  assert.match(hook, /getRoleAssignablePermissions/);
  assert.match(hook, /normalizeRolePermissionCodes/);
  assert.match(hook, /system:role:write/);
  assert.match(page, /!role\.builtin/);
  assert.match(page, /assignablePermissions/);
  assert.match(page, /permissionCodes/);
});

test("role form hides public permissions and explains inherited read access", async () => {
  const source = await readSource("RoleManagementPage.jsx");
  assert.match(source, /isPublicPermission/);
  assert.match(source, /已选 \$\{selected\.size\} 项/);
  assert.match(source, /公共只读权限已默认开放/);
});

test("role route is addressable without changing the public module registry", async () => {
  const source = await readFile(`${here}/../../routing/location.ts`, "utf8");
  assert.match(source, /segments\[1\] === "roles"/);
  assert.match(source, /system-management\/roles/);
});

test("user form exposes custom roles while preserving builtin fallback", async () => {
  const source = await readSource("UserForm.jsx");
  assert.match(source, /roleOptions = roles\.length/);
  assert.match(source, /role\.roleCode/);
  assert.match(source, /role\.enabled !== "disabled"/);
});
