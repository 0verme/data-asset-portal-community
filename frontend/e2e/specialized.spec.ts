import { expect, test, type Page } from "@playwright/test";

async function setMockAuth(page: Page, mode: "guest" | "admin"): Promise<void> {
  await page.addInitScript((authMode) => {
    localStorage.removeItem("dap_auth");
    if (authMode === "guest") return;
    localStorage.setItem("dap_auth", JSON.stringify({ role: "admin", user: "admin", name: "管理员" }));
  }, mode);
}

test("field mapping filters and pagination use adapter controls", async ({ page }, testInfo) => {
  await setMockAuth(page, "admin");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/field-mapping");

  await expect(page.locator(".fm-card").first()).toBeVisible({ timeout: 20_000 });
  const toggle = page.locator(".fm-toggle");
  const srcTable = page.getByLabel("源系统表名");
  if (!(await srcTable.isVisible())) {
    await toggle.click();
  }
  await expect(srcTable).toHaveClass(/dap-ui-input/);
  await expect(page.getByLabel("DWF 字段名")).toHaveClass(/dap-ui-input/);
  await expect(page.getByRole("button", { name: "查询" })).toHaveClass(/dap-ui-button/);
  await expect(page.getByRole("button", { name: "重置" })).toHaveClass(/dap-ui-button/);

  const sourceSystemSelect = page.getByRole("combobox", { name: "源系统" });
  await expect(sourceSystemSelect).toBeVisible();
  await expect(sourceSystemSelect).toHaveClass(/dap-ui-select/);
  await expect(sourceSystemSelect).not.toHaveClass(/\bsel\b/);
  await page.screenshot({ path: testInfo.outputPath("field-mapping-source-system-kumo-light.png"), fullPage: true });
  const sourceArrow = await sourceSystemSelect.evaluate((element) => ({
    backgroundImage: getComputedStyle(element).backgroundImage,
    visibleSvgCount: Array.from(element.querySelectorAll("svg")).filter((svg) => {
      const rect = svg.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }).length,
  }));
  expect(sourceArrow.backgroundImage).toBe("none");
  expect(sourceArrow.visibleSvgCount).toBe(1);

  const nativeSelect = page.locator("select.sel").first();
  await expect(nativeSelect).toBeVisible();
  await expect(page.locator("select.sel")).toHaveCount(1);
  const nativeArrow = await nativeSelect.evaluate((element) => ({
    tagName: element.tagName,
    backgroundImage: getComputedStyle(element).backgroundImage,
    svgCount: element.querySelectorAll("svg").length,
  }));
  expect(nativeArrow.tagName).toBe("SELECT");
  expect(nativeArrow.backgroundImage).toContain("linear-gradient");
  expect(nativeArrow.svgCount).toBe(0);

  await expect(page.locator(".fm-system")).toHaveCount(12);
  await sourceSystemSelect.click();
  await expect(page.getByRole("listbox").getByRole("option")).toHaveCount(9);
  await page.getByRole("option", { name: "商品中心 · PIM", exact: true }).click();
  await expect(sourceSystemSelect).toContainText("商品中心 · PIM");
  await page.getByRole("button", { name: "查询" }).click();
  await expect(page.locator(".fm-system")).toHaveCount(2);
  await expect(page.locator(".fm-system").first()).toContainText("商品中心 · PIM");
  await sourceSystemSelect.click();
  await page.getByRole("listbox").getByRole("option", { name: "全部", exact: true }).click();
  await expect(sourceSystemSelect).toContainText("全部");
  await page.getByRole("button", { name: "查询" }).click();
  await expect(page.locator(".fm-system")).toHaveCount(12);
  await page.getByRole("button", { name: "重置" }).click();
  await expect(sourceSystemSelect).toContainText("全部");
  await page.getByRole("button", { name: "查询" }).click();
  await expect(page.locator(".fm-system")).toHaveCount(12);

  const pageSize = page.getByRole("combobox", { name: "每页条数" });
  if (await pageSize.count()) {
    await expect(pageSize).toHaveClass(/dap-ui-select/);
    await expect(pageSize).toHaveClass(/dap-table-pagination__select/);
    await expect(pageSize).not.toHaveClass(/\bsel\b/);
    const pageSizeArrow = await pageSize.evaluate((element) => ({
      backgroundImage: getComputedStyle(element).backgroundImage,
      svgCount: Array.from(element.querySelectorAll("svg")).filter((svg) => {
        const rect = svg.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }).length,
    }));
    expect(pageSizeArrow.backgroundImage).toBe("none");
    expect(pageSizeArrow.svgCount).toBe(1);
    expect(await page.locator(".dap-table-pagination__select").evaluate((element) => getComputedStyle(element).width)).toBe("72px");
    await expect(page.getByRole("button", { name: "下一页" })).toHaveClass(/dap-ui-button/);
  }
});

