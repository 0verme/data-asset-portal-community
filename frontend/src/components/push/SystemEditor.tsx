import React from "react";

import type { PushSystemItem } from "../../data/pushSystems.ts";
import { getLegacyAwareOptions, isLegacyDictValue, normalizeDictOptions, type OptionInputItem, type DictOption } from "../../utils/optionUtils.ts";
import { isValidLatestOutputTime, normalizeLatestOutputTime } from "../../utils/push.ts";
import { optionLabel } from "../../utils/ui.ts";
import { ActionErrorBanner, BinaryStatusToggle, confirmDeleteAction, DangerZone, FormActionBar, PageHeader } from "../common/index.ts";
import {
  DEFAULT_AUTH_OPTIONS,
  DEFAULT_PROTOCOL_OPTIONS,
  DEFAULT_STATUS_OPTIONS,
  SYSTEM_ID_RE,
} from "./pushConstants.ts";
import { validateSystem, type PushSystemForm } from "./pushUtils.ts";
import { Icon } from "../ui.tsx";
import { Input, Select, Textarea } from "../../ui/index.ts";
import { useUiCopy } from "../../i18n/useUiTranslation.ts";

type SystemFormData = PushSystemForm & {
  desc: string;
  protocol: string;
  account: string;
  auth: string;
  downstreamContact: string;
  dataDeveloperContact: string;
  dept: string;
  status: string;
};

function normalizeStatus(value: string | boolean): string {
  return typeof value === "boolean" ? (value ? "enabled" : "disabled") : value;
}

function normalizeSelectOptions(options: readonly OptionInputItem[], currentValue: string): DictOption[] {
  const normalized = normalizeDictOptions(options);
  return getLegacyAwareOptions(normalized, currentValue);
}

function createForm(initial: PushSystemItem | null, defaults: { protocol: string; auth: string; status: string }): SystemFormData {
  return {
    id: initial?.id || "",
    name: initial?.name || "",
    abbr: initial?.abbr || "",
    desc: initial?.desc || "",
    protocol: initial?.protocol || defaults.protocol,
    host: initial?.host || "",
    port: initial?.port || 22,
    account: initial?.account || "",
    auth: initial?.auth || defaults.auth,
    downstreamContact: initial?.downstreamContact || "",
    dataDeveloperContact: initial?.dataDeveloperContact || "",
    dept: initial?.dept || "",
    status: initial?.status || defaults.status,
    importanceLevel: initial?.importanceLevel || "normal",
    latestOutputTime: initial?.latestOutputTime || "",
  };
}

export interface SystemEditorProps {
  mode: "new" | "edit";
  initial?: PushSystemItem | null | undefined;
  existingIds: readonly string[];
  depts?: readonly OptionInputItem[] | undefined;
  protocolOptions?: readonly OptionInputItem[] | undefined;
  authOptions?: readonly OptionInputItem[] | undefined;
  statusOptions?: readonly OptionInputItem[] | undefined;
  onSave: (system: PushSystemItem, oldId?: string) => void | Promise<unknown>;
  onCancel: () => void;
  onBackToList: () => void;
  onBackToDetail?: (() => void) | undefined;
  onDelete?: ((systemId: string) => void | Promise<unknown>) | undefined;
}

