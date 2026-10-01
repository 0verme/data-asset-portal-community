import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { MENU_ITEMS } from "../data/menus.ts";
import defaultMenus from "../../../config/default-menus.json" with { type: "json" };
import { hasIcon, resolveIconName } from "../components/iconRegistry.ts";
import type { AuthSession } from "../api/auth.ts";
import {
  getNavigationAuthKey,
  getNavigationMenusForAuth,
  getVisibleNavigationMenus,
  loadNavigationMenus,
} from "./navigationMenus.ts";

test("frontend default navigation exactly projects the canonical menu manifest", () => {
  const expected = defaultMenus.map((menu) => ({
    id: String(menu.id),
    code: menu.code,
    name: menu.name,
    icon: menu.icon,
    path: menu.path,
    order: menu.order,
    status: menu.status,
    adminOnly: menu.adminOnly,
    desc: menu.desc,
    navPlacement: menu.navPlacement,
  }));
  const actual = MENU_ITEMS.map(({ id, code, name, icon, path, order, status, adminOnly, desc, navPlacement }) => ({
    id, code, name, icon, path, order, status, adminOnly, desc, navPlacement,
  }));

  assert.deepEqual(actual, expected);
});

test("every default menu icon has a renderer, including the API icon", () => {
  assert.equal(MENU_ITEMS.length, 11);
  assert.equal(MENU_ITEMS.every((menu) => hasIcon(menu.icon)), true);
  assert.equal(hasIcon("api"), true);
});

test("unknown menu icons resolve to the grid renderer", () => {
  assert.equal(resolveIconName("not-a-registered-icon"), "grid");
});

test("navigation auth keys change with identity, role, or effective permissions", () => {
  const guest: AuthSession = { user: null, name: null, role: "guest", permissions: ["asset:read"] };
  const admin: AuthSession = {
    user: "admin",
    name: "Administrator",
    role: "admin",
    permissions: ["system:user:read", "asset:read"],
  };
  const sameAdmin: AuthSession = {
    ...admin,
    name: "Admin",
    permissions: ["asset:read", "system:user:read"],
  };
  const otherAdmin: AuthSession = { ...admin, user: "other" };
  const reducedAdmin: AuthSession = { ...admin, permissions: ["asset:read"] };

  assert.notEqual(getNavigationAuthKey(guest), getNavigationAuthKey(admin));
  assert.equal(getNavigationAuthKey(admin), getNavigationAuthKey(sameAdmin));
  assert.notEqual(getNavigationAuthKey(admin), getNavigationAuthKey(otherAdmin));
  assert.notEqual(getNavigationAuthKey(admin), getNavigationAuthKey(reducedAdmin));
});

test("system navigation follows current authorization without leaking across accounts", () => {
  const anonymousMenus = getVisibleNavigationMenus(MENU_ITEMS, {
    canManageSystem: false,
    canViewOperationLog: false,
  });
  const adminMenus = getVisibleNavigationMenus(MENU_ITEMS, {
    canManageSystem: true,
    canViewOperationLog: false,
  });
  const ordinaryUserMenus = getVisibleNavigationMenus(MENU_ITEMS, {
    canManageSystem: false,
    canViewOperationLog: false,
  });
  const operationLogMenus = getVisibleNavigationMenus(MENU_ITEMS, {
    canManageSystem: false,
    canViewOperationLog: true,
  });
  const disabledMenu = { ...MENU_ITEMS[0]!, id: "disabled", code: "disabled", status: "disabled" };
  const menusWithDisabledItem = getVisibleNavigationMenus([...MENU_ITEMS, disabledMenu], {
    canManageSystem: true,
    canViewOperationLog: false,
  });

  assert.equal(anonymousMenus.some((item) => item.code === "system"), false);
  assert.equal(adminMenus.find((item) => item.code === "system")?.name, "系统管理");
  assert.equal(ordinaryUserMenus.some((item) => item.code === "system"), false);
  assert.equal(operationLogMenus.find((item) => item.code === "system")?.name, "操作日志");
  assert.equal(menusWithDisabledItem.some((item) => item.code === "disabled"), false);
});

test("app scopes menu state to auth and reloads after identity or permission changes", async () => {
  const [appSource, authSessionSource] = await Promise.all([
    readFile(new URL("../App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../hooks/useAuthSession.ts", import.meta.url), "utf8"),
  ]);

  assert.match(authSessionSource, /const nextAuth = await login\(credentials\);\s*setAuth\(nextAuth\)/);
  assert.match(authSessionSource, /clearAuthStorage\(\);\s*setAuth\(\{ \.\.\.GUEST_AUTH \}\)/);
  assert.match(appSource, /const navigationAuthKey = getNavigationAuthKey\(auth\)/);
  assert.match(appSource, /\}, \[authReady, catalogDataAccessReady, loadMenus, navigationAuthKey\]\);/);
  assert.match(appSource, /void loadMenus\(navigationAuthKey\)/);
  assert.match(appSource, /getNavigationMenusForAuth\(navMenuSnapshot, navigationAuthKey\)/);
  assert.match(appSource, /if \(requestId !== navMenuRequestRef\.current\) return;/);
});

