import { expect, test, type Page, type TestInfo } from "@playwright/test";

const VIEWPORTS = [1440, 1024, 768, 390, 375] as const;

async function openPortal(page: Page) {
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
  await page.goto("/");
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
  await openPortal(page);
  const footer = page.locator("footer.app-footer-shell");
  const copy = footer.locator(".app-footer-copy");
  const link = footer.getByRole("link", { name: "GitHub ↗" });
  await expect(copy).toContainText("数据资产管理与血缘分析平台");
  await expect(copy).toContainText(/V\d+\.\d+\.\d+/);
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
