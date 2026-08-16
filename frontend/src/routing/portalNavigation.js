export function getPortalPushNavigation(target, defaultRoute) {
  const systemId = target?.ref?.systemId || null;
  const jobId = target?.ref?.jobId || null;
  return {
    query: "",
    route: systemId
      ? { page: jobId ? "fields" : "jobs", sys: systemId, job: jobId }
      : defaultRoute,
  };
}
