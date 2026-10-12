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

export function formatFreq(job: PushJobLike = {}): string {
  const type = job.freqType || "";
  const param = job.freq || "";
  const config = FREQ_PARAM_CONFIG[type];
  if (!config) return type;
  if (type === "每月")
    return param === "LAST" ? "每月末" : param ? `每月 ${param} 号` : type;
  const matched = config.options.find((item) => item.value === param);
  if (type === "每周") return matched ? `每${matched.name}` : type;
  return matched ? matched.name : type;
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
): string[] {
  const errors: string[] = [];
  const normalizedId = form.id.trim();

  if (!form.name.trim()) errors.push("系统名称不能为空。");
  if (!normalizedId) {
    errors.push("系统编号不能为空。");
  } else if (!SYSTEM_ID_RE.test(normalizedId)) {
    errors.push("系统编号只允许字母、数字和下划线。");
  } else if (existingIds.some((id) => id === normalizedId && id !== oldId)) {
    errors.push(`系统编号 ${normalizedId} 已存在。`);
  }
  if (!form.abbr.trim()) errors.push("系统缩写不能为空。");
  if (!form.host.trim()) errors.push("服务器地址不能为空。");
  if (!String(form.port).trim() || Number.isNaN(Number(form.port))) {
    errors.push("端口必须为数字。");
  }
  if (
    form.importanceLevel === "important" &&
    form.latestOutputTime.trim() &&
    !isValidLatestOutputTime(form.importanceLevel, form.latestOutputTime)
  ) {
    errors.push("最晚出数时间必须为 HH:mm 24 小时制。");
  }
  return errors;
}

export function validateJob(
  form: PushJobForm,
  fields: readonly PushField[],
): JobValidationResult {
  const errors: string[] = [];
  const fieldErrors: Record<string, FieldValidationErrors> = {};
  const formFields: Record<string, string> = {};

  if (!form.cn.trim()) {
    const message = "作业名称不能为空。";
    errors.push(message);
    formFields["cn"] = message;
  }
  if (!form.sourceFileName.trim()) {
    const message = "湖仓来源文件名不能为空。";
    errors.push(message);
    formFields["sourceFileName"] = message;
  }
  const freqConfig = FREQ_PARAM_CONFIG[form.freqType];
  if (freqConfig && !form.freq) {
    const message = `请选择「${freqConfig.label}」。`;
    errors.push(message);
    formFields["freq"] = message;
  }
  if (!fields.length) {
    const message = "至少需要一个字段。";
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
      formFields[namePath] = "请输入字段名。";
    } else if (!ID_RE.test(normalizedName)) {
      rowErrors.name = true;
      formFields[namePath] = "字段名格式不正确，请使用字母、数字和下划线，且以字母或下划线开头。";
    } else if (fieldNames.has(normalizedName)) {
      rowErrors.name = true;
      formFields[namePath] = "字段名重复，请保持唯一。";
    } else {
      fieldNames.add(normalizedName);
    }
    if (!field.cn.trim()) {
      rowErrors.cn = true;
      formFields[`fields.${field._key}.cn`] = "请输入字段中文名。";
    }
    if (Object.keys(rowErrors).length) fieldErrors[field._key] = rowErrors;
  });
  if (Object.keys(fieldErrors).length) {
    errors.push("字段名或中文名存在空值、格式错误或重复，请按红框修正。");
  }
  return { errors, fieldErrors, formFields };
}

export function getJobFormFieldLabel(
  fieldPath: string,
  fields: readonly Pick<PushField, "_key">[],
  freqType: string,
): string {
  if (fieldPath === "cn") return "作业名称";
  if (fieldPath === "sourceFileName") return "湖仓来源文件名";
  if (fieldPath === "freq") return FREQ_PARAM_CONFIG[freqType]?.label || "推送频率明细";
  if (fieldPath === "fields") return "字段清单";

  for (const [index, field] of fields.entries()) {
    const prefix = `fields.${field._key}.`;
    if (!fieldPath.startsWith(prefix)) continue;
    const rowField = fieldPath.slice(prefix.length);
    if (rowField === "name") return `字段${index + 1}字段名`;
    if (rowField === "cn") return `字段${index + 1}中文名`;
    return "字段信息";
  }
  return "表单字段";
}
