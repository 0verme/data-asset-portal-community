import { expect, test } from "@playwright/test";

const fixturePath = "/__kumo-spike";
const existingRoutes = [
  { name: "portal", path: "/", marker: "一个入口，搜索系统、字段、词根、指标、报表、API、资产、下游推送和码值表" },
  { name: "assets", path: "/data-warehouse", marker: "共 224 张表" },
  { name: "dense table", path: "/field-mapping", marker: "查询源字段与目标字段之间的映射关系" },
  { name: "form", path: "/upstream/new", marker: "返回上游卸数列表" },
  { name: "system/admin", path: "/system-management/users", marker: "共 8 个账号" },
  { name: "lineage", path: "/lineage", marker: "retail-demo-20260720" },
] as const;

async function openFixture(page: import("@playwright/test").Page) {
  await page.goto(fixturePath);
  await expect(page.getByTestId("kumo-spike")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("dap_auth", JSON.stringify({ role: "admin", user: "admin", name: "管理员" }));
  });
});

test("fixture renders pinned Kumo primitives with DAP content and no runtime errors", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await openFixture(page);

  await expect(page.getByRole("heading", { name: "Kumo × 数据资产审批" })).toBeVisible();
  await expect(page.getByRole("button", { name: "保存字段映射" })).toBeVisible();
  await expect(page.getByLabel("只读 JDBC URL")).toHaveAttribute("readonly", "");
  await expect(page.locator('input[aria-label="禁用的数据连接标识"]')).toBeDisabled();
  await expect(page.getByRole("switch", { name: "只读策略（disabled）" })).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: "已停用映射" })).toBeDisabled();
  await expect(page.getByRole("tab", { name: "数据资产" })).toBeVisible();
  await expect(page.getByRole("table", { name: "字段映射兼容性表" }).locator("tbody tr")).toHaveCount(4);
  await expect(page.getByText("warning · 待复核")).toBeVisible();
  await expect(page.getByText("danger/error · 失败")).toBeVisible();
  await expect(page.getByRole("status", { name: "正在加载字段" })).toBeVisible();
  await expect(page.getByText("没有待处理字段")).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("Select, Combobox, DropdownMenu, Tooltip, table pagination, and Popover accept keyboard input", async ({ page, browserName }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await openFixture(page);

  const select = page.getByRole("combobox", { name: "上游系统" });
  const currentOption = page.getByRole("option", { name: /生产数仓/ });
  const stageOption = page.getByRole("option", { name: /预发布/ });
  if (browserName === "webkit") {
    await select.click();
    await expect(stageOption).toBeVisible();
    await stageOption.click();
    await expect(select).toHaveText("stage");
  } else {
    await select.focus();
    await page.keyboard.press("ArrowDown");
    await expect(currentOption).toHaveAttribute("data-highlighted", "");
    await page.keyboard.press("ArrowDown");
    await expect(stageOption).toHaveAttribute("data-highlighted", "");
    await page.keyboard.press("Enter");
    await expect(select).toHaveText("stage");
  }
  await page.keyboard.press("Escape");

  const combobox = page.getByRole("combobox", { name: "指标维护员 Combobox" });
  await combobox.fill("schema.table");
  await expect(page.getByRole("option", { name: "schema.table_name" })).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(combobox).toHaveValue("schema.table_name");

  await page.getByTestId("open-kumo-menu").click();
  await expect(page.getByRole("menuitem", { name: "查看字段映射" })).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { name: "字段映射" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("menu")).toBeHidden();

  const tooltipTrigger = page.getByRole("button", { name: "Tooltip 键盘触发器" });
  await tooltipTrigger.focus();
  await expect(page.getByText("Tooltip 可通过键盘 Tab 聚焦触发器访问")).toBeVisible();
  await page.keyboard.press("Tab");

  await page.getByTestId("open-kumo-popover").click();
  await expect(page.getByText("字段详情")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText("字段详情")).toBeHidden();

  await page.getByRole("button", { name: "下一页" }).click();
  await expect(page.getByText("第 2 页 · 11-20")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "分页" })).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("Dialog opens, closes with Escape, and restores trigger focus", async ({ page }) => {
  await openFixture(page);
  const trigger = page.getByTestId("open-kumo-dialog");
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "字段映射确认" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(":focus")).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).overflow)).toBe("hidden");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("Kumo Dialog keeps keyboard focus within the open modal", async ({ page, browserName }) => {
  test.fail(browserName === "webkit", "Kumo 2.14.0 lets Tab escape from its Dialog focus guard in Desktop Safari; do not migrate DAP dialogs until focus trapping is fixed.");
  await openFixture(page);
  await page.getByTestId("open-kumo-dialog").click();
  const dialog = page.getByRole("dialog", { name: "字段映射确认" });
  const closeButton = page.getByTestId("close-kumo-dialog");
  await closeButton.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  const activeElementIsInside = await dialog.evaluate((element) => element.contains(document.activeElement));
  expect(activeElementIsInside).toBe(true);
});

