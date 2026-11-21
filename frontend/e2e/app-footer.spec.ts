import { expect, test, type Page, type TestInfo } from "@playwright/test";

const VIEWPORTS = [1440, 1024, 768, 390, 375] as const;

async function openPage(page: Page, path = "/") {
  await page.addInitScript(() => {
    localStorage.removeItem("dap_auth");
    sessionStorage.removeItem("dap_auth");
    localStorage.setItem("dap-theme", "light");
  });
  await page.route("**/api/search/hot-keywords", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ items: [] }),
  }));
  await page.goto(path);
  await expect(page.locator("footer.app-footer-shell")).toBeVisible();
}

function parseColor(value: string): [number, number, number] {
  const hex = value.trim().match(/^#([\da-f]{3}|[\da-f]{6})$/i)?.[1];
  if (hex) {
    const expanded = hex.length === 3 ? [...hex].map((digit) => `${digit}${digit}`).join("") : hex;
    return [0, 2, 4].map((offset) => Number.parseInt(expanded.slice(offset, offset + 2), 16)) as [number, number, number];
  }
  const rgb = value.match(/rgba?\(([^)]+)\)/i)?.[1];
  if (rgb) {
    const channels = rgb.split(/[\s,\/]+/).filter(Boolean).slice(0, 3).map(Number);
    if (channels.length === 3 && channels.every(Number.isFinite)) return channels as [number, number, number];
  }
  throw new Error(`Unsupported computed CSS color: ${value}`);
}

