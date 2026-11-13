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

export type TableFormTranslationKey =
  | "validation.tableNameRequired"
  | "validation.tableNameRule"
  | "validation.duplicateTableName"
  | "validation.tableMeaningRequired"
  | "validation.domainRequired"
  | "validation.layerRequired"
  | "validation.fieldsRequired"
  | "validation.fieldNameRequired"
  | "validation.fieldNameInvalid"
  | "validation.duplicateFieldName"
  | "validation.fieldMeaningRequired"
  | "validation.primaryKeyNullable"
  | "validation.varcharLength"
  | "validation.numericPrecision"
  | "validation.numericScale"
  | "validation.numericScalePrecision"
  | "fieldLabels.tableName"
  | "fieldLabels.tableMeaning"
  | "fieldLabels.domain"
  | "fieldLabels.layer"
  | "fieldLabels.fields"
  | "fieldLabels.fieldName"
  | "fieldLabels.fieldMeaning"
  | "fieldLabels.primaryKey"
  | "fieldLabels.dataType"
  | "fieldLabels.typeLength"
  | "fieldLabels.precision"
  | "fieldLabels.scale"
  | "fieldLabels.unknownField";

export type TableFormTranslator = (
  key: TableFormTranslationKey,
  values?: Record<string, string | number>,
) => string;

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
  translate?: TableFormTranslator,
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
  const text = (
    key: TableFormTranslationKey,
    fallback: string,
    values?: Record<string, string | number>,
  ): string => translate?.(key, values) ?? fallback;

  if (!normalizedName) {
    const message = text("validation.tableNameRequired", "请输入表英文名。");
    list.push(message);
    addError("name", message);
  } else if (!isValidAssetName(normalizedName)) {
    const message = text("validation.tableNameRule", `表英文名${ASSET_NAME_RULE_MESSAGE}`);
    list.push(message);
    addError("name", message);
  }

  const duplicateTable = existingNames.some(
    (name) => name === normalizedName && name !== oldName,
  );
  if (normalizedName && duplicateTable) {
    const message = text("validation.duplicateTableName", `表名 ${normalizedName} 已存在。`, { name: normalizedName });
    list.push(message);
    addError("name", message);
  }

  if (!form.cn.trim()) {
    const message = text("validation.tableMeaningRequired", "请输入表中文名或业务含义。");
    list.push(message);
    addError("cn", message);
  }
  if (!form.domain) {
    const message = text("validation.domainRequired", "请选择主题域。");
    list.push(message);
    addError("domain", message);
  }
  if (!form.layer) {
    const message = text("validation.layerRequired", "请选择数据层级。");
    list.push(message);
    addError("layer", message);
  }
  if (!form.fields.length) {
    const message = text("validation.fieldsRequired", "至少需要一个字段。");
    list.push(message);
    addError("fields", message);
  }

  const usedFieldNames = new Set<string>();
  form.fields.forEach((field) => {
    const rowErrors: TableRowErrors = {};
    const fieldName = field.name.trim();
    const fieldPath = `fields.${field._key}`;

    if (!fieldName) {
      rowErrors.name = text("validation.fieldNameRequired", "请输入字段名");
      list.push(text("validation.fieldNameRequired", "存在未填写字段名的字段。"));
      addError(`${fieldPath}.name`, rowErrors.name);
    } else if (!isValidAssetName(fieldName)) {
      rowErrors.name = text("validation.fieldNameInvalid", "字段名格式不正确");
      list.push(text("validation.fieldNameInvalid", `字段 ${fieldName} 格式不正确。`, { name: fieldName }));
      addError(`${fieldPath}.name`, rowErrors.name);
    } else if (usedFieldNames.has(fieldName)) {
      rowErrors.name = text("validation.duplicateFieldName", "字段名重复");
      list.push(text("validation.duplicateFieldName", `字段 ${fieldName} 重复。`, { name: fieldName }));
      addError(`${fieldPath}.name`, rowErrors.name);
    } else {
      usedFieldNames.add(fieldName);
    }

    if (!field.cn.trim()) {
      rowErrors.cn = text("validation.fieldMeaningRequired", "请输入字段中文注释");
      list.push(text("validation.fieldMeaningRequired", `字段 ${fieldName || "未命名字段"} 缺少中文注释。`, { name: fieldName || "未命名字段" }));
      addError(`${fieldPath}.cn`, rowErrors.cn);
    }

    if (field.pk && field.nullable) {
      rowErrors.nullable = text("validation.primaryKeyNullable", "主键字段不能可空");
      list.push(text("validation.primaryKeyNullable", `字段 ${fieldName || "未命名字段"} 不能同时为主键和可空。`, { name: fieldName || "未命名字段" }));
      // Turning off the primary-key toggle is the actionable recovery control.
      addError(`${fieldPath}.pk`, rowErrors.nullable);
    }

    const rawTypeError = validateColumnType(field);
    const typeErrorKey: TableFormTranslationKey | null = rawTypeError === "VARCHAR 长度必须为正整数"
      ? "validation.varcharLength"
      : rawTypeError === "NUMERIC precision 必须为正整数"
        ? "validation.numericPrecision"
        : rawTypeError === "NUMERIC scale 必须为 0 或正整数"
          ? "validation.numericScale"
          : rawTypeError === "NUMERIC scale 不能大于 precision"
            ? "validation.numericScalePrecision"
            : null;
    const typeError = rawTypeError && typeErrorKey
      ? text(typeErrorKey, rawTypeError)
      : rawTypeError;
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
  translate?: TableFormTranslator,
): string {
  const labels: Readonly<Record<string, { key: TableFormTranslationKey; fallback: string }>> = {
    name: { key: "fieldLabels.tableName", fallback: "表名（英文）" },
    cn: { key: "fieldLabels.tableMeaning", fallback: "表中文名 / 业务含义" },
    domain: { key: "fieldLabels.domain", fallback: "主题域" },
    layer: { key: "fieldLabels.layer", fallback: "数据层级" },
    fields: { key: "fieldLabels.fields", fallback: "字段信息" },
  };
  if (labels[fieldPath]) {
    const label = labels[fieldPath]!;
    return translate?.(label.key) ?? label.fallback;
  }

  for (const [index, field] of fields.entries()) {
    const prefix = `fields.${field._key}.`;
    if (!fieldPath.startsWith(prefix)) continue;
    const rowField = fieldPath.slice(prefix.length);
    const rowLabels: Readonly<Record<string, { key: TableFormTranslationKey; fallback: string }>> = {
      name: { key: "fieldLabels.fieldName", fallback: `字段${index + 1}字段名` },
      cn: { key: "fieldLabels.fieldMeaning", fallback: `字段${index + 1}中文注释` },
      pk: { key: "fieldLabels.primaryKey", fallback: `字段${index + 1}主键设置` },
      typeBase: { key: "fieldLabels.dataType", fallback: `字段${index + 1}数据类型` },
      typeLength: { key: "fieldLabels.typeLength", fallback: `字段${index + 1}类型长度` },
      typePrecision: { key: "fieldLabels.precision", fallback: `字段${index + 1}精度` },
      typeScale: { key: "fieldLabels.scale", fallback: `字段${index + 1}小数位` },
    };
    const label = rowLabels[rowField];
    return label ? translate?.(label.key, { index: index + 1 }) ?? label.fallback : translate?.("fieldLabels.unknownField") ?? "字段信息";
  }

  return translate?.("fieldLabels.unknownField") ?? "表单字段";
}
