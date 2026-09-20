import type { Route } from './types.ts';

export interface PortalTarget {
  ref?: {
    systemId?: string | null | undefined;
    jobId?: string | null | undefined;
    [key: string]: unknown;
  } | undefined;
  [key: string]: unknown;
}

export interface PortalPushNavigationResult {
  query: string;
  route: Route;
}

export function getPortalPushNavigation(
  target?: PortalTarget | null,
  defaultRoute: Route = { page: 'list' },
): PortalPushNavigationResult {
  const systemId = target?.ref?.systemId || null;
  const jobId = target?.ref?.jobId || null;
  return {
    query: '',
    route: systemId
      ? { page: jobId ? 'fields' : 'jobs', sys: systemId, job: jobId }
      : defaultRoute,
  };
}

/**
 * Portal navigation query rule.
 *
 * A push job / field target owns its own route and intentionally clears the
 * portal query. Every other target keeps the searched keyword, including a
 * "查看全部" group target that carries no ref but must still land on the
 * module with the same keyword.
 */
export function resolvePortalNavigationQuery(
  target: PortalTarget | null | undefined,
  nextQuery: string | undefined,
  pushNavigation: PortalPushNavigationResult | null,
): string {
  if (pushNavigation && target?.ref) return pushNavigation.query || '';
  return nextQuery || '';
}
