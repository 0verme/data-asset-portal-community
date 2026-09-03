import React from "react";

import type { PushJobItem, PushSystemItem } from "../../data/pushSystems.ts";
import { getLegacyAwareOptions, isLegacyDictValue, normalizeDictOptions, type DictOption, type OptionInputItem } from "../../utils/optionUtils.ts";
import { ActionErrorBanner, BinaryStatusToggle, confirmDeleteAction, DangerZone, FormActionBar, PageHeader } from "../common/index.ts";
import { optionLabel } from "../../utils/ui.ts";
import {
  DEFAULT_DELIMITER_OPTIONS,
  DEFAULT_ENCODING_OPTIONS,
  DEFAULT_FREQ_TYPE_OPTIONS,
  FIELD_TYPE_OPTIONS,
  FREQ_PARAM_CONFIG,
} from "./pushConstants.ts";
import {
  createPushField,
  defaultFreqParam,
  formatRenameHint,
  isRenameJob,
  normalizePushFields,
  validateJob,
  type FieldValidationErrors,
  type JobValidationResult,
  type PushField,
  type PushJobForm,
} from "./pushUtils.ts";
import { Icon } from "../ui.tsx";

interface JobFormData extends PushJobForm {
  id: string;
  sourcePath: string;
  targetPath: string;
  targetFileName: string;
  delimiter: string;
  encoding: string;
  rowCnt: string;
  enabled: boolean;
  desc: string;
}

function normalizeEnabled(value: string | boolean): boolean {
  return typeof value === "boolean" ? value : value === "enabled";
}

function normalizeSelectOptions(options: readonly OptionInputItem[], currentValue: string): DictOption[] {
  return getLegacyAwareOptions(normalizeDictOptions(options), currentValue);
}

function createForm(
  initial: PushJobItem | null,
  defaults: { delimiter: string; encoding: string; freqType: string },
): JobFormData {
  return {
    id: initial?.id || "",
    cn: initial?.cn || "",
    sourcePath: initial?.sourcePath || "",
    sourceFileName: initial?.sourceFileName || "",
    targetPath: initial?.targetPath || "",
    targetFileName: initial?.targetFileName || initial?.sourceFileName || "",
    freqType: initial?.freqType || defaults.freqType,
    freq: initial?.freq ?? defaultFreqParam(initial?.freqType || defaults.freqType),
    delimiter: initial?.delimiter || defaults.delimiter,
    encoding: initial?.encoding || defaults.encoding,
    rowCnt: initial?.rowCnt || "",
    enabled: initial?.enabled ?? true,
    desc: initial?.desc || "",
  };
}

export interface JobEditorProps {
  mode: "new" | "edit";
  system: Pick<PushSystemItem, "id" | "name" | "abbr">;
  initial?: PushJobItem | null | undefined;
  delimiterOptions?: readonly OptionInputItem[] | undefined;
  encodingOptions?: readonly OptionInputItem[] | undefined;
  freqTypeOptions?: readonly OptionInputItem[] | undefined;
  onSave: (job: PushJobItem, oldId?: string) => void | Promise<unknown>;
  onCancel: () => void;
  onBackToList: () => void;
  onBackToSystem: () => void;
  onBackToJob?: (() => void) | undefined;
  onDelete?: ((jobId: string) => void | Promise<unknown>) | undefined;
}

