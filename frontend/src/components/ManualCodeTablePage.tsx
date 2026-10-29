import { useLayoutEffect, useMemo, useRef } from "react";

import type { MockManualCodeTable } from "../data/manualCodeTables.ts";
import type { UseManualCodeTableModuleResult } from "../hooks/useManualCodeTableModule.ts";
import {
  MANUAL_CODE_TABLE_STATUS_META,
  MANUAL_CODE_TABLE_STYLES,
} from "../hooks/useManualCodeTableModule.ts";
import { formatDateTime } from "../utils/date.ts";
import { formFieldErrorEntries } from "../utils/formFieldErrorMapping.ts";
import {
  DangerZone,
  EmptyState,
  ErrorState,
  FormModal,
  FormSection,
  LoadingState,
  RowActions,
  StatusBadge,
  confirmDeleteAction,
} from "./common/index.ts";
import { Highlight, Icon } from "./ui.tsx";
import { Button, IconButton, Input, Select, Textarea } from "../ui/index.ts";
import { FormErrorSummary, FormField } from "../ui/FormErrors.tsx";
import { focusFirstFormError } from "../ui/formErrors.ts";

const STYLE_LABELS: Record<string, string> = Object.fromEntries(MANUAL_CODE_TABLE_STYLES.map((item) => [item.value, item.label]));
const MANUAL_CODE_TABLE_FORM_ID = "manual-code-table-form";
const MANUAL_CODE_TABLE_FIELD_LABELS: Readonly<Record<string, string>> = {
  tableCode: "表编码",
  tableName: "表名称",
  style: "表样式",
  owner: "负责人",
  status: "状态",
  remark: "说明",
};

interface CodeTableFormProps {
  module: UseManualCodeTableModuleResult;
}

function CodeTableForm({ module }: CodeTableFormProps) {
  const { form, setForm, formErrors, formModal, errorFocusRevision, clearFieldError } = module;
  const fieldErrors = useMemo(() => formFieldErrorEntries(formErrors), [formErrors]);
  const formRef = useRef<HTMLDivElement>(null);
  const previousFocusRevision = useRef(errorFocusRevision);
  useLayoutEffect(() => {
    if (previousFocusRevision.current === errorFocusRevision) return;
    previousFocusRevision.current = errorFocusRevision;
    focusFirstFormError(formRef.current, fieldErrors, "auto");
  }, [errorFocusRevision, fieldErrors]);

  return (
    <div id={MANUAL_CODE_TABLE_FORM_ID} ref={formRef}>
      <FormErrorSummary
        formId={MANUAL_CODE_TABLE_FORM_ID}
        errors={fieldErrors}
        getFieldLabel={(field) => MANUAL_CODE_TABLE_FIELD_LABELS[field] || "表单内容"}
      />
      <FormSection title="码表信息">
        <div className="form-grid">
          <FormField className="fl" formId={MANUAL_CODE_TABLE_FORM_ID} name="tableCode" label="表编码" error={fieldErrors["tableCode"]}>
            <Input aria-label="表编码" className={`inp mono${fieldErrors["tableCode"] ? " invalid" : ""}`} value={form.tableCode} onChange={(event) => {
              clearFieldError("tableCode");
              setForm((current) => ({ ...current, tableCode: event.target.value.toUpperCase() }));
            }} placeholder="例如：DIM_GENDER" maxLength={64} />
          </FormField>
          <FormField className="fl" formId={MANUAL_CODE_TABLE_FORM_ID} name="tableName" label="表名称" error={fieldErrors["tableName"]}>
            <Input aria-label="表名称" className={`inp${fieldErrors["tableName"] ? " invalid" : ""}`} value={form.tableName} onChange={(event) => {
              clearFieldError("tableName");
              setForm((current) => ({ ...current, tableName: event.target.value }));
            }} placeholder="例如：性别字典" maxLength={128} />
          </FormField>
          <FormField className="fl" formId={MANUAL_CODE_TABLE_FORM_ID} name="style" label="表样式" error={fieldErrors["style"]}>
            <Select<string> aria-label="表样式" placeholder="请选择表样式" className={`inp${fieldErrors["style"] ? " invalid" : ""}`} items={[{ label: "请选择表样式", value: "" }, ...MANUAL_CODE_TABLE_STYLES.map((item) => ({ label: item.label, value: item.value }))]} value={form.style || null} onValueChange={(value) => {
              clearFieldError("style");
              setForm((current) => ({ ...current, style: value || "" }));
            }} />
          </FormField>
          <FormField className="fl" formId={MANUAL_CODE_TABLE_FORM_ID} name="owner" label="负责人" error={fieldErrors["owner"]}>
            <Input aria-label="负责人" className={`inp${fieldErrors["owner"] ? " invalid" : ""}`} value={form.owner} onChange={(event) => {
              clearFieldError("owner");
              setForm((current) => ({ ...current, owner: event.target.value }));
            }} placeholder="例如：张敏" maxLength={64} />
          </FormField>
          <FormField className="fl full" formId={MANUAL_CODE_TABLE_FORM_ID} name="status" label="状态" error={fieldErrors["status"]}>
            <Select<string> aria-label="状态" className={`inp${fieldErrors["status"] ? " invalid" : ""}`} items={[{ label: "启用", value: "enabled" }, { label: "禁用", value: "disabled" }]} value={form.status || null} onValueChange={(value) => {
              clearFieldError("status");
              setForm((current) => ({ ...current, status: value || current.status }));
            }} />
          </FormField>
          <FormField className="fl full" formId={MANUAL_CODE_TABLE_FORM_ID} name="remark" label="说明" error={fieldErrors["remark"]}>
            <Textarea aria-label="说明" className={`ta${fieldErrors["remark"] ? " invalid" : ""}`} value={form.remark} onChange={(event) => {
              clearFieldError("remark");
              setForm((current) => ({ ...current, remark: event.target.value }));
            }} placeholder="补充用途、引用场景或值结构约定" maxLength={1000} />
          </FormField>
        </div>
      </FormSection>
      {formModal.mode === "edit" && formModal.initial ? (
        <DangerZone
          description="删除后码表将从湖仓登记清单移除；若只是暂时下线，建议优先禁用。"
          actions={[{
            key: "delete-code-table", label: "删除码值表", icon: "trash", danger: true,
            onClick: async () => {
              if (await confirmDeleteAction({
                name: formModal.initial?.tableName,
                typeLabel: "手工码值表",
                impact: "删除后该码表的表级登记信息将不可恢复。",
                confirmKeyword: formModal.initial?.tableCode,
                confirmKeywordLabel: "请输入表编码二次确认",
              }) && formModal.initial) {
                module.remove(formModal.initial);
              }
            },
          }]}
        />
      ) : null}
    </div>
  );
}

