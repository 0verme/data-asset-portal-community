import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  appearanceKey, applyAppearance, DARK_QUERY, defaults, initializedKey, parsePreference, readPreference,
  REDUCED_MOTION_QUERY, resolveAppearance, validatePreference,
  type AccentPreference, type AppearancePreferenceV1, type Density, type EffectsLevel, type ThemeMode,
} from "./preferences.ts";

const storageKey = appearanceKey(import.meta.env.BASE_URL, import.meta.env["VITE_APPEARANCE_SCOPE"]);
const defaultPreference = defaults(import.meta.env["VITE_DEFAULT_ACCENT"]);
const read = (key: string) => window.localStorage.getItem(key);
const readCurrent = () => readPreference(read, storageKey, defaultPreference);

function markInitialized(storage: Storage): void {
  const key = initializedKey(storageKey);
  if (storage.getItem(key) !== "1") storage.setItem(key, "1");
}

function persist(preference: AppearancePreferenceV1): void {
  try {
    const storage = window.localStorage;
    storage.setItem(storageKey, JSON.stringify(preference));
    markInitialized(storage);
  } catch {
    // Keep the current session usable when storage is disabled or full.
  }
}

type Appearance = ReturnType<typeof resolveAppearance> & {
  preference: AppearancePreferenceV1;
  setThemeMode: (themeMode: ThemeMode) => void;
  setAccent: (accent: AccentPreference) => void;
  setEffects: (effects: EffectsLevel) => void;
  setDensity: (density: Density) => void;
  reset: () => void;
};

const AppearanceContext = createContext<Appearance | null>(null);

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState(() => readCurrent().preference);
  const latest = useRef(preference);
  const [system, setSystem] = useState(() => ({
    dark: window.matchMedia?.(DARK_QUERY).matches ?? false,
    reduced: window.matchMedia?.(REDUCED_MOTION_QUERY).matches ?? false,
  }));
  const resolved = resolveAppearance(preference, system.dark, system.reduced);

  function accept(next: AppearancePreferenceV1) {
    latest.current = next;
    setPreference(next);
  }

  function update(patch: Partial<AppearancePreferenceV1>) {
    const next = validatePreference({ ...latest.current, ...patch });
    if (!next) return;
    persist(next);
    accept(next);
  }

  useLayoutEffect(() => {
    const dark = window.matchMedia?.(DARK_QUERY);
    const reduced = window.matchMedia?.(REDUCED_MOTION_QUERY);
    const refreshSystem = () => setSystem({ dark: dark?.matches ?? false, reduced: reduced?.matches ?? false });
    const synchronize = (event: StorageEvent) => {
      if (event.key !== storageKey && event.key !== null) return;
      try {
        if (event.storageArea !== window.localStorage) return;
        // Read the current value in case another write superseded this event.
        const raw = read(storageKey);
        const next = raw === null ? readCurrent().preference : parsePreference(raw);
        if (next) accept(next);
      } catch {
        // Ignore storage events when storage is unavailable.
      }
    };

    dark?.addEventListener("change", refreshSystem);
    reduced?.addEventListener("change", refreshSystem);
    window.addEventListener("storage", synchronize);
    refreshSystem();
    const initial = readCurrent();
    if (initial.source === "legacy") persist(initial.preference);
    if (initial.source === "stored") {
      try {
        markInitialized(window.localStorage);
      } catch {
        // A read-only storage area can still supply the saved preference.
      }
    }
    if (JSON.stringify(latest.current) !== JSON.stringify(initial.preference)) accept(initial.preference);
    return () => {
      dark?.removeEventListener("change", refreshSystem);
      reduced?.removeEventListener("change", refreshSystem);
      window.removeEventListener("storage", synchronize);
    };
  }, []);

  useLayoutEffect(() => {
    applyAppearance(document.documentElement, preference, {
      theme: resolved.theme,
      effectiveEffects: resolved.effectiveEffects,
    });
  }, [preference, resolved.theme, resolved.effectiveEffects]);

  return (
    <AppearanceContext.Provider value={{
      preference,
      ...resolved,
      setThemeMode: (themeMode) => update({ themeMode }),
      setAccent: (accent) => update({ accent }),
      setEffects: (effects) => update({ effects }),
      setDensity: (density) => update({ density }),
      reset: () => update(defaultPreference),
    }}>
      {children}
    </AppearanceContext.Provider>
  );
}

export function useAppearance(): Appearance {
  const appearance = useContext(AppearanceContext);
  if (!appearance) throw new Error("useAppearance requires an AppearanceProvider");
  return appearance;
}
