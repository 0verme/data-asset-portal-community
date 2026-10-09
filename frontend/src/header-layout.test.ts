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

test("shared header keeps brand, navigation, and actions in stable DOM and grid order", () => {
  const headerGrid = appStyles.match(/\.topbar\s*\{[\s\S]*?\n\s{2}\}/)?.[0] || "";

  assert.match(headerGrid, /grid-template-columns:\s*max-content\s+minmax\(0,\s*1fr\)\s+max-content/);
  assert.match(
    app,
    /<div className="topbar-brand">[\s\S]*?<div className="mainnav">[\s\S]*?<div className="topbar-actions">/,
  );
  assert.match(appStyles, /\.topbar-brand\s*\{[^}]*flex:\s*0 0 auto/);
  assert.match(appStyles, /\.topbar-actions\s*\{[^}]*flex:\s*0 0 auto;[^}]*white-space:\s*nowrap/);
  assert.doesNotMatch(appStyles, /\.topbar-spacer|\.mainnav\s*\{[^}]*\border\s*:/);
});

test("middle-width header compacts search and navigation before the mobile breakpoint", () => {
  const compactHeader = appStyles.match(
    /@media \(max-width: 1199px\) and \(min-width: 769px\) \{[\s\S]*?\n\s{2}\}/,
  )?.[0] || "";
  const tabletHeader = appStyles.match(
    /@media \(max-width: 959px\) and \(min-width: 769px\) \{[\s\S]*?\n\s{2}\}/,
  )?.[0] || "";

  assert.match(appStyles, /\.search \{\s*position: relative;\s*width: clamp\(180px, 20vw, 360px\);/);
  assert.match(compactHeader, /\.search \{\s*width: 36px;[\s\S]*?flex-basis: 36px;/);
  assert.match(compactHeader, /\.search:focus-within,[\s\S]*?width: 196px;/);
  assert.match(app, /matchMedia\("\(max-width: 1199px\)"\)/);
  assert.match(app, /splitNavigationMenus\(visibleNavMenus, \{ maxPrimary: compactHeader \? 3 : 5 \}\)/);
  assert.match(compactHeader, /\.search input \{\s*box-sizing: border-box;\s*padding: 0;/);
  assert.match(appStyles, /\.search \.clear \{[^}]*pointer-events: none/);
  assert.match(appStyles, /\.search\.has-val \.clear \{ opacity: 1; pointer-events: auto; \}/);
  assert.match(tabletHeader, /\.hamburger \{ display: grid/);
  assert.match(tabletHeader, /\.mainnav \{ display: none/);
  assert.match(appStyles, /@media \(max-width: 768px\)[\s\S]*?\.search\.mobile-open \{ display: block; \}/);
  assert.match(app, /id="global-search"/);
  assert.match(app, /aria-label="全局搜索"/);
  assert.match(app, /value=\{query\}/);
  assert.match(app, /className="clear" onClick=\{\(\) => setQuery\(""\)\}/);
});

test("more-navigation dropdown owns a bounded, single-column layout contract", () => {
  const moreNav = appStyles.match(/\.more-nav\s*\{([^}]*)\}/)?.[1] || "";
  const menu = appStyles.match(/\.more-nav-menu\s*\{([^}]*)\}/)?.[1] || "";
  const menuButton = appStyles.match(/\.more-nav-menu button\s*\{([^}]*)\}/)?.[1] || "";

  assert.match(moreNav, /position:\s*relative/);
  assert.match(menu, /position:\s*absolute/);
  assert.match(menu, /top:\s*calc\(100% \+ 8px\)/);
  assert.match(menu, /right:\s*0/);
  assert.match(menu, /display:\s*flex/);
  assert.match(menu, /flex-direction:\s*column/);
  assert.match(menu, /width:\s*max-content/);
  assert.match(menu, /min-width:\s*156px/);
  assert.match(menu, /max-width:\s*min\(280px,\s*calc\(100vw - 32px\)\)/);
  assert.match(menu, /white-space:\s*normal/);
  assert.match(menuButton, /width:\s*100%/);
  assert.match(menuButton, /justify-content:\s*flex-start/);
  assert.match(menuButton, /white-space:\s*nowrap/);
});

test("primary navigation actions use the frozen DAP Button adapter", () => {
  assert.match(app, /import \{ Button \} from "\.\/ui\/index\.ts"/);
  assert.match(
    app,
    /currentNavMenuStatus === "loading" \? \([\s\S]*?<Button type="button" variant="tertiary" size="sm" disabled>/,
  );
  assert.match(
    app,
    /currentNavMenuStatus === "error" \? \([\s\S]*?<Button[\s\S]*?onClick=\{\(\) => void loadMenus\(navigationAuthKey\)\}/,
  );
  assert.match(
    app,
    /primaryNavMenus\.map\(\(item\) => \([\s\S]*?<Button[\s\S]*?variant="tertiary"[\s\S]*?className=\{module === item\.code \? "active" : ""\}[\s\S]*?onClick=\{\(\) => switchModuleFromMenu\(item\.code\)\}/,
  );
  assert.match(app, /splitNavigationMenus\(visibleNavMenus, \{ maxPrimary: compactHeader \? 3 : 5 \}\)/);
  assert.doesNotMatch(app, /from "@cloudflare\/kumo\//);
});
