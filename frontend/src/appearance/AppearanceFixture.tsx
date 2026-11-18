import { useState } from "react";
import KumoCompatibilityFixture from "../kumo-spike/KumoCompatibilityFixture.tsx";
import { AppearanceProvider, useAppearance } from "./AppearanceProvider.tsx";
import type { AccentPreset, ThemeMode } from "./preferences.ts";

function Controls() {
  const { preference, setThemeMode, setAccent, setEffects, setDensity, reset } = useAppearance();
  return (
    <>
      {(["system", "light", "dark"] as ThemeMode[]).map((mode) => (
        <button key={mode} onClick={() => setThemeMode(mode)}>{mode}</button>
      ))}
      {(["green", "purple", "blue", "orange"] as AccentPreset[]).map((preset) => (
        <button key={preset} onClick={() => setAccent({ kind: "preset", preset })}>{preset}</button>
      ))}
      <button onClick={() => setAccent({ kind: "custom", hex: "#ffffff" })}>custom</button>
      <button onClick={() => setAccent({ kind: "custom", hex: "#fff" })}>invalid custom</button>
      <button onClick={() => setEffects("full")}>full effects</button>
      <button onClick={() => setDensity("compact")}>compact</button>
      <button onClick={reset}>restore defaults</button>
      <output data-testid="saved-effects">{preference.effects}</output>
    </>
  );
}

export default function AppearanceFixture() {
  const [mounted, setMounted] = useState(true);
  return (
    <>
      <button onClick={() => setMounted(!mounted)}>toggle provider</button>
      {mounted && (
        <AppearanceProvider>
          <Controls />
          <KumoCompatibilityFixture />
        </AppearanceProvider>
      )}
    </>
  );
}
