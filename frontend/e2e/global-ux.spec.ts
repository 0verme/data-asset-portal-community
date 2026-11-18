import { expect, test } from "@playwright/test";

test.describe("Remote UX states", () => {
  for (const outcome of ["zero", "empty", "failure", "forbidden", "invalid"] as const) {
    test(`asset statistics distinguish loading and ${outcome}`, async ({ page }) => {
      const statsPath = "/api/portal/stats";
      let release!: () => void;
      const pending = new Promise<void>((resolve) => { release = resolve; });
      await page.addInitScript(() => localStorage.setItem("dap-language", "en-US"));
      await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
        switch (new URL(route.request().url()).pathname) {
          case "/api/auth/me": return route.fulfill({ status: 401, json: {} });
          case "/api/public-catalog/config":
            return route.fulfill({ json: { profile: "internal", exportEnabled: false } });
          case statsPath:
            await pending;
            if (outcome === "failure" || outcome === "forbidden") {
              return route.fulfill({ status: outcome === "failure" ? 503 : 403, json: { message: "Fixture error" } });
            }
            return route.fulfill({ json: {
              items: outcome === "zero" ? [{ label: "Dashboard count", value: 0 }]
                : outcome === "invalid" ? null : [],
            } });
          default: return route.fulfill({ json: { items: [] } });
        }
      });
      try {
        const requested = page.waitForRequest((request) => new URL(request.url()).pathname === statsPath);
        await page.goto("/");
        await requested;
        await expect(page.getByRole("status", { name: "Loading asset statistics…" })).toBeVisible();
        await expect(page.locator(".sp-stat-num")).toHaveCount(0);
      } finally {
        release();
      }
      if (outcome === "zero") {
        await expect(page.locator(".sp-stat-num")).toHaveText("0");
      } else if (outcome === "empty") {
        await expect(page.getByText("No asset statistics available")).toBeVisible();
      } else {
        await expect(page.getByRole("alert").filter({ hasText: "Could not load asset statistics" })).toBeVisible();
        await expect(page.locator(".sp-stat-num")).toHaveCount(0);
        await expect(page.getByRole("dialog")).toHaveCount(0);
      }
    });
  }

  test("a protected API returning 401 resets identity and opens sign-in", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("dap-language", "en-US"));
    await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
      switch (new URL(route.request().url()).pathname) {
        case "/api/auth/me":
          return route.fulfill({ json: { user: "qa-logger", role: "reader", permissions: ["operation_log:read"] } });
        case "/api/operation-logs":
          return route.fulfill({ status: 401, json: { message: "Session expired" } });
        case "/api/public-catalog/config":
          return route.fulfill({ json: { profile: "internal", exportEnabled: false } });
        default:
          return route.fulfill({ json: { items: [] } });
      }
    });
    await page.goto("/system-management/operation-logs");
    await expect(page.getByRole("dialog")).toContainText("Your session has expired.");
    await expect(page.locator(".page-title")).toHaveCount(0);
    await expect(page).toHaveURL("/system-management/operation-logs");
  });

  test("long branding keeps search and account actions reachable", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("dap-language", "en-US"));
    await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
      switch (new URL(route.request().url()).pathname) {
        case "/api/auth/me":
          return route.fulfill({ status: 401, json: {} });
        case "/api/public-catalog/config":
          return route.fulfill({ json: { profile: "internal", exportEnabled: false } });
        case "/api/system/public-config":
          return route.fulfill({ json: {
            data: {
              site: { display_name: "AnExtremelyLongUnbrokenBrandedPortalName".repeat(3) },
              login: { hint: "AnExtremelyLongUnbrokenSignInHint".repeat(15) },
              version: "long-branding",
            },
          } });
        default:
          return route.fulfill({ json: { items: [] } });
      }
    });
    await page.goto("/system-management");
    await expect(page.locator(".brand-name")).toContainText("AnExtremelyLong");
    for (const width of [390, 500, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 500 });
      const login = page.locator("header").getByRole("button", { name: "Sign in" });
      await expect(login, `sign-in fully visible at ${width}px`).toBeInViewport({ ratio: 1 });
      await login.click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeInViewport({ ratio: 1 });
      await dialog.getByRole("button", { name: "Continue as guest" }).click();
      if (width <= 768) await page.locator(".mobile-search-toggle").click();
      const search = page.locator("#global-search input");
      await search.fill("fixture");
      await expect(search).toBeInViewport({ ratio: 1 });
      await search.fill("");
      if (width <= 768) await page.keyboard.press("Escape");
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    }
  });

  test("logout confirmation preserves the session on cancel and clears it across history", async ({ page }) => {
    let signedIn = true;
    let logoutRequests = 0;
    await page.addInitScript(() => localStorage.setItem("dap-language", "en-US"));
    await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
      switch (new URL(route.request().url()).pathname) {
        case "/api/auth/me":
          return signedIn
            ? route.fulfill({ json: { user: "qa-logger", role: "reader", permissions: ["operation_log:read"] } })
            : route.fulfill({ status: 401, json: {} });
        case "/api/auth/logout":
          logoutRequests += 1;
          signedIn = false;
          return route.fulfill({ status: 204 });
        case "/api/public-catalog/config":
          return route.fulfill({ json: { profile: "internal", exportEnabled: false } });
        default: return route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 20 } });
      }
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/system-management/branding");
    await expect(page.getByRole("heading", { name: "No access to system management" })).toBeVisible();
    await expect(page).toHaveURL(/\/system-management\/branding$/);
    await page.goto("/system-management/logs");
    await expect(page).toHaveURL(/\/system-management\/operation-logs$/);
    await expect(page.locator(".page-title")).toBeVisible();

    const logout = page.getByRole("button", { name: "Sign out", exact: true });
    await logout.click();
    const dialog = page.getByRole("alertdialog", { name: "Sign out?" });
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(logout).toBeVisible();
    expect(logoutRequests).toBe(0);

    await logout.click();
    await dialog.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page.locator(".page-title")).toHaveCount(0);
    await expect(page.locator("main").getByRole("button", { name: /sign in/i })).toBeVisible();
    expect(logoutRequests).toBe(1);
    await page.goBack();
    await expect(page.locator("main").getByRole("button", { name: /sign in/i })).toBeVisible();
    await page.goForward();
    await expect(page.locator("main").getByRole("button", { name: /sign in/i })).toBeVisible();
    await page.locator("main").getByRole("button", { name: /sign in/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });
});

