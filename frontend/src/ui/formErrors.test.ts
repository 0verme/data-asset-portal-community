import assert from "node:assert/strict";
import test from "node:test";

import {
  clearFormFieldErrors,
  formFieldElementId,
  formErrorSummaryId,
  mergeFormFieldErrors,
} from "./formErrors.ts";

test("local and server form errors merge without mutation and later field messages win", () => {
  const serverErrors = { email: "服务端邮箱错误", owner: "服务端负责人错误" };
  const localErrors = { email: "本地邮箱错误", name: "本地名称错误", empty: "   " };

  assert.deepEqual(mergeFormFieldErrors(serverErrors, localErrors), {
    email: "本地邮箱错误",
    owner: "服务端负责人错误",
    name: "本地名称错误",
  });
  assert.deepEqual(serverErrors, { email: "服务端邮箱错误", owner: "服务端负责人错误" });
  assert.deepEqual(localErrors, { email: "本地邮箱错误", name: "本地名称错误", empty: "   " });
});

test("field edits clear one path or its descendants without clearing sibling fields", () => {
  const errors = {
    email: "邮箱错误",
    "params.0.name": "参数名称错误",
    "params.0.dataType": "参数类型错误",
    "params[0].description": "参数说明错误",
    "params.1.name": "另一行名称错误",
    ownerName: "负责人错误",
  };

  assert.deepEqual(clearFormFieldErrors(errors, "params.0"), {
    email: "邮箱错误",
    "params.1.name": "另一行名称错误",
    ownerName: "负责人错误",
  });
  assert.deepEqual(clearFormFieldErrors(errors, "params"), {
    email: "邮箱错误",
    ownerName: "负责人错误",
  });
  assert.deepEqual(clearFormFieldErrors(errors, "email"), {
    "params.0.name": "参数名称错误",
    "params.0.dataType": "参数类型错误",
    "params[0].description": "参数说明错误",
    "params.1.name": "另一行名称错误",
    ownerName: "负责人错误",
  });
  assert.deepEqual(clearFormFieldErrors(errors), {});
});

test("DOM ids are stable, whitespace-free, and distinct for structured field paths", () => {
  const first = formFieldElementId("asset editor", "params.0.name");
  const second = formFieldElementId("asset editor", "params[0].name");

  const summaryId = formErrorSummaryId("asset editor");
  assert.match(first, /^dap-form-/);
  assert.doesNotMatch(first, /\s/);
  assert.notEqual(first, second);
  assert.match(summaryId, /^dap-form-/);
  assert.doesNotMatch(summaryId, /\s/);
  assert.equal(summaryId, formErrorSummaryId("asset editor"));
  assert.notEqual(summaryId, formErrorSummaryId("another form"));
});
