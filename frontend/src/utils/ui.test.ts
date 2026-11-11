import assert from "node:assert/strict";
import test from "node:test";

import {
  ACCENT_STORAGE_KEY,
  applyAccentAttributes,
  applyThemeAttributes,
  getErrorMessage,
  getInitialAccent,
  getInitialTheme,
  optionLabel,
  resolveDefaultAccent,
} from "./ui.ts";

function withWindow(windowValue: unknown, run: () => void): void {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: windowValue,
  });
  try {
    run();
  } finally {
    if (previousWindow) {
      Object.defineProperty(globalThis, "window", previousWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
}

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

test("applyAccentAttributes sets the root accent preset", () => {
  const root = { dataset: {} } as Pick<HTMLElement, "dataset">;

  applyAccentAttributes("purple", root);
  assert.deepEqual(root.dataset, { accent: "purple" });

  applyAccentAttributes("green", root);
  assert.deepEqual(root.dataset, { accent: "green" });
});

test("configured accent defaults accept green/purple and reject invalid values", () => {
  assert.equal(resolveDefaultAccent("green"), "green");
  assert.equal(resolveDefaultAccent("purple"), "purple");
  assert.equal(resolveDefaultAccent(" PURPLE "), "purple");
  assert.equal(resolveDefaultAccent("blue"), "green");
  assert.equal(resolveDefaultAccent(undefined), "green");
});

test("getInitialAccent prioritizes a valid local preference over the deployment default", () => {
  withWindow(
    { localStorage: { getItem: (key: string) => key === ACCENT_STORAGE_KEY ? "green" : null } },
    () => assert.equal(getInitialAccent("purple"), "green"),
  );
});

test("getInitialAccent falls back to the configured default for invalid or unavailable storage", () => {
  withWindow(
    { localStorage: { getItem: () => "blue" } },
    () => assert.equal(getInitialAccent("purple"), "purple"),
  );
  withWindow(
    { localStorage: { getItem: () => { throw new Error("storage blocked"); } } },
    () => assert.doesNotThrow(() => assert.equal(getInitialAccent("purple"), "purple")),
  );
  const unavailableWindow = Object.defineProperty({}, "localStorage", {
    configurable: true,
    get() { throw new Error("storage blocked"); },
  });
  withWindow(unavailableWindow, () => assert.equal(getInitialAccent("purple"), "purple"));
});

test("getInitialTheme falls back when local storage is unavailable", () => {
  withWindow(
    { localStorage: { getItem: () => { throw new Error("storage blocked"); } } },
    () => assert.equal(getInitialTheme(), "light"),
  );
});

test("applyThemeAttributes synchronizes DAP theme and Kumo mode", () => {
  const root = { dataset: {} } as Pick<HTMLElement, "dataset">;

  applyThemeAttributes("dark", root);
  assert.deepEqual(root.dataset, { theme: "dark", mode: "dark" });

  applyThemeAttributes("light", root);
  assert.deepEqual(root.dataset, { theme: "light", mode: "light" });
});

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
