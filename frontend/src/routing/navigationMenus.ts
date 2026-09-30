import type { AuthSession } from "../api/auth.ts";
import type { MenuItem } from "../data/menus.ts";

export interface NavigationMenuAccess {
  canManageSystem: boolean;
  canViewOperationLog: boolean;
}

export interface AuthScopedNavigationMenus {
  authKey: string;
  menus: readonly MenuItem[];
}

export function getNavigationMenusForAuth(
  snapshot: AuthScopedNavigationMenus,
  authKey: string,
): readonly MenuItem[] {
  return snapshot.authKey === authKey ? snapshot.menus : [];
}

export function getNavigationAuthKey(auth: Pick<AuthSession, "user" | "role" | "permissions">): string {
  return JSON.stringify([auth.user, auth.role, [...auth.permissions].sort()]);
}

export function getVisibleNavigationMenus(
  menus: readonly MenuItem[],
  access: NavigationMenuAccess,
): MenuItem[] {
  return menus
    .filter((item) => item.status !== "disabled")
    .filter((item) => !item.adminOnly || access.canManageSystem || (item.code === "system" && access.canViewOperationLog))
    .map((item) => item.code === "system" && access.canViewOperationLog && !access.canManageSystem
      ? { ...item, name: "操作日志", icon: "file", path: "/system-management/operation-logs" }
      : item)
    .sort((a, b) => (a.order - b.order) || String(a.id).localeCompare(String(b.id)));
}

export function loadNavigationMenus<T>(loadMenus: () => Promise<T[]>): Promise<T[]>;
export function loadNavigationMenus(loadMenus: () => Promise<unknown>): Promise<unknown[]>;
export async function loadNavigationMenus(loadMenus: () => Promise<unknown>): Promise<unknown[]> {
  const menus = await loadMenus();
  if (!Array.isArray(menus)) throw new Error('Invalid navigation menu payload');
  return menus;
}
