import assert from "node:assert/strict";
import test from "node:test";

import {
  clearFormFieldErrorEntry,
  formFieldErrorEntries,
  mapApiFormFieldErrors,
} from "./formFieldErrorMapping.ts";

interface HttpError extends Error {
  status?: number;
  payload?: unknown;
}

function httpError(status: number, payload?: unknown): HttpError {
  const error = new Error("untrusted server text") as HttpError;
  error.status = status;
  error.payload = payload;
  return error;
}

test("maps only allow-listed structured 422 fields and never renders raw server messages", () => {
  const errors = mapApiFormFieldErrors(httpError(422, {
    error: {
      code: "VALIDATION_ERROR",
      message: "private response text",
      details: [
        { field: "username", message: "database username secret" },
        { field: "internalField", message: "private server detail" },
      ],
    },
  }), ["username", "displayName"]);

  assert.deepEqual(errors, [
    { field: "username", message: "服务端校验未通过，请检查此字段。" },
    { field: "form", message: "提交内容未通过校验，请检查表单后重试。" },
  ]);
  assert.doesNotMatch(JSON.stringify(errors), /private|secret|database/);
});

test("maps a structured 409 to its known field and keeps generic failures at form level", () => {
  assert.deepEqual(mapApiFormFieldErrors(httpError(409, {
    error: { code: "ALREADY_EXISTS", details: [{ field: "code", message: "raw duplicate" }] },
  }), ["code"]), [
    { field: "code", message: "此字段与现有数据冲突，请修改后重试。" },
  ]);

  for (const [status, expected] of [
    [401, "登录状态已失效，请重新登录。"],
    [403, "当前账号没有执行此操作的权限。"],
    [500, "服务暂时不可用，请稍后重试。"],
  ] as const) {
    assert.deepEqual(mapApiFormFieldErrors(httpError(status, {
      error: { details: [{ field: "code", message: "secret response detail" }] },
    }), ["code"]), [{ field: "form", message: expected }]);
  }
});

test("maps network errors safely and clears only the corrected structured field", () => {
  assert.deepEqual(mapApiFormFieldErrors(new TypeError("Failed to fetch"), ["name"]), [
    { field: "form", message: "网络连接失败，请检查网络后重试。" },
  ]);

  const errors = [
    { field: "params.0.name", message: "row error" },
    { field: "params.0.type", message: "sibling error" },
    { field: "params.1.name", message: "another row" },
    { field: "form", message: "general error" },
  ];
  assert.deepEqual(clearFormFieldErrorEntry(errors, "params.0.name"), [
    { field: "params.0.type", message: "sibling error" },
    { field: "params.1.name", message: "another row" },
    { field: "form", message: "general error" },
  ]);
  assert.deepEqual(formFieldErrorEntries(errors), {
    "params.0.name": "row error",
    "params.0.type": "sibling error",
    "params.1.name": "another row",
    form: "general error",
  });
});
