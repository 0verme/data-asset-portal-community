import { expect, test } from "@playwright/test";

const configuredDefaultAccent = process.env["VITE_DEFAULT_ACCENT"]?.trim().toLowerCase() === "purple"
  ? "purple"
  : "green";
const switchedAccent = configuredDefaultAccent === "green" ? "purple" : "green";

test("accent preset supports keyboard switching and persists across reload", async ({ page }) => {
  await page.addInitScript(() => {
    const initializedKey = "dap-557-accent-e2e-initialized";
    if (!sessionStorage.getItem(initializedKey)) {
      localStorage.removeItem("dap_auth");
      localStorage.removeItem("dap-accent");
      localStorage.setItem("dap-theme", "light");
      sessionStorage.setItem(initializedKey, "true");
    }
  });
  await page.goto("/data-warehouse?layout=list");

  const root = page.locator("html");
  await expect(root).toHaveAttribute("data-accent", configuredDefaultAccent);
  const initialButton = page.getByRole("button", {
    name: configuredDefaultAccent === "green" ? "绿色" : "紫色",
    exact: true,
  });
  const nextButton = page.getByRole("button", {
    name: switchedAccent === "green" ? "绿色" : "紫色",
    exact: true,
  });
  await expect(initialButton).toHaveAttribute("aria-pressed", "true");
  await expect(nextButton).toHaveAttribute("aria-pressed", "false");

  await nextButton.focus();
  await expect(nextButton).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(root).toHaveAttribute("data-accent", switchedAccent);
  await expect(nextButton).toHaveAttribute("aria-pressed", "true");
  await expect(initialButton).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("dap-accent"))).toBe(switchedAccent);

  await page.reload();
  await expect(root).toHaveAttribute("data-accent", switchedAccent);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("dap-accent"))).toBe(switchedAccent);
  await expect(nextButton).toHaveAttribute("aria-pressed", "true");
});
