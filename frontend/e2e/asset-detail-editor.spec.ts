import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";

const ASSET_PATH = "/data-warehouse";
const EXISTING_ASSET = "dwm_trade_order_item_di";

type AuthMode = "guest" | "admin" | "readonly";

async function setMockAuth(page: Page, mode: AuthMode) {
  await page.addInitScript((authMode) => {
    localStorage.removeItem("dap_auth");
    if (authMode === "guest") return;
    const auth = authMode === "admin"
      ? { role: "admin", user: "admin", name: "管理员" }
      : { role: "maintainer", user: "只读审阅员", name: "只读审阅员", permissions: [] };
    localStorage.setItem("dap_auth", JSON.stringify(auth));
  }, mode);
}

async function installClipboardSpy(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text: string) => sessionStorage.setItem("dap-test-copied-text", text) },
    });
  });
}

async function openAssetDetail(page: Page, auth: AuthMode) {
  await setMockAuth(page, auth);
  await page.goto(`${ASSET_PATH}/${EXISTING_ASSET}`);
  await expect(page.locator(".dh-en")).toHaveText(EXISTING_ASSET, { timeout: 20_000 });
  await expect(page.locator(".dh-cn")).toContainText("订单商品");
}

async function chooseOption(page: Page, control: Locator, label: string) {
  const tagName = await control.evaluate((element) => element.tagName);
  if (tagName === "SELECT") {
    await control.selectOption({ label });
    return;
  }
  await control.click();
  await page.getByRole("option", { name: label, exact: true }).click();
}

async function closeMobileSidebar(page: Page) {
  const sidebar = page.locator("#mobile-sidebar");
  if (await sidebar.evaluate((element) => element.classList.contains("open"))) {
    await page.keyboard.press("Escape");
  }
  await expect(sidebar).not.toHaveClass(/open/);
  await expect.poll(() => sidebar.evaluate((element) => element.getBoundingClientRect().right <= 0)).toBe(true);
}

async function deleteAssetFromEditor(page: Page, tableName: string) {
  await expect(page.locator(".dh-en")).toHaveText(tableName);
  await page.getByRole("button", { name: "编辑表" }).click();
  await page.locator(".danger-zone").scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: "删除表" }).click();

  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  const keyword = dialog.locator(".confirm-keyword input");
  const confirm = dialog.getByRole("button", { name: "确认删除" });
  await keyword.fill(`${tableName}-wrong`);
  await expect(confirm).toBeDisabled();
  await keyword.fill(tableName);
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(page.locator(".asset-page .page-title")).toContainText("数据资产");
  await expect(page.locator(".asset-page table.dt tbody")).not.toContainText(tableName);
}

test("guest and read-only users can inspect fields and DDL but cannot edit assets", async ({ page }, testInfo: TestInfo) => {
  await installClipboardSpy(page);
  for (const auth of ["guest", "readonly"] as const) {
    await openAssetDetail(page, auth);
    await expect(page.locator("table.fields tbody tr").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "编辑表" })).toHaveCount(0);
    const fieldTab = page.getByRole("tab", { name: /字段信息/ });
    const ddlTab = page.getByRole("tab", { name: "建表语句" });
    await expect(fieldTab).toHaveAttribute("aria-selected", "true");
    await expect(fieldTab.locator("svg")).toHaveCount(1);
    await expect(fieldTab.locator(".asset-detail-tab-count")).toHaveText("11");
    await expect(ddlTab.locator("svg")).toHaveCount(1);
    if (auth === "guest") {
      await page.locator(".main-inner").evaluate((element) => element.scrollTo(0, 0));
      await page.screenshot({ path: testInfo.outputPath("asset-detail-fields-1280.png"), fullPage: true });
      await page.getByRole("button", { name: "复制表名" }).click();
      await expect.poll(() => page.evaluate(() => sessionStorage.getItem("dap-test-copied-text"))).toBe(`dwm.${EXISTING_ASSET}`);
      await expect(page.getByRole("button", { name: "已复制" }).first()).toBeVisible();
    }
    await fieldTab.focus();
    await page.keyboard.press("ArrowRight");
    await expect(ddlTab).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(ddlTab).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".ddl")).toBeVisible();
    await expect(page.locator(".ddl")).toContainText("CREATE TABLE");
    if (auth === "guest") {
      await page.locator(".main-inner").evaluate((element) => element.scrollTo(0, 0));
      await page.screenshot({ path: testInfo.outputPath("asset-detail-ddl-1280.png"), fullPage: true });
      await page.getByRole("button", { name: "复制 DDL" }).click();
      await expect.poll(() => page.evaluate(() => sessionStorage.getItem("dap-test-copied-text"))).toContain("CREATE TABLE");
    }
    await fieldTab.click();
    await expect(page.locator("table.fields tbody tr").first()).toBeVisible();
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await closeMobileSidebar(page);
  const widths = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    fieldsClient: document.querySelector("table.fields")?.parentElement?.clientWidth ?? 0,
    fieldsScroll: document.querySelector("table.fields")?.parentElement?.scrollWidth ?? 0,
    fieldsOverflow: getComputedStyle(document.querySelector("table.fields")!.parentElement!).overflowX,
  }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
  expect(widths.fieldsOverflow).toBe("auto");
  expect(widths.fieldsScroll).toBeGreaterThanOrEqual(widths.fieldsClient);
  await page.screenshot({ path: testInfo.outputPath("asset-detail-fields-390.png"), fullPage: true });
  const tabs = page.locator(".asset-detail-tabs");
  await tabs.scrollIntoViewIfNeeded();
  await tabs.screenshot({ path: testInfo.outputPath("asset-detail-tabs-390.png") });
});

