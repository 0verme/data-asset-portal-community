/// <reference types="vite/client" />

import { requestRemote } from "./http.ts";
import COMMON_CODES, { type CommonCodeItem } from "../data/commonCodes.ts";

export interface BusinessOptionItem {
  code: string;
  name: string;
  value: string;
}

export interface BusinessOptionCatalog {
  categories: Record<string, BusinessOptionItem[]>;
  missingCategories: string[];
}

export const UPSTREAM_OPTION_CATEGORIES = ["UPSTREAM_DB_TYPE", "UPSTREAM_DEPT"] as const;
export const PUSH_OPTION_CATEGORIES = [
  "PUSH_PROTOCOL",
  "PUSH_AUTH_TYPE",
  "UPSTREAM_DEPT",
  "PUSH_DELIMITER",
  "FILE_ENCODING",
  "FREQ_TYPE",
] as const;

const API_MODE = (
  typeof import.meta !== "undefined" && import.meta.env?.["VITE_API_MODE"]
    ? String(import.meta.env["VITE_API_MODE"])
    : "mock"
).trim().toLowerCase();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse the exact editor-options response; never treat malformed data as empty. */
export function parseBusinessOptionCatalog(
  payload: unknown,
  expectedCategories: readonly string[],
): BusinessOptionCatalog {
  if (!isRecord(payload) || !isRecord(payload["categories"]) || !Array.isArray(payload["missingCategories"])) {
    throw new Error("业务候选响应结构无效");
  }

  const source = payload["categories"];
  const missingCategories = payload["missingCategories"];
  if (
    !missingCategories.every((code) => typeof code === "string" && expectedCategories.includes(code)) ||
    new Set(missingCategories).size !== missingCategories.length
  ) {
    throw new Error("业务候选响应结构无效");
  }

  const categories: Record<string, BusinessOptionItem[]> = {};
  for (const categoryCode of expectedCategories) {
    const rawItems = source[categoryCode];
    if (!Array.isArray(rawItems)) throw new Error(`业务候选分类响应无效: ${categoryCode}`);
    const items: BusinessOptionItem[] = [];
    for (const rawItem of rawItems) {
      if (
        !isRecord(rawItem) ||
        typeof rawItem["code"] !== "string" ||
        typeof rawItem["name"] !== "string" ||
        typeof rawItem["value"] !== "string" ||
        !rawItem["value"].trim()
      ) {
        throw new Error(`业务候选项响应无效: ${categoryCode}`);
      }
      items.push({
        code: rawItem["code"],
        name: rawItem["name"],
        value: rawItem["value"],
      });
    }
    if (missingCategories.includes(categoryCode) && items.length > 0) {
      throw new Error(`业务候选缺失标记无效: ${categoryCode}`);
    }
    categories[categoryCode] = items;
  }
  return { categories, missingCategories: [...missingCategories] as string[] };
}

function demoCatalog(categoryCodes: readonly string[]): BusinessOptionCatalog {
  const categories: Record<string, BusinessOptionItem[]> = {};
  const missingCategories: string[] = [];
  for (const categoryCode of categoryCodes) {
    const category = COMMON_CODES.categories.find((item) => item.code === categoryCode && item.active);
    if (!category) {
      categories[categoryCode] = [];
      missingCategories.push(categoryCode);
      continue;
    }
    categories[categoryCode] = category.items
      .filter((item: CommonCodeItem) => item.active && Boolean(item.value))
      .map(({ code, name, value }) => ({ code, name, value }));
  }
  return { categories, missingCategories };
}

async function loadCatalog(
  path: string,
  categoryCodes: readonly string[],
): Promise<BusinessOptionCatalog> {
  if (API_MODE !== "remote") return demoCatalog(categoryCodes);
  const payload: unknown = await requestRemote(path);
  return parseBusinessOptionCatalog(payload, categoryCodes);
}

export function getUpstreamBusinessOptions(): Promise<BusinessOptionCatalog> {
  return loadCatalog("/upstreams/options", UPSTREAM_OPTION_CATEGORIES);
}

export function getPushBusinessOptions(): Promise<BusinessOptionCatalog> {
  return loadCatalog("/push/options", PUSH_OPTION_CATEGORIES);
}
