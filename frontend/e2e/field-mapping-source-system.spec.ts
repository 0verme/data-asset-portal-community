import { expect, test, type Page, type TestInfo } from "@playwright/test";

const remoteFixturesEnabled = String(process.env["VITE_API_MODE"] || "")
  .trim()
  .toLowerCase() === "remote";
const longSystemId = "27";
const longSystemName = "跨区域客户关系与会员交易数据交换平台（中文显示名称较长）".repeat(2);
const longSystemCode = "CRM-MEMBER-REGIONAL-OPERATIONS-2026";
const longSystemLabel = `${longSystemName} · ${longSystemCode}`;
const remoteSourceSystems = Array.from({ length: 36 }, (_, index) => {
  const sourceSystemId = String(index + 1);
  const isLongLabel = sourceSystemId === longSystemId;
  return {
    id: sourceSystemId,
    sourceSystemId,
    upstreamSystemId: sourceSystemId,
    name: isLongLabel ? longSystemName : `源系统 ${sourceSystemId.padStart(2, "0")}`,
    systemName: isLongLabel ? longSystemName : `源系统 ${sourceSystemId.padStart(2, "0")}`,
    systemCode: isLongLabel ? longSystemCode : `SYS-${sourceSystemId.padStart(2, "0")}`,
    systemAbbr: isLongLabel ? longSystemCode : `SYS-${sourceSystemId.padStart(2, "0")}`,
    count: 1,
  };
});

type RequestLog = {
  sourceSystems: URL[];
  tables: URL[];
  fields: URL[];
  stats: URL[];
  exports: URL[];
};

type FixtureOptions = {
  emptySystems?: boolean;
  failSystems?: boolean;
  failTables?: boolean;
  failFields?: boolean;
};

async function installRemoteFixtures(
  page: Page,
  requests: RequestLog,
  options: FixtureOptions = {},
): Promise<void> {
  const sourceSystems = options.emptySystems ? [] : remoteSourceSystems;
  await page.addInitScript(() => {
    localStorage.setItem("dap_auth", JSON.stringify({ role: "admin", user: "admin", name: "管理员" }));
    localStorage.setItem("dap-theme", "light");
  });
  await page.route("**/api/**", async (requestRoute) => {
    const requestUrl = new URL(requestRoute.request().url());
    const path = requestUrl.pathname;
    if (!path.startsWith("/api/")) {
      await requestRoute.continue();
      return;
    }

    if (path === "/api/auth/me") {
      await requestRoute.fulfill({
        json: {
          role: "admin",
          user: "issue-527-e2e",
          name: "Issue 527 E2E",
          permissions: ["field_mapping:read", "system:menu:read"],
        },
      });
      return;
    }
    if (path === "/api/public-catalog/config") {
      await requestRoute.fulfill({ json: { profile: "internal", exportEnabled: false } });
      return;
    }
    if (path === "/api/system/menus") {
      await requestRoute.fulfill({ json: { items: [] } });
      return;
    }
    if (path === "/api/field-mappings/source-systems") {
      requests.sourceSystems.push(requestUrl);
      if (options.failSystems) {
        await requestRoute.fulfill({
          status: 503,
          json: { error: { message: "测试源系统清单故障" } },
        });
      } else {
        await requestRoute.fulfill({ json: { items: sourceSystems } });
      }
      return;
    }
    if (path === "/api/field-mappings/stats") {
      requests.stats.push(requestUrl);
      await requestRoute.fulfill({
        json: {
          sourceSystemCount: sourceSystems.length,
          sourceTableCount: 250,
          fieldCount: 250,
          mappedFieldCount: 225,
          unmappedFieldCount: 25,
          emptyCommentCount: 12,
          coverage: 90,
        },
      });
      return;
    }
    if (path === "/api/field-mappings/tables") {
      requests.tables.push(requestUrl);
      if (options.failTables) {
        await requestRoute.fulfill({
          status: 503,
          json: { error: { message: "测试表映射查询故障" } },
        });
        return;
      }
      await requestRoute.fulfill({
        json: {
          items: [],
          total: 250,
          page: Number(requestUrl.searchParams.get("page") || 1),
          pageSize: Number(requestUrl.searchParams.get("pageSize") || 50),
        },
      });
      return;
    }
    if (path === "/api/field-mappings/fields") {
      requests.fields.push(requestUrl);
      if (options.failFields) {
        await requestRoute.fulfill({
          status: 503,
          json: { error: { message: "测试字段映射查询故障" } },
        });
        return;
      }
      await requestRoute.fulfill({
        json: {
          items: [],
          total: 250,
          page: Number(requestUrl.searchParams.get("page") || 1),
          pageSize: Number(requestUrl.searchParams.get("pageSize") || 50),
        },
      });
      return;
    }
    if (path === "/api/field-mappings/export") {
      requests.exports.push(requestUrl);
      await requestRoute.fulfill({ json: "源系统,源表\r\n" });
      return;
    }

    await requestRoute.fulfill({ json: [] });
  });
}

