import { expect, test, type Page } from "@playwright/test";
import { appearanceKey, defaults, type AppearancePreferenceV1 } from "../src/appearance/preferences.ts";

const key = appearanceKey("/", process.env["VITE_APPEARANCE_SCOPE"]);
const configuredDefault = defaults(process.env["VITE_DEFAULT_ACCENT"]);
const fixture = "/__appearance";

async function openControls(page: Page) {
  await page.goto(fixture);
  await expect(page.getByTestId("saved-effects")).toBeVisible();
}

async function click(page: Page, name: string) {
  // WebKit can suspend animation frames in background tabs. Switch tabs
  // before user input so Playwright can check that the control is stable.
  await page.bringToFront();
  await page.getByRole("button", { name, exact: true }).click();
}
const stored = (page: Page) => page.evaluate((name) => JSON.parse(localStorage.getItem(name) ?? "null"), key);

test("blocking bootstrap applies the same legacy and v1 preferences before React", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.addInitScript(({ key }) => {
    if (!sessionStorage.getItem("seeded")) {
      localStorage.setItem("dap-theme", "dark");
      localStorage.setItem("dap-accent", "purple");
      localStorage.setItem(key, "{broken");
      sessionStorage.setItem("seeded", "true");
    }
  }, { key });
  let resume!: () => void;
  const blocked = new Promise<void>((resolve) => { resume = resolve; });
  await page.route(/\/src\/main\.tsx(?:\?.*)?$/, async (route) => {
    await blocked;
    await route.continue();
  });

  async function verifyHead(expected: Record<string, string>) {
    await page.goto("/", { waitUntil: "commit" });
    for (const [name, value] of Object.entries(expected)) {
      await expect(page.locator("html")).toHaveAttribute(`data-${name}`, value);
    }
    await expect(page.locator("#root")).toBeEmpty();
  }

  await verifyHead({ theme: "dark", mode: "dark", accent: "purple", density: "comfortable", effects: "off" });
  const saved: AppearancePreferenceV1 = {
    version: 1, themeMode: "light", accent: { kind: "custom", hex: "#01ABCD" },
    density: "compact", effects: "full",
  };
  await page.evaluate(({ key, saved }) => localStorage.setItem(key, JSON.stringify(saved)), { key, saved });
  const expected = { theme: "light", mode: "light", accent: "custom", density: "compact", effects: "off" };
  await verifyHead(expected);
  const palette = await page.locator("html").evaluate((root) => root.style.getPropertyValue("--accent"));
  expect(palette).toMatch(/^rgb\(/);
  resume();

  await expect(page.getByRole("button", { name: "切换到深色主题" })).toBeVisible();
  for (const [name, value] of Object.entries(expected)) {
    await expect(page.locator("html")).toHaveAttribute(`data-${name}`, value);
  }
  expect(await page.locator("html").evaluate((root) => root.style.getPropertyValue("--accent"))).toBe(palette);
  expect(await stored(page)).toEqual(saved);
});

test("system modes track media and retain explicit choices and the deployment default on reset", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
  await openControls(page);
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-mode", "system");
  await expect(html).toHaveAttribute("data-theme", "light");
  await expect(html).toHaveAttribute("data-accent", configuredDefault.accent.preset);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(html).toHaveAttribute("data-theme", "dark");
  const vendorMode = () => html.evaluate((root) => getComputedStyle(root).getPropertyValue("--text-color-kumo-inverse"));
  const systemDark = await vendorMode();
  await click(page, "dark");
  expect(await vendorMode()).toBe(systemDark);
  await click(page, "light");
  await expect(html).toHaveAttribute("data-theme", "light");
  expect(await vendorMode()).not.toBe(systemDark);
  await page.emulateMedia({ colorScheme: "light" });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(html).toHaveAttribute("data-theme", "light");

  await click(page, "full effects");
  await expect(html).toHaveAttribute("data-effects", "full");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(html).toHaveAttribute("data-effects", "off");
  await expect(page.getByTestId("saved-effects")).toHaveText("full");
  expect((await stored(page)).effects).toBe("full");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(html).toHaveAttribute("data-effects", "full");

  await click(page, "blue");
  await click(page, "compact");
  await click(page, "restore defaults");
  expect(await stored(page)).toEqual(configuredDefault);
  await expect(html).toHaveAttribute("data-mode", "system");
  await expect(html).toHaveAttribute("data-theme", "dark");
  await expect(html).toHaveAttribute("data-accent", configuredDefault.accent.preset);
});

