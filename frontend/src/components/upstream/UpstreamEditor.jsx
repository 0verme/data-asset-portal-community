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
import { Icon } from "../ui.jsx";
import { ActionErrorBanner, BinaryStatusToggle, DangerZone, FormActionBar, isValidTime, PageHeader, TimeInput } from "../common/index.js";
import { buildModuleBreadcrumbs } from "../../routing/navigation.ts";
import { getLegacyAwareOptions, isLegacyDictValue } from "../../utils/optionUtils.js";
import { optionLabel } from "../../utils/ui.js";

import { getUpstreamFieldLabel } from "./upstreamFieldContract.js";

export function UpstreamEditor({ mode, initial, dbTypeOptions = [], deptOptions = [], statusOptions = [], onSave, onCancel, onBackToList, onBackToDetail, onDelete, saveError = "", onClearSaveError }) {
  const isEdit = mode === "edit";
  const oldId = initial?.id || "";
  const defaultStatus = statusOptions[0]?.value || "enabled";
  const defaultDbType = dbTypeOptions[0]?.value || "";
  const saveLockRef = React.useRef(false);
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState(() => initial || {
    id: "",
    abbr: "",
    name: "",
    dbType: defaultDbType,
    host: "",
    db: "",
    schema: "",
    unloadTimes: ["02:00"],
    status: defaultStatus,
    owner: "",
    dept: "",
    desc: "",
  });
  const [touched, setTouched] = React.useState(false);
  const initialSnapshotRef = React.useRef(JSON.stringify(form));
  const isDirty = initialSnapshotRef.current !== JSON.stringify(form);

  React.useEffect(() => {
    const nextForm = initial || {
      id: "",
      abbr: "",
      name: "",
      dbType: defaultDbType,
      host: "",
      db: "",
      schema: "",
      unloadTimes: ["02:00"],
      status: defaultStatus,
      owner: "",
      dept: "",
      desc: "",
    };
    setForm(nextForm);
    setTouched(false);
    saveLockRef.current = false;
    setSaving(false);
    initialSnapshotRef.current = JSON.stringify(nextForm);
  }, [initial, defaultDbType, defaultStatus]);

  const errors = [];
  if (touched) {
    if (!form.id.trim()) errors.push("系统标识不能为空");
    if (!form.abbr.trim()) errors.push("系统简称不能为空");
    if (!form.name.trim()) errors.push("系统名称不能为空");
    if (!form.host.trim()) errors.push("JDBC 地址不能为空");
    if (!form.unloadTimes.length) errors.push("至少保留一个卸数时间点");
    if (form.unloadTimes.some((item) => !isValidTime(item))) errors.push("卸数时间点格式必须为 HH:mm");
  }

  if (touched && !form.dbType.trim()) errors.push("数据库类型不能为空");

  const dbTypeSelectOptions = getLegacyAwareOptions(dbTypeOptions, form.dbType);
  const deptSelectOptions = getLegacyAwareOptions(deptOptions, form.dept);
  const dbTypeLegacy = isLegacyDictValue(dbTypeOptions, form.dbType);
  const deptLegacy = Boolean(form.dept) && isLegacyDictValue(deptOptions, form.dept);

  const setValue = (key, value) => {
    if (saveError) onClearSaveError?.();
    setForm((prev) => ({ ...prev, [key]: value }));
  };
  const setTime = (index, value) => {
    if (saveError) onClearSaveError?.();
    setForm((prev) => ({
      ...prev,
      unloadTimes: prev.unloadTimes.map((item, current) => current === index ? value : item),
    }));
  };

  const save = () => {
    if (saving || saveLockRef.current) return;
    setTouched(true);
    if (errors.length) return;
    const normalizedAbbr = form.abbr.trim().toUpperCase();
    saveLockRef.current = true;
    setSaving(true);
    Promise.resolve(onSave({
      id: form.id.trim() || oldId,
      abbr: normalizedAbbr,
      name: form.name.trim(),
      dbType: form.dbType,
      host: form.host.trim(),
      db: form.db.trim(),
      schema: form.schema.trim(),
      unloadTimes: [...new Set(form.unloadTimes.map((item) => item.trim()))].sort(),
      status: form.status,
      owner: form.owner.trim() || "未指定",
      dept: form.dept.trim() || "未分配",
      desc: form.desc.trim() || "暂无说明",
    }, oldId || undefined)).finally(() => {
      saveLockRef.current = false;
      setSaving(false);
    });
  };

  return (
    <div>
      <PageHeader
        back={{ onClick: onCancel, text: isEdit ? "返回上一层" : "返回上游卸数列表" }}
        breadcrumbs={buildModuleBreadcrumbs("upstream", [
          ...(isEdit ? [{ label: form.abbr || oldId, onClick: onBackToDetail }] : []),
          { label: isEdit ? "编辑系统" : "新增系统" },
        ], onBackToList)}
        icon={isEdit ? "edit" : "plus"}
        title={isEdit ? "编辑上游卸数系统" : "新增上游卸数系统"}
        subtitle={isEdit ? oldId : "配置上游系统连接和卸数时间点"}
      />

      <ActionErrorBanner title="保存失败" message={saveError} />

      <ActionErrorBanner title="请先修正以下问题" messages={errors} />

      <div className="form-card">
        <h3><Icon name="server" size={14} />基本信息</h3>
        <div className="form-grid">
          <div className="fl">
            <label>{getUpstreamFieldLabel("id")}</label>
            <input className={`inp mono${touched && !form.id.trim() ? " invalid" : ""}`} value={form.id} onChange={(event) => setValue("id", event.target.value)} placeholder="例如：up_cbs" />
          </div>
          <div className="fl">
            <label>{getUpstreamFieldLabel("abbr")}</label>
            <input className={`inp mono${touched && !form.abbr.trim() ? " invalid" : ""}`} value={form.abbr} onChange={(event) => setValue("abbr", event.target.value)} placeholder="例如：CBS" />
          </div>
          <div className="fl">
            <label>{getUpstreamFieldLabel("name")}</label>
            <input className={`inp${touched && !form.name.trim() ? " invalid" : ""}`} value={form.name} onChange={(event) => setValue("name", event.target.value)} placeholder="例如：商品中心" />
          </div>
          <div className="fl">
            <label>{getUpstreamFieldLabel("dbType")}</label>
            <select className={`sel${touched && !form.dbType.trim() ? " invalid" : ""}`} value={form.dbType} onChange={(event) => setValue("dbType", event.target.value)}>
              <option value="">请选择数据库类型</option>
              {dbTypeSelectOptions.map((item) => <option key={item.value} value={item.value}>{optionLabel(item)}</option>)}
            </select>
            {dbTypeLegacy ? <div className="editor-sub" style={{ marginTop: 6, color: "var(--warn)" }}>当前值未在码值中维护，请补充码值或重新选择。</div> : null}
          </div>
          <div className="fl">
            <label>{getUpstreamFieldLabel("owner")}</label>
            <input className="inp" value={form.owner} onChange={(event) => setValue("owner", event.target.value)} placeholder="例如：王芳" />
          </div>
          <div className="fl">
            <label>{getUpstreamFieldLabel("dept")}</label>
            <select className="sel" value={form.dept} onChange={(event) => setValue("dept", event.target.value)}>
              <option value="">请选择业务部门</option>
              {deptSelectOptions.map((item) => <option key={item.value} value={item.value}>{optionLabel(item)}</option>)}
            </select>
            {deptLegacy ? <div className="editor-sub" style={{ marginTop: 6, color: "var(--warn)" }}>当前值未在码值中维护，请补充码值或重新选择。</div> : null}
          </div>
          <div className="fl">
            <label>{getUpstreamFieldLabel("status")}</label>
            <BinaryStatusToggle
              mode="status"
              value={form.status}
              options={statusOptions}
              onChange={(value) => setValue("status", value)}
            />
          </div>
          <div className="fl full">
            <label>{getUpstreamFieldLabel("desc")}</label>
            <textarea className="ta" value={form.desc} onChange={(event) => setValue("desc", event.target.value)} placeholder="描述该系统提供哪些数据，以及卸数用途。" />
          </div>
        </div>
      </div>

      <div className="form-card">
        <h3><Icon name="db" size={14} />数据库连接</h3>
        <div className="form-grid">
          <div className="fl">
            <label>{getUpstreamFieldLabel("host")}</label>
            <input className={`inp mono${touched && !form.host.trim() ? " invalid" : ""}`} value={form.host} onChange={(event) => setValue("host", event.target.value)} placeholder="例如：product.source.demo.invalid" />
          </div>
          <div className="fl">
            <label>{getUpstreamFieldLabel("schema")}</label>
            <input className="inp mono" value={form.schema} onChange={(event) => setValue("schema", event.target.value)} placeholder="例如：CBS_OWNER" />
          </div>
        </div>
      </div>

      <div className="form-card">
        <div className="form-card-head">
          <h3><Icon name="clock" size={14} />卸数时间点</h3>
          <span className="form-card-meta">{form.unloadTimes.length} 个</span>
        </div>
        <div className="time-rows">
          {form.unloadTimes.map((item, index) => (
            <div key={`${item}_${index}`} className="time-row">
              <span className="tr-idx">{index + 1}</span>
              <TimeInput
                value={item}
                invalid={touched && !isValidTime(item)}
                onChange={(event) => setTime(index, event.target.value)}
                aria-label={`卸数时间点 ${index + 1}`}
              />
              <button className="icon-btn danger" disabled={form.unloadTimes.length === 1} onClick={() => setForm((prev) => ({ ...prev, unloadTimes: prev.unloadTimes.filter((_, current) => current !== index) }))}>
                <Icon name="trash" size={14} />
              </button>
            </div>
          ))}
        </div>
        <button className="add-field" type="button" onClick={() => setForm((prev) => ({ ...prev, unloadTimes: [...prev.unloadTimes, "00:00"] }))}>
          <Icon name="plus" size={14} />新增时间点
        </button>
      </div>

      <FormActionBar
        note={isEdit ? "保存后将更新该系统配置" : "保存后将加入上游卸数系统清单"}
        onCancel={onCancel}
        onSave={save}
        saving={saving}
        isDirty={isDirty}
      />
      {isEdit ? (
        <DangerZone
          description="删除上游系统前，应优先评估禁用是否足够。存在关联入仓表、字段映射、卸数计划或历史记录时，不应允许删除。"
          actions={[
            {
              key: "delete-upstream",
              label: "删除上游系统",
              icon: "trash",
              danger: true,
              onClick: onDelete,
              hint: "删除失败时应直接展示后端返回的不可删除原因。",
            },
          ]}
        />
      ) : null}
    </div>
  );
}
