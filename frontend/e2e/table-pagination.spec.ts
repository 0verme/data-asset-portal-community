import { expect, test, type Page, type TestInfo } from "@playwright/test";

const fixturePager = (page: Page) => page.getByRole("navigation", { name: "分页组件测试" });

async function openFixture(page: Page, query: string): Promise<void> {
  await page.goto(`/__table-pagination${query}`);
  await expect(fixturePager(page)).toBeVisible();
}

async function setAdmin(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem("dap_auth", JSON.stringify({ role: "admin", user: "pagination-e2e", name: "分页测试" }));
  });
}

async function expectPagerDisabled(page: Page): Promise<void> {
  const pager = fixturePager(page);
  await expect(pager.getByRole("button", { name: "上一页" })).toBeDisabled();
  await expect(pager.getByRole("button", { name: "下一页" })).toBeDisabled();
}

test("TablePagination handles empty, one-page, two-page, multipage and page-size changes", async ({ page }) => {
  await openFixture(page, "?total=0&page=9&pageSize=20");
  let pager = fixturePager(page);
  await expect(pager).toContainText("第 0–0 条 / 共 0 条");
  await expect(pager.locator(".dap-table-pagination__page-index")).toHaveText("1 / 1");
  await expectPagerDisabled(page);

  await openFixture(page, "?total=1&page=1&pageSize=20");
  pager = fixturePager(page);
  await expect(pager).toContainText("第 1–1 条 / 共 1 条");
  await expectPagerDisabled(page);

  await openFixture(page, "?total=21&page=1&pageSize=20");
  pager = fixturePager(page);
  await expect(pager).toContainText("第 1–20 条 / 共 21 条");
  await expect(pager.getByRole("button", { name: "上一页" })).toBeDisabled();
  await pager.getByRole("button", { name: "下一页" }).click();
  await expect(pager.locator(".dap-table-pagination__page-index")).toHaveText("2 / 2");
  await expect(pager).toContainText("第 21–21 条 / 共 21 条");
  await expect(pager.getByRole("button", { name: "下一页" })).toBeDisabled();
  await expect(pager.getByRole("button", { name: "上一页" })).toBeEnabled();

  await openFixture(page, "?total=2300&page=115&pageSize=20");
  pager = fixturePager(page);
  await expect(pager).toContainText("第 2281–2300 条 / 共 2300 条");
  await expect(pager.locator(".dap-table-pagination__page-index")).toHaveText("115 / 115");
  const pageSize = pager.getByRole("combobox", { name: "每页条数" });
  await expect(pageSize).toContainText("20");
  await pageSize.click();
  await page.getByRole("option", { name: "50", exact: true }).click();
  await expect(pager.getByRole("combobox", { name: "每页条数" })).toContainText("50");
  await expect(pager.locator(".dap-table-pagination__page-index")).toHaveText("1 / 46");
  await expect(pager).toContainText("第 1–50 条 / 共 2300 条");

  await openFixture(page, "?total=200&page=2&pageSize=73");
  pager = fixturePager(page);
  await expect(pager.getByRole("combobox", { name: "每页条数" })).toContainText("73");
  await expect(pager.locator(".dap-table-pagination__page-index")).toHaveText("2 / 3");
});

test("loading is announced while errors disable pagination controls", async ({ page }) => {
  await openFixture(page, "?total=21&loading=true");
  let pager = fixturePager(page);
  await expect(pager).toHaveAttribute("aria-busy", "true");
  await expect(page.getByRole("status")).toContainText("正在加载测试数据");
  await expect(pager.getByRole("combobox", { name: "每页条数" })).toBeEnabled();
  await expect(pager.getByRole("button", { name: "上一页" })).toBeDisabled();
  await expect(pager.getByRole("button", { name: "下一页" })).toBeEnabled();

  await openFixture(page, "?total=21&error=true");
  pager = fixturePager(page);
  await expect(page.getByRole("alert")).toContainText("分页数据加载失败");
  await expect(pager.getByRole("combobox", { name: "每页条数" })).toBeDisabled();
  await expectPagerDisabled(page);
});

