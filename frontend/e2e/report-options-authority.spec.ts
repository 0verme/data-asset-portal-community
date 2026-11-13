import { expect, test, type Page, type Route } from "@playwright/test";

const reportOptions = {
  reportTypes: ["CLIMATE_SUMMARY", "RESOURCE_INVENTORY", "CLIMATE_SUMMARY"],
  periods: ["P7", "P30", "P7"],
  statCalibers: ["source_event", "observation_window"],
  dataDelays: ["T+9"],
  departments: ["North region", "Field operations"],
};

type SavedReport = Record<string, unknown>;

function reportPage(items: SavedReport[]) {
  return {
    items,
    total: items.length,
    page: 1,
    pageSize: 20,
    facets: { type: {}, status: {}, ownerDept: {} },
    stats: { reportCount: items.length },
  };
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fulfillJson(route: Route, json: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: "application/json", json });
}

async function installBaseRemoteApi(
  page: Page,
  optionsHandler: (route: Route) => Promise<void>,
  reportListDelay: () => number = () => 0,
  savedReport: () => SavedReport | null = () => null,
  onUnpagedReportResponse: () => void = () => undefined,
  beforeUnpagedReportResponse: () => Promise<void> = async () => undefined,
): Promise<void> {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!url.pathname.startsWith("/api/")) {
      await route.continue();
      return;
    }
    const path = url.pathname.replace(/^\/api/, "");

    if (path === "/auth/me") {
      await fulfillJson(route, {
        data: {
          role: "report_editor",
          user: "e2e-editor",
          name: "E2E 报表维护者",
          permissions: ["report:write", "asset:read", "indicator:read"],
        },
      });
      return;
    }
    if (path === "/public-catalog/config") {
      await fulfillJson(route, { profile: "internal", exportEnabled: false });
      return;
    }
    if (path === "/reports/options") {
      await optionsHandler(route);
      return;
    }
    if (path === "/reports" && request.method() === "GET") {
      const current = savedReport();
      if (url.searchParams.has("page")) {
        await fulfillJson(route, reportPage(current ? [current] : []));
        return;
      }
      await delay(reportListDelay());
      await beforeUnpagedReportResponse();
      await fulfillJson(route, { items: current ? [current] : [] });
      onUnpagedReportResponse();
      return;
    }
    if (path === "/reports" && request.method() === "POST") {
      const body = request.postDataJSON() as SavedReport;
      const created = {
        ...body,
        updatedBy: "e2e-editor",
        updatedAt: "2026-01-01 00:00:00",
      };
      (page as Page & { __savedReport?: SavedReport }).__savedReport = created;
      await fulfillJson(route, { message: "报表创建成功", data: created }, 201);
      return;
    }
    if (path.startsWith("/reports/") && request.method() === "GET") {
      const current = savedReport();
      if (!current) {
        await fulfillJson(route, { error: { code: "REPORT_NOT_FOUND", message: "not found" } }, 404);
      } else {
        await fulfillJson(route, { data: current });
      }
      return;
    }
    if (path === "/assets/domains") {
      await fulfillJson(route, { items: [{ name: "climate" }] });
      return;
    }
    if (["/assets/tables", "/assets/layers", "/indicators"].includes(path)) {
      await fulfillJson(route, { items: [] });
      return;
    }

    await fulfillJson(route, { items: [] });
  });
}

function getSavedReport(page: Page): SavedReport | null {
  return (page as Page & { __savedReport?: SavedReport }).__savedReport || null;
}

async function chooseOption(page: Page, label: string, value: string): Promise<void> {
  const control = page.getByRole("combobox", { name: label });
  await control.click();
  await page.getByRole("option", { name: value, exact: true }).click();
}

