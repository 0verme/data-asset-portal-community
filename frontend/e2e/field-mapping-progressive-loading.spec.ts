import { expect, test, type Page, type Route } from "@playwright/test";

interface RequestLog {
  stats: URL[];
  tables: URL[];
  fields: URL[];
  exports: URL[];
}

interface MappingFixtureOptions {
  onStats?: (route: Route, url: URL) => Promise<void>;
  onTables?: (route: Route, url: URL) => Promise<void>;
  onFields?: (route: Route, url: URL) => Promise<void>;
}

const tableRow = (srcTable: string) => ({
  tablePk: `pk-${srcTable}`,
  sourceSystemId: "1",
  upstreamSystemId: "1",
  systemCode: "SYS-1",
  srcSystem: "测试源系统",
  srcTable,
  srcTableCn: `${srcTable} 中文表名`,
  targetLayer: "DWF",
  targetTable: `DWF_${srcTable}`,
  loadMode: "full",
  fieldCount: 4,
  mappedCount: 3,
  emptyCommentCount: 1,
  emptyCommentRate: 25,
  updatedAt: "2026-10-12T00:00:00Z",
});

const fieldRow = {
  tablePk: "pk-FIELD_ON_DEMAND",
  sourceSystemId: "1",
  upstreamSystemId: "1",
  srcSystem: "测试源系统",
  srcTable: "FIELD_ON_DEMAND",
  srcField: "FIELD_ID",
  srcType: "VARCHAR",
  srcComment: "字段详情按需加载",
  targetLayer: "DWF",
  targetTable: "DWF_FIELD_ON_DEMAND",
  targetField: "FIELD_ID",
  mappingRule: "直接映射",
};

const statsPayload = (fieldCount = 7, sourceTableCount = 4) => ({
  sourceSystemCount: 1,
  sourceTableCount,
  fieldCount,
  mappedFieldCount: fieldCount,
  unmappedFieldCount: 0,
  emptyCommentCount: 0,
  coverage: fieldCount ? 100 : 0,
});

async function installApiFixtures(
  page: Page,
  options: MappingFixtureOptions = {},
): Promise<RequestLog> {
  const requests: RequestLog = { stats: [], tables: [], fields: [], exports: [] };
  await page.addInitScript(() => {
    localStorage.setItem("dap_auth", JSON.stringify({ role: "admin", user: "field-mapping-e2e", name: "字段映射 E2E" }));
    localStorage.setItem("dap-theme", "light");
  });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (!path.startsWith("/api/")) {
      await route.continue();
      return;
    }

    if (path === "/api/auth/me") {
      await route.fulfill({
        json: {
          role: "admin",
          user: "field-mapping-e2e",
          name: "字段映射 E2E",
          permissions: ["field_mapping:read", "system:menu:read"],
        },
      });
      return;
    }
    if (path === "/api/public-catalog/config") {
      await route.fulfill({ json: { profile: "internal", exportEnabled: true } });
      return;
    }
    if (path === "/api/system/menus") {
      await route.fulfill({ json: { items: [] } });
      return;
    }
    if (path === "/api/field-mappings/source-systems") {
      await route.fulfill({
        json: [{
          id: "1",
          sourceSystemId: "1",
          upstreamSystemId: "1",
          name: "测试源系统",
          systemName: "测试源系统",
          systemCode: "SYS-1",
          systemAbbr: "SYS-1",
          count: 1,
        }],
      });
      return;
    }
    if (path === "/api/field-mappings/stats") {
      requests.stats.push(url);
      if (options.onStats) {
        await options.onStats(route, url);
      } else {
        await route.fulfill({ json: statsPayload() });
      }
      return;
    }
    if (path === "/api/field-mappings/tables") {
      requests.tables.push(url);
      if (options.onTables) {
        await options.onTables(route, url);
      } else {
        await route.fulfill({
          json: {
            items: [tableRow("TABLE_READY")],
            total: 1,
            page: Number(url.searchParams.get("page") || 1),
            pageSize: Number(url.searchParams.get("pageSize") || 50),
          },
        });
      }
      return;
    }
    if (path === "/api/field-mappings/fields") {
      requests.fields.push(url);
      if (options.onFields) {
        await options.onFields(route, url);
      } else {
        await route.fulfill({
          json: {
            items: [fieldRow],
            total: 1,
            page: Number(url.searchParams.get("page") || 1),
            pageSize: Number(url.searchParams.get("pageSize") || 50),
          },
        });
      }
      return;
    }
    if (path === "/api/field-mappings/export") {
      requests.exports.push(url);
      await route.fulfill({ contentType: "text/csv; charset=utf-8", body: "source,target\nFIELD_ID,FIELD_ID\n" });
      return;
    }

    await route.fulfill({ json: [] });
  });
  return requests;
}

