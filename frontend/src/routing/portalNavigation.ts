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
