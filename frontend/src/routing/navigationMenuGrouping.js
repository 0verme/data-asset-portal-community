export function splitNavigationMenus(menus) {
  const primary = [];
  const more = [];

  menus.forEach((item) => {
    (item.navPlacement === "primary" ? primary : more).push(item);
  });

  return { primary, more };
}
