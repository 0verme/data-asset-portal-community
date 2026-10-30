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

test("Remote strict collection response keeps indicator fields scoped to the selected source asset", async ({ page }) => {
  let assetBFieldRequests = 0;
  let allowAssetBRecovery = false;
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
    if (path === "/assets/tables") {
      return route.fulfill({ json: { items: [
        { assetId: 1, name: "ASSET_A", cn: "资产 A" },
        { assetId: 2, name: "ASSET_B", cn: "资产 B" },
      ] } });
    }
    if (path === "/assets/1/fields") {
      return route.fulfill({ json: { items: [{ assetId: 1, fieldId: 101, name: "FIELD_A", cn: "字段 A" }] } });
    }
    if (path === "/assets/2/fields") {
      assetBFieldRequests += 1;
      if (!allowAssetBRecovery) return route.fulfill({ json: { items: null } });
      return route.fulfill({ json: { items: [{ assetId: 2, fieldId: 202, name: "FIELD_B", cn: "字段 B" }] } });
    }
    if (path === "/indicator-path/tree") return route.fulfill({ json: [] });
    return route.fulfill({ json: { items: [] } });
  });

  await page.goto("/indicator-maintenance/new");
  await expect(page.getByRole("heading", { name: "新增指标" })).toBeVisible({ timeout: 20_000 });
  const sourceAsset = page.getByRole("combobox", { name: "来源资产（稳定引用）" });
  const resultField = page.getByRole("combobox", { name: "结果字段（稳定引用）" });
  await sourceAsset.click();
  await page.getByRole("option", { name: "资产 A · ASSET_A" }).click();
  await resultField.click();
  await expect(page.getByRole("option", { name: "字段 A · FIELD_A" })).toBeVisible();
  await page.keyboard.press("Escape");

  await sourceAsset.click();
  await page.getByRole("option", { name: "资产 B · ASSET_B" }).click();
  await expect(page.getByRole("alert")).toContainText("数据资产列表接口返回格式无效：预期数组或 items 数组");
  const retryFields = page.getByRole("button", { name: "重试加载字段" });
  await expect(retryFields).toBeVisible();
  await resultField.click();
  await expect(page.getByRole("option", { name: "字段 A · FIELD_A" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  allowAssetBRecovery = true;
  await retryFields.click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(assetBFieldRequests).toBe(2);
  await resultField.click();
  await expect(page.getByRole("option", { name: "字段 B · FIELD_B" })).toBeVisible();
});

test("Remote strict collection response reloads a failed category after navigating away and back", async ({ page }) => {
  let categoryBRequests = 0;
  await page.route(/^https?:\/\/[^/]+\/api(?:\/|$)/, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, "");
    if (path === "/auth/me") {
      return route.fulfill({ json: { data: {
        role: "admin",
        user: "admin",
        name: "管理员",
        permissions: ["system:user:read", "system:param:read", "system:param:write"],
      } } });
    }
    if (path === "/public-catalog/config") return route.fulfill({ json: { profile: "internal", exportEnabled: false } });
    if (path === "/system/param-dicts/categories") {
      return route.fulfill({ json: { items: [
        { code: "CATEGORY_A", name: "分类 A", count: 1 },
        { code: "CATEGORY_B", name: "分类 B", count: 1 },
      ] } });
    }
    if (path === "/system/param-dicts" && request.method() === "GET") {
      const categoryCode = new URL(request.url()).searchParams.get("categoryCode");
      if (categoryCode === "CATEGORY_A") {
        return route.fulfill({ json: { items: [{ id: "a1", categoryCode, categoryName: "分类 A", code: "A_ENTRY", name: "A 字典项", value: "a", status: "enabled" }] } });
      }
      if (categoryCode === "CATEGORY_B") {
        categoryBRequests += 1;
        if (categoryBRequests === 1) return route.fulfill({ json: { items: null } });
        return route.fulfill({ json: { items: [{ id: "b1", categoryCode, categoryName: "分类 B", code: "B_ENTRY", name: "B 字典项", value: "b", status: "enabled" }] } });
      }
    }
    if (path === "/system/users") return route.fulfill({ json: { items: [] } });
    return route.fulfill({ json: { items: [] } });
  });

  await page.goto("/system-management/param-dicts");
  await expect(page.getByText("A 字典项")).toBeVisible({ timeout: 20_000 });
  await page.locator(".system-category-item").filter({ hasText: "分类 B" }).click();
  await expect(page.getByRole("heading", { name: "系统管理加载失败" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("alert")).toContainText("参数字典列表接口返回格式无效：预期数组或 items 数组");

  await page.locator(".side-item").filter({ hasText: "用户管理" }).click();
  await expect(page.locator(".page-title")).toContainText("用户管理", { timeout: 20_000 });
  await page.locator(".side-item").filter({ hasText: "参数字典" }).click();
  await expect(page.getByText("B 字典项")).toBeVisible({ timeout: 20_000 });
  expect(categoryBRequests).toBe(2);
});