test("Kumo Select supports keyboard navigation after its popup settles", async ({ page }) => {
  await openFixture(page);
  const select = page.getByRole("combobox", { name: "上游系统" });
  const currentOption = page.getByRole("option", { name: /生产数仓/ });
  const stageOption = page.getByRole("option", { name: /预发布/ });
  await select.focus();
  await page.keyboard.press("ArrowDown");
  await expect(currentOption).toHaveAttribute("data-highlighted", "");
  await expect(page.getByRole("listbox").locator("xpath=..")).not.toHaveAttribute("data-starting-style", "");
  await page.keyboard.press("ArrowDown");
  await expect(stageOption).toHaveAttribute("data-highlighted", "");
  await page.keyboard.press("Enter");
  await expect(select).toHaveText("stage");
});

test("Kumo Tooltip exposes an accessible role and trigger description", async ({ page }) => {
  test.fail(true, "Kumo 2.14.0 popup currently has no role=tooltip and the focused trigger has no aria-describedby association.");
  await openFixture(page);
  const trigger = page.getByRole("button", { name: "Tooltip 键盘触发器" });
  await trigger.focus();
  await expect(page.getByText("Tooltip 可通过键盘 Tab 聚焦触发器访问")).toBeVisible();
  expect.soft(trigger).toHaveAttribute("aria-describedby", /\S+/);
  expect.soft(page.locator('[role="tooltip"]')).toHaveCount(1);
});

test("Kumo and DAP toast/modal portals render alongside each other", async ({ page }) => {
  await openFixture(page);
  await page.getByTestId("open-kumo-dialog").click();
  const dialog = page.getByRole("dialog", { name: "字段映射确认" });
  await expect(dialog).toBeVisible();
  const inDialogToastButton = dialog.getByRole("button", { name: "Dialog 内触发 Toast" });
  await inDialogToastButton.click();
  await expect(page.getByRole("region", { name: "Notifications" }).getByText("对话框内 Toast")).toBeVisible();
  const portalInfo = await dialog.evaluate((element) => ({
    parent: element.parentElement?.tagName,
    insideFixture: Boolean(element.closest(".kumo-spike")),
    position: getComputedStyle(element).position,
    bodyOverflow: getComputedStyle(document.body).overflow,
  }));
  const notificationRegion = page.getByRole("region", { name: "Notifications" });
  const kumoToastLayer = await notificationRegion.evaluate((element) => getComputedStyle(element).zIndex);
  expect(portalInfo.insideFixture).toBe(false);
  expect(portalInfo.position).toBe("fixed");
  expect(kumoToastLayer).toBe("220");

  await page.keyboard.press("Escape");
  await page.getByTestId("open-dap-dialog").click();
  const dapDialog = page.locator(".confirm-card[role='alertdialog']");
  await expect(dapDialog).toContainText("DAP legacy confirmation");
  await page.keyboard.press("Escape");
  await expect(dapDialog).toBeHidden();

  await page.getByTestId("open-dap-toast").click();
  const dapToastRegion = page.getByRole("region", { name: "消息提示" });
  await expect(dapToastRegion.getByText("DAP legacy toast：保存成功")).toBeVisible();
  await page.getByTestId("kumo-toast-success").click();
  await expect(notificationRegion.getByText("保存成功")).toBeVisible();
  const layerOrder = await page.evaluate(() => ({
    kumoToast: Number(getComputedStyle(document.querySelector('[role="region"][aria-label="Notifications"]')!).zIndex),
    dapToast: Number(getComputedStyle(document.querySelector(".toast-stack")!).zIndex),
    fixedProbe: Number(getComputedStyle(document.querySelector("[data-testid='fixed-ui-probe']")!).zIndex),
  }));
  expect(layerOrder.kumoToast).toBeGreaterThan(layerOrder.dapToast);
  expect(layerOrder.kumoToast).toBeGreaterThan(layerOrder.fixedProbe);
});

