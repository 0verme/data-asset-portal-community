import { expect, test, type Page } from "@playwright/test";

async function checkReportSaveFeedback(page: Page, width: number, theme: "light" | "dark") {
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
      const items = savedReport ? [savedReport] : [];
      await route.fulfill({
        contentType: "application/json",
        json: {
          items,
          total: items.length,
          page: 1,
          pageSize: 20,
          facets: { type: {}, status: {}, ownerDept: {} },
          stats: { reportCount: items.length },
        },
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
          status: 422,
          contentType: "application/json",
          json: {
            error: {
              code: "REPORT_VALIDATION_FAILED",
              message: "Report validation failed",
              details: [
                { field: "code", message: "server detail for code" },
                { field: "name", message: "server detail for name" },
              ],
            },
          },
        });
        return;
      }
      if (saveRequests === 3) {
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

  await page.addInitScript((theme) => localStorage.setItem("dap-theme", theme), theme);
  await page.setViewportSize({ width, height: 844 });
  await page.goto("/report-assets/new");
  await expect(page.getByRole("heading", { name: "新增报表" })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);

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
    await page.getByRole("option").filter({ hasNotText: placeholder }).first().press("Enter");
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

  await code.fill("RPT_E2E_SERVER_VALIDATION");
  await expect(code).not.toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("alert").filter({ hasText: "报表编码：" })).toHaveCount(0);
  await main.evaluate((element) => element.scrollTo(0, element.scrollHeight));
  await save.click();

  await expect.poll(() => saveRequests).toBe(2);
  await expect(code).toBeFocused();
  await expect(code).toHaveAttribute("aria-invalid", "true");
  const name = page.getByLabel("报表名称");
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("button", { name: "报表名称：服务端校验未通过，请检查此字段。" })).toBeVisible();

  await code.fill("RPT_E2E_FIELD_CORRECTED");
  await expect(code).toBeFocused();
  await expect(code).not.toHaveAttribute("aria-invalid", "true");
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await name.fill("E2E 长表单字段修正");
  await expect(name).toBeFocused();
  await expect(name).not.toHaveAttribute("aria-invalid", "true");

  await code.fill("RPT_E2E_UNAVAILABLE");
  await main.evaluate((element) => element.scrollTo(0, element.scrollHeight));
  await save.click();

  const notifications = page.getByRole("region", { name: "Notifications" });
  const serviceError = notifications.getByText("服务暂时不可用，请稍后重试。", { exact: true });
  await expect(serviceError).toBeVisible();
  const errorToastSurface = serviceError.locator("xpath=ancestor::*[@data-kumo-part='surface'][1]");
  await expect(errorToastSurface).toBeVisible();
  // Take multiple consecutive frames starting as soon as the error appears.
  // A transient slide over the action bar is a failure as well as a bad resting position.
  const samples = await errorToastSurface.evaluate(async (surface) => {
    const bar = document.querySelector(".form-action-bar")!;
    const samples = [];
    for (let frame = 0; frame < 12; frame += 1) {
      const bounds = surface.getBoundingClientRect();
      samples.push({
        gap: bar.getBoundingClientRect().top - bounds.bottom,
        top: bounds.top,
        bottom: bounds.bottom,
        left: bounds.left,
        right: bounds.right,
      });
      await new Promise(requestAnimationFrame);
    }
    return samples;
  });
  for (const bounds of samples) {
    expect(bounds.gap, "the visible Toast surface must stay 8–24px above the action bar").toBeGreaterThanOrEqual(8);
    expect(bounds.gap).toBeLessThanOrEqual(24);
    expect(bounds.top).toBeGreaterThanOrEqual(0);
    expect(bounds.bottom).toBeLessThanOrEqual(844);
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(width);
  }

  await expect(errorToastSurface).toHaveClass(/ring-kumo-danger/);
  await expect.poll(() => saveRequests).toBe(3);
  await expect(code).toHaveValue("RPT_E2E_UNAVAILABLE");
  await expect(page.getByRole("heading", { name: "保存失败" })).toHaveCount(0);

  const actionBar = page.locator(".form-action-bar");
  expect(Number(await notifications.evaluate((element) => getComputedStyle(element).zIndex)))
    .toBeGreaterThan(Number(await actionBar.evaluate((element) => getComputedStyle(element).zIndex)));

  const successfulSubmit = save.click();
  await expect.poll(() => saveRequests).toBe(4);
  const successToast = notifications.getByText("报表已创建", { exact: true });
  await expect(successToast).toHaveCount(0);
  await successfulSubmit;
  await expect(successToast).toBeVisible();
  const successToastSurface = successToast.locator("xpath=ancestor::*[@data-kumo-part='surface'][1]");
  await expect(successToastSurface).toHaveClass(/ring-kumo-success/);
  await expect(page.locator(".page-title")).toContainText("报表资产");
}

for (const width of [390, 500, 768, 1440]) {
  for (const theme of ["light", "dark"] as const) {
    test(`report save feedback clears the action bar at ${width}px in ${theme}`, async ({ page }) => {
      await checkReportSaveFeedback(page, width, theme);
    });
  }
}
