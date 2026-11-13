// Copyright 2025 Jearhe
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import React from "react";
import { useTranslation } from "react-i18next";

import type { AssetTableField, AssetTableItem } from "../api/assets.ts";
import {
  DATA_TYPE_BASE_OPTIONS,
  DEFAULT_DATA_TYPE,
  DEFAULT_NUMERIC_PRECISION,
  DEFAULT_NUMERIC_SCALE,
  DEFAULT_VARCHAR_LENGTH,
  buildColumnType,
  parseColumnType,
} from "../constants/dataTypes.ts";
import { LAYER_OPTIONS, type LayerOption } from "../config/assets.ts";
import { buildModuleBreadcrumbs } from "../routing/navigation.ts";
import { PageHeader } from "./common/index.ts";
import {
  Button,
  FormErrorSummary,
  FormField,
  focusFirstFormError,
  IconButton,
  Input,
  Select,
  Textarea,
} from "../ui/index.ts";
import { getTableFieldLabel, validateTableForm, type TableFormTranslator, type TableRowErrors, type TableValidation } from "./tableFormErrors.ts";
import { AssetDeleteZone, AssetEditorActionBar } from "./views/asset/AssetEditorActions.tsx";
import { Icon } from "./ui.tsx";

interface EditorField {
  _key: string;
  name: string;
  cn: string;
  type: string;
  typeBase: string;
  typeLength: string;
  typePrecision: string;
  typeScale: string;
  nullable: boolean;
  pk: boolean;
  part: boolean;
  enum: string;
}

interface TableFormData {
  name: string;
  cn: string;
  domain: string;
  layer: string;
  owner: string;
  grain: string;
  cycle: string;
  desc: string;
  fields: EditorField[];
}

type DataTypeBase = (typeof DATA_TYPE_BASE_OPTIONS)[number];

function isDataTypeBase(value: string): value is DataTypeBase {
  return (DATA_TYPE_BASE_OPTIONS as readonly string[]).includes(value);
}

const TABLE_FORM_ID = "table-editor-form";
const EMPTY_TABLE_VALIDATION: TableValidation = { list: [], fields: {}, formFields: {} };

function createField(): EditorField {
  const typeParts = parseColumnType(DEFAULT_DATA_TYPE);
  return {
    _key: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: "",
    cn: "",
    type: typeParts.normalizedType,
    typeBase: typeParts.baseType,
    typeLength: typeParts.length,
    typePrecision: String(typeParts.precision || DEFAULT_NUMERIC_PRECISION),
    typeScale: String(typeParts.scale || DEFAULT_NUMERIC_SCALE),
    nullable: false,
    pk: false,
    part: false,
    enum: "",
  };
}

function normalizeField(field: AssetTableField, index: number): EditorField {
  const typeParts = parseColumnType(field.type);
  return {
    _key: `${field.name || "field"}_${index}`,
    name: field.name || "",
    cn: field.cn || "",
    type: typeParts.normalizedType,
    typeBase: typeParts.baseType,
    typeLength: typeParts.length,
    typePrecision: String(typeParts.precision || DEFAULT_NUMERIC_PRECISION),
    typeScale: String(typeParts.scale || DEFAULT_NUMERIC_SCALE),
    nullable: !!field.nullable,
    pk: !!field.pk,
    part: !!field.part,
    enum: field.enum || "",
  };
}

function syncFieldType(field: EditorField): EditorField {
  return {
    ...field,
    type: buildColumnType(field),
  };
}

function normalizeInitial(
  initial: AssetTableItem | null | undefined,
  defaultLayer = "DWM",
): TableFormData {
  if (!initial) {
    return {
      name: "",
      cn: "",
      domain: "",
      layer: defaultLayer,
      owner: "",
      grain: "",
      cycle: "",
      desc: "",
      fields: [createField()],
    };
  }

  return {
    name: initial.name || "",
    cn: initial.cn || "",
    domain: initial.domain || "",
    layer: initial.layer || defaultLayer,
    owner: initial.owner || "",
    grain: initial.grain || "",
    cycle: initial.cycle || "",
    desc: initial.desc || "",
    fields: (initial.fields || []).map(normalizeField),
  };
}

