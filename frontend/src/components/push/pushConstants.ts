export interface PushOption {
  value: string;
  name: string;
  [key: string]: unknown;
}

export interface FrequencyParamConfig {
  label: string;
  options: readonly PushOption[];
}

export const DEFAULT_PROTOCOL_OPTIONS: readonly string[] = ["HTTP", "OSS"];
export const DEFAULT_AUTH_OPTIONS: readonly string[] = ["密钥认证", "账号密码"];
export const DEFAULT_STATUS_OPTIONS: readonly PushOption[] = [
  { value: "enabled", name: "启用" },
  { value: "disabled", name: "禁用" },
];
export const DEFAULT_FREQ_TYPE_OPTIONS: readonly PushOption[] = [
  { value: "T+1", name: "T+1" },
  { value: "T+0", name: "T+0" },
  { value: "准实时", name: "准实时" },
  { value: "每周", name: "每周" },
  { value: "每月", name: "每月" },
];

const FREQ_INTERVAL_OPTIONS: readonly PushOption[] = [
  { value: "5", name: "每 5 分钟" },
  { value: "30", name: "每 30 分钟" },
  { value: "60", name: "每小时" },
];
const FREQ_WEEKDAY_OPTIONS: readonly PushOption[] = [
  { value: "1", name: "周一" },
  { value: "2", name: "周二" },
  { value: "3", name: "周三" },
  { value: "4", name: "周四" },
  { value: "5", name: "周五" },
  { value: "6", name: "周六" },
  { value: "7", name: "周日" },
];
const FREQ_MONTHDAY_OPTIONS: readonly PushOption[] = [
  ...Array.from(
    { length: 28 },
    (_, index): PushOption => ({
      value: String(index + 1),
      name: `${index + 1} 号`,
    }),
  ),
  { value: "LAST", name: "月末" },
];

export const FREQ_PARAM_CONFIG: Readonly<Record<string, FrequencyParamConfig>> =
  {
    准实时: { label: "推送间隔", options: FREQ_INTERVAL_OPTIONS },
    每周: { label: "星期几", options: FREQ_WEEKDAY_OPTIONS },
    每月: { label: "推送日", options: FREQ_MONTHDAY_OPTIONS },
  };
export const DEFAULT_DELIMITER_OPTIONS: readonly PushOption[] = [
  { value: "|", name: "|" },
  { value: ",", name: "," },
  { value: "\\t", name: "\\t (Tab)" },
  { value: ";", name: ";" },
  { value: "\\u0001", name: "\\u0001 (SOH)" },
];
export const DEFAULT_ENCODING_OPTIONS: readonly PushOption[] = [
  { value: "UTF-8", name: "UTF-8" },
  { value: "GBK", name: "GBK" },
  { value: "GB2312", name: "GB2312" },
  { value: "ISO-8859-1", name: "ISO-8859-1" },
];
export const FIELD_TYPE_OPTIONS: readonly string[] = [
  "string",
  "bigint",
  "int",
  "decimal(18,2)",
  "decimal(10,4)",
  "double",
  "timestamp",
  "date",
  "boolean",
];
export const ID_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const SYSTEM_ID_RE = /^[A-Za-z0-9_]+$/;
