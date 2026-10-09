import { expect, test } from "@playwright/test";

test("primary navigation adapters preserve the five/three menu split and browser history", async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem("dap_auth"));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/data-warehouse?layout=list");

  const navigation = page.locator(".topbar .mainnav");
  const primaryButtons = navigation.locator("button.dap-ui-button");
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
