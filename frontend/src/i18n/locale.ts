export const SUPPORTED_LANGUAGES = ["zh-CN", "en-US"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];
export const DEFAULT_LANGUAGE: SupportedLanguage = "zh-CN";
export const LANGUAGE_STORAGE_KEY = "dap-language";

export interface LanguageStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function normalizeLanguage(value: unknown): SupportedLanguage {
  return value === "en-US" ? "en-US" : DEFAULT_LANGUAGE;
}

function getBrowserStorage(): LanguageStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function resolveInitialLanguage(
  getStorage: () => LanguageStorage | null = getBrowserStorage,
): SupportedLanguage {
  try {
    return normalizeLanguage(getStorage()?.getItem(LANGUAGE_STORAGE_KEY));
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

export function persistLanguagePreference(
  language: SupportedLanguage,
  getStorage: () => LanguageStorage | null = getBrowserStorage,
): void {
  try {
    getStorage()?.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Language remains active for this session when storage is unavailable.
  }
}
