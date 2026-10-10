import { expect, test, type Page } from "@playwright/test";

async function setMockAuth(page: Page, mode: "guest" | "admin"): Promise<void> {
  await page.addInitScript((authMode) => {
    localStorage.removeItem("dap_auth");
    if (authMode === "guest") return;
    localStorage.setItem("dap_auth", JSON.stringify({ role: "admin", user: "admin", name: "管理员" }));
  }, mode);
}

test("field mapping filters and pagination use adapter controls", async ({ page }) => {
  await setMockAuth(page, "admin");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/field-mapping");

  await expect(page.locator(".fm-card").first()).toBeVisible({ timeout: 20_000 });
  const toggle = page.locator(".fm-toggle");
  const srcTable = page.getByLabel("源系统表名");
  if (!(await srcTable.isVisible())) {
    await toggle.click();
  }
  await expect(srcTable).toHaveClass(/dap-ui-input/);
  await expect(page.getByLabel("DWF 字段名")).toHaveClass(/dap-ui-input/);
  await expect(page.getByRole("button", { name: "查询" })).toHaveClass(/dap-ui-button/);
  await expect(page.getByRole("button", { name: "重置" })).toHaveClass(/dap-ui-button/);

  const pageSize = page.getByRole("combobox", { name: "每页条数" });
  if (await pageSize.count()) {
    await expect(pageSize).toHaveClass(/fm-page-size/);
    await expect(page.getByRole("button", { name: "下一页" })).toHaveClass(/dap-ui-button/);
  }
});

test("lineage chrome uses adapters and keeps the canvas mounted", async ({ page }) => {
  await setMockAuth(page, "admin");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/lineage");

  await expect(page.locator(".page-title")).toContainText("血缘分析", { timeout: 20_000 });
  await expect(page.getByRole("combobox", { name: "血缘视图" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "血缘方向" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "血缘层级" })).toBeVisible();
  await expect(page.getByLabel("血缘节点名称")).toHaveClass(/dap-ui-input/);
  await expect(page.getByRole("button", { name: /刷新|加载中/ })).toHaveClass(/dap-ui-button/);
  await expect(page.getByRole("button", { name: "查询" })).toHaveClass(/dap-ui-button/);
  await expect(page.getByRole("button", { name: "清空" })).toHaveClass(/dap-ui-button/);
  await expect(page.locator(".lineage-canvas, .lineage-viewer").first()).toBeVisible();
});