test("asset detail tabs preserve URL state across reload and browser history", async ({ page }) => {
  await setMockAuth(page, "guest");
  await page.goto(`${ASSET_PATH}?layout=list`);
  const assetRow = page.locator(".asset-page table.dt tbody tr").filter({ hasText: EXISTING_ASSET });
  await expect(assetRow).toBeVisible({ timeout: 20_000 });
  await assetRow.click();
  await expect(page.locator(".dh-en")).toHaveText(EXISTING_ASSET);

  const fieldTab = page.getByRole("tab", { name: /字段信息/ });
  const ddlTab = page.getByRole("tab", { name: "建表语句" });
  await fieldTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(ddlTab).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(ddlTab).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(/[?&]tab=ddl(?:&|$)/);

  await page.reload();
  await expect(page.getByRole("tab", { name: "建表语句" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".ddl")).toBeVisible();

  await page.goBack();
  await expect(page.locator(".asset-page table.dt tbody tr").filter({ hasText: EXISTING_ASSET })).toBeVisible();
  await expect(page).not.toHaveURL(/tab=ddl/);
  await page.goForward();
  await expect(page.getByRole("tab", { name: "建表语句" })).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(/[?&]tab=ddl(?:&|$)/);
});

test("admin can edit details and choose to keep or discard dirty changes", async ({ page }) => {
  await openAssetDetail(page, "admin");
  await page.getByRole("button", { name: "编辑表" }).click();
  await expect(page.getByRole("heading", { name: "编辑数据表" })).toBeVisible();

  const tableName = page.getByLabel("表名（英文）");
  await tableName.fill("dwm_pr6_unsaved_359");
  const actionBar = page.locator(".form-action-bar");
  await actionBar.getByRole("button", { name: "取消" }).click();
  let dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "继续编辑" }).click();
  await expect(page.getByRole("heading", { name: "编辑数据表" })).toBeVisible();
  await expect(tableName).toHaveValue("dwm_pr6_unsaved_359");

  await actionBar.getByRole("button", { name: "取消" }).click();
  dialog = page.getByRole("alertdialog");
  await dialog.getByRole("button", { name: "放弃修改" }).click();
  await expect(page.locator(".dh-en")).toHaveText(EXISTING_ASSET);
  await expect(page).toHaveURL(new RegExp(`${ASSET_PATH}/${EXISTING_ASSET}`));

  await page.getByRole("button", { name: "编辑表" }).click();
  await page.getByLabel("负责人").fill("PR6 smoke owner");
  await page.locator(".form-action-bar").getByRole("button", { name: "保存" }).click();
  await expect(page.locator(".dh-en")).toHaveText(EXISTING_ASSET);
  await expect(page.locator(".dh-meta")).toContainText("PR6 smoke owner");
  await expect(page).toHaveURL(new RegExp(`${ASSET_PATH}/${EXISTING_ASSET}`));
});

