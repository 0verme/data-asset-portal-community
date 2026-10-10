import { expect, test, type Page } from "@playwright/test";

async function setMockAuth(page: Page, mode: "guest" | "admin"): Promise<void> {
  await page.addInitScript((authMode) => {
    localStorage.removeItem("dap_auth");
    if (authMode === "guest") return;
    localStorage.setItem("dap_auth", JSON.stringify({ role: "admin", user: "admin", name: "管理员" }));
  }, mode);
}

test("guest api asset list stays read-only and opens the detail view", async ({ page }) => {
  await setMockAuth(page, "guest");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/api-assets?view=list");

  await expect(page.locator(".page-title")).toContainText("API 资产", { timeout: 20_000 });
  const row = page.locator("table.dt tbody tr").filter({ hasText: "PRODUCT_QUERY" }).first();
  await expect(row).toBeVisible();
  await expect(page.getByRole("button", { name: "新增 API" })).toHaveCount(0);

  await row.getByRole("button").first().click();
  await expect(page).toHaveURL(/\/api-assets\/PRODUCT_QUERY$/);
  await expect(page.getByText("商品详情查询 API").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "编辑" })).toHaveCount(0);
});

test("admin api asset editor uses adapter controls and row editing", async ({ page }) => {
  await setMockAuth(page, "admin");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/api-assets/new");

  await expect(page.getByRole("heading", { name: "新增 API" })).toBeVisible({ timeout: 20_000 });

  const codeInput = page.getByLabel("API 编码");
  await expect(codeInput).toHaveClass(/dap-ui-input/);
  await expect(codeInput).toHaveClass(/inp/);

  await expect(page.getByRole("combobox", { name: "请求方式" })).toHaveText("GET");
  await expect(page.getByLabel("说明")).toHaveClass(/dap-ui-textarea/);
  await expect(page.getByLabel("备注")).toHaveClass(/dap-ui-textarea/);

  await expect(page.getByLabel("搜索系统名称或简称")).toHaveClass(/dap-ui-input/);
  await expect(page.locator(".system-picker select")).toBeVisible();

  const paramsTable = page.locator("table.mobile-edit-table").first();
  const paramRows = paramsTable.locator("tbody tr");
  const initial = await paramRows.count();
  const addButton = page.getByRole("button", { name: "+ 添加" }).first();
  await addButton.click();
  await expect(paramRows).toHaveCount(initial + 1);
  const rowNameInput = paramRows.last().locator("input").first();
  await expect(rowNameInput).toHaveClass(/dap-ui-input/);
  await paramRows.last().getByRole("button", { name: "删除" }).click();
  await expect(paramRows).toHaveCount(initial);

  await codeInput.fill("API_E2E");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.locator(".page-title")).toContainText("API 资产");
});
