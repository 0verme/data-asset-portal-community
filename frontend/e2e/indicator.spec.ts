import { expect, test, type Page } from "@playwright/test";

async function setMockAuth(page: Page, mode: "guest" | "admin"): Promise<void> {
  await page.addInitScript((authMode) => {
    localStorage.removeItem("dap_auth");
    if (authMode === "guest") return;
    localStorage.setItem("dap_auth", JSON.stringify({ role: "admin", user: "admin", name: "管理员" }));
  }, mode);
}

test("guest indicator list stays read-only and opens the detail drawer", async ({ page }) => {
  await setMockAuth(page, "guest");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/indicator-maintenance?view=list");

  await expect(page.locator(".indicator-page .page-title")).toContainText("指标管理", { timeout: 20_000 });
  await expect(page.locator(".indicator-tbl table.dt tbody tr").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "新增指标" })).toHaveCount(0);

  await page.locator(".indicator-summary-btn").first().click();
  const drawer = page.locator(".indicator-detail-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("heading", { name: "指标详情" })).toBeVisible();
  const closeButton = drawer.getByRole("button", { name: "关闭指标详情" });
  await expect(closeButton).toHaveClass(/dap-ui-button/);
  await closeButton.click();
  await expect(drawer).toHaveCount(0);
});

test("admin indicator editor uses adapter controls and keeps the DAP cascader", async ({ page }) => {
  await setMockAuth(page, "admin");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/indicator-maintenance/new");

  await expect(page.getByRole("heading", { name: "新增指标" })).toBeVisible({ timeout: 20_000 });

  const idInput = page.getByLabel("指标 ID");
  await expect(idInput).toHaveClass(/dap-ui-input/);
  await expect(idInput).toHaveClass(/inp/);

  const aggregation = page.getByRole("combobox", { name: "聚合方式" });
  await expect(aggregation).toHaveClass(/inp/);
  const semantic = page.getByRole("combobox", { name: "语义生命周期" });
  await expect(semantic).toHaveClass(/inp/);
  await expect(page.getByRole("combobox", { name: "来源资产（稳定引用）" })).toHaveText("未绑定稳定资产（保留兼容快照）");
  await expect(aggregation).toHaveText("未指定（兼容历史指标）");
  await aggregation.click();
  await page.getByRole("option", { name: "SUM", exact: true }).click();
  await expect(aggregation).toHaveText("SUM");
  await aggregation.click();
  await page.getByRole("option", { name: "未指定（兼容历史指标）" }).click();
  await expect(aggregation).toHaveText("未指定（兼容历史指标）");
  await semantic.click();
  await page.getByRole("option", { name: "已认证" }).click();
  await expect(semantic).toHaveText("已认证");

  const meaning = page.getByLabel("指标含义");
  await expect(meaning).toHaveClass(/dap-ui-textarea/);
  await expect(page.locator(".indicator-path-cascader")).toBeVisible();
  const pathTrigger = page.locator(".indicator-path-trigger");
  await pathTrigger.click();
  await page.locator(".indicator-path-option").filter({ hasText: "PRD 商品维度" }).click();
  await page.locator(".indicator-path-option").filter({ hasText: "商品运营" }).click();
  await page.locator(".indicator-path-option").filter({ hasText: "规模" }).click();
  await expect(pathTrigger).toContainText("PRD > 商品运营 > 规模");

  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "放弃修改" }).click();
  await expect(page.locator(".indicator-page .page-title")).toContainText("指标管理");
});

test("form error presenter blocks invalid indicator saves and focuses fields after commit", async ({ page }) => {
  await setMockAuth(page, "admin");

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/indicator-maintenance/new");
    await expect(page.getByRole("heading", { name: "新增指标" })).toBeVisible({ timeout: 20_000 });

    const idInput = page.getByLabel("指标 ID");
    const nameInput = page.getByLabel("指标中文名");
    const registrarInput = page.getByLabel("登记人");
    const dateInput = page.getByLabel("登记日期");
    const pathTrigger = page.locator(".indicator-path-trigger");
    const summary = page.locator("#indicator-editor-form [role='alert']").first();

    await page.getByRole("button", { name: "创建指标" }).click();
    await expect(page.getByRole("heading", { name: "新增指标" })).toBeVisible();
    await expect(idInput).toBeFocused();
    await expect(idInput).toHaveAttribute("aria-invalid", "true");
    const idErrorDescription = await idInput.getAttribute("aria-describedby");
    expect(idErrorDescription).toBeTruthy();
    await expect(page.locator(`#${idErrorDescription!.split(/\s+/)[0]}`)).toContainText("指标 ID 不能为空");
    await expect(summary).toContainText("指标 ID：指标 ID 不能为空");

    await idInput.fill("KPI_FORM_ERROR");
    await expect(idInput).not.toHaveAttribute("aria-invalid", "true");
    await expect(summary).not.toContainText("指标 ID：指标 ID 不能为空");
    await nameInput.fill("表单错误反馈回归指标");
    await registrarInput.fill("E2E 测试用户");
    await dateInput.fill("2025-06-17");
    await expect(pathTrigger).toHaveAttribute("aria-invalid", "true");

    await page.getByRole("button", { name: "创建指标" }).click();
    await expect(page.getByRole("heading", { name: "新增指标" })).toBeVisible();
    await expect(pathTrigger).toBeFocused();
    await expect(pathTrigger).toBeInViewport();
    await expect(pathTrigger).toHaveAccessibleName("指标路径");
    await expect(pathTrigger).toHaveAttribute("aria-invalid", "true");
    const describedBy = await pathTrigger.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    await expect(page.locator(`#${describedBy!.split(/\s+/)[0]}`)).toContainText("指标路径不能为空");
    await expect(summary).toContainText("指标路径：指标路径不能为空");
    await expect(idInput).toHaveValue("KPI_FORM_ERROR");
    await expect(nameInput).toHaveValue("表单错误反馈回归指标");
    await expect(registrarInput).toHaveValue("E2E 测试用户");

    await pathTrigger.click();
    await page.locator(".indicator-path-option").filter({ hasText: "PRD 商品维度" }).click();
    await page.locator(".indicator-path-option").filter({ hasText: "商品运营" }).click();
    await page.locator(".indicator-path-option").filter({ hasText: "规模" }).click();
    await expect(pathTrigger).not.toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#indicator-editor-form [role='alert']")).toHaveCount(0);
  }
});
