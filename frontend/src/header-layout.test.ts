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
  assert.match(authControls, /import \{ Button, IconButton \} from "\.\.\/ui\/index\.ts"/);
  assert.match(authBar, /if \(!auth\.user\)[\s\S]*?<Button[\s\S]*?className="login-cta"[\s\S]*?onClick=\{onLogin\}/);
  assert.match(authBar, /className="user-chip"/);
  assert.match(
    authBar,
    /<IconButton[\s\S]*?className="logout-btn"[\s\S]*?aria-label=\{t\("logout"\)\}[\s\S]*?onClick=\{\(\) => void onLogout\(\)\}/,
  );
  assert.doesNotMatch(authBar, /<button|role-pill|roleLabel|未登录|业务维护员|系统管理员/);
});

test("shared header keeps brand, navigation, and actions in stable DOM and grid order", () => {
  const headerGrid = appStyles.match(/\.topbar\s*\{[\s\S]*?\n\s{2}\}/)?.[0] || "";

  assert.match(headerGrid, /grid-template-columns:\s*max-content\s+minmax\(0,\s*1fr\)\s+max-content/);
  assert.match(
    app,
    /<div className="topbar-brand">[\s\S]*?<div className="topbar-nav-slot"[\s\S]*?<nav className="mainnav"[\s\S]*?<div className="topbar-actions">/,
  );
  assert.match(appStyles, /\.topbar-brand\s*\{[^}]*flex:\s*0 0 auto/);
  assert.match(appStyles, /\.topbar-nav-slot\s*\{[^}]*min-width:\s*0;[^}]*width:\s*100%/);
  assert.match(appStyles, /\.topbar-actions\s*\{[^}]*flex:\s*0 0 auto;[^}]*white-space:\s*nowrap/);
  assert.match(appStyles, /\.mainnav\s*\{[^}]*width:\s*max-content;[^}]*max-width:\s*100%/);
  assert.match(app, /className="mainnav mainnav-measure" aria-hidden="true" inert/);
  assert.doesNotMatch(appStyles, /\.topbar-spacer/);
});