function statCard(page: Page, label: string) {
  return page.locator(".fm-stat-card").filter({ hasText: label }).locator(".fm-stat-value");
}

test("default table results render independently of slow stats and field details are on demand", async ({ page }) => {
  let markStatsStarted!: () => void;
  let releaseStats!: () => void;
  const statsStarted = new Promise<void>((resolve) => { markStatsStarted = resolve; });
  const statsGate = new Promise<void>((resolve) => { releaseStats = resolve; });
  const requests = await installApiFixtures(page, {
    onStats: async (route) => {
      markStatsStarted();
      await statsGate;
      await route.fulfill({ json: statsPayload(7, 4) });
    },
    onTables: async (route, url) => {
      await route.fulfill({
        json: {
          items: [tableRow("TABLE_READY")],
          total: 120,
          page: Number(url.searchParams.get("page") || 1),
          pageSize: Number(url.searchParams.get("pageSize") || 50),
        },
      });
    },
  });

  await page.goto("/field-mapping");
  await statsStarted;
  await expect(page.locator("#field-mapping-results-table tbody tr")).toHaveCount(1);
  await expect(page.getByText("TABLE_READY", { exact: true })).toBeVisible();
  await expect(statCard(page, "字段维度")).toHaveText("…");
  expect(requests.tables.length).toBeGreaterThan(0);
  expect(requests.fields).toHaveLength(0);

  await page.getByRole("button", { name: "下一页" }).click();
  await expect.poll(() => requests.tables.at(-1)?.searchParams.get("page")).toBe("2");
  await expect.poll(() => requests.tables.at(-1)?.searchParams.get("pageSize")).toBe("50");
  await page.getByRole("combobox", { name: "每页条数" }).click();
  await page.getByRole("option", { name: "100", exact: true }).click();
  await expect.poll(() => requests.tables.at(-1)?.searchParams.get("page")).toBe("1");
  await expect.poll(() => requests.tables.at(-1)?.searchParams.get("pageSize")).toBe("100");
  expect(requests.stats).toHaveLength(1);

  releaseStats();
  await expect(statCard(page, "字段维度")).toHaveText("7");
  await page.getByRole("button", { name: /字段维度/ }).click();
  await expect(page).toHaveURL(/tab=field/);
  await expect(page.getByRole("cell", { name: "FIELD_ID", exact: true }).first()).toBeVisible();
  await expect.poll(() => requests.fields.length).toBe(1);
  expect(requests.fields[0]?.searchParams.get("pageSize")).toBe("100");
  expect(requests.stats).toHaveLength(1);

  await page.locator("#field-mapping-results-table").getByRole("columnheader", { name: /源字段/ }).click();
  await expect.poll(() => requests.fields.length).toBe(2);
  expect(requests.fields.at(-1)?.searchParams.get("sortKey")).toBe("srcField");
  expect(requests.fields.at(-1)?.searchParams.get("sortDirection")).toBe("asc");
  await page.evaluate(() => {
    document.addEventListener("click", (event) => {
      const anchor = (event.target as Element | null)?.closest<HTMLAnchorElement>("a[download]");
      if (anchor) document.documentElement.dataset.csvDownloadName = anchor.download;
    }, true);
  });
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 CSV" }).click();
  const download = await downloadPromise;
  expect(await download.failure()).toBeNull();
  await expect(page.locator("html")).toHaveAttribute("data-csv-download-name", "字段映射_字段视图.csv");
  expect(requests.exports).toHaveLength(1);
  expect(requests.exports[0]?.searchParams.get("view")).toBe("field");
  expect(requests.exports[0]?.searchParams.get("pageSize")).toBe("100");
  expect(requests.exports[0]?.searchParams.get("sortKey")).toBe("srcField");
  expect(requests.exports[0]?.searchParams.get("sortDirection")).toBe("asc");
  expect(requests.stats).toHaveLength(1);

  await page.getByRole("button", { name: /表维度/ }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("tab")).toBeNull();
  await expect(page.getByText("TABLE_READY", { exact: true })).toBeVisible();
  expect(requests.fields).toHaveLength(2);
});

