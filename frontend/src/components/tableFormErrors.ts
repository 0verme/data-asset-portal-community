import type { ParseKeys, TFunction } from "i18next";
import { i18n } from "../i18n/index.ts";
import { isValidAssetName } from "../utils/assetName.ts";
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
  t: TFunction<"warehouse"> = i18n.getFixedT(null, "warehouse"),
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
    const error = t("validation.tableNameRequired");
    list.push(error);
    addError("name", error);
  } else if (!isValidAssetName(normalizedName)) {
    const error = t("validation.tableNameInvalid");
    list.push(error);
    addError("name", error);
  }

  const duplicateTable = existingNames.some(
    (name) => name === normalizedName && name !== oldName,
  );
  if (normalizedName && duplicateTable) {
    const error = t("validation.tableNameTaken", { tableName: normalizedName });
    list.push(error);
    addError("name", error);
  }

  if (!form.cn.trim()) {
    const error = t("validation.tableMeaningRequired");
    list.push(error);
    addError("cn", error);
  }
  if (!form.domain) {
    const error = t("validation.domainRequired");
    list.push(error);
    addError("domain", error);
  }
  if (!form.layer) {
    const error = t("validation.layerRequired");
    list.push(error);
    addError("layer", error);
  }
  if (!form.fields.length) {
    const error = t("validation.minimumOneField");
    list.push(error);
    addError("fields", error);
  }

  const usedFieldNames = new Set<string>();
  form.fields.forEach((field) => {
    const rowErrors: TableRowErrors = {};
    const fieldName = field.name.trim();
    const label = fieldName || t("validation.unnamedField");
    const fieldPath = `fields.${field._key}`;

    if (!fieldName) {
      rowErrors.name = t("validation.fieldNameRequired");
      list.push(t("validation.fieldNameRequiredSummary"));
      addError(`${fieldPath}.name`, rowErrors.name);
    } else if (!isValidAssetName(fieldName)) {
      rowErrors.name = t("validation.fieldNameInvalid");
      list.push(t("validation.fieldNameInvalidSummary", { fieldName }));
      addError(`${fieldPath}.name`, rowErrors.name);
    } else if (usedFieldNames.has(fieldName)) {
      rowErrors.name = t("validation.fieldNameDuplicate");
      list.push(t("validation.fieldNameDuplicateSummary", { fieldName }));
      addError(`${fieldPath}.name`, rowErrors.name);
    } else {
      usedFieldNames.add(fieldName);
    }

    if (!field.cn.trim()) {
      rowErrors.cn = t("validation.fieldCommentRequired");
      list.push(t("validation.fieldCommentRequiredSummary", { fieldName: label }));
      addError(`${fieldPath}.cn`, rowErrors.cn);
    }

    if (field.pk && field.nullable) {
      rowErrors.nullable = t("validation.primaryKeyNotNullable");
      list.push(t("validation.primaryKeyNullableSummary", { fieldName: label }));
      // Turning off the primary-key toggle is the actionable recovery control.
      addError(`${fieldPath}.pk`, rowErrors.nullable);
    }

    const rawTypeError = validateColumnType(field);
    if (rawTypeError) {
      const typeErrorKeys: Readonly<Record<string, ParseKeys<"warehouse">>> = {
        "VARCHAR 长度必须为正整数": "validation.varcharLengthInvalid",
        "NUMERIC precision 必须为正整数": "validation.numericPrecisionInvalid",
        "NUMERIC scale 必须为 0 或正整数": "validation.numericScaleInvalid",
        "NUMERIC scale 不能大于 precision": "validation.numericScaleTooLarge",
      };
      const key = typeErrorKeys[rawTypeError];
      const typeError = key ? t(key) : rawTypeError;
      rowErrors.type = typeError;
      rowErrors.typeField = typeErrorField(field);
      list.push(t("validation.fieldTypeInvalidSummary", { fieldName: label, typeError }));
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
  t: TFunction<"warehouse"> = i18n.getFixedT(null, "warehouse"),
): string {
  const labelKeys: Readonly<Record<string, ParseKeys<"warehouse">>> = {
    name: "editor.fieldLabels.tableName",
    cn: "editor.fieldLabels.tableMeaning",
    domain: "editor.fieldLabels.domain",
    layer: "editor.fieldLabels.layer",
    fields: "editor.fieldLabels.fields",
  };
  const key = labelKeys[fieldPath];
  if (key) return t(key);

  for (const [index, field] of fields.entries()) {
    const prefix = `fields.${field._key}.`;
    if (!fieldPath.startsWith(prefix)) continue;
    const rowField = fieldPath.slice(prefix.length);
    const rowLabelKeys: Readonly<Record<string, ParseKeys<"warehouse">>> = {
      name: "editor.fieldLabels.rowName",
      cn: "editor.fieldLabels.rowComment",
      pk: "editor.fieldLabels.rowPrimaryKey",
      typeBase: "editor.fieldLabels.rowType",
      typeLength: "editor.fieldLabels.rowLength",
      typePrecision: "editor.fieldLabels.rowPrecision",
      typeScale: "editor.fieldLabels.rowScale",
    };
    return t(rowLabelKeys[rowField] ?? "editor.fieldLabels.fields", { index: index + 1 });
  }
  return t("editor.fieldLabels.formField");
}
