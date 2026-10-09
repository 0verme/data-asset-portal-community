import { expect, test } from "@playwright/test";

test("primary navigation adapters preserve the five/three menu split and browser history", async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem("dap_auth"));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/data-warehouse?layout=list");

  const navigation = page.locator(".topbar .mainnav");
  const primaryButtons = navigation.locator("button.dap-ui-button:not(.more-nav-trigger)");
  await expect(primaryButtons).toHaveCount(5);
  await expect(navigation.getByRole("button", { name: "数据仓库" })).toHaveClass(/active/);
  await expect(navigation.getByRole("button", { name: "上游卸数" })).toHaveClass(/dap-ui-button/);

  await page.setViewportSize({ width: 1199, height: 900 });
  await expect(primaryButtons).toHaveCount(3);
  await expect(navigation.getByRole("button", { name: "更多" })).toBeVisible();

  await navigation.getByRole("button", { name: "上游卸数" }).click();
  await expect(page).toHaveURL(/\/upstream(?:\?|$)/);
  await expect(navigation.getByRole("button", { name: "上游卸数" })).toHaveClass(/active/);

  await page.goBack();
  await expect(page).toHaveURL(/\/data-warehouse$/);
  await expect(navigation.getByRole("button", { name: "数据仓库" })).toHaveClass(/active/);
});

test("global-search adapters preserve value, clear, and mobile focus behavior", async ({ page }) => {
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

  await page.setViewportSize({ width: 390, height: 844 });
  const toggle = page.locator(".mobile-search-toggle");
  await expect(toggle).toBeVisible();
  await expect(input).toBeHidden();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(input).toBeVisible();
  await expect(input).toBeFocused();
  await input.fill("mobile query");
  await clear.click();
  await expect(input).toHaveValue("");
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
  const mobileBounds = await persistedDarkToggle.boundingBox();
  expect(mobileBounds?.width).toBeGreaterThanOrEqual(44);
  expect(mobileBounds?.height).toBeGreaterThanOrEqual(44);
  await persistedDarkToggle.click();
  await expect(root).toHaveAttribute("data-theme", "light");
  await expect(root).toHaveAttribute("data-mode", "light");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("dap-theme"))).toBe("light");
});

test("more-menu DAP Buttons preserve expand, select, and close behavior", async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem("dap_auth"));
  await page.setViewportSize({ width: 1199, height: 900 });
  await page.goto("/data-warehouse");

  const navigation = page.locator(".topbar .mainnav");
  const trigger = navigation.getByRole("button", { name: "更多" });
  await expect(trigger).toHaveClass(/dap-ui-button/);
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");

  const menu = navigation.getByRole("menu");
  await expect(menu).toBeVisible();
  const firstItem = menu.getByRole("menuitem").first();
  await expect(firstItem).toHaveClass(/dap-ui-button/);
  const previousUrl = page.url();
  await firstItem.click();

  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(menu).toBeHidden();
  await expect(page).not.toHaveURL(previousUrl);
});