interface DetailModalProps {
  item: MockManualCodeTable | null;
  onClose: () => void;
  onEdit: (item: MockManualCodeTable) => void;
  canEdit: boolean;
}

function DetailModal({ item, onClose, onEdit, canEdit }: DetailModalProps) {
  if (!item) return null;
  return (
    <FormModal open title="码值表详情" subtitle={item.tableCode} icon="table" onClose={onClose} onSubmit={() => onEdit(item)} submitText="编辑" cancelText="关闭" busy={false} showSubmit={canEdit}>
      <div className="indicator-detail-grid">
        <div className="indicator-detail-item"><div className="indicator-detail-label">表编码</div><div className="indicator-detail-value mono">{item.tableCode}</div></div>
        <div className="indicator-detail-item"><div className="indicator-detail-label">表名称</div><div className="indicator-detail-value">{item.tableName}</div></div>
        <div className="indicator-detail-item"><div className="indicator-detail-label">表样式</div><div className="indicator-detail-value"><span className="tag tag-neutral">{STYLE_LABELS[item.style] || item.style}</span></div></div>
        <div className="indicator-detail-item"><div className="indicator-detail-label">状态</div><div className="indicator-detail-value"><StatusBadge status={item.status} metaMap={MANUAL_CODE_TABLE_STATUS_META} /></div></div>
        <div className="indicator-detail-item"><div className="indicator-detail-label">负责人</div><div className="indicator-detail-value">{item.owner || "-"}</div></div>
        <div className="indicator-detail-item"><div className="indicator-detail-label">更新时间</div><div className="indicator-detail-value mono">{formatDateTime(item.updatedAt)}</div></div>
        <div className="indicator-detail-item full"><div className="indicator-detail-label">说明</div><div className="indicator-detail-value">{item.remark || "-"}</div></div>
      </div>
      {!canEdit ? <div className="page-sub">当前为只读访问，管理员登录后可编辑。</div> : null}
    </FormModal>
  );
}

export interface ManualCodeTablePageProps {
  module: UseManualCodeTableModuleResult;
  query: string;
  canEdit: boolean;
  canExport: boolean;
}

