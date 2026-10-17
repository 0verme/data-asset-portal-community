import { expect, test, type Page } from "@playwright/test";

async function setMockAuth(page: Page, mode: "guest" | "admin"): Promise<void> {
  await page.addInitScript((authMode) => {
    localStorage.removeItem("dap_auth");
    if (authMode === "guest") return;
    localStorage.setItem("dap_auth", JSON.stringify({ role: "admin", user: "admin", name: "管理员" }));
  }, mode);
}

async function selectFirstNonPlaceholder(page: Page, label: string, placeholder: string): Promise<void> {
  const control = page.getByRole("combobox", { name: label });
  await control.click();
  await page.getByRole("option").filter({ hasNotText: placeholder }).first().click();
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

test("form error presenter blocks invalid report saves and refocuses after field correction", async ({ page }) => {
  await setMockAuth(page, "admin");

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/report-assets/new");
    await expect(page.getByRole("heading", { name: "新增报表" })).toBeVisible({ timeout: 20_000 });

    const codeInput = page.getByLabel("报表编码");
    const nameInput = page.getByLabel("报表名称");
    const statCaliberInput = page.getByRole("combobox", { name: "统计口径" });
    const summary = page.locator("#report-editor-form [role='alert']").first();

    await page.getByRole("button", { name: "创建报表" }).click();
    await expect(page.getByRole("heading", { name: "新增报表" })).toBeVisible();
    await expect(codeInput).toBeFocused();
    await expect(codeInput).toHaveAttribute("aria-invalid", "true");
    const codeDescription = await codeInput.getAttribute("aria-describedby");
    expect(codeDescription).toBeTruthy();
    await expect(page.locator(`#${codeDescription!.split(/\s+/)[0]}`)).toContainText("报表编码不能为空");
    await expect(summary).toContainText("报表编码：报表编码不能为空");
    await expect(statCaliberInput).toHaveAttribute("aria-invalid", "true");
    const caliberDescription = await statCaliberInput.getAttribute("aria-describedby");
    expect(caliberDescription).toBeTruthy();
    await expect(page.locator(`#${caliberDescription!.split(/\s+/)[0]}`)).toContainText("请选择或输入统计口径");

    await codeInput.fill("RPT_E2E_FORM");
    await expect(codeInput).not.toHaveAttribute("aria-invalid", "true");
    await expect(summary).not.toContainText("报表编码");
    await statCaliberInput.fill("按日统计");
    await expect(statCaliberInput).not.toHaveAttribute("aria-invalid", "true");
    await expect(summary).not.toContainText("统计口径");
    await page.getByRole("button", { name: "创建报表" }).click();
    await expect(nameInput).toBeFocused();
    await expect(nameInput).toHaveAttribute("aria-invalid", "true");
    await expect(summary).toContainText("报表名称：报表名称不能为空");

    await nameInput.fill("E2E 表单反馈日报");
    await expect(nameInput).not.toHaveAttribute("aria-invalid", "true");
    await expect(summary).not.toContainText("报表名称");
    await expect(codeInput).toHaveValue("RPT_E2E_FORM");
    await expect(nameInput).toHaveValue("E2E 表单反馈日报");
  }
});

for (const width of [1440, 390]) {
  test(`form error presenter expands lifecycle details to focus a reversed expiry date (${width}px)`, async ({ page }) => {
    await setMockAuth(page, "admin");
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/report-assets/new");
    await expect(page.getByRole("heading", { name: "新增报表" })).toBeVisible({ timeout: 20_000 });

    await page.getByLabel("报表编码").fill("RPT_E2E_DATES");
    await page.getByLabel("报表名称").fill("E2E 日期校验日报");
    await selectFirstNonPlaceholder(page, "报表类型", "请选择报表类型");
    await selectFirstNonPlaceholder(page, "主题域", "请选择主题域");
    await selectFirstNonPlaceholder(page, "归属部门", "请选择归属部门");
    await page.getByLabel("负责人").fill("E2E 测试用户");
    await selectFirstNonPlaceholder(page, "统计周期", "请选择统计周期");
    await page.getByRole("combobox", { name: "统计口径" }).fill("按日统计");

    const lifecycle = page.locator("details.form-card").filter({ hasText: "更多设置 / 生命周期" });
    const lifecycleSummary = lifecycle.locator("summary");
    await lifecycleSummary.click();
    await page.getByLabel("生效日期（选填）").fill("2026-06-01");
    const expireDate = page.getByLabel("失效日期（选填）");
    await expireDate.fill("2026-05-01");
    await lifecycleSummary.click();
    await expect(lifecycle).not.toHaveAttribute("open", "");

    await page.getByRole("button", { name: "创建报表" }).click();
    await expect(lifecycle).toHaveAttribute("open", "");
    await expect(expireDate).toBeFocused();
    await expect(expireDate).toHaveAttribute("aria-invalid", "true");
    const expireDescription = await expireDate.getAttribute("aria-describedby");
    expect(expireDescription).toBeTruthy();
    await expect(page.locator(`#${expireDescription!.split(/\s+/)[0]}`)).toContainText("失效日期不能早于生效日期");
    await expect(page.locator("#report-editor-form [role='alert']").first()).toContainText("失效日期：失效日期不能早于生效日期");
    await expect(page.getByRole("heading", { name: "新增报表" })).toBeVisible();
  });
}

test("form error presenter summary links reveal collapsed lifecycle fields before focus", async ({ page }) => {
  await setMockAuth(page, "admin");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/report-assets/new");
  await expect(page.getByRole("heading", { name: "新增报表" })).toBeVisible({ timeout: 20_000 });

  await page.getByLabel("报表名称").fill("E2E 日期摘要跳转日报");
  await selectFirstNonPlaceholder(page, "报表类型", "请选择报表类型");
  await selectFirstNonPlaceholder(page, "主题域", "请选择主题域");
  await selectFirstNonPlaceholder(page, "归属部门", "请选择归属部门");
  await page.getByLabel("负责人").fill("E2E 测试用户");
  await selectFirstNonPlaceholder(page, "统计周期", "请选择统计周期");
  await page.getByRole("combobox", { name: "统计口径" }).fill("按日统计");

  const lifecycle = page.locator("details.form-card").filter({ hasText: "更多设置 / 生命周期" });
  const lifecycleSummary = lifecycle.locator("summary");
  await lifecycleSummary.click();
  await page.getByLabel("生效日期（选填）").fill("2026-06-01");
  const expireDate = page.getByLabel("失效日期（选填）");
  await expireDate.fill("2026-05-01");
  await lifecycleSummary.click();
  await expect(lifecycle).not.toHaveAttribute("open", "");

  const codeInput = page.getByLabel("报表编码");
  await page.getByRole("button", { name: "创建报表" }).click();
  await expect(codeInput).toBeFocused();
  await expect(lifecycle).not.toHaveAttribute("open", "");

  const expiryError = page.getByRole("button", { name: "失效日期：失效日期不能早于生效日期" });
  await expiryError.click();
  await expect(lifecycle).toHaveAttribute("open", "");
  await expect(expireDate).toBeFocused();
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
