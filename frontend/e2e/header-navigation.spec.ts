import { expect, test } from "@playwright/test";

test("primary navigation fits its available space and preserves browser history", async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem("dap_auth"));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/data-warehouse?layout=list");

  const navigation = page.locator(".topbar-nav-slot > .mainnav:not(.mainnav-measure)");
  const primaryButtons = navigation.locator("button.dap-ui-button:not(.more-nav-trigger)");
  for (const width of [1920, 1440, 1280, 1199, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(primaryButtons, `all configured primary menus fit at ${width}px`).toHaveCount(5);
    await expect(navigation.getByRole("button", { name: "更多" })).toBeVisible();
    const metrics = await page.evaluate(() => {
      const nav = document.querySelector<HTMLElement>(".topbar-nav-slot > .mainnav:not(.mainnav-measure)")!;
      const slot = document.querySelector<HTMLElement>(".topbar-nav-slot")!;
      const brand = document.querySelector<HTMLElement>(".topbar-brand")!.getBoundingClientRect();
      const actions = document.querySelector<HTMLElement>(".topbar-actions")!.getBoundingClientRect();
      const navRect = nav.getBoundingClientRect();
      return {
        documentWidth: document.documentElement.scrollWidth,
        navWidth: navRect.width,
        navScrollWidth: nav.scrollWidth,
        navClientWidth: nav.clientWidth,
        slotWidth: slot.clientWidth,
        navLeft: navRect.left,
        navRight: navRect.right,
        brandRight: brand.right,
        actionsLeft: actions.left,
      };
    });
    expect(metrics.documentWidth, `no horizontal overflow at ${width}px`).toBeLessThanOrEqual(width + 1);
    expect(metrics.navScrollWidth, `nav contents fit at ${width}px`).toBeLessThanOrEqual(metrics.navClientWidth + 1);
    expect(metrics.navWidth, `nav container stays compact at ${width}px`).toBeLessThan(metrics.slotWidth - 16);
    expect(metrics.navLeft).toBeGreaterThanOrEqual(metrics.brandRight);
    expect(metrics.navRight).toBeLessThanOrEqual(metrics.actionsLeft);
  }

  await page.setViewportSize({ width: 960, height: 900 });
  await expect(primaryButtons).toHaveCount(5);
  const search = page.getByRole("textbox", { name: "全局搜索" });
  await search.focus();
  await expect.poll(() => primaryButtons.count()).toBeLessThan(5);
  const focusedMetrics = await page.evaluate(() => {
    const nav = document.querySelector<HTMLElement>(".topbar-nav-slot > .mainnav:not(.mainnav-measure)")!;
    return { clientWidth: nav.clientWidth, scrollWidth: nav.scrollWidth, documentWidth: document.documentElement.scrollWidth };
  });
  expect(focusedMetrics.scrollWidth).toBeLessThanOrEqual(focusedMetrics.clientWidth + 1);
  expect(focusedMetrics.documentWidth).toBeLessThanOrEqual(961);
  await search.blur();
  await expect(primaryButtons).toHaveCount(5);

  await expect(navigation.getByRole("button", { name: "数据仓库" })).toHaveClass(/active/);
  await expect(navigation.getByRole("button", { name: "上游卸数" })).toHaveClass(/dap-ui-button/);
  await navigation.getByRole("button", { name: "上游卸数" }).click();
  await expect(page).toHaveURL(/\/upstream(?:\?|$)/);
  await expect(navigation.getByRole("button", { name: "上游卸数" })).toHaveClass(/active/);

  await page.goBack();
  await expect(page).toHaveURL(/\/data-warehouse$/);
  await expect(navigation.getByRole("button", { name: "数据仓库" })).toHaveClass(/active/);

  await page.goForward();
  await expect(page).toHaveURL(/\/upstream(?:\?|$)/);
  await expect(navigation.getByRole("button", { name: "上游卸数" })).toHaveClass(/active/);
  await page.goBack();
  await expect(page).toHaveURL(/\/data-warehouse$/);
  await expect(navigation.getByRole("button", { name: "数据仓库" })).toHaveClass(/active/);
});