test("completed paginated business lists share the adapter without changing their route contracts", async ({ page }, testInfo: TestInfo) => {
  await setAdmin(page);
  const pages = [
    { path: "/data-warehouse?layout=list", label: "数据仓库资产表分页" },
    { path: "/field-mapping", label: "字段映射分页" },
    { path: "/system-management/operation-logs", label: "操作日志分页" },
    { path: "/upstream?view=list", label: "上游系统分页" },
    { path: "/push?view=list", label: "下游系统分页" },
  ];

  for (const [index, item] of pages.entries()) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(item.path);
    const pager = page.getByRole("navigation", { name: item.label });
    await expect(pager).toBeVisible({ timeout: 20_000 });
    await expect(pager).not.toHaveAttribute("aria-busy", "true", { timeout: 20_000 });
    await expect(pager.getByRole("combobox", { name: "每页条数" })).toBeVisible();
    await expect(pager.getByRole("button", { name: "上一页" })).toBeVisible();
    await expect(pager.getByRole("button", { name: "下一页" })).toBeVisible();
    expect(await pager.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await pager.scrollIntoViewIfNeeded();
    await pager.screenshot({ path: testInfo.outputPath(`after-pagination-footer-${index}.png`) });
    await page.screenshot({ path: testInfo.outputPath(`after-paginated-page-${index}.png`), fullPage: true });
  }
});

test("pagination groups remain intact at mobile/tablet/desktop widths in light and dark themes", async ({ page }, testInfo: TestInfo) => {
  await page.addInitScript(() => {
    const theme = new URLSearchParams(window.location.search).get("theme");
    if (theme === "light" || theme === "dark") localStorage.setItem("dap-theme", theme);
  });
  const screenshots: Array<{ theme: "light" | "dark"; width: number }> = [
    { theme: "light", width: 1440 },
    { theme: "light", width: 768 },
    { theme: "light", width: 390 },
    { theme: "dark", width: 1440 },
    { theme: "dark", width: 768 },
    { theme: "dark", width: 390 },
  ];

  for (const { theme, width } of screenshots) {
    await page.setViewportSize({ width, height: 860 });
    await openFixture(page, `?theme=${theme}&total=2300&page=4&pageSize=20`);
    const pager = fixturePager(page);
    await expect.poll(() => page.locator("html").getAttribute("data-theme")).toBe(theme);

    const geometry = await pager.evaluate((element) => {
      const rect = (selector: string) => {
        const node = element.querySelector<HTMLElement>(selector);
        if (!node) throw new Error(`Missing pagination element: ${selector}`);
        const box = node.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height };
      };
      const childCenters = (selector: string) => Array.from(element.querySelector(selector)?.children ?? [])
        .map((child) => {
          const box = child.getBoundingClientRect();
          return box.y + box.height / 2;
        });
      const range = rect(".dap-table-pagination__range");
      const controls = rect(".dap-table-pagination__controls");
      return {
        viewport: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        pagerWidth: element.clientWidth,
        pagerScrollWidth: element.scrollWidth,
        range,
        controls,
        rangeCenter: range.y + range.height / 2,
        controlsCenter: controls.y + controls.height / 2,
        sizeRows: childCenters(".dap-table-pagination__size-group"),
        pageRows: childCenters(".dap-table-pagination__page-controls"),
      };
    });
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport);
    expect(geometry.pagerScrollWidth).toBeLessThanOrEqual(geometry.pagerWidth);
    expect(geometry.range.height).toBeLessThanOrEqual(22);
    expect(Math.max(...geometry.sizeRows) - Math.min(...geometry.sizeRows)).toBeLessThanOrEqual(1);
    expect(Math.max(...geometry.pageRows) - Math.min(...geometry.pageRows)).toBeLessThanOrEqual(1);
    if (width > 820) {
      expect(Math.abs(geometry.rangeCenter - geometry.controlsCenter)).toBeLessThanOrEqual(1);
    } else {
      expect(geometry.controls.y).toBeGreaterThan(geometry.range.y);
    }

    await page.screenshot({
      path: testInfo.outputPath(`table-pagination-${theme}-${width}.png`),
      fullPage: true,
    });
  }
});