export function ManualCodeTablePage({ module, query, canEdit, canExport }: ManualCodeTablePageProps) {
  if (module.loading) return <LoadingState title="加载码值表维护模块" desc="正在读取湖仓手工码值表登记信息。" />;
  if (module.error) return <ErrorState title="码值表加载失败" desc={module.error} onRetry={module.load} />;

  const stats: Array<[string, number]> = [
    ["码表总数", module.items.length],
    ["启用", module.items.filter((item) => item.status === "enabled").length],
    ["禁用", module.items.filter((item) => item.status === "disabled").length],
    ["样式种类", new Set(module.items.map((item) => item.style)).size],
  ];
  const activeStyleLabel = MANUAL_CODE_TABLE_STYLES.find(
    (style) => style.value === module.styleFilter,
  )?.label;
  const activeStatusLabel = module.statusFilter
    ? MANUAL_CODE_TABLE_STATUS_META[module.statusFilter]?.label
    : null;

  return (
    <div className="asset-page code-table-page">
      <div className="page-head">
        <div>
          <div className="page-title"><span className="pt-code">CODE</span>码值表维护</div>
          <div className="page-sub">注册并维护湖仓手工码值表的表级元数据，不维护表内码值条目。</div>
        </div>
        <div className="head-actions">
          {canExport ? <Button className="btn" variant="secondary" type="button" onClick={module.exportCsv}><Icon name="download" size={15} />导出</Button> : null}
          {canEdit ? <Button className="btn primary" variant="primary" type="button" onClick={module.openNew}><Icon name="plus" size={15} />新增码值表</Button> : null}
        </div>
      </div>

      <div className="stat-row">{stats.map(([label, value]) => <div className="stat-card" key={label}><div className="sv">{value}</div><div className="sl">{label}</div></div>)}</div>

      <div className="tbl-wrap code-table-list">
        <div className="field-toolbar">
          {activeStyleLabel || activeStatusLabel ? (
            <div className="code-table-active-filters" aria-live="polite">
              {activeStyleLabel ? (
                <span className="chip-active">
                  样式：{activeStyleLabel}
                  <IconButton
                    type="button"
                    className="code-table-filter-clear"
                    size="sm"
                    variant="tertiary"
                    aria-label={`清除样式筛选：${activeStyleLabel}`}
                    icon={<Icon name="close" size={12} />}
                    onClick={() => module.setStyleFilter("")}
                  />
                </span>
              ) : null}
              {activeStatusLabel ? (
                <span className="chip-active">
                  状态：{activeStatusLabel}
                  <IconButton
                    type="button"
                    className="code-table-filter-clear"
                    size="sm"
                    variant="tertiary"
                    aria-label={`清除状态筛选：${activeStatusLabel}`}
                    icon={<Icon name="close" size={12} />}
                    onClick={() => module.setStatusFilter("")}
                  />
                </span>
              ) : null}
            </div>
          ) : null}
          <div className="ft-info">共 {module.filteredItems.length} 张码表{query ? `，匹配“${query}”` : ""}</div>
        </div>
        {!module.filteredItems.length ? (
          <EmptyState title="暂无匹配的手工码值表" desc="请调整搜索或筛选条件，管理员也可以新增一张码值表。" actionText={canEdit ? "新增码值表" : ""} onAction={canEdit ? module.openNew : undefined} />
        ) : (
          <table className="dt mobile-card-table">
            <thead><tr><th>表编码</th><th>表名称</th><th>表样式</th><th>负责人</th><th>状态</th><th>更新时间</th><th>说明</th><th>操作</th></tr></thead>
            <tbody>{module.filteredItems.map((item) => (
              <tr key={item.id}>
                <td data-label="表编码" className="mono"><Highlight text={item.tableCode} q={query} /></td>
                <td data-label="表名称"><Highlight text={item.tableName} q={query} /></td>
                <td data-label="表样式"><span className="tag tag-neutral">{STYLE_LABELS[item.style] || item.style}</span></td>
                <td data-label="负责人"><Highlight text={item.owner || "-"} q={query} /></td>
                <td data-label="状态"><StatusBadge status={item.status} metaMap={MANUAL_CODE_TABLE_STATUS_META} /></td>
                <td data-label="更新时间" className="mono">{formatDateTime(item.updatedAt)}</td>
                <td data-label="说明"><span className="system-line-clamp"><Highlight text={item.remark || "-"} q={query} /></span></td>
                <td data-label="" className="mobile-card-actions">
                  <RowActions
                    onView={() => module.setDetailItem(item)}
                    onEdit={canEdit ? () => module.openEdit(item) : undefined}
                    toggle={canEdit ? { enabled: item.status === "enabled", label: item.tableName, onToggle: () => module.changeStatus(item, item.status === "enabled" ? "disabled" : "enabled") } : undefined}
                  />
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>

      <FormModal open={module.formModal.open} title={module.formModal.mode === "edit" ? "编辑码值表" : "新增码值表"} subtitle={module.formModal.mode === "edit" ? `正在编辑：${module.formModal.initial?.tableCode}` : "登记一张湖仓手工码值表"} icon="table" onClose={module.closeForm} onSubmit={module.submit} submitText={module.formModal.mode === "edit" ? "保存修改" : "创建"} busy={module.formModal.busy}>
        <CodeTableForm module={module} />
      </FormModal>
      <DetailModal item={module.detailItem} onClose={() => module.setDetailItem(null)} onEdit={module.openEdit} canEdit={canEdit} />
    </div>
  );
}
