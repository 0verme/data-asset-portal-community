import { expect, test, type Page } from "@playwright/test";

async function setMockAuth(page: Page, mode: "guest" | "admin"): Promise<void> {
  await page.addInitScript((authMode) => {
    localStorage.removeItem("dap_auth");
    if (authMode === "guest") return;
    localStorage.setItem("dap_auth", JSON.stringify({ role: "admin", user: "admin", name: "管理员" }));
  }, mode);
}

test("field mapping filters and pagination use adapter controls", async ({ page }) => {
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

  const nativeSelect = page.locator("select.sel").first();
  await expect(nativeSelect).toBeVisible();
  const nativeArrow = await nativeSelect.evaluate((element) => ({
    tagName: element.tagName,
    backgroundImage: getComputedStyle(element).backgroundImage,
    svgCount: element.querySelectorAll("svg").length,
  }));
  expect(nativeArrow.tagName).toBe("SELECT");
  expect(nativeArrow.backgroundImage).toContain("linear-gradient");
  expect(nativeArrow.svgCount).toBe(0);

  const pageSize = page.getByRole("combobox", { name: "每页条数" });
  if (await pageSize.count()) {
    await expect(pageSize).toHaveClass(/dap-ui-select/);
    await expect(pageSize).toHaveClass(/fm-page-size/);
    await expect(pageSize).not.toHaveClass(/\bsel\b/);
    const pageSizeArrow = await pageSize.evaluate((element) => ({
      backgroundImage: getComputedStyle(element).backgroundImage,
      svgCount: Array.from(element.querySelectorAll("svg")).filter((svg) => {
        const rect = svg.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }).length,
      width: getComputedStyle(element).width,
    }));
    expect(pageSizeArrow.backgroundImage).toBe("none");
    expect(pageSizeArrow.svgCount).toBe(1);
    expect(pageSizeArrow.width).toBe("74px");
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
