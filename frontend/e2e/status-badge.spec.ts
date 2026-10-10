import { expect, test, type Page } from "@playwright/test";

async function setTheme(page: Page, theme: "light" | "dark"): Promise<void> {
  await page.addInitScript((themeMode) => {
    localStorage.removeItem("dap_auth");
    localStorage.setItem("dap-theme", themeMode);
  }, theme);
}

for (const theme of ["light", "dark"] as const) {
  test(`shared StatusBadge remains readable in ${theme} theme at desktop and mobile widths`, async ({ page }, testInfo) => {
    await setTheme(page, theme);

    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });

      for (const [status, label] of [["enabled", "启用"], ["disabled", "禁用"]] as const) {
        await page.goto(`/indicator-maintenance?view=list&status=${status}`);
        await expect(page.locator(".indicator-page .page-title")).toContainText("指标管理", { timeout: 20_000 });
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);

        const badge = page.locator(".indicator-page .dap-ui-badge").filter({ hasText: label }).first();
        await expect(badge).toBeVisible();
        await expect(badge).toContainText(label);
        await expect(badge).toHaveClass(/dap-ui-badge/);
        await expect(badge).not.toHaveClass(/tag-danger/);
        await expect(badge).not.toHaveAttribute("aria-hidden", "true");

        const dot = badge.locator('[aria-hidden="true"]').first();
        await expect(dot).toBeVisible();
        await expect(dot).toHaveClass(status === "enabled" ? /bg-kumo-success/ : /bg-kumo-badge-neutral/);
        const dotColor = await dot.evaluate((element) => getComputedStyle(element).backgroundColor);
        expect(dotColor).not.toBe("rgba(0, 0, 0, 0)");

        await badge.screenshot({
          path: testInfo.outputPath(`status-badge-${width}-${theme}-${status}.png`),
        });
      }
    }
  });
}
