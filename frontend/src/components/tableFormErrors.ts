import {
  ASSET_NAME_RULE_MESSAGE,
  isValidAssetName,
} from "../utils/assetName.ts";
import { validateColumnType } from "../constants/dataTypes.ts";
import type { FormFieldErrors } from "../ui/formErrors.ts";

export type TableFormTranslator = (
  key: string,
  values?: Record<string, string | number>,
) => string;

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
  const message = (
    key: string,
    fallback: string,
    values?: Record<string, string | number>,
  ): string => translate ? translate(key, values) : fallback;

  if (!normalizedName) {
    const error = message("validation.tableNameRequired", "请输入表英文名。");
    list.push(error);
    addError("name", error);
  } else if (!isValidAssetName(normalizedName)) {
    const error = message(
      "validation.tableNameInvalid",
      `表英文名${ASSET_NAME_RULE_MESSAGE}`,
    );
    list.push(error);
    addError("name", error);
  }

  const duplicateTable = existingNames.some(
    (name) => name === normalizedName && name !== oldName,
  );
  if (normalizedName && duplicateTable) {
    const error = message("validation.tableNameTaken", `表名 ${normalizedName} 已存在。`, { tableName: normalizedName });
    list.push(error);
    addError("name", error);
  }

  if (!form.cn.trim()) {
    const error = message("validation.tableMeaningRequired", "请输入表中文名或业务含义。");
    list.push(error);
    addError("cn", error);
  }
  if (!form.domain) {
    const error = message("validation.domainRequired", "请选择主题域。");
    list.push(error);
    addError("domain", error);
  }
  if (!form.layer) {
    const error = message("validation.layerRequired", "请选择数据层级。");
    list.push(error);
    addError("layer", error);
  }
  if (!form.fields.length) {
    const error = message("validation.minimumOneField", "至少需要一个字段。");
    list.push(error);
    addError("fields", error);
  }

  const usedFieldNames = new Set<string>();
  form.fields.forEach((field) => {
    const rowErrors: TableRowErrors = {};
    const fieldName = field.name.trim();
    const fieldPath = `fields.${field._key}`;

    if (!fieldName) {
      rowErrors.name = message("validation.fieldNameRequired", "请输入字段名");
      list.push(message("validation.fieldNameRequiredSummary", "存在未填写字段名的字段。"));
      addError(`${fieldPath}.name`, rowErrors.name);
    } else if (!isValidAssetName(fieldName)) {
      rowErrors.name = message("validation.fieldNameInvalid", "字段名格式不正确");
      list.push(message("validation.fieldNameInvalidSummary", `字段 ${fieldName} 格式不正确。`, { fieldName }));
      addError(`${fieldPath}.name`, rowErrors.name);
    } else if (usedFieldNames.has(fieldName)) {
      rowErrors.name = message("validation.fieldNameDuplicate", "字段名重复");
      list.push(message("validation.fieldNameDuplicateSummary", `字段 ${fieldName} 重复。`, { fieldName }));
      addError(`${fieldPath}.name`, rowErrors.name);
    } else {
      usedFieldNames.add(fieldName);
    }

    if (!field.cn.trim()) {
      rowErrors.cn = message("validation.fieldCommentRequired", "请输入字段中文注释");
      list.push(message("validation.fieldCommentRequiredSummary", `字段 ${fieldName || "未命名字段"} 缺少中文注释。`, { fieldName: fieldName || message("validation.unnamedField", "未命名字段") }));
      addError(`${fieldPath}.cn`, rowErrors.cn);
    }

    if (field.pk && field.nullable) {
      rowErrors.nullable = message("validation.primaryKeyNotNullable", "主键字段不能可空");
      list.push(message("validation.primaryKeyNullableSummary", `字段 ${fieldName || "未命名字段"} 不能同时为主键和可空。`, { fieldName: fieldName || message("validation.unnamedField", "未命名字段") }));
      // Turning off the primary-key toggle is the actionable recovery control.
      addError(`${fieldPath}.pk`, rowErrors.nullable);
    }

    const rawTypeError = validateColumnType(field);
    if (rawTypeError) {
      const typeErrorKey = {
        "VARCHAR 长度必须为正整数": "validation.varcharLengthInvalid",
        "NUMERIC precision 必须为正整数": "validation.numericPrecisionInvalid",
        "NUMERIC scale 必须为 0 或正整数": "validation.numericScaleInvalid",
        "NUMERIC scale 不能大于 precision": "validation.numericScaleTooLarge",
      }[rawTypeError];
      const typeError = typeErrorKey && translate
        ? translate(typeErrorKey)
        : rawTypeError;
      rowErrors.type = typeError;
      rowErrors.typeField = typeErrorField(field);
      list.push(message("validation.fieldTypeInvalidSummary", `字段 ${fieldName || "未命名字段"} ${typeError}`, { fieldName: fieldName || message("validation.unnamedField", "未命名字段"), typeError }));
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
  const labels: Readonly<Record<string, string>> = {
    name: "表名（英文）",
    cn: "表中文名 / 业务含义",
    domain: "主题域",
    layer: "数据层级",
    fields: "字段信息",
  };
  const labelKeys: Readonly<Record<string, string>> = {
    name: "editor.fieldLabels.tableName",
    cn: "editor.fieldLabels.tableMeaning",
    domain: "editor.fieldLabels.domain",
    layer: "editor.fieldLabels.layer",
    fields: "editor.fieldLabels.fields",
  };
  if (labels[fieldPath]) return translate ? translate(labelKeys[fieldPath]!) : labels[fieldPath]!;

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
    const rowLabelKeys: Readonly<Record<string, string>> = {
      name: "editor.fieldLabels.rowName",
      cn: "editor.fieldLabels.rowComment",
      pk: "editor.fieldLabels.rowPrimaryKey",
      typeBase: "editor.fieldLabels.rowType",
      typeLength: "editor.fieldLabels.rowLength",
      typePrecision: "editor.fieldLabels.rowPrecision",
      typeScale: "editor.fieldLabels.rowScale",
    };
    return rowLabels[rowField]
      ? translate
        ? translate(rowLabelKeys[rowField]!, { index: index + 1 })
        : rowLabels[rowField]!
      : translate ? translate("editor.fieldLabels.fields") : "字段信息";
  }

  return translate ? translate("editor.fieldLabels.formField") : "表单字段";
}
