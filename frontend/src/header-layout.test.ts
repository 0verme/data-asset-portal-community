import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), "utf8");
const authControls = read("./components/AuthControls.tsx");
const appStyles = read("./styles/app.css");
const appearanceStyles = read("./appearance/appearance-settings.css");
const app = read("./App.tsx");
const appHeader = read("./components/app/AppHeader.tsx");
const appShell = read("./components/app/AppShell.tsx");
const authBar = authControls.match(/export function AuthBar\([\s\S]*$/)?.[0] || "";

test("App mounts a single shared AppHeader inside AppShell without duplicate header DOM", () => {
  assert.match(app, /import \{ AppHeader, type NavigationMenuStatus \} from "\.\/components\/app\/AppHeader\.tsx"/);
  assert.equal([...app.matchAll(/<AppHeader\b/g)].length, 1);
  assert.doesNotMatch(app, /<header\b/);
  assert.equal([...appHeader.matchAll(/<header\b/g)].length, 1);
  assert.match(appShell, /className=\{isHome \? 'app app--home' : 'app'\}/);
});

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

test("shared header keeps brand, navigation, and actions in stable DOM and V2.2 grid contract", () => {
  const headerGrid = appStyles.match(/\.topbar\s*\{[\s\S]*?\n\s{2}\}/)?.[0] || "";
  const homeHeaderGrid = appStyles.match(/\.portal-home-topbar\s*\{[\s\S]*?\n\s{2}\}/)?.[0] || "";

  assert.match(headerGrid, /min-height:\s*68px/);
  assert.match(headerGrid, /width:\s*min\(1360px,\s*calc\(100% - 44px\)\)/);
  assert.match(headerGrid, /margin:\s*0 auto/);
  assert.match(headerGrid, /padding:\s*0/);
  assert.match(headerGrid, /gap:\s*13px/);
  assert.match(headerGrid, /grid-template-columns:\s*max-content\s+minmax\(0,\s*1fr\)\s+max-content/);
  assert.match(homeHeaderGrid, /--portal-header-side:\s*max\(252px,\s*var\(--portal-tools-width,\s*0px\)\)/);
  assert.match(homeHeaderGrid, /grid-template-columns:\s*var\(--portal-header-side\)\s+minmax\(0,\s*1fr\)\s+var\(--portal-header-side\)/);
  assert.doesNotMatch(homeHeaderGrid, /width:|height:|padding:|brand-mark|brand-name|theme-toggle/);
  assert.match(
    appHeader,
    /<div className="topbar-brand">[\s\S]*?<div className="topbar-nav-slot"[\s\S]*?<nav className="mainnav"[\s\S]*?<div className="topbar-actions" ref={navActionsRef}>/,
  );
  assert.match(appStyles, /\.topbar-brand\s*\{[^}]*flex:\s*0 0 auto/);
  assert.match(appStyles, /\.topbar-nav-slot\s*\{[^}]*min-width:\s*0;[^}]*width:\s*100%/);
  assert.match(appStyles, /\.topbar-actions\s*\{[^}]*gap:\s*9px;[^}]*flex:\s*0 0 auto;[^}]*white-space:\s*nowrap/);
  assert.match(appStyles, /\.brand-mark\s*\{[\s\S]*?width:\s*35px;\s*height:\s*35px;\s*border-radius:\s*10px/);
  assert.match(appStyles, /\.brand-name\s*\{[^}]*font-size:\s*17px;[^}]*font-weight:\s*600;[^}]*letter-spacing:\s*-0\.02em/);
  assert.match(appStyles, /\.brand-name small\s*\{[^}]*font-size:\s*11px/);
  assert.match(appStyles, /\.mainnav\s*\{[^}]*width:\s*max-content;[^}]*max-width:\s*100%/);
  assert.match(appStyles, /\.topbar :is\(\.theme-toggle, \.appearance-trigger, \.login-cta, \.logout-btn, \.user-chip\)\s*\{[\s\S]*?height:\s*39px;[\s\S]*?border-radius:\s*999px/);
  assert.match(appearanceStyles, /\.appearance-trigger\.dap-ui-icon-button\s*\{[\s\S]*?width:\s*39px;[\s\S]*?height:\s*39px;[\s\S]*?border-radius:\s*999px/);
  assert.match(appHeader, /className="mainnav mainnav-measure" aria-hidden="true" inert/);
  assert.doesNotMatch(appStyles, /\.topbar-spacer/);
});

