import { expect, test } from "@playwright/test";

test("a field deep link, populated risk and edit round trip retain the asset identity", async ({ page }, info) => {
  test.skip(process.env["VITE_API_MODE"] !== "remote", "Uses intercepted HTTP responses.");
  const table = {
    assetId: 42, name: "order_items", schema: "commerce", cn: "Order items",
    domain: "Commerce", layer: "DWD", owner: "Warehouse team", fieldCount: 1,
    fields: [{ fieldId: 99, name: "order_id", cn: "Order identifier", type: "BIGINT", pk: true, nullable: false }],
    assetRisks: [{ severity: "warning", risk_source: "manual", rule_name: "Missing retention policy",
      rule_code: "RETENTION", asset_name: "commerce.order_items", message: "Retention period is missing." }],
  };
  const admin = { role: "admin", user: "reviewer", permissions: ["asset:read", "asset:write"] };
  let saveAttempts = 0;
  await page.addInitScript((auth) => {
    localStorage.setItem("dap-language", "en-US");
    localStorage.setItem("dap_auth", JSON.stringify(auth));
  }, admin);
  await page.route(/^https?:\/\/[^/]+\/api\//, async (route) => {
    const path = new URL(route.request().url()).pathname;
    switch (path) {
      case "/api/auth/me": return route.fulfill({ json: { data: admin } });
      case "/api/system/menus": return route.fulfill({ json: { items: [{
        id: "1", code: "dwm", name: "数据仓库", path: "/data-warehouse", icon: "database",
        order: 1, status: "enabled", adminOnly: false, navPlacement: "primary",
      }] } });
      case "/api/public-catalog/config": return route.fulfill({ json: { profile: "internal", exportEnabled: false } });
      case "/api/assets/42":
        if (route.request().method() === "PUT") {
          saveAttempts++;
          if (saveAttempts === 1) return route.fulfill({ status: 409, json: { message: "Please retry the update." } });
          const body = route.request().postDataJSON();
          expect(body.name).toBe(table.name);
          expect(body.domain).toBe("Commerce");
          expect(body.schema).toBe("commerce");
          table.owner = body.owner;
        }
        return route.fulfill({ json: { data: table } });
      case "/api/assets/42/ddl": return route.fulfill({ json: { ddl: "CREATE TABLE commerce.order_items (order_id BIGINT);" } });
      case "/api/assets/domains": return route.fulfill({ json: { items: [{ name: "Commerce", count: 1 }] } });
      case "/api/assets/layers": return route.fulfill({ json: { items: [{ code: "DWD", cn: "Curated detail", count: 1 }] } });
      case "/api/assets/tables": return route.fulfill({ json: { items: [table], total: 1 } });
      default: return route.fulfill({ json: { items: [] } });
    }
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/data-warehouse/order_items?assetId=42&fieldId=99");
  await expect(page.locator("#asset-field-99")).toBeFocused();
  const risk = page.getByRole("region", { name: "Asset risks" });
  await expect(risk).toContainText("Missing retention policy");
  await expect(risk).toContainText("Warning");
  await expect(risk).toContainText("Manual");
  await page.screenshot({ path: info.outputPath("warehouse-risk-field-link.png") });
  await page.getByRole("textbox", { name: "Filter fields in this table" }).fill("absent_field");
  await expect(page.locator(".asset-field-empty-row")).toHaveText("No fields match “absent_field”.");
  await page.getByRole("button", { name: "Edit table" }).click();
  await expect(page.locator(".editor-sub")).toHaveText("Current table: commerce.order_items");
  const owner = page.getByRole("textbox", { name: "Owner" });
  await owner.fill("Catalog team");
  const save = page.getByRole("button", { name: "Save", exact: true });
  await save.click();
  await expect(page.getByText("Please retry the update.", { exact: false }).first()).toBeVisible();
  await expect(owner).toHaveValue("Catalog team");
  await save.click();
  await expect(page.locator(".asset-detail-page .dh-meta")).toContainText("Catalog team");
  expect(saveAttempts).toBe(2);
});
