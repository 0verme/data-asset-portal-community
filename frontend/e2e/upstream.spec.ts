import { expect, test, type Page } from "@playwright/test";

async function setMockAuth(page: Page, mode: "guest" | "admin"): Promise<void> {
  await page.addInitScript((authMode) => {
    localStorage.removeItem("dap_auth");
    if (authMode === "guest") return;
    localStorage.setItem("dap_auth", JSON.stringify({ role: "admin", user: "admin", name: "管理员" }));
  }, mode);
}

test("guest upstream list and detail stay read-only", async ({ page }) => {
  await setMockAuth(page, "guest");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/upstream?view=list");

  await expect(page.locator(".upstream-page .page-title")).toContainText("上游卸数系统", { timeout: 20_000 });
  const memberRow = page.locator(".upstream-page table.dt tbody tr").filter({ hasText: "会员中心" }).first();
  await expect(memberRow).toBeVisible();
  await expect(page.getByRole("button", { name: "新增系统" })).toHaveCount(0);

  await memberRow.click();
  await expect(page).toHaveURL(/\/upstream\/up_member$/);
  await expect(page.locator(".upstream-detail-title")).toContainText("会员中心");
  await expect(page.getByRole("button", { name: "编辑" })).toHaveCount(0);
  await expect(page.locator(".schedule-stepper-scroll")).toBeVisible();
});

test("admin upstream editor keeps adapter controls, schedule edits and save flow", async ({ page }) => {
  await setMockAuth(page, "admin");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/upstream/up_member/edit");

  await expect(page.getByRole("heading", { name: "编辑上游卸数系统" })).toBeVisible({ timeout: 20_000 });

  const idInput = page.locator('[data-form-field="id"] input');
  await expect(idInput).toHaveClass(/dap-ui-input/);
  await expect(idInput).toHaveClass(/inp/);
  await expect(idInput).toHaveValue("up_member");

  const dbTypeSelect = page.locator('[data-form-field="dbType"]').getByRole("combobox");
  await expect(dbTypeSelect).toHaveClass(/sel/);

  const desc = page.locator("textarea.ta");
  await expect(desc).toHaveClass(/dap-ui-textarea/);

  const timeRows = page.locator(".time-row");
  const initialRows = await timeRows.count();
  await page.getByRole("button", { name: "新增时间点" }).click();
  await expect(timeRows).toHaveCount(initialRows + 1);
  const deleteButton = page.locator(".time-row").last().getByRole("button");
  await expect(deleteButton).toHaveClass(/icon-btn/);
  await deleteButton.click();
  await expect(timeRows).toHaveCount(initialRows);

  await page.locator('[data-form-field="name"] input').fill("会员中心 E2E");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page).toHaveURL(/\/upstream\/up_member$/);
  await expect(page.locator(".upstream-detail-title")).toContainText("会员中心 E2E");
});

test("upstream editor validation keeps inline field errors on the adapter controls", async ({ page }) => {
  await setMockAuth(page, "admin");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/upstream/up_member/edit");
  await expect(page.getByRole("heading", { name: "编辑上游卸数系统" })).toBeVisible({ timeout: 20_000 });

  await page.locator('[data-form-field="id"] input').fill("");
  await page.getByRole("button", { name: "保存", exact: true }).click();

  await expect(page).toHaveURL(/\/upstream\/up_member\/edit$/);
  await expect(page.locator('[data-form-field="id"] .upstream-field-error')).toContainText("系统标识不能为空");
  await expect(page.getByText("保存失败").first()).toBeVisible();
});
