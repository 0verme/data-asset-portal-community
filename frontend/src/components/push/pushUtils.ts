import { isValidLatestOutputTime } from "../../utils/push.ts";
import { FREQ_PARAM_CONFIG, ID_RE, SYSTEM_ID_RE } from "./pushConstants.ts";

let pushFieldSeed = 0;

export interface PushOptionField {
  _key: string;
  name: string;
  cn: string;
  meaning: string;
  src: string;
  type: string;
}

export type PushField = PushOptionField;

export interface PushJobLike {
  cn?: string | undefined;
  sourceFileName?: string | undefined;
  targetFileName?: string | undefined;
  sourcePath?: string | undefined;
  targetPath?: string | undefined;
  freqType?: string | undefined;
  freq?: string | undefined;
  enabled?: boolean | undefined;
}

export interface PushSystemForm {
  id: string;
  name: string;
  abbr: string;
  host: string;
  port: string | number;
  importanceLevel: string;
  latestOutputTime: string;
}

export interface PushJobForm {
  cn: string;
  sourceFileName: string;
  freqType: string;
  freq: string;
}

export interface FieldValidationErrors {
  name?: boolean | undefined;
  cn?: boolean | undefined;
}

export interface JobValidationResult {
  errors: string[];
  fieldErrors: Record<string, FieldValidationErrors>;
  /** Safe local messages keyed by the controls that can correct each error. */
  formFields: Record<string, string>;
}

export function defaultFreqParam(freqType: string): string {
  const config = FREQ_PARAM_CONFIG[freqType];
  return config?.options[0]?.value || "";
}

type TranslatePushCopy = (source: string, options?: Readonly<Record<string, unknown>>) => string;
const identityCopy: TranslatePushCopy = (source, options = {}) =>
  Object.entries(options).reduce(
    (message, [key, value]) => message.split(`{{${key}}}`).join(String(value)),
    source,
  );

export function formatFreq(job: PushJobLike = {}, translate: TranslatePushCopy = identityCopy): string {
  const type = job.freqType || "";
  const param = job.freq || "";
  const config = FREQ_PARAM_CONFIG[type];
  if (!config) return type;
  if (type === "每月")
    return param === "LAST" ? translate("每月末") : param ? translate("每月 {{param}} 号", { param }) : translate(type);
  const matched = config.options.find((item) => item.value === param);
  if (type === "每周") return matched ? translate("每{{weekday}}", { weekday: translate(matched.name) }) : translate(type);
  return matched ? translate(matched.name) : translate(type);
}

export function createPushField(): PushField {
  return {
    _key: `push_field_${++pushFieldSeed}`,
    name: "",
    cn: "",
    meaning: "",
    src: "DWM",
    type: "string",
  };
}

export function normalizePushFields(
  fields: readonly Partial<PushField>[] | null | undefined,
): PushField[] {
  return (fields || []).map((field) => ({
    _key: field._key || `push_field_${++pushFieldSeed}`,
    name: field.name || "",
    cn: field.cn || "",
    meaning: field.meaning || "",
    src: field.src || "DWM",
    type: field.type || "string",
  }));
}

export function isRenameJob(job: PushJobLike | null | undefined): boolean {
  return Boolean(
    job?.sourceFileName &&
      job?.targetFileName &&
      job.sourceFileName !== job.targetFileName,
  );
}

export function formatRenameHint(job: PushJobLike | null | undefined): string {
  if (!isRenameJob(job)) return "";
  return `${job?.sourceFileName} → ${job?.targetFileName}`;
}

