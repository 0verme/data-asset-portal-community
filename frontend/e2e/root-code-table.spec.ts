import { expect, test, type Page } from "@playwright/test";

async function setMockAuth(page: Page, mode: "guest" | "admin"): Promise<void> {
  await page.addInitScript((authMode) => {
    localStorage.removeItem("dap_auth");
    if (authMode === "guest") return;
    localStorage.setItem("dap_auth", JSON.stringify({ role: "admin", user: "admin", name: "管理员" }));
  }, mode);
}

test("guest root and code-table lists stay read-only", async ({ page }) => {
  await setMockAuth(page, "guest");
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto("/root-management");
  await expect(page.locator(".root-page .page-title")).toContainText("词根库", { timeout: 20_000 });
  await expect(page.locator(".root-page table.dt tbody tr").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "批量导入" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "新增词根" })).toHaveCount(0);

  await page.goto("/code-table-maintenance");
  await expect(page.locator(".code-table-page .page-title")).toContainText("码值表维护", { timeout: 20_000 });
  await expect(page.locator(".code-table-page table.dt tbody tr").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "新增码值表" })).toHaveCount(0);
});

test("admin root editor and import preview consume adapter controls", async ({ page }) => {
  await setMockAuth(page, "admin");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/root-management");
  await expect(page.locator(".root-page .page-title")).toContainText("词根库", { timeout: 20_000 });

  await page.getByRole("main").getByRole("button", { name: "新增词根" }).click();
  const abbrInput = page.getByLabel("词根缩写");
  await expect(abbrInput).toHaveClass(/dap-ui-input/);
  await expect(abbrInput).toHaveClass(/inp/);
  const catSelect = page.getByRole("combobox", { name: "分类" });
  await expect(catSelect).toHaveClass(/sel/);
  const descArea = page.getByLabel("说明 / 示例");
  await expect(descArea).toHaveClass(/dap-ui-textarea/);
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.locator(".root-page .page-title")).toContainText("词根库");

  await page.getByRole("main").getByRole("button", { name: "批量导入" }).click();
  const paste = page.getByLabel("批量导入内容");
  await expect(paste).toHaveClass(/dap-ui-textarea/);
  await expect(paste).toHaveClass(/paste-ta/);
  await paste.fill("abbr,en,cn,cat,desc\ntrans,transaction,交易流水,业务对象,交易明细类命名词根");
  await expect(page.locator(".imp-summary").first()).toBeVisible();
  await page.getByRole("button", { name: "清空" }).click();
  await expect(page.locator(".imp-summary")).toHaveCount(0);
  await page.getByRole("button", { name: "返回", exact: true }).click();
  await expect(page.locator(".root-page .page-title")).toContainText("词根库");
});

test("admin code-table filter and form use adapter controls", async ({ page }) => {
  await setMockAuth(page, "admin");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/code-table-maintenance");
  await expect(page.locator(".code-table-page .page-title")).toContainText("码值表维护", { timeout: 20_000 });

  const filter = page.getByRole("combobox", { name: "状态筛选" });
  await expect(filter).toHaveClass(/code-table-status-filter/);
  await expect(filter).toHaveText("全部状态");
  await filter.click();
  await page.getByRole("option", { name: "启用" }).click();
  await expect(filter).toHaveText("启用");

  await page.getByRole("main").getByRole("button", { name: "新增码值表" }).click();
  const codeInput = page.getByLabel("表编码");
  await expect(codeInput).toHaveClass(/dap-ui-input/);
  const styleSelect = page.getByRole("combobox", { name: "表样式" });
  await expect(styleSelect).toHaveClass(/inp/);
  await expect(styleSelect).toHaveText("请选择表样式");
  const remark = page.getByLabel("说明");
  await expect(remark).toHaveClass(/dap-ui-textarea/);
  await expect(remark).toHaveClass(/ta/);
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "状态筛选" })).toBeVisible();
});
