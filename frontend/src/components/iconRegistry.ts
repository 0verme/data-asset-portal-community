export const SUPPORTED_ICON_NAMES = [
  "search",
  "close",
  "arrow",
  "chevron",
  "list",
  "grid",
  "layers",
  "table",
  "columns",
  "plus",
  "code",
  "copy",
  "check",
  "save",
  "edit",
  "user",
  "eye",
  "eyeoff",
  "clock",
  "key",
  "hash",
  "db",
  "filter",
  "inbox",
  "trash",
  "up",
  "down",
  "refresh",
  "server",
  "push",
  "file",
  "info",
  "book",
  "upload",
  "download",
  "link",
  "menu",
  "sun",
  "moon",
  "login",
  "logout",
  "shield",
  "api",
] as const;

export type SupportedIconName = (typeof SUPPORTED_ICON_NAMES)[number];

const supportedIconNames: ReadonlySet<string> = new Set(SUPPORTED_ICON_NAMES);

export function hasIcon(name: string): name is SupportedIconName {
  return supportedIconNames.has(name);
}

export function resolveIconName(name: string): SupportedIconName {
  return hasIcon(name) ? name : "grid";
}
