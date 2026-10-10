import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), "utf8");
const app = read("./App.tsx");

test("sidebar shell trigger uses the frozen DAP IconButton adapter", () => {
  assert.match(app, /import \{ Button, DropdownMenu, IconButton, Input \} from "\.\/ui\/index\.ts"/);
  assert.match(
    app,
    /<IconButton[\s\S]*?ref=\{hamburgerRef\}[\s\S]*?className="hamburger"[\s\S]*?variant="tertiary"[\s\S]*?size="sm"[\s\S]*?aria-controls="mobile-sidebar"[\s\S]*?aria-expanded=\{sidebarOpen\}[\s\S]*?aria-label=\{sidebarOpen \? "关闭导航" : "打开导航"\}[\s\S]*?icon=\{<Icon name="menu" size=\{18\} \/>\}/,
  );
  assert.doesNotMatch(app, /<button[\s\S]{0,80}?ref=\{hamburgerRef\}/);
});

test("mobile module navigation entries use DAP Buttons and keep the existing classes", () => {
  const navStart = app.indexOf('<nav className="mobile-module-nav"');
  const navEnd = app.indexOf("</nav>", navStart);
  assert.ok(navStart >= 0 && navEnd > navStart, "mobile module nav should exist");
  const nav = app.slice(navStart, navEnd);

  assert.equal((nav.match(/<Button/g) ?? []).length, 3);
  assert.equal((nav.match(/variant="tertiary"/g) ?? []).length, 3);
  assert.equal((nav.match(/mobile-module-link/g) ?? []).length, 3);
  assert.ok(nav.includes("visibleNavMenus.map((item) => ("));
  assert.ok(nav.includes("switchModuleFromMenu(item.code)"));
  assert.doesNotMatch(nav, /<button/);
});

test("responsive sidebar shell keeps overlay, scroll-lock, focus and aria contracts", () => {
  assert.match(app, /const \[sidebarOpen, setSidebarOpen\] = useState\(false\)/);
  assert.match(app, /document\.body\.style\.overflow = "hidden"/);
  assert.match(app, /document\.body\.style\.overflow = previousOverflow/);
  assert.match(app, /event\.key !== "Escape"/);
  assert.match(app, /setSidebarOpen\(false\)/);
  assert.match(app, /requestAnimationFrame\(\(\) => hamburgerRef\.current\?\.focus\(\)\)/);
  assert.match(app, /requestAnimationFrame\(\(\) => sidebarRef\.current\?\.focus\(\)\)/);
  assert.match(app, /id="mobile-sidebar"/);
  assert.match(app, /aria-label="模块导航与筛选"/);
  assert.match(app, /tabIndex=\{-1\}/);
  assert.match(app, /closest\("\.side-item"\)/);
  assert.match(app, /className=\{`sidebar-overlay\$\{sidebarOpen \? " open" : ""\}`\}/);
  assert.match(app, /className=\{`sidebar\$\{sidebarOpen \? " open" : ""\}`\}/);
});

test("sidebar shell does not bypass the DAP adapter boundary", () => {
  assert.doesNotMatch(app, /from "@cloudflare\/kumo\//);
});
