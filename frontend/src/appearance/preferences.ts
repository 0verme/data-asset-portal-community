export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = Exclude<ThemeMode, "system">;
export type AccentPreset = "green" | "blue" | "purple" | "orange";
export type EffectsLevel = "full" | "subtle" | "off";
export type Density = "comfortable" | "compact";
export type AccentPreference =
  | { kind: "preset"; preset: AccentPreset }
  | { kind: "custom"; hex: string };

export type AppearancePreferenceV1 = {
  version: 1;
  themeMode: ThemeMode;
  accent: AccentPreference;
  effects: EffectsLevel;
  density: Density;
};

export const DARK_QUERY = "(prefers-color-scheme: dark)";
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const LEGACY_THEME = "dap-theme";
const LEGACY_ACCENT = "dap-accent";
const isHex = (value: string) => value.length === 7 && /^#[0-9a-f]{6}$/i.test(value);

export function appearanceKey(base: string, scope?: string): string {
  return `dap-appearance:v1:${encodeURIComponent(scope?.trim() || base)}`;
}

export function initializedKey(key: string): string {
  return `${key}:initialized`;
}

function isPreset(value: unknown): value is AccentPreset {
  return value === "green" || value === "purple" || value === "blue" || value === "orange";
}

export function defaults(configuredAccent: unknown): AppearancePreferenceV1 & { accent: { kind: "preset"; preset: AccentPreset } } {
  const preset = typeof configuredAccent === "string" ? configuredAccent.trim().toLowerCase() : "";
  return {
    version: 1,
    themeMode: "system",
    accent: { kind: "preset", preset: isPreset(preset) ? preset : "green" },
    effects: "subtle",
    density: "comfortable",
  };
}

export function validatePreference(value: unknown): AppearancePreferenceV1 | null {
  if (!value || typeof value !== "object") return null;
  const { version, themeMode, accent, effects, density } = value as Partial<AppearancePreferenceV1>;
  if (
    version !== 1 ||
    (themeMode !== "system" && themeMode !== "dark" && themeMode !== "light") ||
    (effects !== "full" && effects !== "subtle" && effects !== "off") ||
    (density !== "comfortable" && density !== "compact")
  ) return null;

  if (accent?.kind === "preset" && isPreset(accent.preset)) {
    return { version, themeMode, accent: { kind: "preset", preset: accent.preset }, effects, density };
  }
  if (accent?.kind === "custom" && typeof accent.hex === "string" && isHex(accent.hex)) {
    return { version, themeMode, accent: { kind: "custom", hex: accent.hex.toLowerCase() }, effects, density };
  }
  return null;
}

export function parsePreference(raw: string | null): AppearancePreferenceV1 | null {
  try {
    return raw === null ? null : validatePreference(JSON.parse(raw));
  } catch {
    return null;
  }
}

type Reader = (key: string) => string | null;

export function readPreference(
  read: Reader,
  key: string,
  fallback: AppearancePreferenceV1,
): { preference: AppearancePreferenceV1; source: "stored" | "legacy" | "default" } {
  try {
    const raw = read(key);
    const current = parsePreference(raw);
    if (current) return { preference: current, source: "stored" };
    // An explicit deletion after initialization restores deployment defaults.
    if (raw === null && read(initializedKey(key)) === "1") {
      return { preference: fallback, source: "default" };
    }
    const themeMode = read(LEGACY_THEME);
    const accent = read(LEGACY_ACCENT);
    const legacyTheme = themeMode === "light" || themeMode === "dark";
    const legacyAccent = accent === "green" || accent === "purple";
    return {
      preference: {
        ...fallback,
        themeMode: legacyTheme ? themeMode : fallback.themeMode,
        accent: legacyAccent ? { kind: "preset", preset: accent } : fallback.accent,
      },
      source: legacyTheme || legacyAccent ? "legacy" : "default",
    };
  } catch {
    return { preference: fallback, source: "default" };
  }
}

