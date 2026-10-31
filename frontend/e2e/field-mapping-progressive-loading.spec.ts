import { readFile } from "node:fs/promises";
import { expect, test, type Download, type Locator, type Page, type Route, type TestInfo } from "@playwright/test";

const remoteFixturesEnabled = String(process.env["VITE_API_MODE"] || "")
  .trim()
  .toLowerCase() === "remote";

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
  onExport?: (route: Route, url: URL) => Promise<void>;
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
      if (options.onExport) {
        await options.onExport(route, url);
      } else {
        await route.fulfill({ contentType: "text/csv; charset=utf-8", body: "source,target\nFIELD_ID,FIELD_ID\n" });
      }
      return;
    }

    await route.fulfill({ json: [] });
  });
  return requests;
}

function statCard(page: Page, label: string) {
  return page.locator(".fm-stat-card").filter({ hasText: label }).locator(".fm-stat-value");
}

async function downloadText(download: Download, testInfo: TestInfo, fileName: string): Promise<string> {
  const path = testInfo.outputPath(fileName);
  await download.saveAs(path);
  return (await readFile(path, "utf8")).replace(/^\uFEFF/, "");
}

function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (character === '"') {
      if (quoted && content[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if (character === "\n" && !quoted) {
      row.push(cell.replace(/\r$/, ""));
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (cell || row.length) {
    row.push(cell.replace(/\r$/, ""));
    if (row.some((value) => value !== "")) rows.push(row);
  }
  return rows;
}

async function exportAndAssertColumns(
  page: Page,
  testInfo: TestInfo,
  view: "field" | "table",
  expectedHeaders: string[],
): Promise<string[][]> {
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 CSV" }).click();
  const download = await downloadPromise;
  expect(await download.failure()).toBeNull();
  const rows = parseCsv(await downloadText(download, testInfo, `${view}-view.csv`));
  expect(rows).toHaveLength(2);
  for (const row of rows) expect(row).toHaveLength(expectedHeaders.length);
  expect(rows[0]).toEqual(expectedHeaders);
  return rows;
}

async function countEffectiveHeaderColumns(table: Locator): Promise<number[]> {
  return table.locator("thead").evaluate((thead) => {
    const occupiedUntil = new Map<number, number>();
    const rowWidths: number[] = [];
    Array.from(thead.rows).forEach((row, rowIndex) => {
      let column = 0;
      Array.from(row.cells).forEach((cell) => {
        while ((occupiedUntil.get(column) ?? 0) > rowIndex) column += 1;
        const end = column + cell.colSpan;
        for (let position = column; position < end; position += 1) {
          occupiedUntil.set(position, Math.max(occupiedUntil.get(position) ?? 0, rowIndex + cell.rowSpan));
        }
        column = end;
      });
      rowWidths.push(column);
    });
    return rowWidths;
  });
}

test("source options failure stays visible and can be retried independently", async ({ page }) => {
  await installApiFixtures(page);
  let attempts = 0;
  await page.route("**/api/field-mappings/source-systems", async (route) => {
    attempts += 1;
    await route.fulfill(attempts === 1
      ? { status: 503, json: { error: { message: "选项暂时不可用" } } }
      : { json: { items: [] } });
  });
  await page.goto("/field-mapping");
  await expect(page.getByRole("alert").filter({ hasText: "来源系统加载失败" })).toBeVisible();
  await page.getByRole("button", { name: "重试来源系统" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "来源系统加载失败" })).toHaveCount(0);
  expect(attempts).toBe(2);
});

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
  expect(requests.exports[0]?.searchParams.get("page")).toBeNull();
  expect(requests.exports[0]?.searchParams.get("pageSize")).toBeNull();
  expect(requests.exports[0]?.searchParams.get("sortKey")).toBe("srcField");
  expect(requests.exports[0]?.searchParams.get("sortDirection")).toBe("asc");
  expect(requests.stats).toHaveLength(1);

  await page.getByRole("button", { name: /表维度/ }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("tab")).toBeNull();
  await expect(page.getByText("TABLE_READY", { exact: true })).toBeVisible();
  expect(requests.fields).toHaveLength(2);
});