test("tabs sync all fields without echo writes and reject invalid records", async ({ context, page }) => {
  await context.addInitScript((key) => {
    const setItem = Storage.prototype.setItem;
    let writes = 0;
    Storage.prototype.setItem = function (name, value) {
      if (this === localStorage && name === key) writes += 1;
      setItem.call(this, name, value);
    };
    document.addEventListener("dap-test-write-count", () => {
      document.documentElement.dataset.dapTestWrites = String(writes);
    });
  }, key);
  const other = await context.newPage();
  await openControls(page);
  await openControls(other);
  await click(page, "dark");
  await expect(other.locator("html")).toHaveAttribute("data-theme", "dark");
  await click(other, "light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await click(other, "compact");
  await click(other, "full effects");
  await click(other, "custom");
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-density", "compact");
  await expect(html).toHaveAttribute("data-effects", "full");
  await expect(html).toHaveAttribute("data-accent", "custom");
  await click(other, "invalid custom");
  expect((await stored(other)).accent).toEqual({ kind: "custom", hex: "#ffffff" });
  async function writes(tab: Page) {
    return tab.evaluate(() => {
      document.dispatchEvent(new Event("dap-test-write-count"));
      return Number(document.documentElement.dataset.dapTestWrites);
    });
  }
  expect(await writes(other)).toBe(4);
  expect(await writes(page)).toBe(1);
  await other.evaluate((key) => localStorage.setItem(key, "invalid"), key);
  // Wait for a second, unrelated storage event to ensure the invalid event was delivered.
  const delivered = page.evaluate(() => new Promise<void>((resolve) => {
    window.addEventListener("storage", function confirm(event) {
      if (event.key !== "dap-test-barrier") return;
      window.removeEventListener("storage", confirm);
      resolve();
    });
    document.documentElement.dataset.dapTestBarrier = "ready";
  }));
  await expect(html).toHaveAttribute("data-dap-test-barrier", "ready");
  await other.evaluate(() => localStorage.setItem("dap-test-barrier", "complete"));
  await delivered;
  await expect(html).toHaveAttribute("data-accent", "custom");
  expect(await writes(page)).toBe(1);
  await click(other, "restore defaults");
  await expect(html).toHaveAttribute("data-mode", "system");
  await click(other, "dark");
  await expect(html).toHaveAttribute("data-mode", "dark");
  await other.evaluate((key) => {
    localStorage.setItem("dap-theme", "dark");
    localStorage.setItem("dap-accent", "purple");
    localStorage.removeItem(key);
  }, key);
  await expect(html).toHaveAttribute("data-mode", "system");
  expect(await stored(page)).toBeNull();
  expect(await writes(page)).toBe(1);
  await page.reload();
  await expect(html).toHaveAttribute("data-mode", "system");
  await expect(html).toHaveAttribute("data-accent", configuredDefault.accent.preset);
});

test("StrictMode migration writes once and subscriptions are released on unmount", async ({ page }) => {
  await page.addInitScript((key) => {
    localStorage.setItem("dap-theme", "dark");
    localStorage.setItem("dap-accent", "purple");
    const nativeMatchMedia = window.matchMedia.bind(window);
    const active = new Map<string, number>();
    const write = Storage.prototype.setItem;
    let writes = 0;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) writes += 1;
      write.call(this, name, value);
    };
    window.matchMedia = (query) => {
      const list = nativeMatchMedia(query);
      const add = list.addEventListener.bind(list);
      const remove = list.removeEventListener.bind(list);
      list.addEventListener = (...args) => {
        if (args[0] === "change") active.set(query, (active.get(query) ?? 0) + 1);
        add(...args);
      };
      list.removeEventListener = (...args) => {
        if (args[0] === "change") active.set(query, (active.get(query) ?? 0) - 1);
        remove(...args);
      };
      return list;
    };
    const subscriptions = new Set();
    const add = window.addEventListener.bind(window);
    const remove = window.removeEventListener.bind(window);
    window.addEventListener = (...args) => {
      if (args[0] === "storage") subscriptions.add(args[1]);
      add(...args);
    };
    window.removeEventListener = (...args) => {
      if (args[0] === "storage") subscriptions.delete(args[1]);
      remove(...args);
    };
    document.addEventListener("dap-test-measure", () => {
      document.documentElement.dataset.dapTestMeasure = JSON.stringify([writes, ...active.values(), subscriptions.size]);
    });
  }, key);
  await openControls(page);
  const snapshot = () => page.evaluate(() => {
    document.dispatchEvent(new Event("dap-test-measure"));
    return JSON.parse(document.documentElement.dataset.dapTestMeasure!);
  });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-accent", "purple");
  expect(await snapshot()).toEqual([1, 1, 1, 1]);
  await click(page, "toggle provider");
  await expect(page.getByTestId("saved-effects")).toHaveCount(0);
  expect(await snapshot()).toEqual([1, 0, 0, 0]);
  await click(page, "toggle provider");
  await expect(page.getByTestId("saved-effects")).toBeVisible();
  expect(await snapshot()).toEqual([1, 1, 1, 1]);
});

