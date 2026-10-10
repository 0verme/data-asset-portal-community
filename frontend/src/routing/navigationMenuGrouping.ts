export interface GroupedNavigationMenus<T> {
  primary: T[];
  more: T[];
}

export interface NavigationMenuFitMetrics {
  availableWidth: number;
  menuWidths: readonly number[];
  moreTriggerWidth: number;
  chromeWidth: number;
  gap: number;
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

export function getNavigationPrimaryLimit<T extends { navPlacement?: string }>(
  menus: readonly T[],
  metrics: NavigationMenuFitMetrics,
): number {
  const { primary, more } = splitNavigationMenus(menus);
  if (
    !Number.isFinite(metrics.availableWidth)
    || metrics.availableWidth <= 0
    || metrics.menuWidths.length !== primary.length
    || metrics.menuWidths.some((width) => !Number.isFinite(width))
    || !Number.isFinite(metrics.moreTriggerWidth)
    || !Number.isFinite(metrics.chromeWidth)
    || !Number.isFinite(metrics.gap)
  ) {
    return primary.length;
  }

  const chromeWidth = Math.max(0, metrics.chromeWidth);
  const gap = Math.max(0, metrics.gap);
  for (let count = primary.length; count >= 0; count -= 1) {
    const showMore = more.length > 0 || count < primary.length;
    const visibleItemCount = count + (showMore ? 1 : 0);
    const gapCount = Math.max(0, visibleItemCount - 1);
    const menusWidth = metrics.menuWidths.slice(0, count).reduce((sum, width) => sum + Math.max(0, width), 0);
    const moreWidth = showMore ? Math.max(0, metrics.moreTriggerWidth) : 0;
    if (chromeWidth + menusWidth + moreWidth + gap * gapCount <= metrics.availableWidth + 0.5) {
      return count;
    }
  }

  return 0;
}
