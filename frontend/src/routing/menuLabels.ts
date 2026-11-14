import { MENU_ITEMS, type MenuItem } from "../data/menus.ts";

export type BuiltinMenuTranslationKey =
  | "menus.upstream"
  | "menus.dwm"
  | "menus.mapping"
  | "menus.lineage"
  | "menus.root"
  | "menus.indicator"
  | "menus.report"
  | "menus.apiAsset"
  | "menus.push"
  | "menus.codeTable"
  | "menus.system"
  | "menus.operationLogs";

type BuiltinMenuCode = Exclude<BuiltinMenuTranslationKey, "menus.operationLogs"> extends `menus.${infer Code}` ? Code : never;

const MENU_TRANSLATION_KEY: Record<BuiltinMenuCode, BuiltinMenuTranslationKey> = {
  upstream: "menus.upstream",
  dwm: "menus.dwm",
  mapping: "menus.mapping",
  lineage: "menus.lineage",
  root: "menus.root",
  indicator: "menus.indicator",
  report: "menus.report",
  apiAsset: "menus.apiAsset",
  push: "menus.push",
  codeTable: "menus.codeTable",
  system: "menus.system",
};

const DEFAULT_MENU_BY_CODE = new Map(MENU_ITEMS.map((item) => [item.code, item]));

export function getBuiltinMenuTranslationKey(
  menu: Pick<MenuItem, "code" | "name" | "path">,
): BuiltinMenuTranslationKey | null {
  if (menu.code === "system" && menu.name === "操作日志" && menu.path === "/system-management/operation-logs") {
    return "menus.operationLogs";
  }

  const defaultMenu = DEFAULT_MENU_BY_CODE.get(menu.code);
  if (!defaultMenu || defaultMenu.name !== menu.name || !(menu.code in MENU_TRANSLATION_KEY)) return null;
  return MENU_TRANSLATION_KEY[menu.code as BuiltinMenuCode];
}

export function resolveMenuDisplayName(
  menu: Pick<MenuItem, "code" | "name" | "path">,
  translate: (key: BuiltinMenuTranslationKey, defaultValue: string) => string,
): string {
  const key = getBuiltinMenuTranslationKey(menu);
  return key ? translate(key, menu.name) : menu.name;
}
