export function loadNavigationMenus<T>(loadMenus: () => Promise<T[]>): Promise<T[]>;
export function loadNavigationMenus(loadMenus: () => Promise<unknown>): Promise<unknown[]>;
export async function loadNavigationMenus(loadMenus: () => Promise<unknown>): Promise<unknown[]> {
  const menus = await loadMenus();
  if (!Array.isArray(menus)) throw new Error('Invalid navigation menu payload');
  return menus;
}
