import { expect, test } from "@playwright/test";

async function openFixture(page: import("@playwright/test").Page) {
  await page.goto("/__kumo-overlays");
  await expect(page.getByRole("heading", { name: "Kumo Overlay Adapter Fixture" })).toBeVisible({ timeout: 15_000 });
}

test("DAP Dialog shares the overlay portal, traps focus in WebKit, and restores focus", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await openFixture(page);

  const trigger = page.getByTestId("open-dialog");
  await trigger.focus();
  await trigger.click();

  const dialog = page.getByRole("dialog", { name: "DAP Dialog" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(page.locator("#root")).not.toHaveAttribute("aria-hidden", "true");
  expect(await dialog.evaluate((element) => element.closest("#dap-ui-overlay-root") !== null)).toBe(true);

  const first = page.getByTestId("dialog-tooltip-trigger");
  const last = page.getByTestId("close-dialog");
  await last.focus();
  await page.keyboard.press("Tab");
  await expect(first).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(last).toBeFocused();

  await first.focus();
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toBeVisible();
  const tooltipId = await tooltip.getAttribute("id");
  const describedBy = await first.getAttribute("aria-describedby");
  expect(tooltipId).toBeTruthy();
  expect(describedBy?.split(/\s+/)).toContain(tooltipId);
  expect(await tooltip.evaluate((element) => element.closest('[role="dialog"]') !== null)).toBe(true);

  await page.getByTestId("dialog-toast").click();
  const notificationRegion = page.getByRole("region", { name: "Notifications" });
  await expect(notificationRegion).toContainText("Dialog 内的通知");
  expect(await notificationRegion.evaluate((element) => element.closest("#dap-ui-overlay-root") !== null)).toBe(true);
  expect(await notificationRegion.evaluate((element) => element.closest("#root") !== null)).toBe(false);
  expect(await notificationRegion.evaluate((element) => getComputedStyle(element).zIndex)).toBe("220");

  await page.getByTestId("close-dialog").click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(page.locator("#root")).not.toHaveAttribute("aria-hidden", "true");
  expect(pageErrors).toEqual([]);
});

test("Tooltip, Popover, and Dropdown expose keyboard and accessible popup behavior", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await openFixture(page);

  await expect(page.getByRole("status").filter({ hasText: "正在加载资产" })).toBeVisible();
  await expect(page.getByText("没有匹配的数据资产")).toBeVisible();
  const errorTitle = page.getByText("读取数据失败");
  await expect(errorTitle).toBeVisible();
  expect(await errorTitle.evaluate((element) => element.closest('[role="alert"]') !== null)).toBe(true);

  const tooltipTrigger = page.getByTestId("tooltip-trigger");
  await tooltipTrigger.focus();
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toBeVisible();
  const tooltipId = await tooltip.getAttribute("id");
  expect((await tooltipTrigger.getAttribute("aria-describedby"))?.split(/\s+/)).toContain(tooltipId);
  await page.keyboard.press("Escape");
  await expect(tooltip).toBeHidden();

  await page.getByTestId("popover-trigger").click();
  const popover = page.getByRole("dialog", { name: "资产字段说明" });
  await expect(popover).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(popover).toBeHidden();

  await page.getByTestId("dropdown-trigger").click();
  const menuItem = page.getByRole("menuitem", { name: "查看字段映射" });
  await expect(menuItem).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(menuItem).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(menuItem).toBeHidden();

  await page.getByRole("button", { name: "重新加载" }).click();
  await expect(page.getByRole("region", { name: "Notifications" })).toContainText("正在重试");
  expect(pageErrors).toEqual([]);
});

