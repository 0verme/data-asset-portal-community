import { expect, test, type Page } from "@playwright/test";
import type { DataOrbProps } from "../src/components/portal/orb/DataOrb";

type Failure = "missing-api" | "policy-null" | "context-null" | "throw" | "precision" | "compile" | "link";
type Draw = { time: number; width: number; center?: number[] };

declare global {
  interface Window {
    updateOrb: (update: Partial<DataOrbProps> & { mounted?: boolean }) => void;
    orbProbe: {
      contexts: number;
      released: number;
      draws: Draw[];
      pending: Set<number>;
      setHidden: (hidden: boolean) => void;
      loseContext: () => void;
      supported: boolean;
      canLose: boolean;
    };
  }
}

const fixture = "/e2e/fixtures/data-orb/index.html";
const canvas = ".data-orb canvas";
const fallback = ".data-orb__static";

async function instrument(page: Page, mode: "native" | "mock", failure?: Failure) {
  await page.addInitScript(({ mode, failure }) => {
    let activeCanvas: HTMLCanvasElement | undefined;
    let hidden = false;
    const probe: Window["orbProbe"] = {
      contexts: 0,
      released: 0,
      supported: false,
      canLose: false,
      draws: [],
      pending: new Set(),
      setHidden(next) {
        hidden = next;
        document.dispatchEvent(new Event("visibilitychange"));
      },
      loseContext() {
        activeCanvas?.dispatchEvent(new Event("webglcontextlost"));
      },
    };
    window.orbProbe = probe;

    Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
    const start = window.requestAnimationFrame.bind(window);
    const cancel = window.cancelAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => {
      const id = start((now) => {
        probe.pending.delete(id);
        cb(now);
      });
      probe.pending.add(id);
      return id;
    };
    window.cancelAnimationFrame = (id) => {
      probe.pending.delete(id);
      cancel(id);
    };

    const getContext = HTMLCanvasElement.prototype.getContext;
    const drawArrays = WebGLRenderingContext.prototype.drawArrays;
    WebGLRenderingContext.prototype.drawArrays = function (this: WebGLRenderingContext, ...args) {
      drawArrays.apply(this, args);
      if (this.canvas !== activeCanvas) return;
      const sample = new Uint8Array(4);
      const width = this.drawingBufferWidth;
      this.readPixels(width >> 1, this.drawingBufferHeight >> 1, 1, 1, this.RGBA, this.UNSIGNED_BYTE, sample);
      probe.draws.push({ time: performance.now(), width, center: Array.from(sample) });
    };

    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value(this: HTMLCanvasElement, type: string, options?: WebGLContextAttributes) {
        if (type !== "webgl") return Reflect.apply(getContext, this, [type, options]);
        probe.contexts++;
        activeCanvas = this;
        if (failure === "throw") throw new Error("Injected getContext exception");
        if (failure === "context-null" || (failure === "policy-null" && options?.failIfMajorPerformanceCaveat)) return null;
        if (mode === "native") {
          const gl = Reflect.apply(getContext, this, [type, options]) as WebGLRenderingContext | null;
          const loss = gl?.getExtension("WEBGL_lose_context");
          probe.supported = Boolean(gl?.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)?.precision);
          probe.canLose = Boolean(loss);
          probe.loseContext = () => loss?.loseContext();
          return gl;
        }
        return {
          NO_ERROR: 0,
          isContextLost: () => false,
          getShaderPrecisionFormat: () => ({ precision: failure === "precision" ? 0 : 23 }),
          createShader: () => ({}),
          createProgram: () => ({}),
          createBuffer: () => ({}),
          getShaderParameter: () => failure !== "compile",
          getProgramParameter: () => failure !== "link",
          getAttribLocation: () => 0,
          getUniformLocation: () => ({}),
          getError: () => 0,
          getExtension: () => ({ loseContext: () => { probe.released++; } }),
          shaderSource() {},
          compileShader() {},
          attachShader() {},
          detachShader() {},
          linkProgram() {},
          deleteShader() {},
          useProgram() {},
          deleteProgram() {},
          deleteBuffer() {},
          bindBuffer() {},
          bufferData() {},
          enableVertexAttribArray() {},
          vertexAttribPointer() {},
          uniform1f() {},
          uniform2f() {},
          uniform3f() {},
          viewport() {},
          drawArrays: () => probe.draws.push({ time: performance.now(), width: activeCanvas!.width }),
        };
      },
    });
    if (failure === "missing-api") Reflect.deleteProperty(HTMLCanvasElement.prototype, "getContext");
  }, { mode, failure });
}

