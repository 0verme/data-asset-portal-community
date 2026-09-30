import assert from "node:assert/strict";
import test from "node:test";

import { serializeCsvRows } from "./csv.ts";

test("CSV serialization quotes delimiters and neutralizes spreadsheet formulas", () => {
  assert.equal(
    serializeCsvRows([
      ["name", "value"],
      ["orders, current", "=HYPERLINK(\"https://example.invalid\")"],
    ]),
    `name,value\r\n"orders, current","'=HYPERLINK(""https://example.invalid"")"`,
  );
});
