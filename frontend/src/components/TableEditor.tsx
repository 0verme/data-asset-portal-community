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
import { getTableFieldLabel, validateTableForm, type TableRowErrors, type TableValidation } from "./tableFormErrors.ts";
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
    () => touched ? validateTableForm(form, existingNames, oldName) : EMPTY_TABLE_VALIDATION,
    [existingNames, form, oldName, touched],
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
    const nextValidation = validateTableForm(form, existingNames, oldName);
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
        back={{ onClick: onCancel, text: isEdit ? "返回上一层" : "返回列表" }}
        breadcrumbs={buildModuleBreadcrumbs(
          "dwm",
          [
            ...(isEdit ? [{ label: oldName, onClick: onBackToDetail }] : []),
            { label: isEdit ? "编辑表" : "新增表" },
          ],
          onBackToList,
        )}
        icon={isEdit ? "edit" : "plus"}
        title={isEdit ? "编辑数据表" : "新增数据表"}
        subtitle={
          isEdit
            ? `当前表：dwm.${oldName}`
            : "按现有 DWM 数据资产结构补充元数据与字段信息。"
        }
      />

      <FormErrorSummary
        formId={TABLE_FORM_ID}
        errors={validation.formFields}
        getFieldLabel={(field) => getTableFieldLabel(field, form.fields)}
        title="请先修正以下问题"
      />

      <div className="form-card">
        <h3>
          <Icon name="table" size={14} />
          基本信息
        </h3>
        <div className="form-grid">
          <FormField
            className="fl"
            formId={TABLE_FORM_ID}
            name="name"
            label="表名（英文）"
            error={validation.formFields["name"]}
          >
            <Input
              aria-label="表名（英文）"
              className={`inp mono${validation.formFields["name"] ? " invalid" : ""}`}
              placeholder="例如：dwm_xxx_detail_di"
              value={form.name}
              onChange={(event) => setValue("name", event.target.value)}
            />
          </FormField>
          <FormField
            className="fl"
            formId={TABLE_FORM_ID}
            name="cn"
            label="表中文名 / 业务含义"
            error={validation.formFields["cn"]}
          >
            <Input
              aria-label="表中文名 / 业务含义"
              className={`inp${validation.formFields["cn"] ? " invalid" : ""}`}
              placeholder="例如：支付交易明细中间表"
              value={form.cn}
              onChange={(event) => setValue("cn", event.target.value)}
            />
          </FormField>
          <FormField
            className="fl"
            formId={TABLE_FORM_ID}
            name="domain"
            label="主题域"
            error={validation.formFields["domain"]}
          >
            <Select<string>
              aria-label="主题域"
              className={`sel${validation.formFields["domain"] ? " invalid" : ""}`}
              placeholder="请选择主题域"
              value={form.domain || null}
              onValueChange={(value) => setValue("domain", value || "")}
            >
              <Select.Option value="">请选择主题域</Select.Option>
              {domains.map((name) => <Select.Option key={name} value={name}>{name}</Select.Option>)}
            </Select>
          </FormField>
          <FormField
            className="fl"
            formId={TABLE_FORM_ID}
            name="layer"
            label="数据层级"
            error={validation.formFields["layer"]}
          >
            <Select<string>
              aria-label="数据层级"
              className={`sel${validation.formFields["layer"] ? " invalid" : ""}`}
              placeholder="请选择数据层级"
              value={form.layer || null}
              onValueChange={(value) => setValue("layer", value || "")}
            >
              <Select.Option value="">请选择数据层级</Select.Option>
              {layers.map((item) => {
                const code = item.code;
                const label = `${item.code} · ${item.cn || item.code}`;
                return <Select.Option key={code} value={code}>{label}</Select.Option>;
              })}
            </Select>
          </FormField>
          <div className="fl">
            <label>负责人</label>
            <Input
              aria-label="负责人"
              className="inp"
              placeholder="例如：何嘉佳"
              value={form.owner}
              onChange={(event) => setValue("owner", event.target.value)}
            />
          </div>
          <div className="fl">
            <label>数据粒度</label>
            <Input
              aria-label="数据粒度"
              className="inp"
              placeholder="例如：一笔支付交易"
              value={form.grain}
              onChange={(event) => setValue("grain", event.target.value)}
            />
          </div>
          <div className="fl">
            <label>更新周期</label>
            <Input
              aria-label="更新周期"
              className="inp"
              placeholder="例如：每日增量 T+1"
              value={form.cycle}
              onChange={(event) => setValue("cycle", event.target.value)}
            />
          </div>
          <div className="fl full">
            <label>表说明</label>
            <Textarea
              aria-label="表说明"
              className="ta"
              placeholder="描述表来源、加工逻辑和下游用途。"
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
            字段信息
          </h3>
          <span className="form-card-meta">共 {form.fields.length} 个字段</span>
        </div>
        <div className="fe-scroll">
          <table className="fields-edit mobile-edit-table">
            <thead>
              <tr>
                <th style={{ width: 40 }}>#</th>
                <th style={{ minWidth: 160 }}>字段名</th>
                <th style={{ minWidth: 140 }}>中文注释</th>
                <th style={{ width: 160 }}>数据类型</th>
                <th className="ctr" style={{ width: 64 }}>
                  主键
                </th>
                <th className="ctr" style={{ width: 64 }}>
                  分区
                </th>
                <th className="ctr" style={{ width: 64 }}>
                  可空
                </th>
                <th style={{ minWidth: 180 }}>枚举 / 取值说明</th>
                <th style={{ width: 110 }}></th>
              </tr>
            </thead>
            <tbody>
              {form.fields.map((field, index) => {
                const rowErrors: TableRowErrors =
                  validation.fields[field._key] || {};

                return (
                  <tr key={field._key}>
                    <td data-label="字段序号" className="idx-cell">
                      {index + 1}
                    </td>
                    <td data-label="字段名">
                      <FormField
                        formId={TABLE_FORM_ID}
                        name={`fields.${field._key}.name`}
                        label={`字段${index + 1}字段名`}
                        hideLabel
                        error={rowErrors.name}
                      >
                        <Input
                          aria-label={`字段${index + 1}字段名`}
                          className={`cell-inp mono${rowErrors.name ? " invalid" : ""}`}
                          placeholder="field_name"
                          value={field.name}
                          onChange={(event) =>
                            setField(field._key, { name: event.target.value })
                          }
                        />
                      </FormField>
                    </td>
                    <td data-label="中文注释">
                      <FormField
                        formId={TABLE_FORM_ID}
                        name={`fields.${field._key}.cn`}
                        label={`字段${index + 1}中文注释`}
                        hideLabel
                        error={rowErrors.cn}
                      >
                        <Input
                          aria-label={`字段${index + 1}中文注释`}
                          className={`cell-inp${rowErrors.cn ? " invalid" : ""}`}
                          placeholder="字段含义"
                          value={field.cn}
                          onChange={(event) =>
                            setField(field._key, { cn: event.target.value })
                          }
                        />
                      </FormField>
                    </td>
                    <td data-label="数据类型">
                      <div style={{ display: "grid", gap: 6 }}>
                        <FormField
                          formId={TABLE_FORM_ID}
                          name={`fields.${field._key}.typeBase`}
                          label={`字段${index + 1}数据类型`}
                          hideLabel
                          error={rowErrors.typeField === "typeBase" ? rowErrors.type : undefined}
                        >
                          <Select<string>
                            aria-label={`字段${index + 1}数据类型`}
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
                            label={`字段${index + 1}类型长度`}
                            hideLabel
                            error={rowErrors.typeField === "typeLength" ? rowErrors.type : undefined}
                          >
                            <Input
                              aria-label={`字段${index + 1}类型长度`}
                              className={`cell-inp mono${rowErrors.typeField === "typeLength" ? " invalid" : ""}`}
                              inputMode="numeric"
                              placeholder={`长度，默认 ${DEFAULT_VARCHAR_LENGTH}`}
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
                              label={`字段${index + 1}精度`}
                              hideLabel
                              error={rowErrors.typeField === "typePrecision" ? rowErrors.type : undefined}
                            >
                              <Input
                                aria-label={`字段${index + 1}精度`}
                                className={`cell-inp mono${rowErrors.typeField === "typePrecision" ? " invalid" : ""}`}
                                inputMode="numeric"
                                placeholder={`precision，默认 ${DEFAULT_NUMERIC_PRECISION}`}
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
                              label={`字段${index + 1}小数位`}
                              hideLabel
                              error={rowErrors.typeField === "typeScale" ? rowErrors.type : undefined}
                            >
                              <Input
                                aria-label={`字段${index + 1}小数位`}
                                className={`cell-inp mono${rowErrors.typeField === "typeScale" ? " invalid" : ""}`}
                                inputMode="numeric"
                                placeholder={`scale，默认 ${DEFAULT_NUMERIC_SCALE}`}
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
                    <td data-label="主键" className="ctr">
                      <FormField
                        formId={TABLE_FORM_ID}
                        name={`fields.${field._key}.pk`}
                        label={`字段${index + 1}主键设置`}
                        hideLabel
                        error={rowErrors.nullable}
                      >
                        <Button
                          aria-label={`${field.pk ? "取消" : "设为"}主键 ${field.name || `字段${index + 1}`}`}
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
                    <td data-label="分区" className="ctr">
                      <Button
                        aria-label={`${field.part ? "取消" : "设为"}分区字段 ${field.name || `字段${index + 1}`}`}
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
                    <td data-label="可空" className="ctr">
                      <Button
                        aria-label={`${field.nullable ? "禁止" : "允许"}字段可空 ${field.name || `字段${index + 1}`}`}
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
                    <td data-label="枚举 / 取值说明">
                      <Input
                        aria-label={`字段${index + 1}枚举 / 取值说明`}
                        className="cell-inp"
                        placeholder="例如：SUCCESS-成功 / FAIL-失败"
                        value={field.enum}
                        onChange={(event) =>
                          setField(field._key, { enum: event.target.value })
                        }
                      />
                    </td>
                    <td data-label="">
                      <div className="row-tools">
                        <IconButton
                          aria-label={`上移字段 ${field.name || index + 1}`}
                          className="icon-btn"
                          disabled={index === 0}
                          icon={<Icon name="up" size={14} />}
                          onClick={() => moveField(index, -1)}
                          size="sm"
                          type="button"
                          variant="tertiary"
                        />
                        <IconButton
                          aria-label={`下移字段 ${field.name || index + 1}`}
                          className="icon-btn"
                          disabled={index === form.fields.length - 1}
                          icon={<Icon name="down" size={14} />}
                          onClick={() => moveField(index, 1)}
                          size="sm"
                          type="button"
                          variant="tertiary"
                        />
                        <IconButton
                          aria-label={`删除字段 ${field.name || index + 1}`}
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
          label="字段信息"
          hideLabel
          error={validation.formFields["fields"]}
        >
          <Button className="add-field" onClick={addField} size="sm" type="button" variant="tertiary">
            <Icon name="plus" size={14} />
            新增字段
          </Button>
        </FormField>
      </div>

      <AssetEditorActionBar
        note={
          isEdit
            ? "保存后会更新表元数据、字段列表和 DDL 展示。"
            : "保存后会加入当前 DWM 资产列表。"
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