const stats = (page: Page) => page.evaluate(() => {
  const { contexts, released, draws, pending } = window.orbProbe;
  return { contexts, released, draws: draws.length, pending: pending.size };
});

async function expectStatic(page: Page) {
  await expect(page.locator(canvas)).toHaveCount(0);
  await expect(page.locator(fallback)).toBeVisible();
  expect(await page.locator(fallback).evaluate((element) => {
    const sphere = getComputedStyle(element, "::after");
    const halo = getComputedStyle(element, "::before");
    return {
      sphere: sphere.backgroundImage.includes("radial-gradient"),
      halo: halo.backgroundImage.includes("radial-gradient"),
      edge: sphere.boxShadow.includes("inset"),
    };
  })).toEqual({ sphere: true, halo: true, edge: true });
}

for (const [width, theme] of [[390, "dark"], [1440, "light"]] as const) {
  test.describe(`${width}px ${theme}`, () => {
    test.use({ viewport: { width, height: 650 }, deviceScaleFactor: 2 });

    test("off draws a static sphere with zero WebGL initialization", async ({ page }, info) => {
      await instrument(page, "mock");
      await page.goto(`${fixture}?theme=${theme}&effects=off`);
      const orb = page.locator(".data-orb");
      await expect(orb).toHaveAttribute("aria-hidden", "true");
      await expect(orb).toHaveAttribute("data-status", "idle");
      await expect(orb).toHaveAttribute("data-theme", theme);
      await expect(orb).toHaveCSS("pointer-events", "none");
      await expect(orb).toHaveClass("data-orb orb-fixture");
      await expectStatic(page);
      await page.screenshot({ path: info.outputPath(`orb-${theme}-${width}-css.png`), scale: "css" });
      expect(await stats(page)).toEqual({ contexts: 0, released: 0, draws: 0, pending: 0 });
    });

    test("native WebGL renders and reports frame and DPR measurements when supported", async ({ page }, info) => {
      await instrument(page, "native");
      await page.goto(`${fixture}?theme=${theme}&effects=full`);
      await expect.poll(async () => (await stats(page)).contexts).toBe(1);
      const support = await page.evaluate(() => window.orbProbe.supported);
      test.skip(!support, "This runner cannot allocate WebGL 1 highp with failIfMajorPerformanceCaveat");
      await expect(page.locator(canvas)).toBeVisible();
      await expect(page.locator(fallback)).toBeHidden();

      for (const effects of ["full", "subtle"] as const) {
        await page.evaluate((effects) => window.updateOrb({ effects }), effects);
        const dpr = effects === "full" ? 1.5 : 1;
        const target = effects === "full" ? 30 : 20;
        const size = await page.locator(canvas).evaluate((element: HTMLCanvasElement) => element.clientWidth);
        await expect(page.locator(canvas)).toHaveAttribute("width", String(Math.round(size * dpr)));
        const start = (await stats(page)).draws;
        await expect.poll(async () => (await stats(page)).draws - start).toBeGreaterThanOrEqual(21);
        const draws = await page.evaluate((start) => window.orbProbe.draws.slice(start), start);
        const elapsedMs = draws.at(-1)!.time - draws[0]!.time;
        const fps = (draws.length - 1) * 1000 / elapsedMs;
        expect(draws.every((draw) => draw.center?.[3] === 255)).toBe(true);
        expect(new Set(draws.map((draw) => draw.center?.join(","))).size).toBeGreaterThan(1);
        expect(fps).toBeLessThanOrEqual(target + 2);
        const measurement = { effects, target, fps, elapsedMs, draws: draws.length, cssWidth: size, drawingBufferWidth: draws[0]!.width };
        await info.attach(`orb-${effects}-measurements`, {
          body: JSON.stringify(measurement, null, 2),
          contentType: "application/json",
        });
        console.log(info.project.name, width, theme, measurement);
        await page.screenshot({ path: info.outputPath(`orb-${theme}-${width}-${effects}.png`), scale: "css" });
      }

      expect((await stats(page)).contexts).toBe(1);
      // WebKit can expose WebGL without the explicit loss extension.
      const canLose = await page.evaluate(() => window.orbProbe.canLose);
      if (canLose) {
        await page.evaluate(() => window.orbProbe.loseContext());
        await expectStatic(page);
        expect((await stats(page)).pending).toBe(0);
      }
    });
  });
}

