import assert from "node:assert/strict";
import test from "node:test";

import { mapApiFormFieldErrors } from "./formFieldErrorMapping.ts";

const MANUAL_CODE_TABLE_FIELDS = ["tableCode", "tableName", "style", "owner", "status", "remark"];

interface HttpError extends Error {
  status?: number;
  payload?: unknown;
}

function httpError(status: number, payload: unknown): HttpError {
  const error = new Error("untrusted server text") as HttpError;
  error.status = status;
  error.payload = payload;
  return error;
}

test("maps only allow-listed validation fields to safe field messages", () => {
  const errors = mapApiFormFieldErrors(httpError(422, {
    error: {
      message: "private response",
      details: MANUAL_CODE_TABLE_FIELDS.map((field) => ({ field, message: `private ${field} detail` })),
    },
  }), MANUAL_CODE_TABLE_FIELDS);

  assert.deepEqual(errors, MANUAL_CODE_TABLE_FIELDS.map((field) => ({
    field,
    message: "服务端校验未通过，请检查此字段。",
  })));
  assert.doesNotMatch(JSON.stringify(errors), /private/);
});

test("keeps unknown field names and raw details at the safe form level", () => {
  assert.deepEqual(mapApiFormFieldErrors(httpError(422, {
    error: {
      message: "private response",
      details: [{ field: "internalColumn", message: "secret schema detail" }],
    },
  }), MANUAL_CODE_TABLE_FIELDS), [{
    field: "form",
    message: "提交内容未通过校验，请检查表单后重试。",
  }]);
});

test("maps duplicate conflicts to safe messages without inventing field paths", () => {
  assert.deepEqual(mapApiFormFieldErrors(httpError(409, {
    error: { code: "DUPLICATE", message: "private duplicate detail" },
  }), MANUAL_CODE_TABLE_FIELDS), [{
    field: "form",
    message: "当前数据存在冲突，请检查后重试。",
  }]);
});