test("middle-width navigation derives its visible prefix from measured available space", () => {
  const compactHeader = appStyles.match(
    /@media \(max-width: 1199px\) and \(min-width: 769px\) \{[\s\S]*?\n\s{2}\}/,
  )?.[0] || "";
  const tabletHeader = appStyles.match(
    /@media \(max-width: 959px\) and \(min-width: 769px\) \{[\s\S]*?\n\s{2}\}/,
  )?.[0] || "";

  assert.match(appStyles, /\.search \{\s*position: relative;\s*width: clamp\(180px, 20vw, 360px\);/);
  assert.match(compactHeader, /\.search \{\s*width: 36px;[\s\S]*?flex-basis: 36px;/);
  assert.match(compactHeader, /\.search:focus-within,[\s\S]*?width: 196px;/);
  assert.match(app, /new ResizeObserver\(measureNavigation\)/);
  assert.match(app, /getNavigationPrimaryLimit\(visibleNavMenus, navigationFitMetrics\)/);
  assert.match(app, /data-nav-measure-item=\{item\.code\}/);
  assert.doesNotMatch(app, /maxPrimary:\s*compactHeader\s*\?/);
  assert.match(compactHeader, /\.search input \{\s*box-sizing: border-box;\s*padding: 0;/);
  assert.match(appStyles, /\.search \.clear \{[^}]*pointer-events: none/);
  assert.match(appStyles, /\.search\.has-val \.clear \{ opacity: 1; pointer-events: auto; \}/);
  assert.match(tabletHeader, /\.hamburger \{ display: grid/);
  assert.match(tabletHeader, /\.mainnav \{ display: none/);
  assert.match(appStyles, /@media \(max-width: 768px\)[\s\S]*?\.topbar-nav-slot \{\s*display: none;\s*\}/);
  assert.match(appStyles, /@media \(max-width: 768px\)[\s\S]*?\.search\.mobile-open \{ display: block; \}/);
  assert.match(app, /id="global-search"/);
  assert.match(app, /aria-label=\{tCommon\("search\.global"\)\}/);
  assert.match(app, /<Input[\s\S]*?className="search-input"[\s\S]*?value=\{query\}/);
  assert.match(
    app,
    /<Button[\s\S]*?className="clear"[\s\S]*?aria-label=\{tCommon\("search\.clear"\)\}[\s\S]*?onClick=\{\(\) => setQuery\(""\)\}/,
  );
});

test("More navigation uses the DAP DropdownMenu adapter with bounded Kumo content", () => {
  const menu = appStyles.match(/\.more-nav-menu\s*\{([^}]*)\}/)?.[1] || "";
  const menuItem = appStyles.match(/\.more-nav-menu-item\s*\{([^}]*)\}/)?.[1] || "";

  assert.match(app, /import \{ Button, DropdownMenu, IconButton, Input \} from "\.\/ui\/index\.ts"/);
  assert.match(app, /<DropdownMenu\.Trigger[\s\S]*?render=\{[\s\S]*?<Button/);
  assert.match(app, /<DropdownMenu\.Content id="more-nav-menu" className="more-nav-menu" align="end" side="bottom">/);
  assert.match(app, /<DropdownMenu\.Item[\s\S]*?selected=\{module === item\.code\}[\s\S]*?aria-current=\{module === item\.code \? "page" : undefined\}/);
  assert.match(menu, /width:\s*max-content/);
  assert.match(menu, /min-width:\s*156px/);
  assert.match(menu, /max-width:\s*min\(280px,\s*calc\(100vw - 32px\)\)/);
  assert.match(menu, /white-space:\s*normal/);
  assert.doesNotMatch(menu, /position:\s*absolute|top:|right:/);
  assert.match(menuItem, /width:\s*100%/);
  assert.match(menuItem, /justify-content:\s*flex-start/);
  assert.match(menuItem, /white-space:\s*nowrap/);
  assert.doesNotMatch(app, /from "@cloudflare\/kumo\//);
});

test("primary navigation actions use the frozen DAP Button adapter", () => {
  assert.match(app, /import \{ Button, DropdownMenu, IconButton, Input \} from "\.\/ui\/index\.ts"/);
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
  assert.match(app, /getNavigationPrimaryLimit\(visibleNavMenus, navigationFitMetrics\)/);
  assert.doesNotMatch(app, /from "@cloudflare\/kumo\//);
});

test("More menu items keep selection and navigation inside the DAP DropdownMenu boundary", () => {
  const moreNavStart = app.indexOf('<div className="more-nav">');
  const actionsStart = app.indexOf('<div className="topbar-actions">', moreNavStart);
  const moreNav = app.slice(moreNavStart, actionsStart);

  assert.ok(moreNav.includes("<DropdownMenu open={moreNavOpen}"));
  assert.ok(moreNav.includes("className={`more-nav-trigger"));
  assert.ok(moreNav.includes("aria-controls=\"more-nav-menu\""));
  assert.ok(moreNav.includes("selected={module === item.code}"));
  assert.ok(moreNav.includes('aria-current={module === item.code ? "page" : undefined}'));
  assert.ok(moreNav.includes("setMoreNavOpen(false)"));
  assert.ok(moreNav.includes("switchModuleFromMenu(item.code)"));
  assert.doesNotMatch(moreNav, /role="menuitem"|<button/);
});

test("accent preset controls are accessible DAP buttons with a visible selected marker", () => {
  assert.ok(app.includes('import { useAccent } from "./hooks/useAccent.ts";'));
  assert.ok(app.includes('const { accent, setAccent } = useAccent();'));
  assert.match(app, /<div className="accent-preset-group" role="group" aria-label=\{tCommon\("theme\.palette"\)\}>/);
  for (const [preset, label] of [["green", "theme.green"], ["purple", "theme.purple"]]) {
    assert.ok(app.includes(`aria-label={tCommon("${label}")}`));
    assert.ok(app.includes(`aria-pressed={accent === "${preset}"}`));
    assert.ok(app.includes(`onClick={() => setAccent("${preset}")}`));
  }
  assert.match(appStyles, /\.accent-preset-button\[aria-pressed="true"\] \.accent-preset-check/);
});

test("theme trigger uses a DAP IconButton and preserves its dynamic label and title", () => {
  assert.ok(app.includes('const themeToggleLabel = theme === "dark" ? tCommon("theme.switchToLight") : tCommon("theme.switchToDark");'));
  assert.ok(app.includes('<span className="theme-toggle-wrapper" title={themeToggleLabel}>'));
  assert.match(app, /<IconButton[\s\S]*?type="button"[\s\S]*?variant="secondary"[\s\S]*?size="sm"[\s\S]*?className="theme-toggle"/);
  assert.ok(app.includes("onClick={toggleTheme}"));
  assert.ok(app.includes("aria-label={themeToggleLabel}"));
  assert.ok(app.includes('icon={<Icon name={theme === "dark" ? "sun" : "moon"} size={16} />}'));
  assert.match(appStyles, /\.theme-toggle-wrapper\s*\{\s*display:\s*inline-flex;\s*flex:\s*0 0 auto;\s*\}/);
  assert.doesNotMatch(app, /<button\s+className="theme-toggle"/);
});
