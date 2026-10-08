import { expect, test } from "@playwright/test";

async function openAdapterFixture(page: import("@playwright/test").Page) {
  await page.goto("/__kumo-adapters");
  await expect(page.getByRole("heading", { name: "Kumo Primitive Adapter Fixture" })).toBeVisible({ timeout: 15_000 });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("dap_auth", JSON.stringify({ role: "admin", user: "admin", name: "管理员" }));
  });
});

test("DAP adapters expose stable variants, refs, className, controlled inputs, and semantic states", async ({ page }) => {
  const pageErrors: string[] = [];
  const deprecatedInputVariants: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "warning" && message.text().includes('variant="error" is deprecated')) {
      deprecatedInputVariants.push(message.text());
    }
  });
  await openAdapterFixture(page);

  const primary = page.getByTestId("adapter-primary-button");
  await expect(primary).toHaveClass(/dap-ui-button/);
  await expect(primary).toBeEnabled();
  await expect(page.getByTestId("adapter-danger-button")).toHaveClass(/dap-ui-button/);
  await expect(page.getByTestId("adapter-loading-button")).toBeDisabled();
  await expect(page.getByTestId("adapter-icon-button")).toHaveAccessibleName("新增字段");

  const input = page.getByTestId("adapter-controlled-input");
  await expect(input).toHaveClass(/adapter-custom-input/);
  await input.fill("controlled value");
  await expect(input).toHaveValue("controlled value");
  await page.getByTestId("adapter-focus-input").click();
  await expect(input).toBeFocused();
  const readOnly = page.getByTestId("adapter-readonly-input");
  await expect(readOnly).toHaveAttribute("readonly", "");
  await expect(readOnly).toBeEnabled();
  const errorInput = page.getByTestId("adapter-error-input");
  await expect(errorInput).toHaveClass(/ring-kumo-danger/);
  await expect(errorInput).toHaveAttribute("aria-invalid", "true");
  await expect(errorInput).toHaveAccessibleDescription("目标字段名称为必填项。");
  await expect(page.getByText("目标字段名称为必填项。", { exact: true })).toBeVisible();
  await expect(page.getByTestId("adapter-textarea")).toHaveValue("会员增长与交易明细的关联说明。");

  await expect(page.getByText("校验通过")).toBeVisible();
  await expect(page.getByText("操作失败")).toBeVisible();
  await expect(page.getByText("待复核")).toBeVisible();
  await expect(page.getByText("只读", { exact: true })).toBeVisible();
  await expect(page.getByTestId("adapter-surface")).toHaveClass(/adapter-custom-surface/);
  await expect(page.getByTestId("adapter-grid")).toHaveClass(/dap-ui-grid/);

  const breadcrumbs = page.getByRole("navigation", { name: "适配器示例面包屑" });
  await breadcrumbs.getByRole("button", { name: "首页" }).click();
  await expect(page.getByTestId("adapter-navigation-state")).toHaveText("已返回首页");
  await expect(breadcrumbs.getByText("数据资产")).toHaveAttribute("aria-current", "page");
  expect(pageErrors).toEqual([]);
  expect(deprecatedInputVariants).toEqual([]);
});

test("Select, Combobox, Tabs, Checkbox, and Switch preserve keyboard and controlled behavior", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await openAdapterFixture(page);

  const select = page.getByRole("combobox", { name: "上游系统" });
  await select.focus();
  await page.keyboard.press("ArrowDown");
  const production = page.getByRole("option", { name: /生产数仓/ });
  const staging = page.getByRole("option", { name: /预发布/ });
  await expect(production).toHaveAttribute("data-highlighted", "");
  await page.keyboard.press("ArrowDown");
  await expect(staging).toHaveAttribute("data-highlighted", "");
  await page.keyboard.press("Enter");
  await expect(select).toHaveText("stage");

  const combobox = page.getByRole("combobox", { name: "Schema / Table name" });
  await combobox.fill("schema.table");
  await expect(page.getByRole("option", { name: "schema.table_name" })).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(combobox).toHaveValue("schema.table_name");

  const overview = page.getByRole("tab", { name: "数据资产" });
  const mapping = page.getByRole("tab", { name: "字段映射" });
  await overview.focus();
  await page.keyboard.press("ArrowRight");
  await expect(mapping).toBeFocused();
  await expect(mapping).toHaveAttribute("aria-selected", "false");
  await page.keyboard.press("Enter");
  await expect(mapping).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "字段映射", exact: true })).toBeVisible();

  const checkbox = page.getByRole("checkbox", { name: "管理员 · 只读审阅" });
  await expect(checkbox).toBeChecked();
  await checkbox.click();
  const toggle = page.getByRole("switch", { name: "允许业务维护员编辑" });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("adapter-control-state")).toContainText("checkbox=false; switch=true; select=stage; combobox=schema.table_name");
  expect(pageErrors).toEqual([]);
});