function relativeLuminance(color: [number, number, number]): number {
  const linear = color.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(foreground: string, background: string): number {
  const first = relativeLuminance(parseColor(foreground));
  const second = relativeLuminance(parseColor(background));
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

test("global footer stays compact, readable, responsive, and outside main scrolling", async ({ page }, testInfo: TestInfo) => {
  await openPage(page, "/data-warehouse");
  const footer = page.locator("footer.app-footer-shell");
  const copy = footer.locator(".app-footer-copy");
  const release = footer.getByRole("link", { name: /^v\d+\.\d+\.\d+$/ });
  const link = footer.getByRole("link", { name: "GitHub ↗" });
  await expect(copy).toContainText("数据资产门户");
  await expect(copy).toContainText(/v\d+\.\d+\.\d+/);
  await expect(release).toHaveAttribute("href", /^https:\/\/github\.com\/0verme\/data-asset-portal-community\/releases\/tag\/v\d+\.\d+\.\d+$/);
  await expect(release).toHaveAttribute("target", "_blank");
  await expect(release).toHaveAttribute("rel", "noopener noreferrer");
  await expect(link).toHaveAttribute("href", "https://github.com/0verme/data-asset-portal-community");
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  const measurements: Array<Record<string, number | string>> = [];
  for (const theme of ["light", "dark"] as const) {
    const currentTheme = await page.locator("html").getAttribute("data-theme");
    if (currentTheme !== theme) {
      await page.getByRole("button", {
        name: currentTheme === "dark" ? "切换到浅色主题" : "切换到深色主题",
      }).click();
    }
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    // Business pages retain the shared hover transition. Measure their settled colors.
    await expect.poll(() => link.evaluate((element) => getComputedStyle(element).color))
      .toBe(await copy.evaluate((element) => getComputedStyle(element).color));

    for (const width of VIEWPORTS) {
      await page.setViewportSize({ width, height: 900 });
      const metrics = await page.evaluate(() => {
        const shell = document.querySelector<HTMLElement>("footer.app-footer-shell");
        const copyElement = shell?.querySelector<HTMLElement>(".app-footer-copy");
        const linkElement = shell?.querySelector<HTMLElement>(".app-footer-link");
        const app = document.querySelector<HTMLElement>(".app");
        if (!shell || !copyElement || !linkElement || !app) throw new Error("Footer shell is incomplete");
        const shellRect = shell.getBoundingClientRect();
        const copyRect = copyElement.getBoundingClientRect();
        const linkRect = linkElement.getBoundingClientRect();
        const appRect = app.getBoundingClientRect();
        return {
          viewport: window.innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          shellHeight: shellRect.height,
          shellLeft: shellRect.left,
          shellRight: shellRect.right,
          copyLeft: copyRect.left,
          copyRight: copyRect.right,
          linkLeft: linkRect.left,
          linkRight: linkRect.right,
          appBottom: appRect.bottom,
          shellBottom: shellRect.bottom,
          copyColor: getComputedStyle(copyElement).color,
          linkColor: getComputedStyle(linkElement).color,
          surfaceColor: getComputedStyle(document.documentElement).getPropertyValue("--surface").trim(),
        };
      });
      const copyContrast = contrastRatio(String(metrics.copyColor), String(metrics.surfaceColor));
      const linkContrast = contrastRatio(String(metrics.linkColor), String(metrics.surfaceColor));
      measurements.push({ theme, width, ...metrics, copyContrast, linkContrast });

      if (width === 1440 || width === 390) {
        await page.screenshot({ path: testInfo.outputPath(`footer-${theme}-${width}.png`), fullPage: true });
      }
    }

    await page.setViewportSize({ width: 375, height: 900 });
    await link.hover();
    const hoveredLink = await page.evaluate(() => {
      const element = document.querySelector<HTMLElement>(".app-footer-link");
      if (!element) throw new Error("GitHub footer link is missing");
      return {
        color: getComputedStyle(element).color,
        surface: getComputedStyle(document.documentElement).getPropertyValue("--surface").trim(),
      };
    });
    expect(contrastRatio(hoveredLink.color, hoveredLink.surface), `${theme} 375px: hovered GitHub link contrast`).toBeGreaterThanOrEqual(4.5);
    await page.mouse.move(0, 0);
  }

  console.log("footer responsive measurements", JSON.stringify(measurements));
  await testInfo.attach("footer-responsive-measurements", {
    body: JSON.stringify(measurements, null, 2),
    contentType: "application/json",
  });
  for (const measurement of measurements) {
    const viewport = Number(measurement["viewport"]);
    const theme = String(measurement["theme"]);
    expect.soft(measurement["documentWidth"], `${theme} ${viewport}px: no horizontal overflow`).toBeLessThanOrEqual(viewport);
    expect.soft(measurement["shellLeft"], `${theme} ${viewport}px: footer left edge`).toBeGreaterThanOrEqual(0);
    expect.soft(measurement["shellRight"], `${theme} ${viewport}px: footer right edge`).toBeLessThanOrEqual(viewport);
    expect.soft(measurement["copyLeft"], `${theme} ${viewport}px: brand/version left edge`).toBeGreaterThanOrEqual(0);
    expect.soft(measurement["copyRight"], `${theme} ${viewport}px: brand/version right edge`).toBeLessThanOrEqual(viewport);
    expect.soft(measurement["linkLeft"], `${theme} ${viewport}px: GitHub link left edge`).toBeGreaterThanOrEqual(0);
    expect.soft(measurement["linkRight"], `${theme} ${viewport}px: GitHub link right edge`).toBeLessThanOrEqual(viewport);
    expect.soft(measurement["shellHeight"], `${theme} ${viewport}px: footer height`).toBeGreaterThanOrEqual(36);
    expect.soft(measurement["shellHeight"], `${theme} ${viewport}px: footer height`).toBeLessThanOrEqual(44);
    expect.soft(measurement["copyContrast"], `${theme} ${viewport}px: copy contrast against --surface`).toBeGreaterThanOrEqual(4.5);
    expect.soft(measurement["linkContrast"], `${theme} ${viewport}px: link contrast against --surface`).toBeGreaterThanOrEqual(4.5);
    expect.soft(Math.abs(Number(measurement["appBottom"]) - Number(measurement["shellBottom"])), `${theme} ${viewport}px: short-page footer sits at shell bottom`).toBeLessThanOrEqual(1);
  }

  await link.focus();
  await expect(link).toBeFocused();
  await page.setViewportSize({ width: 375, height: 844 });
  const beforeLongContent = await footer.boundingBox();
  await page.locator(".main-inner").evaluate((container) => {
    const spacer = document.createElement("div");
    spacer.dataset["footerScrollProbe"] = "true";
    spacer.setAttribute("aria-hidden", "true");
    spacer.style.height = "1800px";
    spacer.style.pointerEvents = "none";
    container.append(spacer);
  });
  const main = page.locator(".main");
  await expect.poll(() => main.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  await main.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  const longPageMetrics = await page.evaluate(() => {
    const main = document.querySelector<HTMLElement>(".main");
    const shell = document.querySelector<HTMLElement>("footer.app-footer-shell");
    const spacer = document.querySelector<HTMLElement>("[data-footer-scroll-probe]");
    if (!main || !shell || !spacer) throw new Error("Long-page probe is incomplete");
    return {
      mainScrollTop: main.scrollTop,
      mainClientHeight: main.clientHeight,
      mainScrollHeight: main.scrollHeight,
      mainBottom: main.getBoundingClientRect().bottom,
      shellTop: shell.getBoundingClientRect().top,
      spacerBottom: spacer.getBoundingClientRect().bottom,
    };
  });
  console.log("footer long-page measurements", JSON.stringify(longPageMetrics));
  expect(longPageMetrics.mainScrollTop).toBeGreaterThan(0);
  expect(longPageMetrics.spacerBottom).toBeLessThanOrEqual(longPageMetrics.mainBottom + 1);
  expect(longPageMetrics.mainBottom).toBeLessThanOrEqual(longPageMetrics.shellTop + 1);
  expect(await footer.boundingBox()).toEqual(beforeLongContent);
  await testInfo.attach("footer-long-page-measurements", {
    body: JSON.stringify(longPageMetrics, null, 2),
    contentType: "application/json",
  });
});


test("homepage footer shares the global footer treatment and follows its content", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1024 });
  const githubApiRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith("https://api.github.com/")) githubApiRequests.push(request.url());
  });
  await openPage(page);
  const main = page.locator(".portal-home-main");
  const footer = main.getByRole("contentinfo");
  const copy = footer.locator(".app-footer-copy");
  const release = footer.getByRole("link", { name: /^v\d+\.\d+\.\d+$/ });
  const link = footer.getByRole("link", { name: "GitHub ↗" });
  const panel = main.locator(".sp-stats");
  await expect(panel.locator(".sp-stat-num")).toHaveCount(11);
  await expect(copy).toHaveText(/^数据资产门户 v\d+\.\d+\.\d+$/);
  await expect(release).toHaveAttribute("href", /^https:\/\/github\.com\/0verme\/data-asset-portal-community\/releases\/tag\/v\d+\.\d+\.\d+$/);
  await expect(footer.locator(".app-footer-separator")).toHaveCount(0);
  await expect(footer).toHaveCSS("border-top-width", "0px");
  await expect(footer).toHaveCSS("border-top-style", "none");
  await expect(link).toHaveAttribute("href", "https://github.com/0verme/data-asset-portal-community");
  await expect(footer).toBeInViewport({ ratio: 1 });
  const shortFooter = (await footer.boundingBox())!;
  expect(shortFooter.y + shortFooter.height).toBeCloseTo(1024, 0);

  async function switchThemeAndSample(target: "light" | "dark") {
    const samples = await link.evaluate((element, targetTheme) => new Promise<Array<[string, string, string]>>((resolve, reject) => {
      const root = document.documentElement;
      const button = document.querySelector<HTMLButtonElement>("header .theme-toggle");
      if (!button) { reject(new Error("Theme shortcut is missing")); return; }
      const colors: Array<[string, string, string]> = [];
      const sample = () => {
        const tokens = getComputedStyle(root);
        colors.push([
          getComputedStyle(element).color,
          tokens.getPropertyValue("--surface"),
          tokens.getPropertyValue("--bg"),
        ]);
      };
      const observer = new MutationObserver(() => {
        if (root.dataset["theme"] !== targetTheme) return;
        observer.disconnect();
        sample();
        requestAnimationFrame(() => {
          sample();
          requestAnimationFrame(() => { sample(); resolve(colors); });
        });
      });
      observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
      button.click();
    }), target);
    await expect(page.locator("html")).toHaveAttribute("data-theme", target);
    for (const [foreground, surface, background] of samples) {
      expect(contrastRatio(foreground, surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
    }
    const resolvedForeground = await link.evaluate((element) => getComputedStyle(element).color);
    expect(samples.every(([foreground]) => foreground === resolvedForeground)).toBe(true);
  }
  await switchThemeAndSample("dark");
  await switchThemeAndSample("light");

  await page.getByRole("button", { name: "切换到英文" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
  await expect(copy).toHaveText(/^Data Asset Portal v\d+\.\d+\.\d+$/);
  await expect(release).toHaveAttribute("href", /^https:\/\/github\.com\/0verme\/data-asset-portal-community\/releases\/tag\/v\d+\.\d+\.\d+$/);
  await page.getByRole("button", { name: "Switch language to Chinese" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");

  for (const viewport of [{ width: 1920, height: 1080 }, { width: 2560, height: 1440 }]) {
    await page.setViewportSize(viewport);
    await expect(footer).toBeInViewport({ ratio: 1 });
    const metrics = await page.evaluate(() => {
      const footerElement = document.querySelector<HTMLElement>(".portal-home-main > .app-footer-shell");
      const copyElement = footerElement?.querySelector<HTMLElement>(".app-footer-copy");
      const releaseElement = footerElement?.querySelector<HTMLElement>(".app-footer-version");
      const githubElement = footerElement?.querySelector<HTMLElement>(".app-footer-link");
      if (!footerElement || !copyElement || !releaseElement || !githubElement) throw new Error("Homepage footer is incomplete");
      return {
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        left: Math.min(footerElement.getBoundingClientRect().left, copyElement.getBoundingClientRect().left),
        right: Math.max(footerElement.getBoundingClientRect().right, githubElement.getBoundingClientRect().right, releaseElement.getBoundingClientRect().right),
      };
    });
    expect(metrics.documentWidth).toBeLessThanOrEqual(viewport.width);
    expect(metrics.left).toBeGreaterThanOrEqual(0);
    expect(metrics.right).toBeLessThanOrEqual(viewport.width);
  }
  await page.setViewportSize({ width: 1440, height: 1024 });
  expect(githubApiRequests).toEqual([]);

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await main.evaluate((element) => { element.scrollTop = 0; });
    await expect(footer).not.toBeInViewport();
    await link.scrollIntoViewIfNeeded();
    await expect(link).toBeInViewport({ ratio: 1 });
    const scrollOffset = await main.evaluate((element) => element.scrollTop);
    expect(scrollOffset).toBeGreaterThan(0);
    expect((await panel.boundingBox())!.y + (await panel.boundingBox())!.height)
      .toBeLessThan((await footer.boundingBox())!.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }

  await page.goto("/no-such-page");
  await expect(page.getByRole("heading", { name: /404/ })).toBeVisible();
  await expect(page.locator(".app > .app-footer-shell")).toHaveCSS("border-top-width", "0px");
  await expect(page.locator(".portal-home-footer")).toHaveCount(0);
});
