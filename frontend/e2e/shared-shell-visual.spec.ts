import { expect, test, type Page, type TestInfo } from "@playwright/test";

const ROUTES = [
  { name: "home", path: "/", activeModule: null },
  { name: "upstream", path: "/upstream", activeModule: "上游卸数" },
  { name: "warehouse", path: "/data-warehouse", activeModule: "数据仓库" },
] as const;

const VIEWPORTS = [
  { name: "1080p", width: 1920, height: 1080 },
  { name: "2k", width: 2560, height: 1440 },
  { name: "mobile", width: 390, height: 844 },
] as const;

async function prepareGuestPage(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.removeItem("dap_auth");
    sessionStorage.removeItem("dap_auth");
    localStorage.setItem("dap-theme", "light");
  });
}

async function openRoute(page: Page, path: string, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.goto(path);
  if (path === "/") {
    await expect(page.locator(".sp-stats .sp-stat-num")).toHaveCount(11);
  } else if (path.startsWith("/upstream")) {
    await expect(page.locator(".upstream-list-page .page-title")).toBeVisible({ timeout: 20_000 });
  } else {
    await expect(page.locator(".main")).toContainText("共 224 张表", { timeout: 20_000 });
  }
  await expect(page.locator("footer.app-footer-shell")).toBeVisible();
}

async function navStyle(page: Page) {
  return page.locator(".topbar-nav-slot > .mainnav:not(.mainnav-measure)").evaluate((nav) => {
    const style = getComputedStyle(nav);
    return {
      height: style.height,
      gap: style.gap,
      padding: style.padding,
      background: style.backgroundColor,
      border: `${style.borderTopWidth} ${style.borderTopStyle} ${style.borderTopColor}`,
      radius: style.borderRadius,
      shadow: style.boxShadow,
      itemRadius: getComputedStyle(nav.querySelector("button")!).borderRadius,
      itemPadding: getComputedStyle(nav.querySelector("button")!).padding,
    };
  });
}

async function navGeometry(page: Page) {
  return page.evaluate(() => {
    const nav = document.querySelector<HTMLElement>(".topbar-nav-slot > .mainnav:not(.mainnav-measure)");
    const brand = document.querySelector<HTMLElement>(".topbar-brand");
    const actions = document.querySelector<HTMLElement>(".topbar-actions");
    if (!nav || !brand || !actions) throw new Error("Shared header is incomplete");
    const navRect = nav.getBoundingClientRect();
    const brandRect = brand.getBoundingClientRect();
    const actionsRect = actions.getBoundingClientRect();
    return {
      documentWidth: document.documentElement.scrollWidth,
      navLeft: navRect.left,
      navRight: navRect.right,
      navClientWidth: nav.clientWidth,
      navScrollWidth: nav.scrollWidth,
      brandRight: brandRect.right,
      actionsLeft: actionsRect.left,
    };
  });
}

