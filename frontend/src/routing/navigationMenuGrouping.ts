export interface GroupedNavigationMenus<T> {
  primary: T[];
  more: T[];
}

export function splitNavigationMenus<T extends { navPlacement?: string }>(
  menus: readonly T[],
): GroupedNavigationMenus<T> {
  const primary: T[] = [];
  const more: T[] = [];

  menus.forEach((item) => {
    (item.navPlacement === 'primary' ? primary : more).push(item);
  });

  return { primary, more };
}