export function resolveAppearance(preference: AppearancePreferenceV1, dark: boolean, reduced: boolean) {
  const theme: ResolvedTheme = preference.themeMode === "system"
    ? (dark ? "dark" : "light")
    : preference.themeMode;
  const effectiveEffects: EffectsLevel = reduced ? "off" : preference.effects;
  return { theme, effectiveEffects };
}

type RGB = [number, number, number];

function rgb(hex: string): RGB {
  return [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16)) as RGB;
}

function mix(color: RGB, target: RGB, amount: number): RGB {
  return color.map((channel, index) => Math.round(channel * (1 - amount) + target[index]! * amount)) as RGB;
}

function luminance(color: RGB): number {
  const weights = [0.2126, 0.7152, 0.0722];
  return color.reduce((sum, channel, index) => {
    const srgb = channel / 255;
    const linear = srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
    return sum + linear * weights[index]!;
  }, 0);
}

export function contrastRatio(first: RGB, second: RGB): number {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const presetSeeds = { blue: "#3b82f6", orange: "#f97316" } as const;
const generatedTokens = [
  "--accent", "--accent-strong", "--accent-soft-color", "--accent-soft",
  "--accent-line", "--bg-grad-1", "--on-accent",
] as const;

export function makeAccentPalette(hex: string, theme: ResolvedTheme) {
  if (!isHex(hex)) return null;
  const seed = rgb(hex);
  // Match the lowest-contrast neutral surface in each DAP theme.
  const surface = rgb(theme === "light" ? "#edf3f8" : "#16223a");
  const onAccent = theme === "light" ? "#ffffff" : "#000000";
  const ink = rgb(onAccent);
  const target = rgb(theme === "light" ? "#000000" : "#ffffff");
  let accent = seed;
  const tint = 0.13;
  for (let step = 0; step <= 100; step += 1) {
    accent = mix(seed, target, step / 100);
    if (contrastRatio(accent, ink) >= 4.5 && contrastRatio(accent, mix(surface, accent, tint)) >= 4.5) break;
  }
  const strong = mix(accent, target, 0.14);
  const rgba = (alpha: number) => `rgba(${accent.join(",")},${alpha})`;
  return {
    "--accent": `rgb(${accent.join(",")})`,
    "--accent-strong": `rgb(${strong.join(",")})`,
    "--accent-soft-color": `rgb(${strong.join(",")})`,
    "--accent-soft": rgba(tint),
    "--accent-line": rgba(0.4),
    "--bg-grad-1": rgba(theme === "light" ? 0.09 : 0.07),
    "--on-accent": onAccent,
  };
}

export function applyAppearance(
  root: HTMLElement,
  preference: AppearancePreferenceV1,
  { theme, effectiveEffects }: ReturnType<typeof resolveAppearance>,
): void {
  const accent = preference.accent.kind === "preset" ? preference.accent.preset : "custom";
  root.dataset["theme"] = theme;
  root.dataset["mode"] = preference.themeMode;
  root.dataset["accent"] = accent;
  root.dataset["density"] = preference.density;
  root.dataset["effects"] = effectiveEffects;
  const seed = preference.accent.kind === "custom"
    ? preference.accent.hex
    : (accent === "blue" || accent === "orange" ? presetSeeds[accent] : null);
  const palette = seed && makeAccentPalette(seed, theme);
  for (const token of generatedTokens) {
    if (palette) root.style.setProperty(token, palette[token]);
    else root.style.removeProperty(token);
  }
}

// Invoked by the classic, parser-blocking head asset generated by Vite.
export function bootstrapAppearance(base: string, scope: string | undefined, defaultAccent: unknown): void {
  const { preference } = readPreference(
    (key) => window.localStorage.getItem(key),
    appearanceKey(base, scope),
    defaults(defaultAccent),
  );
  applyAppearance(document.documentElement, preference, resolveAppearance(
    preference,
    window.matchMedia?.(DARK_QUERY).matches ?? false,
    window.matchMedia?.(REDUCED_MOTION_QUERY).matches ?? false,
  ));
}