test("Kumo Dialog and DAP modal hosts share an accessible modal root", async ({ page }) => {
  test.fail(true, "Kumo Dialog marks #root aria-hidden, which also hides a concurrently mounted DAP ConfirmDialog; unify overlay roots before mixing modal hosts.");
  await openFixture(page);
  await page.getByTestId("open-kumo-dialog").click();
  const kumoDialog = page.getByRole("dialog", { name: "字段映射确认" });
  await kumoDialog.getByTestId("open-dap-dialog-from-kumo").click();
  const dapDialog = page.locator(".confirm-card[role='alertdialog']");
  await expect(dapDialog).toContainText("DAP legacy confirmation");
  const modalState = await dapDialog.evaluate((element) => ({
    hiddenAncestor: Boolean(element.closest('[aria-hidden="true"]')),
    insideAppRoot: Boolean(element.closest("#root")),
    kumoDialogOutsideAppRoot: !Boolean(document.querySelector('[role="dialog"]')?.closest("#root")),
  }));
  const accessibleAlertDialogCount = await page.getByRole("alertdialog").count();
  console.log("Mixed modal host accessibility probe", JSON.stringify({ modalState, accessibleAlertDialogCount }));
  expect(modalState.hiddenAncestor).toBe(false);
  expect(accessibleAlertDialogCount).toBe(1);
});

test("DAP light/dark theme bridge persists and is present before fixture render", async ({ page }) => {
  await openFixture(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("html")).toHaveAttribute("data-mode", "light");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("dap-theme"))).toBe("light");

  const lightSurface = await page.locator(".kumo-spike-section").first().evaluate((element) => getComputedStyle(element).backgroundColor);
  await page.getByTestId("theme-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("dap-theme"))).toBe("dark");
  const darkSurface = await page.locator(".kumo-spike-section").first().evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(darkSurface).not.toBe(lightSurface);

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");
  await expect(page.getByTestId("kumo-spike")).toBeVisible();
});

