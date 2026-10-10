import { expect, test, type Page } from "@playwright/test";

async function setMockAuth(page: Page, mode: "guest" | "admin"): Promise<void> {
  await page.addInitScript((authMode) => {
    localStorage.removeItem("dap_auth");
    if (authMode === "guest") return;
    localStorage.setItem("dap_auth", JSON.stringify({ role: "admin", user: "admin", name: "管理员" }));
  }, mode);
}

test("guest push systems list stays read-only", async ({ page }) => {
  await setMockAuth(page, "guest");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/push?view=list");

  await expect(page.locator(".page-title")).toContainText("下游系统推送", { timeout: 20_000 });
  await expect(page.locator("table.dt tbody tr").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "新增系统" })).toHaveCount(0);
});

test("admin push system editor uses adapter controls", async ({ page }) => {
  await setMockAuth(page, "admin");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/push/new");

  await expect(page.getByRole("heading", { name: "新增下游系统" })).toBeVisible({ timeout: 20_000 });

  const name = page.getByLabel("系统名称");
  await expect(name).toHaveClass(/dap-ui-input/);
  await expect(name).toHaveClass(/inp/);
  await expect(page.getByRole("combobox", { name: "归属部门" })).toHaveText("请选择归属部门");
  await expect(page.getByRole("combobox", { name: "重要程度" })).toHaveText("普通");
  await expect(page.getByLabel("系统说明")).toHaveClass(/dap-ui-textarea/);

  await name.fill("E2E 下游系统");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "放弃修改" }).click();
  await expect(page.locator(".page-title")).toContainText("下游系统推送");
});

test("admin push job editor uses adapters and field row tools", async ({ page }) => {
  await setMockAuth(page, "admin");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/push?view=list");

  const firstRow = page.locator("table.dt tbody tr").first();
  await expect(firstRow).toBeVisible({ timeout: 20_000 });
  await firstRow.click();
  await expect(page).toHaveURL(/\/push\/DEMO_[A-Z]+$/);
  await expect(page.getByRole("button", { name: "新增接口" })).toBeVisible();
  await page.getByRole("button", { name: "新增接口" }).click();
  await expect(page.getByRole("heading", { name: "新增推送接口" })).toBeVisible({ timeout: 20_000 });

  await expect(page.getByLabel("作业名称")).toHaveClass(/dap-ui-input/);
  await expect(page.getByRole("combobox", { name: "字段分隔符" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "推送频率" })).toBeVisible();

  const fieldsTable = page.locator("table.fields-edit");
  const rows = fieldsTable.locator("tbody tr");
  const initial = await rows.count();
  await page.getByRole("button", { name: "新增字段" }).click();
  await expect(rows).toHaveCount(initial + 1);
  const lastRow = rows.last();
  await expect(lastRow.locator("input").first()).toHaveClass(/dap-ui-input/);
  await expect(lastRow.getByRole("button", { name: /删除字段/ })).toBeVisible();
  await lastRow.getByRole("button", { name: /删除字段/ }).click();
  await expect(rows).toHaveCount(initial);
});