export function JobEditor({
  mode,
  system,
  initial = null,
  delimiterOptions = DEFAULT_DELIMITER_OPTIONS,
  encodingOptions = DEFAULT_ENCODING_OPTIONS,
  freqTypeOptions = DEFAULT_FREQ_TYPE_OPTIONS,
  onSave,
  onCancel,
  onBackToList,
  onBackToSystem,
  onBackToJob,
  onDelete,
}: JobEditorProps) {
  const isEdit = mode === "edit";
  const normalizedDelimiterOptions = normalizeDictOptions(delimiterOptions);
  const normalizedEncodingOptions = normalizeDictOptions(encodingOptions);
  const normalizedFreqTypeOptions = normalizeDictOptions(freqTypeOptions);
  const defaultFreqType = normalizedFreqTypeOptions[0]?.value || DEFAULT_FREQ_TYPE_OPTIONS[0]?.value || "T+1";
  const defaultDelimiter = normalizedDelimiterOptions[0]?.value || DEFAULT_DELIMITER_OPTIONS[0]?.value || "|";
  const defaultEncoding = normalizedEncodingOptions[0]?.value || DEFAULT_ENCODING_OPTIONS[0]?.value || "UTF-8";
  const defaults = { delimiter: defaultDelimiter, encoding: defaultEncoding, freqType: defaultFreqType };
  const [form, setForm] = React.useState<JobFormData>(() => createForm(initial, defaults));
  const [fields, setFields] = React.useState<PushField[]>(() => (
    initial?.fields?.length ? normalizePushFields(initial.fields) : [createPushField()]
  ));
  const [touched, setTouched] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const initialSnapshotRef = React.useRef(JSON.stringify({ form, fields }));
  const isDirty = initialSnapshotRef.current !== JSON.stringify({ form, fields });
  const oldId = initial?.id || "";
  const deleteInitial = isEdit ? initial : null;

  React.useEffect(() => {
    const nextForm = createForm(initial, defaults);
    const nextFields = initial?.fields?.length ? normalizePushFields(initial.fields) : [createPushField()];
    setForm(nextForm);
    setFields(nextFields);
    setTouched(false);
    setSaving(false);
    initialSnapshotRef.current = JSON.stringify({ form: nextForm, fields: nextFields });
  }, [initial, defaultDelimiter, defaultEncoding, defaultFreqType]);

  const validation: JobValidationResult = touched ? validateJob(form, fields) : { errors: [], fieldErrors: {} };
  const delimiterSelectOptions = normalizeSelectOptions(delimiterOptions, form.delimiter);
  const encodingSelectOptions = normalizeSelectOptions(encodingOptions, form.encoding);
  const freqTypeSelectOptions = normalizeSelectOptions(freqTypeOptions, form.freqType);
  const delimiterLegacy = isLegacyDictValue(delimiterOptions, form.delimiter);
  const encodingLegacy = isLegacyDictValue(encodingOptions, form.encoding);
  const freqTypeLegacy = isLegacyDictValue(freqTypeOptions, form.freqType);

  const setValue = <K extends keyof JobFormData>(key: K, value: JobFormData[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };
  const setSourceFileName = (value: string) => setForm((prev) => {
    const shouldSyncTarget = !prev.targetFileName.trim() || prev.targetFileName === prev.sourceFileName;
    return {
      ...prev,
      sourceFileName: value,
      targetFileName: shouldSyncTarget ? value : prev.targetFileName,
    };
  });
  const setFreqType = (value: string) => setForm((prev) => ({ ...prev, freqType: value, freq: defaultFreqParam(value) }));
  const freqParamConfig = FREQ_PARAM_CONFIG[form.freqType];
  const setField = (fieldKey: string, patch: Partial<PushField>) => {
    setFields((prev) => prev.map((field) => (field._key === fieldKey ? { ...field, ...patch } : field)));
  };
  const addField = () => setFields((prev) => [...prev, createPushField()]);
  const deleteField = (fieldKey: string) => setFields((prev) => prev.filter((field) => field._key !== fieldKey));
  const moveField = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= fields.length) return;

    setFields((prev) => {
      const current = prev[index];
      const target = prev[nextIndex];
      if (!current || !target) return prev;
      const next = prev.slice();
      next[index] = target;
      next[nextIndex] = current;
      return next;
    });
  };

  const save = async (): Promise<void> => {
    setTouched(true);
    const nextValidation = validateJob(form, fields);
    if (nextValidation.errors.length || saving) return;

    const generatedId = oldId || `JOB_${system.abbr}_${Date.now().toString(36).toUpperCase()}`;
    setSaving(true);
    try {
      await onSave(
        {
          ...(initial || {}),
          ...form,
          id: generatedId,
          cn: form.cn.trim(),
          sourcePath: form.sourcePath.trim() || "-",
          sourceFileName: form.sourceFileName.trim(),
          targetPath: form.targetPath.trim() || "-",
          targetFileName: form.targetFileName.trim() || form.sourceFileName.trim(),
          rowCnt: form.rowCnt.trim() || "-",
          desc: form.desc.trim() || "暂无说明",
          fields: fields.map((field) => ({
            name: field.name.trim(),
            cn: field.cn.trim(),
            meaning: field.meaning.trim(),
            src: field.src.trim() || "DWM",
            type: field.type,
          })),
        },
        oldId || undefined,
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        back={{ onClick: onCancel, text: isEdit ? "返回上一层" : "返回系统详情" }}
        breadcrumbs={[
          { label: "系统列表", onClick: onBackToList },
          { label: system.id, onClick: onBackToSystem },
          ...(isEdit ? [{ label: oldId, onClick: onBackToJob }] : []),
          { label: isEdit ? "编辑接口" : "新增接口" },
        ]}
        icon={isEdit ? "edit" : "plus"}
        title={isEdit ? "编辑推送接口" : "新增推送接口"}
        subtitle={`${system.name} / ${system.id}`}
      />

      <ActionErrorBanner title="请先修正以下问题" messages={validation.errors} />

      <div className="form-card">
        <h3><Icon name="file" size={14} />文件头信息</h3>
        <div className="form-grid">
          <div className="fl">
            <label>作业名称</label>
            <input className={`inp${touched && !form.cn.trim() ? " invalid" : ""}`} value={form.cn} onChange={(event) => setValue("cn", event.target.value)} placeholder="例如：会员画像日终快照推送" />
          </div>
          <div className="fl">
            <label>湖仓来源路径</label>
            <input className="inp mono" value={form.sourcePath} onChange={(event) => setValue("sourcePath", event.target.value)} placeholder="例如：/dw/dwm/xxx/dt=${yyyy-MM-dd}" />
          </div>
          <div className="fl">
            <label>湖仓来源文件名</label>
            <input className={`inp mono${touched && !form.sourceFileName.trim() ? " invalid" : ""}`} value={form.sourceFileName} onChange={(event) => setSourceFileName(event.target.value)} placeholder="例如：ACCT_BAL_${yyyyMMdd}.dat" />
          </div>
          <div className="fl">
            <label>目标推送路径</label>
            <input className="inp mono" value={form.targetPath} onChange={(event) => setValue("targetPath", event.target.value)} placeholder="例如：/incoming/xxx/" />
          </div>
          <div className="fl">
            <label>目标推送文件名</label>
            <input className={`inp mono${touched && !form.targetFileName.trim() && !form.sourceFileName.trim() ? " invalid" : ""}`} value={form.targetFileName} onChange={(event) => setValue("targetFileName", event.target.value)} placeholder="默认同湖仓来源文件名" />
          </div>
          {isRenameJob(form) ? <div className="fl full"><div className="editor-sub mono">推送时重命名：{formatRenameHint(form)}</div></div> : null}
          <div className="fl">
            <label>字段分隔符</label>
            <select className="sel mono" value={form.delimiter} onChange={(event) => setValue("delimiter", event.target.value)}>
              {delimiterSelectOptions.map((item) => (
                <option key={item.value} value={item.value}>{optionLabel(item)}</option>
              ))}
            </select>
            {delimiterLegacy ? <div className="editor-sub" style={{ marginTop: 6, color: "var(--warn)" }}>字段分隔符当前值未在码值中维护，请补充码值或重新选择。</div> : null}
          </div>
          <div className="fl">
            <label>文件编码</label>
            <select className="sel mono" value={form.encoding} onChange={(event) => setValue("encoding", event.target.value)}>
              {encodingSelectOptions.map((item) => <option key={item.value} value={item.value}>{optionLabel(item)}</option>)}
            </select>
            {encodingLegacy ? <div className="editor-sub" style={{ marginTop: 6, color: "var(--warn)" }}>文件编码当前值未在码值中维护，请补充码值或重新选择。</div> : null}
          </div>
          <div className="fl">
            <label>推送频率</label>
            <select className="sel" value={form.freqType} onChange={(event) => setFreqType(event.target.value)}>
              {freqTypeSelectOptions.map((item) => <option key={item.value} value={item.value}>{optionLabel(item)}</option>)}
            </select>
            {freqTypeLegacy ? <div className="editor-sub" style={{ marginTop: 6, color: "var(--warn)" }}>推送频率当前值未在码值中维护，请补充码值或重新选择。</div> : null}
          </div>
          <div className="fl">
            {freqParamConfig ? (
              <>
                <label>{freqParamConfig.label}</label>
                <select
                  className={`sel${touched && !form.freq ? " invalid" : ""}`}
                  value={form.freq}
                  onChange={(event) => setValue("freq", event.target.value)}
                >
                  {freqParamConfig.options.map((item) => <option key={item.value} value={item.value}>{item.name}</option>)}
                </select>
              </>
            ) : (
              <>
                <label>频率明细</label>
                <input className="inp" value="无需配置（出数时间取决于上游）" disabled readOnly />
              </>
            )}
          </div>
          <div className="fl">
            <label>预估行数</label>
            <input className="inp" value={form.rowCnt} onChange={(event) => setValue("rowCnt", event.target.value)} placeholder="例如：约 12 万行" />
          </div>
          <div className="fl full">
            <label>业务逻辑说明</label>
            <textarea className="ta" value={form.desc} onChange={(event) => setValue("desc", event.target.value)} placeholder="描述推送内容、加工逻辑和注意事项。" />
          </div>
          <div className="fl">
            <label>启用状态</label>
            <BinaryStatusToggle mode="enabled" value={form.enabled} onChange={(nextValue) => setValue("enabled", normalizeEnabled(nextValue))} />
          </div>
        </div>
      </div>

      <div className="form-card">
        <div className="form-card-head">
          <h3><Icon name="columns" size={14} />字段清单</h3>
          <span className="form-card-meta">共 {fields.length} 个字段</span>
        </div>
        <div className="fe-scroll">
          <table className="fields-edit mobile-edit-table">
            <thead>
              <tr>
                <th style={{ width: 34 }}>#</th>
                <th style={{ minWidth: 170 }}>字段名</th>
                <th style={{ minWidth: 140 }}>中文名</th>
                <th style={{ minWidth: 200 }}>含义</th>
                <th style={{ minWidth: 130 }}>来源系统</th>
                <th style={{ width: 150 }}>数据类型</th>
                <th style={{ width: 110 }}></th>
              </tr>
            </thead>
            <tbody>
              {fields.map((field, index) => {
                const rowErrors: FieldValidationErrors = validation.fieldErrors[field._key] || {};

                return (
                  <tr key={field._key}>
                    <td data-label="字段序号" className="idx-cell">{index + 1}</td>
                    <td data-label="字段名">
                      <input className={`cell-inp mono${rowErrors.name ? " invalid" : ""}`} value={field.name} onChange={(event) => setField(field._key, { name: event.target.value })} placeholder="field_name" />
                    </td>
                    <td data-label="中文名">
                      <input className={`cell-inp${rowErrors.cn ? " invalid" : ""}`} value={field.cn} onChange={(event) => setField(field._key, { cn: event.target.value })} placeholder="中文名" />
                    </td>
                    <td data-label="含义">
                      <input className="cell-inp" value={field.meaning} onChange={(event) => setField(field._key, { meaning: event.target.value })} placeholder="字段含义说明" />
                    </td>
                    <td data-label="来源系统">
                      <input className="cell-inp" value={field.src} onChange={(event) => setField(field._key, { src: event.target.value })} placeholder="来源系统" />
                    </td>
                    <td data-label="数据类型">
                      <select className="cell-inp mono" value={field.type} onChange={(event) => setField(field._key, { type: event.target.value })}>
                        {FIELD_TYPE_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
                      </select>
                    </td>
                    <td data-label="">
                      <div className="row-tools">
                        <button className="icon-btn" disabled={index === 0} onClick={() => moveField(index, -1)} type="button"><Icon name="up" size={14} /></button>
                        <button className="icon-btn" disabled={index === fields.length - 1} onClick={() => moveField(index, 1)} type="button"><Icon name="down" size={14} /></button>
                        <button className="icon-btn danger" disabled={fields.length === 1} onClick={() => deleteField(field._key)} type="button"><Icon name="trash" size={14} /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <button className="add-field" onClick={addField} type="button"><Icon name="plus" size={14} />新增字段</button>
      </div>

      <FormActionBar
        note={isEdit ? "保存后会更新该接口的文件头和字段清单。" : "保存后会加入当前系统的推送作业列表。"}
        onCancel={onCancel}
        onSave={save}
        saving={saving}
        isDirty={isDirty}
      />
      {deleteInitial ? (
        <DangerZone
          description="删除推送接口会影响上下游文件关系追溯和历史任务记录，请确认没有在用依赖。"
          actions={[
            {
              key: "delete-push-job",
              label: "删除推送接口",
              icon: "trash",
              danger: true,
              onClick: async () => {
                if (await confirmDeleteAction({
                  name: deleteInitial.cn,
                  typeLabel: "推送接口",
                  impact: "该接口删除后，可能影响上下游文件关系追溯、历史任务记录和审计追踪。请确认没有下游依赖。",
                  consequences: [
                    "删除前应以后端依赖校验结果为准。",
                    "若后端返回不可删除原因，页面会展示具体原因。",
                  ],
                  confirmKeyword: oldId,
                  confirmKeywordLabel: "请输入接口标识二次确认",
                })) {
                  await onDelete?.(oldId);
                }
              },
            },
          ]}
        />
      ) : null}
    </div>
  );
}
