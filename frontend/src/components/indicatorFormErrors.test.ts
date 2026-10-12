import assert from "node:assert/strict";
import test from "node:test";

import { validateIndicatorForm } from "./indicatorFormErrors.ts";

const validFields = {
  id: "KPI_100",
  name: "会员复购率",
  registrar: "何嘉佳",
  registeredAt: "2025-06-17",
  path: "PRD > 商品运营 > 规模",
};

test("indicator validation returns canonical field errors in form order", () => {
  assert.deepEqual(validateIndicatorForm({
    id: " ",
    name: "",
    registrar: "",
    registeredAt: "",
    path: "",
  }), {
    id: "指标 ID 不能为空",
    name: "指标中文名不能为空",
    registrar: "登记人不能为空",
    registeredAt: "登记日期必须使用 yyyy-mm-dd",
    path: "指标路径不能为空",
  });
});

test("indicator validation accepts trimmed required fields and ISO dates", () => {
  assert.deepEqual(validateIndicatorForm({
    ...validFields,
    id: " KPI_100 ",
    name: " 会员复购率 ",
  }), {});
});

test("indicator validation maps a malformed date to its field", () => {
  assert.deepEqual(validateIndicatorForm({ ...validFields, registeredAt: "2025/06/17" }), {
    registeredAt: "登记日期必须使用 yyyy-mm-dd",
  });
});
