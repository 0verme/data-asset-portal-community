import i18next from "i18next";
import { initReactI18next } from "react-i18next";

import adminEn from "./locales/en-US/admin.json" with { type: "json" };
import aiAskEn from "./locales/en-US/aiAsk.json" with { type: "json" };
import apiAssetEn from "./locales/en-US/apiAsset.json" with { type: "json" };
import authEn from "./locales/en-US/auth.json" with { type: "json" };
import commonEn from "./locales/en-US/common.json" with { type: "json" };
import fieldMappingEn from "./locales/en-US/fieldMapping.json" with { type: "json" };
import indicatorEn from "./locales/en-US/indicator.json" with { type: "json" };
import integrationEn from "./locales/en-US/integration.json" with { type: "json" };
import lineageEn from "./locales/en-US/lineage.json" with { type: "json" };
import navigationEn from "./locales/en-US/navigation.json" with { type: "json" };
import dictionaryEn from "./locales/en-US/dictionary.json" with { type: "json" };
import reportEn from "./locales/en-US/report.json" with { type: "json" };
import searchEn from "./locales/en-US/search.json" with { type: "json" };
import warehouseEn from "./locales/en-US/warehouse.json" with { type: "json" };
import adminZh from "./locales/zh-CN/admin.json" with { type: "json" };
import aiAskZh from "./locales/zh-CN/aiAsk.json" with { type: "json" };
import apiAssetZh from "./locales/zh-CN/apiAsset.json" with { type: "json" };
import authZh from "./locales/zh-CN/auth.json" with { type: "json" };
import commonZh from "./locales/zh-CN/common.json" with { type: "json" };
import fieldMappingZh from "./locales/zh-CN/fieldMapping.json" with { type: "json" };
import indicatorZh from "./locales/zh-CN/indicator.json" with { type: "json" };
import integrationZh from "./locales/zh-CN/integration.json" with { type: "json" };
import lineageZh from "./locales/zh-CN/lineage.json" with { type: "json" };
import navigationZh from "./locales/zh-CN/navigation.json" with { type: "json" };
import dictionaryZh from "./locales/zh-CN/dictionary.json" with { type: "json" };
import reportZh from "./locales/zh-CN/report.json" with { type: "json" };
import searchZh from "./locales/zh-CN/search.json" with { type: "json" };
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
  "zh-CN": { common: commonZh, apiAsset: apiAssetZh, navigation: navigationZh, auth: authZh, warehouse: warehouseZh, search: searchZh, aiAsk: aiAskZh, fieldMapping: fieldMappingZh, indicator: indicatorZh, lineage: lineageZh, report: reportZh, integration: integrationZh, dictionary: dictionaryZh, admin: adminZh },
  "en-US": { common: commonEn, apiAsset: apiAssetEn, navigation: navigationEn, auth: authEn, warehouse: warehouseEn, search: searchEn, aiAsk: aiAskEn, fieldMapping: fieldMappingEn, indicator: indicatorEn, lineage: lineageEn, report: reportEn, integration: integrationEn, dictionary: dictionaryEn, admin: adminEn },
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
    ns: ["common", "apiAsset", "navigation", "auth", "warehouse", "search", "aiAsk", "fieldMapping", "indicator", "lineage", "report", "integration", "dictionary", "admin"],
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
