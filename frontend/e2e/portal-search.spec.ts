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
  await expect(page.locator(".sp-stat-card:not(.sp-stat-placeholder)")).toHaveCount(11);
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
  await expect(page.getByRole("heading", { name: "没有找到精确匹配的资产" })).toBeVisible();
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

test("search result rows expand to their content without overlapping across viewports", async ({ page }, testInfo: TestInfo) => {
  await openPortal(page, `/?q=${encodeURIComponent("门店")}`);
  await expect(page.locator(".sp-hit-title").first()).toBeVisible();

  const groupLabels = await page.locator(".sp-group-title").allTextContents();
  expect(groupLabels).toEqual(expect.arrayContaining(["资产", "系统", "字段"]));

  const minimumResultsWidth = new Map([
    [1440, 1180],
    [1280, 1180],
    [1024, 900],
    [768, 700],
    [375, 320],
  ]);

  for (const width of [1440, 1280, 1024, 768, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator(".sp-hit").first()).toBeVisible();

    const metrics = await page.evaluate(() => {
      const results = document.querySelector(".sp-results");
      const rows = Array.from(document.querySelectorAll(".sp-hit")).map((hit) => {
        const hitRect = hit.getBoundingClientRect();
        const parts = Array.from(
          hit.querySelectorAll(".sp-hit-main, .sp-hit-meta, .sp-hit-match, .sp-hit-go"),
        ).map((el) => el.getBoundingClientRect());
        return {
          top: hitRect.top + window.scrollY,
          bottom: hitRect.bottom + window.scrollY,
          left: hitRect.left,
          right: hitRect.right,
          height: hitRect.height,
          contentBottom: Math.max(...parts.map((p) => p.bottom + window.scrollY)),
          contentRight: Math.max(...parts.map((p) => p.right)),
        };
      });
      return {
        viewport: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        resultsWidth: results ? results.getBoundingClientRect().width : 0,
        rows,
      };
    });

    expect(metrics.rows.length).toBeGreaterThan(0);
    expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewport);
    expect(metrics.resultsWidth).toBeGreaterThanOrEqual(minimumResultsWidth.get(width) ?? 0);

    for (const row of metrics.rows) {
      expect(row.height).toBeGreaterThanOrEqual(60);
      expect(row.left).toBeGreaterThanOrEqual(0);
      expect(row.right).toBeLessThanOrEqual(metrics.viewport);
      // Fixed Kumo control heights clip multi-line content into the next row.
      expect(row.contentBottom).toBeLessThanOrEqual(row.bottom + 0.5);
      expect(row.contentRight).toBeLessThanOrEqual(row.right + 0.5);
    }

    for (let index = 0; index < metrics.rows.length - 1; index += 1) {
      expect(metrics.rows[index]!.contentBottom).toBeLessThanOrEqual(metrics.rows[index + 1]!.top + 0.5);
    }

    if (width === 1440 || width === 375) {
      await page.screenshot({
        path: testInfo.outputPath(`portal-search-layout-${width}.png`),
        fullPage: false,
      });
    }
  }
});