test("header geometry and mobile drawer stay responsive at all requested widths", async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.removeItem("dap_auth"));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/data-warehouse");
  await expect(page.locator(".main")).toContainText("共 224 张表");

  const navigation = page.locator(".topbar-nav-slot > .mainnav:not(.mainnav-measure)");
  for (const width of [1920, 1440, 1280, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const metrics = await page.evaluate(() => {
      const nav = document.querySelector<HTMLElement>(".topbar-nav-slot > .mainnav:not(.mainnav-measure)")!;
      const navRect = nav.getBoundingClientRect();
      const slot = document.querySelector<HTMLElement>(".topbar-nav-slot")!;
      return {
        documentWidth: document.documentElement.scrollWidth,
        navDisplay: getComputedStyle(nav).display,
        navWidth: navRect.width,
        navScrollWidth: nav.scrollWidth,
        navClientWidth: nav.clientWidth,
        slotWidth: slot.clientWidth,
      };
    });
    expect(metrics.documentWidth, `no document overflow at ${width}px`).toBeLessThanOrEqual(width + 1);

    if (width >= 960) {
      await expect(navigation).toBeVisible();
      await expect(navigation.locator("button.dap-ui-button:not(.more-nav-trigger)")).toHaveCount(5);
      expect(metrics.navScrollWidth).toBeLessThanOrEqual(metrics.navClientWidth + 1);
      expect(metrics.navWidth).toBeLessThan(metrics.slotWidth - 16);
      await expect(page.locator(".hamburger")).toBeHidden();
      await page.screenshot({ path: testInfo.outputPath(`header-${width}-light.png`), animations: "disabled" });
    } else {
      await expect(navigation).toBeHidden();
      await expect(page.getByRole("button", { name: "打开导航" })).toBeVisible();
      await expect(page.locator(".mobile-search-toggle")).toBeVisible();
      if (width <= 768) {
        const hamburger = page.getByRole("button", { name: "打开导航" });
        await hamburger.click();
        await expect(page.getByRole("button", { name: "关闭导航" })).toHaveAttribute("aria-expanded", "true");
        await expect(page.locator("#mobile-sidebar .mobile-module-link.active")).toContainText("数据仓库");
        await page.screenshot({ path: testInfo.outputPath(`header-${width}-drawer-open.png`), animations: "disabled" });
        await page.keyboard.press("Escape");
        await expect(page.getByRole("button", { name: "打开导航" })).toHaveAttribute("aria-expanded", "false");
        await expect(hamburger).toBeFocused();
      }
    }
  }
});

test("global-search adapters preserve value, clear, and mobile focus behavior", async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.removeItem("dap_auth"));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/data-warehouse");

  const input = page.getByRole("textbox", { name: "全局搜索" });
  const clear = page.getByRole("button", { name: "清除全局搜索" });
  await expect(input).toBeVisible();
  await expect(input).toHaveClass(/dap-ui-input/);
  await input.fill("warehouse");
  await clear.click();
  await expect(input).toHaveValue("");

  const toggle = page.locator(".mobile-search-toggle");
  for (const width of [960, 768, 480, 390]) {
    await page.setViewportSize({ width, height: 844 });
    if (width > 768) {
      await expect(toggle).toBeHidden();
      await expect(input).toBeVisible();
      await input.fill(`desktop query ${width}`);
      await clear.click();
      await expect(input).toHaveValue("");
      continue;
    }

    await expect(toggle).toBeVisible();
    await expect(input).toBeHidden();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(input).toBeVisible();
    await expect(input).toBeFocused();
    if (width === 390) {
      await page.screenshot({ path: testInfo.outputPath("mobile-search-open-390.png"), animations: "disabled" });
    }
    await input.fill(`mobile query ${width}`);
    await clear.click();
    await expect(input).toHaveValue("");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(input).toBeHidden();
  }
});

test("guest AuthBar DAP Button preserves login modal behavior", async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem("dap_auth"));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/data-warehouse");

  const login = page.getByRole("button", { name: "登录", exact: true });
  await expect(login).toHaveClass(/dap-ui-button/);
  await login.click();
  const loginDialog = page.getByRole("dialog");
  await expect(loginDialog.getByRole("heading", { name: "管理员登录" })).toBeVisible();
  await loginDialog.getByRole("button", { name: "暂不登录" }).click();
  await expect(loginDialog).toHaveCount(0);
});

test("authenticated AuthBar DAP IconButton preserves logout behavior", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("dap_auth", JSON.stringify({ role: "admin", user: "admin", name: "管理员" }));
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/data-warehouse");

  const logout = page.getByRole("button", { name: "退出登录" });
  await expect(logout).toHaveClass(/dap-ui-icon-button/);
  await expect(page.locator(".user-chip")).toContainText("admin");
  await logout.click();
  await expect(page.getByRole("button", { name: "登录", exact: true })).toBeVisible();
  await expect(page.locator(".user-chip")).toHaveCount(0);
});

