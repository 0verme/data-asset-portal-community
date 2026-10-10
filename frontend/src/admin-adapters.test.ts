import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), "utf8");
const userForm = read("./components/system/UserForm.tsx");
const menuForm = read("./components/system/MenuForm.tsx");
const paramForm = read("./components/system/ParamForm.tsx");
const userPage = read("./components/system/UserManagementPage.tsx");
const menuPage = read("./components/system/MenuManagementPage.tsx");
const paramPage = read("./components/system/ParamDictPage.tsx");
const systemPage = read("./components/system/SystemManagementPage.tsx");
const rolePage = read("./components/system/RoleManagementPage.tsx");
const oplogPage = read("./components/OperationLog/OperationLogPage.tsx");
const oplogFilter = read("./components/OperationLog/OperationLogFilter.tsx");
const oplogDetail = read("./components/OperationLog/OperationLogDetail.tsx");

test("system forms use the frozen DAP adapters", () => {
  assert.match(userForm, /import \{ Input, Select, Textarea \} from "\.\.\/\.\.\/ui\/index\.ts"/);
  assert.equal((userForm.match(/<Input/g) ?? []).length, 3);
  assert.equal((userForm.match(/<Select<string>/g) ?? []).length, 1);
  assert.equal((userForm.match(/<Textarea/g) ?? []).length, 1);

  assert.match(menuForm, /import \{ Checkbox, Input, Select, Textarea \} from "\.\.\/\.\.\/ui\/index\.ts"/);
  assert.equal((menuForm.match(/<Input/g) ?? []).length, 4);
  assert.equal((menuForm.match(/<Select<string>/g) ?? []).length, 2);
  assert.equal((menuForm.match(/<Checkbox/g) ?? []).length, 1);
  assert.equal((menuForm.match(/<Textarea/g) ?? []).length, 1);

  assert.match(paramForm, /import \{ Input, Select, Textarea \} from "\.\.\/\.\.\/ui\/index\.ts"/);
  assert.equal((paramForm.match(/<Input/g) ?? []).length, 3);
  assert.equal((paramForm.match(/<Select<string>/g) ?? []).length, 1);
  assert.match(paramForm, /placeholder="请选择分类"/);
});

test("system pages use the frozen DAP adapters with documented native exceptions", () => {
  assert.match(userPage, /<Button className="btn primary" variant="primary"/);
  assert.match(menuPage, /<Button className="btn primary" variant="primary"/);
  assert.equal((menuPage.match(/<IconButton/g) ?? []).length, 2);
  assert.doesNotMatch(menuPage, /<button/);
  assert.match(paramPage, /<Button className="btn primary" variant="primary"/);
  assert.equal((paramPage.match(/<button/g) ?? []).length, 1, "category list item stays native");
  assert.match(systemPage, /<Button className="btn state-btn" variant="secondary"/);
  assert.match(rolePage, /import \{ Button, Input, Textarea \} from "\.\.\/\.\.\/ui\/index\.ts"/);
  assert.equal((rolePage.match(/<Input/g) ?? []).length, 2);
  assert.equal((rolePage.match(/<Textarea/g) ?? []).length, 1);
  assert.equal((rolePage.match(/<input/g) ?? []).length, 1, "permission matrix checkbox stays native");
});

test("operation log surfaces use the frozen DAP adapters", () => {
  assert.equal((oplogPage.match(/<Button/g) ?? []).length, 3);
  assert.match(oplogFilter, /import \{ Button, Input, Select \} from "\.\.\/\.\.\/ui\/index\.ts"/);
  assert.equal((oplogFilter.match(/<Select<string>/g) ?? []).length, 3);
  assert.equal((oplogFilter.match(/<Input/g) ?? []).length, 2);
  assert.match(oplogFilter, /type="datetime-local"/);
  assert.match(oplogDetail, /<Button className="btn" variant="secondary"/);

  [userForm, menuForm, paramForm, userPage, menuPage, paramPage, systemPage, rolePage, oplogPage, oplogFilter, oplogDetail].forEach((source) => {
    assert.doesNotMatch(source, /from "@cloudflare\/kumo\//);
  });
});