test("existing DAP Portal, assets, dense table, form, admin, and Lineage render with Kumo CSS loaded", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  for (const route of existingRoutes) {
    await page.goto(route.path);
    await expect(page.locator(".main"), `${route.name} content`).toContainText(route.marker, { timeout: 20_000 });
    const measurements = await page.evaluate(() => {
      const body = getComputedStyle(document.body);
      const title = document.querySelector(".page-title");
      const main = document.querySelector(".main");
      return {
        bodyFont: body.fontFamily,
        bodySize: body.fontSize,
        bodyLineHeight: body.lineHeight,
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: innerWidth,
        titleSize: title ? getComputedStyle(title).fontSize : null,
        legacyInputHeight: document.querySelector(".inp") ? getComputedStyle(document.querySelector(".inp")!).height : null,
        legacySelectHeight: document.querySelector(".sel") ? getComputedStyle(document.querySelector(".sel")!).height : null,
        mainOverflow: main ? `${getComputedStyle(main).overflowX}/${getComputedStyle(main).overflowY}` : null,
        buttonCount: document.querySelectorAll("button").length,
        inputCount: document.querySelectorAll("input").length,
        selectCount: document.querySelectorAll("select").length,
        tableCount: document.querySelectorAll("table").length,
        svgCount: document.querySelectorAll("svg").length,
        imageCount: document.querySelectorAll("img").length,
        lineageHosts: document.querySelectorAll("lineage-viewer").length,
        lineageHeadingStyles: Array.from(document.querySelectorAll(".lineage-detail h2, .lineage-detail h3")).map((element) => {
          const style = getComputedStyle(element);
          return { fontSize: style.fontSize, fontWeight: style.fontWeight, lineHeight: style.lineHeight };
        }),
      };
    });
    expect(measurements.bodyFont).toContain("Segoe UI");
    expect(measurements.bodySize).toBe("14px");
    expect(measurements.bodyLineHeight).toBe("21px");
    if (measurements.titleSize) expect(measurements.titleSize).toBe("23px");
    if (measurements.legacyInputHeight) expect(measurements.legacyInputHeight).toBe("38px");
    if (measurements.legacySelectHeight && route.name !== "lineage") expect(measurements.legacySelectHeight).toBe("38px");
    expect(measurements.documentWidth).toBeLessThanOrEqual(measurements.viewportWidth + 1);
    if (route.name === "lineage") {
      expect(measurements.lineageHosts).toBeGreaterThan(0);
      expect(measurements.svgCount).toBeGreaterThan(0);
      expect(measurements.lineageHeadingStyles).toHaveLength(2);
      expect(measurements.lineageHeadingStyles[0]).toEqual({ fontSize: "16px", fontWeight: "700", lineHeight: "normal" });
      expect(measurements.lineageHeadingStyles[1].fontWeight).toBe("700");
      expect(measurements.lineageHeadingStyles[1].lineHeight).toBe("normal");
      expect(Number.parseFloat(measurements.lineageHeadingStyles[1].fontSize)).toBeCloseTo(16.38, 2);
    }
  }
  expect(pageErrors).toEqual([]);
});

test("Kumo stylesheet import order does not change representative legacy routes", async ({ page }) => {
  const snapshot = () => page.evaluate(() => {
    const selectors = ["body", ".page-title", "h1", "h2", "h3", "button", "input", ".inp", "select", ".sel", "table", "td", "svg", "img", "code", ".lineage-detail h2", ".lineage-detail h3"];
    return Object.fromEntries(selectors.map((selector) => {
      const element = document.querySelector(selector);
      if (!element) return [selector, null];
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return [selector, {
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        lineHeight: style.lineHeight,
        margin: style.margin,
        padding: style.padding,
        width: rect.width,
        height: rect.height,
        color: style.color,
        background: style.backgroundColor,
        border: style.border,
        display: style.display,
        boxSizing: style.boxSizing,
      }];
    }));
  });

  for (const route of existingRoutes) {
    await page.goto(route.path);
    await expect(page.locator(".main"), `${route.name} loaded`).toContainText(route.marker, { timeout: 20_000 });
    const before = await snapshot();
    await page.evaluate(() => {
      const original = Array.from(document.querySelectorAll("style")).find((style) => style.getAttribute("data-vite-dev-id")?.includes("@cloudflare/kumo/dist/styles/kumo-standalone.css"));
      if (!original) throw new Error("Kumo standalone stylesheet not found in the dev fixture.");
      const duplicate = document.createElement("style");
      duplicate.dataset["orderProbe"] = "kumo-last";
      duplicate.textContent = original.textContent;
      document.head.append(duplicate);
    });
    expect(await snapshot(), `${route.name} after applying Kumo CSS last`).toEqual(before);
    await page.evaluate(() => document.querySelector('[data-order-probe="kumo-last"]')?.remove());
  }
});

