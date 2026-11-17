export const ROOT_CATEGORIES = [
  "业务对象",
  "经营度量",
  "状态属性",
  "时间周期",
  "数据处理",
  "技术后缀",
] as const;

export type RootCategory = (typeof ROOT_CATEGORIES)[number];

export interface MockWordRoot {
  abbr: string;
  en: string;
  cn: string;
  cat: string;
  desc: string;
  example: string;
  status: string;
}

// Root content is authoritative database data. Keep mock mode empty instead of
// presenting sample business roots as if they were maintained catalog entries.
export const WORD_ROOTS: MockWordRoot[] = [];
