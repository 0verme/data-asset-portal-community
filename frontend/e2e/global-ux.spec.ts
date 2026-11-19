import { expect, test, type Page } from "@playwright/test";

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

  test("sign-out reloads public catalog data under the anonymous projection", async ({ page }) => {
    const host = "private-metadata.fixture.invalid";
    let signedIn = true;
    let guestCatalogRequests = 0;
    await page.addInitScript(() => localStorage.setItem("dap-language", "en-US"));
    await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
      switch (new URL(route.request().url()).pathname) {
        case "/api/auth/me":
          return route.fulfill({ json: { user: "qa-reader", role: "reader", permissions: ["upstream:read"] } });
        case "/api/auth/logout":
          signedIn = false;
          return route.fulfill({ status: 204 });
        case "/api/public-catalog/config":
          return route.fulfill({ json: { profile: "strict", exportEnabled: false } });
        case "/api/upstreams/systems":
          if (!signedIn) guestCatalogRequests += 1;
          return route.fulfill({ json: {
            items: [{
              id: "qa-source", abbr: "QA", name: "Fixture source", status: "enabled",
              dbType: "PostgreSQL", unloadTimes: [], ...(signedIn ? { host } : {}),
            }],
            total: 1, page: 1, pageSize: 20,
            facets: { status: {}, dbType: {}, dept: {} },
            options: { dbTypes: [], depts: [] },
            stats: { systemCount: 1 },
          } });
        default:
          return route.fulfill({ json: { items: [] } });
      }
    });
    await page.goto("/upstream");
    await expect(page.getByText(host, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page.getByText(host, { exact: true })).toHaveCount(0);
    await expect(page.getByText("Fixture source", { exact: true })).toBeVisible();
    await expect(page).toHaveURL("/upstream");
    expect(guestCatalogRequests).toBeGreaterThan(0);
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

test.describe("Remote UX lineage", () => {
  const snapshotAt = "2026-07-20T10:00:00+08:00";
  const rootName = "analytics." + "long_table_identifier_".repeat(5);
  const longChineseName = "跨区域业务明细与对应历史记录".repeat(5);
  const rootId = "table:analytics:root";

  async function routeLineage(
    page: Page,
    result: (request: URL) => { status?: number; json: object },
  ) {
    await page.route((url) => url.pathname.startsWith("/api/"), (route) => {
      const url = new URL(route.request().url());
      switch (url.pathname) {
        case "/api/auth/me":
          return route.fulfill({ status: 401, json: {} });
        case "/api/public-catalog/config":
          return route.fulfill({ json: { profile: "internal", exportEnabled: false } });
        case "/api/lineage/initial-view":
          return route.fulfill(result(url));
        default:
          return route.fulfill({ json: { items: [] } });
      }
    });
  }

  function bootstrap(status: string, nodeCount = 0) {
    return {
      mode: "persistent", status, snapshotId: status === "no_active_snapshot" ? "" : "test-snapshot",
      snapshotName: "Lineage test snapshot", snapshotAt, defaultRootId: nodeCount ? rootId : "",
      nodeCount, edgeCount: Math.max(nodeCount - 1, 0),
    };
  }

  for (const { width, count, language, theme } of [
    { width: 1440, count: 100, language: "en-US", theme: "light" },
    { width: 390, count: 25, language: "zh-CN", theme: "light" },
    { width: 320, count: 100, language: "en-US", theme: "dark" },
  ] as const) {
    test(`fits and navigates ${count} nodes at ${width}px in ${language} / ${theme}`, async ({ page }, testInfo) => {
      const english = language === "en-US";
      await page.emulateMedia({ colorScheme: theme });
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript((locale) => localStorage.setItem("dap-language", locale), language);
      const root = { id: rootId, kind: "table", name: rootName, displayName: rootName, namespace: "analytics", schema: "analytics", attributes: {} };
      const leaves = Array.from({ length: count - 1 }, (_, index) => {
        const name = index === 0 ? longChineseName : `LEAF_${index}`;
        return { id: `table:billing:${index}`, kind: "table", name, displayName: name, namespace: "billing", schema: "billing", attributes: {} };
      });
      const edges = leaves.map((node, i) => ({
        id: `edge:${i}`, sourceId: rootId, targetId: node.id, kind: "table_lineage",
        evidence: { type: "derived_job_path", description: "Fixture evidence" }, confidence: "high",
      }));
      await routeLineage(page, () => ({ json: { data: {
        bootstrap: bootstrap("ready", count), noticeCode: null,
        graph: {
          snapshot: { snapshotId: "test-snapshot", generatedAt: snapshotAt, generator: { name: "fixture", version: "1" } },
          rootId, view: "table", nodes: [root, ...leaves], edges, truncated: count === 100, diagnostics: [],
        },
      } } }));
      await page.goto("/lineage");
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      const viewer = page.locator("lineage-viewer");
      const svg = viewer.locator("svg");
      const fit = page.getByRole("button", { name: english ? "Fit entire graph" : "适应全部" });
      await expect(viewer.locator(".node")).toHaveCount(count);
      expect(await viewer.evaluate((el) => {
        const style = getComputedStyle(el);
        return style.getPropertyValue("--lineage-background").trim() === style.getPropertyValue("--surface-2").trim();
      })).toBe(true);
      await fit.click();
      const readTransform = () => viewer.locator(".viewport").evaluate((el) => {
        const value = (el as SVGGraphicsElement).transform.baseVal.consolidate()?.matrix;
        return { scale: value?.a ?? 0, x: value?.e ?? 0, y: value?.f ?? 0 };
      });
      const initialFit = await readTransform();
      expect(initialFit.scale).toBeGreaterThan(0);
      if (count === 100) expect(initialFit.scale).toBeLessThan(0.1);
      expect(await svg.evaluate((el) => {
        const bounds = el.getBoundingClientRect();
        return Array.from(el.querySelectorAll(".node-surface")).every((node) => {
          const box = node.getBoundingClientRect();
          return box.left >= bounds.left && box.right <= bounds.right
            && box.top >= bounds.top && box.bottom <= bounds.bottom;
        });
      })).toBe(true);

      await page.getByRole("button", { name: english ? "Zoom in" : "放大" }).click();
      await expect.poll(async () => (await readTransform()).scale).toBeCloseTo(initialFit.scale * 1.2, 5);
      await page.getByRole("button", { name: english ? "Zoom out" : "缩小" }).click();
      await expect.poll(async () => (await readTransform()).scale).toBeCloseTo(initialFit.scale, 5);
      await fit.click();
      await svg.scrollIntoViewIfNeeded();
      const box = (await svg.boundingBox())!;
      await page.mouse.move(box.x + 12, box.y + 60);
      await page.mouse.wheel(0, -80);
      await expect.poll(async () => (await readTransform()).scale).toBeCloseTo(initialFit.scale * Math.exp(0.16), 5);
      const afterWheel = await readTransform();
      await page.mouse.down();
      await page.mouse.move(box.x + 48, box.y + 94, { steps: 4 });
      await page.mouse.up();
      await expect.poll(async () => (await readTransform()).x).toBeCloseTo(afterWheel.x + 36, 3);
      await expect.poll(async () => (await readTransform()).y).toBeCloseTo(afterWheel.y + 34, 3);

      await page.getByRole("button", { name: english ? "Focus root neighborhood" : "定位根节点邻域" }).click();
      expect((await readTransform()).scale).toBeLessThan(initialFit.scale);
      await fit.click();
      expect(await readTransform()).toEqual(initialFit);
      await expect(viewer.locator(`g.node[data-node-id="${rootId}"] > title`)).toHaveText(rootName);
      await expect(viewer.locator(`g.node[data-node-id="${rootId}"] .node-subtitle`)).toHaveCount(0);
      await expect(viewer.locator('g.node[data-node-id="table:billing:0"] > title')).toHaveText(`billing.${longChineseName}`);
      await expect(page.locator(".lineage-detail h2")).toHaveText(rootName);
      await expect(page.locator(".lineage-detail-content > p")).toHaveCount(0);
      await expect(page.locator(".lineage-detail")).toContainText("2026-07-20 10:00:00 +08:00");
      if (count === 100) await expect(page.locator(".lineage-notice")).toContainText("Results were truncated");
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      expect(await page.locator(".lineage-detail-content").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);

      if (width === 1440) {
        const table = page.locator(".lineage-table-item").filter({ hasText: "long_table_identifier_" });
        await expect(table).toHaveAttribute("title", rootName);
        const snapshot = page.locator(".lineage-snapshot-info");
        await snapshot.locator("summary").click();
        await expect(snapshot).toContainText("2026-07-20 10:00:00 +08:00");
      }
      await page.locator(".lineage-card").screenshot({ path: testInfo.outputPath(`lineage-${width}-${language}-${theme}.png`) });
    });
  }

  for (const status of ["no_active_snapshot", "empty_snapshot", "unavailable"] as const) {
    test(`renders and retries ${status} without falling back to Mock`, async ({ page }) => {
      await page.addInitScript(() => localStorage.setItem("dap-language", "en-US"));
      let requests = 0;
      await routeLineage(page, () => {
        requests++;
        return status === "unavailable" && requests === 1
          ? { status: 503, json: { message: "Fixture snapshot read failed" } }
          : { json: { data: { bootstrap: bootstrap(status === "unavailable" ? "no_active_snapshot" : status), graph: null, noticeCode: null } } };
      });
      await page.goto("/lineage");
      if (status === "unavailable") {
        await expect(page.getByRole("alert").filter({ hasText: "Could not load lineage" })).toContainText("Fixture snapshot read failed");
        await expect(page.locator("lineage-viewer")).toHaveCount(0);
        await expect(page.getByText("Demo lineage data", { exact: true })).toHaveCount(0);
      } else {
        const text = status === "empty_snapshot" ? "The active snapshot has no nodes." : "There is no active lineage snapshot.";
        await expect(page.locator(".empty").filter({ hasText: text })).toBeVisible();
      }
      await page.getByRole("button", { name: "Reload" }).click();
      await expect(page.locator(".empty").filter({ hasText: "No lineage snapshot data" })).toBeVisible();
      await expect(page.locator(".state-card-error")).toHaveCount(0);
      await expect(page.locator("lineage-viewer")).toHaveCount(0);
      expect(requests).toBe(2);
    });
  }
});