test("fixture and existing shell remain inside the six requested viewport widths", async ({ page }) => {
  test.setTimeout(120_000);
  await openFixture(page);
  const widths = [1440, 1200, 960, 768, 480, 390];
  const fixtureMeasurements: Array<{ width: number; documentWidth: number; tableClientWidth: number; tableScrollWidth: number }> = [];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    const metrics = await page.evaluate(() => {
      const frame = document.querySelector("[data-testid='kumo-table-scroll']");
      return {
        width: innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        tableClientWidth: frame?.clientWidth || 0,
        tableScrollWidth: frame?.scrollWidth || 0,
      };
    });
    fixtureMeasurements.push(metrics);
    expect(metrics.documentWidth, `fixture at ${width}px`).toBeLessThanOrEqual(width + 1);
    if (width <= 480) expect(metrics.tableScrollWidth).toBeGreaterThan(metrics.tableClientWidth);
  }
  console.log("Kumo fixture responsive measurements", JSON.stringify(fixtureMeasurements));

  await page.setViewportSize({ width: 390, height: 844 });
  const dialogTrigger = page.getByTestId("open-kumo-dialog");
  await dialogTrigger.click();
  const dialog = page.getByRole("dialog", { name: "字段映射确认" });
  const dialogRect = await dialog.boundingBox();
  expect(dialogRect).not.toBeNull();
  expect(dialogRect!.x).toBeGreaterThanOrEqual(0);
  expect(dialogRect!.x + dialogRect!.width).toBeLessThanOrEqual(391);
  await page.keyboard.press("Escape");

  const popoverTrigger = page.getByTestId("open-kumo-popover");
  await popoverTrigger.click();
  const popover = page.getByText("字段详情");
  await expect(popover).toBeVisible();
  const popoverRect = await popover.boundingBox();
  expect(popoverRect).not.toBeNull();
  expect(popoverRect!.x).toBeGreaterThanOrEqual(0);
  expect(popoverRect!.x + popoverRect!.width).toBeLessThanOrEqual(391);

  const appMeasurements = [];
  const responsiveRoutes = [
    ["/data-warehouse", "共 224 张表"],
    ["/system-management/users", "共 8 个账号"],
    ["/field-mapping", "查询源字段与目标字段之间的映射关系"],
    ["/lineage", "retail-demo-20260720"],
  ] as const;
  for (const width of widths) {
    await page.setViewportSize({ width, height: 844 });
    for (const [route, marker] of responsiveRoutes) {
      await page.goto(route);
      await expect(page.locator(".main"), `${route} loaded`).toContainText(marker, { timeout: 20_000 });
      const metrics = await page.evaluate(() => ({
        route: location.pathname,
        width: innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        mainWidth: document.querySelector(".main")?.clientWidth || 0,
        tableTransform: Array.from(document.querySelectorAll("table")).some((table) => table.classList.contains("mobile-card-table")),
        mobileTableDisplay: document.querySelector("table.mobile-card-table") ? getComputedStyle(document.querySelector("table.mobile-card-table")!).display : null,
        mobileTableHeaderDisplay: document.querySelector("table.mobile-card-table thead") ? getComputedStyle(document.querySelector("table.mobile-card-table thead")!).display : null,
        lineageHost: document.querySelectorAll("lineage-viewer").length,
        hamburgerVisible: (() => {
          const element = document.querySelector<HTMLElement>(".hamburger");
          return element ? getComputedStyle(element).display !== "none" && element.getBoundingClientRect().width > 0 : false;
        })(),
      }));
      appMeasurements.push(metrics);
      expect(metrics.documentWidth, `${route} at ${width}px`).toBeLessThanOrEqual(width + 1);
      if (width <= 480 && route === "/system-management/users") {
        expect(metrics.tableTransform).toBe(true);
        expect(metrics.mobileTableDisplay).toBe("block");
        expect(metrics.mobileTableHeaderDisplay).toBe("none");
      }
      if (width <= 480) expect(metrics.hamburgerVisible, `hamburger at ${width}px`).toBe(true);
      if (width <= 480 && route === "/lineage") expect(metrics.lineageHost).toBeGreaterThan(0);
    }
  }
  console.log("DAP responsive measurements", JSON.stringify(appMeasurements));

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/system-management/users");
  await expect(page.locator(".main")).toContainText("共 8 个账号");
  const openNavigation = page.getByRole("button", { name: "打开导航" });
  await openNavigation.click();
  await expect(page.getByRole("button", { name: "关闭导航" })).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".sidebar")).toHaveClass(/open/);
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("hidden");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "打开导航" })).toHaveAttribute("aria-expanded", "false");
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
  await expect(openNavigation).toBeFocused();
});
