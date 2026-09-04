import assert from "node:assert/strict";
import test from "node:test";

import { getErrorMessage, optionLabel } from "./ui.ts";

interface TestErrorDetail {
  field: string;
  message: string;
}

class TestApiError extends Error {
  payload: { error: { details: TestErrorDetail[] } };

  constructor(details: TestErrorDetail[]) {
    super("请求参数校验失败");
    this.payload = { error: { details } };
  }
}

test("optionLabel supports string and dictionary options", () => {
  assert.equal(optionLabel("PostgreSQL"), "PostgreSQL");
  assert.equal(optionLabel({ name: "文件传输", value: "SFTP" }), "文件传输");
  assert.equal(optionLabel({ value: "SFTP" }), "SFTP");
  assert.equal(optionLabel(null), "");
});

test("getErrorMessage displays backend validation details with field paths", () => {
  const error = new TestApiError([
    { field: "jobs[1].id", message: "同一系统内作业 ID 必须唯一" },
  ]);

  assert.equal(
    getErrorMessage(error),
    "jobs[1].id：同一系统内作业 ID 必须唯一",
  );
});

test("getErrorMessage keeps upstream validation details user-readable", () => {
  const error = new TestApiError([
    { field: "dbType", message: "“PostgreSQL”不是有效选项" },
    { field: "dept", message: "“供应链部”不是有效选项" },
  ]);

  assert.equal(
    getErrorMessage(error),
    "数据库类型：“PostgreSQL”不是有效选项；业务部门：“供应链部”不是有效选项",
  );
});

test("getErrorMessage keeps the normal error message without validation details", () => {
  assert.equal(getErrorMessage(new Error("保存失败")), "保存失败");
});
