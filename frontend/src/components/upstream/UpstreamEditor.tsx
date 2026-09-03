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
import { Icon } from "../ui.tsx";
import type { MockUpstreamSystem } from "../../data/upstreamSystems.ts";
import {
  normalizeBinaryStatusOptions,
  type BinaryStatusOption,
} from "../common/status.ts";
import {
  ActionErrorBanner,
  BinaryStatusToggle,
  DangerZone,
  FormActionBar,
  PageHeader,
  TimeInput,
  toast,
} from "../common/index.ts";
import { buildModuleBreadcrumbs } from "../../routing/navigation.ts";
import {
  getLegacyAwareOptions,
  isLegacyDictValue,
  normalizeDictOptions,
  normalizeDictValue,
  type OptionInputItem,
} from "../../utils/optionUtils.ts";
import { optionLabel } from "../../utils/ui.ts";

import { getUpstreamFieldLabel } from "./upstreamFieldContract.ts";
import {
  getUpstreamErrorSummary,
  mergeUpstreamFieldErrors,
  scrollToFirstUpstreamError,
  validateUpstreamForm,
  type UpstreamFormError,
} from "./upstreamFormErrors.ts";

export type UpstreamEditorMode = "new" | "edit";
export type UpstreamEditorInitial =
  | Partial<MockUpstreamSystem>
  | null
  | undefined;

export interface UpstreamEditorProps {
  mode: UpstreamEditorMode;
  initial?: UpstreamEditorInitial;
  dbTypeOptions?: readonly OptionInputItem[] | undefined;
  deptOptions?: readonly OptionInputItem[] | undefined;
  statusOptions?: readonly BinaryStatusOption[] | undefined;
  onSave: (
    system: MockUpstreamSystem,
    oldId?: string,
  ) => void | Promise<unknown>;
  onCancel: () => void;
  onBackToList: () => void;
  onBackToDetail?: (() => void) | undefined;
  onDelete?: (() => void | Promise<unknown>) | undefined;
  saveError?: string | undefined;
  saveFieldErrors?: readonly UpstreamFormError[] | undefined;
  onClearSaveError?: ((field?: string) => void) | undefined;
}

function createDefaultForm(
  initial: UpstreamEditorInitial,
  defaultDbType: string,
  defaultStatus: string,
  dbTypeOptions: readonly OptionInputItem[],
  deptOptions: readonly OptionInputItem[],
): MockUpstreamSystem {
  return {
    upstreamSystemId: initial?.upstreamSystemId ?? 0,
    id: initial?.id ?? "",
    abbr: initial?.abbr ?? "",
    name: initial?.name ?? "",
    dbType: normalizeDictValue(
      dbTypeOptions,
      initial?.dbType ?? defaultDbType,
    ),
    host: initial?.host ?? "",
    db: initial?.db ?? "",
    schema: initial?.schema ?? "",
    unloadTimes: Array.isArray(initial?.unloadTimes)
      ? [...initial.unloadTimes]
      : ["02:00"],
    status: initial?.status ?? defaultStatus,
    owner: initial?.owner ?? "",
    dept: normalizeDictValue(deptOptions, initial?.dept ?? ""),
    desc: initial?.desc ?? "",
  };
}