test("lineage chrome uses adapters and keeps the canvas mounted", async ({ page }, testInfo) => {
  await setMockAuth(page, "admin");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/lineage");

  await expect(page.locator(".page-title")).toContainText("血缘分析", { timeout: 20_000 });
  await expect(page.getByRole("combobox", { name: "血缘视图" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "血缘方向" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "血缘层级" })).toBeVisible();
  await expect(page.getByLabel("血缘节点名称")).toHaveClass(/dap-ui-input/);
  await expect(page.getByRole("button", { name: /刷新|加载中/ })).toHaveClass(/dap-ui-button/);
  await expect(page.getByRole("button", { name: "查询" })).toHaveClass(/dap-ui-button/);
  await expect(page.getByRole("button", { name: "清空" })).toHaveClass(/dap-ui-button/);

  const lineageSelects = [
    page.getByRole("combobox", { name: "血缘视图" }),
    page.getByRole("combobox", { name: "血缘方向" }),
    page.getByRole("combobox", { name: "血缘层级" }),
  ];
  for (const select of lineageSelects) {
    await expect(select).toHaveClass(/dap-ui-select/);
    await expect(select).not.toHaveClass(/\bsel\b/);
    const geometry = await select.evaluate((element) => {
      const caret = element.querySelector("svg");
      const caretBox = caret?.getBoundingClientRect();
      return {
        backgroundImage: getComputedStyle(element).backgroundImage,
        paddingRight: getComputedStyle(element).paddingRight,
        visibleSvgCount: Array.from(element.querySelectorAll("svg")).filter((svg) => {
          const rect = svg.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }).length,
        caretWidth: caretBox?.width ?? 0,
        caretHeight: caretBox?.height ?? 0,
      };
    });
    expect(geometry.backgroundImage).toBe("none");
    expect(geometry.paddingRight).not.toBe("36px");
    expect(geometry.visibleSvgCount).toBe(1);
    expect(geometry.caretWidth).toBeGreaterThan(0);
    expect(geometry.caretHeight).toBeGreaterThan(0);
  }

  const view = lineageSelects[0];
  await view?.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("option")).toHaveCount(2);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("option")).toHaveCount(0);
  await expect(page.locator(".lineage-canvas, .lineage-viewer").first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("lineage-select-after.png"), fullPage: true });
});