test("stats failure and retry do not clear or refetch the active table list", async ({ page }) => {
  let statsAttempts = 0;
  const requests = await installApiFixtures(page, {
    onStats: async (route) => {
      statsAttempts += 1;
      if (statsAttempts === 1) {
        await route.fulfill({ status: 503, json: { detail: "stats temporarily unavailable" } });
        return;
      }
      await route.fulfill({ json: statsPayload(0, 0) });
    },
  });

  await page.goto("/field-mapping");
  await expect(page.getByText("TABLE_READY", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "统计加载失败" })).toBeVisible();
  await expect(page.getByText("TABLE_READY", { exact: true })).toBeVisible();
  expect(requests.tables).toHaveLength(1);

  await page.getByRole("button", { name: "重试统计" }).click();
  await expect(statCard(page, "字段维度")).toHaveText("0");
  await expect(page.getByRole("alert").filter({ hasText: "统计加载失败" })).toHaveCount(0);
  await expect(page.getByText("TABLE_READY", { exact: true })).toBeVisible();
  expect(requests.tables).toHaveLength(1);
});

test("latest filter response wins for both list and stats", async ({ page }) => {
  let releaseOldStats!: () => void;
  let releaseOldTables!: () => void;
  let markOldStatsStarted!: () => void;
  let markOldTablesStarted!: () => void;
  let markNewStatsStarted!: () => void;
  let markNewTablesStarted!: () => void;
  const oldStatsStarted = new Promise<void>((resolve) => { markOldStatsStarted = resolve; });
  const oldTablesStarted = new Promise<void>((resolve) => { markOldTablesStarted = resolve; });
  const newStatsStarted = new Promise<void>((resolve) => { markNewStatsStarted = resolve; });
  const newTablesStarted = new Promise<void>((resolve) => { markNewTablesStarted = resolve; });
  const oldStatsGate = new Promise<void>((resolve) => { releaseOldStats = resolve; });
  const oldTablesGate = new Promise<void>((resolve) => { releaseOldTables = resolve; });
  let oldStatsFinished!: () => void;
  let oldTablesFinished!: () => void;
  const oldStatsDone = new Promise<void>((resolve) => { oldStatsFinished = resolve; });
  const oldTablesDone = new Promise<void>((resolve) => { oldTablesFinished = resolve; });

  await installApiFixtures(page, {
    onStats: async (route, url) => {
      const filter = url.searchParams.get("srcTable") || "";
      if (filter === "OLD") {
        markOldStatsStarted();
        await oldStatsGate;
        await route.fulfill({ json: statsPayload(1, 1) });
        oldStatsFinished();
        return;
      }
      if (filter === "NEW") {
        markNewStatsStarted();
        await route.fulfill({ json: statsPayload(3, 2) });
        return;
      }
      await route.fulfill({ json: statsPayload(5, 3) });
    },
    onTables: async (route, url) => {
      const filter = url.searchParams.get("srcTable") || "";
      if (filter === "OLD") {
        markOldTablesStarted();
        await oldTablesGate;
        await route.fulfill({
          json: { items: [tableRow("OLD_RESULT")], total: 1, page: 1, pageSize: 50 },
        });
        oldTablesFinished();
        return;
      }
      const srcTable = filter === "NEW" ? "NEW_RESULT" : "INITIAL_RESULT";
      if (filter === "NEW") markNewTablesStarted();
      await route.fulfill({ json: { items: [tableRow(srcTable)], total: 1, page: 1, pageSize: 50 } });
    },
  });

  await page.goto("/field-mapping");
  await expect(page.getByText("INITIAL_RESULT", { exact: true })).toBeVisible();
  const tableName = page.getByRole("textbox", { name: "源系统表名" });
  await tableName.fill("OLD");
  await page.getByRole("button", { name: "查询" }).click();
  await Promise.all([oldStatsStarted, oldTablesStarted]);

  await tableName.fill("NEW");
  await page.getByRole("button", { name: "查询" }).click();
  await Promise.all([newStatsStarted, newTablesStarted]);
  await expect(page.getByText("NEW_RESULT", { exact: true })).toBeVisible();
  await expect(statCard(page, "字段维度")).toHaveText("3");

  releaseOldStats();
  releaseOldTables();
  await Promise.all([oldStatsDone, oldTablesDone]);
  await expect(page.getByText("NEW_RESULT", { exact: true })).toBeVisible();
  await expect(page.getByText("OLD_RESULT", { exact: true })).toHaveCount(0);
  await expect(statCard(page, "字段维度")).toHaveText("3");
});

