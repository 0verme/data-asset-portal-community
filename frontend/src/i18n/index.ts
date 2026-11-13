import i18next from "i18next";
import { initReactI18next } from "react-i18next";

import authEn from "./locales/en-US/auth.json" with { type: "json" };
import commonEn from "./locales/en-US/common.json" with { type: "json" };
import navigationEn from "./locales/en-US/navigation.json" with { type: "json" };
import warehouseEn from "./locales/en-US/warehouse.json" with { type: "json" };
import authZh from "./locales/zh-CN/auth.json" with { type: "json" };
import commonZh from "./locales/zh-CN/common.json" with { type: "json" };
import navigationZh from "./locales/zh-CN/navigation.json" with { type: "json" };
import warehouseZh from "./locales/zh-CN/warehouse.json" with { type: "json" };

import {
  DEFAULT_LANGUAGE,
  normalizeLanguage,
  persistLanguagePreference,
  resolveInitialLanguage,
  type SupportedLanguage,
} from "./locale.ts";

export { DEFAULT_LANGUAGE, LANGUAGE_STORAGE_KEY, SUPPORTED_LANGUAGES, normalizeLanguage, resolveInitialLanguage } from "./locale.ts";
export type { SupportedLanguage } from "./locale.ts";

export const i18n = i18next.createInstance();

const resources = {
  "zh-CN": { common: commonZh, navigation: navigationZh, auth: authZh, warehouse: warehouseZh },
  "en-US": { common: commonEn, navigation: navigationEn, auth: authEn, warehouse: warehouseEn },
} as const;

function syncDocumentLanguage(language: string): void {
  if (typeof document === "undefined") return;
  const locale = normalizeLanguage(language);
  document.documentElement.lang = locale;
  document.title = i18n.t("app.documentTitle", { ns: "common", lng: locale });
}

i18n.on("languageChanged", syncDocumentLanguage);

export const i18nReady = i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: resolveInitialLanguage(),
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: ["zh-CN", "en-US"],
    load: "currentOnly",
    ns: ["common", "navigation", "auth", "warehouse"],
    defaultNS: "common",
    returnNull: false,
    saveMissing: false,
    interpolation: { escapeValue: false },
    parseMissingKeyHandler: (_key, defaultValue) => typeof defaultValue === "string" ? defaultValue : "",
    react: { useSuspense: false },
  })
  .then(() => {
    syncDocumentLanguage(i18n.resolvedLanguage || i18n.language);
  });

export async function changeLanguage(value: unknown): Promise<SupportedLanguage> {
  const language = normalizeLanguage(value);
  await i18n.changeLanguage(language);
  persistLanguagePreference(language);
  return language;
}
