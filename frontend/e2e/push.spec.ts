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

  const importance = page.getByRole("combobox", { name: "重要程度" });
  const latestOutputTime = page.getByLabel("最晚出数时间");
  await expect(page.locator(".push-system-editor .form-action-bar")).toHaveCSS("position", "sticky");
  await expect(latestOutputTime).toHaveClass(/dap-ui-input/);
  await expect(latestOutputTime).toHaveAttribute("type", "time");
  await expect(latestOutputTime).toHaveAttribute("step", "60");
  await expect(latestOutputTime).toBeDisabled();
  await importance.click();
  await page.getByRole("option", { name: "重要", exact: true }).click();
  await expect(latestOutputTime).toBeEnabled();
  await latestOutputTime.fill("00:00");
  await expect(latestOutputTime).toHaveValue("00:00");
  await latestOutputTime.fill("23:59");
  await expect(latestOutputTime).toHaveValue("23:59");
  await latestOutputTime.fill("12:30");
  await latestOutputTime.focus();
  await latestOutputTime.press("Enter");
  await latestOutputTime.press("Escape");
  await latestOutputTime.press("ArrowUp");
  await expect(latestOutputTime).toHaveValue(/^\d{2}:\d{2}$/);
  await latestOutputTime.press("Tab");
  const tabFocusLabel = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
  expect(["最晚出数时间", "系统说明"]).toContain(tabFocusLabel);
  await page.keyboard.press("Shift+Tab");
  await expect(latestOutputTime).toBeFocused();
  await latestOutputTime.fill("");
  await expect(latestOutputTime).toHaveValue("");
  await importance.click();
  await page.getByRole("option", { name: "普通", exact: true }).click();
  await expect(latestOutputTime).toBeDisabled();
  await expect(latestOutputTime).toHaveValue("");

  await name.fill("E2E 下游系统");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "放弃修改" }).click();
  await expect(page.locator(".page-title")).toContainText("下游系统推送");
});

test("narrow admin system editor keeps time and Select controls clear of the action bar", async ({ page }) => {
  await setMockAuth(page, "admin");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/push/new");
  await expect(page.getByRole("heading", { name: "新增下游系统" })).toBeVisible({ timeout: 20_000 });

  const editor = page.locator(".push-system-editor");
  const actionBar = editor.locator(".form-action-bar");
  const latestOutputTime = page.getByLabel("最晚出数时间");
  const importance = page.getByRole("combobox", { name: "重要程度" });
  await expect(latestOutputTime).toHaveClass(/dap-ui-input/);
  await expect(actionBar).toHaveCSS("position", "static");

  await importance.click();
  const importantOption = page.getByRole("option", { name: "重要", exact: true });
  await expect(importantOption).toBeVisible();
  const optionBox = await importantOption.boundingBox();
  const actionBox = await actionBar.boundingBox();
  expect(optionBox).not.toBeNull();
  expect(actionBox).not.toBeNull();
  if (optionBox && actionBox) {
    const overlaps = optionBox.x < actionBox.x + actionBox.width
      && optionBox.x + optionBox.width > actionBox.x
      && optionBox.y < actionBox.y + actionBox.height
      && optionBox.y + optionBox.height > actionBox.y;
    expect(overlaps).toBe(false);
  }
  await importantOption.click();
  await expect(importance).toHaveText("重要");
  await expect(latestOutputTime).toBeEnabled();

  const timeBox = await latestOutputTime.boundingBox();
  expect(timeBox).not.toBeNull();
  if (timeBox) {
    const hitLabel = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.getAttribute("aria-label"), {
      x: timeBox.x + timeBox.width / 2,
      y: timeBox.y + timeBox.height / 2,
    });
    expect(hitLabel).toBe("最晚出数时间");
  }
  await latestOutputTime.click();
  await page.keyboard.press("Escape");
  await latestOutputTime.fill("23:59");
  await expect(latestOutputTime).toHaveValue("23:59");
  await latestOutputTime.fill("");
  await expect(latestOutputTime).toHaveValue("");
});

test("admin system editor preserves HH:mm through save and edit reload", async ({ page }) => {
  await setMockAuth(page, "admin");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/push/new");
  await expect(page.getByRole("heading", { name: "新增下游系统" })).toBeVisible({ timeout: 20_000 });

  await page.getByLabel("系统名称").fill("E2E 最晚出数时间系统");
  await page.getByLabel("系统编号").fill("SYS_TIME_408");
  await page.getByLabel("系统缩写").fill("TIME408");
  await page.getByLabel("服务器地址").fill("time-e2e.invalid");
  await page.getByRole("combobox", { name: "重要程度" }).click();
  await page.getByRole("option", { name: "重要", exact: true }).click();
  await page.getByLabel("最晚出数时间").fill("23:59");
  await page.getByRole("button", { name: "保存", exact: true }).click();

  await expect(page.locator(".push-title")).toHaveText("E2E 最晚出数时间系统", { timeout: 20_000 });
  await page.getByRole("button", { name: "编辑系统" }).click();
  await expect(page.getByRole("heading", { name: "编辑下游系统" })).toBeVisible({ timeout: 20_000 });
  const latestOutputTime = page.getByLabel("最晚出数时间");
  await expect(latestOutputTime).toHaveValue("23:59");

  await latestOutputTime.fill("");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".push-title")).toHaveText("E2E 最晚出数时间系统", { timeout: 20_000 });
  await page.getByRole("button", { name: "编辑系统" }).click();
  await expect(page.getByRole("heading", { name: "编辑下游系统" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByLabel("最晚出数时间")).toHaveValue("");
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
