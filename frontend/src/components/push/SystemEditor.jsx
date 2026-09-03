import React from "react";
import { Icon } from "../ui.jsx";
import {
  ActionErrorBanner,
  BinaryStatusToggle,
  confirmDeleteAction,
  DangerZone,
  FormActionBar,
  PageHeader,
  TimeInput,
} from "../common/index.js";

import { getLegacyAwareOptions, isLegacyDictValue } from "../../utils/optionUtils.ts";
import { isValidLatestOutputTime, normalizeLatestOutputTime } from "../../utils/push.ts";
import { optionLabel } from "../../utils/ui.ts";
import {
  DEFAULT_AUTH_OPTIONS,
  DEFAULT_PROTOCOL_OPTIONS,
  DEFAULT_STATUS_OPTIONS,
  SYSTEM_ID_RE,
} from "./pushConstants.js";
import { validateSystem } from "./pushUtils.js";

export function SystemEditor({
  mode,
  initial,
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
}) {
  const isEdit = mode === "edit";
  const oldId = initial?.id || "";
  const defaultProtocol = protocolOptions[0]?.value || protocolOptions[0] || DEFAULT_PROTOCOL_OPTIONS[0];
  const defaultAuth = authOptions[0]?.value || authOptions[0] || DEFAULT_AUTH_OPTIONS[0];
  const defaultStatus = statusOptions[0]?.value || DEFAULT_STATUS_OPTIONS[0].value;
  const [form, setForm] = React.useState(() => ({
    id: initial?.id || "",
    name: initial?.name || "",
    abbr: initial?.abbr || "",
    desc: initial?.desc || "",
    protocol: initial?.protocol || defaultProtocol,
    host: initial?.host || "",
    port: initial?.port || 22,
    account: initial?.account || "",
    auth: initial?.auth || defaultAuth,
    downstreamContact: initial?.downstreamContact || initial?.contact || "",
    dataDeveloperContact: initial?.dataDeveloperContact || "",
    dept: initial?.dept || "",
    status: initial?.status || defaultStatus,
    importanceLevel: initial?.importanceLevel || "normal",
    latestOutputTime: initial?.latestOutputTime || "",
  }));
  const [touched, setTouched] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const initialSnapshotRef = React.useRef(JSON.stringify(form));
  const isDirty = initialSnapshotRef.current !== JSON.stringify(form);

  React.useEffect(() => {
    const nextForm = {
      id: initial?.id || "",
      name: initial?.name || "",
      abbr: initial?.abbr || "",
      desc: initial?.desc || "",
      protocol: initial?.protocol || defaultProtocol,
      host: initial?.host || "",
      port: initial?.port || 22,
      account: initial?.account || "",
      auth: initial?.auth || defaultAuth,
      downstreamContact: initial?.downstreamContact || initial?.contact || "",
      dataDeveloperContact: initial?.dataDeveloperContact || "",
      dept: initial?.dept || "",
      status: initial?.status || defaultStatus,
      importanceLevel: initial?.importanceLevel || "normal",
      latestOutputTime: initial?.latestOutputTime || "",
    };
    setForm(nextForm);
    setTouched(false);
    setSaving(false);
    initialSnapshotRef.current = JSON.stringify(nextForm);
  }, [initial, defaultProtocol, defaultAuth, defaultStatus]);

  const errors = touched ? validateSystem(form, existingIds, oldId) : [];
  const protocolSelectOptions = getLegacyAwareOptions(protocolOptions, form.protocol);
  const authSelectOptions = getLegacyAwareOptions(authOptions, form.auth);
  const deptSelectOptions = getLegacyAwareOptions(depts, form.dept);
  const protocolLegacy = isLegacyDictValue(protocolOptions, form.protocol);
  const authLegacy = isLegacyDictValue(authOptions, form.auth);
  const deptLegacy = Boolean(form.dept) && isLegacyDictValue(depts, form.dept);

  const setValue = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));
  const setImportanceLevel = (value) => setForm((prev) => ({
    ...prev,
    importanceLevel: value,
    latestOutputTime: value === "normal" ? "" : prev.latestOutputTime,
  }));

  const save = async () => {
    setTouched(true);
    const nextErrors = validateSystem(form, existingIds, oldId);
    if (nextErrors.length || saving) return;

    setSaving(true);
    try {
      await Promise.resolve(onSave(
      {
        ...initial,
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
        dept: form.dept.trim() || "未分配",
        latestOutputTime: normalizeLatestOutputTime(form.importanceLevel, form.latestOutputTime),
        jobs: initial?.jobs || [],
      },
      oldId || undefined,
      ));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        back={{ onClick: onCancel, text: isEdit ? "返回上一层" : "返回下游推送" }}
        breadcrumbs={[
          { label: "系统列表", onClick: onBackToList },
          ...(isEdit ? [{ label: oldId, onClick: onBackToDetail }] : []),
          { label: isEdit ? "编辑系统" : "新增系统" },
        ]}
        icon={isEdit ? "edit" : "plus"}
        title={isEdit ? "编辑下游系统" : "新增下游系统"}
        subtitle={isEdit ? oldId : "配置系统连接与对接信息。"}
      />

      <ActionErrorBanner title="请先修正以下问题" messages={errors} />

      <div className="form-card">
        <h3><Icon name="server" size={14} />基本信息</h3>
        <div className="form-grid">
          <div className="fl">
            <label>系统名称</label>
            <input className={`inp${touched && !form.name.trim() ? " invalid" : ""}`} value={form.name} onChange={(event) => setValue("name", event.target.value)} placeholder="例如：零售经营看板" />
          </div>
          <div className="fl">
            <label>系统编号</label>
            <input className={`inp mono${touched && (!form.id.trim() || !SYSTEM_ID_RE.test(form.id.trim())) ? " invalid" : ""}`} value={form.id} onChange={(event) => setValue("id", event.target.value)} placeholder="例如：SYS_XXX" />
          </div>
          <div className="fl">
            <label>系统缩写</label>
            <input className={`inp mono${touched && !form.abbr.trim() ? " invalid" : ""}`} value={form.abbr} onChange={(event) => setValue("abbr", event.target.value)} placeholder="例如：CBS" />
          </div>
          <div className="fl">
            <label>归属部门</label>
            <select className="sel" value={form.dept} onChange={(event) => setValue("dept", event.target.value)}>
              <option value="">请选择归属部门</option>
              {deptSelectOptions.map((dept) => <option key={dept.value || dept} value={dept.value || dept}>{optionLabel(dept)}</option>)}
            </select>
            {deptLegacy ? <div className="editor-sub" style={{ marginTop: 6, color: "var(--warn)" }}>业务部门当前值未在码值中维护，请补充码值或重新选择。</div> : null}
          </div>
          <div className="fl">
            <label>重要程度</label>
            <select
              className="sel"
              value={form.importanceLevel}
              onChange={(event) => setImportanceLevel(event.target.value)}
              aria-label="重要程度"
            >
              <option value="normal">普通</option>
              <option value="important">重要</option>
            </select>
          </div>
          <div className="fl">
            <label>最晚出数时间</label>
            <TimeInput
              className="inp mono"
              value={form.latestOutputTime}
              onChange={(event) => setValue("latestOutputTime", event.target.value)}
              invalid={touched && !isValidLatestOutputTime(form.importanceLevel, form.latestOutputTime)}
              disabled={form.importanceLevel !== "important"}
              aria-label="最晚出数时间"
              aria-describedby="latest-output-time-hint"
            />
            <div id="latest-output-time-hint" className="editor-sub">
              {form.importanceLevel === "important" ? "使用 24 小时制，可暂不配置。" : "仅重要系统可以配置。"}
            </div>
          </div>
          <div className="fl full">
            <label>系统说明</label>
            <textarea className="ta" value={form.desc} onChange={(event) => setValue("desc", event.target.value)} placeholder="描述系统用途，以及它消费哪些数据文件。" />
          </div>
        </div>
      </div>

      <div className="form-card">
        <h3><Icon name="push" size={14} />连接配置</h3>
        <div className="form-grid">
          <div className="fl">
            <label>连接协议</label>
            <select className="sel" value={form.protocol} onChange={(event) => setValue("protocol", event.target.value)}>
              {protocolSelectOptions.map((item) => <option key={item.value || item} value={item.value || item}>{optionLabel(item)}</option>)}
            </select>
            {protocolLegacy ? <div className="editor-sub" style={{ marginTop: 6, color: "var(--warn)" }}>连接协议当前值未在码值中维护，请补充码值或重新选择。</div> : null}
          </div>
          <div className="fl">
            <label>认证方式</label>
            <select className="sel" value={form.auth} onChange={(event) => setValue("auth", event.target.value)}>
              {authSelectOptions.map((item) => <option key={item.value || item} value={item.value || item}>{optionLabel(item)}</option>)}
            </select>
            {authLegacy ? <div className="editor-sub" style={{ marginTop: 6, color: "var(--warn)" }}>认证方式当前值未在码值中维护，请补充码值或重新选择。</div> : null}
          </div>
          <div className="fl">
            <label>服务器地址</label>
            <input className={`inp mono${touched && !form.host.trim() ? " invalid" : ""}`} value={form.host} onChange={(event) => setValue("host", event.target.value)} placeholder="例如：bi.consumer.demo.invalid" />
          </div>
          <div className="fl">
            <label>端口</label>
            <input className={`inp mono${touched && (!String(form.port).trim() || Number.isNaN(Number(form.port))) ? " invalid" : ""}`} value={form.port} onChange={(event) => setValue("port", event.target.value)} placeholder="例如：22" />
          </div>
          <div className="fl">
            <label>登录账号</label>
            <input className="inp mono" value={form.account} onChange={(event) => setValue("account", event.target.value)} placeholder="例如：dw_push_xxx" />
          </div>
          <div className="fl">
            <label>下游对接人</label>
            <input className="inp" value={form.downstreamContact} onChange={(event) => setValue("downstreamContact", event.target.value)} placeholder="例如：何嘉佳" />
          </div>
          <div className="fl">
            <label>数据开发对接人</label>
            <input className="inp" value={form.dataDeveloperContact} onChange={(event) => setValue("dataDeveloperContact", event.target.value)} placeholder="例如：何嘉佳" />
          </div>
          <div className="fl">
            <label>启用状态</label>
            <BinaryStatusToggle
              mode="status"
              value={form.status}
              options={statusOptions}
              onChange={(value) => setValue("status", value)}
            />
          </div>
        </div>
      </div>

      <FormActionBar
        note={isEdit ? "保存后会更新系统连接信息。" : "保存后可继续为该系统新增推送作业。"}
        onCancel={onCancel}
        onSave={save}
        saving={saving}
        isDirty={isDirty}
      />
      {isEdit ? (
        <DangerZone
          description="删除下游系统会影响其下所有推送作业、历史推送关系和审计追溯。若系统仅禁用即可满足需求，应优先禁用。"
          actions={[
            {
              key: "delete-push-system",
              label: "删除下游系统",
              icon: "trash",
              danger: true,
              onClick: async () => {
                if (await confirmDeleteAction({
                  name: initial.name,
                  typeLabel: "下游系统",
                  impact: `该系统删除后，可能影响下游推送关系、历史任务记录和审计追溯。其下 ${initial.jobs.length} 个作业也会一并删除。`,
                  consequences: [
                    "删除前应校验是否存在历史推送任务和依赖关系。",
                    "若后端拒绝删除，页面应展示具体原因。",
                  ],
                  confirmKeyword: oldId,
                  confirmKeywordLabel: "请输入系统标识二次确认",
                })) {
                  onDelete(oldId);
                }
              },
            },
          ]}
        />
      ) : null}
    </div>
  );
}
