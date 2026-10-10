import { expect, test, type Page } from "@playwright/test";

async function setMockAuth(page: Page, mode: "guest" | "admin"): Promise<void> {
  await page.addInitScript((authMode) => {
    localStorage.removeItem("dap_auth");
    if (authMode === "guest") return;
    localStorage.setItem("dap_auth", JSON.stringify({ role: "admin", user: "admin", name: "管理员" }));
  }, mode);
}

test("guest report list stays read-only and opens the detail drawer", async ({ page }) => {
  await setMockAuth(page, "guest");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/report-assets?view=list");

  await expect(page.locator(".page-title")).toContainText("报表资产", { timeout: 20_000 });
  await expect(page.locator(".indicator-tbl table.dt tbody tr").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "新增报表" })).toHaveCount(0);

  await page.locator(".indicator-summary-btn").first().click();
  const drawer = page.locator(".indicator-detail-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("heading", { name: "报表详情" })).toBeVisible();
  const closeButton = drawer.getByRole("button", { name: "关闭" });
  await expect(closeButton).toHaveClass(/dap-ui-button/);
  await closeButton.click();
  await expect(drawer).toHaveCount(0);
});

test("admin report editor uses adapter controls with stable labels and dirty cancel", async ({ page }) => {
  await setMockAuth(page, "admin");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/report-assets/new");

  await expect(page.getByRole("heading", { name: "新增报表" })).toBeVisible({ timeout: 20_000 });

  const codeInput = page.getByLabel("报表编码");
  await expect(codeInput).toHaveClass(/dap-ui-input/);
  await expect(codeInput).toHaveClass(/inp/);

  await expect(page.getByRole("combobox", { name: "报表类型" })).toHaveText("请选择报表类型");

  const domain = page.getByRole("combobox", { name: "主题域" });
  await expect(domain).toHaveText("请选择主题域");
  await domain.click();
  await page.getByRole("option").filter({ hasNotText: "请选择主题域" }).first().click();
  await expect(domain).not.toHaveText("请选择主题域");

  await expect(page.getByLabel("负责人")).toHaveAttribute("list", "report-person-options");
  await expect(page.getByRole("checkbox", { name: "维护人不同" })).toBeVisible();

  const purpose = page.getByLabel("报表说明");
  await expect(purpose).toHaveClass(/dap-ui-textarea/);
  await purpose.fill("E2E 报表说明");

  const lifecycle = page.locator("details", { hasText: "更多设置 / 生命周期" });
  await lifecycle.locator("summary").click();
  const effective = page.getByLabel("生效日期（选填）");
  await expect(effective).toHaveAttribute("type", "date");
  await effective.fill("2026-01-01");

  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "放弃修改" }).click();
  await expect(page.locator(".page-title")).toContainText("报表资产");
});
