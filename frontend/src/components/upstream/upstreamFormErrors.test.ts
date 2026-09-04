import assert from "node:assert/strict";
import test from "node:test";

import {
  getUpstreamErrorSummary,
  mergeUpstreamFieldErrors,
  normalizeUpstreamApiError,
  scrollToFirstUpstreamError,
  validateUpstreamForm,
} from "./upstreamFormErrors.ts";

const validForm = {
  id: "up_cbs",
  abbr: "CBS",
  name: "商品中心",
  dbType: "PostgreSQL",
  host: "product.source.demo.invalid",
  unloadTimes: ["02:00"],
};

interface TestApiErrorPayload {
  error: {
    code: string;
    message: string;
    details: unknown[];
  };
}

class TestApiError extends Error {
  payload: TestApiErrorPayload;

  constructor(details: unknown[], code: string) {
    super("Upstream validation failed");
    this.payload = {
      error: {
        code,
        message: "Upstream validation failed",
        details,
      },
    };
  }
}

function apiError(
  details: unknown[],
  code = "UPSTREAM_VALIDATION_FAILED",
): TestApiError {
  return new TestApiError(details, code);
}

test("empty upstream fields produce local errors without relying on async state", () => {
  const errors = validateUpstreamForm({ ...validForm, abbr: "" });

  assert.deepEqual(errors.map((item) => item.field), ["abbr"]);
  const [firstError] = errors;
  assert.ok(firstError);
  assert.equal(firstError.message, "系统简称不能为空");
  assert.deepEqual(validateUpstreamForm(validForm), []);
});

test("multiple local errors keep field order and report the correct count", () => {
  const errors = validateUpstreamForm({
    ...validForm,
    abbr: "",
    dbType: "",
    host: "",
    unloadTimes: [],
  });

  assert.deepEqual(errors.map((item) => item.field), ["abbr", "dbType", "host", "unloadTimes"]);
  assert.deepEqual(getUpstreamErrorSummary(errors), [
    "还有 4 项需要修改",
    "系统简称",
    "数据库类型",
    "JDBC 地址",
    "卸数时间点",
  ]);
});

test("structured backend details are translated to Chinese business messages", () => {
  const result = normalizeUpstreamApiError(apiError([
    { field: "abbr", message: "abbr is required" },
    { field: "dbType", message: "dbType is not allowed: PostgreSQL" },
    { field: "dept", message: "dept is not allowed: 未分配" },
  ]));
  const messages = result.fieldErrors.map((item) => item.message).join("\n");

  assert.deepEqual(result.fieldErrors.map((item) => item.field), ["abbr", "dbType", "dept"]);
  assert.deepEqual(result.fieldErrors.map((item) => item.message), [
    "系统简称不能为空",
    "数据库类型“PostgreSQL”当前不可用，请重新选择",
    "业务部门“未分配”当前不可用，请重新选择",
  ]);
  assert.doesNotMatch(messages, /abbr|dbType|dept|is required|is not allowed/);
  const [abbrError] = result.fieldErrors;
  assert.ok(abbrError);
  assert.equal(abbrError.rawMessage, "abbr is required");
});

test("unknown backend fields degrade safely to a generic form error", () => {
  const result = normalizeUpstreamApiError(apiError([
    { field: "internalOnlyField", message: "internalOnlyField is required" },
  ]));

  assert.equal(result.fieldErrors.length, 1);
  const [fieldError] = result.fieldErrors;
  assert.ok(fieldError);
  assert.equal(fieldError.field, null);
  assert.equal(fieldError.label, "表单内容");
  assert.equal(fieldError.message, "保存失败，请检查填写内容。");
  assert.equal(fieldError.rawMessage, "internalOnlyField is required");
  assert.doesNotMatch(fieldError.message, /internalOnlyField|is required/);
});

test("client errors take priority over backend errors for the same field", () => {
  const clientErrors = validateUpstreamForm({ ...validForm, abbr: "" });
  const backendErrors = normalizeUpstreamApiError(apiError([
    { field: "abbr", message: "abbr is required" },
    { field: "dept", message: "dept is not allowed: 未分配" },
  ])).fieldErrors;
  const merged = mergeUpstreamFieldErrors(clientErrors, backendErrors);

  assert.deepEqual(merged.map((item) => item.field), ["abbr", "dept"]);
  const [firstMergedError] = merged;
  assert.ok(firstMergedError);
  assert.equal(firstMergedError.message, "系统简称不能为空");
  assert.equal(mergeUpstreamFieldErrors(validateUpstreamForm(validForm), []).length, 0);
});

interface TestFocusTarget {
  focus(options?: FocusOptions): void;
}

interface TestFieldElement {
  getAttribute(name: string): string | null;
  scrollIntoView(options?: ScrollIntoViewOptions): void;
  querySelector(selector: string): TestFocusTarget | null;
}

interface ScrollCall {
  field: string;
  options?: ScrollIntoViewOptions;
}

test("first invalid upstream field is scrolled into view and focused safely", () => {
  const calls: ScrollCall[] = [];
  let focusOptions: FocusOptions | undefined;
  const focusTarget: TestFocusTarget = {
    focus(options) {
      focusOptions = options;
    },
  };
  const fieldElements: TestFieldElement[] = [
    {
      getAttribute: () => "abbr",
      scrollIntoView(options) {
        calls.push(options ? { field: "abbr", options } : { field: "abbr" });
      },
      querySelector: () => focusTarget,
    },
    {
      getAttribute: () => "host",
      scrollIntoView() {
        calls.push({ field: "host" });
      },
      querySelector: () => focusTarget,
    },
  ];
  const previousDocument = globalThis.document;
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { querySelectorAll: () => fieldElements },
  });

  try {
    assert.equal(scrollToFirstUpstreamError([
      { field: "host", label: "JDBC 地址", message: "JDBC 地址不能为空" },
      { field: "abbr", label: "系统简称", message: "系统简称不能为空" },
    ]), true);
    assert.deepEqual(calls, [{
      field: "abbr",
      options: { behavior: "smooth", block: "center" },
    }]);
    assert.deepEqual(focusOptions, { preventScroll: true });
  } finally {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: previousDocument,
    });
  }
});