test("table-list failure preserves stats and retries only the active list", async ({ page }) => {
  let tableAttempts = 0;
  const requests = await installApiFixtures(page, {
    onTables: async (route) => {
      tableAttempts += 1;
      if (tableAttempts === 1) {
        await route.fulfill({ status: 503, json: { detail: "table list temporarily unavailable" } });
        return;
      }
      await route.fulfill({
        json: { items: [tableRow("TABLE_AFTER_RETRY")], total: 1, page: 1, pageSize: 50 },
      });
    },
  });

  await page.goto("/field-mapping");
  await expect(page.getByRole("alert").filter({ hasText: "表维度加载失败" })).toBeVisible();
  await expect(statCard(page, "字段维度")).toHaveText("7");
  expect(requests.stats).toHaveLength(1);

  await page.getByRole("button", { name: "重试列表" }).click();
  await expect(page.getByText("TABLE_AFTER_RETRY", { exact: true })).toBeVisible();
  expect(requests.tables).toHaveLength(2);
  expect(requests.stats).toHaveLength(1);
});

test("direct linked field URL loads only field details with its route filters", async ({ page }) => {
  const requests = await installApiFixtures(page);
  await page.goto("/field-mapping?tab=field&sourceSystemId=1&sourceTable=LINKED_SRC&dwfTable=LINKED_DWF&tablePk=pk-linked");

  await expect(page.getByRole("cell", { name: "FIELD_ID", exact: true }).first()).toBeVisible();
  expect(requests.tables).toHaveLength(0);
  expect(requests.fields).toHaveLength(1);
  expect(requests.stats).toHaveLength(1);
  for (const request of [requests.fields[0], requests.stats[0]]) {
    expect(request?.searchParams.get("sourceSystemId")).toBe("1");
    expect(request?.searchParams.get("srcTable")).toBe("LINKED_SRC");
    expect(request?.searchParams.get("targetTable")).toBe("LINKED_DWF");
    expect(request?.searchParams.get("tablePk")).toBe("pk-linked");
  }
  await expect(page).toHaveURL(/tab=field/);
});