function createRequestLog(): RequestLog {
  return { sourceSystems: [], tables: [], fields: [], stats: [], exports: [] };
}

async function expectQuery(
  requests: readonly URL[],
  start: number,
  predicate: (requestUrl: URL) => boolean,
): Promise<URL> {
  await expect.poll(() => requests.slice(start).some(predicate)).toBe(true);
  const match = requests.slice(start).find(predicate);
  if (!match) throw new Error("Expected mapping request was not recorded.");
  return match;
}

test("source-system navigator searches locally and filters table/field queries, pagination, and CSV", async ({ page }, testInfo: TestInfo) => {
  test.skip(!remoteFixturesEnabled, "This interaction test uses isolated remote API fixtures.");
  const requests = createRequestLog();
  await installRemoteFixtures(page, requests);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/field-mapping");

  const allSystems = page.getByRole("button", { name: "全部源系统", exact: true });
  const search = page.getByRole("searchbox", { name: "搜索源系统" });
  await expect(allSystems).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "表维度加载失败" })).toHaveCount(0);
  const initialTableRequest = await expectQuery(requests.tables, 0, () => true);
  expect(initialTableRequest.searchParams.get("page")).toBe("1");

  const systemList = page.getByRole("navigation", { name: "源系统列表" });
  const listMetrics = await systemList.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(listMetrics.scrollHeight).toBeGreaterThan(listMetrics.clientHeight);
  const pageScrollBefore = await page.evaluate(() => window.scrollY);
  await systemList.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  expect(await systemList.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(pageScrollBefore);
  await systemList.evaluate((element) => { element.scrollTop = 0; });
  await page.getByRole("button", { name: "收起源系统导航" }).click();
  await expect(search).toHaveCount(0);
  await expect(page.getByRole("button", { name: "展开源系统导航" })).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: "展开源系统导航" }).click();
  await expect(search).toBeVisible();

  const tableRequestCount = requests.tables.length;
  const fieldRequestCount = requests.fields.length;
  await search.fill(longSystemName.slice(0, 10));
  await expect(page.locator(".mapping-system-list .mapping-system-item")).toHaveCount(2);
  await expect(page.getByRole("button", { name: longSystemLabel, exact: true })).toBeVisible();
  await search.fill(longSystemCode);
  await expect(page.getByRole("button", { name: longSystemLabel, exact: true })).toBeVisible();
  expect(requests.tables).toHaveLength(tableRequestCount);
  expect(requests.fields).toHaveLength(fieldRequestCount);

  await page.getByLabel("源系统表名").fill("MEMBER_PROFILE");
  await page.getByLabel("源字段名").fill("ACCOUNT_NO");
  await page.getByLabel("DWF 表名").fill("DWD_MEMBER_PROFILE");
  await page.getByLabel("DWF 字段名").fill("member_id");
  await page.locator(".fm-optional-filter select").selectOption("yes");
  const applyStart = requests.tables.length;
  await page.getByRole("button", { name: "查询", exact: true }).click();
  const appliedQuery = await expectQuery(requests.tables, applyStart, (url) => (
    url.searchParams.get("srcTable") === "MEMBER_PROFILE"
  ));
  expect(appliedQuery.searchParams.get("srcField")).toBe("ACCOUNT_NO");
  expect(appliedQuery.searchParams.get("targetTable")).toBe("DWD_MEMBER_PROFILE");
  expect(appliedQuery.searchParams.get("targetField")).toBe("member_id");
  expect(appliedQuery.searchParams.get("emptyComment")).toBe("yes");

  const selectSystemStart = requests.tables.length;
  await page.getByRole("button", { name: longSystemLabel, exact: true }).click();
  const selectedTableQuery = await expectQuery(requests.tables, selectSystemStart, (url) => (
    url.searchParams.get("sourceSystemId") === longSystemId
  ));
  expect(selectedTableQuery.searchParams.get("page")).toBe("1");
  expect(selectedTableQuery.searchParams.get("srcTable")).toBe("MEMBER_PROFILE");
  expect(selectedTableQuery.searchParams.get("srcField")).toBe("ACCOUNT_NO");
  await expect(page.getByRole("button", { name: longSystemLabel, exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveURL(new RegExp(`sourceSystemId=${longSystemId}`));
  const selectedStats = await expectQuery(requests.stats, 0, (url) => (
    url.searchParams.get("sourceSystemId") === longSystemId
  ));
  expect(selectedStats.searchParams.get("sourceSystemId")).toBe(longSystemId);
  await page.screenshot({ path: testInfo.outputPath("field-mapping-source-navigator-light.png") });

  await search.fill("");
  const fieldStart = requests.fields.length;
  await page.locator(".fm-tabs button").filter({ hasText: "字段维度" }).click();
  const selectedFieldQuery = await expectQuery(requests.fields, fieldStart, (url) => (
    url.searchParams.get("sourceSystemId") === longSystemId
  ));
  expect(selectedFieldQuery.searchParams.get("srcTable")).toBe("MEMBER_PROFILE");
  await expect(page).toHaveURL(new RegExp(`sourceSystemId=${longSystemId}.*tab=field|tab=field.*sourceSystemId=${longSystemId}`));

  const nextPageStart = requests.fields.length;
  await page.getByRole("navigation", { name: "字段映射分页" }).getByRole("button", { name: "下一页" }).click();
  const secondPageQuery = await expectQuery(requests.fields, nextPageStart, (url) => (
    url.searchParams.get("sourceSystemId") === longSystemId && url.searchParams.get("page") === "2"
  ));
  expect(secondPageQuery.searchParams.get("page")).toBe("2");

  const secondSystemId = "2";
  const secondSystem = remoteSourceSystems.find((item) => item.sourceSystemId === secondSystemId);
  if (!secondSystem) throw new Error("Missing second-system fixture.");
  const secondSystemLabel = `${secondSystem.name} · ${secondSystem.systemCode}`;
  const changedSystemStart = requests.fields.length;
  await page.getByRole("button", { name: secondSystemLabel, exact: true }).click();
  const changedSystemQuery = await expectQuery(requests.fields, changedSystemStart, (url) => (
    url.searchParams.get("sourceSystemId") === secondSystemId
  ));
  expect(changedSystemQuery.searchParams.get("page")).toBe("1");
  expect(changedSystemQuery.searchParams.get("srcTable")).toBe("MEMBER_PROFILE");
  expect(changedSystemQuery.searchParams.get("emptyComment")).toBe("yes");

  const downloadWait = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 CSV" }).click();
  await downloadWait;
  expect(requests.exports).toHaveLength(1);
  expect(requests.exports[0]?.searchParams.get("view")).toBe("field");
  expect(requests.exports[0]?.searchParams.get("sourceSystemId")).toBe(secondSystemId);
  expect(requests.exports[0]?.searchParams.get("srcTable")).toBe("MEMBER_PROFILE");
  expect(requests.exports[0]?.searchParams.get("emptyComment")).toBe("yes");

  const allSystemsStart = requests.fields.length;
  await allSystems.click();
  const allSystemsQuery = await expectQuery(requests.fields, allSystemsStart, (url) => (
    !url.searchParams.has("sourceSystemId")
  ));
  expect(allSystemsQuery.searchParams.get("page")).toBe("1");
  expect(allSystemsQuery.searchParams.get("srcTable")).toBe("MEMBER_PROFILE");
  await expect(allSystems).toHaveAttribute("aria-pressed", "true");

  const goToPageTwo = requests.fields.length;
  await page.getByRole("navigation", { name: "字段映射分页" }).getByRole("button", { name: "下一页" }).click();
  await expectQuery(requests.fields, goToPageTwo, (url) => (
    !url.searchParams.has("sourceSystemId") && url.searchParams.get("page") === "2"
  ));
  const resetStart = requests.fields.length;
  await page.getByRole("button", { name: "重置" }).click();
  const resetQuery = await expectQuery(requests.fields, resetStart, (url) => (
    !url.searchParams.has("sourceSystemId") && url.searchParams.get("page") === "1"
  ));
  expect(resetQuery.searchParams.has("srcTable")).toBe(false);
  expect(resetQuery.searchParams.has("srcField")).toBe(false);
  expect(resetQuery.searchParams.has("targetTable")).toBe(false);
  expect(resetQuery.searchParams.has("targetField")).toBe(false);
  await expect(page.getByLabel("源系统表名")).toHaveValue("");
  await expect(page.getByLabel("源字段名")).toHaveValue("");
  await expect(page.getByLabel("DWF 表名")).toHaveValue("");
  await expect(page.getByLabel("DWF 字段名")).toHaveValue("");
  await expect(allSystems).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "查询帮助" })).toBeVisible();

  await page.getByRole("button", { name: "切换到深色主题" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({ path: testInfo.outputPath("field-mapping-source-navigator-dark.png") });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "打开导航" }).click();
  const mobileSidebar = page.locator(".sidebar");
  await expect(mobileSidebar).toHaveClass(/open/);
  await expect.poll(() => mobileSidebar.evaluate((element) => document.activeElement === element)).toBe(true);
  await mobileSidebar.evaluate((element) => { element.scrollTop = 0; element.scrollLeft = 0; });
  await expect(page.getByRole("navigation", { name: "源系统列表" })).toBeVisible();
  await expect(search).toBeVisible();
  const sidebarBounds = await mobileSidebar.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { width: rect.width, height: rect.height, open: element.classList.contains("open") };
  });
  expect(sidebarBounds.open).toBe(true);
  expect(sidebarBounds.width).toBeLessThanOrEqual(260);
  expect(sidebarBounds.height).toBeGreaterThanOrEqual(844);
  const pageWidth = await page.locator("html").evaluate((element) => element.scrollWidth);
  expect(pageWidth).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath("field-mapping-source-navigator-dark-mobile.png") });
});