test("admin detail stays usable across light/dark and desktop-to-phone viewports", async ({ page }, testInfo: TestInfo) => {
  await openAssetDetail(page, "admin");
  const mode = page.locator("html");

  for (const theme of ["light", "dark"] as const) {
    const currentMode = await mode.getAttribute("data-mode");
    if (currentMode !== theme) {
      await page.getByRole("button", { name: currentMode === "dark" ? "切换到浅色主题" : "切换到深色主题" }).click();
    }
    await expect(mode).toHaveAttribute("data-mode", theme);
    await expect(page.getByRole("tab", { name: /字段信息/ })).toHaveCSS(
      "color",
      theme === "light" ? "rgb(15, 159, 120)" : "rgb(16, 185, 129)",
    );

    for (const width of [960, 768, 480, 390]) {
      await page.setViewportSize({ width, height: 844 });
      if (width <= 768) await closeMobileSidebar(page);
      const metrics = await page.evaluate(() => {
        const table = document.querySelector("table.fields");
        const wrapper = table?.parentElement;
        return {
          viewport: window.innerWidth,
          document: document.documentElement.scrollWidth,
          overflow: wrapper ? getComputedStyle(wrapper).overflowX : "missing",
          client: wrapper?.clientWidth ?? 0,
          scroll: wrapper?.scrollWidth ?? 0,
        };
      });
      expect(metrics.document).toBeLessThanOrEqual(metrics.viewport);
      expect(metrics.overflow).toBe("auto");
      expect(metrics.scroll).toBeGreaterThanOrEqual(metrics.client);
      if (width === 960 || width === 390) {
        await page.locator(".main-inner").evaluate((element) => element.scrollTo(0, 0));
        await page.screenshot({ path: testInfo.outputPath(`asset-detail-${theme}-${width}.png`), fullPage: true });
      }
    }
  }
});