export function UpstreamEditor({
  mode,
  initial,
  dbTypeOptions = [],
  deptOptions = [],
  statusOptions = [],
  onSave,
  onCancel,
  onBackToList,
  onBackToDetail,
  onDelete,
  saveError = "",
  saveFieldErrors = [],
  onClearSaveError,
}: UpstreamEditorProps) {
  const isEdit = mode === "edit";
  const oldId = initial?.id || "";
  const normalizedStatusOptions = normalizeBinaryStatusOptions(statusOptions);
  const defaultStatus = normalizedStatusOptions[0]?.value || "enabled";
  const normalizedDbTypeOptions = normalizeDictOptions(dbTypeOptions);
  const defaultDbType = normalizedDbTypeOptions[0]?.value || "";
  const initialForm = React.useMemo(
    () =>
      createDefaultForm(
        initial,
        defaultDbType,
        defaultStatus,
        dbTypeOptions,
        deptOptions,
      ),
    [initial, defaultDbType, defaultStatus, dbTypeOptions, deptOptions],
  );
  const saveLockRef = React.useRef(false);
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState<MockUpstreamSystem>(() => initialForm);
  const [touched, setTouched] = React.useState(false);
  const initialSnapshotRef = React.useRef(JSON.stringify(form));
  const previousSaveErrorCountRef = React.useRef(saveFieldErrors.length);
  const isDirty = initialSnapshotRef.current !== JSON.stringify(form);
  const unloadTimes = Array.isArray(form.unloadTimes) ? form.unloadTimes : [];

  React.useEffect(() => {
    setForm(initialForm);
    setTouched(false);
    saveLockRef.current = false;
    setSaving(false);
    initialSnapshotRef.current = JSON.stringify(initialForm);
  }, [initialForm]);

  const clientErrors = touched ? validateUpstreamForm(form) : [];
  const fieldErrors = mergeUpstreamFieldErrors(clientErrors, saveFieldErrors);
  const getFieldError = (field: string): UpstreamFormError | undefined =>
    fieldErrors.find((item) => item.field === field);
  const fieldErrorId = (field: string): string =>
    `upstream-error-${field.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const renderFieldError = (field: string): React.ReactNode => {
    const error = getFieldError(field);
    return error ? (
      <div id={fieldErrorId(field)} className="upstream-field-error" role="alert">
        {error.message}
      </div>
    ) : null;
  };
  const errorSummary = fieldErrors.length
    ? getUpstreamErrorSummary(fieldErrors)
    : saveError
      ? [saveError]
      : [];

  React.useEffect(() => {
    const hadSaveErrors = previousSaveErrorCountRef.current > 0;
    previousSaveErrorCountRef.current = saveFieldErrors.length;
    if (!hadSaveErrors && saveFieldErrors.length) {
      scrollToFirstUpstreamError(saveFieldErrors);
    }
  }, [saveFieldErrors]);

  const dbTypeSelectOptions = normalizeDictOptions(
    getLegacyAwareOptions(dbTypeOptions, form.dbType),
  );
  const deptSelectOptions = normalizeDictOptions(
    getLegacyAwareOptions(deptOptions, form.dept),
  );
  const dbTypeLegacy = isLegacyDictValue(dbTypeOptions, form.dbType);
  const deptLegacy =
    Boolean(form.dept) && isLegacyDictValue(deptOptions, form.dept);

  const setValue = <K extends keyof MockUpstreamSystem>(
    key: K,
    value: MockUpstreamSystem[K],
  ): void => {
    if (saveError || saveFieldErrors.length) onClearSaveError?.(key);
    setForm((previous) => ({ ...previous, [key]: value }));
  };

  const setTime = (index: number, value: string): void => {
    if (saveError || saveFieldErrors.length) {
      onClearSaveError?.(`unloadTimes[${index}]`);
    }
    setForm((previous) => ({
      ...previous,
      unloadTimes: previous.unloadTimes.map((item, current) =>
        current === index ? value : item,
      ),
    }));
  };

  const save = async (): Promise<void> => {
    if (saving || saveLockRef.current) return;
    const nextErrors = validateUpstreamForm(form);
    setTouched(true);
    onClearSaveError?.();
    if (nextErrors.length) {
      scrollToFirstUpstreamError(nextErrors);
      toast.error(`保存失败，还有 ${nextErrors.length} 项需要修改`);
      return;
    }
    const normalizedAbbr = form.abbr.trim().toUpperCase();
    saveLockRef.current = true;
    setSaving(true);
    try {
      await onSave(
        {
          ...form,
          id: form.id.trim() || oldId,
          abbr: normalizedAbbr,
          name: form.name.trim(),
          dbType: normalizeDictValue(dbTypeOptions, form.dbType),
          host: form.host.trim(),
          db: form.db.trim(),
          schema: form.schema.trim(),
          unloadTimes: [...new Set(unloadTimes.map((item) => item.trim()))].sort(),
          status: form.status,
          owner: form.owner.trim() || "未指定",
          dept: normalizeDictValue(deptOptions, form.dept),
          desc: form.desc.trim() || "暂无说明",
        },
        oldId || undefined,
      );
    } finally {
      saveLockRef.current = false;
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        back={{
          onClick: onCancel,
          text: isEdit ? "返回上一层" : "返回上游卸数列表",
        }}
        breadcrumbs={buildModuleBreadcrumbs(
          "upstream",
          [
            ...(isEdit
              ? [{ label: form.abbr || oldId, onClick: onBackToDetail }]
              : []),
            { label: isEdit ? "编辑系统" : "新增系统" },
          ],
          onBackToList,
        )}
        icon={isEdit ? "edit" : "plus"}
        title={isEdit ? "编辑上游卸数系统" : "新增上游卸数系统"}
        subtitle={isEdit ? oldId : "配置上游系统连接和卸数时间点"}
      />

      <ActionErrorBanner title="保存失败" messages={errorSummary} />

      <div className="form-card">
        <h3>
          <Icon name="server" size={14} />
          基本信息
        </h3>
        <div className="form-grid">
          <div className="fl upstream-field" data-form-field="id">
            <label>{getUpstreamFieldLabel("id")}</label>
            <input
              className={`inp mono${getFieldError("id") ? " invalid" : ""}`}
              value={form.id}
              onChange={(event) => setValue("id", event.target.value)}
              placeholder="例如：up_cbs"
              data-form-control
              aria-invalid={Boolean(getFieldError("id")) || undefined}
              aria-describedby={getFieldError("id") ? fieldErrorId("id") : undefined}
            />
            {renderFieldError("id")}
          </div>
          <div className="fl upstream-field" data-form-field="abbr">
            <label>{getUpstreamFieldLabel("abbr")}</label>
            <input
              className={`inp mono${getFieldError("abbr") ? " invalid" : ""}`}
              value={form.abbr}
              onChange={(event) => setValue("abbr", event.target.value)}
              placeholder="例如：CBS"
              data-form-control
              aria-invalid={Boolean(getFieldError("abbr")) || undefined}
              aria-describedby={getFieldError("abbr") ? fieldErrorId("abbr") : undefined}
            />
            {renderFieldError("abbr")}
          </div>
          <div className="fl upstream-field" data-form-field="name">
            <label>{getUpstreamFieldLabel("name")}</label>
            <input
              className={`inp${getFieldError("name") ? " invalid" : ""}`}
              value={form.name}
              onChange={(event) => setValue("name", event.target.value)}
              placeholder="例如：商品中心"
              data-form-control
              aria-invalid={Boolean(getFieldError("name")) || undefined}
              aria-describedby={getFieldError("name") ? fieldErrorId("name") : undefined}
            />
            {renderFieldError("name")}
          </div>
          <div className="fl upstream-field" data-form-field="dbType">
            <label>{getUpstreamFieldLabel("dbType")}</label>
            <select
              className={`sel${getFieldError("dbType") ? " invalid" : ""}`}
              value={form.dbType}
              onChange={(event) => setValue("dbType", event.target.value)}
              data-form-control
              aria-invalid={Boolean(getFieldError("dbType")) || undefined}
              aria-describedby={getFieldError("dbType") ? fieldErrorId("dbType") : undefined}
            >
              <option value="">请选择数据库类型</option>
              {dbTypeSelectOptions.map((item) => (
                <option key={item.value} value={item.value}>
                  {optionLabel(item)}
                </option>
              ))}
            </select>
            {dbTypeLegacy && !getFieldError("dbType") ? (
              <div
                className="editor-sub"
                style={{ marginTop: 6, color: "var(--warn)" }}
              >
                当前值未在码值中维护，请补充码值或重新选择。
              </div>
            ) : null}
            {renderFieldError("dbType")}
          </div>
          <div className="fl">
            <label>{getUpstreamFieldLabel("owner")}</label>
            <input
              className="inp"
              value={form.owner}
              onChange={(event) => setValue("owner", event.target.value)}
              placeholder="例如：王芳"
            />
          </div>
          <div className="fl upstream-field" data-form-field="dept">
            <label>{getUpstreamFieldLabel("dept")}</label>
            <select
              className={`sel${getFieldError("dept") ? " invalid" : ""}`}
              value={form.dept}
              onChange={(event) => setValue("dept", event.target.value)}
              data-form-control
              aria-invalid={Boolean(getFieldError("dept")) || undefined}
              aria-describedby={getFieldError("dept") ? fieldErrorId("dept") : undefined}
            >
              <option value="">请选择业务部门</option>
              {deptSelectOptions.map((item) => (
                <option key={item.value} value={item.value}>
                  {optionLabel(item)}
                </option>
              ))}
            </select>
            {deptLegacy && !getFieldError("dept") ? (
              <div
                className="editor-sub"
                style={{ marginTop: 6, color: "var(--warn)" }}
              >
                当前值未在码值中维护，请补充码值或重新选择。
              </div>
            ) : null}
            {renderFieldError("dept")}
          </div>
          <div className="fl upstream-field" data-form-field="status">
            <label>{getUpstreamFieldLabel("status")}</label>
            <div data-form-control>
              <BinaryStatusToggle
                mode="status"
                value={form.status}
                options={normalizedStatusOptions}
                onChange={(value) =>
                  setValue(
                    "status",
                    typeof value === "boolean"
                      ? value
                        ? "enabled"
                        : "disabled"
                      : value,
                  )
                }
              />
            </div>
            {renderFieldError("status")}
          </div>
          <div className="fl full">
            <label>{getUpstreamFieldLabel("desc")}</label>
            <textarea
              className="ta"
              value={form.desc}
              onChange={(event) => setValue("desc", event.target.value)}
              placeholder="描述该系统提供哪些数据，以及卸数用途。"
            />
          </div>
        </div>
      </div>

      <div className="form-card">
        <h3>
          <Icon name="db" size={14} />
          数据库连接
        </h3>
        <div className="form-grid">
          <div className="fl upstream-field" data-form-field="host">
            <label>{getUpstreamFieldLabel("host")}</label>
            <input
              className={`inp mono${getFieldError("host") ? " invalid" : ""}`}
              value={form.host}
              onChange={(event) => setValue("host", event.target.value)}
              placeholder="例如：product.source.demo.invalid"
              data-form-control
              aria-invalid={Boolean(getFieldError("host")) || undefined}
              aria-describedby={getFieldError("host") ? fieldErrorId("host") : undefined}
            />
            {renderFieldError("host")}
          </div>
          <div className="fl">
            <label>{getUpstreamFieldLabel("schema")}</label>
            <input
              className="inp mono"
              value={form.schema}
              onChange={(event) => setValue("schema", event.target.value)}
              placeholder="例如：CBS_OWNER"
            />
          </div>
        </div>
      </div>

      <div className="form-card upstream-field" data-form-field="unloadTimes">
        <div className="form-card-head">
          <h3>
            <Icon name="clock" size={14} />
            卸数时间点
          </h3>
          <span className="form-card-meta">{unloadTimes.length} 个</span>
        </div>
        <div className="time-rows">
          {unloadTimes.map((item, index) => {
            const timeError = getFieldError(`unloadTimes[${index}]`);
            return (
              <div
                key={`${item}_${index}`}
                className="time-row upstream-field"
                data-form-field={`unloadTimes[${index}]`}
              >
                <span className="tr-idx">{index + 1}</span>
                <div className="upstream-time-control">
                  <TimeInput
                    value={item}
                    invalid={Boolean(timeError)}
                    onChange={(event) => setTime(index, event.target.value)}
                    aria-label={`卸数时间点 ${index + 1}`}
                    data-form-control
                    aria-invalid={Boolean(timeError) || undefined}
                    aria-describedby={
                      timeError
                        ? fieldErrorId(`unloadTimes[${index}]`)
                        : undefined
                    }
                  />
                  {renderFieldError(`unloadTimes[${index}]`)}
                </div>
                <button
                  className="icon-btn danger"
                  type="button"
                  disabled={unloadTimes.length === 1}
                  onClick={() => {
                    onClearSaveError?.("unloadTimes");
                    setForm((previous) => ({
                      ...previous,
                      unloadTimes: previous.unloadTimes.filter(
                        (_, current) => current !== index,
                      ),
                    }));
                  }}
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
            );
          })}
        </div>
        <button
          className="add-field"
          type="button"
          onClick={() => {
            onClearSaveError?.("unloadTimes");
            setForm((previous) => ({
              ...previous,
              unloadTimes: [...previous.unloadTimes, "00:00"],
            }));
          }}
        >
          <Icon name="plus" size={14} />
          新增时间点
        </button>
        {renderFieldError("unloadTimes")}
      </div>

      <FormActionBar
        note={
          isEdit ? "保存后将更新该系统配置" : "保存后将加入上游卸数系统清单"
        }
        onCancel={onCancel}
        onSave={save}
        saving={saving}
        isDirty={isDirty}
      />
      {isEdit && onDelete ? (
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
