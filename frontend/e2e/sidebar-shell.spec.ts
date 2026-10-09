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

  for (const width of [768, 480]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(hamburger).toBeVisible();
    await expect(hamburger).toHaveAttribute("aria-expanded", "false");
    await expect(sidebar).not.toHaveClass(/open/);

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

test("portal route renders no module sidebar shell", async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem("dap_auth"));
  await page.setViewportSize({ width: 480, height: 844 });
  await page.goto("/portal");
  await expect(page.locator("button.hamburger")).toHaveCount(0);
  await expect(page.locator("#mobile-sidebar")).toHaveCount(0);
  await expect(page.locator(".sidebar-overlay")).toHaveCount(0);
});
