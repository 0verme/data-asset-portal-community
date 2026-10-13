import assert from "node:assert/strict";
import test from "node:test";

import { ROOT_ABBR_RULE_MESSAGE } from "../utils/rootValidation.ts";
import { validateRootForm } from "./rootFormErrors.ts";

test("requires a valid abbreviation and Chinese name", () => {
  assert.deepEqual(validateRootForm({ abbr: "", cn: " " }, []), {
    abbr: "词根缩写不能为空",
    cn: "中文名不能为空",
  });
  assert.deepEqual(validateRootForm({ abbr: "pay_amt", cn: "订单金额" }, []), {
    abbr: ROOT_ABBR_RULE_MESSAGE,
  });
});

test("rejects duplicate abbreviations but permits the current edit value", () => {
  assert.deepEqual(validateRootForm({ abbr: "sku", cn: "商品" }, ["sku", "amt"]), {
    abbr: "词根 sku 已存在",
  });
  assert.deepEqual(validateRootForm({ abbr: "sku", cn: "商品" }, ["sku", "amt"], "sku"), {});
});

test("valid values produce no field errors", () => {
  assert.deepEqual(validateRootForm({ abbr: "newroot", cn: "新词根" }, ["sku"]), {});
});
