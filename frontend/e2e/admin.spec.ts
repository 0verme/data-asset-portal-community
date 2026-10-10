import { expect, test, type Page } from "@playwright/test";

async function setMockAuth(page: Page, mode: "guest" | "admin" | "readonly"): Promise<void> {
  await page.addInitScript((authMode) => {
    localStorage.removeItem("dap_auth");
    if (authMode === "guest") return;
    const auth = authMode === "admin"
      ? { role: "admin", user: "admin", name: "管理员" }
      : { role: "maintainer", user: "只读审阅员", name: "只读审阅员", permissions: [] };
    localStorage.setItem("dap_auth", JSON.stringify(auth));
  }, mode);
}

test("guest and read-only users get no system write controls", async ({ page }) => {
  await setMockAuth(page, "guest");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/system-management/users");
  await expect(page.getByRole("heading", { name: "登录后访问系统管理" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "新增用户" })).toHaveCount(0);
});

test("admin user, menu and param editors use adapter controls", async ({ page }) => {
  await setMockAuth(page, "admin");
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto("/system-management/users");
  await page.locator(".head-actions").getByRole("button", { name: "新增用户" }).click();
  const username = page.getByLabel("用户名");
  await expect(username).toHaveClass(/dap-ui-input/);
  await expect(page.getByRole("combobox", { name: "账号角色" })).toBeVisible();
  await expect(page.getByLabel("备注")).toHaveClass(/dap-ui-textarea/);
  await page.getByRole("button", { name: "取消", exact: true }).click();

  await page.goto("/system-management/menus");
  await page.locator(".head-actions").getByRole("button", { name: "新增菜单" }).click();
  await expect(page.getByLabel("菜单编码")).toHaveClass(/dap-ui-input/);
  await expect(page.getByRole("combobox", { name: "菜单图标" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "导航位置" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "仅管理员可见" })).toBeVisible();
  await page.getByRole("button", { name: "取消", exact: true }).click();

  await page.goto("/system-management/param-dicts");
  await page.locator(".head-actions").getByRole("button", { name: "新增参数" }).click();
  await expect(page.getByRole("combobox", { name: "参数分类" })).toBeVisible();
  await expect(page.getByLabel("参数编码")).toHaveClass(/dap-ui-input/);
  await page.getByRole("button", { name: "取消", exact: true }).click();
});

test("admin operation log filters, pager and detail use adapters", async ({ page }) => {
  await setMockAuth(page, "admin");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/system-management/operation-logs");

  await expect(page.locator(".page-title")).toContainText("操作日志", { timeout: 20_000 });
  const moduleSelect = page.getByRole("combobox", { name: "模块" });
  await expect(moduleSelect).toHaveText("全部模块");
  await expect(page.getByLabel("开始时间")).toHaveAttribute("type", "datetime-local");

  await moduleSelect.click();
  await page.getByRole("option").filter({ hasNotText: "全部模块" }).first().click();
  const reset = page.getByRole("button", { name: "重置筛选" });
  await expect(reset).toHaveClass(/dap-ui-button/);
  await reset.click();
  await expect(moduleSelect).toHaveText("全部模块");

  const pager = page.locator(".oplog-pager");
  if (await pager.count()) {
    const next = pager.getByRole("button", { name: "下一页" });
    await expect(next).toHaveClass(/dap-ui-button/);
  }

  const firstRow = page.locator("table.dt tbody tr").first();
  if (await firstRow.count()) {
    await firstRow.getByRole("button").first().click();
    const detail = page.locator(".system-modal-card").first();
    await expect(detail).toBeVisible();
    const close = detail.getByRole("button", { name: "关闭" });
    await expect(close).toHaveClass(/dap-ui-button/);
    await close.click();
    await expect(detail).toHaveCount(0);
  }
});

test("menu sort IconButtons keep visible icons and preserve reorder boundaries", async ({ page }, testInfo) => {
  await setMockAuth(page, "admin");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/system-management/menus");

  const rows = page.locator("table.menu-mobile-table tbody tr");
  await expect(rows.first()).toBeVisible({ timeout: 20_000 });
  const firstRow = rows.first();
  const lastRow = rows.last();
  const firstUp = firstRow.getByRole("button", { name: "上移" });
  const firstDown = firstRow.getByRole("button", { name: "下移" });
  await expect(firstUp).toBeDisabled();
  await expect(firstDown).toBeEnabled();
  await expect(lastRow.getByRole("button", { name: "下移" })).toBeDisabled();

  for (const button of [firstUp, firstDown]) {
    await expect(button).toHaveClass(/dap-ui-icon-button/);
    await expect(button).not.toHaveClass(/\bbtn\b/);
    const svg = button.locator("svg");
    await expect(svg).toBeVisible();
    const bounds = await svg.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return { width: box.width, height: box.height };
    });
    expect(bounds.width).toBeGreaterThan(0);
    expect(bounds.height).toBeGreaterThan(0);
  }

  await page.screenshot({ path: testInfo.outputPath("menu-sort-icons-desktop-after.png"), fullPage: true });
  const firstCode = await firstRow.locator('td[data-label="编码"]').innerText();
  await firstDown.click();
  await expect.poll(async () => rows.first().locator('td[data-label="编码"]').innerText()).not.toBe(firstCode);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(rows.first()).toBeVisible();
  const mobileUp = rows.first().getByRole("button", { name: "上移" });
  const mobileDown = rows.first().getByRole("button", { name: "下移" });
  await expect(mobileUp).toBeDisabled();
  await expect(mobileDown).toBeEnabled();
  const mobileIconBounds = await mobileDown.locator("svg").evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { width: box.width, height: box.height };
  });
  expect(mobileIconBounds.width).toBeGreaterThan(0);
  expect(mobileIconBounds.height).toBeGreaterThan(0);
  await page.screenshot({ path: testInfo.outputPath("menu-sort-icons-mobile-after.png"), fullPage: true });
});
