import assert from "node:assert/strict";
import test from "node:test";

import { assetResourcePath } from "./assets.ts";

test("canonical asset resource paths use assetId when it is available", () => {
  assert.equal(assetResourcePath({ assetId: 42, tableName: "orders" }), "/assets/42");
  assert.equal(assetResourcePath({ assetId: 42 }, "/fields"), "/assets/42/fields");
  assert.equal(assetResourcePath({ assetId: 42 }, "/ddl"), "/assets/42/ddl");
});

test("legacy table paths remain the explicit compatibility fallback", () => {
  assert.equal(assetResourcePath({ tableName: "public.orders" }), "/assets/tables/public.orders");
  assert.equal(assetResourcePath("orders"), "/assets/tables/orders");
  assert.equal(
    assetResourcePath({ tableName: "public.orders" }, "/fields"),
    "/assets/tables/public.orders/fields",
  );
  assert.equal(
    assetResourcePath({ assetId: null, tableName: "order daily" }),
    "/assets/tables/order%20daily",
  );
});

test("missing or invalid identity fails instead of silently first-matching", () => {
  assert.throws(() => assetResourcePath({}), /资产身份缺失/);
  assert.throws(() => assetResourcePath({ assetId: 0 }), /资产身份无效/);
  assert.throws(
    () => assetResourcePath({ assetId: "abc" as unknown as number, tableName: "orders" }),
    /资产身份无效/,
  );
});
