export async function loadNavigationMenus(loadMenus) {
  const menus = await loadMenus();
  if (!Array.isArray(menus)) throw new Error("Invalid navigation menu payload");
  return menus;
}
