import { expect, test } from "@playwright/test";

const logoHash = "a".repeat(64);
const faviconHash = "b".repeat(64);

function publicBranding(language: string) {
  const english = language === "en-US";
  return {
    data: {
      site: {
        title: english ? "DAP QA English" : "DAP QA 中文",
        display_name: english ? "QA Portal" : "测试门户",
        announcement: english ? "QA announcement" : "测试公告",
        logo_url: `/static/branding/${logoHash}.svg`,
        favicon_url: `/static/branding/${faviconHash}.svg`,
      },
      hero: {
        title: english ? "QA home title" : "测试首页标题",
        subtitle: english ? "QA subtitle" : "测试副标题",
        search_placeholder: english ? "Search QA catalog" : "搜索测试目录",
      },
      login: {
        hint: english ? "Contact your QA administrator." : "请联系测试管理员。",
        quick_demo_login_enabled: false,
      },
      version: english ? "qa-en-v1" : "qa-zh-v1",
    },
  };
}

async function installRemoteFixtures(page: import("@playwright/test").Page, failBranding = false, loggedIn = false) {
  await page.addInitScript(() => {
    localStorage.removeItem("dap-auth");
    localStorage.removeItem("dap_auth");
    localStorage.removeItem("dap-language");
    sessionStorage.removeItem("dap_auth");
  });
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path.startsWith("/static/branding/")) {
      return route.fulfill({
        status: 200,
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#123456"/></svg>',
      });
    }
    if (!path.startsWith("/api/")) return route.continue();
    if (path === "/api/auth/me") {
      if (loggedIn) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: { user: "qa-admin", role: "admin", permissions: ["system:param:read", "system:param:write"] } }),
        });
      }
      return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ message: "anonymous" }) });
    }
    if (path === "/api/public-catalog/config") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ profile: "internal", exportEnabled: false }) });
    }
    if (path === "/api/system/public-config") {
      if (failBranding) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "unavailable" }) });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(publicBranding(url.searchParams.get("lang") || "zh-CN")) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) });
  });
}

test("public branding updates the portal, login, favicon, and responsive announcement", async ({ page }) => {
  await installRemoteFixtures(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");

  await expect(page).toHaveTitle("DAP QA 中文");
  await expect(page.locator(".brand-name")).toContainText("测试门户");
  await expect(page.getByRole("heading", { name: "测试首页标题" })).toBeVisible();
  await expect(page.getByText("测试副标题")).toBeVisible();
  await expect(page.getByPlaceholder("搜索测试目录")).toBeVisible();
  await expect(page.getByRole("img", { name: "测试门户" }).first()).toHaveAttribute("src", `/static/branding/${logoHash}.svg`);
  await expect(page.locator('link[rel~="icon"]').first()).toHaveAttribute("href", `/static/branding/${faviconHash}.svg?v=qa-zh-v1`);
  const announcement = page.getByRole("status").filter({ hasText: "测试公告" });
  await expect(announcement).toBeVisible();
  await announcement.getByRole("button").click();
  await expect(announcement).toBeHidden();

  await page.getByRole("button", { name: "切换到英文" }).click();
  await expect(page).toHaveTitle("DAP QA English");
  await expect(page.getByRole("heading", { name: "QA home title" })).toBeVisible();
  await expect(page.getByPlaceholder("Search QA catalog")).toBeVisible();
  await expect(page.getByText("QA announcement")).toBeVisible();
  await expect(page.locator('link[rel~="icon"]').first()).toHaveAttribute("href", `/static/branding/${faviconHash}.svg?v=qa-en-v1`);

  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".login-desc")).toHaveText("Contact your QA administrator.");
  await expect(page.locator(".login-brand .lb-name")).toHaveText("QA Portal");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".login-x").click();
  const widths = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("public branding request failure preserves the default anonymous experience", async ({ page }) => {
  await installRemoteFixtures(page, true);
  await page.goto("/");
  await expect(page).toHaveTitle("数据资产管理与血缘分析平台");
  await expect(page.getByRole("heading", { name: "数据资产门户" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "搜索数据资产" })).toBeVisible();
  await expect(page.locator(".app-announcement")).toHaveCount(0);
});

test("public branding remains applied after an authenticated session loads", async ({ page }) => {
  await installRemoteFixtures(page, false, true);
  await page.goto("/");
  await expect(page).toHaveTitle("DAP QA 中文");
  await expect(page.locator(".brand-name")).toContainText("测试门户");
  await expect(page.locator(".uc-name")).toHaveText("qa-admin");
});