test("theme trigger DAP IconButton preserves labels, persistence, and mobile sizing", async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem("dap_auth"));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/data-warehouse");

  const root = page.locator("html");
  const wrapper = page.locator(".theme-toggle-wrapper");
  const lightToggle = page.getByRole("button", { name: "切换到深色主题" });
  await expect(lightToggle).toHaveClass(/dap-ui-icon-button/);
  await expect(lightToggle).toHaveClass(/theme-toggle/);
  await expect(wrapper).toHaveAttribute("title", "切换到深色主题");
  await expect(root).toHaveAttribute("data-theme", "light");
  await expect(root).toHaveAttribute("data-mode", "light");
  const desktopBounds = await lightToggle.boundingBox();
  expect(desktopBounds?.width).toBe(36);
  expect(desktopBounds?.height).toBe(36);

  await lightToggle.click();
  const darkToggle = page.getByRole("button", { name: "切换到浅色主题" });
  await expect(darkToggle).toBeVisible();
  await expect(wrapper).toHaveAttribute("title", "切换到浅色主题");
  await expect(root).toHaveAttribute("data-theme", "dark");
  await expect(root).toHaveAttribute("data-mode", "dark");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("dap-theme"))).toBe("dark");

  await page.reload();
  await expect(root).toHaveAttribute("data-theme", "dark");
  await expect(root).toHaveAttribute("data-mode", "dark");
  const persistedDarkToggle = page.getByRole("button", { name: "切换到浅色主题" });
  await expect(persistedDarkToggle).toBeVisible();
  await expect(wrapper).toHaveAttribute("title", "切换到浅色主题");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => (await persistedDarkToggle.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  const mobileBounds = await persistedDarkToggle.boundingBox();
  expect(mobileBounds?.width).toBeGreaterThanOrEqual(44);
  expect(mobileBounds?.height).toBeGreaterThanOrEqual(44);
  await persistedDarkToggle.click();
  await expect(root).toHaveAttribute("data-theme", "light");
  await expect(root).toHaveAttribute("data-mode", "light");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("dap-theme"))).toBe("light");
});

test("More DropdownMenu preserves the current item, keyboard close, and route selection", async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.removeItem("dap_auth"));
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto("/root-management");
  await expect(page.locator(".main")).toContainText("词根库");

  const navigation = page.locator(".topbar-nav-slot > .mainnav:not(.mainnav-measure)");
  const trigger = navigation.getByRole("button", { name: "更多" });
  await expect(trigger).toHaveClass(/dap-ui-button/);
  await expect(trigger).toHaveClass(/active/);
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");

  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  const currentItem = menu.getByRole("menuitem", { name: "词根管理" });
  await expect(currentItem).toHaveAttribute("aria-current", "page");
  await expect(menu.getByRole("menuitem", { name: "报表资产" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("more-root-current-item.png"), animations: "disabled" });
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();

  await page.getByRole("button", { name: "切换到深色主题" }).click();
  await trigger.click();
  await expect(menu).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("more-root-current-item-dark.png"), animations: "disabled" });
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();

  await trigger.click();
  const previousUrl = page.url();
  await menu.getByRole("menuitem", { name: "报表资产" }).click();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(menu).toBeHidden();
  await expect(page).not.toHaveURL(previousUrl);
  await expect(page).toHaveURL(/\/report-assets(?:\?|$)/);
});

test("guest More menu keeps administrator-only navigation hidden", async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem("dap_auth"));
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto("/data-warehouse");

  const navigation = page.locator(".topbar-nav-slot > .mainnav:not(.mainnav-measure)");
  const trigger = navigation.getByRole("button", { name: "更多" });
  await trigger.click();
  const guestMenu = page.getByRole("menu");
  await expect(guestMenu.getByRole("menuitem")).toHaveCount(5);
  await expect(guestMenu.getByRole("menuitem", { name: "系统管理" })).toHaveCount(0);
});

test("administrator More menu exposes authorized system navigation", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem("dap_auth", JSON.stringify({ role: "admin", user: "admin", name: "管理员" }));
  });
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto("/data-warehouse");
  await expect(page.locator(".main")).toContainText("共 224 张表");

  const navigation = page.locator(".topbar-nav-slot > .mainnav:not(.mainnav-measure)");
  await navigation.getByRole("button", { name: "更多" }).click();
  const adminMenu = page.getByRole("menu");
  await expect(adminMenu.getByRole("menuitem")).toHaveCount(6);
  await expect(adminMenu.getByRole("menuitem", { name: "系统管理" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("more-admin-menu.png"), animations: "disabled" });
});