test("complete field-mapping export ignores the current page and preserves filter and sort", async ({ page }, testInfo) => {
  const requests = await installApiFixtures(page, {
    onFields: async (route, url) => {
      await route.fulfill({
        json: {
          items: [fieldRow],
          total: 120,
          page: Number(url.searchParams.get("page") || 1),
          pageSize: Number(url.searchParams.get("pageSize") || 50),
        },
      });
    },
    onExport: async (route) => {
      const rows = Array.from({ length: 120 }, (_, index) => `SYS-1,FILTERED_TABLE,FIELD_${index + 1}`);
      const lineEnding = String.fromCharCode(13, 10);
      await route.fulfill({
        contentType: "text/csv; charset=utf-8",
        body: `${String.fromCharCode(0xfeff)}源系统,源系统表,源字段${lineEnding}${rows.join(lineEnding)}${lineEnding}`,
      });
    },
  });

  await page.goto("/field-mapping");
  await expect(page.getByText("TABLE_READY", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "源系统表名" }).fill("FILTERED_TABLE");
  await page.getByRole("button", { name: "查询", exact: true }).click();
  await expect.poll(() => requests.tables.at(-1)?.searchParams.get("srcTable")).toBe("FILTERED_TABLE");

  await page.getByRole("button", { name: /字段维度/ }).click();
  await expect.poll(() => requests.fields.at(-1)?.searchParams.get("srcTable")).toBe("FILTERED_TABLE");
  await expect(page.getByText("FIELD_ON_DEMAND", { exact: true })).toBeVisible();
  await page.locator("#field-mapping-results-table").getByRole("columnheader", { name: /源字段/ }).click();
  await expect.poll(() => requests.fields.at(-1)?.searchParams.get("sortKey")).toBe("srcField");
  await page.getByRole("button", { name: "下一页" }).click();
  await expect.poll(() => requests.fields.at(-1)?.searchParams.get("page")).toBe("2");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 CSV" }).click();
  const download = await downloadPromise;
  expect(await download.failure()).toBeNull();
  const csvRows = parseCsv(await downloadText(download, testInfo, "complete-field-export.csv"));
  expect(csvRows).toHaveLength(121);

  expect(requests.exports).toHaveLength(1);
  const exportParams = requests.exports[0]?.searchParams;
  expect(exportParams?.get("view")).toBe("field");
  expect(exportParams?.get("srcTable")).toBe("FILTERED_TABLE");
  expect(exportParams?.get("sortKey")).toBe("srcField");
  expect(exportParams?.get("sortDirection")).toBe("asc");
  expect(exportParams?.get("page")).toBeNull();
  expect(exportParams?.get("pageSize")).toBeNull();
});