test("Remote zero-report first creation uses server candidates, then list and edit reload", async ({ page }) => {
  let optionsRequests = 0;
  let optionsResponses = 0;
  let unpagedReportRequests = 0;
  let unpagedReportResponses = 0;
  let firstReportListReleased = false;
  let releaseFirstReportList: () => void = () => undefined;
  const firstReportListGate = new Promise<void>((resolve) => {
    releaseFirstReportList = resolve;
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await installBaseRemoteApi(
    page,
    async (route) => {
      optionsRequests += 1;
      await delay(20);
      await fulfillJson(route, { options: reportOptions });
      optionsResponses += 1;
    },
    () => {
      unpagedReportRequests += 1;
      return 0;
    },
    () => getSavedReport(page),
    () => { unpagedReportResponses += 1; },
    async () => {
      if (!firstReportListReleased) await firstReportListGate;
    },
  );

  const optionsResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith("/api/reports/options"),
  );
  await page.goto("/report-assets/new");
  await optionsResponse;
  await expect(page.getByRole("heading", { name: "新增报表" })).toBeVisible({ timeout: 20_000 });
  const reportType = page.getByRole("combobox", { name: "报表类型" });
  await expect(reportType).toContainText("请选择报表类型");
  await expect.poll(() => optionsResponses).toBe(1);
  await expect.poll(() => unpagedReportRequests).toBeGreaterThan(0);
  expect(unpagedReportResponses).toBe(0);
  await chooseOption(page, "报表类型", "CLIMATE_SUMMARY");
  firstReportListReleased = true;
  releaseFirstReportList();
  await expect.poll(() => unpagedReportResponses).toBeGreaterThan(0);
  await chooseOption(page, "主题域", "climate");
  await chooseOption(page, "归属部门", "North region");
  await chooseOption(page, "统计周期", "P7");

  await page.getByLabel("报表编码").fill("RPT_CLIMATE_001");
  await page.getByLabel("报表名称").fill("Climate summary");
  await page.getByLabel("负责人").fill("E2E editor");
  await page.getByRole("combobox", { name: "统计口径" }).fill("source_event");
  await page.getByRole("button", { name: "创建报表" }).click();

  await expect(page.locator(".page-title")).toContainText("报表资产");
  await expect(page.getByText("RPT_CLIMATE_001", { exact: false })).toBeVisible();
  await expect.poll(() => unpagedReportRequests).toBeGreaterThan(0);
  expect(optionsRequests).toBeGreaterThanOrEqual(1);
  expect(getSavedReport(page)?.["type"]).toBe("CLIMATE_SUMMARY");
  expect(getSavedReport(page)?.["statPeriod"]).toBe("P7");
  expect(getSavedReport(page)?.["ownerDept"]).toBe("North region");

  await page.goto("/report-assets/RPT_CLIMATE_001/edit");
  await expect(page.getByRole("heading", { name: "编辑报表" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("combobox", { name: "报表类型" })).toContainText("CLIMATE_SUMMARY");
  await expect(page.getByRole("combobox", { name: "归属部门" })).toContainText("North region");
  await expect(page.getByRole("combobox", { name: "统计周期" })).toContainText("P7");
  expect(optionsRequests).toBeGreaterThanOrEqual(2);
});

test("Remote report list finishing first cannot overwrite authoritative candidates", async ({ page }) => {
  const completed = new Set<string>();
  await installBaseRemoteApi(
    page,
    async (route) => {
      await delay(220);
      await fulfillJson(route, { options: reportOptions });
      completed.add("options");
    },
    () => {
      // getReportList() is the unpaged request used to retain legacy values.
      return 5;
    },
    () => null,
    () => { completed.add("reports"); },
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/report-assets/new");
  await expect(page.getByRole("heading", { name: "新增报表" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("option", { name: "CLIMATE_SUMMARY", exact: true })).toHaveCount(0);
  await page.getByRole("combobox", { name: "报表类型" }).click();
  await expect(page.getByRole("option", { name: "CLIMATE_SUMMARY", exact: true })).toBeVisible();
  await expect.poll(() => completed.size).toBe(2);
  expect([...completed]).toEqual(["reports", "options"]);
});

test("Remote option failures and stalled responses show an actionable error, preserve input, and never use Mock values", async ({ page }) => {
  const failures: Array<number | "network" | "stall"> = [403, 500, 503, "network", "stall"];
  let attempt = 0;
  await page.setViewportSize({ width: 390, height: 844 });
  await installBaseRemoteApi(page, async (route) => {
    const failure = failures[attempt];
    attempt += 1;
    if (failure === "network") {
      await route.abort("failed");
      return;
    }
    if (failure === "stall") {
      // The focused runner sets VITE_API_TIMEOUT=2000 to exercise the actual timeout branch;
      // other CI runs still verify that a stalled request fails closed and can be retried.
      await delay(2_500);
      try {
        await route.abort("timedout");
      } catch {
        // The browser's request timeout may have already aborted the route.
      }
      return;
    }
    if (failure !== undefined) {
      await fulfillJson(
        route,
        { error: { code: "SYNTHETIC_ERROR", message: "internal fixture detail" } },
        failure,
      );
      return;
    }
    await fulfillJson(route, { options: reportOptions });
  });

  await page.goto("/report-assets/new");
  await expect(page.getByRole("heading", { name: "新增报表" })).toBeVisible({ timeout: 20_000 });
  const optionsError = page.getByRole("alert").filter({ hasText: "报表候选加载失败" });
  await expect(optionsError).toBeVisible();
  await expect(optionsError).toContainText("不会使用本地演示候选");
  await expect(optionsError.getByRole("button", { name: "重试加载报表候选" })).toBeVisible();
  await page.getByLabel("报表编码").fill("RPT_KEEP_INPUT");
  await page.getByLabel("报表名称").fill("Preserved input");
  const typeSelect = page.getByRole("combobox", { name: "报表类型" });
  await typeSelect.click();
  await expect(page.getByRole("option", { name: "经营分析", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");

  for (let failureIndex = 1; failureIndex <= failures.length; failureIndex += 1) {
    const failure = failures[failureIndex];
    await page.getByRole("button", { name: "重试加载报表候选" }).click();
    const configuredTimeout = Number(process.env["VITE_API_TIMEOUT"]);
    if (failure === "stall" && configuredTimeout > 0 && configuredTimeout < 2_500) {
      await expect(optionsError).toContainText("超时");
    }
    if (failureIndex < failures.length) {
      await expect(optionsError).toBeVisible();
      await expect(page.getByLabel("报表编码")).toHaveValue("RPT_KEEP_INPUT");
      await expect(page.getByLabel("报表名称")).toHaveValue("Preserved input");
    }
  }

  await expect(optionsError).toHaveCount(0);
  await expect(page.getByRole("option", { name: "CLIMATE_SUMMARY", exact: true })).toHaveCount(0);
  await typeSelect.click();
  await expect(page.getByRole("option", { name: "CLIMATE_SUMMARY", exact: true })).toBeVisible();
  await expect(page.getByLabel("报表编码")).toHaveValue("RPT_KEEP_INPUT");
  await expect(page.getByLabel("报表名称")).toHaveValue("Preserved input");
  expect(attempt).toBe(failures.length + 1);
});

test("an empty authoritative dictionary is explained without inventing Remote candidates", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installBaseRemoteApi(page, async (route) => {
    await fulfillJson(route, {
      options: {
        reportTypes: [],
        periods: [],
        statCalibers: [],
        dataDelays: [],
        departments: [],
      },
    });
  });

  await page.goto("/report-assets/new");
  await expect(page.getByRole("heading", { name: "新增报表" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("status").filter({ hasText: "尚未配置报表类型" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "尚未配置统计周期" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "尚未配置归属部门" })).toBeVisible();
  await page.getByRole("combobox", { name: "报表类型" }).click();
  await expect(page.getByRole("option", { name: "经营分析", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  const caliber = page.getByRole("combobox", { name: "统计口径" });
  await caliber.fill("source_event");
  await expect(caliber).toHaveValue("source_event");
});
