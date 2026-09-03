import assert from "node:assert/strict";
import test from "node:test";

import { getErrorMessage, optionLabel } from "./ui.ts";

test("optionLabel supports string and dictionary options", () => {
  assert.equal(optionLabel("PostgreSQL"), "PostgreSQL");
  assert.equal(optionLabel({ name: "文件传输", value: "SFTP" }), "文件传输");
  assert.equal(optionLabel({ value: "SFTP" }), "SFTP");
  assert.equal(optionLabel(null), "");
});

test("getErrorMessage displays backend validation details with field paths", () => {
  const error = new Error("请求参数校验失败");
  error.payload = {
    error: {
      details: [
        { field: "jobs[1].id", message: "同一系统内作业 ID 必须唯一" },
      ],
    },
  };

  assert.equal(
    getErrorMessage(error),
    "jobs[1].id：同一系统内作业 ID 必须唯一",
  );
});

test("getErrorMessage keeps the normal error message without validation details", () => {
  assert.equal(getErrorMessage(new Error("保存失败")), "保存失败");
});
