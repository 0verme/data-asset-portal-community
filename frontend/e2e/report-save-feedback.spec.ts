import { expect, test } from "@playwright/test";

test("long report save failures keep input, locate field conflicts, and show ordinary errors above the sticky bar", async ({ page }) => {
  let saveRequests = 0;
  let savedReport: Record<string, unknown> | null = null;

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!url.pathname.startsWith("/api/")) {
      await route.continue();
      return;
    }
    const path = url.pathname.replace(/^\/api/, "");

    if (path === "/auth/me") {
      await route.fulfill({
        contentType: "application/json",
        json: {
          data: {
            role: "admin",
            user: "e2e-admin",
            name: "E2E 管理员",
            permissions: ["report:write", "asset:read", "indicator:read"],
          },
        },
      });
      return;
    }
    if (path === "/public-catalog/config") {
      await route.fulfill({ contentType: "application/json", json: { profile: "internal", exportEnabled: false } });
      return;
    }
    if (path === "/reports/options") {
      await route.fulfill({
        contentType: "application/json",
        json: {
          options: {
            reportTypes: ["经营分析"],
            periods: ["日"],
            statCalibers: ["当日"],
            dataDelays: ["T+0"],
            departments: ["运营管理部"],
          },
        },
      });
      return;
    }
    if (path === "/reports" && request.method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        json: { items: savedReport ? [savedReport] : [] },
      });
      return;
    }
    if (path === "/reports" && request.method() === "POST") {
      saveRequests += 1;
      if (saveRequests === 1) {
        await new Promise((resolve) => setTimeout(resolve, 350));
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          json: { error: { code: "REPORT_ALREADY_EXISTS", message: "Report already exists" } },
        });
        return;
      }
      if (saveRequests === 2) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          json: { error: { code: "SERVICE_UNAVAILABLE", message: "Internal service details" } },
        });
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 800));
      savedReport = request.postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        json: { data: savedReport },
      });
      return;
    }
    if (path === "/assets/domains") {
      await route.fulfill({ contentType: "application/json", json: { items: [{ name: "支付" }] } });
      return;
    }
    if (path === "/assets/tables" || path === "/indicators") {
      await route.fulfill({ contentType: "application/json", json: { items: [] } });
      return;
    }
    if (path === "/assets/layers") {
      await route.fulfill({ contentType: "application/json", json: { items: [] } });
      return;
    }

    await route.fulfill({ contentType: "application/json", json: { items: [] } });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/report-assets/new");
  await expect(page.getByRole("heading", { name: "新增报表" })).toBeVisible({ timeout: 20_000 });

  const code = page.getByLabel("报表编码");
  await code.fill("RPT_PAY_DAILY");
  await page.getByLabel("报表名称").fill("E2E 长表单保存失败反馈");

  for (const [label, placeholder] of [
    ["报表类型", "请选择报表类型"],
    ["主题域", "请选择主题域"],
    ["归属部门", "请选择归属部门"],
    ["统计周期", "请选择统计周期"],
  ]) {
    const control = page.getByRole("combobox", { name: label });
    await control.click();
    await page.getByRole("option").filter({ hasNotText: placeholder }).first().click();
  }
  await page.getByLabel("负责人").fill("E2E 测试用户");
  await page.getByRole("combobox", { name: "统计口径" }).fill("当日");

  const main = page.locator(".main");
  await main.evaluate((element) => element.scrollTo(0, element.scrollHeight));
  await expect.poll(() => main.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

  const save = page.getByRole("button", { name: "创建报表" });
  await save.focus();
  await page.keyboard.press("Enter");
  const saving = page.getByRole("button", { name: "保存中..." });
  await expect(saving).toBeDisabled();
  await page.keyboard.press("Enter");
  await expect.poll(() => saveRequests).toBe(1);
  await expect(code).toBeFocused();
  await expect(code).toHaveValue("RPT_PAY_DAILY");
  await expect(code).toHaveAttribute("aria-invalid", "true");
  const describedBy = await code.getAttribute("aria-describedby");
  expect(describedBy).toBeTruthy();
  await expect(page.locator(`#${describedBy!.split(/\s+/)[0]}`)).toContainText("该报表编码已存在");
  await expect(page.getByRole("button", { name: "报表编码：该报表编码已存在，请修改后重试。" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Notifications" }).getByText("该报表编码已存在")).toHaveCount(0);

  await code.fill("RPT_E2E_UNAVAILABLE");
  await expect(code).not.toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("alert").filter({ hasText: "报表编码：" })).toHaveCount(0);
  await main.evaluate((element) => element.scrollTo(0, element.scrollHeight));
  await save.click();

  const notifications = page.getByRole("region", { name: "Notifications" });
  const serviceError = notifications.getByText("服务暂时不可用，请稍后重试。", { exact: true });
  await expect(serviceError).toBeVisible();
  const errorToast = serviceError.locator("xpath=ancestor::div[contains(@class, 'ring-kumo-danger')][1]");
  await expect(errorToast).toBeVisible();
  await expect.poll(() => saveRequests).toBe(2);
  await expect(code).toHaveValue("RPT_E2E_UNAVAILABLE");
  await expect(page.getByRole("heading", { name: "保存失败" })).toHaveCount(0);

  const actionBar = page.locator(".form-action-bar");
  expect(Number(await notifications.evaluate((element) => getComputedStyle(element).zIndex)))
    .toBeGreaterThan(Number(await actionBar.evaluate((element) => getComputedStyle(element).zIndex)));
  const toastBox = await errorToast.boundingBox();
  const actionBarBox = await actionBar.boundingBox();
  expect(toastBox).not.toBeNull();
  expect(actionBarBox).not.toBeNull();
  expect(toastBox!.y).toBeGreaterThanOrEqual(0);
  expect(toastBox!.y + toastBox!.height).toBeLessThanOrEqual(844);
  expect(toastBox!.y + toastBox!.height).toBeLessThanOrEqual(actionBarBox!.y);

  const successfulSubmit = save.click();
  await expect.poll(() => saveRequests).toBe(3);
  const successToast = notifications.getByText("报表已创建", { exact: true });
  await expect(successToast).toHaveCount(0);
  await successfulSubmit;
  await expect(successToast).toBeVisible();
  await expect(page.locator(".page-title")).toContainText("报表资产");
});