export interface TableEditorProps {
  mode: "new" | "edit";
  initial?: AssetTableItem | null | undefined;
  existingNames: readonly string[];
  domains: readonly string[];
  layers?: readonly LayerOption[] | undefined;
  defaultLayer?: string | undefined;
  onCancel: () => void;
  onBackToList: () => void;
  onBackToDetail?: (() => void) | undefined;
  onSave: (table: AssetTableItem, oldName?: string) => void | Promise<unknown>;
  onDelete?: ((tableName: string) => void | Promise<unknown>) | undefined;
}

export function TableEditor({
  mode,
  initial = null,
  existingNames,
  domains,
  layers = LAYER_OPTIONS,
  defaultLayer = "DWM",
  onCancel,
  onBackToList,
  onBackToDetail,
  onSave,
  onDelete,
}: TableEditorProps) {
  const { t } = useTranslation("warehouse");
  const translateValidation: TableFormTranslator = (key, values) => values ? t(key, values) : t(key);
  const isEdit = mode === "edit";
  const oldName = initial?.name || "";
  const [form, setForm] = React.useState<TableFormData>(() =>
    normalizeInitial(initial, defaultLayer),
  );
  const [touched, setTouched] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [validationFocusRequest, setValidationFocusRequest] = React.useState(0);
  const formRef = React.useRef<HTMLDivElement>(null);
  const handledValidationFocusRequestRef = React.useRef(0);
  const initialSnapshotRef = React.useRef(JSON.stringify(form));
  const isDirty = initialSnapshotRef.current !== JSON.stringify(form);
  const deleteInitial = isEdit ? initial : null;

  React.useEffect(() => {
    const nextForm = normalizeInitial(initial, defaultLayer);
    setForm(nextForm);
    setTouched(false);
    initialSnapshotRef.current = JSON.stringify(nextForm);
  }, [defaultLayer, initial]);

  const validation = React.useMemo(
    () => touched ? validateTableForm(form, existingNames, oldName, translateValidation) : EMPTY_TABLE_VALIDATION,
    [existingNames, form, oldName, touched, t],
  );

  React.useLayoutEffect(() => {
    if (validationFocusRequest <= handledValidationFocusRequestRef.current) return;
    handledValidationFocusRequestRef.current = validationFocusRequest;
    focusFirstFormError(formRef.current, validation.formFields, "auto");
  }, [validation.formFields, validationFocusRequest]);

  const setValue = <K extends keyof TableFormData>(
    key: K,
    value: TableFormData[K],
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const setField = (fieldKey: string, patch: Partial<EditorField>) => {
    setForm((prev) => ({
      ...prev,
      fields: prev.fields.map((field) => {
        if (field._key !== fieldKey) return field;
        const next: EditorField = { ...field, ...patch };
        if (next.pk) next.nullable = false;
        return syncFieldType(next);
      }),
    }));
  };

  const addField = () => {
    setForm((prev) => ({ ...prev, fields: [...prev.fields, createField()] }));
  };

  const deleteField = (fieldKey: string) => {
    setForm((prev) => ({
      ...prev,
      fields: prev.fields.filter((field) => field._key !== fieldKey),
    }));
  };

  const moveField = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= form.fields.length) return;

    setForm((prev) => {
      const current = prev.fields[index];
      const target = prev.fields[nextIndex];
      if (!current || !target) return prev;
      const nextFields = [...prev.fields];
      nextFields[index] = target;
      nextFields[nextIndex] = current;
      return { ...prev, fields: nextFields };
    });
  };

  const save = async (): Promise<void> => {
    const nextValidation = validateTableForm(form, existingNames, oldName, translateValidation);
    const hasErrors = Object.keys(nextValidation.formFields).length > 0;
    setTouched(true);
    if (hasErrors || saving) {
      if (hasErrors) setValidationFocusRequest((request) => request + 1);
      return;
    }

    setSaving(true);
    try {
      await onSave(
        {
          ...(initial || {}),
          name: form.name.trim(),
          cn: form.cn.trim(),
          domain: form.domain,
          layer: form.layer,
          owner: form.owner.trim() || "未指定",
          grain: form.grain.trim() || "未填写",
          cycle: form.cycle.trim() || "未填写",
          desc: form.desc.trim() || "暂无说明",
          fields: form.fields.map(
            (field): AssetTableField => ({
              name: field.name.trim(),
              cn: field.cn.trim(),
              type: buildColumnType(field),
              nullable: !!field.nullable,
              pk: !!field.pk,
              part: !!field.part,
              enum: field.enum.trim() || null,
            }),
          ),
        },
        oldName || undefined,
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div id={TABLE_FORM_ID} ref={formRef}>
      <PageHeader
        back={{ onClick: onCancel, text: isEdit ? t("editor.backToPrevious") : t("editor.backToList") }}
        breadcrumbs={buildModuleBreadcrumbs(
          "dwm",
          [
            ...(isEdit ? [{ label: oldName, onClick: onBackToDetail }] : []),
            { label: isEdit ? t("editor.editTable") : t("editor.addTable") },
          ],
          onBackToList,
        )}
        icon={isEdit ? "edit" : "plus"}
        title={isEdit ? t("editor.editDataTable") : t("editor.addDataTable")}
        subtitle={
          isEdit
            ? t("editor.currentTable", { name: oldName })
            : t("editor.createDescription")
        }
      />

      <FormErrorSummary
        formId={TABLE_FORM_ID}
        errors={validation.formFields}
        getFieldLabel={(field) => getTableFieldLabel(field, form.fields, translateValidation)}
        title={t("editor.fixErrorsTitle")}
      />

      <div className="form-card">
        <h3>
          <Icon name="table" size={14} />
          {t("editor.basicInformation")}
        </h3>
        <div className="form-grid">
          <FormField
            className="fl"
            formId={TABLE_FORM_ID}
            name="name"
            label={t("editor.tableNameLabel")}
            error={validation.formFields["name"]}
          >
            <Input
              aria-label={t("editor.tableNameLabel")}
              className={`inp mono${validation.formFields["name"] ? " invalid" : ""}`}
              placeholder={t("editor.tableNamePlaceholder")}
              value={form.name}
              onChange={(event) => setValue("name", event.target.value)}
            />
          </FormField>
          <FormField
            className="fl"
            formId={TABLE_FORM_ID}
            name="cn"
            label={t("editor.tableMeaningLabel")}
            error={validation.formFields["cn"]}
          >
            <Input
              aria-label={t("editor.tableMeaningLabel")}
              className={`inp${validation.formFields["cn"] ? " invalid" : ""}`}
              placeholder={t("editor.tableMeaningPlaceholder")}
              value={form.cn}
              onChange={(event) => setValue("cn", event.target.value)}
            />
          </FormField>
          <FormField
            className="fl"
            formId={TABLE_FORM_ID}
            name="domain"
            label={t("editor.domainLabel")}
            error={validation.formFields["domain"]}
          >
            <Select<string>
              aria-label={t("editor.domainLabel")}
              className={`sel${validation.formFields["domain"] ? " invalid" : ""}`}
              placeholder={t("editor.domainPlaceholder")}
              value={form.domain || null}
              onValueChange={(value) => setValue("domain", value || "")}
            >
              <Select.Option value="">{t("editor.domainPlaceholder")}</Select.Option>
              {domains.map((name) => <Select.Option key={name} value={name}>{name}</Select.Option>)}
            </Select>
          </FormField>
          <FormField
            className="fl"
            formId={TABLE_FORM_ID}
            name="layer"
            label={t("editor.layerLabel")}
            error={validation.formFields["layer"]}
          >
            <Select<string>
              aria-label={t("editor.layerLabel")}
              className={`sel${validation.formFields["layer"] ? " invalid" : ""}`}
              placeholder={t("editor.layerPlaceholder")}
              value={form.layer || null}
              onValueChange={(value) => setValue("layer", value || "")}
            >
              <Select.Option value="">{t("editor.layerPlaceholder")}</Select.Option>
              {layers.map((item) => {
                const code = item.code;
                const label = `${item.code} · ${item.cn || item.code}`;
                return <Select.Option key={code} value={code}>{label}</Select.Option>;
              })}
            </Select>
          </FormField>
          <div className="fl">
            <label>{t("editor.ownerLabel")}</label>
            <Input
              aria-label={t("editor.ownerLabel")}
              className="inp"
              placeholder={t("editor.ownerPlaceholder")}
              value={form.owner}
              onChange={(event) => setValue("owner", event.target.value)}
            />
          </div>
          <div className="fl">
            <label>{t("editor.grainLabel")}</label>
            <Input
              aria-label={t("editor.grainLabel")}
              className="inp"
              placeholder={t("editor.grainPlaceholder")}
              value={form.grain}
              onChange={(event) => setValue("grain", event.target.value)}
            />
          </div>
          <div className="fl">
            <label>{t("editor.cycleLabel")}</label>
            <Input
              aria-label={t("editor.cycleLabel")}
              className="inp"
              placeholder={t("editor.cyclePlaceholder")}
              value={form.cycle}
              onChange={(event) => setValue("cycle", event.target.value)}
            />
          </div>
          <div className="fl full">
            <label>{t("editor.descriptionLabel")}</label>
            <Textarea
              aria-label={t("editor.descriptionLabel")}
              className="ta"
              placeholder={t("editor.descriptionPlaceholder")}
              value={form.desc}
              onChange={(event) => setValue("desc", event.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="form-card">
        <div className="form-card-head">
          <h3>
            <Icon name="columns" size={14} />
            {t("editor.fields")}
          </h3>
          <span className="form-card-meta">{t("editor.fieldCount", { count: form.fields.length })}</span>
        </div>
        <div className="fe-scroll">
          <table className="fields-edit mobile-edit-table">
            <thead>
              <tr>
                <th style={{ width: 40 }}>#</th>
                <th style={{ minWidth: 160 }}>{t("editor.fieldName")}</th>
                <th style={{ minWidth: 140 }}>{t("editor.fieldMeaning")}</th>
                <th style={{ width: 160 }}>{t("editor.dataType")}</th>
                <th className="ctr" style={{ width: 64 }}>
                  {t("editor.primaryKey")}
                </th>
                <th className="ctr" style={{ width: 64 }}>
                  {t("editor.partition")}
                </th>
                <th className="ctr" style={{ width: 64 }}>
                  {t("editor.nullable")}
                </th>
                <th style={{ minWidth: 180 }}>{t("editor.enumDescription")}</th>
                <th style={{ width: 110 }}></th>
              </tr>
            </thead>
            <tbody>
              {form.fields.map((field, index) => {
                const rowErrors: TableRowErrors =
                  validation.fields[field._key] || {};

                return (
                  <tr key={field._key}>
                    <td data-label={t("editor.fieldNumber")} className="idx-cell">
                      {index + 1}
                    </td>
                    <td data-label={t("editor.fieldName")}>
                      <FormField
                        formId={TABLE_FORM_ID}
                        name={`fields.${field._key}.name`}
                        label={t("editor.rowFieldName", { index: index + 1 })}
                        hideLabel
                        error={rowErrors.name}
                      >
                        <Input
                          aria-label={t("editor.rowFieldName", { index: index + 1 })}
                          className={`cell-inp mono${rowErrors.name ? " invalid" : ""}`}
                          placeholder="field_name"
                          value={field.name}
                          onChange={(event) =>
                            setField(field._key, { name: event.target.value })
                          }
                        />
                      </FormField>
                    </td>
                    <td data-label={t("editor.fieldMeaning")}>
                      <FormField
                        formId={TABLE_FORM_ID}
                        name={`fields.${field._key}.cn`}
                        label={t("editor.rowFieldMeaning", { index: index + 1 })}
                        hideLabel
                        error={rowErrors.cn}
                      >
                        <Input
                          aria-label={t("editor.rowFieldMeaning", { index: index + 1 })}
                          className={`cell-inp${rowErrors.cn ? " invalid" : ""}`}
                          placeholder={t("editor.fieldMeaningPlaceholder")}
                          value={field.cn}
                          onChange={(event) =>
                            setField(field._key, { cn: event.target.value })
                          }
                        />
                      </FormField>
                    </td>
                    <td data-label={t("editor.dataType")}>
                      <div style={{ display: "grid", gap: 6 }}>
                        <FormField
                          formId={TABLE_FORM_ID}
                          name={`fields.${field._key}.typeBase`}
                          label={t("editor.rowDataType", { index: index + 1 })}
                          hideLabel
                          error={rowErrors.typeField === "typeBase" ? rowErrors.type : undefined}
                        >
                          <Select<string>
                            aria-label={t("editor.rowDataType", { index: index + 1 })}
                            className={`cell-inp mono${rowErrors.typeField === "typeBase" ? " invalid" : ""}`}
                            collisionAvoidance={{ side: "flip", align: "shift" }}
                            side="top"
                            value={field.typeBase}
                            onValueChange={(value) => {
                              const nextBaseType = value || "";
                              const nextPatch: Partial<EditorField> = {
                                typeBase: nextBaseType,
                              };
                              if (nextBaseType === "VARCHAR")
                                nextPatch.typeLength =
                                  field.typeLength ||
                                  String(DEFAULT_VARCHAR_LENGTH);
                              if (nextBaseType === "NUMERIC") {
                                nextPatch.typePrecision =
                                  field.typePrecision ||
                                  String(DEFAULT_NUMERIC_PRECISION);
                                nextPatch.typeScale =
                                  field.typeScale ||
                                  String(DEFAULT_NUMERIC_SCALE);
                              }
                              setField(field._key, nextPatch);
                            }}
                          >
                            {!isDataTypeBase(field.typeBase) ? (
                              <Select.Option value={field.typeBase}>
                                {field.typeBase}
                              </Select.Option>
                            ) : null}
                            {DATA_TYPE_BASE_OPTIONS.map((type) => (
                              <Select.Option key={type} value={type}>
                                {type}
                              </Select.Option>
                            ))}
                          </Select>
                        </FormField>
                        {field.typeBase === "VARCHAR" ? (
                          <FormField
                            formId={TABLE_FORM_ID}
                            name={`fields.${field._key}.typeLength`}
                            label={t("editor.rowTypeLength", { index: index + 1 })}
                            hideLabel
                            error={rowErrors.typeField === "typeLength" ? rowErrors.type : undefined}
                          >
                            <Input
                              aria-label={t("editor.rowTypeLength", { index: index + 1 })}
                              className={`cell-inp mono${rowErrors.typeField === "typeLength" ? " invalid" : ""}`}
                              inputMode="numeric"
                              placeholder={t("editor.defaultTypeLength", { value: DEFAULT_VARCHAR_LENGTH })}
                              value={field.typeLength}
                              onChange={(event) =>
                                setField(field._key, {
                                  typeLength: event.target.value.replace(
                                    /[^\d]/g,
                                    "",
                                  ),
                                })
                              }
                            />
                          </FormField>
                        ) : null}
                        {field.typeBase === "NUMERIC" ? (
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "1fr 1fr",
                              gap: 6,
                            }}
                          >
                            <FormField
                              formId={TABLE_FORM_ID}
                              name={`fields.${field._key}.typePrecision`}
                              label={t("editor.rowPrecision", { index: index + 1 })}
                              hideLabel
                              error={rowErrors.typeField === "typePrecision" ? rowErrors.type : undefined}
                            >
                              <Input
                                aria-label={t("editor.rowPrecision", { index: index + 1 })}
                                className={`cell-inp mono${rowErrors.typeField === "typePrecision" ? " invalid" : ""}`}
                                inputMode="numeric"
                                placeholder={t("editor.defaultPrecision", { value: DEFAULT_NUMERIC_PRECISION })}
                                value={field.typePrecision}
                                onChange={(event) =>
                                  setField(field._key, {
                                    typePrecision: event.target.value.replace(
                                      /[^\d]/g,
                                      "",
                                    ),
                                  })
                                }
                              />
                            </FormField>
                            <FormField
                              formId={TABLE_FORM_ID}
                              name={`fields.${field._key}.typeScale`}
                              label={t("editor.rowScale", { index: index + 1 })}
                              hideLabel
                              error={rowErrors.typeField === "typeScale" ? rowErrors.type : undefined}
                            >
                              <Input
                                aria-label={t("editor.rowScale", { index: index + 1 })}
                                className={`cell-inp mono${rowErrors.typeField === "typeScale" ? " invalid" : ""}`}
                                inputMode="numeric"
                                placeholder={t("editor.defaultScale", { value: DEFAULT_NUMERIC_SCALE })}
                                value={field.typeScale}
                                onChange={(event) =>
                                  setField(field._key, {
                                    typeScale: event.target.value.replace(
                                      /[^\d]/g,
                                      "",
                                    ),
                                  })
                                }
                              />
                            </FormField>
                          </div>
                        ) : null}
                      </div>
                    </td>
                    <td data-label={t("editor.primaryKey")} className="ctr">
                      <FormField
                        formId={TABLE_FORM_ID}
                        name={`fields.${field._key}.pk`}
                        label={t("editor.rowPrimaryKey", { index: index + 1 })}
                        hideLabel
                        error={rowErrors.nullable}
                      >
                        <Button
                          aria-label={t(field.pk ? "editor.unsetPrimaryKey" : "editor.setPrimaryKey", { field: field.name || t("editor.fieldFallback", { index: index + 1 }) })}
                          aria-pressed={field.pk}
                          className={`cbtn amber${field.pk ? " on" : ""}${rowErrors.nullable ? " invalid" : ""}`}
                          onClick={() => setField(field._key, { pk: !field.pk })}
                          size="sm"
                          type="button"
                          variant="tertiary"
                        >
                          <Icon name="key" size={13} />
                        </Button>
                      </FormField>
                    </td>
                    <td data-label={t("editor.partition")} className="ctr">
                      <Button
                        aria-label={t(field.part ? "editor.unsetPartition" : "editor.setPartition", { field: field.name || t("editor.fieldFallback", { index: index + 1 }) })}
                        aria-pressed={field.part}
                        className={`cbtn cyan${field.part ? " on" : ""}`}
                        onClick={() =>
                          setField(field._key, { part: !field.part })
                        }
                        size="sm"
                        type="button"
                        variant="tertiary"
                      >
                        <Icon name="hash" size={13} />
                      </Button>
                    </td>
                    <td data-label={t("editor.nullable")} className="ctr">
                      <Button
                        aria-label={t(field.nullable ? "editor.disallowNullable" : "editor.allowNullable", { field: field.name || t("editor.fieldFallback", { index: index + 1 }) })}
                        aria-pressed={field.nullable}
                        className={`cbtn${field.nullable ? " on" : ""}`}
                        onClick={() =>
                          setField(field._key, { nullable: !field.nullable })
                        }
                        disabled={field.pk}
                        size="sm"
                        type="button"
                        variant="tertiary"
                      >
                        <Icon name="check" size={13} />
                      </Button>
                    </td>
                    <td data-label={t("editor.enumDescription")}>
                      <Input
                        aria-label={t("editor.rowEnumDescription", { index: index + 1 })}
                        className="cell-inp"
                        placeholder={t("editor.enumPlaceholder")}
                        value={field.enum}
                        onChange={(event) =>
                          setField(field._key, { enum: event.target.value })
                        }
                      />
                    </td>
                    <td data-label="">
                      <div className="row-tools">
                        <IconButton
                          aria-label={t("editor.moveFieldUp", { field: field.name || index + 1 })}
                          className="icon-btn"
                          disabled={index === 0}
                          icon={<Icon name="up" size={14} />}
                          onClick={() => moveField(index, -1)}
                          size="sm"
                          type="button"
                          variant="tertiary"
                        />
                        <IconButton
                          aria-label={t("editor.moveFieldDown", { field: field.name || index + 1 })}
                          className="icon-btn"
                          disabled={index === form.fields.length - 1}
                          icon={<Icon name="down" size={14} />}
                          onClick={() => moveField(index, 1)}
                          size="sm"
                          type="button"
                          variant="tertiary"
                        />
                        <IconButton
                          aria-label={t("editor.deleteField", { field: field.name || index + 1 })}
                          className="icon-btn danger"
                          disabled={form.fields.length === 1}
                          icon={<Icon name="trash" size={14} />}
                          onClick={() => deleteField(field._key)}
                          size="sm"
                          type="button"
                          variant="danger"
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <FormField
          formId={TABLE_FORM_ID}
          name="fields"
          label={t("editor.fields")}
          hideLabel
          error={validation.formFields["fields"]}
        >
          <Button className="add-field" onClick={addField} size="sm" type="button" variant="tertiary">
            <Icon name="plus" size={14} />
            {t("editor.addField")}
          </Button>
        </FormField>
      </div>

      <AssetEditorActionBar
        note={
          isEdit
            ? t("editor.editSaveNote")
            : t("editor.createSaveNote")
        }
        onCancel={onCancel}
        onSave={save}
        saving={saving}
        isDirty={isDirty}
      />
      {deleteInitial ? <AssetDeleteZone name={oldName} onDelete={onDelete} /> : null}
    </div>
  );
}
