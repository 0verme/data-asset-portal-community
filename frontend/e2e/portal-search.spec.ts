import { expect, test, type Page, type TestInfo } from "@playwright/test";

const ASSET_NAME = "dwm_trade_order_item_di";
const RUN_REMOTE_ACCESS_PROBE = process.env["DAP_PORTAL_REMOTE_E2E"] === "1";

async function openPortal(page: Page, path = "/") {
  await page.addInitScript(() => {
    localStorage.removeItem("dap_auth");
    sessionStorage.removeItem("dap_auth");
  });
  await page.route("**/api/search/hot-keywords", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      items: [
        { id: 1, keyword: ASSET_NAME, category: "asset", sortOrder: 1 },
        { id: 2, keyword: "PR7-portal-search-smoke", category: "all", sortOrder: 2 },
      ],
    }),
  }));
  await page.goto(path);
  await expect(page.getByRole("heading", { name: "数据资产管理与血缘分析平台" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "搜索数据资产" })).toBeVisible();
}

async function checkNoHorizontalOverflow(page: Page) {
  const metrics = await page.evaluate(() => {
    const box = document.querySelector(".sp-searchbox");
    const rect = box?.getBoundingClientRect();
    return {
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
      left: rect?.left ?? -1,
      right: rect?.right ?? Number.POSITIVE_INFINITY,
    };
  });
  expect(metrics.document).toBeLessThanOrEqual(metrics.viewport);
  expect(metrics.left).toBeGreaterThanOrEqual(0);
  expect(metrics.right).toBeLessThanOrEqual(metrics.viewport);
}

test("disabled public catalog blocks anonymous portal search and data requests", async ({ page }) => {
  test.skip(!RUN_REMOTE_ACCESS_PROBE, "Run with remote API mode to verify the disabled public-catalog profile.");
  const apiRequests: string[] = [];
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith("/api/")) return route.continue();
    apiRequests.push(path);
    if (path === "/api/auth/me") {
      return route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ message: "anonymous" }),
      });
    }
    if (path === "/api/public-catalog/config") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ profile: "disabled", exportEnabled: false }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [] }),
    });
  });
  await page.addInitScript(() => {
    localStorage.removeItem("dap_auth");
    sessionStorage.removeItem("dap_auth");
  });
  await page.goto("/");

  await expect(page.getByText("匿名目录访问已关闭")).toBeVisible();
  await expect(page.getByRole("button", { name: "登录后继续" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "搜索数据资产" })).toHaveCount(0);
  expect(apiRequests).toContain("/api/auth/me");
  expect(apiRequests).toContain("/api/public-catalog/config");
  expect(apiRequests).not.toContain("/api/portal/stats");
  expect(apiRequests).not.toContain("/api/search/hot-keywords");
  expect(apiRequests).not.toContain("/api/search");
});