test("disabled anonymous catalog defers source-system loading until login", async ({ page }) => {
  test.skip(!remoteFixturesEnabled, "This access-gating test uses isolated remote API fixtures.");
  let authenticated = false;
  const sourceSystemAccessStates: boolean[] = [];
  const sourceSystem = {
    id: "91",
    sourceSystemId: "91",
    upstreamSystemId: "91",
    name: "登录后可见系统",
    systemName: "登录后可见系统",
    systemCode: "AUTH-SYS",
    systemAbbr: "AUTH-SYS",
    count: 1,
  };
  const user = {
    role: "admin",
    user: "issue-527-auth-e2e",
    name: "Issue 527 Auth E2E",
    permissions: ["field_mapping:read", "system:menu:read"],
  };

  await page.addInitScript(() => {
    localStorage.removeItem("dap_auth");
    sessionStorage.removeItem("dap_auth");
  });
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/auth/me") {
      return authenticated
        ? route.fulfill({ json: { data: user } })
        : route.fulfill({ status: 401, json: { message: "anonymous" } });
    }
    if (path === "/api/public-catalog/config") {
      return route.fulfill({ json: { profile: "disabled", exportEnabled: false } });
    }
    if (path === "/api/auth/login" && request.method() === "POST") {
      authenticated = true;
      return route.fulfill({ json: { data: user } });
    }
    if (path === "/api/system/menus") return route.fulfill({ json: { items: [] } });
    if (path === "/api/field-mappings/source-systems") {
      sourceSystemAccessStates.push(authenticated);
      return authenticated
        ? route.fulfill({ json: { items: [sourceSystem] } })
        : route.fulfill({ status: 403, json: { error: { message: "catalog access disabled" } } });
    }
    if (path === "/api/field-mappings/stats") {
      return route.fulfill({ json: { sourceSystemCount: 1, sourceTableCount: 0, fieldCount: 0, coverage: 0 } });
    }
    if (path === "/api/field-mappings/tables" || path === "/api/field-mappings/fields") {
      return route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 50 } });
    }
    return route.fulfill({ json: { items: [] } });
  });

  await page.goto("/field-mapping", { waitUntil: "networkidle" });
  await expect(page.getByText("匿名目录访问已关闭")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("等待目录访问权限…")).toBeVisible();
  expect(sourceSystemAccessStates).toEqual([]);
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.getByRole("button", { name: "登录后继续" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByPlaceholder("请输入管理员账号").fill("operator");
  await dialog.getByPlaceholder("请输入密码").fill("test-password");
  await dialog.getByRole("button", { name: "登录", exact: true }).click();

  await expect(page.getByRole("button", { name: "登录后可见系统 · AUTH-SYS", exact: true })).toBeVisible({ timeout: 20_000 });
  expect(sourceSystemAccessStates).toEqual([true]);
});

