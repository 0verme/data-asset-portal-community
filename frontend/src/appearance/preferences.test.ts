import assert from "node:assert/strict";
import test from "node:test";
import {
  appearanceKey, applyAppearance, contrastRatio, defaults, initializedKey, isAccentHex, makeAccentPalette, parsePreference,
  readPreference, resolveAppearance, validatePreference,
} from "./preferences.ts";

const key = appearanceKey("/");
const fallback = defaults("purple");

test("deployments have stable base or explicit scope and configured defaults", () => {
  assert.equal(key, "dap-appearance:v1:%2F");
  assert.equal(appearanceKey("/internal/"), "dap-appearance:v1:%2Finternal%2F");
  assert.equal(appearanceKey("/", " community "), "dap-appearance:v1:community");
  assert.deepEqual(defaults(undefined), {
    version: 1, themeMode: "system", accent: { kind: "preset", preset: "green" },
    effects: "subtle", density: "comfortable",
  });
  assert.deepEqual(defaults(" PURPLE "), fallback);
  assert.deepEqual(defaults("invalid"), defaults(undefined));
  for (const preset of ["green", "purple", "blue", "orange"]) {
    assert.deepEqual(defaults(preset).accent, { kind: "preset", preset });
  }
});

test("strict parsing validates the whole versioned preference and normalizes custom HEX", () => {
  const value = { ...fallback, themeMode: "dark", density: "compact", effects: "full" };
  assert.deepEqual(parsePreference(JSON.stringify(value)), value);
  for (const patch of [{ version: 2 }, { density: "small" }, { themeMode: "auto" }, { effects: "medium" },
    { accent: { kind: "preset", preset: "pink" } }, { accent: null }]) {
    assert.equal(validatePreference({ ...value, ...patch }), null);
  }
  for (const hex of ["#aaa", "#12345678", "#123456\n", "#123456 ", "#zzz000", "red", "rgb(0,0,0)"]) {
    assert.equal(isAccentHex(hex), false);
    assert.equal(validatePreference({ ...value, accent: { kind: "custom", hex } }), null);
  }
  assert.equal(isAccentHex("#A1B2C3"), true);
  assert.deepEqual(validatePreference({ ...value, accent: { kind: "custom", hex: "#A1B2C3" } })?.accent,
    { kind: "custom", hex: "#a1b2c3" });
  assert.equal(parsePreference("{broken"), null);
});

test("migration preserves explicit legacy preferences and trusts valid v1 on every read thereafter", () => {
  for (const [themeMode, preset] of [["light", "purple"], ["dark", "green"]]) {
    const storage = new Map([["dap-theme", themeMode!], ["dap-accent", preset!], [key, "{broken"]]);
    const read = (name: string) => storage.get(name) ?? null;
    const expected = { ...fallback, themeMode, accent: { kind: "preset", preset } };
    assert.deepEqual(readPreference(read, key, fallback), { preference: expected, source: "legacy" });
    storage.set(key, JSON.stringify(expected));
    storage.set("dap-theme", themeMode === "dark" ? "light" : "dark");
    storage.set("dap-accent", preset === "green" ? "purple" : "green");
    assert.deepEqual(readPreference(read, key, fallback), { preference: expected, source: "stored" });
    storage.set(initializedKey(key), "1");
    storage.delete(key);
    assert.deepEqual(readPreference(read, key, fallback), { preference: fallback, source: "default" });
  }

  for (const read of [() => null, () => "invalid", () => { throw new Error("blocked"); }]) {
    assert.deepEqual(readPreference(read, key, fallback), { preference: fallback, source: "default" });
  }
});

test("system preferences resolve independently of saved theme and effects", () => {
  const preference = { ...fallback, effects: "full" } as const;
  assert.deepEqual(resolveAppearance(preference, false, false), { theme: "light", effectiveEffects: "full" });
  assert.deepEqual(resolveAppearance(preference, true, true), { theme: "dark", effectiveEffects: "off" });
  assert.deepEqual(resolveAppearance({ ...preference, themeMode: "light" }, true, false),
    { theme: "light", effectiveEffects: "full" });
  assert.equal(preference.effects, "full");
});

test("all drawer choices project through the same document appearance contract", () => {
  const tokens = new Map<string, string>();
  const root = {
    dataset: {},
    style: { setProperty: tokens.set.bind(tokens), removeProperty: tokens.delete.bind(tokens) },
  } as unknown as HTMLElement;

  for (const preset of ["blue", "orange", "green", "purple"] as const) {
    for (const themeMode of ["system", "light", "dark"] as const) {
      for (const density of ["comfortable", "compact"] as const) {
        for (const effects of ["full", "subtle", "off"] as const) {
          const preference = { ...defaults(preset), themeMode, density, effects };
          const resolved = resolveAppearance(preference, true, effects === "full");
          applyAppearance(root, preference, resolved);
          assert.deepEqual(root.dataset, {
            theme: themeMode === "light" ? "light" : "dark",
            mode: themeMode,
            accent: preset,
            density,
            effects: effects === "full" ? "off" : effects,
          });
          assert.equal(tokens.has("--accent"), preset === "blue" || preset === "orange");
        }
      }
    }
  }
});

test("generated colors protect foregrounds and surface text even at the sRGB extremes", () => {
  assert.equal(contrastRatio([0, 0, 0], [255, 255, 255]), 21);
  assert.ok(Math.abs(contrastRatio([255, 0, 0], [255, 255, 255]) - 3.998) < 0.001);
  assert.equal(makeAccentPalette("invalid", "dark"), null);
  const channels = (color: string) => color.match(/\d+/g)!.map(Number) as [number, number, number];
  for (const theme of ["light", "dark"] as const) {
    const ink: [number, number, number] = theme === "light" ? [255, 255, 255] : [0, 0, 0];
    const surface: [number, number, number] = theme === "light" ? [237, 243, 248] : [22, 34, 58];
    for (const hex of ["#000000", "#ffffff", "#3b82f6", "#f97316", "#00ff00", "#808080"]) {
      const palette = makeAccentPalette(hex, theme)!;
      const accent = channels(palette["--accent"]);
      const hover = channels(palette["--accent-strong"]);
      const tint = surface.map((channel, index) => Math.round(channel * 0.87 + accent[index]! * 0.13)) as typeof surface;
      assert.ok(contrastRatio(ink, accent) >= 4.5);
      assert.ok(contrastRatio(ink, hover) >= 4.5);
      assert.ok(contrastRatio(accent, tint) >= 4.5);
    }
  }
});