test("admin can create, validate, edit fields, and delete an asset with keyword confirmation", async ({ page }, testInfo: TestInfo) => {
  await setMockAuth(page, "admin");
  await page.goto(`${ASSET_PATH}?layout=list`);
  await expect(page.locator(".asset-page table.dt tbody tr").first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "新增表" }).first().click();
  await expect(page.getByRole("heading", { name: "新增数据表" })).toBeVisible();

  const save = page.locator(".form-action-bar").getByRole("button", { name: "保存" });
  await save.click();
  await expect(page.locator(".err-banner")).toContainText("请输入表英文名");
  await expect(page.locator(".err-banner")).toContainText("请选择主题域。");
  await expect(page.locator(".err-banner")).toContainText("存在未填写字段名的字段。");

  const suffix = `${Date.now()}`.slice(-8);
  const tableName = `dwm_pr6_adapter_${suffix}`;
  const tableCn = `PR6 adapter ${suffix}`;
  let created = false;

  try {
    await page.getByPlaceholder("例如：dwm_xxx_detail_di").fill(tableName);
    await page.getByPlaceholder("例如：支付交易明细中间表").fill(tableCn);

    const domainField = page.locator(".form-grid .fl").filter({ hasText: "主题域" });
    const domainControl = domainField.getByRole("combobox");
    await chooseOption(page, domainControl, "交易");
    await chooseOption(page, domainControl, "请选择主题域");
    await save.click();
    await expect(page.locator(".err-banner")).toContainText("请选择主题域。");
    await chooseOption(page, domainControl, "交易");

    let rows = page.locator(".fields-edit tbody tr");
    await expect(rows).toHaveCount(1);
    const firstRow = rows.nth(0);
    await firstRow.getByLabel("字段1字段名").fill("id");
    await firstRow.getByLabel("字段1中文注释").fill("主键");
    await chooseOption(page, firstRow.getByRole("combobox", { name: "字段1数据类型" }), "NUMERIC");
    await firstRow.getByPlaceholder(/precision/).fill("12");
    await firstRow.getByPlaceholder(/scale/).fill("2");
    await firstRow.getByRole("button", { name: "设为主键 id" }).click();
    await expect(firstRow.getByRole("button", { name: "允许字段可空 id" })).toBeDisabled();
    await firstRow.getByLabel("字段1小数位").fill("13");
    await save.click();
    await expect(page.locator(".err-banner")).toContainText("NUMERIC scale 不能大于 precision");
    await firstRow.getByLabel("字段1小数位").fill("2");

    await page.getByRole("button", { name: "新增字段" }).click();
    rows = page.locator(".fields-edit tbody tr");
    await expect(rows).toHaveCount(2);
    const secondRow = rows.nth(1);
    await secondRow.getByLabel("字段2字段名").fill("id");
    await secondRow.getByLabel("字段2中文注释").fill("重复字段");
    await save.click();
    await expect(page.locator(".err-banner")).toContainText("字段 id 重复。");
    await secondRow.getByLabel("字段2字段名").fill("created_at");
    await secondRow.getByLabel("字段2中文注释").fill("创建时间");
    await secondRow.getByLabel("字段2字段名").fill("bad-name");
    await save.click();
    await expect(page.locator(".err-banner")).toContainText("字段 bad-name 格式不正确。");
    await secondRow.getByLabel("字段2字段名").fill("created_at");

    const tableNameInput = page.getByLabel("表名（英文）");
    await tableNameInput.fill(EXISTING_ASSET);
    await save.click();
    await expect(page.locator(".err-banner")).toContainText(`表名 ${EXISTING_ASSET} 已存在。`);
    await tableNameInput.fill("dwm-invalid-name");
    await save.click();
    await expect(page.locator(".err-banner")).toContainText("表英文名只允许字母、数字和下划线，且必须以字母开头。");
    await tableNameInput.fill(tableName);

    await secondRow.getByRole("button", { name: "上移字段 created_at" }).click();
    await expect(rows.nth(0).getByLabel("字段1字段名")).toHaveValue("created_at");
    await rows.nth(1).getByRole("button", { name: "删除字段 id" }).click();
    await expect(rows).toHaveCount(1);
    await page.getByRole("button", { name: "新增字段" }).click();
    rows = page.locator(".fields-edit tbody tr");
    await expect(rows).toHaveCount(2);
    const restoredKey = rows.nth(1);
    await restoredKey.getByLabel("字段2字段名").fill("id");
    await restoredKey.getByLabel("字段2中文注释").fill("主键");
    await chooseOption(page, restoredKey.getByRole("combobox", { name: "字段2数据类型" }), "NUMERIC");
    await restoredKey.getByRole("button", { name: "设为主键 id" }).click();
    await expect(restoredKey.getByRole("button", { name: "允许字段可空 id" })).toBeDisabled();
    await page.locator(".main-inner").evaluate((element) => element.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath("asset-editor-1280.png"), fullPage: true });
    const mode = page.locator("html");
    for (const theme of ["light", "dark"] as const) {
      const currentMode = await mode.getAttribute("data-mode");
      if (currentMode !== theme) {
        await page.getByRole("button", { name: currentMode === "dark" ? "切换到浅色主题" : "切换到深色主题" }).click();
      }
      await expect(mode).toHaveAttribute("data-mode", theme);

      for (const width of [960, 768, 480, 390]) {
        await page.setViewportSize({ width, height: 844 });
        if (width <= 768) await closeMobileSidebar(page);
        const metrics = await page.evaluate(() => ({
          viewport: window.innerWidth,
          document: document.documentElement.scrollWidth,
          rowDisplay: getComputedStyle(document.querySelector(".mobile-edit-table tbody tr")!).display,
        }));
        expect(metrics.document).toBeLessThanOrEqual(metrics.viewport);
        expect(metrics.rowDisplay).toBe(width <= 768 ? "grid" : "table-row");
        if (width === 960 || width === 390) {
          await page.locator(".main-inner").evaluate((element) => element.scrollTo(0, 0));
          await page.screenshot({ path: testInfo.outputPath(`asset-editor-${theme}-${width}.png`), fullPage: true });
        }
      }
    }
    if (await mode.getAttribute("data-mode") !== "light") {
      await page.getByRole("button", { name: "切换到浅色主题" }).click();
    }
    await page.setViewportSize({ width: 1280, height: 900 });

    await save.click();
    await expect(page.locator(".dh-en")).toHaveText(tableName, { timeout: 20_000 });
    created = true;
    await expect(page.locator(".dh-cn")).toContainText(tableCn);
    await expect(page.locator("table.fields tbody")).toContainText("created_at");
    await expect(page.locator("table.fields tbody")).toContainText("id");

    await deleteAssetFromEditor(page, tableName);
    created = false;
  } finally {
    if (created) {
      try {
        await deleteAssetFromEditor(page, tableName);
      } catch {
        // Keep the original assertion failure while avoiding residual mock data.
      }
    }
  }
});