export function validateSystem(
  form: PushSystemForm,
  existingIds: readonly string[],
  oldId: string,
  translate: TranslatePushCopy = identityCopy,
): string[] {
  const errors: string[] = [];
  const normalizedId = form.id.trim();

  if (!form.name.trim()) errors.push(translate("系统名称不能为空。"));
  if (!normalizedId) {
    errors.push(translate("系统编号不能为空。"));
  } else if (!SYSTEM_ID_RE.test(normalizedId)) {
    errors.push(translate("系统编号只允许字母、数字和下划线。"));
  } else if (existingIds.some((id) => id === normalizedId && id !== oldId)) {
    errors.push(translate("系统编号 {{id}} 已存在。", { id: normalizedId }));
  }
  if (!form.abbr.trim()) errors.push(translate("系统缩写不能为空。"));
  if (!form.host.trim()) errors.push(translate("服务器地址不能为空。"));
  if (!String(form.port).trim() || Number.isNaN(Number(form.port))) {
    errors.push(translate("端口必须为数字。"));
  }
  if (
    form.importanceLevel === "important" &&
    form.latestOutputTime.trim() &&
    !isValidLatestOutputTime(form.importanceLevel, form.latestOutputTime)
  ) {
    errors.push(translate("最晚出数时间必须为 HH:mm 24 小时制。"));
  }
  return errors;
}

export function validateJob(
  form: PushJobForm,
  fields: readonly PushField[],
  translate: TranslatePushCopy = identityCopy,
): JobValidationResult {
  const errors: string[] = [];
  const fieldErrors: Record<string, FieldValidationErrors> = {};
  const formFields: Record<string, string> = {};

  if (!form.cn.trim()) {
    const message = translate("作业名称不能为空。");
    errors.push(message);
    formFields["cn"] = message;
  }
  if (!form.sourceFileName.trim()) {
    const message = translate("湖仓来源文件名不能为空。");
    errors.push(message);
    formFields["sourceFileName"] = message;
  }
  const freqConfig = FREQ_PARAM_CONFIG[form.freqType];
  if (freqConfig && !form.freq) {
    const message = translate("请选择「{{label}}」。", { label: translate(freqConfig.label) });
    errors.push(message);
    formFields["freq"] = message;
  }
  if (!fields.length) {
    const message = translate("至少需要一个字段。");
    errors.push(message);
    formFields["fields"] = message;
  }

  const fieldNames = new Set<string>();
  fields.forEach((field) => {
    const rowErrors: FieldValidationErrors = {};
    const normalizedName = field.name.trim();
    const namePath = `fields.${field._key}.name`;
    if (!normalizedName) {
      rowErrors.name = true;
      formFields[namePath] = translate("请输入字段名。");
    } else if (!ID_RE.test(normalizedName)) {
      rowErrors.name = true;
      formFields[namePath] = translate("字段名格式不正确，请使用字母、数字和下划线，且以字母或下划线开头。");
    } else if (fieldNames.has(normalizedName)) {
      rowErrors.name = true;
      formFields[namePath] = translate("字段名重复，请保持唯一。");
    } else {
      fieldNames.add(normalizedName);
    }
    if (!field.cn.trim()) {
      rowErrors.cn = true;
      formFields[`fields.${field._key}.cn`] = translate("请输入字段中文名。");
    }
    if (Object.keys(rowErrors).length) fieldErrors[field._key] = rowErrors;
  });
  if (Object.keys(fieldErrors).length) {
    errors.push(translate("字段名或中文名存在空值、格式错误或重复，请按红框修正。"));
  }
  return { errors, fieldErrors, formFields };
}

export function getJobFormFieldLabel(
  fieldPath: string,
  fields: readonly Pick<PushField, "_key">[],
  freqType: string,
  translate: TranslatePushCopy = identityCopy,
): string {
  if (fieldPath === "cn") return translate("作业名称");
  if (fieldPath === "sourceFileName") return translate("湖仓来源文件名");
  if (fieldPath === "freq") return translate(FREQ_PARAM_CONFIG[freqType]?.label || "推送频率明细");
  if (fieldPath === "fields") return translate("字段清单");

  for (const [index, field] of fields.entries()) {
    const prefix = `fields.${field._key}.`;
    if (!fieldPath.startsWith(prefix)) continue;
    const rowField = fieldPath.slice(prefix.length);
    if (rowField === "name") return translate("字段{{index}}字段名", { index: index + 1 });
    if (rowField === "cn") return translate("字段{{index}}中文名", { index: index + 1 });
    return translate("字段信息");
  }
  return translate("表单字段");
}
