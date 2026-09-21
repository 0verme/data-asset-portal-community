import assert from "node:assert/strict";
import test from "node:test";

import { getPortalPushNavigation, resolvePortalNavigationQuery } from "./portalNavigation.ts";
import { getModuleDetailRoute, getModuleEditRoute } from "./navigation.ts";
import { splitNavigationMenus } from "./navigationMenuGrouping.ts";

test("desktop navigation groups menus by configured placement", () => {
  const menus = [
    { code: "upstream", navPlacement: "primary" },
    { code: "report", navPlacement: "more" },
    { code: "dwm", navPlacement: "primary" },
    { code: "system", navPlacement: "more" },
    { code: "custom", navPlacement: "primary" },
    { code: "push" },
  ];

  const { primary, more } = splitNavigationMenus(menus);

  assert.deepEqual(primary.map((item) => item.code), ["upstream", "dwm", "custom"]);
  assert.deepEqual(more.map((item) => item.code), ["report", "system", "push"]);
});

test("portal push-job navigation clears the portal query while preserving the job route", () => {
  const portalQuery = "demo-portal-query";
  const navigation = getPortalPushNavigation({
    module: "push",
    ref: { systemId: "DEMO_MKT", jobId: "DEMO_MKT_JOB_01" },
  }, { page: "systems", sys: null, job: null });

  assert.equal(navigation.query, "");
  assert.notEqual(navigation.query, portalQuery);
  assert.deepEqual(navigation.route, {
    page: "fields",
    sys: "DEMO_MKT",
    job: "DEMO_MKT_JOB_01",
  });
  const systemRoute = { page: "jobs", sys: navigation.route.sys, job: null };
  const systemJobs = [{
    id: "DEMO_MKT_JOB_01",
    cn: "营销触达作业",
    sourceFileName: "mkt_source.dat",
    targetFileName: "mkt_target.dat",
  }];
  const visibleJobs = systemJobs.filter((job) => {
    const query = navigation.query.toLowerCase();
    return !query || [job.cn, job.sourceFileName, job.targetFileName]
      .some((value) => value.toLowerCase().includes(query));
  });

  assert.deepEqual(systemRoute, { page: "jobs", sys: "DEMO_MKT", job: null });
  assert.equal(visibleJobs.length, 1);
});

test("portal group navigation keeps the keyword while push job targets clear it", () => {
  const systemsRoute = { page: "systems", sys: null, job: null } as const;
  const pushGroup = getPortalPushNavigation(null, systemsRoute);

  assert.equal(
    resolvePortalNavigationQuery(null, "包裹数", pushGroup),
    "包裹数",
    "a 查看全部 group target must keep the searched keyword",
  );
  assert.equal(
    resolvePortalNavigationQuery({ module: "push" }, "包裹数", pushGroup),
    "包裹数",
  );
  assert.equal(
    resolvePortalNavigationQuery({ module: "dwm" }, "包裹数", null),
    "包裹数",
  );

  const jobTarget = { module: "push", ref: { systemId: "DEMO_MKT", jobId: "DEMO_MKT_JOB_01" } };
  const jobNavigation = getPortalPushNavigation(jobTarget, systemsRoute);
  assert.equal(
    resolvePortalNavigationQuery(jobTarget, "包裹数", jobNavigation),
    "",
    "push job targets keep clearing the portal query",
  );
  assert.equal(resolvePortalNavigationQuery(null, undefined, null), "");
});

test("asset module routes keep the canonical assetId when it is known", () => {
  assert.deepEqual(getModuleDetailRoute("dwm", "orders", 42), {
    page: "detail",
    table: "orders",
    assetId: 42,
  });
  assert.deepEqual(getModuleEditRoute("dwm", "orders", 42), {
    page: "edit",
    table: "orders",
    assetId: 42,
  });

  // Legacy callers without an assetId keep the previous route shape.
  assert.deepEqual(getModuleDetailRoute("dwm", "orders"), {
    page: "detail",
    table: "orders",
  });
  assert.deepEqual(getModuleEditRoute("dwm", "orders"), {
    page: "edit",
    table: "orders",
  });
});