test("guest portal exposes scopes, statistics and API-provided hot keywords", async ({ page }) => {
  await openPortal(page);
  const scopes = page.getByRole("group", { name: "搜索范围" });
  await expect(scopes.getByRole("button", { name: "全部", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(scopes.getByRole("button", { name: "资产", exact: true })).toBeVisible();
  await expect(page.getByText("PR7-portal-search-smoke", { exact: true })).toBeVisible();
  await expect(page.locator(".sp-stats-grid")).toBeVisible();
  await expect(page.locator(".sp-stat-card").first()).toBeVisible();
});

test("q URL initializes the portal search and displays matching results", async ({ page }) => {
  await openPortal(page, `/?q=${encodeURIComponent(ASSET_NAME)}`);
  const search = page.getByRole("textbox", { name: "搜索数据资产" });
  await expect(search).toHaveValue(ASSET_NAME);
  await expect(page.locator(".sp-hit-title").filter({ hasText: ASSET_NAME }).first()).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe(ASSET_NAME);
});

test("search by Enter and scope selection keep q/scope synchronized with the browser URL", async ({ page }) => {
  await openPortal(page);
  const search = page.getByRole("textbox", { name: "搜索数据资产" });
  await search.fill(ASSET_NAME);
  await search.press("Enter");
  await expect(page.locator(".sp-hit-title").filter({ hasText: ASSET_NAME }).first()).toBeVisible();

  const assetScope = page.getByRole("group", { name: "搜索范围" }).getByRole("button", { name: "资产", exact: true });
  await assetScope.click();
  await expect(assetScope).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe(ASSET_NAME);
  await expect.poll(() => new URL(page.url()).searchParams.get("scope")).toBe("asset");
});

test("hot keyword selection reuses the search flow and selected scope", async ({ page }) => {
  await openPortal(page);
  const assetScope = page.getByRole("group", { name: "搜索范围" }).getByRole("button", { name: "资产", exact: true });
  await assetScope.click();
  await page.getByRole("button", { name: ASSET_NAME, exact: true }).click();

  await expect(page.getByRole("textbox", { name: "搜索数据资产" })).toHaveValue(ASSET_NAME);
  await expect(page.locator(".sp-hit-title").filter({ hasText: ASSET_NAME }).first()).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get("scope")).toBe("asset");
});

test("empty all-scope search recovery clears q and restores input focus", async ({ page }, testInfo: TestInfo) => {
  await openPortal(page);
  const search = page.getByRole("textbox", { name: "搜索数据资产" });
  await search.fill("no-such-issue-361-asset-9f43");
  await search.press("Enter");
  await expect(page.getByRole("heading", { name: "没有找到匹配的资产" })).toBeVisible();
  const clearSearch = page.getByRole("button", { name: "清空搜索" });
  await clearSearch.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("portal-search-empty-1280.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await checkNoHorizontalOverflow(page);
  await clearSearch.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("portal-search-empty-390.png"), fullPage: true });
  await clearSearch.click();

  await expect(search).toHaveValue("");
  await expect(search).toBeFocused();
  await expect.poll(() => new URL(page.url()).searchParams.has("q")).toBe(false);
  await expect.poll(() => new URL(page.url()).searchParams.has("scope")).toBe(false);
});

test("search result navigation opens the existing asset module without changing its route contract", async ({ page }) => {
  await openPortal(page);
  const search = page.getByRole("textbox", { name: "搜索数据资产" });
  await search.fill(ASSET_NAME);
  await search.press("Enter");
  const hit = page.locator(".sp-hit").filter({ hasText: ASSET_NAME }).first();
  await expect(hit).toBeVisible();
  await hit.click();

  await expect(page).toHaveURL(/\/data-warehouse(?:\?|$)/);
  await expect(page.locator(".asset-page")).toBeVisible();
  await expect(page.locator(".asset-page")).toContainText(ASSET_NAME);
});

test("search result rows remain within desktop-to-phone viewport bounds", async ({ page }, testInfo: TestInfo) => {
  await openPortal(page);
  const search = page.getByRole("textbox", { name: "搜索数据资产" });
  await search.fill(ASSET_NAME);
  await search.press("Enter");
  await expect(page.locator(".sp-hit-title").filter({ hasText: ASSET_NAME }).first()).toBeVisible();

  for (const width of [960, 768, 480, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await checkNoHorizontalOverflow(page);
    if (width === 390) {
      await page.screenshot({ path: testInfo.outputPath("portal-search-results-390.png"), fullPage: true });
    }
  }
});

test("portal search remains within light/dark and desktop-to-phone viewport bounds", async ({ page }, testInfo: TestInfo) => {
  await openPortal(page);
  const html = page.locator("html");

  for (const theme of ["light", "dark"] as const) {
    const currentMode = await html.getAttribute("data-mode");
    if (currentMode !== theme) {
      await page.getByRole("button", {
        name: currentMode === "dark" ? "切换到浅色主题" : "切换到深色主题",
      }).click();
    }
    await expect(html).toHaveAttribute("data-mode", theme);

    for (const width of [960, 768, 480, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await checkNoHorizontalOverflow(page);
      if (width === 960 || width === 390) {
        await page.screenshot({
          path: testInfo.outputPath(`portal-search-${theme}-${width}.png`),
          fullPage: true,
        });
      }
    }
  }
});