test.describe("Mock UX navigation and layout", () => {
  test("unknown URL survives back and forward and legacy push goes to its list", async ({ page }) => {
    await page.goto("/no-such-page?from=bookmark");
    await expect(page.getByRole("heading", { name: /404/ })).toBeVisible();
    await page.getByRole("button", { name: "返回首页" }).click();
    await expect(page).toHaveURL("/");
    await page.goBack();
    await expect(page).toHaveURL(/\/no-such-page\?from=bookmark$/);
    await expect(page.getByRole("heading", { name: /404/ })).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL("/");
    await page.goto("/downstream-push");
    await expect(page).toHaveURL("/push");
    await expect(page.locator(".page-title")).toContainText("推送");
  });

  test("a business editor keeps its address while prompting for sign-in", async ({ page }) => {
    await page.goto("/data-warehouse/example/edit");
    await expect(page.getByRole("heading", { name: "登录后才能访问此编辑页面" })).toBeVisible();
    await expect(page).toHaveURL("/data-warehouse/example/edit");
    await page.locator("main").getByRole("button").click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test("system navigation, the search and logout are usable at the requested widths", async ({ page }, testInfo) => {
    await page.addInitScript(() => {
      localStorage.setItem("dap_auth", JSON.stringify({ role: "admin", user: "admin" }));
      localStorage.setItem("dap-language", "en-US");
    });
    await page.goto("/system-management");
    await expect(page).toHaveURL("/system-management");
    await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();

    for (const width of [390, 500, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      const sidebarToggle = page.locator(".hamburger");
      if (width <= 768) await sidebarToggle.click();
      const logs = page.locator("#mobile-sidebar").getByRole("button", { name: "Operation logs" });
      await logs.scrollIntoViewIfNeeded();
      await expect(logs).toBeInViewport();
      await logs.click();
      await expect(page).toHaveURL("/system-management/operation-logs");
      const logTable = page.locator(".operation-log-wide-scroll");
      await expect(logTable.locator("tbody tr").first()).toBeVisible();
      if (width > 768) {
        const scrolling = await logTable.evaluate((element) => {
          element.scrollLeft = element.scrollWidth;
          return { left: element.scrollLeft, overflows: element.scrollWidth > element.clientWidth };
        });
        expect(scrolling.overflows).toBe(true);
        expect(scrolling.left).toBeGreaterThan(0);
      }
      const detail = logTable.locator("tbody tr").first().getByRole("button").last();
      await detail.scrollIntoViewIfNeeded();
      await expect(detail).toBeInViewport();
      if (width <= 768) {
        await page.locator(".mobile-search-toggle").click();
      }
      const search = page.locator("#global-search input");
      await search.fill("test");
      await expect(search).toBeInViewport();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await search.fill("");
      if (width <= 768) await page.keyboard.press("Escape");
      if (width === 390 || width === 1440) {
        await page.screenshot({ path: testInfo.outputPath(`system-${width}.png`), animations: "disabled" });
      }
    }
  });
});
