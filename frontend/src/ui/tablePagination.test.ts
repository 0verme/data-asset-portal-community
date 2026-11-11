import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_TABLE_PAGE_SIZE_OPTIONS,
  resolveTablePageSizeOptions,
  resolveTablePaginationModel,
} from "./tablePagination.ts";

test("table pagination renders a zero-safe single page for empty results", () => {
  assert.deepEqual(resolveTablePaginationModel(8, 20, 0), {
    page: 1,
    pageSize: 20,
    total: 0,
    pageCount: 1,
    firstItem: 0,
    lastItem: 0,
  });
});

test("table pagination calculates exact ranges on first, middle and final pages", () => {
  assert.deepEqual(resolveTablePaginationModel(1, 20, 2300), {
    page: 1,
    pageSize: 20,
    total: 2300,
    pageCount: 115,
    firstItem: 1,
    lastItem: 20,
  });
  assert.deepEqual(resolveTablePaginationModel(2, 20, 21), {
    page: 2,
    pageSize: 20,
    total: 21,
    pageCount: 2,
    firstItem: 21,
    lastItem: 21,
  });
  assert.deepEqual(resolveTablePaginationModel(115, 20, 2300), {
    page: 115,
    pageSize: 20,
    total: 2300,
    pageCount: 115,
    firstItem: 2281,
    lastItem: 2300,
  });
});

test("table pagination clamps stale pages and normalizes malformed values", () => {
  assert.equal(resolveTablePaginationModel(5, 20, 21).page, 2);
  assert.deepEqual(resolveTablePaginationModel(Number.NaN, 0, Number.NaN), {
    page: 1,
    pageSize: 1,
    total: 0,
    pageCount: 1,
    firstItem: 0,
    lastItem: 0,
  });
});

test("page-size options retain service-normalized nonstandard sizes", () => {
  assert.deepEqual(DEFAULT_TABLE_PAGE_SIZE_OPTIONS, [10, 20, 50, 100]);
  assert.deepEqual(resolveTablePageSizeOptions([20, 50, 100], 73), [20, 50, 73, 100]);
  assert.deepEqual(resolveTablePageSizeOptions([20, 20, -1, Number.NaN], 20), [20]);
});
