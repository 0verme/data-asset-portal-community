import { expect, test } from "@playwright/test";

test("Remote strict collection response rejects malformed report envelopes and retries into a valid empty collection", async ({ page }) => {
  let reportRequests = 0;
  let allowReportRecovery = false;
  await page.route(/^https?:\/\/[^/]+\/api(?:\/|$)/, async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    if (path === "/auth/me") return route.fulfill({ status: 401, json: { message: "anonymous" } });
    if (path === "/public-catalog/config") return route.fulfill({ json: { profile: "internal", exportEnabled: false } });
    if (path === "/reports") {
      reportRequests += 1;
      if (!allowReportRecovery) return route.fulfill({ json: { data: { items: [] } } });
      return route.fulfill({ json: { items: [] } });
    }
    return route.fulfill({ json: { items: [] } });
  });

  await page.goto("/report-assets?view=list");
  await expect(page.getByRole("heading", { name: "报表资产加载失败" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("alert")).toContainText("报表列表接口返回格式无效");
  await expect(page.getByText("暂无报表资产", { exact: true })).toHaveCount(0);
  const failedReportRequests = reportRequests;
  expect(failedReportRequests).toBeGreaterThan(0);

  await page.waitForLoadState("networkidle");
  expect(reportRequests).toBe(failedReportRequests);
  allowReportRecovery = true;
  await page.getByRole("button", { name: "重新加载" }).click();
  await expect(page.getByText("暂无报表资产", { exact: true })).toBeVisible({ timeout: 20_000 });
  expect(reportRequests).toBeGreaterThan(failedReportRequests);
});

test("Remote strict collection response retries malformed parameter items and preserves a valid empty result", async ({ page }) => {
  let itemRequests = 0;
  let allowItemRecovery = false;
  await page.route(/^https?:\/\/[^/]+\/api(?:\/|$)/, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, "");
    if (path === "/auth/me") {
      await route.fulfill({ json: { data: {
        role: "admin",
        user: "admin",
        name: "管理员",
        permissions: ["indicator:read", "indicator:write", "system:param:read", "system:param:write"],
      } } });
      return;
    }
    if (path === "/public-catalog/config") {
      await route.fulfill({ json: { profile: "internal", exportEnabled: false } });
      return;
    }
    if (path === "/system/param-dicts/categories") {
      await route.fulfill({ json: { items: [{ code: "CUSTOM", name: "自定义分类", count: 0 }] } });
      return;
    }
    if (path === "/system/param-dicts" && request.method() === "GET") {
      itemRequests += 1;
      if (!allowItemRecovery) return route.fulfill({ json: { items: null } });
      return route.fulfill({ json: { items: [] } });
    }
    await route.fulfill({ json: { items: [] } });
  });

  await page.goto("/system-management/param-dicts");
  await expect(page.getByRole("heading", { name: "系统管理加载失败" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("alert")).toContainText("参数字典列表接口返回格式无效");
  await expect(page.locator(".page-title")).toHaveCount(0);
  const failedItemRequests = itemRequests;
  expect(failedItemRequests).toBeGreaterThan(0);

  await page.waitForLoadState("networkidle");
  allowItemRecovery = true;
  await page.getByRole("button", { name: "重新加载" }).click();
  await expect(page.locator(".page-title")).toContainText("参数字典", { timeout: 20_000 });
  await expect(page.getByText("当前分类暂无字典项")).toBeVisible();
  expect(itemRequests).toBeGreaterThan(failedItemRequests);
});

test("Remote indicator path malformed envelope is visible and retry accepts a legal empty tree", async ({ page }) => {
  let pathRequests = 0;
  let allowPathRecovery = false;
  await page.route(/^https?:\/\/[^/]+\/api(?:\/|$)/, async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    if (path === "/auth/me") {
      return route.fulfill({ json: { data: {
        role: "admin",
        user: "admin",
        name: "管理员",
        permissions: ["indicator:read", "indicator:write"],
      } } });
    }
    if (path === "/public-catalog/config") return route.fulfill({ json: { profile: "internal", exportEnabled: false } });
    if (path === "/indicator-path/tree") {
      pathRequests += 1;
      if (!allowPathRecovery) return route.fulfill({ json: { data: [] } });
      return route.fulfill({ json: [] });
    }
    return route.fulfill({ json: { items: [] } });
  });

  await page.goto("/indicator-maintenance/new");
  await expect(page.getByRole("heading", { name: "新增指标" })).toBeVisible({ timeout: 20_000 });
  const pathError = page.getByRole("alert");
  await expect(pathError).toContainText("指标路径树接口返回格式无效：预期数组或 items 数组", { timeout: 20_000 });
  const failedPathRequests = pathRequests;
  expect(failedPathRequests).toBeGreaterThan(0);

  await page.waitForLoadState("networkidle");
  allowPathRecovery = true;
  await page.getByRole("button", { name: "重试加载路径" }).click();
  await expect(pathError).toHaveCount(0);
  expect(pathRequests).toBeGreaterThan(failedPathRequests);
});