test("lineage asset navigation filters, expands, selects, and follows graph state", async ({ page }, testInfo) => {
  await setMockAuth(page, "admin");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/lineage");

  await expect(page.locator(".page-title")).toContainText("血缘分析", { timeout: 20_000 });
  const search = page.getByLabel("Schema 名和表名搜索");
  await expect(search).toBeVisible();
  await expect(search).toHaveAttribute("type", "search");
  await expect(page.locator(".lineage-asset-count")).toContainText("5 张表");

  const schema = (name: string) => page.locator(".lineage-schema-heading").filter({ hasText: name });
  const unclassified = schema("未分类");
  await expect(page.locator(".lineage-schema-heading")).toHaveCount(1);
  await expect(unclassified).toHaveAttribute("aria-expanded", "true");

  await search.fill("DWD");
  await expect(page.locator(".lineage-schema-heading")).toHaveCount(1);
  await expect(unclassified).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("button", { name: /DWD_TRADE_ORDER/ })).toBeVisible();
  await search.fill("");
  await expect(page.locator(".lineage-schema-heading")).toHaveCount(1);
  await expect(unclassified).toHaveAttribute("aria-expanded", "true");

  await page.getByRole("button", { name: "全部折叠" }).click();
  await expect(page.locator(".lineage-schema-heading[aria-expanded='true']")).toHaveCount(0);
  await page.getByRole("button", { name: "全部展开" }).click();
  await expect(page.locator(".lineage-schema-heading[aria-expanded='true']")).toHaveCount(1);
  await page.getByRole("button", { name: "全部折叠" }).click();
  await expect(page.locator(".lineage-schema-heading[aria-expanded='true']")).toHaveCount(0);
  await search.fill("no-match");
  await expect(page.locator(".lineage-asset-empty")).toContainText("没有匹配的 Schema 或表名");
  await search.fill("");

  await unclassified.click();
  await page.getByRole("button", { name: /DWD_TRADE_ORDER/ }).click();
  await expect(page.locator(".lineage-detail h2")).toHaveText("DWD_TRADE_ORDER");
  await expect.poll(async () => page.locator("lineage-viewer").evaluate((viewer) => (
    viewer as HTMLElement & { selectedNodeId?: string | null }
  ).selectedNodeId)).toBe("table:dwd:DWD_TRADE_ORDER");
  await expect(page.getByRole("button", { name: /DWD_TRADE_ORDER/ })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "全部折叠" }).click();
  await page.locator("lineage-viewer").locator('g.node[data-node-id="table:dwm:DWM_TRADE_ORDER_DETAIL_DI"]').click({ force: true });
  await expect(page.locator(".lineage-detail h2")).toHaveText("DWM_TRADE_ORDER_DETAIL_DI");
  await expect(unclassified).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("button", { name: /DWM_TRADE_ORDER_DETAIL_DI/ })).toHaveAttribute("aria-pressed", "true");

  const snapshotInfo = page.locator(".lineage-snapshot-info");
  await expect(snapshotInfo).toHaveJSProperty("open", false);
  await snapshotInfo.locator("summary").click();
  await expect(snapshotInfo).toContainText("retail-demo-20260720");
  await expect(snapshotInfo).toContainText("节点数量");
  await expect(snapshotInfo).toContainText("关系数量");
  await page.screenshot({ path: testInfo.outputPath("lineage-asset-navigation-after.png"), fullPage: true });

  await page.getByLabel("血缘节点名称").fill("POS_RECEIPT");
  await page.getByRole("button", { name: "查询" }).click();
  await expect(page.locator(".lineage-detail h2")).toHaveText("POS_RECEIPT");
  await expect.poll(async () => page.locator("lineage-viewer").evaluate((viewer) => (
    viewer as HTMLElement & { selectedNodeId?: string | null }
  ).selectedNodeId)).toBe("table:pos:POS_RECEIPT");
  await expect(page.getByRole("button", { name: /POS_RECEIPT/ })).toHaveAttribute("aria-pressed", "true");

  const direction = page.getByRole("combobox", { name: "血缘方向" });
  await direction.focus();
  await page.keyboard.press("ArrowDown");
  await page.getByRole("option", { name: "仅上游" }).click();
  const depth = page.getByRole("combobox", { name: "血缘层级" });
  await depth.focus();
  await page.keyboard.press("ArrowDown");
  await page.getByRole("option", { name: "3 层" }).click();
  await page.getByRole("button", { name: /刷新|加载中/ }).click();
  await expect(page.locator(".lineage-detail h2")).toHaveText("POS_RECEIPT");
  await expect.poll(async () => page.locator("lineage-viewer").evaluate((viewer) => (
    viewer as HTMLElement & { selectedNodeId?: string | null }
  ).selectedNodeId)).toBe("table:pos:POS_RECEIPT");
  await expect(page.getByRole("button", { name: /POS_RECEIPT/ })).toHaveAttribute("aria-pressed", "true");
});