test("middle-width navigation derives its visible prefix from measured available space", () => {
  const compactHeader = appStyles.match(
    /@media \(max-width: 1199px\) and \(min-width: 769px\) \{[\s\S]*?\n\s{2}\}/,
  )?.[0] || "";
  const tabletHeader = appStyles.match(
    /@media \(769px <= width < 960px\) \{[\s\S]*?\n\s{2}\}/,
  )?.[0] || "";

  assert.match(appStyles, /\.search \{\s*position: relative;\s*width: clamp\(180px, 20vw, 360px\);/);
  assert.match(compactHeader, /\.search \{\s*width: 36px;[\s\S]*?flex-basis: 36px;/);
  assert.match(compactHeader, /\.search:focus-within,[\s\S]*?width: 196px;/);
  assert.match(appHeader, /new ResizeObserver\(measureNavigation\)/);
  assert.match(appHeader, /getNavigationPrimaryLimit\(visibleNavMenus, navigationFitMetrics\)/);
  assert.match(appHeader, /data-nav-measure-item=\{item\.code\}/);
  assert.doesNotMatch(appHeader, /maxPrimary:\s*compactHeader\s*\?/);
  assert.match(compactHeader, /\.search input \{\s*box-sizing: border-box;\s*padding: 0;/);
  assert.match(appStyles, /\.search \.clear \{[^}]*pointer-events: none/);
  assert.match(appStyles, /\.search\.has-val \.clear \{ opacity: 1; pointer-events: auto; \}/);
  assert.match(tabletHeader, /\.hamburger \{ display: grid/);
  assert.match(tabletHeader, /\.mainnav \{ display: none/);
  assert.match(appStyles, /@media \(width < 769px\)[\s\S]*?\.topbar-nav-slot \{\s*display: none;\s*\}/);
  assert.match(appStyles, /@media \(width < 769px\)[\s\S]*?\.search\.mobile-open \{ display: block; \}/);
  assert.match(appHeader, /id="global-search"/);
  assert.match(appHeader, /aria-label=\{tCommon\("search\.global"\)\}/);
  assert.match(appHeader, /<Input[\s\S]*?className="search-input"[\s\S]*?value=\{query\}/);
  assert.match(
    appHeader,
    /<Button[\s\S]*?className="clear"[\s\S]*?aria-label=\{tCommon\("search\.clear"\)\}[\s\S]*?onClick=\{onClearQuery\}/,
  );
});

test("More navigation uses the DAP DropdownMenu adapter with bounded Kumo content", () => {
  const menu = appStyles.match(/\.more-nav-menu\s*\{([^}]*)\}/)?.[1] || "";
  const menuItem = appStyles.match(/\.more-nav-menu-item\s*\{([^}]*)\}/)?.[1] || "";

  assert.match(appHeader, /import \{ Button, DropdownMenu, IconButton, Input \} from "\.\.\/\.\.\/ui\/index\.ts"/);
  assert.match(appHeader, /<DropdownMenu\.Trigger[\s\S]*?render=\{[\s\S]*?<Button/);
  assert.match(appHeader, /<DropdownMenu\.Content\s+id="more-nav-menu"\s+className=\{isHome \? "more-nav-menu portal-more-nav-menu" : "more-nav-menu"\}\s+align="end"\s+side="bottom"/);
  assert.match(appHeader, /<DropdownMenu\.Item[\s\S]*?selected=\{module === item\.code\}[\s\S]*?aria-current=\{module === item\.code \? "page" : undefined\}/);
  assert.match(menu, /width:\s*max-content/);
  assert.match(menu, /min-width:\s*156px/);
  assert.match(menu, /max-width:\s*min\(280px,\s*calc\(100vw - 32px\)\)/);
  assert.match(menu, /white-space:\s*normal/);
  assert.doesNotMatch(menu, /position:\s*absolute|top:|right:/);
  assert.match(menuItem, /width:\s*100%/);
  assert.match(menuItem, /justify-content:\s*flex-start/);
  assert.match(menuItem, /white-space:\s*nowrap/);
  assert.doesNotMatch(appHeader, /from "@cloudflare\/kumo\//);
  assert.doesNotMatch(app, /from "@cloudflare\/kumo\//);
});

test("primary navigation actions use the frozen DAP Button adapter", () => {
  assert.match(appHeader, /import \{ Button, DropdownMenu, IconButton, Input \} from "\.\.\/\.\.\/ui\/index\.ts"/);
  assert.match(
    appHeader,
    /navMenuStatus === "loading" \? \([\s\S]*?<Button type="button" variant="tertiary" size="sm" disabled className="navigation-message">/,
  );
  assert.match(
    appHeader,
    /navMenuStatus === "error" \? \([\s\S]*?<Button[\s\S]*?onClick=\{onRetryLoadMenus\}/,
  );
  assert.match(
    appHeader,
    /primaryNavMenus\.map\(\(item\) => \([\s\S]*?<Button[\s\S]*?variant="tertiary"[\s\S]*?className=\{module === item\.code \? "active" : ""\}[\s\S]*?onClick=\{\(\) => onSelectModule\(item\.code\)\}/,
  );
  assert.match(appHeader, /getNavigationPrimaryLimit\(visibleNavMenus, navigationFitMetrics\)/);
  assert.doesNotMatch(appHeader, /from "@cloudflare\/kumo\//);
});

test("More menu items keep selection and navigation inside the DAP DropdownMenu boundary", () => {
  const moreNavStart = appHeader.indexOf('<div className="more-nav">');
  const actionsStart = appHeader.indexOf('<div className="topbar-actions" ref={navActionsRef}>', moreNavStart);
  const moreNav = appHeader.slice(moreNavStart, actionsStart);

  assert.ok(moreNav.includes("<DropdownMenu open={moreNavOpen}"));
  assert.ok(moreNav.includes("className={`more-nav-trigger"));
  assert.ok(moreNav.includes("aria-controls=\"more-nav-menu\""));
  assert.ok(moreNav.includes("selected={module === item.code}"));
  assert.ok(moreNav.includes('aria-current={module === item.code ? "page" : undefined}'));
  assert.ok(moreNav.includes("setMoreNavOpen(false)"));
  assert.ok(moreNav.includes("onSelectModule(item.code)"));
  assert.doesNotMatch(moreNav, /role="menuitem"|<button/);
});

test("the shared header has one appearance entry beside the theme shortcut", () => {
  const actions = appHeader.slice(appHeader.indexOf('<div className="topbar-actions" ref={navActionsRef}>'));
  assert.match(actions, /<LanguageSwitcher \/>[\s\S]*?className="theme-toggle"[\s\S]*?<AppearanceSettings \/>[\s\S]*?<AuthBar/);
  assert.equal([...appHeader.matchAll(/<AppearanceSettings \/>/g)].length, 1);
  assert.equal([...app.matchAll(/<AppearanceSettings \/>/g)].length, 0);
  assert.doesNotMatch(actions, /accent-preset-group/);
});

test("theme trigger uses a DAP IconButton and preserves its dynamic label and title", () => {
  assert.ok(app.includes('const themeToggleLabel = theme === "dark" ? tCommon("theme.switchToLight") : tCommon("theme.switchToDark");'));
  assert.ok(appHeader.includes('<span className="theme-toggle-wrapper" title={themeToggleLabel}>'));
  assert.match(appHeader, /<IconButton[\s\S]*?type="button"[\s\S]*?variant="secondary"[\s\S]*?size="sm"[\s\S]*?className="theme-toggle"/);
  assert.ok(appHeader.includes("onClick={onToggleTheme}"));
  assert.ok(appHeader.includes("aria-label={themeToggleLabel}"));
  assert.ok(appHeader.includes('icon={<Icon name={theme === "dark" ? "sun" : "moon"} size={16} />}'));
  assert.match(appStyles, /\.theme-toggle-wrapper\s*\{\s*display:\s*inline-flex;\s*flex:\s*0 0 auto;\s*\}/);
  assert.doesNotMatch(appHeader, /<button\s+className="theme-toggle"/);
});
