export async function loadNavigationMenus<T>(loadMenus: () => Promise<T[]>): Promise<T[]> {
  const menus = await loadMenus();
  if (!Array.isArray(menus)) throw new Error('Invalid navigation menu payload');
  return menus;
}