test("blocked localStorage still allows the real app to mount and switch theme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", { get() { throw new DOMException("disabled", "SecurityError"); } });
  });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await click(page, "切换到浅色主题");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("open Kumo portals inherit updated accent and readable primary action colors", async ({ context, page }, testInfo) => {
  const writer = await context.newPage();
  await openControls(writer);
  await openControls(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await click(writer, "dark");
  const brand = (target: ReturnType<Page["locator"]>) => target.evaluate((element) => {
    return getComputedStyle(element).getPropertyValue("--color-kumo-brand").trim();
  });
  const checkActivePortal = async (popup: ReturnType<Page["locator"]>, nextAccent: string) => {
    await expect(popup).toBeVisible();
    expect(await popup.evaluate((element) => element.closest("#root"))).toBeNull();
    const previous = await brand(popup);
    await click(writer, nextAccent);
    await expect.poll(() => brand(popup)).not.toBe(previous);
    expect(await brand(popup)).toBe(await brand(page.locator("html")));
    await expect(popup).toBeVisible();
    await page.bringToFront();
  };

  await page.bringToFront();
  await page.getByTestId("open-kumo-dialog").click();
  const dialog = page.getByRole("dialog", { name: "字段映射确认" });
  await checkActivePortal(dialog, "blue");
  const action = dialog.getByTestId("close-kumo-dialog");
  await expect(action).toHaveCSS("color", "rgb(0, 0, 0)");
  await expect(action).toHaveCSS("background-color", await page.locator("html").evaluate((element) => {
    return getComputedStyle(element).getPropertyValue("--accent-strong").replaceAll(",", ", ");
  }));
  await page.screenshot({ path: testInfo.outputPath("appearance-dark-blue-dialog-1440.png") });
  await action.click();
  await expect(dialog).toBeHidden();
  await page.getByRole("combobox", { name: "上游系统" }).click();
  const select = page.getByRole("listbox");
  await checkActivePortal(select, "orange");
  await page.keyboard.press("Escape");
  await expect(select).toBeHidden();
  await page.getByTestId("open-kumo-menu").click();
  await checkActivePortal(page.getByRole("menu"), "custom");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toBeHidden();
  await click(writer, "green");
  await expect(page.locator("html")).toHaveAttribute("data-accent", "green");
  expect(await page.locator("html").evaluate((root) => root.style.getPropertyValue("--accent"))).toBe("");
});

for (const width of [390, 1440]) {
  test(`portal Appearance screenshot matrix at ${width}px`, async ({ context, page }, testInfo) => {
    const writer = await context.newPage();
    await openControls(writer);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    for (const [theme, accent] of [["light", "green"], ["dark", "purple"], ["light", "orange"], ["dark", "blue"]]) {
      await click(writer, theme!);
      await click(writer, accent!);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme!);
      await expect(page.locator("html")).toHaveAttribute("data-accent", accent!);
      await expect(page.getByRole("button", { name: theme === "dark" ? "切换到浅色主题" : "切换到深色主题" })).toBeVisible();
      await page.bringToFront();
      await page.screenshot({ path: testInfo.outputPath(`appearance-${theme}-${accent}-${width}.png`) });
    }
  });
}