test("complete field-mapping export preserves table sort across the current page boundary", async ({ page }, testInfo) => {
  const requests = await installApiFixtures(page, {
    onTables: async (route, url) => {
      await route.fulfill({
        json: {
          items: [tableRow("FILTERED_TABLE")],
          total: 120,
          page: Number(url.searchParams.get("page") || 1),
          pageSize: Number(url.searchParams.get("pageSize") || 50),
        },
      });
    },
    onExport: async (route) => {
      const rows = Array.from({ length: 120 }, (_, index) => `SYS-1,FILTERED_TABLE_${index + 1}`);
      const lineEnding = String.fromCharCode(13, 10);
      await route.fulfill({
        contentType: "text/csv; charset=utf-8",
        body: `${String.fromCharCode(0xfeff)}源系统,源系统表${lineEnding}${rows.join(lineEnding)}${lineEnding}`,
      });
    },
  });

  await page.goto("/field-mapping");
  await expect(page.getByText("FILTERED_TABLE", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "源系统表名" }).fill("FILTERED_TABLE");
  await page.getByRole("button", { name: "查询", exact: true }).click();
  await expect.poll(() => requests.tables.at(-1)?.searchParams.get("srcTable")).toBe("FILTERED_TABLE");
  await page.locator("#field-mapping-results-table").getByRole("columnheader", { name: /源系统表/ }).click();
  await page.getByRole("button", { name: "下一页" }).click();
  await expect.poll(() => requests.tables.at(-1)?.searchParams.get("page")).toBe("2");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 CSV" }).click();
  const download = await downloadPromise;
  expect(await download.failure()).toBeNull();
  const csvRows = parseCsv(await downloadText(download, testInfo, "complete-table-export.csv"));
  expect(csvRows).toHaveLength(121);

  const exportParams = requests.exports[0]?.searchParams;
  expect(requests.exports).toHaveLength(1);
  expect(exportParams?.get("view")).toBe("table");
  expect(exportParams?.get("srcTable")).toBe("FILTERED_TABLE");
  expect(exportParams?.get("sortKey")).toBe("srcTable");
  expect(exportParams?.get("sortDirection")).toBe("asc");
  expect(exportParams?.get("page")).toBeNull();
  expect(exportParams?.get("pageSize")).toBeNull();
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

test("field-mapping column contract aligns field/table cells and preserves CSV columns", async ({ page }, testInfo) => {
  const rows = [
    {
      ...fieldRow,
      tablePk: "pk-populated",
      srcField: "AMOUNT",
      srcComment: "销售金额",
      targetLayer: "DWF",
      targetTable: "DWF_SALES",
      loadMode: "incr",
      targetField: "AMOUNT_VALUE",
      mappingRule: "日期格式化",
    },
    {
      ...fieldRow,
      tablePk: "pk-empty",
      srcField: "EMPTY_LAYER",
      srcComment: "空目标层及未知入仓方式",
      targetLayer: "",
      targetTable: "DWF_EMPTY_LAYER",
      loadMode: "future_mode",
      targetField: "EMPTY_LAYER_VALUE",
    },
    {
      ...fieldRow,
      tablePk: "pk-missing",
      srcField: "MISSING_METADATA",
      srcComment: "缺少目标层及入仓方式",
      targetLayer: undefined,
      targetTable: "DWF_MISSING_METADATA",
      loadMode: undefined,
      targetField: "MISSING_METADATA_VALUE",
    },
  ];
  const fieldCsv = [
    "源系统,源系统表,源字段,字段类型,字段注释,目标层,目标表名,入仓方式,目标字段,映射规则",
    "测试源系统 · SYS-1,SRC_SALES,AMOUNT,DECIMAL,销售金额,DWF,DWF_SALES,incr,AMOUNT_VALUE,日期格式化",
  ].join("\r\n");
  const tableCsv = [
    "源系统,源系统表,表中文名,目标层,目标表名,入仓方式,已映射,空注释率",
    "测试源系统 · SYS-1,SRC_SALES,销售表,DWF,DWF_SALES,增量,3,0",
  ].join("\r\n");
  const requests = await installApiFixtures(page, {
    onFields: async (route, url) => {
      const pageSize = Number(url.searchParams.get("pageSize") || 50);
      const pageNumber = Number(url.searchParams.get("page") || 1);
      const start = (pageNumber - 1) * pageSize;
      await route.fulfill({ json: { items: rows.slice(start, start + pageSize), total: rows.length, page: pageNumber, pageSize } });
    },
    onExport: async (route, url) => {
      await route.fulfill({
        contentType: "text/csv; charset=utf-8",
        body: url.searchParams.get("view") === "field" ? fieldCsv : tableCsv,
      });
    },
  });
  await page.goto("/field-mapping");

  const table = page.locator("#field-mapping-results-table");
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await expect(table.locator("thead th")).toHaveCount(8);
  await expect(table.locator("colgroup col")).toHaveCount(8);
  await expect(table.locator("tbody tr").first().locator("td")).toHaveCount(8);
  await expect(table.locator("thead")).not.toContainText("目标层");
  const tableCsvRows = await exportAndAssertColumns(page, testInfo, "table", [
    "源系统", "源系统表", "表中文名", "目标层", "目标表名", "入仓方式", "已映射", "空注释率",
  ]);
  expect(tableCsvRows[1]).toEqual([
    "测试源系统 · SYS-1", "SRC_SALES", "销售表", "DWF", "DWF_SALES", "增量", "3", "0",
  ]);
  expect(requests.exports.at(-1)?.searchParams.get("view")).toBe("table");

  await page.getByRole("button", { name: /字段维度/ }).click();
  await expect(table.locator("tbody tr")).toHaveCount(3);
  await expect(table.locator("colgroup col")).toHaveCount(11);
  expect(await countEffectiveHeaderColumns(table)).toEqual([11, 11]);
  const fieldHeaders = (await table.locator("thead tr").last().locator("th").allInnerTexts())
    .map((label) => label.trim());
  expect(fieldHeaders).toEqual([
    "源系统", "源系统表", "源字段", "字段类型", "字段注释",
    "目标层", "目标表名", "入仓方式", "目标字段", "映射规则",
  ]);
  await expect(table.locator("thead .fm-arrow-col")).toHaveAttribute("rowspan", "2");

  const fieldRows = await table.locator("tbody tr").all();
  for (const row of fieldRows) await expect(row.locator("td")).toHaveCount(11);
  const populatedCells = (await fieldRows[0]!.locator("td").allInnerTexts())
    .map((value) => value.trim());
  expect(populatedCells).toEqual([
    "测试源系统", "FIELD_ON_DEMAND", "AMOUNT", "VARCHAR", "销售金额", "→",
    "DWF", "DWF_SALES", "增量", "AMOUNT_VALUE", "日期格式化",
  ]);
  expect(Object.fromEntries(fieldHeaders.slice(0, 5).map((header, index) => [header, populatedCells[index]]))).toEqual({
    "源系统": "测试源系统",
    "源系统表": "FIELD_ON_DEMAND",
    "源字段": "AMOUNT",
    "字段类型": "VARCHAR",
    "字段注释": "销售金额",
  });
  expect(Object.fromEntries(fieldHeaders.slice(5).map((header, index) => [header, populatedCells[index + 6]]))).toEqual({
    "目标层": "DWF",
    "目标表名": "DWF_SALES",
    "入仓方式": "增量",
    "目标字段": "AMOUNT_VALUE",
    "映射规则": "日期格式化",
  });
  await expect(fieldRows[0]!.locator("td").nth(8).locator(".tag")).toHaveClass(/tag-ok/);
  for (const rowIndex of [1, 2]) {
    const targetCells = (await fieldRows[rowIndex]!.locator("td").allInnerTexts()).slice(6).map((value) => value.trim());
    expect(targetCells[0]).toBe("-");
    expect(targetCells[2]).toBe("未设置");
    await expect(fieldRows[rowIndex]!.locator("td").nth(8).locator(".fm-empty")).toHaveText("未设置");
  }

  const fieldCsvRows = await exportAndAssertColumns(page, testInfo, "field", [
    "源系统", "源系统表", "源字段", "字段类型", "字段注释",
    "目标层", "目标表名", "入仓方式", "目标字段", "映射规则",
  ]);
  expect(fieldCsvRows[1]).toEqual([
    "测试源系统 · SYS-1", "SRC_SALES", "AMOUNT", "DECIMAL", "销售金额",
    "DWF", "DWF_SALES", "incr", "AMOUNT_VALUE", "日期格式化",
  ]);
  expect(requests.exports.at(-1)?.searchParams.get("view")).toBe("field");

  await page.getByRole("button", { name: /表维度/ }).click();
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await expect(table.locator("colgroup col")).toHaveCount(8);
  await expect(table.locator("thead th")).toHaveCount(8);
  await expect(table.locator("tbody tr").first().locator("td")).toHaveCount(8);
  await expect(table.locator("thead")).not.toContainText("目标层");
  expect(requests.tables.length).toBeGreaterThan(1);
});

test("field-mapping column contract preserves wide scrolling and the fixed header", async ({ page }) => {
  const rows = Array.from({ length: 60 }, (_, index) => ({
    ...fieldRow,
    tablePk: `pk-wide-${index}`,
    srcField: `SOURCE_FIELD_${index}`,
    targetField: `TARGET_FIELD_${index}`,
  }));
  await installApiFixtures(page, {
    onFields: async (route, url) => {
      const pageSize = Number(url.searchParams.get("pageSize") || 50);
      const pageNumber = Number(url.searchParams.get("page") || 1);
      const start = (pageNumber - 1) * pageSize;
      await route.fulfill({ json: { items: rows.slice(start, start + pageSize), total: rows.length, page: pageNumber, pageSize } });
    },
  });
  await page.goto("/field-mapping?tab=field");

  const table = page.locator("#field-mapping-results-table");
  const bodyRows = table.locator("tbody tr");
  await expect(bodyRows).toHaveCount(50);
  for (const row of await bodyRows.all()) await expect(row.locator("td")).toHaveCount(11);

  const main = page.locator(".main");
  const wrapper = page.locator(".fm-table-wrap");
  await expect.poll(() => wrapper.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  await main.evaluate((element) => {
    const tableWrapper = element.querySelector<HTMLElement>(".fm-table-wrap");
    if (!tableWrapper) throw new Error("field mapping table wrapper missing");
    const distance = tableWrapper.getBoundingClientRect().top - element.getBoundingClientRect().top + 120;
    element.scrollTop += distance;
  });

  const stickyHeader = page.locator(".fm-sticky-table-head");
  await expect(stickyHeader).toBeVisible();
  await expect.poll(() => stickyHeader.evaluate((element) => getComputedStyle(element).position)).toBe("fixed");
  await expect(stickyHeader.locator("colgroup col")).toHaveCount(11);
  const horizontalScrollbar = page.getByRole("scrollbar", { name: "字段映射表格横向滚动" });
  await expect(horizontalScrollbar).toBeVisible();
  await horizontalScrollbar.focus();
  await horizontalScrollbar.press("End");
  await expect.poll(() => wrapper.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await expect.poll(async () => {
    const [tableScrollLeft, stickyScrollLeft] = await Promise.all([
      wrapper.evaluate((element) => element.scrollLeft),
      stickyHeader.evaluate((element) => element.scrollLeft),
    ]);
    return Math.abs(tableScrollLeft - stickyScrollLeft);
  }).toBeLessThanOrEqual(1);
});

test("field-mapping mock CSV contract keeps ten business fields and excludes the arrow", async ({ page }, testInfo) => {
  test.skip(remoteFixturesEnabled, "Client-generated CSV is exercised in the VITE_API_MODE=mock run.");
  await page.addInitScript(() => {
    localStorage.setItem("dap_auth", JSON.stringify({ role: "admin", user: "field-mapping-e2e", name: "字段映射 E2E" }));
    localStorage.setItem("dap-theme", "light");
  });
  await page.goto("/field-mapping?tab=field");
  const table = page.locator("#field-mapping-results-table");
  await expect(table.locator("tbody tr").first()).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 CSV" }).click();
  const download = await downloadPromise;
  expect(await download.failure()).toBeNull();
  const csvRows = parseCsv(await downloadText(download, testInfo, "mock-field-view.csv"));
  expect(csvRows[0]).toEqual([
    "源系统", "源系统表", "源字段", "字段类型", "字段注释",
    "目标层", "目标表名", "入仓方式", "目标字段", "映射规则",
  ]);
  expect(csvRows.length).toBeGreaterThan(1);
  for (const row of csvRows) expect(row).toHaveLength(10);
  expect(csvRows[0]).not.toContain("映射方向");
});