test("login, logout, account switches, and refresh keep menus scoped to the active auth", () => {
  const guest: AuthSession = { user: null, name: null, role: "guest", permissions: ["asset:read"] };
  const admin: AuthSession = {
    user: "admin",
    name: "Administrator",
    role: "admin",
    permissions: ["asset:read", "system:user:read"],
  };
  const ordinaryUser: AuthSession = {
    user: "reader",
    name: "Reader",
    role: "reader",
    permissions: ["asset:read"],
  };
  const adminSnapshot = { authKey: getNavigationAuthKey(admin), menus: MENU_ITEMS };
  const refreshedAdmin: AuthSession = { ...admin, name: "Admin" };
  const guestSnapshot = {
    authKey: getNavigationAuthKey(guest),
    menus: MENU_ITEMS.filter((item) => !item.adminOnly),
  };
  const ordinaryUserSnapshot = { authKey: getNavigationAuthKey(ordinaryUser), menus: MENU_ITEMS };

  // Guest -> admin: do not reuse the guest projection; after the current-session
  // menu fetch, the adminOnly system entry is immediately eligible.
  assert.deepEqual(getNavigationMenusForAuth(guestSnapshot, adminSnapshot.authKey), []);
  assert.equal(
    getVisibleNavigationMenus(getNavigationMenusForAuth(adminSnapshot, adminSnapshot.authKey), {
      canManageSystem: true,
      canViewOperationLog: false,
    }).some((item) => item.code === "system"),
    true,
  );

  // admin -> logout -> ordinary user: old admin snapshot is invalidated and
  // the ordinary user's current permissions continue to hide system management.
  assert.deepEqual(getNavigationMenusForAuth(adminSnapshot, getNavigationAuthKey(guest)), []);
  assert.deepEqual(getNavigationMenusForAuth(adminSnapshot, ordinaryUserSnapshot.authKey), []);
  assert.equal(
    getVisibleNavigationMenus(getNavigationMenusForAuth(ordinaryUserSnapshot, ordinaryUserSnapshot.authKey), {
      canManageSystem: false,
      canViewOperationLog: false,
    }).some((item) => item.code === "system"),
    false,
  );

  // ordinary user -> admin, and a refreshed browser session hydrated as that
  // same admin, both resolve to the admin-scoped menu collection.
  assert.deepEqual(getNavigationMenusForAuth(ordinaryUserSnapshot, adminSnapshot.authKey), []);
  assert.equal(
    getVisibleNavigationMenus(getNavigationMenusForAuth(adminSnapshot, getNavigationAuthKey(refreshedAdmin)), {
      canManageSystem: true,
      canViewOperationLog: false,
    })
      .some((item) => item.code === "system"),
    true,
  );
});

test("navigation loading preserves the exact API menu collection and order", async () => {
  const expected = [
    { code: "report", order: 55 },
    { code: "upstream", order: 10 },
  ];

  assert.equal(await loadNavigationMenus(async () => expected), expected);
});

test("navigation loading accepts an empty API menu collection", async () => {
  assert.deepEqual(await loadNavigationMenus(async () => []), []);
});

test("navigation loading propagates request failures and rejects malformed payloads", async () => {
  await assert.rejects(
    loadNavigationMenus(async () => {
      throw new Error("temporary backend failure");
    }),
    /temporary backend failure/,
  );
  await assert.rejects(loadNavigationMenus(async () => ({ items: [] })), /Invalid navigation menu payload/);
});

test("app exposes retry states without using built-in menu fallback data", () => {
  const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  const apiSource = readFileSync(new URL("../api/menus.ts", import.meta.url), "utf8");
  const loaderSource = readFileSync(new URL("./navigationMenus.ts", import.meta.url), "utf8");

  assert.match(appSource, /const \[navMenuSnapshot, setNavMenuSnapshot\] = useState/);
  assert.match(appSource, /菜单加载失败，点击重试/);
  assert.match(appSource, /onClick=\{\(\) => void loadMenus\(navigationAuthKey\)\}/);
  assert.match(apiSource, /suppressUnauthorizedEvent: true/);
  assert.doesNotMatch(loaderSource, /MENU_ITEMS|getPublicMenuFallback/);
});