test("portal search remains within light/dark and desktop-to-phone viewport bounds", async ({ page }, testInfo: TestInfo) => {
  await openPortal(page);
  const html = page.locator("html");

  for (const theme of ["light", "dark"] as const) {
    const currentMode = await html.getAttribute("data-theme");
    if (currentMode !== theme) {
      await page.getByRole("button", {
        name: currentMode === "dark" ? "切换到浅色主题" : "切换到深色主题",
      }).click();
    }
    await expect(html).toHaveAttribute("data-theme", theme);

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

test("home orb fits the hero and follows Appearance through live and static modes", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    let attempts = 0;
    const getContext = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      value(this: HTMLCanvasElement, type: string, ...args: unknown[]) {
        if (type === "webgl") document.documentElement.dataset["orbContextAttempts"] = String(++attempts);
        return Reflect.apply(getContext, this, [type, ...args]);
      },
    });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
  await openPortal(page);
  const orb = page.locator(".sp-data-orb");
  const html = page.locator("html");
  const searchBox = page.locator(".sp-searchbox");
  const capture = (name: string) => page.screenshot({ path: testInfo.outputPath(`portal-orb-${name}.png`), animations: "disabled", scale: "css" });
  const checkOrbLayout = async () => {
    const orbBox = (await orb.boundingBox())!;
    const box = (await searchBox.boundingBox())!;
    expect(orbBox.y + orbBox.height).toBeLessThan(box.y);
    await checkNoHorizontalOverflow(page);
  };
  await expect(orb).toHaveAttribute("aria-hidden", "true");
  await expect(orb).toHaveCSS("pointer-events", "none");
  await expect(orb).toHaveAttribute("data-theme", "light");
  await expect(html).toHaveAttribute("data-effects", "subtle");
  await expect(html).toHaveAttribute("data-orb-context-attempts", "1");
  // Existing autofocus keeps the input immediately usable. Blur for the idle screenshots.
  await page.getByRole("heading", { level: 1 }).click();
  await expect(orb).toHaveAttribute("data-status", "idle");
  await checkOrbLayout();
  const desktopDiameter = (await orb.boundingBox())!.width * .6;
  expect(desktopDiameter).toBeGreaterThanOrEqual(180);
  expect(desktopDiameter).toBeLessThanOrEqual(220);
  await capture("light-desktop");
  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await checkOrbLayout();
    if (width <= 390) await capture(`light-mobile-${width}`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  const input = page.getByRole("textbox", { name: "搜索数据资产" });
  await input.fill("目录");
  await expect(orb).toHaveAttribute("data-status", "typing");
  await expect(orb).toHaveAttribute("data-status", "focused");
  await expect(html).toHaveAttribute("data-orb-context-attempts", "1");
  await input.fill("");

  const trigger = page.getByRole("button", { name: "风格设置", exact: true });
  const drawer = page.getByRole("dialog", { name: "风格设置" });
  await trigger.click();
  await drawer.getByRole("radio", { name: "深色", exact: true }).check();
  await drawer.getByRole("radio", { name: "暖橙", exact: true }).check();
  await drawer.getByRole("radio", { name: "完整", exact: true }).check();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(orb).toHaveAttribute("data-theme", "dark");
  await expect(html).toHaveAttribute("data-accent", "orange");
  await expect(html).toHaveAttribute("data-effects", "full");
  await expect(html).toHaveAttribute("data-orb-context-attempts", "1");
  await capture("dark-full");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(html).toHaveAttribute("data-effects", "off");
  await expect(orb.locator("canvas")).toHaveCount(0);
  await page.reload();
  await expect(orb.locator(".data-orb__static")).toBeVisible();
  await expect(html).not.toHaveAttribute("data-orb-context-attempts", /./);
  await capture("dark-reduced-motion");

  await trigger.click();
  await drawer.getByRole("radio", { name: "关闭", exact: true }).check();
  await page.keyboard.press("Escape");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.reload();
  await expect(html).toHaveAttribute("data-effects", "off");
  await expect(orb.locator(".data-orb__static")).toBeVisible();
  await expect(html).not.toHaveAttribute("data-orb-context-attempts", /./);
  await capture("dark-off");
  await input.fill("静态目录");
  await expect(orb).toHaveAttribute("data-status", "focused");
  await expect(html).not.toHaveAttribute("data-orb-context-attempts", /./);
});

test("portal orb retains a visible CSS sphere without WebGL", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      value(this: HTMLCanvasElement, type: string, ...args: unknown[]) {
        if (type === "webgl") {
          document.documentElement.dataset["orbWebglUnavailable"] = "true";
          return null;
        }
        return Reflect.apply(getContext, this, [type, ...args]);
      },
    });
  });
  await openPortal(page);
  await expect(page.locator("html")).toHaveAttribute("data-orb-webgl-unavailable", "true");
  const orb = page.locator(".sp-data-orb");
  await expect(orb.locator("canvas")).toHaveCount(0);
  const fallback = orb.locator(".data-orb__static");
  await expect(fallback).toBeVisible();
  expect(await fallback.evaluate((element) => getComputedStyle(element, "::after").backgroundColor))
    .toBe("rgb(106, 69, 240)");
  await page.screenshot({ path: testInfo.outputPath("portal-orb-light-css-fallback.png"), scale: "css" });
});
