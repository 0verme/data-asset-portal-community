import { expect, test } from "@playwright/test";

test("desktop language switching is immediate, persistent, and preserves route/search state", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem("dap-562-i18n-e2e-clean") !== "1") {
      localStorage.removeItem("dap-language");
      localStorage.removeItem("dap_auth");
      sessionStorage.setItem("dap-562-i18n-e2e-clean", "1");
    }
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  const apiRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/")) apiRequests.push(request.url());
  });

  await page.goto("/data-warehouse?layout=list");
  const search = page.getByRole("textbox", { name: "全局搜索" });
  await expect(search).toBeVisible();
  await expect(page.locator(".page-title")).toContainText("数据资产");
  await expect(page).toHaveTitle("数据资产管理与血缘分析平台");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page).toHaveURL(/\/data-warehouse$/);
  await search.fill("phase0-state-preservation");
  await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe("phase0-state-preservation");
  const stateUrl = page.url();
  await page.screenshot({ path: testInfo.outputPath("phase0-desktop-zh.png"), animations: "disabled" });
  await page.getByRole("button", { name: "紫色" }).click();
  await page.getByRole("button", { name: "切换到深色主题" }).click();

  const requestsBeforeSwitch = apiRequests.length;
  await page.getByRole("button", { name: "切换到英文" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
  await expect(page).toHaveTitle("Data Asset Management and Lineage Platform");
  await expect(page.locator(".page-title")).toContainText("Data Assets");
  await expect(page.getByRole("button", { name: "Data Warehouse" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Global search" })).toHaveValue("phase0-state-preservation");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-accent", "purple");
  await expect(page).toHaveURL(stateUrl);
  expect(apiRequests.length).toBe(requestsBeforeSwitch);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("dap-language"))).toBe("en-US");
  await page.screenshot({ path: testInfo.outputPath("phase0-desktop-en.png"), animations: "disabled" });

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
  await expect(page.getByRole("button", { name: "Data Warehouse" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Global search" })).toHaveValue("phase0-state-preservation");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-accent", "purple");

  await page.getByRole("button", { name: "Switch language to Chinese" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.getByRole("textbox", { name: "全局搜索" })).toHaveValue("phase0-state-preservation");
  await expect(page.getByRole("button", { name: "数据仓库" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-accent", "purple");
});

test("medium desktop exposes language in the sidebar without reducing primary navigation", async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 900 });
  await page.goto("/data-warehouse");
  await expect(page.locator(".topbar:not(.portal-topbar) .language-switcher")).toBeHidden();
  const primaryNavigation = page.locator(".topbar-nav-slot > .mainnav:not(.mainnav-measure)");
  await expect(primaryNavigation.locator("button.dap-ui-button:not(.more-nav-trigger)")).toHaveCount(5);
  const sidebarLanguageSwitcher = page.locator("#mobile-sidebar .sidebar-language-switcher");
  await expect(sidebarLanguageSwitcher.getByRole("button", { name: "切换到英文" })).toBeVisible();
  await sidebarLanguageSwitcher.getByRole("button", { name: "切换到英文" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
  await expect(primaryNavigation.getByRole("button", { name: "Data Warehouse" })).toBeVisible();
});

test("mobile navigation provides the language switch without closing or resetting the current module", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem("dap-562-i18n-e2e-clean") !== "1") {
      localStorage.removeItem("dap-language");
      localStorage.removeItem("dap_auth");
      sessionStorage.setItem("dap-562-i18n-e2e-clean", "1");
    }
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/data-warehouse?layout=list");
  await expect(page.locator(".page-title")).toContainText("数据资产");
  await expect(page.locator(".topbar .language-switcher")).toBeHidden();
  await page.getByRole("button", { name: "打开导航" }).click();
  const drawer = page.locator("#mobile-sidebar");
  await expect(drawer.getByRole("button", { name: "切换到英文" })).toBeVisible();
  await drawer.getByRole("button", { name: "切换到英文" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
  await expect(drawer).toHaveClass(/open/);
  await expect(drawer.getByRole("button", { name: "Data Warehouse" })).toBeVisible();
  await expect(page.locator(".page-title")).toContainText("Data Assets");
  await expect(page).toHaveURL(/\/data-warehouse$/);
  await page.screenshot({ path: testInfo.outputPath("phase0-mobile-en-drawer.png"), animations: "disabled" });

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
  await expect(page.getByRole("button", { name: "打开导航" })).toHaveCount(0);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.locator("#mobile-sidebar").getByRole("button", { name: "Data Warehouse" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("phase0-mobile-en.png"), animations: "disabled" });
});

test("invalid or inaccessible language storage safely falls back and switching remains usable", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: false,
      get() {
        throw new DOMException("Storage unavailable", "SecurityError");
      },
    });
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/data-warehouse");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.locator(".page-title")).toContainText("数据资产");
  await page.getByRole("button", { name: "切换到英文" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
  await expect(page.locator(".page-title")).toContainText("Data Assets");
});
