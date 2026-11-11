import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const APP_CSS = readFileSync(new URL("./app.css", import.meta.url), "utf8");
type Tokens = Record<string, string>;
type Color = { red: number; green: number; blue: number; alpha: number };

function tokensForRule(selector: string): Tokens {
  const selectorIndex = APP_CSS.indexOf(selector);
  assert.notEqual(selectorIndex, -1, `missing CSS rule: ${selector}`);
  const openBrace = APP_CSS.indexOf("{", selectorIndex + selector.length - 1);
  assert.notEqual(openBrace, -1, `missing CSS block: ${selector}`);

  let depth = 0;
  let closeBrace = -1;
  for (let index = openBrace; index < APP_CSS.length; index += 1) {
    if (APP_CSS[index] === "{") depth += 1;
    if (APP_CSS[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        closeBrace = index;
        break;
      }
    }
  }
  assert.notEqual(closeBrace, -1, `unterminated CSS block: ${selector}`);

  const block = APP_CSS.slice(openBrace + 1, closeBrace);
  return Object.fromEntries(
    [...block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((match) => [match[1]!, match[2]!.trim()]),
  );
}

const DARK_BASE = tokensForRule(":root {");
const LIGHT_BASE = tokensForRule(':root[data-theme="light"] {');
const PURPLE_DARK = tokensForRule(':root[data-accent="purple"] {');
const PURPLE_LIGHT = tokensForRule(':root[data-theme="light"][data-accent="purple"] {');

function effectiveTokens(theme: "light" | "dark", accent: "green" | "purple"): Tokens {
  const tokens = { ...DARK_BASE };
  if (accent === "purple") Object.assign(tokens, PURPLE_DARK);
  if (theme === "light") Object.assign(tokens, LIGHT_BASE);
  if (theme === "light" && accent === "purple") Object.assign(tokens, PURPLE_LIGHT);
  return tokens;
}

function token(tokens: Tokens, name: string): string {
  const value = tokens[name];
  assert.ok(value, `missing CSS token: ${name}`);
  return value!;
}

function parseColor(value: string): Color {
  const hex = value.match(/^#([\da-f]{6})$/i);
  if (hex) {
    const raw = hex[1]!;
    return {
      red: Number.parseInt(raw.slice(0, 2), 16),
      green: Number.parseInt(raw.slice(2, 4), 16),
      blue: Number.parseInt(raw.slice(4, 6), 16),
      alpha: 1,
    };
  }

  const rgba = value.match(/^rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/i);
  assert.ok(rgba, `unsupported CSS color token: ${value}`);
  const parsed = rgba!;
  return {
    red: Number(parsed[1]),
    green: Number(parsed[2]),
    blue: Number(parsed[3]),
    alpha: Number(parsed[4]),
  };
}

function composite(foreground: Color, background: Color): Color {
  const alpha = foreground.alpha;
  return {
    red: foreground.red * alpha + background.red * (1 - alpha),
    green: foreground.green * alpha + background.green * (1 - alpha),
    blue: foreground.blue * alpha + background.blue * (1 - alpha),
    alpha: 1,
  };
}

function luminance(color: Color): number {
  const linear = [color.red, color.green, color.blue].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
}

function contrastRatio(first: Color, second: Color): number {
  const sorted = [luminance(first), luminance(second)].sort((a, b) => b - a);
  const lighter = sorted[0]!;
  const darker = sorted[1]!;
  return (lighter + 0.05) / (darker + 0.05);
}

function assertContrast(name: string, foreground: Color, background: Color, minimum: number): void {
  const ratio = contrastRatio(foreground, background);
  assert.ok(ratio >= minimum, `${name}: expected >= ${minimum}:1, received ${ratio.toFixed(2)}:1`);
}

const PURPLE_ACCENT_KEYS = [
  "--accent",
  "--accent-strong",
  "--accent-soft-color",
  "--accent-soft",
  "--accent-line",
  "--bg-grad-1",
  "--on-accent",
].sort();

test("purple light and dark selectors define the complete preset without leaking variables", () => {
  assert.deepEqual(Object.keys(PURPLE_DARK).sort(), PURPLE_ACCENT_KEYS);
  assert.deepEqual(Object.keys(PURPLE_LIGHT).sort(), PURPLE_ACCENT_KEYS);

  const dark = effectiveTokens("dark", "purple");
  assert.equal(dark["--accent"], "#A78BFA");
  assert.equal(dark["--accent-strong"], "#9378F0");
  assert.equal(dark["--accent-soft-color"], "#C4B5FD");
  assert.equal(dark["--accent-soft"], "rgba(167,139,250,0.14)");
  assert.equal(dark["--accent-line"], "rgba(167,139,250,0.40)");
  assert.equal(dark["--bg-grad-1"], "rgba(167,139,250,0.07)");
  assert.equal(dark["--on-accent"], "#12102A");

  const light = effectiveTokens("light", "purple");
  assert.equal(light["--accent"], "#6B5CA5");
  assert.equal(light["--accent-strong"], "#594B90");
  assert.equal(light["--accent-soft-color"], "#4F4286");
  assert.equal(light["--accent-soft"], "rgba(107,92,165,0.12)");
  assert.equal(light["--accent-line"], "rgba(107,92,165,0.30)");
  assert.equal(light["--bg-grad-1"], "rgba(107,92,165,0.09)");
  assert.equal(light["--on-accent"], "#FFFFFF");
});

test("purple text and opaque accent contrast pass in light and dark themes", () => {
  for (const theme of ["light", "dark"] as const) {
    const tokens = effectiveTokens(theme, "purple");
    const onAccent = parseColor(token(tokens, "--on-accent"));
    const accent = parseColor(token(tokens, "--accent"));
    const surface = parseColor(token(tokens, "--surface"));
    const surface3 = parseColor(token(tokens, "--surface-3"));
    const softText = parseColor(token(tokens, "--accent-soft-color"));
    const soft = parseColor(token(tokens, "--accent-soft"));

    assertContrast(`${theme} button text`, onAccent, accent, 4.5);
    assertContrast(`${theme} hover text`, onAccent, parseColor(token(tokens, "--accent-strong")), 4.5);
    assertContrast(`${theme} soft text on surface tint`, softText, composite(soft, surface), 4.5);
    assertContrast(`${theme} soft text on surface-3 tint`, softText, composite(soft, surface3), 4.5);
    assertContrast(`${theme} opaque accent on surface`, accent, surface, 3);

    // Translucent --accent-line / --accent-soft border and focus colors fall below 3:1.
    // This known issue is out of scope, so their 3:1 contrast is intentionally not asserted.
  }
});

test("success tokens are theme-specific, accent-independent, and readable on required surfaces", () => {
  const successValues = {
    light: {
      color: "#1D7442",
      soft: "rgba(29,116,66,0.10)",
      line: "rgba(29,116,66,0.30)",
    },
    dark: {
      color: "#4ADE80",
      soft: "rgba(74,222,128,0.13)",
      line: "rgba(74,222,128,0.35)",
    },
  } as const;

  for (const theme of ["light", "dark"] as const) {
    const greenTokens = effectiveTokens(theme, "green");
    const purpleTokens = effectiveTokens(theme, "purple");
    for (const key of ["--success", "--success-soft", "--success-line"]) {
      assert.equal(greenTokens[key], purpleTokens[key], `${key} must not depend on accent preset`);
    }

    const expected = successValues[theme];
    assert.equal(greenTokens["--success"], expected.color);
    assert.equal(greenTokens["--success-soft"], expected.soft);
    assert.equal(greenTokens["--success-line"], expected.line);

    const success = parseColor(token(greenTokens, "--success"));
    const successSoft = parseColor(token(greenTokens, "--success-soft"));
    const surface = parseColor(token(greenTokens, "--surface"));
    const surface3 = parseColor(token(greenTokens, "--surface-3"));
    assertContrast(`${theme} success text on surface`, success, surface, 4.5);
    assertContrast(`${theme} success text on soft surface`, success, composite(successSoft, surface), 4.5);
    assertContrast(`${theme} success text on surface-3 plus soft`, success, composite(successSoft, surface3), 4.5);
  }
});