test("source-system empty list and mapping query failure have clear states", async ({ page }) => {
  test.skip(!remoteFixturesEnabled, "This state test uses isolated remote API fixtures.");
  const requests = createRequestLog();
  await installRemoteFixtures(page, requests, { emptySystems: true, failTables: true, failFields: true });
  await page.goto("/field-mapping");

  await expect(page.getByText("暂无可用源系统", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "全部源系统", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "表维度加载失败" })).toBeVisible();
  await expect(page.getByText("测试表映射查询故障")).toBeVisible();
  const beforeRetry = requests.tables.length;
  await page.getByRole("button", { name: "重试列表" }).click();
  await expect.poll(() => requests.tables.length).toBeGreaterThan(beforeRetry);
});

test("source-system list failure can be retried without blocking the all-systems query", async ({ page }) => {
  test.skip(!remoteFixturesEnabled, "This state test uses isolated remote API fixtures.");
  const requests = createRequestLog();
  await installRemoteFixtures(page, requests, { failSystems: true });
  await page.goto("/field-mapping");

  await expect(page.getByText("源系统清单加载失败", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "全部源系统", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => requests.tables.length).toBeGreaterThan(0);
  const beforeRetry = requests.sourceSystems.length;
  await page.locator(".mapping-system-retry").click();
  await expect.poll(() => requests.sourceSystems.length).toBeGreaterThan(beforeRetry);
  await expect(page.getByText("源系统清单加载失败", { exact: true })).toBeVisible();
});