test("shared capsule navigation matches across home and business modules", async ({ page }, info: TestInfo) => {
  test.setTimeout(180_000);
  await prepareGuestPage(page);
  const desktopStyles = new Map<number, Awaited<ReturnType<typeof navStyle>>>();
  let sharedHoverStyle: { color: string; background: string } | undefined;
  let sharedActiveStyle: { color: string; background: string; shadow: string; weight: string } | undefined;

  for (const route of ROUTES) {
    for (const viewport of VIEWPORTS) {
      await openRoute(page, route.path, viewport.width, viewport.height);
      const header = page.locator("header.topbar");
      const nav = page.locator(".topbar-nav-slot > .mainnav:not(.mainnav-measure)");

      await expect(header).toHaveCSS("border-bottom-width", "0px");
      await expect(header).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");

      if (viewport.width >= 769) {
        await expect(nav).toBeVisible();
        await expect(nav.getByRole("button", { name: "数据仓库", exact: true })).toBeVisible();
        const currentStyle = await navStyle(page);
        expect(currentStyle.radius).toBe("999px");
        expect(currentStyle.itemRadius).toBe("999px");
        expect(currentStyle.gap).toBe("0px");
        expect(currentStyle.border).toContain("1px solid");
        expect(desktopStyles.get(viewport.width) ?? currentStyle).toEqual(currentStyle);
        desktopStyles.set(viewport.width, currentStyle);

        const geometry = await navGeometry(page);
        expect(geometry.documentWidth).toBeLessThanOrEqual(viewport.width + 1);
        expect(geometry.navScrollWidth).toBeLessThanOrEqual(geometry.navClientWidth + 1);
        expect(geometry.navLeft).toBeGreaterThanOrEqual(geometry.brandRight);
        expect(geometry.navRight).toBeLessThanOrEqual(geometry.actionsLeft);

        const hoverTarget = nav.getByRole("button", { name: "字段映射", exact: true });
        await hoverTarget.hover();
        const expectedHoverColor = await page.evaluate(() => {
          const probe = document.createElement("span");
          probe.style.color = "var(--ink)";
          document.body.append(probe);
          const color = getComputedStyle(probe).color;
          probe.remove();
          return color;
        });
        await expect.poll(() => hoverTarget.evaluate((element) => getComputedStyle(element).color))
          .toBe(expectedHoverColor);
        const hoverStyle = await hoverTarget.evaluate((element) => ({
          color: getComputedStyle(element).color,
          background: getComputedStyle(element).backgroundColor,
        }));
        if (sharedHoverStyle) expect(hoverStyle).toEqual(sharedHoverStyle);
        else sharedHoverStyle = hoverStyle;
        await page.mouse.move(0, 0);

        if (route.activeModule) {
          const selected = nav.getByRole("button", { name: route.activeModule, exact: true });
          await expect(selected).toHaveClass(/active/);
          const selectedStyle = await selected.evaluate((element) => ({
            color: getComputedStyle(element).color,
            background: getComputedStyle(element).backgroundColor,
            shadow: getComputedStyle(element).boxShadow,
            weight: getComputedStyle(element).fontWeight,
          }));
          if (sharedActiveStyle) expect(selectedStyle).toEqual(sharedActiveStyle);
          else sharedActiveStyle = selectedStyle;
        }

        await page.screenshot({
          path: info.outputPath(`shared-shell-header-${route.name}-${viewport.name}.png`),
          animations: "disabled",
        });
      } else {
        await expect(nav).toBeHidden();
        const hamburger = header.getByRole("button", { name: "打开导航" });
        await expect(hamburger).toBeVisible();
        const geometry = await page.evaluate(() => {
          const header = document.querySelector<HTMLElement>("header.topbar")!;
          const logo = header.querySelector<HTMLElement>(".brand-mark")!.getBoundingClientRect();
          const brand = header.querySelector<HTMLElement>(".topbar-brand")!.getBoundingClientRect();
          const actions = header.querySelector<HTMLElement>(".topbar-actions")!.getBoundingClientRect();
          const menu = header.querySelector<HTMLElement>(".hamburger")!.getBoundingClientRect();
          return {
            documentWidth: document.documentElement.scrollWidth,
            logoLeft: logo.left,
            menuRight: menu.right,
            brandRight: brand.right,
            actionsLeft: actions.left,
            actionsRight: actions.right,
          };
        });
        expect(geometry.documentWidth).toBeLessThanOrEqual(viewport.width + 1);
        expect(geometry.menuRight).toBeLessThanOrEqual(geometry.logoLeft);
        expect(geometry.brandRight).toBeLessThanOrEqual(geometry.actionsLeft);
        expect(geometry.actionsRight).toBeLessThanOrEqual(viewport.width);

        await page.screenshot({
          path: info.outputPath(`shared-shell-header-${route.name}-${viewport.name}.png`),
          animations: "disabled",
        });
        await hamburger.click();
        const drawer = page.locator("#mobile-sidebar");
        await expect(drawer).toHaveClass(/open/);
        if (route.activeModule) {
          await expect(drawer.locator(".mobile-module-link.active")).toContainText(route.activeModule);
        }
        await page.keyboard.press("Escape");
        await expect(drawer).toBeHidden();
        await expect(hamburger).toBeFocused();
      }
    }
  }
});

