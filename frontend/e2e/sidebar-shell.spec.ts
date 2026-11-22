import { expect, test } from "@playwright/test";

test("responsive sidebar shell preserves overlay, scroll-lock, focus and ARIA contracts", async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem("dap_auth"));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/data-warehouse");

  const hamburger = page.locator("button.hamburger");
  const sidebar = page.locator("#mobile-sidebar");
  const overlay = page.locator(".sidebar-overlay");

  await expect(hamburger).toHaveClass(/dap-ui-icon-button/);
  await expect(hamburger).toBeHidden();
  await expect(sidebar).toBeVisible();

  await page.setViewportSize({ width: 960, height: 900 });
  await expect(hamburger).toBeHidden();
  await expect(sidebar).toBeVisible();

  for (const width of [959, 769, 768, 480]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(hamburger).toBeVisible();
    await expect(hamburger).toHaveAttribute("aria-expanded", "false");
    await expect(sidebar).not.toHaveClass(/open/);
    await expect(sidebar).toBeHidden();
    const sidebarButton = sidebar.locator(".mobile-module-link:not([disabled])").first();
    await expect(sidebarButton).toBeAttached();
    await hamburger.focus();
    for (let step = 0; step < 8; step += 1) {
      await page.keyboard.press("Tab");
      expect(await sidebar.evaluate(el => el.contains(document.activeElement))).toBe(false);
    }

    await hamburger.click();
    await expect(hamburger).toHaveAttribute("aria-expanded", "true");
    await expect(sidebar).toHaveClass(/open/);
    await expect(overlay).toHaveClass(/open/);
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("hidden");
    await expect(sidebar).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(hamburger).toHaveAttribute("aria-expanded", "false");
    await expect(sidebar).not.toHaveClass(/open/);
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
    await expect(hamburger).toBeFocused();

    await hamburger.click();
    await overlay.click({ position: { x: 300, y: 120 } });
    await expect(sidebar).not.toHaveClass(/open/);
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
    await expect(hamburger).toBeFocused();
  }

  await page.setViewportSize({ width: 959, height: 844 });
  await hamburger.click();
  await expect(sidebar).toHaveAttribute("aria-modal", "true");
  await page.setViewportSize({ width: 960, height: 844 });
  await expect(sidebar).toBeVisible();
  await expect(sidebar).not.toHaveAttribute("aria-modal", "true");
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
  await page.setViewportSize({ width: 959, height: 844 });
  await expect(sidebar).toBeHidden();
  await expect(hamburger).toHaveAttribute("aria-expanded", "false");
});

test("mobile module navigation switches modules and closes the sidebar", async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem("dap_auth"));
  await page.setViewportSize({ width: 480, height: 844 });
  await page.goto("/data-warehouse");

  await page.locator("button.hamburger").click();
  const sidebar = page.locator("#mobile-sidebar");
  await expect(sidebar).toHaveClass(/open/);

  const upstream = sidebar.getByRole("button", { name: "上游卸数" });
  await expect(upstream).toHaveClass(/mobile-module-link/);
  await expect(upstream).toHaveClass(/dap-ui-button/);
  await upstream.click();

  await expect(page).toHaveURL(/\/upstream(?:\?|$)/);
  await expect(sidebar).not.toHaveClass(/open/);
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
});

test("portal drawer closes when the desktop navigation returns", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 844 });
  await page.goto("/portal");

  const hamburger = page.locator("button.hamburger");
  const sidebar = page.locator("#mobile-sidebar");
  await hamburger.click();
  await expect(sidebar).toHaveClass(/open/);
  await expect(sidebar.locator(".mobile-module-nav")).toBeVisible();
  await expect(sidebar.locator(".sidebar-content, .sidebar-progress, .warehouse-sidebar")).toHaveCount(0);
  await page.setViewportSize({ width: 769, height: 844 });
  await expect(hamburger).toBeHidden();
  await expect(sidebar).toBeHidden();
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
  await page.setViewportSize({ width: 768, height: 844 });
  await expect(hamburger).toHaveAttribute("aria-expanded", "false");
  await expect(sidebar).toBeHidden();
});


test("lineage can search and expand in the drawer and closes on table selection", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/lineage");
  const hamburger = page.locator(".hamburger");
  await hamburger.click();
  const sidebar = page.locator("#mobile-sidebar");
  const schema = sidebar.locator(".lineage-schema-heading").first();
  await expect(schema).toHaveAttribute("aria-expanded", "true");
  await schema.click();
  await expect(schema).toHaveAttribute("aria-expanded", "false");
  await expect(sidebar).toHaveClass(/open/);
  await sidebar.getByRole("searchbox").fill("DWD_TRADE_ORDER");
  const table = sidebar.getByRole("button", { name: /DWD_TRADE_ORDER/ });
  await expect(sidebar).toHaveClass(/open/);
  await table.click();
  await expect(sidebar).toBeHidden();
  await expect(hamburger).toBeFocused();
  await expect(page.locator(".lineage-detail h2")).toHaveText("DWD_TRADE_ORDER");
  await hamburger.click();
  await expect(table).toHaveAttribute("aria-pressed", "true");
});


test("short drawers can scroll to the last filter and the progress area", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 390 });
  await page.goto("/data-warehouse");
  await page.locator(".hamburger").click();
  const panel = page.locator(".sidebar-panel");
  const lastFilter = panel.locator(".asset-sidebar-filter-option").last();
  await lastFilter.scrollIntoViewIfNeeded();
  await expect(lastFilter).toBeInViewport({ ratio: 1 });
  const progress = panel.getByRole("region", { name: "模块就绪度" });
  await progress.scrollIntoViewIfNeeded();
  await expect(progress).toBeInViewport({ ratio: 1 });
  await page.keyboard.press("Escape");
  await expect(page.locator(".hamburger")).toBeFocused();
});