test("Confirm and FormModal preserve busy, keyword, Escape, outside-click, and toast contracts", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await openFixture(page);

  await page.getByTestId("open-confirm").click();
  const confirmation = page.getByRole("alertdialog", { name: "确认删除字段映射？" });
  await expect(confirmation).toBeVisible();
  const keyword = page.getByRole("textbox", { name: "输入字段名以继续" });
  await expect(keyword).toHaveAccessibleDescription("请输入 schema.table_name 以确认删除。");
  const confirm = confirmation.getByRole("button", { name: "确认删除" });
  await expect(confirm).toBeDisabled();
  await keyword.fill("wrong-field");
  await expect(confirm).toBeDisabled();
  await keyword.fill("schema.table_name");
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(confirmation.getByRole("button", { name: "处理中..." })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(confirmation).toBeVisible();
  await expect(page.getByTestId("confirm-result")).toHaveText("确认已完成");
  await expect(confirmation).toBeHidden();

  await page.getByTestId("open-confirm").click();
  await expect(page.getByRole("alertdialog", { name: "确认删除字段映射？" })).toBeVisible();
  await page.mouse.click(8, 8);
  await expect(page.getByRole("alertdialog", { name: "确认删除字段映射？" })).toBeHidden();

  await page.getByTestId("open-service-confirm").click();
  const serviceDialog = page.getByRole("alertdialog", { name: "Promise-based confirmation" });
  await expect(serviceDialog).toBeVisible();
  await serviceDialog.getByRole("button", { name: "执行确认" }).click();
  await expect(serviceDialog.getByRole("button", { name: "处理中..." })).toBeDisabled();
  await expect(page.getByTestId("service-confirm-result")).toHaveText("true");
  await expect(serviceDialog).toBeHidden();
  await page.getByTestId("open-service-confirm").click();
  const cancelledServiceDialog = page.getByRole("alertdialog", { name: "Promise-based confirmation" });
  await expect(cancelledServiceDialog).toBeVisible();
  await cancelledServiceDialog.getByRole("button", { name: "取消" }).click();
  await expect(page.getByTestId("service-confirm-result")).toHaveText("false");
  await expect(cancelledServiceDialog).toBeHidden();

  await page.getByTestId("open-form-modal").click();
  let formDialog = page.getByRole("dialog", { name: "编辑资产字段" });
  await expect(formDialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(formDialog).toBeHidden();

  await page.getByTestId("open-form-modal").click();
  formDialog = page.getByRole("dialog", { name: "编辑资产字段" });
  await formDialog.getByRole("button", { name: "保存修改" }).click();
  await expect(formDialog.getByRole("button", { name: "保存中..." })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(formDialog).toBeVisible();
  await expect(formDialog).toBeHidden({ timeout: 3_000 });

  const region = page.getByRole("region", { name: "Notifications" });
  await page.getByTestId("show-toast").click();
  const successToast = region.locator('[role="dialog"]').filter({ hasText: "字段映射保存成功" });
  await expect(successToast).toBeVisible();
  await expect(successToast).toHaveClass(/ring-kumo-success/);
  await successToast.hover();
  const closeSuccess = successToast.locator('[data-kumo-part="close"]');
  await expect(closeSuccess).toBeVisible();
  await closeSuccess.click();
  await expect(region.getByText("字段映射保存成功")).toBeHidden();

  await page.getByTestId("show-toast-timeout").click();
  await expect(region).toContainText("短时通知已到达");
  await expect(region.getByText("短时通知已到达")).toBeHidden({ timeout: 5_000 });

  await page.getByTestId("show-toast-queue").click();
  const queuedSuccess = region.getByText("队列消息一", { exact: true });
  const queuedError = region.getByText("队列消息二", { exact: true });
  await expect(queuedSuccess).toBeAttached();
  await expect(queuedError).toBeVisible();
  await queuedError.hover();
  await expect(queuedSuccess).toBeVisible();
  await expect(queuedError).toBeVisible();
  const queuedErrorToast = queuedError.locator("xpath=ancestor::div[contains(@class, 'ring-kumo-danger')][1]");
  await expect(queuedErrorToast).toHaveClass(/ring-kumo-danger/);
  await expect(queuedErrorToast.locator('[data-kumo-part="close"]')).toBeVisible();
  await queuedErrorToast.locator('[data-kumo-part="close"]').click();
  await expect(queuedError).toBeHidden();
  await expect(queuedSuccess).toBeVisible();
  const queuedSuccessToast = queuedSuccess.locator("xpath=ancestor::div[contains(@class, 'ring-kumo-success')][1]");
  await queuedSuccessToast.locator('[data-kumo-part="close"]').click();
  await expect(queuedSuccess).toBeHidden();
  expect(pageErrors).toEqual([]);
});

test("toast service retains the window.alert fallback when no ToastHost is mounted", async ({ page }) => {
  await page.goto("/__kumo-toast-fallback");
  await expect(page.getByRole("heading", { name: "Kumo Toast Fallback Fixture" })).toBeVisible({ timeout: 15_000 });
  const alert = page.waitForEvent("dialog");
  const click = page.getByRole("button", { name: "Show fallback toast" }).click();
  const dialog = await alert;
  expect(dialog.type()).toBe("alert");
  expect(dialog.message()).toBe("Toast host unavailable; alert fallback retained.");
  await dialog.accept();
  await click;
});