for (const failure of ["missing-api", "policy-null", "context-null", "throw", "precision", "compile", "link"] as const) {
  test(`CSS fallback after injected ${failure}`, async ({ page }) => {
    await instrument(page, "mock", failure);
    await page.goto(fixture);
    await expectStatic(page);
    if (failure !== "missing-api") await expect.poll(async () => (await stats(page)).contexts).toBe(1);
    await expect.poll(async () => (await stats(page)).pending).toBe(0);
    await page.evaluate(() => window.updateOrb({ effects: "full", status: "generating" }));
    await expect(page.locator(".data-orb")).toHaveAttribute("data-status", "generating");
    await expectStatic(page);
    expect(await stats(page)).toEqual({
      contexts: failure === "missing-api" ? 0 : 1,
      released: ["precision", "compile", "link"].includes(failure) ? 1 : 0,
      draws: 0,
      pending: 0,
    });
  });
}

test("reduced motion starts without GL and releases/restores on changes", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await instrument(page, "mock");
  await page.goto(fixture);
  await expectStatic(page);
  expect(await stats(page)).toEqual({ contexts: 0, released: 0, draws: 0, pending: 0 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(page.locator(canvas)).toBeVisible();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expectStatic(page);
  expect(await stats(page)).toMatchObject({ contexts: 1, released: 1, pending: 0 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(page.locator(canvas)).toBeVisible();
  expect((await stats(page)).contexts).toBe(2);
});

test("one loop through mode switches, offscreen, injected tab visibility, StrictMode and context loss", async ({ page }) => {
  await instrument(page, "mock");
  await page.goto(fixture);
  await expect(page.locator(canvas)).toBeVisible();
  expect((await stats(page)).contexts).toBe(1);

  await page.evaluate(() => window.updateOrb({ effects: "full", pulseKey: 1, status: "typing" }));
  await expect(page.locator(".data-orb")).toHaveAttribute("data-status", "typing");
  expect(await stats(page)).toMatchObject({ contexts: 1, pending: 1 });
  await page.evaluate(() => window.scrollTo(0, window.innerHeight + 10));
  await expect.poll(async () => (await stats(page)).pending).toBe(0);
  const offscreen = (await stats(page)).draws;
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(async () => (await stats(page)).draws).toBeGreaterThan(offscreen);

  await page.evaluate(() => window.orbProbe.setHidden(true));
  expect((await stats(page)).pending).toBe(0);
  const background = (await stats(page)).draws;
  await page.waitForTimeout(100);
  expect((await stats(page)).draws).toBe(background);
  await page.evaluate(() => window.orbProbe.setHidden(false));
  await expect.poll(async () => (await stats(page)).draws).toBeGreaterThan(background);

  await page.evaluate(() => window.updateOrb({ effects: "off" }));
  await expectStatic(page);
  expect(await stats(page)).toMatchObject({ contexts: 1, released: 1, pending: 0 });
  await page.evaluate(() => window.updateOrb({ effects: "subtle" }));
  await expect(page.locator(canvas)).toBeVisible();
  expect(await stats(page)).toMatchObject({ contexts: 2, pending: 1 });

  await page.evaluate(() => window.updateOrb({ mounted: false }));
  await expect(page.locator(".data-orb")).toHaveCount(0);
  expect(await stats(page)).toMatchObject({ contexts: 2, released: 2, pending: 0 });
  await page.evaluate(() => window.updateOrb({ mounted: true }));
  await expect(page.locator(canvas)).toBeVisible();
  await page.evaluate(() => window.orbProbe.loseContext());
  await expectStatic(page);
  expect(await stats(page)).toMatchObject({ contexts: 3, released: 3, pending: 0 });
  await page.evaluate(() => window.updateOrb({ effects: "off" }));
  await expectStatic(page);
  await page.evaluate(() => window.updateOrb({ effects: "full", status: "completed" }));
  await expect(page.locator(".data-orb")).toHaveAttribute("data-status", "completed");
  await expectStatic(page);
  expect(await stats(page)).toMatchObject({ contexts: 3, released: 3, pending: 0 });
});
