import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), "utf8");
const authControls = read("./components/AuthControls.tsx");
const appStyles = read("./styles/app.css");
const app = read("./App.tsx");
const authBar = authControls.match(/export function AuthBar\([\s\S]*$/)?.[0] || "";

test("header auth actions omit persistent guest and role badges", () => {
  assert.ok(authBar, "AuthBar should remain the shared header auth entry");
  assert.match(authBar, /if \(!auth\.user\)[\s\S]*?className="login-cta"/);
  assert.match(authBar, /className="user-chip"/);
  assert.match(authBar, /className="logout-btn"/);
  assert.doesNotMatch(authBar, /role-pill|roleLabel|未登录|业务维护员|系统管理员/);
});

test("shared header expands desktop search while retaining compact and mobile layouts", () => {
  assert.match(appStyles, /\.search \{\s*position: relative;\s*width: clamp\(320px, 24vw, 460px\);[\s\S]*?flex: 0 1 clamp\(320px, 24vw, 460px\);/);
  assert.match(
    appStyles,
    /@media \(max-width: 1500px\) and \(min-width: 769px\)[\s\S]*?\.search \{\s*width: clamp\(150px, 24vw, 360px\);\s*max-width: 24vw;\s*flex-basis: clamp\(150px, 24vw, 360px\);/,
  );
  assert.match(appStyles, /@media \(max-width: 1080px\) and \(min-width: 769px\)[\s\S]*?\.search \{\s*width: 36px;/);
  assert.match(appStyles, /@media \(max-width: 768px\)[\s\S]*?\.search\.mobile-open \{ display: block; \}/);
  assert.match(app, /id="global-search"/);
  assert.match(app, /value=\{query\}/);
  assert.match(app, /className="clear" onClick=\{\(\) => setQuery\(""\)\}/);
});
