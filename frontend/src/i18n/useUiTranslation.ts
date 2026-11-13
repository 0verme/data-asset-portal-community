import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { i18n } from "./index.ts";

type UiTranslationOptions = Readonly<Record<string, unknown>>;

/** Translate source-keyed UI copy outside React components (for adapters and validation helpers). */
export function translateUiCopy(namespace: string, source: string, options: UiTranslationOptions = {}): string {
  return String(i18n.t(source as never, {
    ...options,
    ns: namespace,
    keySeparator: false,
    defaultValue: source,
  } as never));
}

/** Runtime namespace bridge for phase-specific resource bundles. */
export function useUiTranslation(namespace: string): (key: string, options?: UiTranslationOptions) => string {
  useTranslation();
  return useCallback((key: string, options: UiTranslationOptions = {}) => String(i18n.t(key as never, {
    ...options,
    ns: namespace,
  } as never)), [namespace]);
}

/** Source-message lookup for migrating legacy UI copy while preserving its zh-CN baseline. */
export function useUiCopy(namespace: string): (source: string, options?: UiTranslationOptions) => string {
  useTranslation();
  return useCallback((source: string, options: UiTranslationOptions = {}) => translateUiCopy(namespace, source, options), [namespace]);
}