export function SystemEditor({
  mode,
  initial = null,
  existingIds,
  depts = [],
  protocolOptions = DEFAULT_PROTOCOL_OPTIONS,
  authOptions = DEFAULT_AUTH_OPTIONS,
  statusOptions = DEFAULT_STATUS_OPTIONS,
  onSave,
  onCancel,
  onBackToList,
  onBackToDetail,
  onDelete,
}: SystemEditorProps) {
  const tx = useUiCopy("integration");
  const isEdit = mode === "edit";
  const normalizedProtocolOptions = normalizeDictOptions(protocolOptions);
  const normalizedAuthOptions = normalizeDictOptions(authOptions);
  const normalizedStatusOptions = normalizeDictOptions(statusOptions);
  const remoteApi = import.meta.env?.["VITE_API_MODE"] === "remote";
  const defaultProtocol = normalizedProtocolOptions[0]?.value || (remoteApi ? "" : DEFAULT_PROTOCOL_OPTIONS[0] || "HTTP");
  const defaultAuth = normalizedAuthOptions[0]?.value || (remoteApi ? "" : DEFAULT_AUTH_OPTIONS[0] || "密钥认证");
  const defaultStatus = normalizedStatusOptions[0]?.value || "enabled";
  const defaults = { protocol: defaultProtocol, auth: defaultAuth, status: defaultStatus };
  const [form, setForm] = React.useState<SystemFormData>(() => createForm(initial, defaults));
  const [touched, setTouched] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const initialSnapshotRef = React.useRef(JSON.stringify(form));
  const isDirty = initialSnapshotRef.current !== JSON.stringify(form);
  const oldId = initial?.id || "";

  React.useEffect(() => {
    const nextForm = createForm(initial, defaults);
    setForm(nextForm);
    setTouched(false);
    setSaving(false);
    initialSnapshotRef.current = JSON.stringify(nextForm);
  }, [initial, defaultProtocol, defaultAuth, defaultStatus]);

  const errors = touched ? validateSystem(form, existingIds, oldId, tx) : [];
  const protocolSelectOptions = normalizeSelectOptions(protocolOptions, form.protocol);
  const authSelectOptions = normalizeSelectOptions(authOptions, form.auth);
  const deptSelectOptions = normalizeSelectOptions(depts, form.dept);
  const statusSelectOptions = normalizeDictOptions(statusOptions);
  const protocolLegacy = isLegacyDictValue(protocolOptions, form.protocol);
  const authLegacy = isLegacyDictValue(authOptions, form.auth);
  const deptLegacy = Boolean(form.dept) && isLegacyDictValue(depts, form.dept);
  const deleteInitial = isEdit ? initial : null;

  const setValue = <K extends keyof SystemFormData>(key: K, value: SystemFormData[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };
  const setImportanceLevel = (value: string) => setForm((prev) => ({
    ...prev,
    importanceLevel: value,
    latestOutputTime: value === "normal" ? "" : prev.latestOutputTime,
  }));

  const save = async (): Promise<void> => {
    setTouched(true);
    const nextErrors = validateSystem(form, existingIds, oldId, tx);
    if (nextErrors.length || saving) return;

    setSaving(true);
    try {
      await onSave(
        {
          ...(initial || {}),
          ...form,
          id: form.id.trim(),
          name: form.name.trim(),
          abbr: form.abbr.trim().toUpperCase(),
          desc: form.desc.trim() || "暂无说明",
          host: form.host.trim(),
          port: Number(form.port),
          account: form.account.trim() || `dw_push_${form.abbr.trim().toLowerCase() || "sys"}`,
          downstreamContact: form.downstreamContact.trim(),
          dataDeveloperContact: form.dataDeveloperContact.trim(),
          dept: form.dept.trim(),
          latestOutputTime: normalizeLatestOutputTime(form.importanceLevel, form.latestOutputTime),
          jobs: initial?.jobs || [],
        },
        oldId || undefined,
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="push-system-editor">
      <PageHeader
        back={{ onClick: onCancel, text: isEdit ? tx("返回上一层") : tx("返回下游推送")}}
        breadcrumbs={[
          { label: tx("系统列表"), onClick: onBackToList },
          ...(isEdit ? [{ label: oldId, onClick: onBackToDetail }] : []),
          { label: tx(isEdit ? "编辑系统" : "新增系统") },
        ]}
        icon={isEdit ? "edit" : "plus"}
        title={tx(isEdit ? "编辑下游系统" : "新增下游系统")}
        subtitle={isEdit ? oldId : tx("配置系统连接与对接信息。")}
      />

      <ActionErrorBanner title={tx("请先修正以下问题")} messages={errors} />

      <div className="form-card">
        <h3><Icon name="server" size={14} />{tx("基本信息")}</h3>
        <div className="form-grid">
          <div className="fl">
            <label>{tx("系统名称")}</label>
            <Input aria-label={tx("系统名称")} className={`inp${touched && !form.name.trim() ? " invalid" : ""}`} value={form.name} onChange={(event) => setValue("name", event.target.value)} placeholder={tx("例如：零售经营看板")} />
          </div>
          <div className="fl">
            <label>{tx("系统编号")}</label>
            <Input aria-label={tx("系统编号")} className={`inp mono${touched && (!form.id.trim() || !SYSTEM_ID_RE.test(form.id.trim())) ? " invalid" : ""}`} value={form.id} onChange={(event) => setValue("id", event.target.value)} placeholder={tx("例如：SYS_XXX")} />
          </div>
          <div className="fl">
            <label>{tx("系统缩写")}</label>
            <Input aria-label={tx("系统缩写")} className={`inp mono${touched && !form.abbr.trim() ? " invalid" : ""}`} value={form.abbr} onChange={(event) => setValue("abbr", event.target.value)} placeholder={tx("例如：CBS")} />
          </div>
          <div className="fl">
            <label>{tx("归属部门")}</label>
            <Select<string>
              aria-label={tx("归属部门")}
              className="sel"
              placeholder={tx("请选择归属部门")}
              items={[{ label: tx("请选择归属部门"), value: "" }, ...deptSelectOptions.map((dept) => ({ label: optionLabel(dept), value: dept.value }))]}
              value={form.dept || ""}
              onValueChange={(value) => setValue("dept", value || "")}
            />
            {deptLegacy ? <div className="editor-sub" style={{ marginTop: 6, color: "var(--warn)" }}>{tx("业务部门当前值未在码值中维护，请补充码值或重新选择。")}</div> : null}
          </div>
          <div className="fl">
            <label>{tx("重要程度")}</label>
            <Select<string>
              aria-label={tx("重要程度")}
              className="sel"
              items={[{ label: tx("普通"), value: "normal" }, { label: tx("重要"), value: "important" }]}
              value={form.importanceLevel}
              onValueChange={(value) => setImportanceLevel(value || "normal")}
            />
          </div>
          <div className="fl">
            <label>{tx("最晚出数时间")}</label>
            <Input
              type="time"
              step={60}
              className={`inp mono${touched && !isValidLatestOutputTime(form.importanceLevel, form.latestOutputTime) ? " invalid" : ""}`}
              value={form.latestOutputTime}
              onChange={(event) => setValue("latestOutputTime", event.target.value)}
              aria-invalid={touched && !isValidLatestOutputTime(form.importanceLevel, form.latestOutputTime) || undefined}
              disabled={form.importanceLevel !== "important"}
              aria-label={tx("最晚出数时间")}
              aria-describedby="latest-output-time-hint"
            />
            <div id="latest-output-time-hint" className="editor-sub">
              {form.importanceLevel === "important" ? tx("使用 24 小时制，可暂不配置。") : tx("仅重要系统可以配置。")}
            </div>
          </div>
          <div className="fl full">
            <label>{tx("系统说明")}</label>
            <Textarea aria-label={tx("系统说明")} className="ta" value={form.desc} onChange={(event) => setValue("desc", event.target.value)} placeholder={tx("描述系统用途，以及它消费哪些数据文件。")} />
          </div>
        </div>
      </div>

      <div className="form-card">
        <h3><Icon name="push" size={14} />{tx("连接配置")}</h3>
        <div className="form-grid">
          <div className="fl">
            <label>{tx("连接协议")}</label>
            <Select<string>
              aria-label={tx("连接协议")}
              className="sel"
              items={protocolSelectOptions.map((item) => ({ label: tx(optionLabel(item)), value: item.value }))}
              value={form.protocol || null}
              onValueChange={(value) => setValue("protocol", value || "")}
            />
            {protocolLegacy ? <div className="editor-sub" style={{ marginTop: 6, color: "var(--warn)" }}>{tx("连接协议当前值未在码值中维护，请补充码值或重新选择。")}</div> : null}
          </div>
          <div className="fl">
            <label>{tx("认证方式")}</label>
            <Select<string>
              aria-label={tx("认证方式")}
              className="sel"
              items={authSelectOptions.map((item) => ({ label: tx(optionLabel(item)), value: item.value }))}
              value={form.auth || null}
              onValueChange={(value) => setValue("auth", value || "")}
            />
            {authLegacy ? <div className="editor-sub" style={{ marginTop: 6, color: "var(--warn)" }}>{tx("认证方式当前值未在码值中维护，请补充码值或重新选择。")}</div> : null}
          </div>
          <div className="fl">
            <label>{tx("服务器地址")}</label>
            <Input aria-label={tx("服务器地址")} className={`inp mono${touched && !form.host.trim() ? " invalid" : ""}`} value={form.host} onChange={(event) => setValue("host", event.target.value)} placeholder={tx("例如：bi.consumer.demo.invalid")} />
          </div>
          <div className="fl">
            <label>{tx("端口")}</label>
            <Input aria-label={tx("端口")} className={`inp mono${touched && (!String(form.port).trim() || Number.isNaN(Number(form.port))) ? " invalid" : ""}`} value={form.port} onChange={(event) => setValue("port", event.target.value)} placeholder={tx("例如：22")} />
          </div>
          <div className="fl">
            <label>{tx("登录账号")}</label>
            <Input aria-label={tx("登录账号")} className="inp mono" value={form.account} onChange={(event) => setValue("account", event.target.value)} placeholder={tx("例如：dw_push_xxx")} />
          </div>
          <div className="fl">
            <label>{tx("下游对接人")}</label>
            <Input aria-label={tx("下游对接人")} className="inp" value={form.downstreamContact} onChange={(event) => setValue("downstreamContact", event.target.value)} placeholder={tx("例如：何嘉佳")} />
          </div>
          <div className="fl">
            <label>{tx("数据开发对接人")}</label>
            <Input aria-label={tx("数据开发对接人")} className="inp" value={form.dataDeveloperContact} onChange={(event) => setValue("dataDeveloperContact", event.target.value)} placeholder={tx("例如：何嘉佳")} />
          </div>
          <div className="fl">
            <label>{tx("启用状态")}</label>
            <BinaryStatusToggle
              mode="status"
              value={form.status}
              options={statusSelectOptions}
              onChange={(value) => setValue("status", normalizeStatus(value))}
            />
          </div>
        </div>
      </div>

      <FormActionBar
        note={tx(isEdit ? "保存后会更新系统连接信息。" : "保存后可继续为该系统新增推送作业。")}
        onCancel={onCancel}
        onSave={save}
        saving={saving}
        isDirty={isDirty}
      />
      {deleteInitial ? (
        <DangerZone
          description={tx("删除下游系统会影响其下所有推送作业、历史推送关系和审计追溯。若系统仅禁用即可满足需求，应优先禁用。")}
          actions={[
            {
              key: "delete-push-system",
              label: tx("删除下游系统"),
              icon: "trash",
              danger: true,
              onClick: async () => {
                if (await confirmDeleteAction({
                  name: deleteInitial.name,
                  typeLabel: tx("下游系统"),
                  impact: tx("该系统删除后，可能影响下游推送关系、历史任务记录和审计追溯。其下 {{count}} 个作业也会一并删除。", { count: deleteInitial.jobs.length }),
                  consequences: [
                    tx("删除前应校验是否存在历史推送任务和依赖关系。"),
                    tx("若后端拒绝删除，页面应展示具体原因。"),
                  ],
                  confirmKeyword: oldId,
                  confirmKeywordLabel: tx("请输入系统标识二次确认"),
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
