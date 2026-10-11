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

test("admin code-table status filter and form use their intended controls", async ({ page }, testInfo) => {
  await setMockAuth(page, "admin");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/code-table-maintenance");
  await expect(page.locator(".code-table-page .page-title")).toContainText("码值表维护", { timeout: 20_000 });
  await page.screenshot({ path: testInfo.outputPath("code-table-status-desktop-1440-light.png"), fullPage: true });

  const sidebar = page.locator(".sidebar");
  const allStatus = sidebar.getByRole("button", { name: /全部状态/ });
  const enabled = sidebar.getByRole("button", { name: /启用/ });
  await expect(allStatus).toHaveAttribute("aria-pressed", "true");
  await expect(allStatus).toContainText("8");
  await expect(enabled).toContainText("7");
  await expect(sidebar.getByRole("button", { name: /禁用/ })).toContainText("1");
  await expect(page.getByRole("combobox", { name: "状态筛选" })).toHaveCount(0);
  await expect(page.locator(".code-table-status-filter")).toHaveCount(0);

  const statusMutations: string[] = [];
  page.on("request", (request) => {
    if (
      ["POST", "PUT", "PATCH", "DELETE"].includes(request.method()) &&
      request.url().includes("/manual-code-tables")
    ) {
      statusMutations.push(`${request.method()} ${request.url()}`);
    }
  });
  await enabled.click();
  await expect(enabled).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".code-table-page table.dt tbody tr")).toHaveCount(7);
  await expect(page.getByRole("button", { name: "清除状态筛选：启用" })).toBeVisible();
  await expect(page.locator(".code-table-page .status-action-disable").first()).toBeVisible();
  expect(new URL(page.url()).searchParams.has("status")).toBe(false);
  expect(statusMutations).toEqual([]);
  await page.getByRole("button", { name: "清除状态筛选：启用" }).click();
  await expect(page.locator(".code-table-page table.dt tbody tr")).toHaveCount(8);

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
  await expect(page.getByRole("combobox", { name: "状态筛选" })).toHaveCount(0);
});

test("code-table facet counts combine search, style, and status and clear independently", async ({ page }) => {
  await setMockAuth(page, "admin");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/code-table-maintenance");
  await expect(page.locator(".code-table-page .page-title")).toContainText("码值表维护", { timeout: 20_000 });

  const sidebar = page.locator(".sidebar");
  const allStatus = sidebar.getByRole("button", { name: /全部状态/ });
  const dimension = sidebar.getByRole("button", { name: /维度字典/ });
  const disabled = sidebar.getByRole("button", { name: /禁用/ });
  await dimension.click();
  await expect(dimension).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".code-table-page table.dt tbody tr")).toHaveCount(4);
  await expect(allStatus).toContainText("4");
  await expect(sidebar.getByRole("button", { name: /启用/ })).toContainText("4");
  await expect(disabled).toContainText("0");

  await disabled.click();
  await expect(page.getByText("暂无匹配的手工码值表")).toBeVisible();
  await expect(page.getByRole("button", { name: "清除状态筛选：禁用" })).toBeVisible();
  await expect(page.getByRole("button", { name: "清除样式筛选：维度字典" })).toBeVisible();
  await page.getByRole("button", { name: "清除状态筛选：禁用" }).click();
  await expect(page.locator(".code-table-page table.dt tbody tr")).toHaveCount(4);
  await expect(dimension).toHaveAttribute("aria-pressed", "true");
  await expect(allStatus).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "清除样式筛选：维度字典" }).click();
  await expect(page.locator(".code-table-page table.dt tbody tr")).toHaveCount(8);

  await page.goto("/code-table-maintenance?q=STATUS");
  await expect(page.locator(".code-table-page table.dt tbody tr")).toHaveCount(3);
  await expect(allStatus).toContainText("3");
  await expect(sidebar.getByRole("button", { name: /启用/ })).toContainText("2");
  await expect(disabled).toContainText("1");
  await disabled.click();
  await expect(page.locator(".code-table-page table.dt tbody tr")).toHaveCount(1);
  await expect(sidebar.getByRole("button", { name: /状态流转/ })).toContainText("1");
  expect(new URL(page.url()).searchParams.get("q")).toBe("STATUS");
  expect(new URL(page.url()).searchParams.has("status")).toBe(false);

  const statusStyle = sidebar.getByRole("button", { name: /状态流转/ });
  await statusStyle.click();
  await expect(statusStyle).toHaveAttribute("aria-pressed", "true");
  await allStatus.click();
  await expect(page.locator(".code-table-page table.dt tbody tr")).toHaveCount(3);
  await expect(statusStyle).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "清除状态筛选：禁用" })).toHaveCount(0);
});

test("mobile status drawer leaves a keyboard-accessible summary and clear action", async ({ page }, testInfo) => {
  await setMockAuth(page, "admin");

  for (const [width, theme] of [[768, "light"], [390, "dark"]] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/code-table-maintenance");
    await page.evaluate((mode) => localStorage.setItem("dap-theme", mode), theme);
    await page.reload();
    await expect(page.locator(".code-table-page .page-title")).toContainText("码值表维护", { timeout: 20_000 });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);

    const sidebar = page.locator(".sidebar");
    await page.locator(".hamburger").click();
    await expect(sidebar).toHaveClass(/open/);
    const disabled = sidebar.getByRole("button", { name: /禁用/ });
    await disabled.focus();
    await expect(disabled).toBeFocused();
    await disabled.press("Enter");

    await expect(sidebar).not.toHaveClass(/open/);
    await expect(page.getByRole("button", { name: "清除状态筛选：禁用" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "状态筛选" })).toHaveCount(0);
    await expect(page.locator(".code-table-page table.dt tbody tr")).toHaveCount(1);
    const layout = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      hasStatusSummary: Boolean(document.querySelector(".code-table-active-filters")),
    }));
    expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
    expect(layout.hasStatusSummary).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`code-table-status-${width}-${theme}.png`), fullPage: true });

    const clearStatus = page.getByRole("button", { name: "清除状态筛选：禁用" });
    await clearStatus.focus();
    await expect(clearStatus).toBeFocused();
    await clearStatus.press("Enter");
    await expect(page.locator(".code-table-page table.dt tbody tr")).toHaveCount(8);
    expect(new URL(page.url()).searchParams.has("status")).toBe(false);
  }
});