test("shared footer matches on home, upstream, and warehouse across themes and sizes", async ({ page }, info: TestInfo) => {
  test.setTimeout(180_000);
  await prepareGuestPage(page);
  const sharedFooterStyles = new Map<string, Record<string, string>>();

  for (const theme of ["light", "dark"] as const) {
    for (const route of ROUTES) {
      for (const viewport of VIEWPORTS) {
        await openRoute(page, route.path, viewport.width, viewport.height);
        const root = page.locator("html");
        const currentTheme = await root.getAttribute("data-theme");
        if (currentTheme !== theme) {
          await page.getByRole("button", {
            name: currentTheme === "dark" ? "切换到浅色主题" : "切换到深色主题",
          }).click();
        }
        await expect(root).toHaveAttribute("data-theme", theme);

        const footer = page.locator("footer.app-footer-shell");
        const release = footer.getByRole("link", { name: /^v\d+\.\d+\.\d+$/ });
        const github = footer.getByRole("link", { name: "GitHub ↗" });
        await expect(footer.locator(".app-footer-copy")).toContainText("数据资产门户");
        await expect(release).toHaveAttribute("href", /^https:\/\/github\.com\/0verme\/data-asset-portal-community\/releases\/tag\/v\d+\.\d+\.\d+$/);
        await expect(github).toHaveAttribute("href", "https://github.com/0verme/data-asset-portal-community");
        await expect(footer.locator(".app-footer-separator")).toHaveCount(0);

        await page.mouse.move(0, 0);
        await footer.scrollIntoViewIfNeeded();
        await expect.poll(() => github.evaluate((element) => getComputedStyle(element).color))
          .toBe(await footer.locator(".app-footer-copy").evaluate((element) => getComputedStyle(element).color));
        const sample = await page.evaluate(() => {
          const shell = document.querySelector<HTMLElement>("footer.app-footer-shell")!;
          const content = shell.querySelector<HTMLElement>(".app-footer")!;
          const copy = shell.querySelector<HTMLElement>(".app-footer-copy")!;
          const link = shell.querySelector<HTMLElement>(".app-footer-link")!;
          const main = document.querySelector<HTMLElement>(".main")!;
          const mainInner = main.querySelector<HTMLElement>(".main-inner")!;
          const shellStyle = getComputedStyle(shell);
          const contentStyle = getComputedStyle(content);
          const shellRect = shell.getBoundingClientRect();
          const mainRect = main.getBoundingClientRect();
          const mainInnerRect = mainInner.getBoundingClientRect();
          return {
            style: {
              background: shellStyle.backgroundColor,
              border: `${shellStyle.borderTopWidth} ${shellStyle.borderTopStyle} ${shellStyle.borderTopColor}`,
              padding: shellStyle.padding,
              position: shellStyle.position,
              contentFont: contentStyle.font,
              contentColor: contentStyle.color,
              contentGap: contentStyle.gap,
              contentAlignment: `${contentStyle.alignItems}/${contentStyle.justifyContent}`,
              copyColor: getComputedStyle(copy).color,
              linkColor: getComputedStyle(link).color,
            },
            geometry: {
              viewportWidth: window.innerWidth,
              viewportHeight: window.innerHeight,
              documentWidth: document.documentElement.scrollWidth,
              shellLeft: shellRect.left,
              shellRight: shellRect.right,
              shellTop: shellRect.top,
              shellBottom: shellRect.bottom,
              mainBottom: mainRect.bottom,
              mainInnerBottom: mainInnerRect.bottom,
              isHome: main.classList.contains("portal-home-main"),
            },
          };
        });

        const styleKey = `${theme}-${viewport.name}`;
        const sharedStyle = sharedFooterStyles.get(styleKey);
        if (sharedStyle) expect(sample.style).toEqual(sharedStyle);
        else sharedFooterStyles.set(styleKey, sample.style);
        expect(sample.style.border).toContain("0px none");
        expect(sample.style.position).toBe("static");
        expect(sample.geometry.documentWidth).toBeLessThanOrEqual(viewport.width + 1);
        expect(sample.geometry.shellLeft).toBeGreaterThanOrEqual(0);
        expect(sample.geometry.shellRight).toBeLessThanOrEqual(viewport.width + 1);
        expect(sample.geometry.shellBottom).toBeLessThanOrEqual(viewport.height + 1);
        if (sample.geometry.isHome) {
          expect(sample.geometry.mainInnerBottom).toBeLessThanOrEqual(sample.geometry.shellTop + 1);
          if (viewport.width >= 769) {
            expect(sample.geometry.shellBottom).toBeCloseTo(viewport.height, 0);
          }
        } else {
          expect(sample.geometry.mainBottom).toBeLessThanOrEqual(sample.geometry.shellTop + 1);
          expect(sample.geometry.shellBottom).toBeCloseTo(viewport.height, 0);
        }

        if (theme === "light") {
          await page.screenshot({
            path: info.outputPath(`shared-shell-footer-${route.name}-${viewport.name}.png`),
            animations: "disabled",
          });
        }
      }
    }
  }
});
