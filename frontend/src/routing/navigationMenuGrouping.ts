export interface GroupedNavigationMenus<T> {
  primary: T[];
  more: T[];
}

export function splitNavigationMenus<T extends { navPlacement?: string }>(
  menus: readonly T[],
  options: { maxPrimary?: number } = {},
): GroupedNavigationMenus<T> {
  const configuredPrimary: T[] = [];
  const more: T[] = [];

  menus.forEach((item) => {
    (item.navPlacement === 'primary' ? configuredPrimary : more).push(item);
  });

  const maxPrimary = options.maxPrimary === undefined
    ? configuredPrimary.length
    : Math.max(0, Math.floor(options.maxPrimary));
  const primary = configuredPrimary.slice(0, maxPrimary);
  more.unshift(...configuredPrimary.slice(maxPrimary));
  return { primary, more };
}
