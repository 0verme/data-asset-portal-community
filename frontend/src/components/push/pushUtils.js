import { isValidLatestOutputTime } from "../../utils/push.js";
import { FREQ_PARAM_CONFIG, ID_RE, SYSTEM_ID_RE } from "./pushConstants.js";

let pushFieldSeed = 0;

export function defaultFreqParam(freqType) {
  const config = FREQ_PARAM_CONFIG[freqType];
  return config ? config.options[0].value : "";
}

export function formatFreq(job) {
  const type = job.freqType || "";
  const param = job.freq || "";
  const config = FREQ_PARAM_CONFIG[type];
  if (!config) return type;
  if (type === "每月") return param === "LAST" ? "每月末" : (param ? `每月 ${param} 号` : type);
  const matched = config.options.find((item) => item.value === param);
  if (type === "每周") return matched ? `每${matched.name}` : type;
  return matched ? matched.name : type;
}

export function createPushField() {
  return {
    _key: `push_field_${++pushFieldSeed}`,
    name: "",
    cn: "",
    meaning: "",
    src: "DWM",
    type: "string",
  };
}

export function normalizePushFields(fields) {
  return (fields || []).map((field) => ({
    _key: field._key || `push_field_${++pushFieldSeed}`,
    name: field.name || "",
    cn: field.cn || "",
    meaning: field.meaning || "",
    src: field.src || "DWM",
    type: field.type || "string",
  }));
}

export function isRenameJob(job) {
  return Boolean(job?.sourceFileName && job?.targetFileName && job.sourceFileName !== job.targetFileName);
}

export function formatRenameHint(job) {
  if (!isRenameJob(job)) return "";
  return `${job.sourceFileName} → ${job.targetFileName}`;
}

export function validateSystem(form, existingIds, oldId) {
  const errors = [];
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
    form.importanceLevel === "important"
    && form.latestOutputTime.trim()
    && !isValidLatestOutputTime(form.importanceLevel, form.latestOutputTime)
  ) {
    errors.push("最晚出数时间必须为 HH:mm 24 小时制。");
  }
  return errors;
}

export function validateJob(form, fields) {
  const errors = [];
  const fieldErrors = {};

  if (!form.cn.trim()) errors.push("作业名称不能为空。");
  if (!form.sourceFileName.trim()) errors.push("湖仓来源文件名不能为空。");
  if (FREQ_PARAM_CONFIG[form.freqType] && !form.freq) {
    errors.push(`请选择「${FREQ_PARAM_CONFIG[form.freqType].label}」。`);
  }
  if (!fields.length) errors.push("至少需要一个字段。");

  const fieldNames = new Set();
  fields.forEach((field) => {
    const rowErrors = {};
    const normalizedName = field.name.trim();
    if (!normalizedName || !ID_RE.test(normalizedName) || fieldNames.has(normalizedName)) {
      rowErrors.name = true;
    } else {
      fieldNames.add(normalizedName);
    }
    if (!field.cn.trim()) rowErrors.cn = true;
    if (Object.keys(rowErrors).length) fieldErrors[field._key] = rowErrors;
  });
  if (Object.keys(fieldErrors).length) {
    errors.push("字段名或中文名存在空值、格式错误或重复，请按红框修正。");
  }
  return { errors, fieldErrors };
}
