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
import { Icon } from "./ui.jsx";
import { ActionErrorBanner, confirmDeleteAction, DangerZone, FormActionBar, PageHeader } from "./common/index.js";
import { buildModuleBreadcrumbs } from "../routing/navigation.ts";
import {
  buildColumnType,
  DATA_TYPE_BASE_OPTIONS,
  DEFAULT_DATA_TYPE,
  DEFAULT_NUMERIC_PRECISION,
  DEFAULT_NUMERIC_SCALE,
  DEFAULT_VARCHAR_LENGTH,
  parseColumnType,
  validateColumnType,
} from "../constants/dataTypes.ts";
import { ASSET_NAME_RULE_MESSAGE, isValidAssetName } from "../utils/assetName.ts";
import { LAYER_OPTIONS } from "../config/assets.ts";

function createField() {
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

function normalizeField(field, index) {
  const typeParts = parseColumnType(field.type);
  return {
    _key: field._key || `${field.name || "field"}_${index}`,
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

function syncFieldType(field) {
  return {
    ...field,
    type: buildColumnType(field),
  };
}

function normalizeInitial(initial, defaultLayer = "DWM") {
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

function validateForm(form, existingNames, oldName) {
  const errors = [];
  const fieldErrors = {};
  const normalizedName = form.name.trim();

  if (!normalizedName) {
    errors.push("请输入表英文名。");
  } else if (!isValidAssetName(normalizedName)) {
    errors.push(`表英文名${ASSET_NAME_RULE_MESSAGE}`);
  }

  const duplicateTable = existingNames.some((name) => name === normalizedName && name !== oldName);
  if (normalizedName && duplicateTable) {
    errors.push(`表名 ${normalizedName} 已存在。`);
  }

  if (!form.cn.trim()) {
    errors.push("请输入表中文名或业务含义。");
  }

  if (!form.domain) {
    errors.push("请选择主题域。");
  }

  if (!form.layer) {
    errors.push("请选择数据层级。");
  }

  if (!form.fields.length) {
    errors.push("至少需要一个字段。");
  }

  const usedFieldNames = new Set();
  form.fields.forEach((field) => {
    const rowErrors = {};
    const fieldName = field.name.trim();

    if (!fieldName) {
      rowErrors.name = "请输入字段名";
      errors.push("存在未填写字段名的字段。");
    } else if (!isValidAssetName(fieldName)) {
      rowErrors.name = "字段名格式不正确";
      errors.push(`字段 ${fieldName} 格式不正确。`);
    } else if (usedFieldNames.has(fieldName)) {
      rowErrors.name = "字段名重复";
      errors.push(`字段 ${fieldName} 重复。`);
    } else {
      usedFieldNames.add(fieldName);
    }

    if (!field.cn.trim()) {
      rowErrors.cn = "请输入字段中文注释";
      errors.push(`字段 ${fieldName || "未命名字段"} 缺少中文注释。`);
    }

    if (field.pk && field.nullable) {
      rowErrors.nullable = "主键字段不能可空";
      errors.push(`字段 ${fieldName || "未命名字段"} 不能同时为主键和可空。`);
    }

    const typeError = validateColumnType(field);
    if (typeError) {
      rowErrors.type = typeError;
      errors.push(`瀛楁 ${fieldName || "鏈懡鍚嶅瓧娈?"} ${typeError}`);
    }

    if (Object.keys(rowErrors).length) {
      fieldErrors[field._key] = rowErrors;
    }
  });

  return {
    list: [...new Set(errors)],
    fields: fieldErrors,
  };
}

export function TableEditor({
  mode,
  initial,
  existingNames,
  domains,
  layers = LAYER_OPTIONS,
  defaultLayer = "DWM",
  onCancel,
  onBackToList,
  onBackToDetail,
  onSave,
  onDelete,
}) {
  const isEdit = mode === "edit";
  const oldName = initial?.name || "";
  const [form, setForm] = React.useState(() => normalizeInitial(initial, defaultLayer));
  const [touched, setTouched] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const initialSnapshotRef = React.useRef(JSON.stringify(form));
  const isDirty = initialSnapshotRef.current !== JSON.stringify(form);

  React.useEffect(() => {
    const nextForm = normalizeInitial(initial, defaultLayer);
    setForm(nextForm);
    setTouched(false);
    initialSnapshotRef.current = JSON.stringify(nextForm);
  }, [defaultLayer, initial]);

  const validation = touched ? validateForm(form, existingNames, oldName) : { list: [], fields: {} };

  const setValue = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const setField = (fieldKey, patch) => {
    setForm((prev) => ({
      ...prev,
      fields: prev.fields.map((field) => {
        if (field._key !== fieldKey) return field;
        const next = { ...field, ...patch };
        if (next.pk) next.nullable = false;
        return syncFieldType(next);
      }),
    }));
  };

  const addField = () => {
    setForm((prev) => ({ ...prev, fields: [...prev.fields, createField()] }));
  };

  const deleteField = (fieldKey) => {
    setForm((prev) => ({
      ...prev,
      fields: prev.fields.filter((field) => field._key !== fieldKey),
    }));
  };

  const moveField = (index, direction) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= form.fields.length) return;

    setForm((prev) => {
      const nextFields = [...prev.fields];
      [nextFields[index], nextFields[nextIndex]] = [nextFields[nextIndex], nextFields[index]];
      return { ...prev, fields: nextFields };
    });
  };

  const save = async () => {
    setTouched(true);
    const nextValidation = validateForm(form, existingNames, oldName);
    if (nextValidation.list.length || saving) return;

    setSaving(true);
    try {
      await Promise.resolve(onSave(
      {
        name: form.name.trim(),
        cn: form.cn.trim(),
        domain: form.domain,
        layer: form.layer,
        owner: form.owner.trim() || "未指定",
        grain: form.grain.trim() || "未填写",
        cycle: form.cycle.trim() || "未填写",
        desc: form.desc.trim() || "暂无说明",
        fields: form.fields.map((field) => ({
          name: field.name.trim(),
          cn: field.cn.trim(),
          type: buildColumnType(field),
          nullable: !!field.nullable,
          pk: !!field.pk,
          part: !!field.part,
          enum: field.enum.trim() || null,
        })),
      },
      oldName || undefined,
      ));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        back={{ onClick: onCancel, text: isEdit ? "返回上一层" : "返回列表" }}
        breadcrumbs={buildModuleBreadcrumbs("dwm", [
          ...(isEdit ? [{ label: oldName, onClick: onBackToDetail }] : []),
          { label: isEdit ? "编辑表" : "新增表" },
        ], onBackToList)}
        icon={isEdit ? "edit" : "plus"}
        title={isEdit ? "编辑数据表" : "新增数据表"}
        subtitle={isEdit ? `当前表：dwm.${oldName}` : "按现有 DWM 数据资产结构补充元数据与字段信息。"}
      />

      <ActionErrorBanner title="请先修正以下问题" messages={validation.list} />

      <div className="form-card">
        <h3><Icon name="table" size={14} />基本信息</h3>
        <div className="form-grid">
          <div className="fl">
            <label>表名（英文）</label>
            <input
              className={`inp mono${touched && (!form.name.trim() || !isValidAssetName(form.name.trim())) ? " invalid" : ""}`}
              placeholder="例如：dwm_xxx_detail_di"
              value={form.name}
              onChange={(event) => setValue("name", event.target.value)}
            />
          </div>
          <div className="fl">
            <label>表中文名 / 业务含义</label>
            <input
              className={`inp${touched && !form.cn.trim() ? " invalid" : ""}`}
              placeholder="例如：支付交易明细中间表"
              value={form.cn}
              onChange={(event) => setValue("cn", event.target.value)}
            />
          </div>
          <div className="fl">
            <label>主题域</label>
            <select className="sel" value={form.domain} onChange={(event) => setValue("domain", event.target.value)}>
              <option value="">请选择主题域</option>
              {domains.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </div>
          <div className="fl">
            <label>数据层级</label>
            <select className="sel" value={form.layer} onChange={(event) => setValue("layer", event.target.value)}>
              <option value="">请选择数据层级</option>
              {layers.map((item) => {
                const code = typeof item === "string" ? item : item.code;
                const label = typeof item === "string" ? item : `${item.code} · ${item.cn || item.code}`;
                return <option key={code} value={code}>{label}</option>;
              })}
            </select>
          </div>
          <div className="fl">
            <label>负责人</label>
            <input
              className="inp"
              placeholder="例如：何嘉佳"
              value={form.owner}
              onChange={(event) => setValue("owner", event.target.value)}
            />
          </div>
          <div className="fl">
            <label>数据粒度</label>
            <input
              className="inp"
              placeholder="例如：一笔支付交易"
              value={form.grain}
              onChange={(event) => setValue("grain", event.target.value)}
            />
          </div>
          <div className="fl">
            <label>更新周期</label>
            <input
              className="inp"
              placeholder="例如：每日增量 T+1"
              value={form.cycle}
              onChange={(event) => setValue("cycle", event.target.value)}
            />
          </div>
          <div className="fl full">
            <label>表说明</label>
            <textarea
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
          <h3><Icon name="columns" size={14} />字段信息</h3>
          <span className="form-card-meta">共 {form.fields.length} 个字段</span>
        </div>
        <div className="fe-scroll">
          <table className="fields-edit mobile-edit-table">
            <thead>
              <tr>
                <th style={{ width: 40 }}>#</th>
                <th style={{ minWidth: 180 }}>字段名</th>
                <th style={{ minWidth: 160 }}>中文注释</th>
                <th style={{ width: 160 }}>数据类型</th>
                <th className="ctr" style={{ width: 64 }}>主键</th>
                <th className="ctr" style={{ width: 64 }}>分区</th>
                <th className="ctr" style={{ width: 64 }}>可空</th>
                <th style={{ minWidth: 220 }}>枚举 / 取值说明</th>
                <th style={{ width: 110 }}></th>
              </tr>
            </thead>
            <tbody>
              {form.fields.map((field, index) => {
                const rowErrors = validation.fields[field._key] || {};

                return (
                  <tr key={field._key}>
                    <td data-label="字段序号" className="idx-cell">{index + 1}</td>
                    <td data-label="字段名">
                      <input
                        className={`cell-inp mono${rowErrors.name ? " invalid" : ""}`}
                        placeholder="field_name"
                        value={field.name}
                        onChange={(event) => setField(field._key, { name: event.target.value })}
                      />
                    </td>
                    <td data-label="中文注释">
                      <input
                        className={`cell-inp${rowErrors.cn ? " invalid" : ""}`}
                        placeholder="字段含义"
                        value={field.cn}
                        onChange={(event) => setField(field._key, { cn: event.target.value })}
                      />
                    </td>
                    <td data-label="数据类型">
                      {(() => {
                        const typeParts = {
                          baseType: field.typeBase,
                          length: field.typeLength,
                          precision: field.typePrecision,
                          scale: field.typeScale,
                        };
                        return (
                          <div style={{ display: "grid", gap: 6 }}>
                            <select
                              className={`cell-inp mono${rowErrors.type ? " invalid" : ""}`}
                              value={typeParts.baseType}
                              onChange={(event) => {
                                const nextBaseType = event.target.value;
                                const nextPatch = { typeBase: nextBaseType };

                                if (nextBaseType === "VARCHAR") {
                                  nextPatch.typeLength = field.typeLength || String(DEFAULT_VARCHAR_LENGTH);
                                }

                                if (nextBaseType === "NUMERIC") {
                                  nextPatch.typePrecision = field.typePrecision || String(DEFAULT_NUMERIC_PRECISION);
                                  nextPatch.typeScale = field.typeScale || String(DEFAULT_NUMERIC_SCALE);
                                }

                                setField(field._key, nextPatch);
                              }}
                            >
                              {!DATA_TYPE_BASE_OPTIONS.includes(typeParts.baseType) ? (
                                <option value={typeParts.baseType}>{typeParts.baseType}</option>
                              ) : null}
                              {DATA_TYPE_BASE_OPTIONS.map((type) => (
                                <option key={type} value={type}>{type}</option>
                              ))}
                            </select>
                            {typeParts.baseType === "VARCHAR" ? (
                              <input
                                className={`cell-inp mono${rowErrors.type ? " invalid" : ""}`}
                                inputMode="numeric"
                                placeholder={`长度，默认 ${DEFAULT_VARCHAR_LENGTH}`}
                                value={field.typeLength}
                                onChange={(event) => {
                                  setField(field._key, {
                                    typeLength: event.target.value.replace(/[^\d]/g, ""),
                                  });
                                }}
                              />
                            ) : null}
                            {typeParts.baseType === "NUMERIC" ? (
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                                <input
                                  className={`cell-inp mono${rowErrors.type ? " invalid" : ""}`}
                                  inputMode="numeric"
                                  placeholder={`precision锛岄粯璁?${DEFAULT_NUMERIC_PRECISION}`}
                                  value={field.typePrecision}
                                  onChange={(event) => {
                                    setField(field._key, {
                                      typePrecision: event.target.value.replace(/[^\d]/g, ""),
                                    });
                                  }}
                                />
                                <input
                                  className={`cell-inp mono${rowErrors.type ? " invalid" : ""}`}
                                  inputMode="numeric"
                                  placeholder={`scale锛岄粯璁?${DEFAULT_NUMERIC_SCALE}`}
                                  value={field.typeScale}
                                  onChange={(event) => {
                                    setField(field._key, {
                                      typeScale: event.target.value.replace(/[^\d]/g, ""),
                                    });
                                  }}
                                />
                              </div>
                            ) : null}
                            {rowErrors.type ? (
                              <div style={{ color: "#f87171", fontSize: 12 }}>{rowErrors.type}</div>
                            ) : null}
                          </div>
                        );
                      })()}
                    </td>
                    <td data-label="主键" className="ctr">
                      <button
                        className={`cbtn amber${field.pk ? " on" : ""}`}
                        onClick={() => setField(field._key, { pk: !field.pk })}
                        type="button"
                      >
                        <Icon name="key" size={13} />
                      </button>
                    </td>
                    <td data-label="分区" className="ctr">
                      <button
                        className={`cbtn cyan${field.part ? " on" : ""}`}
                        onClick={() => setField(field._key, { part: !field.part })}
                        type="button"
                      >
                        <Icon name="hash" size={13} />
                      </button>
                    </td>
                    <td data-label="可空" className="ctr">
                      <button
                        className={`cbtn${field.nullable ? " on" : ""}`}
                        onClick={() => setField(field._key, { nullable: !field.nullable })}
                        disabled={field.pk}
                        type="button"
                      >
                        <Icon name="check" size={13} />
                      </button>
                    </td>
                    <td data-label="枚举 / 取值说明">
                      <input
                        className="cell-inp"
                        placeholder="例如：SUCCESS-成功 / FAIL-失败"
                        value={field.enum}
                        onChange={(event) => setField(field._key, { enum: event.target.value })}
                      />
                    </td>
                    <td data-label="">
                      <div className="row-tools">
                        <button className="icon-btn" disabled={index === 0} onClick={() => moveField(index, -1)} type="button">
                          <Icon name="up" size={14} />
                        </button>
                        <button className="icon-btn" disabled={index === form.fields.length - 1} onClick={() => moveField(index, 1)} type="button">
                          <Icon name="down" size={14} />
                        </button>
                        <button className="icon-btn danger" disabled={form.fields.length === 1} onClick={() => deleteField(field._key)} type="button">
                          <Icon name="trash" size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <button className="add-field" onClick={addField} type="button">
          <Icon name="plus" size={14} />新增字段
        </button>
      </div>

      <FormActionBar
        note={isEdit ? "保存后会更新表元数据、字段列表和 DDL 展示。" : "保存后会加入当前 DWM 资产列表。"}
        onCancel={onCancel}
        onSave={save}
        saving={saving}
        isDirty={isDirty}
      />
      {isEdit ? (
        <DangerZone
          description="删除资产表会影响字段清单、DDL 展示和历史元数据追溯，请谨慎操作。"
          actions={[
            {
              key: "delete-table",
              label: "删除表",
              icon: "trash",
              danger: true,
              onClick: async () => {
                if (await confirmDeleteAction({
                  name: oldName,
                  typeLabel: "资产表",
                  impact: "该表删除后，可能影响字段清单、DDL 展示、资产检索和历史追溯。请确认没有下游依赖。",
                  consequences: [
                    "删除前应以后端校验为准。",
                    "若后端返回不可删除原因，页面会直接展示原因。",
                  ],
                  confirmKeyword: oldName,
                  confirmKeywordLabel: "请输入表名二次确认",
                })) {
                  onDelete(oldName);
                }
              },
            },
          ]}
        />
      ) : null}
    </div>
  );
}
