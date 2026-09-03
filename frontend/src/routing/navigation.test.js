import assert from "node:assert/strict";
import test from "node:test";

import { getPortalPushNavigation } from "./portalNavigation.ts";
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
