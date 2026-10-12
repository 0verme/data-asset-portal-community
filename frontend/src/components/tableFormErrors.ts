import {
  ASSET_NAME_RULE_MESSAGE,
  isValidAssetName,
} from "../utils/assetName.ts";
import { validateColumnType } from "../constants/dataTypes.ts";
import type { FormFieldErrors } from "../ui/formErrors.ts";

export interface TableValidationRow {
  _key: string;
  name: string;
  cn: string;
  typeBase: string;
  typeLength: string;
  typePrecision: string;
  typeScale: string;
  nullable: boolean;
  pk: boolean;
}

export interface TableValidationValues {
  name: string;
  cn: string;
  domain: string;
  layer: string;
  fields: readonly TableValidationRow[];
}

export type TableTypeErrorField = "typeBase" | "typeLength" | "typePrecision" | "typeScale";

export interface TableRowErrors {
  name?: string;
  cn?: string;
  nullable?: string;
  type?: string;
  typeField?: TableTypeErrorField;
}

export interface TableValidation {
  /** Existing validation copy, retained for behavioral regression tests. */
  list: string[];
  /** Errors used by the existing row styling and inline type feedback. */
  fields: Record<string, TableRowErrors>;
  /** Safe canonical paths consumed by the shared form presenter. */
  formFields: FormFieldErrors;
}

function typeErrorField(field: TableValidationRow): TableTypeErrorField {
  const baseType = field.typeBase.trim().toUpperCase();
  if (baseType === "VARCHAR") return "typeLength";
  if (baseType === "NUMERIC") {
    const precision = field.typePrecision.trim();
    if (!/^\d+$/.test(precision) || Number(precision) <= 0) return "typePrecision";
    return "typeScale";
  }
  return "typeBase";
}

export function validateTableForm(
  form: TableValidationValues,
  existingNames: readonly string[],
  oldName: string,
): TableValidation {
  const list: string[] = [];
  const fields: Record<string, TableRowErrors> = {};
  const formFields: Record<string, string> = {};
  const addError = (field: string, message: string): void => {
    const existing = formFields[field];
    formFields[field] = existing && !existing.includes(message)
      ? `${existing} ${message}`
      : existing || message;
  };
  const normalizedName = form.name.trim();

  if (!normalizedName) {
    const message = "请输入表英文名。";
    list.push(message);
    addError("name", message);
  } else if (!isValidAssetName(normalizedName)) {
    const message = `表英文名${ASSET_NAME_RULE_MESSAGE}`;
    list.push(message);
    addError("name", message);
  }

  const duplicateTable = existingNames.some(
    (name) => name === normalizedName && name !== oldName,
  );
  if (normalizedName && duplicateTable) {
    const message = `表名 ${normalizedName} 已存在。`;
    list.push(message);
    addError("name", message);
  }

  if (!form.cn.trim()) {
    const message = "请输入表中文名或业务含义。";
    list.push(message);
    addError("cn", message);
  }
  if (!form.domain) {
    const message = "请选择主题域。";
    list.push(message);
    addError("domain", message);
  }
  if (!form.layer) {
    const message = "请选择数据层级。";
    list.push(message);
    addError("layer", message);
  }
  if (!form.fields.length) {
    const message = "至少需要一个字段。";
    list.push(message);
    addError("fields", message);
  }

  const usedFieldNames = new Set<string>();
  form.fields.forEach((field) => {
    const rowErrors: TableRowErrors = {};
    const fieldName = field.name.trim();
    const fieldPath = `fields.${field._key}`;

    if (!fieldName) {
      rowErrors.name = "请输入字段名";
      list.push("存在未填写字段名的字段。");
      addError(`${fieldPath}.name`, rowErrors.name);
    } else if (!isValidAssetName(fieldName)) {
      rowErrors.name = "字段名格式不正确";
      list.push(`字段 ${fieldName} 格式不正确。`);
      addError(`${fieldPath}.name`, rowErrors.name);
    } else if (usedFieldNames.has(fieldName)) {
      rowErrors.name = "字段名重复";
      list.push(`字段 ${fieldName} 重复。`);
      addError(`${fieldPath}.name`, rowErrors.name);
    } else {
      usedFieldNames.add(fieldName);
    }

    if (!field.cn.trim()) {
      rowErrors.cn = "请输入字段中文注释";
      list.push(`字段 ${fieldName || "未命名字段"} 缺少中文注释。`);
      addError(`${fieldPath}.cn`, rowErrors.cn);
    }

    if (field.pk && field.nullable) {
      rowErrors.nullable = "主键字段不能可空";
      list.push(`字段 ${fieldName || "未命名字段"} 不能同时为主键和可空。`);
      // Turning off the primary-key toggle is the actionable recovery control.
      addError(`${fieldPath}.pk`, rowErrors.nullable);
    }

    const typeError = validateColumnType(field);
    if (typeError) {
      rowErrors.type = typeError;
      rowErrors.typeField = typeErrorField(field);
      list.push(`字段 ${fieldName || "未命名字段"} ${typeError}`);
      addError(`${fieldPath}.${rowErrors.typeField}`, typeError);
    }

    if (Object.keys(rowErrors).length) fields[field._key] = rowErrors;
  });

  return {
    list: [...new Set(list)],
    fields,
    formFields,
  };
}

export function getTableFieldLabel(
  fieldPath: string,
  fields: readonly Pick<TableValidationRow, "_key">[],
): string {
  const labels: Readonly<Record<string, string>> = {
    name: "表名（英文）",
    cn: "表中文名 / 业务含义",
    domain: "主题域",
    layer: "数据层级",
    fields: "字段信息",
  };
  if (labels[fieldPath]) return labels[fieldPath]!;

  for (const [index, field] of fields.entries()) {
    const prefix = `fields.${field._key}.`;
    if (!fieldPath.startsWith(prefix)) continue;
    const rowField = fieldPath.slice(prefix.length);
    const rowLabels: Readonly<Record<string, string>> = {
      name: `字段${index + 1}字段名`,
      cn: `字段${index + 1}中文注释`,
      pk: `字段${index + 1}主键设置`,
      typeBase: `字段${index + 1}数据类型`,
      typeLength: `字段${index + 1}类型长度`,
      typePrecision: `字段${index + 1}精度`,
      typeScale: `字段${index + 1}小数位`,
    };
    return rowLabels[rowField] || "字段信息";
  }

  return "表单字段";
}
